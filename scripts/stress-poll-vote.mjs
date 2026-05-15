// Stress test: live poll vote storm — all guests vote at the same instant.
// The vote handler uses an upsert (INSERT ... ON CONFLICT DO UPDATE) which
// can cause row-level lock contention when hundreds of guests vote on the
// same poll simultaneously. Also tests the wall's /polls/active read path
// which shows the live tally while votes are landing.
//
// Usage: node scripts/stress-poll-vote.mjs <slug> <poll-id> [voters=300] [rounds=3]
//
// poll-id: UUID of a LIVE poll (create one in the dashboard first, then "Run on wall")
// rounds:  how many times each voter re-votes (simulates guests changing their mind)
//
// Healthy = 0 failures, p95 < 2s, no lock timeouts
// Degraded = 5xx errors, lock timeouts, or p95 > 5s

const slug    = process.argv[2];
const pollId  = process.argv[3];
const voters  = Number(process.argv[4] || 300);
const rounds  = Number(process.argv[5] || 3);
const base    = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');

if (!slug || !pollId) {
  console.error('Usage: node scripts/stress-poll-vote.mjs <slug> <poll-id> [voters=300] [rounds=3]');
  console.error('');
  console.error('  poll-id: UUID of a LIVE poll — create one in the dashboard and tap "Run on wall"');
  console.error('  voters:  number of simultaneous guests voting at the same instant');
  console.error('  rounds:  each voter re-votes this many times (simulates changing mind)');
  process.exit(1);
}

const OPTIONS = ['a', 'b', 'c', 'd']; // will be validated server-side; unknown keys → 400
const mk = () => ({ ok: 0, fail: 0, lat: [], statuses: {} });
const stats = { votes: mk(), tally: mk() };

function record(bucket, ms, status, isOk) {
  bucket.lat.push(ms);
  bucket.statuses[status] = (bucket.statuses[status] || 0) + 1;
  if (isOk) bucket.ok++; else bucket.fail++;
}

// First fetch /polls/active to discover the real option keys for this poll.
console.log(`Fetching active poll for ${slug}…`);
let optionKeys = OPTIONS;
try {
  const r = await fetch(`${base}/api/events/${slug}/polls/active`);
  const body = await r.json();
  if (body?.poll?.options && Array.isArray(body.poll.options)) {
    const keys = body.poll.options.map(o => o.key).filter(Boolean);
    if (keys.length) optionKeys = keys;
    console.log(`  Found poll: "${body.poll.question}"`);
    console.log(`  Options: ${optionKeys.join(', ')}`);
    if (body.poll.id !== pollId) {
      console.warn(`  WARNING: active poll ID (${body.poll.id}) ≠ provided poll ID (${pollId})`);
      console.warn(`           Votes will go to the provided poll-id; use the active one if you want accurate results.`);
    }
  } else {
    console.warn(`  No active poll found — votes may return 400 (poll not live). Proceeding anyway.`);
  }
} catch (e) {
  console.warn(`  Could not fetch active poll: ${e.message}. Using placeholder option keys.`);
}

async function castVote(guestId, optionKey) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/events/${slug}/polls/${pollId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
      body: JSON.stringify({ option_key: optionKey, guest_name: `Voter-${guestId.slice(-6)}` }),
    });
    await r.text();
    record(stats.votes, performance.now() - t0, r.status, r.ok);
  } catch (e) {
    record(stats.votes, performance.now() - t0, e.code || 'err', false);
  }
}

async function fetchTally() {
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/events/${slug}/polls/active`);
    await r.text();
    record(stats.tally, performance.now() - t0, r.status, r.ok);
  } catch (e) {
    record(stats.tally, performance.now() - t0, e.code || 'err', false);
  }
}

console.log(`\nPoll vote storm`);
console.log(`  ${voters} voters × ${rounds} rounds = ${voters * rounds} total votes`);
console.log(`  All voters fire simultaneously at t=0 each round\n`);

for (let round = 1; round <= rounds; round++) {
  // All voters fire at exactly the same time — maximum upsert contention.
  const pick = optionKeys[round % optionKeys.length];
  console.log(`  Round ${round}/${rounds}: all ${voters} guests vote for "${pick}" simultaneously…`);
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: voters }, (_, i) => castVote(`voter-${i}`, pick)),
  );
  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`    done in ${elapsed}s — ok=${stats.votes.ok} fail=${stats.votes.fail}`);

  // After each round, fetch the tally as the wall would (to check read health under write load).
  await fetchTally();
  if (round < rounds) await new Promise(r => setTimeout(r, 500));
}

function report(label, s) {
  const sorted = s.lat.slice().sort((a, b) => a - b);
  const p = pct => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct / 100))] || 0;
  console.log(`\n[${label}]`);
  console.log(`  ok=${s.ok} fail=${s.fail} total=${s.ok + s.fail}`);
  if (sorted.length) {
    console.log(`  p50=${p(50).toFixed(0)}ms p95=${p(95).toFixed(0)}ms p99=${p(99).toFixed(0)}ms max=${p(100).toFixed(0)}ms`);
  }
  console.log(`  status:`, s.statuses);
}

console.log('\n=== RESULTS ===');
report('poll votes (upsert)', stats.votes);
report('tally reads (/polls/active)', stats.tally);
console.log('\nHealthy = 0 failures, vote p95 < 2s, tally p95 < 500ms');
console.log('Degraded = 5xx / 400s, lock timeouts, vote p95 > 5s');
