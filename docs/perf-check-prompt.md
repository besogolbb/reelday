# Reelday Performance Check — Reusable AI Prompt

Paste the block below into a fresh Claude/ChatGPT/Cursor chat whenever you want
to spot-check production performance. Then run one of the stress scripts and
paste the output. The AI will compare against the baselines and tell you if
anything's off.

---

## The prompt (copy from here ↓)

```
You are helping me monitor the performance of Reelday.ph, my Filipino wedding/event photo & video sharing platform. Here's the context you need:

ARCHITECTURE
- Backend: Fastify on Hostinger KVM2 VPS via Easypanel (2 vCPU / 8 GB)
- Postgres: collocated on same VPS, internal hostname
- Storage: Cloudflare R2 (free egress)
- Transcoding: AWS Lambda + SQS FIFO (currently capped at 10 concurrent)
- Domain: https://reelday.ph

KEY ENDPOINTS
- /api/health — trivial DB ping
- /api/uploads/:slug — wall poll (read)
- /api/events/:slug — event detail
- /api/uploads/presigned — POST, upload kickoff
- /api/reactions/:slug — POST, emoji reactions

KNOWN BASELINES (good performance looks like)
- /api/health: under 200 ms typical
- /api/uploads/:slug: under 700 ms typical, 14 KB response (gzip)
- 1000 simultaneous upload kickoffs: 0 failures, ~4 s p99
- 200 concurrent wall polls: ~393 rps, 0 failures, p95 ~0.94 s
- 600 concurrent wall polls: ~217 rps, 0 failures, p95 ~2.55 s
- Sustained mixed load 3 min: 0 failures, flat latency
- Multi-wall (3 walls) + 150 reaction spammers: wall p95 < 300 ms, 0 wall failures
- Cross-event isolation (200 spammers on A): wall B p95 ~280 ms, unaffected
- Poll vote storm (300 simultaneous voters): 0 failures, p95 ~1.74 s

BASELINE HISTORY
- 2026-05-13: 600 concurrent wall polls — 370 rps, p95 3.0 s, 60 KB response (no compression)
- 2026-05-15: SELECT * → explicit columns + gzip via Node zlib; 600 concurrent — 217 rps, p95 2.55 s, 14 KB response
- 2026-05-15: Multi-wall, cross-event, poll vote storm — all passing, new scripts added
- 2026-05-16: JOIN + 10s cache on upload validation; upload 600c — p50 1.49 s, p95 1.80 s, 291 rps, 0 failures (beats May 15); reactions 200c — p50 263 ms, p95 689 ms, 596 rps, 0 failures. Run via npm run perf:pre-local from Easypanel terminal.

NOTE ON TEST METHODOLOGY
- Run perf:*-local from the Easypanel terminal for accurate numbers (bypasses Cloudflare+Traefik geographic overhead)
- GitHub Actions tests (US runners → Asia VPS) add ~1300ms base latency per connection and are not comparable to local baselines
- npm run perf:local → quick health + wall sanity check
- npm run perf:pre-local → upload 600c + reactions 200c (pre-event check)
- npm run perf:full-local → full suite

STRESS TEST SCRIPTS (all in scripts/ folder)
- scripts/stress-wall.mjs <slug> [conc] [total]
- scripts/stress-upload.mjs <slug> [conc] [total]
- scripts/stress-reactions.mjs <slug> [conc] [total]
- scripts/stress-mixed.mjs <slug> [uploads] [reactions] [duration_s]
- scripts/stress-sustained.mjs <slug> [duration_min]
- scripts/stress-multiwall.mjs <slug> [walls=3] [spammers=150] [duration_s=30]
- scripts/stress-cross-event.mjs <slug-a> <slug-b> [spammers=200] [duration_s=30]
- scripts/stress-poll-vote.mjs <slug> <poll-id> [voters=300] [rounds=3]

HOW TO USE THESE WITH AN AI ASSISTANT
1. Run the relevant script and paste the output.
2. Ask the assistant to compare against the baselines above.
3. Flag anything that's >2× worse than baseline.

WHAT I WANT FROM YOU
- Tell me whether perf is healthy, degraded, or broken
- Identify the most likely cause if degraded
- Suggest the smallest possible fix (don't propose major refactors unless really needed)
- Be honest if you don't have enough info — ask for what you need

Test event slug: cxzv-fe0y (use this for stress tests against prod)
```

---

## Quick recipes

### Spot-check (weekly, ~30 sec)
```powershell
node scripts/stress-wall.mjs cxzv-fe0y 200 1000
```
Healthy = 0 failures, p95 under 3 s.

### Pre-event check for events ≥ 500 guests (~1 min)
```powershell
node scripts/stress-upload.mjs cxzv-fe0y 600 600
node scripts/stress-reactions.mjs cxzv-fe0y 200 1000
```
Healthy = 0 failures on both.

### Full deep-check before a 1000+ guest event (~6 min)
```powershell
node scripts/stress-upload.mjs cxzv-fe0y 1000 1000
node scripts/stress-mixed.mjs cxzv-fe0y 600 1500 30
node scripts/stress-sustained.mjs cxzv-fe0y 3
node scripts/stress-multiwall.mjs cxzv-fe0y 3 150 30
node scripts/stress-cross-event.mjs cxzv-fe0y scarlette-skye-td9n 200 30
```
Healthy = 0 failures across all, sustained latency stays flat, wall B p95 < 1 s during cross-event test.

### Poll vote storm (run while a poll is live on the wall)
```powershell
# 1. Start a poll in the dashboard ("Run on wall")
# 2. Grab the poll UUID from: curl https://reelday.ph/api/events/cxzv-fe0y/polls/active
node scripts/stress-poll-vote.mjs cxzv-fe0y <poll-uuid> 300 2
```
Healthy = 0 failures, vote p95 < 2 s, tally reads < 500 ms.

---

## What "degraded" looks like

| Symptom | Likely cause |
|---|---|
| `/api/health` consistently > 500 ms | DB connection / Postgres trouble |
| All endpoints spike but `/api/health` is fine | Backend CPU saturated — check Easypanel |
| Failures with status `429` | Rate limiter blocking — your test IP got too aggressive |
| Failures with status `5xx` | Container crash or proxy issue — check Easypanel logs |
| Latency creeps up over a sustained run | Memory leak or socket exhaustion |
| Upload kickoff slow but wall poll fast | Pre-signed URL signing path issue |
| Wall B lags during cross-event test | DB pool saturation — one event's storm bleeding into another |
| Poll vote p95 > 5 s or 5xx | Upsert lock contention on poll_votes — check DB pool depth |
| Wall polls fine but reaction polls lag | Reaction eventCache cold — check DB index on reactions table |

If anything degrades, the AI you paste the prompt into will help diagnose. Keep
this doc updated whenever a baseline meaningfully changes.
