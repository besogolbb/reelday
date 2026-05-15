// Stress test: cross-event isolation — one event's reaction storm should not
// freeze another event's wall poll. Both events share the same DB pool (50 conns).
//
// Usage: node scripts/stress-cross-event.mjs <slug-a> <slug-b> [spammers=200] [duration_s=30]
//
// slugA = the event being spammed with reactions
// slugB = the quiet event whose wall should stay fast
//
// Healthy = slugB wall poll p95 < 1s while slugA is under full reaction storm.
// Degraded = slugB wall p95 spikes — DB pool is saturating across events.

const slugA     = process.argv[2];
const slugB     = process.argv[3];
const spammers  = Number(process.argv[4] || 200);
const durationS = Number(process.argv[5] || 30);
const base      = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');

if (!slugA || !slugB) {
  console.error('Usage: node scripts/stress-cross-event.mjs <slug-a> <slug-b> [spammers=200] [duration_s=30]');
  console.error('  slug-a: event being spammed with reactions');
  console.error('  slug-b: quiet event whose wall latency we are measuring');
  process.exit(1);
}
if (slugA === slugB) {
  console.error('slug-a and slug-b must be different events');
  process.exit(1);
}

const EMOJIS = ['❤️','😂','🔥','👏','💃','🙏','🥰','✨','🎉','🥹','🌹','💖'];
const mk = () => ({ ok: 0, fail: 0, lat: [], statuses: {} });
const stats = {
  spamReactions: mk(),  // POST reactions on slugA
  wallA: mk(),          // GET uploads on slugA (control)
  wallB: mk(),          // GET uploads on slugB (should stay fast)
};

function record(bucket, ms, status, isOk) {
  bucket.lat.push(ms);
  bucket.statuses[status] = (bucket.statuses[status] || 0) + 1;
  if (isOk) bucket.ok++; else bucket.fail++;
}

async function postReaction(slug, guestId) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/reactions/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({
        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
        guest_name: `Spammer-${guestId.slice(-6)}`,
      }),
    });
    await r.text();
    record(stats.spamReactions, performance.now() - t0, r.status, r.ok);
  } catch (e) {
    record(stats.spamReactions, performance.now() - t0, e.code || 'err', false);
  }
}

async function wallPoll(slug, bucket, wallId) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/uploads/${slug}`, {
      headers: { 'X-Wall-Id': wallId, 'Accept-Encoding': 'gzip' },
    });
    await r.text();
    record(bucket, performance.now() - t0, r.status, r.ok);
  } catch (e) {
    record(bucket, performance.now() - t0, e.code || 'err', false);
  }
}

console.log(`Cross-event isolation test`);
console.log(`  Event A (${slugA}): ${spammers} concurrent reaction spammers for ${durationS}s`);
console.log(`  Event B (${slugB}): 1 wall polling every 3s — should stay unaffected\n`);

const deadline = performance.now() + durationS * 1000;

// Reaction storm on slugA.
const spamTask = (async () => {
  const inflight = new Set();
  let i = 0;
  while (performance.now() < deadline) {
    while (inflight.size >= spammers) await Promise.race(inflight);
    const guestId = `spam-${i % spammers}`;
    const p = postReaction(slugA, guestId).finally(() => inflight.delete(p));
    inflight.add(p);
    i++;
    await new Promise(r => setTimeout(r, Math.floor(1000 / spammers)));
  }
  await Promise.all(inflight);
})();

// Wall A polls every 3s (control — expected to degrade under its own storm).
const wallATask = (async () => {
  while (performance.now() < deadline) {
    await wallPoll(slugA, stats.wallA, 'cross-wall-a');
    await new Promise(r => setTimeout(r, 3000));
  }
})();

// Wall B polls every 3s — this is what we're protecting.
const wallBTask = (async () => {
  while (performance.now() < deadline) {
    await wallPoll(slugB, stats.wallB, 'cross-wall-b');
    await new Promise(r => setTimeout(r, 3000));
  }
})();

// Progress ticker.
const ticker = setInterval(() => {
  const elapsed = ((performance.now() - (deadline - durationS * 1000)) / 1000).toFixed(0);
  const bLats = stats.wallB.lat;
  const bP95 = bLats.length
    ? bLats.slice().sort((a,b)=>a-b)[Math.floor(bLats.length * 0.95)] | 0
    : 0;
  process.stdout.write(`\r[${elapsed}s] spamRx=${stats.spamReactions.ok} | wallA ok=${stats.wallA.ok} | wallB ok=${stats.wallB.ok} p95=${bP95}ms   `);
}, 2000);

await Promise.all([spamTask, wallATask, wallBTask]);
clearInterval(ticker);
console.log('\n');

function report(label, s) {
  const sorted = s.lat.slice().sort((a, b) => a - b);
  const p = pct => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct / 100))] || 0;
  console.log(`[${label}]`);
  console.log(`  ok=${s.ok} fail=${s.fail}`);
  if (sorted.length) {
    console.log(`  p50=${p(50).toFixed(0)}ms p95=${p(95).toFixed(0)}ms p99=${p(99).toFixed(0)}ms max=${p(100).toFixed(0)}ms`);
  }
  console.log(`  status:`, s.statuses);
}

console.log('=== RESULTS ===');
report(`reaction spam  (${slugA})`, stats.spamReactions);
report(`wall A poll    (${slugA}) — expected to feel the storm`, stats.wallA);
report(`wall B poll    (${slugB}) — should stay fast`, stats.wallB);
console.log('\nHealthy = wallB p95 < 1s even while slugA is under storm');
console.log('Degraded = wallB p95 spikes — DB pool saturation crossing event boundaries');
