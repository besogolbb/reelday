// Sustained-load stress: runs steady traffic for N minutes to detect memory
// leaks, slow connection accumulation, gradual DB pool starvation. Lower
// concurrency than burst tests; longer wall-clock duration.
//
// Usage: node scripts/stress-sustained.mjs <slug> [duration_min=5]

const slug = process.argv[2];
const durationMin = Number(process.argv[3] || 5);
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (!slug) { console.error('Usage: node scripts/stress-sustained.mjs <slug> [duration_min]'); process.exit(1); }
const EMOJIS = ['❤️','😂','🔥','👏','💃','🙏','🥰','✨','🎉'];

const stats = {
  upload:   { ok:0, fail:0, lat:[] },
  reaction: { ok:0, fail:0, lat:[] },
  wall:     { ok:0, fail:0, lat:[] },
};

async function timed(name, fn) {
  const t0 = performance.now();
  try {
    const r = await fn();
    await r.text();
    stats[name].lat.push(performance.now() - t0);
    if (r.ok) stats[name].ok++; else stats[name].fail++;
  } catch { stats[name].fail++; }
}

const end = performance.now() + durationMin * 60_000;
let upN = 0, rxN = 0;

// Steady traffic shape (per-second, modeling moderate event):
//   3.3 uploads/sec  (200/min)
//   8.3 reactions/sec (500/min)
//   0.33 wall polls/sec (every 3s)
async function uploadLoop() {
  while (performance.now() < end) {
    timed('upload', () => fetch(`${base}/api/uploads/presigned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': `sus-up-${upN % 300}` },
      body: JSON.stringify({ slug, filename: `sus-${upN++}.mp4`, contentType: 'video/mp4' }),
    }));
    await new Promise(r => setTimeout(r, 300));
  }
}
async function reactionLoop() {
  while (performance.now() < end) {
    timed('reaction', () => fetch(`${base}/api/reactions/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': `sus-rx-${rxN % 500}` },
      body: JSON.stringify({ emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], guest_name: `Sus${rxN++}` }),
    }));
    await new Promise(r => setTimeout(r, 120));
  }
}
async function wallLoop() {
  while (performance.now() < end) {
    timed('wall', () => fetch(`${base}/api/uploads/${slug}`));
    await new Promise(r => setTimeout(r, 3000));
  }
}

console.log(`Sustained load for ${durationMin} min against ${slug}`);
console.log(`Steady mix: ~3.3 uploads/s · ~8 reactions/s · 1 wall poll every 3s`);
const start = performance.now();

// Run several parallel uploaders/reactors so total RPS matches the comment above.
const work = [];
for (let i = 0; i < 1; i++) work.push(uploadLoop());
for (let i = 0; i < 1; i++) work.push(reactionLoop());
work.push(wallLoop());

// Print a periodic snapshot every 30s so you can watch latency drift.
const tick = setInterval(() => {
  const t = ((performance.now() - start) / 1000).toFixed(0);
  const w = stats.wall.lat.slice(-30).sort((a,b)=>a-b);
  const wp95 = w.length ? w[Math.floor(w.length * 0.95)] : 0;
  const r = stats.reaction.lat.slice(-100).sort((a,b)=>a-b);
  const rp95 = r.length ? r[Math.floor(r.length * 0.95)] : 0;
  const u = stats.upload.lat.slice(-100).sort((a,b)=>a-b);
  const up95 = u.length ? u[Math.floor(u.length * 0.95)] : 0;
  console.log(`[${t}s] up: ok=${stats.upload.ok} fail=${stats.upload.fail} p95=${up95.toFixed(0)}ms · rx: ok=${stats.reaction.ok} fail=${stats.reaction.fail} p95=${rp95.toFixed(0)}ms · wall: ok=${stats.wall.ok} fail=${stats.wall.fail} p95=${wp95.toFixed(0)}ms`);
}, 30_000);

await Promise.all(work);
clearInterval(tick);

function report(name, s) {
  s.lat.sort((a,b) => a - b);
  const pct = p => s.lat[Math.min(s.lat.length - 1, Math.floor(s.lat.length * p / 100))] || 0;
  console.log(`[${name}] ok=${s.ok} fail=${s.fail} p50=${pct(50).toFixed(0)}ms p95=${pct(95).toFixed(0)}ms p99=${pct(99).toFixed(0)}ms max=${pct(100).toFixed(0)}ms`);
}
console.log('\n=== FINAL ===');
report('upload',   stats.upload);
report('reaction', stats.reaction);
report('wall',     stats.wall);
