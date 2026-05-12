import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { tmpdir } from 'os';
import { join, posix as pathPosix } from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { spawn, execSync } from 'child_process';
import { pipeline } from 'stream/promises';

const {
  R2_BUCKET_NAME,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  FFMPEG_PATH = '/opt/bin/ffmpeg',
} = process.env;

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

async function notifyWebhook(payload) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WEBHOOK_SECRET },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('Webhook failed', err.message);
  }
}

export const handler = async (event) => {
  const originalKey = (event.fileName || event.originalKey || '').trim();
  const preThumbKey = event.preThumbKey || null;
  const preThumbDataUrl = typeof event.preThumbDataUrl === 'string' ? event.preThumbDataUrl.trim() : null;

  if (!originalKey) throw new Error('Missing originalKey');
  const { compressedKey, posterKey } = derivedKeys(originalKey);
  let workdir = null;

  try {
    try { execSync(`chmod +x ${FFMPEG_PATH}`); } catch {}
    workdir = await mkdtemp(join(tmpdir(), 'reelday-tx-'));
    const inputPath = join(workdir, 'input');
    const bgImgPath = join(workdir, 'bg.jpg');
    const outputPath = join(workdir, 'output.mp4');
    const posterPath = join(workdir, 'poster.jpg');

    await r2DownloadToFile(originalKey, inputPath);

    if (preThumbDataUrl && /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(preThumbDataUrl)) {
      console.log('Step 1: Using provided guest pre-thumb as static background...');
      const base64 = preThumbDataUrl.replace(/^data:image\/(?:jpeg|jpg|png|webp);base64,/i, '');
      await writeFile(bgImgPath, Buffer.from(base64, 'base64'));
    } else {
      console.log('Step 1: Extracting static background frame...');
      await runFfmpeg(['-y', '-ss', '00:00:00', '-i', inputPath, '-vframes', '1', bgImgPath]);
    }

    console.log('Step 2: Encoding with static blurred background...');
    await runFfmpeg([
      '-y', '-nostdin', '-threads', '0', '-ignore_unknown', '-sn', '-dn',
      '-loop', '1', '-i', bgImgPath,
      '-i', inputPath,
      '-filter_complex',
      '[0:v]scale=256:-2,boxblur=12:2,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1[bg];' +
      "[1:v]scale=1280:720:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2',setsar=1[fg];" +
      '[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[outv]',
      '-map', '[outv]', '-map', '1:a:0?',
      '-c:v', 'libx264', '-crf', '28', '-preset', 'ultrafast', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-map_metadata', '-1',
      outputPath
    ]);

    await runFfmpeg(['-y', '-ss', '00:00:01', '-i', outputPath, '-vframes', '1', '-q:v', '4', posterPath]);

    await Promise.all([
      r2UploadFile(posterKey, posterPath, 'image/jpeg'),
      notifyWebhook({ status: 'poster_ready', originalKey, posterKey })
    ]);

    await r2UploadFile(compressedKey, outputPath, 'video/mp4');
    await notifyWebhook({ status: 'video_ready', originalKey, compressedKey, posterKey });

    return { statusCode: 200, body: JSON.stringify({ ok: true, compressedKey }) };

  } catch (error) {
    console.error('FAILED:', error.message);
    await notifyWebhook({ status: 'error', originalKey, message: error.message, preThumbKey });
    throw error;
  } finally {
    if (workdir) { try { await rm(workdir, { recursive: true, force: true }); } catch {} }
  }
};
