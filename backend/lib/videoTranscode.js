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
// Run ffmpeg at a lower scheduling priority so a long encode never
// starves the main Fastify event loop of a CPU. `nice` only exists on
// POSIX (Linux/macOS) — on Windows dev we fall back to plain spawn.
const USE_NICE   = process.platform !== 'win32';
const NICE_LEVEL = 10;

// Cap how many ffmpeg pipelines run at once. Without this, 5 guests
// uploading simultaneously would spawn 5+ ffmpeg processes competing
// for the same 2 vCPUs — each transcode runs SLOWER than running them
// serially, and 1080p decode buffers can OOM the container at scale.
//
// Default of 2 matches the KVM 2 vCPU count: each in-flight transcode
// gets one core's worth of CPU when the queue is full, but each
// individual encode can still use both cores when the queue is short.
// Override with TRANSCODE_CONCURRENCY env var if you upgrade to KVM 4+.
const MAX_CONCURRENT = Math.max(1, Number(process.env.TRANSCODE_CONCURRENCY) || 2);
let inFlight = 0;
const waiters = [];

function acquireSlot() {
  return new Promise(resolve => {
    if (inFlight < MAX_CONCURRENT) {
      inFlight += 1;
      resolve();
    } else {
      waiters.push(resolve);
    }
  });
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) {
    inFlight += 1;
    next();
  }
}

/**
 * Re-queue any video uploads that landed but never got a transcode —
 * typically because the Node process was restarted between insert and
 * the background ffmpeg job finishing. Call once at startup.
 *
 * Bounded to videos uploaded in the last 24h so a long-running outage
 * doesn't dump thousands of stale jobs into the queue at boot.
 */
export async function reconcilePendingTranscodes(fastify) {
  try {
    const { rows } = await fastify.db.query(
      `SELECT id, file_url, file_type
         FROM uploads
        WHERE file_type = 'video'
          AND web_url IS NULL
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at ASC`,
    );
    if (!rows.length) {
      fastify.log.info('No pending transcodes to reconcile');
      return;
    }
    fastify.log.info({ pending: rows.length }, 'Re-queuing pending transcodes from previous run');
    for (const row of rows) {
      transcodeUploadInBackground(fastify, row)
        .catch(err => fastify.log.warn({ err: err.message, upload_id: row.id }, 'Reconcile transcode failed'));
    }
  } catch (err) {
    fastify.log.warn({ err: err.message }, 'reconcilePendingTranscodes failed');
  }
}

// Ffmpeg arg sets — kept separate so a future "Hiraya 1080p" tier can
// reuse the same pipeline by swapping these constants.
const VIDEO_ARGS = [
  // Filter chain explained:
  //   scale + flags=lanczos  — Lanczos beats the default bilinear when
  //                            downsampling (4K→720p is a 9x pixel
  //                            reduction; bilinear loses fine detail).
  //   pad                    — letterbox tall/odd aspect ratios into
  //                            the 1280x720 frame so the wall doesn't
  //                            stretch portrait clips.
  //   unsharp=5:5:0.8:5:5:0  — gentle sharpening pass to recover detail
  //                            lost in the downscale. 5x5 luma matrix
  //                            at amount 0.8 is the safe recipe — the
  //                            often-quoted 3:3:1.5 introduces ringing
  //                            (halos) on hard edges, especially faces.
  //                            Chroma sharpening forced to 0 since
  //                            sharpening colour channels just amplifies
  //                            compression noise.
  '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease:flags=lanczos,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,unsharp=5:5:0.8:5:5:0',
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
    const cmd      = USE_NICE ? 'nice' : FFMPEG;
    const fullArgs = USE_NICE ? ['-n', String(NICE_LEVEL), FFMPEG, ...args] : args;
    const proc = spawn(cmd, fullArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
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

  // Pull the original key out of the public URL we stored.
  let originalKey;
  try {
    const u = new URL(upload.file_url);
    originalKey = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  } catch {
    log.warn('Could not parse file_url; skipping transcode');
    return;
  }

  let workdir = null;
  let originalBytesOnDisk = false;
  try {
    workdir = await mkdtemp(join(tmpdir(), 'reelday-tx-'));
    const inPath     = join(workdir, 'in');
    const webPath    = join(workdir, 'out.mp4');
    const posterPath = join(workdir, 'poster.jpg');
    const { webKey, posterKey } = derivedKeys(originalKey);

    log.info({ key: originalKey }, 'Downloading original from R2');
    const original = await r2Download(fastify.storage, originalKey);
    await writeFile(inPath, original);
    originalBytesOnDisk = true;

    // ── Phase 1: poster first, OUTSIDE the semaphore. ────────────────
    // Extracting one frame is sub-second work even on 4K; queueing it
    // behind the slow video encode would mean the wall has no poster
    // for 5–15s — exactly when buffering of the original looks worst.
    // Update the DB the moment the poster lands so the wall's next 2s
    // poll picks it up and slaps it onto <video poster=...> +
    // backdrop, masking the slow first-pass download of the original.
    try {
      const posterStart = Date.now();
      await runFfmpeg(['-y', '-i', inPath, ...POSTER_ARGS, posterPath]);
      const posterBuf = await readFile(posterPath);
      const posterUrl = await r2Upload(fastify.storage, posterKey, posterBuf, 'image/jpeg');
      await fastify.db.query(
        `UPDATE uploads SET poster_url = $2 WHERE id = $1`,
        [upload.id, posterUrl],
      );
      log.info({ posterUrl, posterBytes: posterBuf.length, elapsedMs: Date.now() - posterStart }, 'Poster ready');
    } catch (err) {
      // Poster failure shouldn't block the video transcode below.
      log.warn({ err: err.message }, 'Poster generation failed; continuing to web mp4');
    }

    // ── Phase 2: video transcode, INSIDE the semaphore. ──────────────
    // This is the CPU-heavy job; cap concurrency at vCPU count so we
    // don't thrash. Slot is released in finally{} so a crash never
    // leaks a slot.
    log.info({ inFlight, queued: waiters.length, max: MAX_CONCURRENT }, 'Queued for video transcode');
    await acquireSlot();
    const videoStart = Date.now();
    try {
      log.info({ bytes: original.length }, 'Running ffmpeg (web mp4)');
      await runFfmpeg(['-y', '-i', inPath, ...VIDEO_ARGS, webPath]);
      const webBuf = await readFile(webPath);
      const webUrl = await r2Upload(fastify.storage, webKey, webBuf, 'video/mp4');
      // Persist all three fields together so downstream consumers
      // (SDE renderer, download bundle) can rely on compressed_key being
      // set when video_status='ready' — previously web_url was set but
      // compressed_key stayed NULL, forcing reconcileVideoUpload() in
      // uploads.js to back-fill on every read.
      await fastify.db.query(
        `UPDATE uploads
            SET web_url        = $2,
                compressed_key = COALESCE(compressed_key, $3),
                video_status   = 'ready'
          WHERE id = $1`,
        [upload.id, webUrl, webKey],
      );
      log.info({ webUrl, webBytes: webBuf.length, elapsedMs: Date.now() - videoStart }, 'Video transcode complete');
    } finally {
      releaseSlot();
    }
  } catch (err) {
    log.warn({ err: err.message }, 'Transcode failed — wall will fall back to file_url');
  } finally {
    if (workdir) {
      try { await rm(workdir, { recursive: true, force: true }); } catch {}
    }
    if (!originalBytesOnDisk) {
      // We never even downloaded the original — log so we know R2 reads
      // are the bottleneck if this becomes a pattern.
      log.warn('Bailed before downloading original from R2');
    }
  }
}
