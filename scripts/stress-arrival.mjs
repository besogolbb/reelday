// Guest-arrival storm — capacity / "find the knee" test.
//
// Models the real spike that no other stress script captures: the moment the MC
// says "scan the QR code now" and a whole room of phones COLD-LOADS the wall at
// the same instant. Each simulated guest runs the real first-load sequence a
// browser does — GET /api/events/:slug (page data) then GET /api/uploads/:slug
// (the wall) — and we measure the full "time to wall" they'd actually feel.
//
// Unlike the existing scripts (fixed worker pool draining a queue at a known-good
// concurrency), this fires every guest in a wave SIMULTANEOUSLY (Promise.all, no
// pool) and ramps wave size to find where the backend first degrades. That makes
// it a capacity-ceiling test, not a regression check.
//
// Usage: node scripts/stress-arrival.mjs <slug> [waves=100,250,500] [gapMs=4000]
//   waves : comma-list of simultaneous-guest counts, run in order (ramp)
//   gapMs : pause between waves so client TIME_WAIT sockets drain
//
// Optional: BASE_URL env (default https://reelday.ph)
// Example:  node scripts/stress-arrival.mjs cxzv-fe0y 100,250,500,800

const slug = process.argv[2];
const waves = (process.argv[3] || '100,250,500').split(',').map(n => Number(n.trim())).filter(Boolean);
const gapMs = Number(process.argv[4] || 4000);
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (!slug) { console.error('Usage: node scripts/stress-arrival.mjs <slug> [waves=100,250,500] [gapMs=4000]'); process.exit(1); }

const eventUrl = `${base}/api/events/${slug}`;
const wallUrl = `${base}/api/uploads/${slug}`;

function pctOf(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
}

// One guest's real cold first-load: event detail, then wall. Returns the
// component timings and the total wall-arrival latency the guest would feel.
async function guest(guestId) {
  const headers = { accept: 'application/json', 'X-Guest-Id': guestId };
  const out = { ev: 0, wall: 0, total: 0, ok: true, status: null };
  const t0 = performance.now();
  try {
    const e0 = performance.now();
    const re = await fetch(eventUrl, { headers });
    await re.text();
    out.ev = performance.now() - e0;
    if (!re.ok) { out.ok = false; out.status = `ev:${re.status}`; }

    const w0 = performance.now();
    const rw = await fetch(wallUrl, { headers });
    await rw.text();
    out.wall = performance.now() - w0;
    if (!rw.ok) { out.ok = false; out.status = out.status || `wall:${rw.status}`; }
  } catch (err) {
    out.ok = false;
    out.status = err.code || 'err';
  }
  out.total = performance.now() - t0;
  return out;
}

async function runWave(n) {
  const stamp = Date.now();
  const t0 = performance.now();
  // True thundering herd: every guest launched in the same tick, no pool.
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => guest(`arrival-${stamp}-${i}`))
  );
  const elapsed = (performance.now() - t0) / 1000;

  const okR = results.filter(r => r.ok);
  const fail = results.length - okR.length;
  const evL = okR.map(r => r.ev);
  const wallL = okR.map(r => r.wall);
  const totL = okR.map(r => r.total);
  const statuses = {};
  for (const r of results) if (!r.ok) statuses[r.status] = (statuses[r.status] || 0) + 1;

  const fmt = a => `p50 ${pctOf(a, 50).toFixed(0)}ms · p95 ${pctOf(a, 95).toFixed(0)}ms · p99 ${pctOf(a, 99).toFixed(0)}ms · max ${pctOf(a, 100).toFixed(0)}ms`;

  console.log(`\n── Wave: ${n} simultaneous guests ──`);
  console.log(`  drained in ${elapsed.toFixed(2)}s · effective ${(n / elapsed).toFixed(0)} guests/s`);
  console.log(`  ok=${okR.length}  fail=${fail}${fail ? '  ' + JSON.stringify(statuses) : ''}`);
  console.log(`  event detail : ${fmt(evL)}`);
  console.log(`  wall load    : ${fmt(wallL)}`);
  console.log(`  TIME-TO-WALL : ${fmt(totL)}   ← what a guest feels`);

  // Capacity verdict for this wave.
  const p95 = pctOf(totL, 95);
  let verdict = '✅ comfortable';
  if (fail > 0) verdict = `❌ ${fail} failed — ceiling exceeded`;
  else if (p95 > 5000) verdict = '⚠️ p95 > 5s — knee reached, degrading';
  else if (p95 > 3000) verdict = '⚠️ p95 > 3s — getting warm';
  console.log(`  verdict: ${verdict}`);
  return { n, fail, p95 };
}

console.log(`Guest-arrival storm → ${base}`);
console.log(`slug=${slug} · waves=[${waves.join(', ')}] · gap=${gapMs}ms`);
console.log(`Each guest = GET /api/events/${slug} → GET /api/uploads/${slug} (real first-load)`);

const summary = [];
for (let i = 0; i < waves.length; i++) {
  summary.push(await runWave(waves[i]));
  if (i < waves.length - 1) await new Promise(r => setTimeout(r, gapMs));
}

console.log(`\n════ Capacity summary ════`);
for (const s of summary) {
  const tag = s.fail ? `${s.fail} FAIL` : `0 fail · p95 ${s.p95.toFixed(0)}ms`;
  console.log(`  ${String(s.n).padStart(5)} guests → ${tag}`);
}
const clean = summary.filter(s => s.fail === 0 && s.p95 <= 5000).map(s => s.n);
if (clean.length) console.log(`\nLargest clean wave (0 fail, p95 ≤ 5s): ${Math.max(...clean)} simultaneous guests`);
else console.log(`\nNo wave stayed clean — lower the wave sizes or investigate.`);
