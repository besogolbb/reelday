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
 *                     WEBHOOK_URL  (→ https://<host>/api/webhooks/sde-ready),
 *                     WEBHOOK_SECRET (shared with backend),
 *                     SDE_FONT_PATH (TTF/OTF for drawtext cards;
 *                       defaults to /opt/fonts/Inter-Bold.ttf — ship
 *                       a font in the layer or zip, else cards are
 *                       skipped (render still succeeds))
 *                     SDE_X264_PRESET ('veryfast' default; set to
 *                       'ultrafast' on 3 GB Lambdas to fit 1080p 68-clip
 *                       reels under the 15-min wall clock)
 *                     SDE_KEN_BURNS ('true' default; set to 'false' on
 *                       3 GB Lambdas — zoompan dominates photo cost
 *                       and is a "nice-to-have" relative to the reel
 *                       itself)
 *
 * Memory tuning: 3008 MB is the AWS new-account default ceiling and is
 * tight for 68-clip 1080p reels — flip both knobs above to ultrafast +
 * no-kenburns. Once Service Quotas grants 10 GB (gives ~6 vCPU), drop
 * the env vars to restore the polished defaults.
 *
 * Invoked async (`InvocationType: 'Event'`) — never sync — by
 * backend/lib/sdeRenderInvoke.js. Idempotent: if `outKey` already
 * exists in R2, skip the work and just notify.
 *
 * Payload fields (all optional except eventId, outKey, clips[]):
 *   - title, subtitle  → drawtext title card (black bg, centered)
 *   - endcardText      → drawtext endcard (black bg, centered)
 *   - titleCardKey, endcardKey → PNG cards (alternate path; text wins
 *                                  if both are provided)
 *   - audioKey         → music bed (R2 key); null = silent reel
 */

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm, writeFile, stat, access } from 'fs/promises';
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
  // drawtext font for the title / endcard text path. The operator must
  // ship a TTF/OTF at this path in the layer or zip; if the file is
  // missing we skip the card rather than failing the whole render (the
  // PNG card path is the alternate route — pass titleCardKey instead).
  SDE_FONT_PATH = '/opt/fonts/Inter-Bold.ttf',
  // Encode knobs — defaults preserve the original "veryfast + Ken Burns"
  // quality profile. On memory-capped Lambdas (3 GB == 2 vCPU) the
  // 1080p encode of 68+ clips overruns the 15-min wall clock; set
  // SDE_X264_PRESET=ultrafast and SDE_KEN_BURNS=false to cut that
  // ~2x and get under the ceiling. Restore to defaults once the
  // Lambda is bumped to 10 GB (6 vCPU) so visual polish comes back.
  SDE_X264_PRESET = 'veryfast',
  SDE_KEN_BURNS   = 'true',
  // Per-clip normalization budget. The Curator caps the total at 240 s
  // (80 clips × 3 s ceiling), so an individual normalize is bounded;
  // this is a defense-in-depth limit, not the primary cap.
  MAX_CLIP_INPUT_BYTES = '524288000', // 500 MB
} = process.env;

const KEN_BURNS_ENABLED = SDE_KEN_BURNS !== 'false';

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

// Blur-fill background trick — the canonical way to handle vertical
// phone content inside a 16:9 reel without black letterbox bars. Splits
// the source into two streams: one is scaled to FILL the frame (with
// excess cropped) and heavily blurred; the other is scaled to FIT
// (preserving aspect ratio); the fit version overlays centered on top
// of the blurred fill. Same approach Instagram/Reels uses. Cost is
// ~10-15% extra per-clip encode vs. plain `pad=color=black`.
const BLUR_FILL_GRAPH = (
  `[0:v]split=2[bg][fg];` +
  `[bg]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},boxblur=30:2[blurred];` +
  `[fg]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease[scaled];` +
  `[blurred][scaled]overlay=(W-w)/2:(H-h)/2,fps=${TARGET_FPS},format=yuv420p,setsar=1[outv]`
);

function safeCardName(i) {
  return `clip_${String(i).padStart(4, '0')}.mp4`;
}

async function normalizePhoto(srcPath, outPath, durSec, { kenBurns = true } = {}) {
  // zoompan operates on frames; d = durSec * fps so the zoom finishes
  // exactly when the clip ends. Honor BOTH the per-call flag and the
  // module-level env switch — env wins (gives an operator escape hatch
  // when the Lambda is CPU-constrained).
  const frames = Math.max(1, Math.round(durSec * TARGET_FPS));
  const useKenBurns = kenBurns && KEN_BURNS_ENABLED;

  // Two paths:
  //  - kenBurns: upscale + slow zoompan (the polished default; OFF on
  //    3 GB Lambdas via env). Still uses pad=color=black on the upscale
  //    stage because zoompan reads the padded frame; revisit when the
  //    10 GB quota lands and we can afford the blur on the larger frame.
  //  - flat: blur-fill background so portrait phone photos don't get
  //    letterbox bars. Defined as BLUR_FILL_GRAPH at module top.
  let filterArgs;
  if (useKenBurns) {
    const vf = [
      `scale=2400:1350:force_original_aspect_ratio=decrease`,
      `pad=2400:1350:(ow-iw)/2:(oh-ih)/2:color=black`,
      `zoompan=z='min(zoom+0.0015\\,1.15)':d=${frames}:s=${TARGET_W}x${TARGET_H}:fps=${TARGET_FPS}`,
      `fps=${TARGET_FPS}`, `format=yuv420p`, `setsar=1`,
    ].join(',');
    filterArgs = ['-vf', vf];
  } else {
    filterArgs = ['-filter_complex', BLUR_FILL_GRAPH, '-map', '[outv]', '-map', '1:a'];
  }

  await runFfmpeg([
    '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    // -fflags +shortest + -max_interleave_delta are the canonical
    // workaround for filter_complex + anullsrc + -shortest not always
    // trimming the audio cleanly to the video end. Without these, the
    // brick mp4 can have its audio track outlast its video track,
    // which concat-demuxer renders as a held-last-frame at clip end.
    '-fflags', '+shortest', '-max_interleave_delta', '100M',
    '-loop', '1', '-t', String(durSec),
    '-i', srcPath,
    // Anullsrc with explicit d= so both streams are FINITE — lets
    // -shortest reliably pick min(video, audio).
    '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=mono:d=${durSec}`,
    ...filterArgs,
    '-shortest',
    '-c:v', 'libx264', '-preset', SDE_X264_PRESET, '-crf', '22',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
    '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1',
    '-r', String(TARGET_FPS),
    '-movflags', '+faststart',
    outPath,
  ], { label: `normalize-photo` });
}

// Render a black-background card with up to two centered text lines
// (title + subtitle, or just endcard line). Generated entirely by FFmpeg
// from `color=` + `drawtext` so there's no PNG generation step in the
// backend. Text is passed via `textfile=` (not `text=`) so we don't have
// to escape user input — drawtext reads the literal file bytes.
//
// Returns the output path on success, or null if the card can't be
// rendered for any reason (missing font file, FFmpeg layer built
// without `--enable-libfreetype` so `drawtext` isn't compiled in, etc).
// Caller treats null as "skip this card" — the reel is the product, the
// card is polish, so a card failure must NEVER fail the whole render.
async function renderTextCard(workdir, outPath, lines, durSec) {
  const fontExists = await access(SDE_FONT_PATH).then(() => true).catch(() => false);
  if (!fontExists) {
    console.warn(`[sde] drawtext font not found at ${SDE_FONT_PATH}; skipping text card`);
    return null;
  }

  // Build per-line drawtext filters. Y positions are offset from center
  // so two lines straddle the middle; a single line sits dead-center.
  const drawTexts = [];
  const cleanLines = lines
    .map(l => ({ ...l, text: String(l?.text || '').trim() }))
    .filter(l => l.text);
  if (!cleanLines.length) return null;

  // Write each line to its own file so drawtext reads literal bytes
  // (avoids escaping rules for `:` `'` `\` in arbitrary user input).
  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    const textPath = join(workdir, `card_text_${i}.txt`);
    await writeFile(textPath, line.text);

    const fontsize = line.fontsize || 72;
    const color    = line.color    || 'white';
    // Two-line layout: title above center, subtitle below. Single line:
    // dead center. The `(h-th)/2` term centers each label vertically on
    // its own glyph height, then we shift by `yOffset` for stacking.
    const yOffset  = cleanLines.length === 1 ? 0
                   : (i === 0 ? -fontsize : Math.round(fontsize * 0.9));
    const ySign    = yOffset >= 0 ? '+' : '-';
    const yMag     = Math.abs(yOffset);

    drawTexts.push(
      `drawtext=fontfile='${SDE_FONT_PATH}':textfile='${textPath}':` +
      `fontsize=${fontsize}:fontcolor=${color}:` +
      `x=(w-text_w)/2:y=(h-text_h)/2${ySign}${yMag}`,
    );
  }

  const vf = drawTexts.join(',') + `,format=yuv420p,setsar=1`;

  try {
    await runFfmpeg([
      '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=black:s=${TARGET_W}x${TARGET_H}:d=${durSec}:r=${TARGET_FPS}`,
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
      '-vf', vf,
      '-shortest',
      '-c:v', 'libx264', '-preset', SDE_X264_PRESET, '-crf', '22',
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
      '-c:a', 'aac', '-b:a', '64k', '-ar', '48000', '-ac', '1',
      '-r', String(TARGET_FPS),
      '-movflags', '+faststart',
      outPath,
    ], { label: 'render-text-card' });
  } catch (err) {
    // Most common cause in practice: the FFmpeg layer was built without
    // libfreetype, so the `drawtext` filter isn't registered. Swap to a
    // freetype-enabled layer to get cards back. Until then, the reel
    // still renders — just without the title/endcard frames.
    const oneLine = String(err.message || err).split('\n')[0];
    console.warn(`[sde] text card render failed (${oneLine}); skipping card`);
    return null;
  }

  return outPath;
}

async function normalizeVideo(srcPath, outPath, durSec) {
  // Same blur-fill story as the photo flat path — portrait phone videos
  // are common at events and look terrible letterboxed. The original
  // guest audio is dropped (basic render is music-only; ducking parked
  // for Batch 3); we map the silent anullsrc track instead.
  //
  // Important: short guest clips (often 2-4 s, less than the 5 s
  // durSec cap) used to produce bricks where the audio track outran
  // the video, because -shortest + filter_complex + infinite anullsrc
  // can fail to trim audio at video EOF. Symptom: video freezes on the
  // last frame at every video-clip boundary while music keeps playing.
  // Fix: anullsrc=d=durSec makes both streams finite, and the
  // -fflags +shortest + -max_interleave_delta flags are the canonical
  // workaround for the -shortest-with-filter_complex bug.
  await runFfmpeg([
    '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-fflags', '+shortest', '-max_interleave_delta', '100M',
    '-t', String(durSec),
    '-i', srcPath,
    '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=mono:d=${durSec}`,
    '-filter_complex', BLUR_FILL_GRAPH,
    '-map', '[outv]', '-map', '1:a',
    '-shortest',
    '-c:v', 'libx264', '-preset', SDE_X264_PRESET, '-crf', '22',
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

  // Title card: text-rendered (drawtext) takes precedence over a
  // pre-rendered PNG. Either path is optional — if neither is provided
  // the reel just opens on the first guest moment.
  const wantsTitleText = payload.title || payload.subtitle;
  if (wantsTitleText) {
    const out = join(workdir, safeCardName(0));
    const rendered = await renderTextCard(workdir, out, [
      { text: payload.title,    fontsize: 84, color: 'white'    },
      { text: payload.subtitle, fontsize: 36, color: 'white@0.7' },
    ], 2.5);
    if (rendered) normalizedPaths.push(out);
  } else if (localPaths.titleCard) {
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

  if (payload.endcardText) {
    const out = join(workdir, safeCardName(payload.clips.length + 1));
    const rendered = await renderTextCard(workdir, out, [
      { text: payload.endcardText, fontsize: 56, color: 'white' },
    ], 2.5);
    if (rendered) normalizedPaths.push(out);
  } else if (localPaths.endcard) {
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
    title = null,
    subtitle = null,
    endcardText = null,
    outKey,
  } = payload;

  // Hard payload validation. Any malformed invoke is a backend bug,
  // not a render error — fail loudly so it shows up in CloudWatch.
  if (!eventId)              throw new Error('Missing eventId');
  if (!outKey)               throw new Error('Missing outKey');
  if (!Array.isArray(clips)) throw new Error('Missing clips[]');
  if (clips.length === 0)    throw new Error('clips[] is empty');

  const hasTitleCard   = !!(title || subtitle || titleCardKey);
  const hasEndcard     = !!(endcardText || endcardKey);
  console.log(`[sde] start event=${eventId} slug=${slug} clips=${clips.length} ` +
              `audio=${!!audioKey} title=${hasTitleCard} endcard=${hasEndcard} out=${outKey}`);

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
        + (hasTitleCard ? 2.5 : 0)
        + (hasEndcard   ? 2.5 : 0);
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

    // 8. AWAIT the success notify. Originally fire-and-forget (to keep
    //    Lambda billable duration tight) but with callbackWaitsForEmpty
    //    EventLoop=false the runtime can freeze before the fetch even
    //    leaves the box — observed in production as a "render succeeded
    //    but DB still shows the previous render" bug. The 5 s timeout
    //    bounds the worst case; webhook handler is sub-100 ms in normal
    //    operation, so this adds ~50-100 ms to typical billable duration.
    await notifyWebhook({
      status:     'ready',
      eventId, slug,
      videoKey:   outKey,
      posterKey,
      durationS:  Math.round(durationS),
      clipCount:  clips.length,
      cached:     false,
    }, { timeoutMs: 5000 });

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
