import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { tmpdir } from 'os';
import { join, posix as pathPosix } from 'path';
import { mkdtemp, rm, stat } from 'fs/promises';
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
  MAX_INPUT_BYTES = '524288000', // 500 MB
} = process.env;

const MAX_BYTES = Number(MAX_INPUT_BYTES);

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

function derivedKeys(originalKey) {
  const cleanKey = String(originalKey || '').replace(/^\/+/, '');
  const dir = pathPosix.dirname(cleanKey);
  const ext = pathPosix.extname(cleanKey);
  const base = pathPosix.basename(cleanKey, ext);
  const joinKey = name => (dir && dir !== '.' ? `${dir}/${name}` : name);
  return {
    compressedKey: joinKey(`compressed_${base}.mp4`),
    posterKey: joinKey(`poster_${base}.jpg`),
  };
}

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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').slice(-10).join('\n')}`));
    });
  });
}

async function notifyWebhook(payload, { timeoutMs = 5000 } = {}) {
  if (!WEBHOOK_URL) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WEBHOOK_SECRET },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (err) {
    console.warn('Webhook failed', err.message);
  } finally {
    clearTimeout(t);
  }
}

// Accept both direct-invoke payloads and SQS-triggered events.
// SQS event source delivers { Records: [{ body: "<json>" }, ...] }; configure batchSize: 1
// so each Lambda invocation handles exactly one video.
function unwrapEvent(event) {
  if (event && Array.isArray(event.Records) && event.Records.length > 0) {
    const body = event.Records[0].body;
    return typeof body === 'string' ? JSON.parse(body) : body;
  }
  return event || {};
}

function deriveCombinedKey(photoKey) {
  const cleanKey = String(photoKey || '').replace(/^\/+/, '');
  const dir = pathPosix.dirname(cleanKey);
  const ext = pathPosix.extname(cleanKey);
  const base = pathPosix.basename(cleanKey, ext);
  const joinKey = name => (dir && dir !== '.' ? `${dir}/${name}` : name);
  return joinKey(`${base}_voice.mp4`);
}

async function handleCombine(event) {
  const photoKey  = String(event.photoKey  || '').replace(/^\/+/, '');
  const audioKey  = String(event.audioKey  || '').replace(/^\/+/, '');
  const uploadId  = event.uploadId;

  if (!photoKey || !audioKey) throw new Error('Missing photoKey or audioKey for combine');
  if (!uploadId) throw new Error('Missing uploadId for combine');

  const combinedKey = deriveCombinedKey(photoKey);

  const existing = await r2Head(combinedKey);
  if (existing) {
    await notifyWebhook({ status: 'combine_ready', uploadId, combinedKey });
    return { statusCode: 200, body: JSON.stringify({ ok: true, combinedKey, cached: true }) };
  }

  let workdir = null;
  try {
    workdir = await mkdtemp(join(tmpdir(), 'reelday-comb-'));
    const photoPath    = join(workdir, 'photo');
    const audioPath    = join(workdir, 'audio');
    const combinedPath = join(workdir, 'combined.mp4');

    await Promise.all([
      r2DownloadToFile(photoKey, photoPath),
      r2DownloadToFile(audioKey, audioPath),
    ]);

    await runFfmpeg([
      '-y', '-loop', '1', '-framerate', '1',
      '-i', photoPath,
      '-i', audioPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-profile:v', 'baseline',
      '-pix_fmt', 'yuv420p',
      '-g', '1',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p',
      '-r', '1',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-shortest',
      '-movflags', '+faststart',
      combinedPath,
    ]);

    await r2UploadFile(combinedKey, combinedPath, 'video/mp4');
    notifyWebhook({ status: 'combine_ready', uploadId, combinedKey }, { timeoutMs: 2000 });

    return { statusCode: 200, body: JSON.stringify({ ok: true, combinedKey }) };
  } finally {
    if (workdir) { try { await rm(workdir, { recursive: true, force: true }); } catch {} }
  }
}

export const handler = async (rawEvent, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;

  const event = unwrapEvent(rawEvent);

  if (event.operation === 'combine') return handleCombine(event);

  const originalKey = (event.fileName || event.originalKey || '').trim();
  // preThumbKey is still accepted in the payload (backend stores the
  // guest thumbnail in R2 for the wall to surface during processing),
  // but ffmpeg no longer reads it — the bg fill is done in wall CSS.

  if (!originalKey) throw new Error('Missing originalKey');
  const { compressedKey, posterKey } = derivedKeys(originalKey);

  // Idempotency + size guard in parallel — one round trip instead of two.
  const [existing, srcHead] = await Promise.all([r2Head(compressedKey), r2Head(originalKey)]);
  if (existing) {
    await notifyWebhook({ status: 'video_ready', originalKey, compressedKey, posterKey, cached: true });
    return { statusCode: 200, body: JSON.stringify({ ok: true, compressedKey, cached: true }) };
  }
  if (!srcHead) throw new Error(`Source not found: ${originalKey}`);
  if (typeof srcHead.ContentLength === 'number' && srcHead.ContentLength > MAX_BYTES) {
    const msg = `Input too large: ${srcHead.ContentLength} > ${MAX_BYTES}`;
    await notifyWebhook({ status: 'error', originalKey, message: msg });
    throw new Error(msg);
  }

  let workdir = null;
  try {
    workdir = await mkdtemp(join(tmpdir(), 'reelday-tx-'));
    const inputPath = join(workdir, 'input');
    const outputPath = join(workdir, 'output.mp4');
    const posterPath = join(workdir, 'poster.jpg');

    await r2DownloadToFile(originalKey, inputPath);

    // Defensive: re-check size on disk in case ContentLength was missing/wrong.
    const st = await stat(inputPath);
    if (st.size > MAX_BYTES) throw new Error(`Input too large on disk: ${st.size}`);

    // Output the video at its NATIVE aspect ratio, fit inside a 1280x720
    // bounding box. We used to bake a blurred-source backdrop inside the
    // file so portrait clips became a 16:9 deliverable, but the wall
    // already does that treatment in CSS (heavier, prettier blur tied to
    // the poster image). Doing it twice meant the wall's blur sat on top
    // of a weakly-blurred copy that was visible as banding inside the
    // playing video. Now the file is just the source, downscaled.
    const filterComplex = [
      "[0:v]fps=24,scale=1280:720:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2',setsar=1,split=2[outv][vposter]",
      '[vposter]select=gte(t\\,1)[poster]',
    ].join(';');

    await runFfmpeg([
      '-y', '-nostdin', '-threads', '0', '-ignore_unknown', '-sn', '-dn',
      '-sws_flags', 'fast_bilinear',
      '-i', inputPath,
      '-filter_complex', filterComplex,
      // Main mp4 output
      '-map', '[outv]', '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-map_metadata', '-1',
      outputPath,
      // Poster output (single frame at ~1s)
      '-map', '[poster]', '-frames:v', '1', '-q:v', '4',
      posterPath,
    ]);

    // Upload poster first so the wall can show a placeholder while the mp4 finishes uploading.
    await Promise.all([
      r2UploadFile(posterKey, posterPath, 'image/jpeg'),
      notifyWebhook({ status: 'poster_ready', originalKey, posterKey }),
    ]);

    await r2UploadFile(compressedKey, outputPath, 'video/mp4');

    // Fire-and-forget final webhook with a short bounded timeout so a slow receiver
    // never inflates Lambda billable duration. Do not await.
    notifyWebhook({ status: 'video_ready', originalKey, compressedKey, posterKey }, { timeoutMs: 2000 });

    return { statusCode: 200, body: JSON.stringify({ ok: true, compressedKey }) };
  } catch (error) {
    console.error('FAILED:', error.message);
    await notifyWebhook({ status: 'error', originalKey, message: error.message });
    throw error;
  } finally {
    if (workdir) { try { await rm(workdir, { recursive: true, force: true }); } catch {} }
  }
};
