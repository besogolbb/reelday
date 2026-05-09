/**
 * Server-side video transcode pipeline.
 *
 * Why this exists: guest phones produce wildly varied clips — 4K H.264 MP4
 * from iPhones, VP8 WebM from our in-app recorder on Android Chrome, raw
 * 30 MB pre-recorded clips from camera rolls, etc. The wall device (a TV
 * browser, a Chromecast, a propped-up phone) then has to download AND
 * decode whatever it gets. That mismatch is the actual cause of wall lag.
 *
 * After this module runs:
 *   - web_url    -> 720p H.264 MP4 with `+faststart`, ~1.5–2 Mbps,
 *                   roughly 3–6 MB for a 30s clip.
 *   - poster_url -> 720p JPEG of an early frame so the wall can paint
 *                   something the moment the slide enters.
 *
 * The original (file_url) is kept in R2 unchanged for the couple's
 * download bundle. The wall + dashboard prefer web_url when present.
 *
 * Concurrency model: fire-and-forget per upload. spawn() inherits an
 * isolated process; node's event loop stays free. For events with
 * dozens of concurrent guests we'll want a job queue (BullMQ/Redis) but
 * the KVM 2 (2 vCPU + 8 GB) handles realistic Reelday loads in-process.
 */

import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, readFile, writeFile, rm } from 'fs/promises';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// Ffmpeg arg sets — kept separate so a future "Hiraya 1080p" tier can
// reuse the same pipeline by swapping these constants.
const VIDEO_ARGS = [
  '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black',
  '-c:v', 'libx264',
  '-preset', 'veryfast',          // 5–15s for a 30s clip on 2 vCPU
  '-profile:v', 'main',           // broadest hardware-decode support
  '-pix_fmt', 'yuv420p',          // required by Safari + most TVs
  '-b:v', '1800k',                // ~6 MB for 30s
  '-maxrate', '2200k',
  '-bufsize', '3000k',
  '-r', '30',                     // cap fps so source 60fps doesn't bloat
  '-c:a', 'aac',
  '-b:a', '96k',
  '-ar', '44100',
  '-movflags', '+faststart',      // wall plays after ~200KB instead of full file
];
const POSTER_ARGS = [
  '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease,thumbnail',
  '-frames:v', '1',
  '-q:v', '4',                    // ~80 KB, plenty for a poster
];

/**
 * Run ffmpeg, resolve when it exits 0, reject with stderr when not.
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').slice(-6).join('\n')}`));
    });
  });
}

async function r2Download(s3, key) {
  const res = await s3.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key:    key,
  }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function r2Upload(s3, key, buf, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket:       process.env.R2_BUCKET_NAME,
    Key:          key,
    Body:         buf,
    ContentType:  contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  return `${base}/${key}`;
}

/**
 * Derive the web/poster keys from the original. e.g.
 *   uploads/<slug>/123-clip.mp4
 *     -> uploads/<slug>/123-clip_web.mp4
 *     -> uploads/<slug>/123-clip_poster.jpg
 */
function derivedKeys(originalKey) {
  const dot = originalKey.lastIndexOf('.');
  const stem = dot > 0 ? originalKey.slice(0, dot) : originalKey;
  return {
    webKey:    `${stem}_web.mp4`,
    posterKey: `${stem}_poster.jpg`,
  };
}

/**
 * Process one upload row in-place. Updates uploads.web_url + .poster_url
 * once the transcode finishes. Errors are logged but never thrown to the
 * caller — a failed transcode just leaves the columns NULL and the
 * frontend falls back to the original file_url.
 *
 * @param {object} fastify  needs fastify.db + fastify.storage
 * @param {object} upload   { id, file_url, file_type } row
 */
export async function transcodeUploadInBackground(fastify, upload) {
  if (!upload || upload.file_type !== 'video' || !upload.file_url) return;

  const log = fastify.log.child({ upload_id: upload.id, op: 'transcode' });
  let workdir = null;

  try {
    // Pull the original key out of the public URL we stored.
    let originalKey;
    try {
      const u = new URL(upload.file_url);
      originalKey = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    } catch {
      log.warn('Could not parse file_url; skipping transcode');
      return;
    }

    workdir = await mkdtemp(join(tmpdir(), 'reelday-tx-'));
    const inPath     = join(workdir, 'in');
    const webPath    = join(workdir, 'out.mp4');
    const posterPath = join(workdir, 'poster.jpg');

    log.info({ key: originalKey }, 'Downloading original from R2');
    const original = await r2Download(fastify.storage, originalKey);
    await writeFile(inPath, original);

    log.info({ bytes: original.length }, 'Running ffmpeg (transcode + poster)');
    // Run both passes in parallel — ffmpeg is single-threaded per process,
    // so two processes use both vCPUs without thrashing.
    await Promise.all([
      runFfmpeg(['-y', '-i', inPath, ...VIDEO_ARGS,  webPath]),
      runFfmpeg(['-y', '-i', inPath, ...POSTER_ARGS, posterPath]),
    ]);

    const [webBuf, posterBuf] = await Promise.all([
      readFile(webPath),
      readFile(posterPath),
    ]);
    const { webKey, posterKey } = derivedKeys(originalKey);

    log.info({ webBytes: webBuf.length, posterBytes: posterBuf.length }, 'Uploading derivatives to R2');
    const [webUrl, posterUrl] = await Promise.all([
      r2Upload(fastify.storage, webKey,    webBuf,    'video/mp4'),
      r2Upload(fastify.storage, posterKey, posterBuf, 'image/jpeg'),
    ]);

    await fastify.db.query(
      `UPDATE uploads SET web_url = $2, poster_url = $3 WHERE id = $1`,
      [upload.id, webUrl, posterUrl],
    );
    log.info({ webUrl, posterUrl }, 'Transcode complete');
  } catch (err) {
    log.warn({ err: err.message }, 'Transcode failed — wall will fall back to file_url');
  } finally {
    if (workdir) {
      try { await rm(workdir, { recursive: true, force: true }); } catch {}
    }
  }
}
