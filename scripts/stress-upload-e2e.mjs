// End-to-end upload stress test — the full guest flow:
//   1. POST /api/uploads/presigned  → get R2 PUT URL
//   2. PUT real bytes to R2         → what stress-upload.mjs skips
//   3. POST /api/uploads/complete   → create the DB row, wall sees it
//
// This is the only stress script that proves the whole happy path works
// under concurrency. stress-upload.mjs only covers step 1.
//
// Uploads are PHOTOS (image/jpeg) to avoid triggering Lambda transcoding
// and burning real AWS budget. ~500 KB of synthetic JPEG bytes per upload.
//
// CLEANUP: every test object's key starts with `uploads/<slug>/<ts>-e2e-stress-`,
// so you can list+delete by that prefix in R2 after the run.
//
// Usage: node scripts/stress-upload-e2e.mjs <slug> [concurrency=20] [total=60]
// Optional: BASE_URL env (default https://reelday.ph)

const slug = process.argv[2];
const concurrency = Number(process.argv[3] || 20);
const total = Number(process.argv[4] || 60);
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (!slug) {
  console.error('Usage: node scripts/stress-upload-e2e.mjs <slug> [concurrency] [total]');
  process.exit(1);
}

const presignedUrl = `${base}/api/uploads/presigned`;
const completeUrl  = `${base}/api/uploads/complete`;

// Synthetic ~500 KB JPEG-ish payload. Real JPEG header so R2 + any
// downstream sniffers don't reject it; the rest is filler bytes.
const JPEG_HEADER = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
const FILLER = Buffer.alloc(500 * 1024 - JPEG_HEADER.length - 2, 0x20);
const JPEG_EOI = Buffer.from([0xFF, 0xD9]);
const PAYLOAD = Buffer.concat([JPEG_HEADER, FILLER, JPEG_EOI]);

const stages = {
  presigned: { lat: [], ok: 0, fail: 0, statuses: {} },
  put:       { lat: [], ok: 0, fail: 0, statuses: {} },
  complete:  { lat: [], ok: 0, fail: 0, statuses: {} },
  total:     { lat: [], ok: 0, fail: 0 },
};
let sent = 0;

async function step(stage, fn) {
  const t0 = performance.now();
  try {
    const r = await fn();
    const ms = performance.now() - t0;
    stage.lat.push(ms);
    const code = r?.status ?? 'err';
    stage.statuses[code] = (stage.statuses[code] || 0) + 1;
    if (r?.ok) { stage.ok++; return { ms, response: r }; }
    stage.fail++;
    return { ms, response: r, failed: true };
  } catch (e) {
    const ms = performance.now() - t0;
    stage.lat.push(ms);
    const code = e.code || 'err';
    stage.statuses[code] = (stage.statuses[code] || 0) + 1;
    stage.fail++;
    return { ms, failed: true, error: e };
  }
}

async function oneRun(guestId, n) {
  const t0 = performance.now();
  const filename = `e2e-stress-${n}.jpg`;

  // 1. presigned
  const a = await step(stages.presigned, () => fetch(presignedUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
    body: JSON.stringify({ slug, filename, contentType: 'image/jpeg' }),
  }));
  if (a.failed) { stages.total.fail++; return; }
  const { uploadUrl, fileKey } = await a.response.json();

  // 2. R2 PUT
  const b = await step(stages.put, () => fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: PAYLOAD,
  }));
  if (b.failed) { stages.total.fail++; return; }

  // 3. complete
  const c = await step(stages.complete, () => fetch(completeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
    body: JSON.stringify({
      slug,
      fileKey,
      uploader_name: `e2e-${n}`,
      message: 'stress test',
      file_type: 'photo',
    }),
  }));
  if (c.failed) { stages.total.fail++; return; }

  stages.total.lat.push(performance.now() - t0);
  stages.total.ok++;
}

async function worker(id) {
  const guestId = `e2e-${Date.now()}-${id}`;
  while (sent < total) { const n = ++sent; await oneRun(guestId, n); }
}

function report(name, s) {
  const lat = [...s.lat].sort((a, b) => a - b);
  const pct = p => lat[Math.min(lat.length - 1, Math.floor(lat.length * p / 100))] || 0;
  console.log(`[${name}] ok=${s.ok} fail=${s.fail}` +
    `  p50=${pct(50).toFixed(0)}ms p95=${pct(95).toFixed(0)}ms p99=${pct(99).toFixed(0)}ms max=${pct(100).toFixed(0)}ms`);
  if (s.statuses) console.log(`         status:`, s.statuses);
}

const start = performance.now();
console.log(`End-to-end upload stress against ${base}`);
console.log(`slug=${slug} concurrency=${concurrency} total=${total} payload=${(PAYLOAD.length/1024).toFixed(0)}KB per upload`);
console.log(`total data: ~${(PAYLOAD.length * total / 1024 / 1024).toFixed(1)} MB to R2\n`);

await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const elapsed = (performance.now() - start) / 1000;

console.log(`\ndone in ${elapsed.toFixed(2)}s · throughput=${(total / elapsed).toFixed(1)} uploads/s\n`);
report('presigned', stages.presigned);
report('R2 PUT   ', stages.put);
report('complete ', stages.complete);
console.log();
report('full E2E ', stages.total);

console.log(`\nCleanup: delete R2 objects with key prefix uploads/${slug}/ where filename contains "e2e-stress-"`);
console.log(`Also delete uploads DB rows where uploader_name LIKE 'e2e-%' for event slug ${slug}`);

if (stages.total.fail > 0) process.exitCode = 1;
