// Stress test the wall API endpoint, simulating N concurrent guests.
// Each worker sends a unique X-Guest-Id so the per-device rate limiter (240/min)
// treats them as separate devices — closer to real-world load shape.
//
// Usage: node scripts/stress-wall.mjs <slug> [concurrency=50] [requests=500]
// Optional: BASE_URL env (default https://reelday.ph)

const slug = process.argv[2];
const concurrency = Number(process.argv[3] || 50);
const total = Number(process.argv[4] || 500);
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (!slug) { console.error('Usage: node scripts/stress-wall.mjs <slug> [concurrency] [requests]'); process.exit(1); }
const url = `${base}/api/uploads/${slug}`;

const lat = [];
const statuses = {};
let ok = 0, fail = 0, sent = 0;

async function one(guestId) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', 'X-Guest-Id': guestId } });
    await r.text();
    lat.push(performance.now() - t0);
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.ok) ok++; else fail++;
  } catch (e) {
    statuses[e.code || 'err'] = (statuses[e.code || 'err'] || 0) + 1;
    fail++;
  }
}

async function worker(id) {
  const guestId = `stress-${Date.now()}-${id}`;
  while (sent < total) { sent++; await one(guestId); }
}

const start = performance.now();
console.log(`Hitting ${url}\nconcurrency=${concurrency} total=${total}`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const elapsed = (performance.now() - start) / 1000;
lat.sort((a, b) => a - b);
const pct = p => lat[Math.min(lat.length - 1, Math.floor(lat.length * p / 100))] || 0;

console.log(`done in ${elapsed.toFixed(2)}s rps=${(total / elapsed).toFixed(1)}`);
console.log(`ok=${ok} fail=${fail}`);
console.log(`p50=${pct(50).toFixed(0)}ms p95=${pct(95).toFixed(0)}ms p99=${pct(99).toFixed(0)}ms max=${pct(100).toFixed(0)}ms`);
console.log('status:', statuses);
