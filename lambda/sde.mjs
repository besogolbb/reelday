/**
 * Same Day Edit renderer Lambda — `reelday-sde-renderer`.
 *
 * Pure stateless media worker: receives an already-decided clip list +
 * (optional) music + (optional) PNG title/endcards, stitches a
 * 1920×1080 mp4, uploads it + a poster JPEG to R2, then POSTs back to
 * the backend's sde-ready webhook. **No DB access.** The Curator runs
 * server-side (backend/lib/sdeSelect.js); this file is the film editor
 * that splices what it was handed.
 *
 * Mirrors index.mjs (the per-upload transcoder) idioms: same S3 client,
 * same runFfmpeg helper, same notifyWebhook shape, same /tmp +
 * mkdtemp + cleanup discipline. Kept as a *copy* (not an import) so
 * each Lambda deploys as an independent zip with no shared module
 * dependency between them.
 *
 * Deployment config (set in AWS Lambda console, not code):
 *   - Function name:  reelday-sde-renderer
 *   - Runtime:        Node.js 20 (or later)
 *   - Memory:         3008 MB (plan §1: needed for FFmpeg 1080p)
 *   - Ephemeral /tmp: 4096 MB (clips + intermediates can exceed default 512 MB)
 *   - Timeout:        900 s (15 min; per plan §1)
 *   - Layer:          same FFmpeg layer the transcoder uses
 *                     (provides /opt/bin/ffmpeg)
 *   - Env vars:       R2_BUCKET_NAME, R2_ACCOUNT_ID,
 *                     R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *                     WEBHOOK_URL  (→ https://<host>/webhooks/sde-ready),
 *                     WEBHOOK_SECRET (shared with backend)
 *
 * Invoked async (`InvocationType: 'Event'`) — never sync — by
 * backend/lib/awsLambdaService.js (Slice 2B). Idempotent: if `outKey`
 * already exists in R2, skip the work and just notify.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm, writeFile, stat } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';

const {
  R2_BUCKET_NAME,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  FFMPEG_PATH = '/opt/bin/ffmpeg',
  // Per-clip normalization budget. The Curator caps the total at 240 s
  // (80 clips × 3 s ceiling), so an individual normalize is bounded;
  // this is a defense-in-depth limit, not the primary cap.
  MAX_CLIP_INPUT_BYTES = '524288000', // 500 MB
} = process.env;

const MAX_BYTES = Number(MAX_CLIP_INPUT_BYTES);

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

// ── R2 helpers (copied from index.mjs; deploy-isolated on purpose) ────

async function r2Head(key) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
}

async function r2DownloadToFile(key, destinationPath) {
  const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  await pipeline(res.Body, createWriteStream(destinationPath));
}

async function r2UploadFile(key, filePath, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: createReadStream(filePath),
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

// ── FFmpeg + webhook helpers ──────────────────────────────────────────

function runFfmpeg(args, { label = 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited ${code}: ${stderr.split('\n').slice(-12).join('\n')}`));
    });
  });
}

// Probe a file's duration using ffmpeg (no ffprobe in the minimal layer).
// We parse the "Duration:" header line out of stderr. Used for the audio
// loop math — we know the photo/video clip durations from the payload.
async function ffmpegDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_PATH, ['-i', filePath, '-hide_banner'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', c => { stderr += c.toString(); });
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/);
      if (!m) return resolve(null);
      resolve((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]));
    });
    proc.on('error', () => resolve(null));
  });
}

async function notifyWebhook(payload, { timeoutMs = 5000 } = {}) {
  if (!WEBHOOK_URL) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WEBHOOK_SECRET || '' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (err) {
    console.warn('SDE webhook failed', err.message);
  } finally {
    clearTimeout(t);
  }
}

// ── Per-clip normalization ────────────────────────────────────────────
//
// Every brick comes out **byte-compatible** so the concat demuxer can
// stream them without a re-encode at the join. That means: 1920×1080,
// yuv420p, 24 fps, setsar=1, AAC silent track at 48 kHz mono.
//
// Photo → Ken Burns: slow zoom-in over `durSec` so a still frame feels
//         alive on the venue TV. The scale=*:trunc/2*2 keeps zoompan
//         from producing odd-pixel sizes that h.264 rejects.
// Video → trim to `durSec`, scale-fit with letterbox pads, drop the
//         guest audio (basic render is music-only; ducking parked).
// Card  → like a photo but no zoom; held flat for `durSec`.

const TARGET_W   = 1920;
const TARGET_H   = 1080;
const TARGET_FPS = 24;

function safeCardName(i) {
  return `clip_${String(i).padStart(4, '0')}.mp4`;
}

async function normalizePhoto(srcPath, outPath, durSec, { kenBurns = true } = {}) {
  // zoompan operates on frames; d = durSec * fps so the zoom finishes
  // exactly when the clip ends.
  const frames = Math.max(1, Math.round(durSec * TARGET_FPS));
  const vf = kenBurns
    ? [
        // Upscale a touch first so zoompan has headroom to crop into.
        `scale=2400:1350:force_original_aspect_ratio=decrease`,
        `pad=2400:1350:(ow-iw)/2:(oh-ih)/2:color=black`,
        `zoompan=z='min(zoom+0.0015\\,1.15)':d=${frames}:s=${TARGET_W}x${TARGET_H}:fps=${TARGET_FPS}`,
        `fps=${TARGET_FPS}`,
        `format=yuv420p`,
        `setsar=1`,
      ].join(',')
    : [
        `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease`,
        `pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
        `fps=${TARGET_FPS}`,
        `format=yuv420p`,
        `setsar=1`,
      ].join(',');

  await runFfmpeg([
    '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-t', String(durSec),
    '-i', srcPath,
    // Anullsrc gives every clip an identical silent stereo track so
    // concat doesn't have to negotiate audio streams across bricks.
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
    '-vf', vf,
    '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
    '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1',
    '-r', String(TARGET_FPS),
    '-movflags', '+faststart',
    outPath,
  ], { label: `normalize-photo` });
}

async function normalizeVideo(srcPath, outPath, durSec) {
  await runFfmpeg([
    '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-t', String(durSec),
    '-i', srcPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
    '-vf', [
      `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease`,
      `pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
      `fps=${TARGET_FPS}`,
      `format=yuv420p`,
      `setsar=1`,
    ].join(','),
    '-map', '0:v:0', '-map', '1:a:0',  // explicit: source video + silent audio
    '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
    '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1',
    '-r', String(TARGET_FPS),
    '-movflags', '+faststart',
    outPath,
  ], { label: `normalize-video` });
}

// ── Main pipeline ─────────────────────────────────────────────────────

function totalDurationSec(clips) {
  return clips.reduce((s, c) => s + (Number(c.dur) || 0), 0);
}

async function downloadAll(workdir, payload) {
  // Download clips + (optional) audio + (optional) cards in parallel.
  // Bounded concurrency via Promise.all over the typed jobs; the runtime
  // schedules ~6 sockets per host by default which is plenty for one
  // event's clip count.
  const jobs = [];
  const localPaths = { clips: [], audio: null, titleCard: null, endcard: null };

  payload.clips.forEach((clip, i) => {
    const ext = clip.type === 'video' ? '.mp4' : '.jpg';
    const dest = join(workdir, `src_${String(i).padStart(4, '0')}${ext}`);
    localPaths.clips.push(dest);
    jobs.push(
      r2DownloadToFile(clip.key, dest).then(async () => {
        const st = await stat(dest);
        if (st.size > MAX_BYTES) {
          throw new Error(`Clip ${i} too large on disk: ${st.size} > ${MAX_BYTES}`);
        }
      }),
    );
  });

  if (payload.audioKey) {
    localPaths.audio = join(workdir, 'audio.bin');
    jobs.push(r2DownloadToFile(payload.audioKey, localPaths.audio));
  }
  if (payload.titleCardKey) {
    localPaths.titleCard = join(workdir, 'titlecard.png');
    jobs.push(r2DownloadToFile(payload.titleCardKey, localPaths.titleCard));
  }
  if (payload.endcardKey) {
    localPaths.endcard = join(workdir, 'endcard.png');
    jobs.push(r2DownloadToFile(payload.endcardKey, localPaths.endcard));
  }

  await Promise.all(jobs);
  return localPaths;
}

async function normalizeAll(workdir, payload, localPaths) {
  // Serial encode — at libx264 veryfast on a 3 GB Lambda, 1080p typically
  // runs ~2–4× realtime, so ~3 min of source ≈ 60–90 s of CPU. Well
  // inside the 900 s timeout, and serial keeps memory pressure flat.
  // Batch 3 can switch to bounded-parallel if real events show lag.
  const normalizedPaths = [];

  // Title card first (if any) — 2.5 s flat hold.
  if (localPaths.titleCard) {
    const out = join(workdir, safeCardName(0));
    await normalizePhoto(localPaths.titleCard, out, 2.5, { kenBurns: false });
    normalizedPaths.push(out);
  }

  for (let i = 0; i < payload.clips.length; i++) {
    const clip = payload.clips[i];
    const src  = localPaths.clips[i];
    const out  = join(workdir, safeCardName(i + 1));
    const dur  = Number(clip.dur) || (clip.type === 'video' ? 5 : 3);
    if (clip.type === 'video') {
      await normalizeVideo(src, out, dur);
    } else {
      await normalizePhoto(src, out, dur, { kenBurns: true });
    }
    normalizedPaths.push(out);
  }

  if (localPaths.endcard) {
    const out = join(workdir, safeCardName(payload.clips.length + 1));
    await normalizePhoto(localPaths.endcard, out, 2.5, { kenBurns: false });
    normalizedPaths.push(out);
  }

  return normalizedPaths;
}

async function concatNormalized(workdir, normalizedPaths) {
  // Concat demuxer: zero re-encode at the join because every brick was
  // normalized to identical codec params. ~1 s for 80 bricks.
  const listPath = join(workdir, 'concat.txt');
  const lines = normalizedPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listPath, lines + '\n');

  const stitchedPath = join(workdir, 'stitched.mp4');
  await runFfmpeg([
    '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    stitchedPath,
  ], { label: 'concat' });
  return stitchedPath;
}

async function muxMusic(workdir, stitchedPath, audioPath, durationSec) {
  // Trim/loop the music bed to the stitched duration, fade in/out 1.5 s
  // each end, drop the (silent) original track. If `durationSec` is
  // unknown we fall back to -shortest, which trims to the video.
  const out = join(workdir, 'final.mp4');
  const fadeOutStart = Math.max(0, durationSec - 1.5);
  const audioFilter = [
    `aloop=loop=-1:size=2e9`,                      // loop forever; size= safety bound
    `atrim=0:${durationSec}`,
    `afade=t=in:st=0:d=1.5`,
    `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=1.5`,
    `aresample=async=1`,                            // ride out micro-drift
  ].join(',');

  await runFfmpeg([
    '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-i', stitchedPath,
    '-i', audioPath,
    '-filter_complex', `[1:a]${audioFilter}[a]`,
    '-map', '0:v:0', '-map', '[a]',
    '-c:v', 'copy',                                  // video already encoded; don't re-touch
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
    '-shortest',
    '-movflags', '+faststart',
    out,
  ], { label: 'mux-music' });

  return out;
}

async function generatePoster(workdir, finalVideoPath) {
  // Single JPEG grabbed ~2 s in (skips the title card so the poster shows
  // a real moment, not the brand frame). Used by the dashboard SDE panel
  // + the website hub for the preview thumbnail.
  const posterPath = join(workdir, 'poster.jpg');
  await runFfmpeg([
    '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-ss', '2', '-i', finalVideoPath,
    '-frames:v', '1', '-q:v', '4',
    posterPath,
  ], { label: 'poster' });
  return posterPath;
}

// ── Handler ───────────────────────────────────────────────────────────

export const handler = async (event, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;

  const payload = event || {};
  const {
    eventId, slug,
    clips,
    audioKey = null,
    titleCardKey = null,
    endcardKey = null,
    outKey,
  } = payload;

  // Hard payload validation. Any malformed invoke is a backend bug,
  // not a render error — fail loudly so it shows up in CloudWatch.
  if (!eventId)              throw new Error('Missing eventId');
  if (!outKey)               throw new Error('Missing outKey');
  if (!Array.isArray(clips)) throw new Error('Missing clips[]');
  if (clips.length === 0)    throw new Error('clips[] is empty');

  console.log(`[sde] start event=${eventId} slug=${slug} clips=${clips.length} ` +
              `audio=${!!audioKey} title=${!!titleCardKey} endcard=${!!endcardKey} out=${outKey}`);

  // Idempotency: if the output already exists in R2, skip the work and
  // re-notify. Lets the backend safely retry on transient webhook loss.
  const existing = await r2Head(outKey);
  if (existing) {
    const posterKey = outKey.replace(/\.mp4$/i, '.jpg');
    console.log(`[sde] cached hit ${outKey}, re-notifying`);
    await notifyWebhook({
      status: 'ready', eventId, slug, videoKey: outKey, posterKey,
      durationS: null, clipCount: clips.length, cached: true,
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, outKey, cached: true }) };
  }

  let workdir = null;
  try {
    workdir = await mkdtemp(join(tmpdir(), 'reelday-sde-'));

    // 1. Download everything to /tmp in parallel.
    const localPaths = await downloadAll(workdir, payload);
    console.log(`[sde] downloaded ${clips.length} clips + extras`);

    // 2. Per-clip normalize to a uniform codec profile so concat is free.
    const normalizedPaths = await normalizeAll(workdir, payload, localPaths);
    console.log(`[sde] normalized ${normalizedPaths.length} bricks`);

    // 3. Concat into a single stitched mp4 (no re-encode).
    let stitchedPath = await concatNormalized(workdir, normalizedPaths);

    // 4. Compute true duration from the stitched file (more reliable
    //    than summing payload .dur values, which can drift on video clips
    //    that were shorter than payload.dur).
    let durationS = await ffmpegDuration(stitchedPath);
    if (!durationS) {
      // Fallback to summed payload durations + card overheads.
      durationS = totalDurationSec(clips)
        + (localPaths.titleCard ? 2.5 : 0)
        + (localPaths.endcard   ? 2.5 : 0);
    }
    console.log(`[sde] stitched duration=${durationS.toFixed(2)}s`);

    // 5. Mux the music bed if we got one.
    let finalPath = stitchedPath;
    if (localPaths.audio) {
      finalPath = await muxMusic(workdir, stitchedPath, localPaths.audio, durationS);
      console.log(`[sde] muxed music`);
    }

    // 6. Extract a poster JPEG from inside the reel.
    const posterPath = await generatePoster(workdir, finalPath);

    // 7. Upload poster first (small + lets the dashboard surface the
    //    thumbnail before the big mp4 finishes), then the final mp4.
    const posterKey = outKey.replace(/\.mp4$/i, '.jpg');
    await r2UploadFile(posterKey, posterPath, 'image/jpeg');
    await r2UploadFile(outKey,    finalPath,  'video/mp4');
    console.log(`[sde] uploaded ${outKey} + ${posterKey}`);

    // 8. Fire-and-forget final notify with a bounded timeout so a slow
    //    backend never inflates Lambda billable duration. Mirrors the
    //    pattern in lambda/index.mjs.
    notifyWebhook({
      status:     'ready',
      eventId, slug,
      videoKey:   outKey,
      posterKey,
      durationS:  Math.round(durationS),
      clipCount:  clips.length,
      cached:     false,
    }, { timeoutMs: 2000 });

    return { statusCode: 200, body: JSON.stringify({ ok: true, outKey, durationS }) };
  } catch (error) {
    console.error('[sde] FAILED:', error.message);
    // Awaited error notify so the backend reliably marks the row as
    // errored. Surface a clipped message — full stderr lives in CloudWatch.
    await notifyWebhook({
      status: 'error', eventId, slug,
      message: error.message.slice(0, 500),
    });
    throw error;
  } finally {
    if (workdir) { try { await rm(workdir, { recursive: true, force: true }); } catch {} }
  }
};
