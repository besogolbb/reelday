/**
 * SDE Fargate renderer entry point.
 *
 * Reads SDE_PAYLOAD_KEY from env → downloads payload JSON from R2 →
 * pre-processes media (presigned URLs, voice over, ambient audio, QR code) →
 * calls Remotion renderMedia() → uploads MP4 + poster to R2 → POSTs webhook.
 *
 * Invoked as: node render.mjs
 * Container: 8 vCPU / 16 GB Fargate task (see docs/SDE-HANDOVER.md).
 */

import { renderMedia, selectComposition } from '@remotion/renderer';
import { bundle } from '@remotion/bundler';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { spawn } from 'child_process';
import { createWriteStream, readFileSync } from 'fs';
import { writeFile, unlink, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import OpenAI from 'openai';
import QRCode from 'qrcode';

// ─── R2 client ──────────────────────────────────────────────────────────────

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function r2GetJson(key) {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await res.Body.transformToString('utf-8');
  return JSON.parse(body);
}

async function r2DownloadToFile(key, destPath) {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(Readable.from(res.Body), createWriteStream(destPath));
}

async function r2UploadFile(key, filePath, contentType) {
  const body = readFileSync(filePath);
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000',
  }));
}

async function presign(key, expiresIn = 7200) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

// Cloudflare Image Resizing — resize photos at the edge so Chromium decodes
// 1920px JPEGs instead of 6000px originals (10x faster per frame, much less RAM).
// Only works because R2 is served publicly through media.reelday.ph.
// Matches the wall's cdnImage() transform string exactly so SDE benefits
// from the cache that guests populated while browsing — first render is
// effectively free for any photo someone has already viewed.
function photoSrc(key, width = 1920) {
  const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
  return `${base}/cdn-cgi/image/width=${width},quality=82,format=auto,fit=scale-down/${key}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exit ${code}\n${stderr}`));
    });
  });
}

async function notifyWebhook(body) {
  await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
}

// ─── Chapter detection ───────────────────────────────────────────────────────

const CHAPTER_RANGES = [
  { label: 'Preparation',           start: 6,  end: 12 },
  { label: 'Ceremony',              start: 12, end: 15 },
  { label: 'Cocktail Hour',         start: 15, end: 18 },
  { label: 'Reception & Celebration', start: 18, end: 24 },
];

function detectChapters(clips) {
  // Group clips by hour in Asia/Manila (UTC+8)
  const groups = new Map();
  for (const clip of clips) {
    const dt = new Date(clip.createdAt ?? Date.now());
    const manilaHour = (dt.getUTCHours() + 8) % 24;
    const range = CHAPTER_RANGES.find((r) => manilaHour >= r.start && manilaHour < r.end);
    const label = range?.label ?? 'Celebration';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(clip);
  }

  // If only 1–2 distinct chapters, collapse to no labels (avoids sparse markers)
  if (groups.size <= 2) {
    return [{ label: '', clips }];
  }

  // Preserve CHAPTER_RANGES order
  const ordered = [];
  for (const { label } of [...CHAPTER_RANGES, { label: 'Celebration' }]) {
    if (groups.has(label)) ordered.push({ label, clips: groups.get(label) });
  }
  return ordered;
}

// ─── Voice over generation ────────────────────────────────────────────────────

async function generateVoiceOver(title, subtitle, endcardText, destPath) {
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
  await writeFile(destPath, buffer);
}

// ─── Ambient audio extraction ─────────────────────────────────────────────────

async function extractAmbient(srcPath, destPath) {
  await runFfmpeg([
    '-i', srcPath,
    '-vn',
    '-af', 'volume=-18dB',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    destPath,
  ]);
}

// ─── Landscape detection (aspect ratio heuristic) ────────────────────────────

async function isLandscapeImage(filePath) {
  try {
    const result = await runFfmpeg(['-i', filePath]);
    const match = result.match(/(\d{3,5})x(\d{3,5})/);
    if (!match) return false;
    return parseInt(match[1]) > parseInt(match[2]);
  } catch {
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const payloadKey = process.env.SDE_PAYLOAD_KEY;
  if (!payloadKey) throw new Error('SDE_PAYLOAD_KEY env var required');

  console.log(`[render] loading payload from R2: ${payloadKey}`);
  const payload = await r2GetJson(payloadKey);

  const {
    eventId, slug, clips: rawClips, audioKey,
    title, subtitle, endcardText, coverImageUrl,
    outKey,
  } = payload;

  const tmpDir = await mkdtemp(join(tmpdir(), 'sde-'));
  console.log(`[render] working in ${tmpDir}`);

  try {
    // ── 1. Presign all clip URLs ──────────────────────────────────────────────
    console.log(`[render] presigning ${rawClips.length} clip URLs`);
    const clipsWithSrc = await Promise.all(
      rawClips.map(async (clip, i) => {
        const isPhoto = clip.type === 'photo';
        return {
          ...clip,
          // Photos: CDN-resized to 1920px (10x faster decode than originals).
          // Videos: presigned R2 URL (OffthreadVideo extracts frames via ffmpeg).
          src: isPhoto ? photoSrc(clip.key) : await presign(clip.key),
          // Photos: tiny 480px variant for the blurred background pass —
          // bg is gaussian-blurred 30px anyway so source detail is wasted.
          blurSrc: isPhoto ? photoSrc(clip.key, 480) : undefined,
          // Videos: CDN-resized poster JPEG. Replaces the second OffthreadVideo
          // (was decoding every video frame twice) and the freeze-frame seeks.
          posterSrc: !isPhoto && clip.posterKey ? photoSrc(clip.posterKey, 1920) : undefined,
          createdAt: clip.createdAt ?? new Date().toISOString(),
          reactionCount: clip.reactionCount ?? 0,
          isPinned: clip.isPinned ?? false,
          isLandscape: clip.isLandscape ?? false,
        };
      })
    );

    // ── 2. Presign audio ──────────────────────────────────────────────────────
    const audioSrc = audioKey ? await presign(audioKey) : null;

    // ── 3. Voice over ─────────────────────────────────────────────────────────
    let voiceoverSrc = null;
    if (process.env.OPENAI_API_KEY && (title || subtitle)) {
      const voPath = join(tmpDir, 'voiceover.mp3');
      console.log('[render] generating voice over');
      await generateVoiceOver(title, subtitle, endcardText, voPath);
      // Upload to R2 so Remotion can fetch it via URL
      const voKey = `sde/${eventId}/vo-${Date.now()}.mp3`;
      await r2UploadFile(voKey, voPath, 'audio/mpeg');
      voiceoverSrc = await presign(voKey, 3600);
    }

    // ── 4. Ambient audio from top-3 reacted video clips ──────────────────────
    const topVideos = clipsWithSrc
      .filter((c) => c.type === 'video')
      .sort((a, b) => b.reactionCount - a.reactionCount)
      .slice(0, 3);

    for (const clip of topVideos) {
      try {
        const srcPath = join(tmpDir, `video-${rawClips.indexOf(clip)}.mp4`);
        await r2DownloadToFile(clip.key, srcPath);
        const ambPath = join(tmpDir, `ambient-${rawClips.indexOf(clip)}.mp3`);
        await extractAmbient(srcPath, ambPath);
        const ambKey = `sde/${eventId}/ambient-${Date.now()}.mp3`;
        await r2UploadFile(ambKey, ambPath, 'audio/mpeg');
        clip.ambientSrc = await presign(ambKey, 3600);
      } catch (e) {
        console.warn(`[render] ambient extraction failed for clip: ${e.message}`);
      }
    }

    // ── 5. Hero clip detection ────────────────────────────────────────────────
    const heroClipIndex = clipsWithSrc.reduce(
      (best, clip, i) => (clip.reactionCount > clipsWithSrc[best].reactionCount ? i : best),
      0
    );

    // ── 6. Chapter grouping ───────────────────────────────────────────────────
    const chapters = detectChapters(clipsWithSrc);

    // ── 7. QR code ────────────────────────────────────────────────────────────
    const galleryUrl = `https://${process.env.APP_PUBLIC_HOST ?? 'reelday.ph'}/e/${slug}`;
    const qrCodeDataUrl = await QRCode.toDataURL(galleryUrl, { width: 200, margin: 1 });

    // ── 8. Total clip count + reactions ──────────────────────────────────────
    const totalClips = clipsWithSrc.length;
    const totalReactions = clipsWithSrc.reduce((s, c) => s + (c.reactionCount ?? 0), 0);

    // ── 9. Bundle + render ───────────────────────────────────────────────────
    // Use pre-built bundle from Docker image if available (saves ~1-2 min)
    const PREBUNDLE_PATH = new URL('./bundle', import.meta.url).pathname;
    let bundled;
    try {
      await import('fs').then(fs => fs.promises.access(PREBUNDLE_PATH));
      console.log('[render] using pre-built bundle');
      bundled = PREBUNDLE_PATH;
    } catch {
      console.log('[render] bundling Remotion composition (no pre-built bundle found)');
      bundled = await bundle({
        entryPoint: new URL('./src/index.ts', import.meta.url).pathname,
        webpackOverride: (config) => config,
      });
    }

    const inputProps = {
      chapters,
      totalClips,
      totalReactions,
      heroClipIndex,
      flashCutFrame: 300, // approximate — audio analysis would refine this
      title: title ?? null,
      subtitle: subtitle ?? null,
      endcardText: endcardText ?? null,
      coverImageSrc: coverImageUrl
        ? (() => {
            // Route cover image through CDN resizer too (used as blurred bg).
            const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
            if (coverImageUrl.startsWith(base + '/')) {
              const key = coverImageUrl.slice(base.length + 1);
              return photoSrc(key, 1920);
            }
            return coverImageUrl;
          })()
        : null,
      audioSrc,
      voiceoverSrc,
      qrCodeDataUrl,
      eventSlug: slug,
    };

    const composition = await selectComposition({
      serveUrl: bundled,
      id: 'SdeComposition',
      inputProps,
      browserExecutable: '/usr/bin/chromium',
    });

    const outputPath = join(tmpDir, 'sde.mp4');
    console.log(`[render] starting renderMedia (concurrency=16, ${composition.durationInFrames} frames)`);
    const startTime = Date.now();

    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      concurrency: 16,
      crf: 26,
      x264Preset: 'fast',          // ~30% faster encode for ~1% larger file
      imageFormat: 'jpeg',
      jpegQuality: 90,
      timeoutInMilliseconds: 180000,
      offthreadVideoCacheSizeInBytes: 8 * 1024 * 1024 * 1024,
      audioBitrate: '128k',
      enforceAudioTrack: false,
      browserExecutable: '/usr/bin/chromium',
      chromiumOptions: {
        disableWebSecurity: true,
      },
      onProgress: ({ progress }) => {
        if (Math.round(progress * 100) % 10 === 0) {
          console.log(`[render] ${Math.round(progress * 100)}%`);
        }
      },
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[render] done in ${elapsed}s — uploading`);

    // ── 10. Upload MP4 ────────────────────────────────────────────────────────
    await r2UploadFile(outKey, outputPath, 'video/mp4');

    // ── 11. Extract + upload poster ───────────────────────────────────────────
    const posterKey = outKey.replace('.mp4', '-poster.jpg');
    const posterPath = join(tmpDir, 'poster.jpg');
    await runFfmpeg(['-ss', '4', '-i', outputPath, '-frames:v', '1', '-q:v', '3', posterPath]);
    await r2UploadFile(posterKey, posterPath, 'image/jpeg');

    // ── 12. Get duration ──────────────────────────────────────────────────────
    const durationS = composition.durationInFrames / composition.fps;

    // ── 13. Notify webhook ────────────────────────────────────────────────────
    const videoUrl = `${process.env.R2_PUBLIC_URL}/${outKey}`;
    const posterUrl = `${process.env.R2_PUBLIC_URL}/${posterKey}`;
    await notifyWebhook({
      eventId,
      status: 'ready',
      video_url: videoUrl,
      poster_url: posterUrl,
      duration_s: durationS,
      clip_count: totalClips,
    });

    console.log(`[render] complete — ${videoUrl}`);

    // Cleanup temp payload JSON from R2 (best effort)
    try {
      await r2.send(new (await import('@aws-sdk/client-s3')).DeleteObjectCommand({ Bucket: BUCKET, Key: payloadKey }));
    } catch {}

  } catch (err) {
    console.error('[render] fatal error:', err);
    try {
      await notifyWebhook({ eventId: payload?.eventId, status: 'error', error_message: err.message });
    } catch {}
    process.exit(1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main();
