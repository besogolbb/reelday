/**
 * Trigger an SDE render on Remotion Lambda.
 *
 * Replaces the ECS Fargate path when SDE_RENDERER=lambda. The render is
 * fan-out across N parallel Lambda invocations (framesPerLambda controls N).
 * With AWS account quota=10 we set framesPerLambda=600 so 10 Lambdas cover
 * a ~6000-frame render.
 *
 * Returns { renderId, bucketName } — caller stores these so the poller can
 * track progress and update event_sde when the render finishes.
 *
 * Required env:
 *   REMOTION_LAMBDA_FUNCTION_NAME — output of `npx remotion lambda functions deploy`
 *   REMOTION_LAMBDA_SERVE_URL     — output of `npx remotion lambda sites create ...`
 *   REMOTION_LAMBDA_REGION        — defaults to ap-southeast-1
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — IAM creds with Lambda invoke
 */

import { renderMediaOnLambda } from '@remotion/lambda-client';
import { generateVoiceOver, extractAmbientForTopVideos } from './sdePreflight.js';
import { r2KeyFromUrl } from './sdeRender.js';

const REGION = process.env.REMOTION_LAMBDA_REGION || 'ap-southeast-1';

// Cloudflare Image Resizing — matches wall.html's transform string exactly
// so we hit the existing edge cache from the gallery.
function photoSrc(key, width = 1920) {
  const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
  return `${base}/cdn-cgi/image/width=${width},quality=82,format=auto,fit=scale-down/${key}`;
}

/**
 * Hand a fully-prepared payload (from kickOffRender) to Remotion Lambda.
 * The payload shape is the same one the ECS path used; we transform it into
 * Remotion inputProps here.
 */
export async function triggerLambdaRender(payload) {
  const functionName = process.env.REMOTION_LAMBDA_FUNCTION_NAME;
  const serveUrl     = process.env.REMOTION_LAMBDA_SERVE_URL;
  if (!functionName || !serveUrl) {
    throw new Error('REMOTION_LAMBDA_FUNCTION_NAME and REMOTION_LAMBDA_SERVE_URL must be set');
  }

  // Pre-flight: voice over + ambient. Run in parallel.
  const [voiceoverSrc] = await Promise.all([
    generateVoiceOver({
      eventId: payload.eventId,
      title: payload.title,
      subtitle: payload.subtitle,
    }),
    extractAmbientForTopVideos(payload.clips, payload.eventId), // mutates clips with ambientSrc
  ]);

  // Build composition inputProps. Photos use CDN-resized URLs; videos use
  // the R2 public URL directly (Remotion Lambda will fetch + decode via
  // OffthreadVideo). Cover image gets the same CDN transform.
  const r2Base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
  const clipsWithSrc = payload.clips.map(clip => {
    const isPhoto = clip.type === 'photo';
    return {
      ...clip,
      src: isPhoto ? photoSrc(clip.key) : `${r2Base}/${clip.key}`,
      blurSrc: isPhoto ? photoSrc(clip.key, 480) : undefined,
      posterSrc: !isPhoto && clip.posterKey ? photoSrc(clip.posterKey, 1920) : undefined,
      createdAt: clip.createdAt || new Date().toISOString(),
      reactionCount: clip.reactionCount || 0,
      isPinned: clip.isPinned || false,
      isLandscape: clip.isLandscape || false,
    };
  });

  // Group by chapter (Manila timezone hour) — mirrors the logic in
  // sde-renderer/render.mjs::detectChapters so visual output matches.
  const chapters = detectChapters(clipsWithSrc);

  const heroClipIndex = clipsWithSrc.reduce(
    (best, clip, i) => (clip.reactionCount > clipsWithSrc[best].reactionCount ? i : best),
    0,
  );

  const totalClips = clipsWithSrc.length;
  const totalReactions = clipsWithSrc.reduce((s, c) => s + (c.reactionCount || 0), 0);

  const coverImageSrc = payload.coverImageUrl
    ? (payload.coverImageUrl.startsWith(r2Base + '/')
        ? photoSrc(payload.coverImageUrl.slice(r2Base.length + 1), 1920)
        : payload.coverImageUrl)
    : null;

  const audioSrc = payload.audioKey ? `${r2Base}/${payload.audioKey}` : null;

  const inputProps = {
    chapters,
    totalClips,
    totalReactions,
    heroClipIndex,
    flashCutFrame: 300,
    title: payload.title || null,
    subtitle: payload.subtitle || null,
    endcardText: payload.endcardText || null,
    coverImageSrc,
    audioSrc,
    voiceoverSrc,
    qrCodeDataUrl: null, // generated inside composition is too complex; skip for now
    eventSlug: payload.slug,
  };

  const { renderId, bucketName } = await renderMediaOnLambda({
    region: REGION,
    functionName,
    serveUrl,
    composition: 'SdeComposition',
    inputProps,
    codec: 'h264',
    imageFormat: 'jpeg',
    jpegQuality: 90,
    crf: 28,
    x264Preset: 'veryfast',
    // Two competing constraints with our current AWS limits:
    //   1. Memory cap 3008 MB → each Lambda has ~2 vCPU → ~46 fpm rendering
    //   2. Quota = 10 concurrent → max 9 chunks + 1 main coordinator
    //   3. Lambda hard timeout = 15 min (900s)
    // At 46 fpm, a chunk needs <690 frames to finish in 15 min. With 9
    // chunks of ≤690 frames we cover up to ~6200 frames per render.
    // Setting framesPerLambda=650 gives a small safety margin.
    // Bump this DOWN once memory/concurrency quotas are approved.
    framesPerLambda: 650,
    maxRetries: 1,
    // Each Lambda chunk fetches source videos via Remotion's proxy
    // before frame extraction. Default 28s is too tight for large
    // wedding videos on the first cold-cache fetch. 180s gives slow
    // videos room to land without killing the chunk.
    timeoutInMilliseconds: 180_000,
    privacy: 'public',
    downloadBehavior: { type: 'play-in-browser' },
  });

  console.log(`[sde-lambda] kicked off render ${renderId} in bucket ${bucketName}`);
  return { renderId, bucketName };
}

// Same logic as sde-renderer/render.mjs::detectChapters — keep in sync.
const CHAPTER_RANGES = [
  { label: 'Preparation',              start: 6,  end: 12 },
  { label: 'Ceremony',                 start: 12, end: 15 },
  { label: 'Cocktail Hour',            start: 15, end: 18 },
  { label: 'Reception & Celebration',  start: 18, end: 24 },
];

function detectChapters(clips) {
  const groups = new Map();
  for (const clip of clips) {
    const dt = new Date(clip.createdAt || Date.now());
    const manilaHour = (dt.getUTCHours() + 8) % 24;
    const range = CHAPTER_RANGES.find(r => manilaHour >= r.start && manilaHour < r.end);
    const label = range?.label || 'Celebration';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(clip);
  }
  if (groups.size <= 2) return [{ label: '', clips }];
  const ordered = [];
  for (const { label } of [...CHAPTER_RANGES, { label: 'Celebration' }]) {
    if (groups.has(label)) ordered.push({ label, clips: groups.get(label) });
  }
  return ordered;
}
