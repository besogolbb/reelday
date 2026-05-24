/**
 * Pre-flight audio generation for SDE renders.
 *
 * Previously these tasks lived inside the Fargate render.mjs runner. When
 * we moved to Remotion Lambda (which only runs the composition, not a
 * custom runner) these had to migrate to the backend. They run once per
 * render before invoking Lambda; the resulting R2 URLs are passed through
 * to the composition as inputProps.
 *
 *   1. generateVoiceOver — OpenAI TTS narration over the title card.
 *   2. extractAmbientAudio — pulls ~10-15s of room sound from the top-3
 *      reacted video clips, ducks to -18 dB, mixes under the music bed.
 *
 * Both are best-effort: an OpenAI outage shouldn't block the render —
 * the composition gracefully omits voiceoverSrc when null. Same for
 * ambient.
 */

import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import OpenAI from 'openai';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`)));
  });
}

async function r2Upload(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
}

async function r2DownloadToFile(key, destPath) {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(Readable.from(res.Body), createWriteStream(destPath));
}

async function presign(key, expiresIn = 7200) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

/**
 * Generate OpenAI TTS narration for the title card. Returns a presigned R2
 * URL, or null on failure or missing API key.
 */
export async function generateVoiceOver({ eventId, title, subtitle }) {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!title && !subtitle) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const parts = [];
    if (title) parts.push(`On this special day, ${title}`);
    if (subtitle) parts.push(`celebrated in ${subtitle}.`);
    else parts.push('celebrated a day to remember.');
    const narration = parts.join(' ');

    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: narration,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());

    const voKey = `sde/${eventId}/vo-${Date.now()}.mp3`;
    await r2Upload(voKey, buffer, 'audio/mpeg');
    return presign(voKey, 3600);
  } catch (err) {
    console.warn('[sde-preflight] voice over generation failed:', err.message);
    return null;
  }
}

/**
 * For each of the top-3 reacted video clips, extract ambient audio at -18 dB
 * and upload to R2. Mutates clips array, attaching `ambientSrc` to each.
 * Returns the mutated array (also fine to ignore).
 */
export async function extractAmbientForTopVideos(clips, eventId) {
  const topVideos = clips
    .filter(c => c.type === 'video' && c.key)
    .sort((a, b) => (b.reactionCount || 0) - (a.reactionCount || 0))
    .slice(0, 3);
  if (!topVideos.length) return clips;

  const tmpDir = await mkdtemp(join(tmpdir(), 'sde-amb-'));
  try {
    await Promise.all(topVideos.map(async (clip, idx) => {
      try {
        const srcPath = join(tmpDir, `video-${idx}.mp4`);
        await r2DownloadToFile(clip.key, srcPath);

        const ambPath = join(tmpDir, `ambient-${idx}.mp3`);
        await runFfmpeg([
          '-i', srcPath,
          '-vn',
          '-af', 'volume=-18dB',
          '-acodec', 'libmp3lame',
          '-q:a', '4',
          ambPath,
        ]);

        const ambBuffer = await readFile(ambPath);
        const ambKey = `sde/${eventId}/ambient-${Date.now()}-${idx}.mp3`;
        await r2Upload(ambKey, ambBuffer, 'audio/mpeg');
        clip.ambientSrc = await presign(ambKey, 3600);
      } catch (err) {
        console.warn(`[sde-preflight] ambient extraction failed for clip ${clip.key}:`, err.message);
      }
    }));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return clips;
}
