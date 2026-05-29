// Video-transcode saturation — the real "how fast do guest clips appear?" test.
//
// Guest video uploads do NOT transcode in-process. /uploads/complete enqueues to
// an SQS FIFO whose MessageGroupId = the EVENT ID (awsLambdaService.js), and an
// SQS FIFO processes one message per group at a time. So within a single event,
// transcodes are SERIALIZED — clip N waits behind clips 1..N-1. The "10
// concurrent" Lambda cap is cross-event parallelism, not within an event.
//
// This uploads N real video clips to ONE event near-simultaneously, then polls
// each clip's video_status until it flips processing -> ready, timing the
// queue-drain. A roughly linear time-to-ready vs clip-rank curve = serialization
// confirmed; the slope ≈ per-clip Lambda wall-clock.
//
// SAFETY: transcode runs on AWS Lambda (Singapore), NOT the prod VPS — this does
// not peg the production box. But it DOES write real video rows + R2 objects to
// the target event's wall and triggers real (small-cost) Lambda invocations.
// USE A TEST EVENT (test-payment / cxzv-fe0y), never a real customer event.
//
// Usage: node scripts/stress-transcode.mjs <slug> [count=12] [maxWaitS=300] [video=reference/dancinglola.mp4]
// Optional: BASE_URL env (default https://reelday.ph)
//
// CLEANUP: rows have uploader_name LIKE 'transcode-stress-%'; R2 keys live under
// uploads/<slug>/ containing 'transcode-stress-'. Delete both after the run.

import { readFile } from 'node:fs/promises';

const slug = process.argv[2];
const count = Number(process.argv[3] || 12);
const maxWaitS = Number(process.argv[4] || 300);
const videoPath = process.argv[5] || 'reference/dancinglola.mp4';
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (!slug) { console.error('Usage: node scripts/stress-transcode.mjs <slug> [count=12] [maxWaitS=300] [video=path]'); process.exit(1); }

const bytes = await readFile(videoPath);
console.log(`Video-transcode saturation → ${base}`);
console.log(`slug=${slug} · ${count} clips · ${(bytes.length / 1024 / 1024).toFixed(2)} MB each · max wait ${maxWaitS}s`);
console.log(`Each clip: presigned → R2 PUT (real mp4) → complete(file_type=video) → poll video_status\n`);

// ── Phase 1: enqueue all N video uploads near-simultaneously ──
async function uploadOne(i) {
  const filename = `transcode-stress-${Date.now()}-${i}.mp4`;
  const name = `transcode-stress-${i}`;
  try {
    const pre = await fetch(`${base}/api/uploads/presigned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': name },
      body: JSON.stringify({ slug, filename, contentType: 'video/mp4' }),
    });
    if (!pre.ok) return { i, err: `presigned:${pre.status}` };
    const { uploadUrl, fileKey } = await pre.json();

    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: bytes });
    if (!put.ok) return { i, err: `put:${put.status}` };

    const tEnqueue = performance.now();
    const comp = await fetch(`${base}/api/uploads/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': name },
      body: JSON.stringify({ slug, fileKey, uploader_name: name, message: 'transcode stress', file_type: 'video' }),
    });
    if (!comp.ok) return { i, err: `complete:${comp.status}` };
    const body = await comp.json();
    const id = body?.upload?.id;
    return { i, id, name, completeMs: performance.now() - tEnqueue, enqueuedAt: performance.now() };
  } catch (e) { return { i, err: e.code || 'err' }; }
}

const t0 = performance.now();
const uploads = await Promise.all(Array.from({ length: count }, (_, i) => uploadOne(i)));
const enqueueElapsed = (performance.now() - t0) / 1000;

const good = uploads.filter(u => u.id);
const bad = uploads.filter(u => u.err);
const completeLats = good.map(u => u.completeMs).sort((a, b) => a - b);
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p / 100))] : 0;

console.log(`Enqueued ${good.length}/${count} in ${enqueueElapsed.toFixed(1)}s` + (bad.length ? ` (${bad.length} failed: ${JSON.stringify(bad.map(b => b.err))})` : ''));
console.log(`complete() latency (fire-and-forget enqueue): p50 ${pct(completeLats,50)|0}ms · p95 ${pct(completeLats,95)|0}ms · max ${pct(completeLats,100)|0}ms\n`);
if (!good.length) { console.error('No clips enqueued — aborting.'); process.exit(1); }

// ── Phase 2: poll the wall, time each clip's processing -> ready flip ──
const byId = new Map(good.map(u => [u.id, u]));
const readyAt = new Map(); // id -> seconds since its enqueue

// The wall response shape may nest the array; find the array of upload-ish rows.
function extractUploads(json) {
  if (Array.isArray(json)) return json;
  for (const k of ['uploads', 'items', 'data']) if (Array.isArray(json?.[k])) return json[k];
  for (const v of Object.values(json || {})) if (Array.isArray(v) && v[0] && 'id' in v[0]) return v;
  return [];
}

const pollEnd = performance.now() + maxWaitS * 1000;
process.stdout.write('Polling video_status');
while (performance.now() < pollEnd && readyAt.size < good.length) {
  await new Promise(r => setTimeout(r, 4000));
  try {
    const r = await fetch(`${base}/api/uploads/${slug}`, { headers: { 'X-Guest-Id': 'transcode-poll' } });
    const rows = extractUploads(await r.json());
    for (const row of rows) {
      if (byId.has(row.id) && !readyAt.has(row.id)) {
        const isReady = row.video_status === 'ready' || !!row.web_url || !!row.compressed_key;
        if (isReady) readyAt.set(row.id, (performance.now() - byId.get(row.id).enqueuedAt) / 1000);
      }
    }
  } catch { /* transient — keep polling */ }
  process.stdout.write(`\rPolling video_status … ${readyAt.size}/${good.length} ready (${((performance.now() - t0) / 1000).toFixed(0)}s elapsed)   `);
}
console.log('\n');

// ── Report: the queue-drain curve ──
const times = [...readyAt.values()].sort((a, b) => a - b);
const stillProcessing = good.length - readyAt.size;

console.log('═══ TRANSCODE DRAIN CURVE (time from enqueue → ready) ═══');
console.log('  rank │ seconds-to-ready');
times.forEach((s, idx) => {
  const bar = '█'.repeat(Math.min(50, Math.round(s / Math.max(1, times[times.length - 1]) * 50)));
  console.log(`  ${String(idx + 1).padStart(4)} │ ${s.toFixed(0).padStart(4)}s ${bar}`);
});
if (stillProcessing) console.log(`  ${stillProcessing} clip(s) STILL PROCESSING after ${maxWaitS}s`);

console.log('\n═══ VERDICT ═══');
console.log(`  ${good.length} clips to one event · ${readyAt.size} ready · ${stillProcessing} still queued at ${maxWaitS}s cutoff`);
if (times.length >= 2) {
  const first = times[0], last = times[times.length - 1];
  const slope = (last - first) / (times.length - 1);
  const POLL_S = 4; // poll interval — the measurement floor
  console.log(`  first ready ${first.toFixed(0)}s · last ready ${last.toFixed(0)}s · median ${pct(times,50).toFixed(0)}s`);
  console.log(`  ≈${slope.toFixed(1)}s added per clip in rank order`);
  // Serial vs parallel is only distinguishable when per-clip transcode time
  // is well above the poll interval. A rank-ordered monotonic climb is the
  // serialization signature; true parallelism clusters all clips within one
  // transcode-time. With a tiny/fast clip the steps collapse toward the poll
  // floor and the two are indistinguishable — say so rather than guess.
  if (slope <= POLL_S * 1.5) {
    console.log(`  ⚠ slope (~${slope.toFixed(1)}s) is at the ${POLL_S}s poll floor — cannot distinguish fast-serial from parallel.`);
    console.log(`    Re-run with a realistic 15–30s guest clip (per-transcode 20–60s ≫ poll) to expose the true per-event FIFO tail.`);
  } else {
    console.log(`  → ${slope.toFixed(0)}s/clip ≫ poll floor and rank-ordered ⇒ per-event FIFO serialization: clip N waits behind 1..N-1.`);
    console.log(`    Extrapolation: 40-clip event ≈ ${(first + slope * 39).toFixed(0)}s (~${((first + slope * 39) / 60).toFixed(0)} min) for the last guest's video. SCALE BY YOUR REAL CLIP SIZE.`);
  }
}
console.log(`\nCleanup: DELETE uploads WHERE uploader_name LIKE 'transcode-stress-%' (slug ${slug}); drop R2 keys under uploads/${slug}/ containing 'transcode-stress-'.`);
