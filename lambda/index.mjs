import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { tmpdir } from 'os';
import { join, posix as pathPosix } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';

// Deploy this Lambda with MemorySize = 3000 MB. The handler streams files
// between R2 and /tmp so ffmpeg gets the RAM headroom instead of buffering
// full videos in Node.

const {
  R2_BUCKET_NAME,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_PUBLIC_URL = 'https://media.reelday.ph',
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  FFMPEG_PATH = '/opt/bin/ffmpeg',
} = process.env;

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
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
  const res = await s3.send(new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  }));
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

    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.split('\n').slice(-8).join('\n')}`));
    });
  });
}

async function notifyWebhook(payload) {
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': WEBHOOK_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Webhook failed: ${res.status} ${text}`);
  }
}

export const handler = async (event) => {
  const originalKey = String(event?.originalKey || event?.fileName || '').trim();
  if (!originalKey) throw new Error('Missing event.fileName');

  const { compressedKey, posterKey } = derivedKeys(originalKey);
  let workdir = null;

  try {
    workdir = await mkdtemp(join(tmpdir(), 'reelday-tx-'));
    const inputPath = join(workdir, 'input');
    const outputPath = join(workdir, 'output.mp4');
    const posterPath = join(workdir, 'poster.jpg');

    await r2DownloadToFile(originalKey, inputPath);

    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-filter_complex',
      '[0:v]split=2[src_main][src_poster];' +
      '[src_main]split=2[v1][v2];' +
      '[v1]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=50:10[bg];' +
      '[v2]scale=1280:720:force_original_aspect_ratio=decrease[fg];' +
      '[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[wall];' +
      '[src_poster]split=2[p1][p2];' +
      '[p1]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=50:10[poster_bg];' +
      '[p2]scale=1280:720:force_original_aspect_ratio=decrease[poster_fg];' +
      '[poster_bg][poster_fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[poster_wall]',
      '-map', '[wall]',
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'ultrafast',
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      '-s', '1280x720',
      outputPath,
      '-ss', '00:00:01',
      '-map', '[poster_wall]',
      '-vframes', '1',
      '-q:v', '2',
      posterPath,
    ]);

    await r2UploadFile(posterKey, posterPath, 'image/jpeg');
    await notifyWebhook({ status: 'poster_ready', originalKey, posterKey });

    await r2UploadFile(compressedKey, outputPath, 'video/mp4');
    await notifyWebhook({ status: 'video_ready', originalKey, compressedKey, posterKey });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, originalKey, compressedKey, posterKey }),
    };
  } finally {
    if (workdir) {
      try { await rm(workdir, { recursive: true, force: true }); } catch {}
    }
  }
};
