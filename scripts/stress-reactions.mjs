// Stress test the reactions write path — guests tapping emoji during a peak
// emotional moment (kiss, vows, cake, dance). High write throughput, similar
// to the live-poll vote pattern.
//
// Usage: node scripts/stress-reactions.mjs <slug> [concurrency=200] [requests=2000]

const slug = process.argv[2];
const concurrency = Number(process.argv[3] || 200);
const total = Number(process.argv[4] || 2000);
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (!slug) { console.error('Usage: node scripts/stress-reactions.mjs <slug> [concurrency] [requests]'); process.exit(1); }
const url = `${base}/api/reactions/${slug}`;
const EMOJIS = ['❤️','😂','🔥','👏','💃','🙏','🥰','✨','🎉','🥹','🌹','💖'];

const lat = [];
const statuses = {};
let ok = 0, fail = 0, sent = 0;

async function one(guestId) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({
        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
        guest_name: `Stress-${guestId.slice(-6)}`,
      }),
    });
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
  const guestId = `stress-rx-${Date.now()}-${id}`;
  while (sent < total) { sent++; await one(guestId); }
}

const start = performance.now();
console.log(`POSTing ${url}\nconcurrency=${concurrency} total=${total}`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const elapsed = (performance.now() - start) / 1000;
lat.sort((a, b) => a - b);
const pct = p => lat[Math.min(lat.length - 1, Math.floor(lat.length * p / 100))] || 0;

console.log(`done in ${elapsed.toFixed(2)}s rps=${(total / elapsed).toFixed(1)}`);
console.log(`ok=${ok} fail=${fail}`);
console.log(`p50=${pct(50).toFixed(0)}ms p95=${pct(95).toFixed(0)}ms p99=${pct(99).toFixed(0)}ms max=${pct(100).toFixed(0)}ms`);
console.log('status:', statuses);
