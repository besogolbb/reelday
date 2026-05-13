// Stress test the realistic peak-event mix all at once: simultaneous uploads,
// reactions raining in, and the wall display polling. Runs for ~30s.
//
// Usage: node scripts/stress-mixed.mjs <slug> [uploads=600] [reactions=1500] [duration_s=30]

const slug = process.argv[2];
const uploads = Number(process.argv[3] || 600);
const reactionsTotal = Number(process.argv[4] || 1500);
const durationS = Number(process.argv[5] || 30);
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (!slug) { console.error('Usage: node scripts/stress-mixed.mjs <slug> [uploads] [reactions] [duration_s]'); process.exit(1); }
const EMOJIS = ['❤️','😂','🔥','👏','💃','🙏','🥰','✨','🎉'];

const stats = { uploads: { ok:0, fail:0, lat:[], statuses:{} }, reactions: { ok:0, fail:0, lat:[], statuses:{} }, walls: { ok:0, fail:0, lat:[], statuses:{} } };

async function postPresigned(guestId, n) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/uploads/presigned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({ slug, filename: `stress-${n}.mp4`, contentType: 'video/mp4' }),
    });
    await r.text();
    stats.uploads.lat.push(performance.now() - t0);
    stats.uploads.statuses[r.status] = (stats.uploads.statuses[r.status] || 0) + 1;
    if (r.ok) stats.uploads.ok++; else stats.uploads.fail++;
  } catch (e) {
    stats.uploads.statuses[e.code || 'err'] = (stats.uploads.statuses[e.code || 'err'] || 0) + 1;
    stats.uploads.fail++;
  }
}

async function postReaction(guestId) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/reactions/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({ emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], guest_name: `Stress-${guestId.slice(-6)}` }),
    });
    await r.text();
    stats.reactions.lat.push(performance.now() - t0);
    stats.reactions.statuses[r.status] = (stats.reactions.statuses[r.status] || 0) + 1;
    if (r.ok) stats.reactions.ok++; else stats.reactions.fail++;
  } catch (e) {
    stats.reactions.statuses[e.code || 'err'] = (stats.reactions.statuses[e.code || 'err'] || 0) + 1;
    stats.reactions.fail++;
  }
}

async function getWall(guestId) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/uploads/${slug}`, { headers: { 'X-Guest-Id': guestId } });
    await r.text();
    stats.walls.lat.push(performance.now() - t0);
    stats.walls.statuses[r.status] = (stats.walls.statuses[r.status] || 0) + 1;
    if (r.ok) stats.walls.ok++; else stats.walls.fail++;
  } catch (e) {
    stats.walls.statuses[e.code || 'err'] = (stats.walls.statuses[e.code || 'err'] || 0) + 1;
    stats.walls.fail++;
  }
}

console.log(`Mixed peak-event load against ${slug}\n  uploads burst: ${uploads}\n  reactions over ${durationS}s: ${reactionsTotal}\n  wall polling every 3s for ${durationS}s\n`);
const start = performance.now();

// (a) Upload burst — fire all N upload kickoffs at once at t=0.
const uploadPromise = Promise.all(Array.from({ length: uploads }, (_, i) => postPresigned(`mix-up-${i}`, i)));

// (b) Reactions — spread N reactions evenly across durationS, with up to 100 in flight at once.
const reactionPromise = (async () => {
  const stagger = (durationS * 1000) / reactionsTotal;
  const inflight = new Set();
  for (let i = 0; i < reactionsTotal; i++) {
    while (inflight.size >= 100) await Promise.race(inflight);
    const p = postReaction(`mix-rx-${i % 200}`).finally(() => inflight.delete(p));
    inflight.add(p);
    if (stagger > 0.2) await new Promise(r => setTimeout(r, stagger));
  }
  await Promise.all(inflight);
})();

// (c) Wall polling — single host wall display, every 3s.
const wallPromise = (async () => {
  const end = performance.now() + durationS * 1000;
  while (performance.now() < end) {
    await getWall('mix-wall-host');
    await new Promise(r => setTimeout(r, 3000));
  }
})();

await Promise.all([uploadPromise, reactionPromise, wallPromise]);
const elapsed = (performance.now() - start) / 1000;

function report(name, s) {
  s.lat.sort((a,b) => a - b);
  const pct = p => s.lat[Math.min(s.lat.length - 1, Math.floor(s.lat.length * p / 100))] || 0;
  console.log(`\n[${name}] ok=${s.ok} fail=${s.fail}`);
  console.log(`  p50=${pct(50).toFixed(0)}ms p95=${pct(95).toFixed(0)}ms p99=${pct(99).toFixed(0)}ms max=${pct(100).toFixed(0)}ms`);
  console.log(`  status:`, s.statuses);
}

console.log(`\nTotal elapsed: ${elapsed.toFixed(2)}s`);
report('uploads',   stats.uploads);
report('reactions', stats.reactions);
report('wall poll', stats.walls);
