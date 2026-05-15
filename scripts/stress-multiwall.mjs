// Stress test: multiple wall displays polling simultaneously during a reaction spam.
// Simulates the real failure mode the user experienced — one wall's guests spamming
// emoji while 2-3 wall displays are actively polling both uploads and reactions.
//
// Usage: node scripts/stress-multiwall.mjs <slug> [walls=3] [spammers=150] [duration_s=30]
//
// Healthy = wall poll p95 < 3s, reaction poll p95 < 1s, 0 failures across all walls.

const slug        = process.argv[2];
const numWalls    = Number(process.argv[3] || 3);
const spammers    = Number(process.argv[4] || 150);
const durationS   = Number(process.argv[5] || 30);
const base        = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
if (!slug) {
  console.error('Usage: node scripts/stress-multiwall.mjs <slug> [walls=3] [spammers=150] [duration_s=30]');
  process.exit(1);
}

const EMOJIS = ['❤️','😂','🔥','👏','💃','🙏','🥰','✨','🎉','🥹','🌹','💖'];
const mk = () => ({ ok: 0, fail: 0, lat: [], statuses: {} });
const stats = {
  uploads_poll:   mk(),
  reactions_poll: mk(),
  reaction_write: mk(),
};

function record(bucket, ms, status, ok) {
  bucket.lat.push(ms);
  bucket.statuses[status] = (bucket.statuses[status] || 0) + 1;
  if (ok) bucket.ok++; else bucket.fail++;
}

async function wallUploadPoll(wallId) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/uploads/${slug}`, {
      headers: { 'X-Wall-Id': `stress-wall-${wallId}`, 'Accept-Encoding': 'gzip' },
    });
    await r.text();
    record(stats.uploads_poll, performance.now() - t0, r.status, r.ok);
  } catch (e) {
    record(stats.uploads_poll, performance.now() - t0, e.code || 'err', false);
  }
}

async function wallReactionPoll(wallId, since) {
  const t0 = performance.now();
  try {
    const r = await fetch(
      `${base}/api/reactions/${slug}?since=${encodeURIComponent(since)}`,
      { headers: { 'X-Wall-Id': `stress-wall-${wallId}` } },
    );
    const body = await r.json().catch(() => ({}));
    record(stats.reactions_poll, performance.now() - t0, r.status, r.ok);
    return body.server_time || since;
  } catch (e) {
    record(stats.reactions_poll, performance.now() - t0, e.code || 'err', false);
    return since;
  }
}

async function postReaction(guestId) {
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
    record(stats.reaction_write, performance.now() - t0, r.status, r.ok);
  } catch (e) {
    record(stats.reaction_write, performance.now() - t0, e.code || 'err', false);
  }
}

console.log(`Multi-wall + reaction spam against ${slug}`);
console.log(`  ${numWalls} wall displays (uploads poll every 3s, reactions poll every 1s)`);
console.log(`  ${spammers} concurrent reaction spammers for ${durationS}s\n`);

const deadline = performance.now() + durationS * 1000;

// Each wall polls uploads every 3s AND reactions every 1s — same as real wall.html.
const wallTasks = Array.from({ length: numWalls }, (_, i) => (async () => {
  let since = new Date().toISOString();
  let lastUploadPoll = 0;
  while (performance.now() < deadline) {
    const now = performance.now();
    const tasks = [wallReactionPoll(i, since).then(s => { since = s; })];
    if (now - lastUploadPoll >= 3000) {
      tasks.push(wallUploadPoll(i));
      lastUploadPoll = now;
    }
    await Promise.all(tasks);
    await new Promise(r => setTimeout(r, 1000));
  }
})());

// Reaction spammers: each guest fires as fast as the rate limiter allows.
// 60/min per device = 1/s; with `spammers` devices that's spammers req/s sustained.
const spamTask = (async () => {
  const end = performance.now() + durationS * 1000;
  const inflight = new Set();
  let i = 0;
  while (performance.now() < end) {
    while (inflight.size >= spammers) await Promise.race(inflight);
    const guestId = `spam-${i % spammers}`;
    const p = postReaction(guestId).finally(() => inflight.delete(p));
    inflight.add(p);
    i++;
    // ~1 req per second per guest (rate limit is 60/min). Stagger by 1s / spammers.
    await new Promise(r => setTimeout(r, Math.floor(1000 / spammers)));
  }
  await Promise.all(inflight);
})();

await Promise.all([...wallTasks, spamTask]);

function report(label, s) {
  s.lat.sort((a, b) => a - b);
  const p = pct => s.lat[Math.min(s.lat.length - 1, Math.floor(s.lat.length * pct / 100))] || 0;
  console.log(`[${label}]`);
  console.log(`  ok=${s.ok} fail=${s.fail} total=${s.ok + s.fail}`);
  console.log(`  p50=${p(50).toFixed(0)}ms p95=${p(95).toFixed(0)}ms p99=${p(99).toFixed(0)}ms max=${p(100).toFixed(0)}ms`);
  console.log(`  status:`, s.statuses);
}

console.log('\n=== RESULTS ===');
report('wall uploads-poll', stats.uploads_poll);
report('wall reactions-poll', stats.reactions_poll);
report('reaction writes (spam)', stats.reaction_write);
console.log('\nHealthy = wall polls p95 < 3s, reaction poll p95 < 1s, 0 failures');
