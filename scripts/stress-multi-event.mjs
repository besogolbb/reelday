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
const REQ_TIMEOUT_MS = 15000; // a guest waiting >15s = a failed experience; also stops one
                              // wedged socket from hanging the final aggregate report.
const tfetch = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });

// Per-event stat buckets.
const stats = Object.fromEntries(slugs.map(s => [s, {
  wall: { lat: [], ok: 0, fail: 0, rejected: 0 },
  rx:   { lat: [], ok: 0, fail: 0, rejected: 0 },
  up:   { lat: [], ok: 0, fail: 0, rejected: 0 },
  statuses: {},
}]));

// Classify a response. A 4xx is the APP correctly rejecting (closed gallery,
// rate limit, gating) — that is policy working, NOT a capacity ceiling, so it
// must not count as a failure. Only 5xx and transport errors (status=null) are
// real failures. 2xx is ok.
function rec(bucket, ms, status, ev, label) {
  bucket.lat.push(ms);
  if (status && status >= 200 && status < 300) bucket.ok++;
  else if (status && status >= 400 && status < 500) bucket.rejected++;
  else bucket.fail++; // 5xx or transport error
  if (!status || status < 200 || status >= 300) {
    const key = `${label}:${status || 'err'}`;
    stats[ev].statuses[key] = (stats[ev].statuses[key] || 0) + 1;
  }
}

async function wallPoll(slug, guestId) {
  const b = stats[slug].wall, t0 = performance.now();
  try {
    const r = await tfetch(`${base}/api/uploads/${slug}`, { headers: { 'X-Guest-Id': guestId, 'Accept-Encoding': 'gzip' } });
    await r.text(); rec(b, performance.now() - t0, r.status, slug, 'wall');
  } catch { rec(b, performance.now() - t0, null, slug, 'wall'); }
}

async function react(slug, guestId) {
  const b = stats[slug].rx, t0 = performance.now();
  try {
    const r = await tfetch(`${base}/api/reactions/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({ emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], guest_name: `Guest-${guestId.slice(-5)}` }),
    });
    await r.text(); rec(b, performance.now() - t0, r.status, slug, 'rx');
  } catch { rec(b, performance.now() - t0, null, slug, 'rx'); }
}

async function uploadKickoff(slug, guestId) {
  const b = stats[slug].up, t0 = performance.now();
  try {
    const r = await tfetch(`${base}/api/uploads/presigned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({ slug, filename: `multi-${guestId}.jpg`, contentType: 'image/jpeg', guest_name: `Guest-${guestId.slice(-5)}` }),
    });
    await r.text(); rec(b, performance.now() - t0, r.status, slug, 'up');
  } catch { rec(b, performance.now() - t0, null, slug, 'up'); }
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
let totalFail = 0, totalRejected = 0, worstWallP95 = 0;
const line = (label, b) => `  ${label}  ok=${b.ok}${b.rejected ? ` rejected(4xx)=${b.rejected}` : ''}${b.fail ? ` FAIL=${b.fail}` : ''}  p50=${pct(b.lat,50)|0} p95=${pct(b.lat,95)|0} p99=${pct(b.lat,99)|0}ms`;
for (const s of slugs) {
  const { wall, rx, up, statuses } = stats[s];
  totalFail += wall.fail + rx.fail + up.fail;
  totalRejected += wall.rejected + rx.rejected + up.rejected;
  worstWallP95 = Math.max(worstWallP95, pct(wall.lat, 95));
  console.log(`\n▶ ${s}`);
  console.log(line('wall', wall));
  console.log(line('rx  ', rx));
  console.log(line('up  ', up));
  if (Object.keys(statuses).length) console.log(`  non-2xx:`, statuses);
}

console.log(`\n═══ VERDICT ═══`);
console.log(`  ${slugs.length} simultaneous hot events · ${slugs.length * guestsPerEvent} total guests`);
console.log(`  real failures (5xx/transport): ${totalFail} · policy 4xx (closed/gated/rate-limited): ${totalRejected} · worst wall p95: ${worstWallP95 | 0}ms`);
if (totalFail > 0) console.log(`  ❌ ${totalFail} REAL failures — a capacity ceiling was crossed; check non-2xx statuses above`);
else if (worstWallP95 < 1000) console.log(`  ✅ all events held — wall p95 < 1s, 0 real failures (pool isolation intact across ${slugs.length} live events)`);
else console.log(`  ⚠️ 0 real failures but worst wall p95 ${worstWallP95 | 0}ms > 1s — getting warm; add events to find the ceiling (or remote pipe noise — re-run local). 4xx rejects are expected app behavior, not a ceiling.`);
