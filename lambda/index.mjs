import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { tmpdir } from 'os';
import { join, posix as pathPosix } from 'path';
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

export const handler = async (event, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;

  const originalKey = (event.fileName || event.originalKey || '').trim();
  const preThumbKey = event.preThumbKey || null;
  const preThumbDataUrl = typeof event.preThumbDataUrl === 'string' ? event.preThumbDataUrl.trim() : null;

  if (!originalKey) throw new Error('Missing originalKey');
  const { compressedKey, posterKey } = derivedKeys(originalKey);

  // Idempotency: skip work if compressed output already exists.
  const existing = await r2Head(compressedKey);
  if (existing) {
    await notifyWebhook({ status: 'video_ready', originalKey, compressedKey, posterKey, cached: true });
    return { statusCode: 200, body: JSON.stringify({ ok: true, compressedKey, cached: true }) };
  }

  // Size guard before download to avoid blowing /tmp or burning time on oversized inputs.
  const srcHead = await r2Head(originalKey);
  if (!srcHead) throw new Error(`Source not found: ${originalKey}`);
  if (typeof srcHead.ContentLength === 'number' && srcHead.ContentLength > MAX_BYTES) {
    const msg = `Input too large: ${srcHead.ContentLength} > ${MAX_BYTES}`;
    await notifyWebhook({ status: 'error', originalKey, message: msg, preThumbKey });
    throw new Error(msg);
  }

  let workdir = null;
  try {
    workdir = await mkdtemp(join(tmpdir(), 'reelday-tx-'));
    const inputPath = join(workdir, 'input');
    const bgImgPath = join(workdir, 'bg.jpg');
    const outputPath = join(workdir, 'output.mp4');
    const posterPath = join(workdir, 'poster.jpg');

    await r2DownloadToFile(originalKey, inputPath);

    // Defensive: re-check size on disk in case ContentLength was missing/wrong.
    const st = await stat(inputPath);
    if (st.size > MAX_BYTES) throw new Error(`Input too large on disk: ${st.size}`);

    const hasPreThumb = preThumbDataUrl && /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(preThumbDataUrl);
    if (hasPreThumb) {
      const base64 = preThumbDataUrl.replace(/^data:image\/(?:jpeg|jpg|png|webp);base64,/i, '');
      await writeFile(bgImgPath, Buffer.from(base64, 'base64'));
    } else {
      // Extract a single background frame. Done as its own short call because merging it into
      // the encode graph via split+trim+loop on a shared decoder starves the foreground branch.
      await runFfmpeg(['-y', '-nostdin', '-ss', '0', '-i', inputPath, '-vframes', '1', bgImgPath]);
    }

    // One FFmpeg call covers: blurred-bg overlay encode + poster extraction.
    // Foreground stream [1:v] is referenced twice (fg + poster) so we explicitly split it.
    const filterComplex = [
      '[0:v]fps=24,scale=192:-2,boxblur=8:1,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1[bg]',
      '[1:v]split=2[vfg][vposter]',
      "[vfg]fps=24,scale=1280:720:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2',setsar=1[fg]",
      '[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[outv]',
      '[vposter]select=gte(t\\,1)[poster]',
    ].join(';');

    await runFfmpeg([
      '-y', '-nostdin', '-threads', '0', '-ignore_unknown', '-sn', '-dn',
      '-loop', '1', '-i', bgImgPath,
      '-i', inputPath,
      '-filter_complex', filterComplex,
      // Main mp4 output
      '-map', '[outv]', '-map', '1:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
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
    await notifyWebhook({ status: 'error', originalKey, message: error.message, preThumbKey });
    throw error;
  } finally {
    if (workdir) { try { await rm(workdir, { recursive: true, force: true }); } catch {} }
  }
};
