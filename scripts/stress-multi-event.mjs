// Multi-event capacity — "how many live receptions at once?"
//
// Every other script loads ONE event (or, in cross-event, one hot + one quiet
// to test isolation). This one drives a realistic guest mix on N DISTINCT events
// ALL fully hot at the same time, to find how many concurrent live receptions
// the shared 50-connection Postgres pool + 2-vCPU box holds before any event's
// wall degrades.
//
// Each virtual guest, per event, runs a real reception loop:
//   - poll the wall every ~3 s (cached read)
//   - drop a reaction every ~6 s (write — the pool-hungry path)
//   - kick off an upload every ~25 s (presigned only; no R2 PUT, so this stays
//     a backend test and doesn't saturate the test laptop's uplink)
// with jitter so the events don't move in lockstep.
//
// Usage: node scripts/stress-multi-event.mjs <slugA,slugB,...> [guestsPerEvent=40] [durationS=30]
// Optional: BASE_URL env (default https://reelday.ph)
// Example:  node scripts/stress-multi-event.mjs cxzv-fe0y,scarlette-skye-td9n 60 30

const slugs = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);
const guestsPerEvent = Number(process.argv[3] || 40);
const durationS = Number(process.argv[4] || 30);
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (slugs.length < 1) { console.error('Usage: node scripts/stress-multi-event.mjs <slugA,slugB,...> [guestsPerEvent=40] [durationS=30]'); process.exit(1); }

const EMOJIS = ['❤️','😂','🔥','👏','💃','🙏','🥰','✨','🎉','🥹'];
const jitter = ms => ms * (0.6 + Math.random() * 0.8); // ±40%

// Per-event stat buckets.
const stats = Object.fromEntries(slugs.map(s => [s, {
  wall: { lat: [], ok: 0, fail: 0 },
  rx:   { lat: [], ok: 0, fail: 0 },
  up:   { lat: [], ok: 0, fail: 0 },
  statuses: {},
}]));

function rec(bucket, ms, ok, status, ev) {
  bucket.lat.push(ms);
  if (ok) bucket.ok++; else bucket.fail++;
  if (status) stats[ev].statuses[status] = (stats[ev].statuses[status] || 0) + 1;
}

async function wallPoll(slug, guestId) {
  const b = stats[slug].wall, t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/uploads/${slug}`, { headers: { 'X-Guest-Id': guestId, 'Accept-Encoding': 'gzip' } });
    await r.text(); rec(b, performance.now() - t0, r.ok, r.ok ? null : `wall:${r.status}`, slug);
  } catch (e) { rec(b, performance.now() - t0, false, e.code || 'err', slug); }
}

async function react(slug, guestId) {
  const b = stats[slug].rx, t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/reactions/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({ emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], guest_name: `Guest-${guestId.slice(-5)}` }),
    });
    await r.text(); rec(b, performance.now() - t0, r.ok, r.ok ? null : `rx:${r.status}`, slug);
  } catch (e) { rec(b, performance.now() - t0, false, e.code || 'err', slug); }
}

async function uploadKickoff(slug, guestId) {
  const b = stats[slug].up, t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/uploads/presigned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({ slug, filename: `multi-${guestId}.jpg`, contentType: 'image/jpeg', guest_name: `Guest-${guestId.slice(-5)}` }),
    });
    await r.text(); rec(b, performance.now() - t0, r.ok, r.ok ? null : `up:${r.status}`, slug);
  } catch (e) { rec(b, performance.now() - t0, false, e.code || 'err', slug); }
}

const deadline = () => performance.now() < end;
let end;

async function guest(slug, i) {
  const guestId = `multi-${Date.now()}-${slug}-${i}`;
  let n = 0;
  // Stagger start so guests don't fire in lockstep.
  await new Promise(r => setTimeout(r, Math.random() * 3000));
  while (deadline()) {
    await wallPoll(slug, guestId);
    if (n % 2 === 0) await react(slug, guestId);          // ~every other loop
    if (n % 8 === 0) await uploadKickoff(slug, guestId);   // ~every 8th loop
    n++;
    await new Promise(r => setTimeout(r, jitter(3000)));
  }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
}

console.log(`Multi-event capacity → ${base}`);
console.log(`events=${slugs.length} [${slugs.join(', ')}] · ${guestsPerEvent} guests/event · ${durationS}s`);
console.log(`Each guest: wall poll ~3s · reaction ~6s · upload kickoff ~25s (all events hot at once)\n`);

end = performance.now() + durationS * 1000;
const ticker = setInterval(() => {
  const el = (durationS - (end - performance.now()) / 1000).toFixed(0);
  const line = slugs.map(s => {
    const w = stats[s].wall;
    return `${s.slice(0, 10)} wall ok=${w.ok} p95=${pct(w.lat, 95) | 0}ms`;
  }).join(' | ');
  process.stdout.write(`\r[${el}s] ${line}   `);
}, 2000);

await Promise.all(slugs.flatMap(s => Array.from({ length: guestsPerEvent }, (_, i) => guest(s, i))));
clearInterval(ticker);
console.log('\n');

console.log('═══ PER-EVENT RESULTS ═══');
let totalFail = 0, worstWallP95 = 0;
for (const s of slugs) {
  const { wall, rx, up, statuses } = stats[s];
  const fails = wall.fail + rx.fail + up.fail;
  totalFail += fails;
  worstWallP95 = Math.max(worstWallP95, pct(wall.lat, 95));
  console.log(`\n▶ ${s}`);
  console.log(`  wall  ok=${wall.ok} fail=${wall.fail}  p50=${pct(wall.lat,50)|0} p95=${pct(wall.lat,95)|0} p99=${pct(wall.lat,99)|0}ms`);
  console.log(`  rx    ok=${rx.ok} fail=${rx.fail}  p50=${pct(rx.lat,50)|0} p95=${pct(rx.lat,95)|0} p99=${pct(rx.lat,99)|0}ms`);
  console.log(`  up    ok=${up.ok} fail=${up.fail}  p50=${pct(up.lat,50)|0} p95=${pct(up.lat,95)|0} p99=${pct(up.lat,99)|0}ms`);
  if (Object.keys(statuses).length) console.log(`  non-200:`, statuses);
}

console.log(`\n═══ VERDICT ═══`);
console.log(`  ${slugs.length} simultaneous hot events · ${slugs.length * guestsPerEvent} total guests`);
console.log(`  total failures: ${totalFail} · worst wall p95: ${worstWallP95 | 0}ms`);
if (totalFail === 0 && worstWallP95 < 1000) console.log(`  ✅ all events held — wall p95 < 1s, 0 fail (pool isolation intact across ${slugs.length} live events)`);
else if (totalFail === 0) console.log(`  ⚠️ 0 fail but worst wall p95 ${worstWallP95 | 0}ms > 1s — getting warm; add events to find the ceiling (or it's laptop-pipe noise — re-run local)`);
else console.log(`  ❌ ${totalFail} failures — a ceiling was crossed; check non-200 statuses above`);
