# Reelday Performance Test Database

Chronological log of every performance test executed against production, with results and context. Use this to spot regressions, compare runs, and document the baseline history that powers [perf-check-prompt.md](perf-check-prompt.md) and [reelday-event-capacity.html](reelday-event-capacity.html).

**Conventions:**
- **Env:** `local` = run from Easypanel terminal (`BASE_URL=http://localhost:3000`, backend-isolated). `remote` = run from PowerShell on PH laptop (through Cloudflare+Traefik, production-truth, adds ~600–1000 ms overhead).
- **Failures:** anything other than `0` is flagged.
- **Verdict:** ✅ pass · ⚠️ flag · ❌ regression
- All runs use test slug `cxzv-fe0y` unless noted.

---

## Current best baselines (one-pager)

Use these as the reference for "is today's run healthy?" Updated whenever a meaningfully better number is achieved.

| Scenario | Best result | Date | Env |
|---|---|---|---|
| /api/health | 67 ms | 2026-05-16 | local |
| Wall poll 200c × 1000 | 393 rps · p95 0.94 s · 0 fail | 2026-05-15 | local |
| Wall poll 600c × 600 | 217 rps · p95 2.55 s · 0 fail | 2026-05-15 | local |
| Upload kickoff 600c × 600 | 291 rps · p95 1.80 s · 0 fail | 2026-05-16 | local |
| Upload kickoff 1000c × 1000 | p99 3.7 s · 0 fail | 2026-05-18 | CI |
| Reactions 200c × 1000 | 596 rps · p95 689 ms · 0 fail | 2026-05-16 | local |
| Mixed peak (600u + 1500r + walls / 30s) | 0 fail all components | 2026-05-17 | remote |
| Sustained 3-min mix | 0 fail · flat latency · upload/rx p95 ~86 ms · wall p95 261 ms | 2026-05-18 | remote (PH laptop) |
| Multi-wall + 150 spammers | 0 fail · wall p95 < 700 ms | 2026-05-17 | remote |
| Cross-event isolation (200 spammers, 90s) | Wall B p95 611 ms · 0 fail | 2026-05-17 | remote |
| Poll vote storm (300 voters) | p95 1.74 s · 0 fail | 2026-05-15 | local |
| Single-user E2E upload | p50 1.7 s · p95 2.3 s · 0 fail | 2026-05-17 | remote |

---

## Full chronological log

### 2026-05-13 — Pre-gzip baseline

| # | Test | Cmd | Env | Result | Verdict | Note |
|---|---|---|---|---|---|---|
| 1 | Wall poll 600c | `stress-wall 600 600` | local | 370 rps · p95 3.0 s · 60 KB response · 0 fail | ✅ | Pre-gzip — established the "before" number |

### 2026-05-15 — Gzip + multi-wall + cross-event work

| # | Test | Cmd | Env | Result | Verdict | Note |
|---|---|---|---|---|---|---|
| 2 | Wall poll 600c | `stress-wall 600 600` | local | 217 rps · p95 2.55 s · 14 KB response · 0 fail | ✅ | After SELECT * → explicit columns + Node zlib gzip. Response 60 KB → 14 KB. |
| 3 | Multi-wall + 150 spammers | `stress-multiwall 3 150 30` | local | wall p95 < 300 ms · 0 wall fail · 93/2944 spam writes rate-limited | ✅ | New test added. Rate limits as expected. |
| 4 | Cross-event isolation | `stress-cross-event ... 200 30` | local | Wall B p95 ~280 ms · 0 fail | ✅ | New test. Confirms clean DB pool isolation. |
| 5 | Poll vote storm 300c | `stress-poll-vote ... 300 3` | local | p95 1.74 s · 0 fail · tally < 500 ms | ✅ | New test. Validates ON CONFLICT DO UPDATE under contention. |

### 2026-05-16 — Upload validation JOIN + 10s cache

| # | Test | Cmd | Env | Result | Verdict | Note |
|---|---|---|---|---|---|---|
| 6 | Upload 600c | `stress-upload 600 600` | local | 291 rps · p50 1.49 s · p95 1.80 s · 0 fail | ✅ | New best for 600c upload. Beats 2026-05-15 by ~30%. |
| 7 | Reactions 200c | `stress-reactions 200 1000` | local | 596 rps · p50 263 ms · p95 689 ms · 0 fail | ✅ | New baseline. |
| 8 | Wall poll 200c | `stress-wall 200 1000` | remote | 210 rps · p95 2051 ms · 0 fail | ✅ | First PowerShell-truth test for wall. Adds ~1 s network. |
| 9 | perf:pre-local | npm script | local | health 67 ms · upload 600c p95 2226 ms · reactions 200c p95 1000 ms · 0 fail | ✅ | Slightly elevated vs entries 6/7 — VPS-neighbor noise. |
| 10 | Wall poll 200c | `stress-wall 200 1000` | remote | 138 rps · p95 1548 ms · 0 fail | ✅ | |
| 11 | Upload 600c | `stress-upload 600 600` | remote | 133 rps · p95 2387 ms · 0 fail | ✅ | |
| 12 | perf:full | npm script | remote | upload 1000c p99 5.2 s · mixed 0 fail · sustained 0 fail flat · multi-wall 0 fail · cross-event Wall B p95 216 ms | ✅ | First full remote suite — all pass. Wall B at 216 ms was unusually fast (network was quiet). |
| 13 | E2E upload 20c × 60 | `stress-upload-e2e 20 60` | remote | full E2E p50 5.3 s · p95 10.5 s · 0 fail · 500 KB payload | ✅ | First E2E test. R2 PUT latency reflects laptop bandwidth shared across 20 connections (not a real-guest condition). |

### 2026-05-17 — Pre-launch deep check

| # | Test | Cmd | Env | Result | Verdict | Note |
|---|---|---|---|---|---|---|
| 14 | E2E upload 1c × 10 | `stress-upload-e2e 1 10` | remote | E2E p50 1.7 s · p95 2.3 s · 0 fail | ✅ | Real single-guest experience. Presigned p50 78 ms, complete p50 75 ms — backend essentially instant when not under burst. |
| 15 | Upload 1000c (first attempt) | `stress-upload 1000 1000` | remote | 91 fail / 1000 · p95 7.8 s | ⚠️ | Client-side: laptop TIME_WAIT pressure from back-to-back tests. Not a backend issue. |
| 16 | Upload 500c | `stress-upload 500 1000` | remote | 273 rps · p95 2818 ms · 0 fail | ✅ | Confirmed entry 15 was client-side — backend fine. |
| 17 | Upload 1000c (re-run) | `stress-upload 1000 1000` | remote | 183 rps · p95 5302 ms · p99 5307 ms · 0 fail | ✅ | After TIME_WAIT cleared. Matches 2026-05-16 baseline exactly. |
| 18 | Mixed peak 600 + 1500 / 30s | `stress-mixed 600 1500 30` | remote | uploads p95 3204 ms · reactions p95 385 ms · wall p95 3179 ms · 0 fail | ✅ | 2,108 requests, zero failures. |
| 19 | Sustained 3 min | `stress-sustained 3` | remote | upload p95 377 ms · reaction p95 379 ms · wall p95 588 ms · 0 fail · flat throughout | ✅ | 2,059 requests. No memory leak, no drift. One transient reaction p95 spike at 150s (899 ms) recovered next bucket. |
| 20 | Multi-wall + 150 spammers | `stress-multiwall 3 150 30` | remote | wall uploads-poll p95 662 ms · wall reactions-poll p95 654 ms · spam writes p95 624 ms · 0 fail / 2874 | ✅ | Notable: 0 rate-limited writes today vs. 93/2944 on 2026-05-15. |
| 21 | Cross-event isolation 30s | `stress-cross-event ... 200 30` | remote | Wall B p95 1409 ms · 0 fail · only 9 samples | ⚠️ | Small-sample noise — single slow poll dominated p95. Re-run at 90s for real signal. |
| 22 | Cross-event isolation 90s | `stress-cross-event ... 200 90` | remote | Wall B p95 611 ms · 0 fail · 27 samples · 9,375 total requests | ✅ | Real signal. Wall A and B essentially identical (~600 ms p95) = backend not saturating, both reflect baseline remote latency. Clean isolation. |

### 2026-05-18 — CI run + warm-up validation + local steady-state baselines

| # | Test | Cmd | Env | Result | Verdict | Note |
|---|---|---|---|---|---|---|
| 23 | Upload 1000c | `stress-upload 1000 1000` (perf:full) | CI (GH Actions) | 241 rps · p95 3655 ms · p99 3705 ms · max 3951 ms · 0 fail | ✅ | **New best** for 1000c remote (beats entry 17's p99 5302 ms by ~30%). Runner ID 26006641369. |
| 24 | Mixed peak 600 + 1500 / 30s | `stress-mixed 600 1500 30` | CI | uploads p95 2180 ms · reactions p95 461 ms · wall p95 2148 ms · 1498/1500 reactions ok (err: 2) | ✅ | Beats entry 18 across uploads/wall. `err: 2` = vanilla TypeError from socket abort during burst (no `e.code`) — confirmed via stress-mixed.mjs:47. Not server-side. |
| 25 | Sustained 3 min | `stress-sustained 3` | CI | upload p95 473 ms · reaction p95 463 ms · wall p95 619 ms · 0 fail | ✅ | Slightly above entry 19's mid-percentiles but tail is *better* (p99/max all down). Within run-to-run variance. |
| 26 | Multi-wall + 150 spammers | `stress-multiwall 3 150 30` | CI | wall uploads-poll p95 448 ms · wall reactions-poll p95 496 ms · spam writes p95 462 ms · 0 fail / 4689 | ✅ | Tighter than entry 20 across the board. 4689 spam writes (vs 2874) with 0 fail. |
| 27 | Cross-event isolation 30s (no warm-up) | `stress-cross-event ... 200 30` | CI | Wall A p95 503 ms · Wall B p95 805 ms · 0 fail · 10 samples each | ⚠️ | Wall B *slower* than Wall A under storm — inverted from expected. Root cause: B's first poll was 805 ms (cold connection / cold prepared-statement cache), and with N=10 the first poll = p95. Motivated the warm-up fix in [scripts/stress-cross-event.mjs](../scripts/stress-cross-event.mjs). |
| 28 | Cross-event isolation 30s (with warm-up) | `stress-cross-event ... 200 30` | CI | Wall A p95 462 ms · Wall B p95 526 ms · 0 fail · 10 samples each · 5573 spam writes | ✅ | Warm-up landed. Inversion collapsed from 302 ms gap → 64 ms gap (noise at N=10). Per-second ticker started at p95 439 ms instead of 805 ms — cold-start gone. Validates commit bc8d7d6. |
| 29 | Upload 200c × 1000 | `stress-upload 200 1000` | remote | 690 rps · p95 644 ms · p99 657 ms · 0 fail | ✅ | Lower-concurrency follow-up from PowerShell. |
| 30 | Cross-event isolation 30s | `stress-cross-event ... 200 30` | remote | Wall A p95 211 ms · **Wall B p95 168 ms** · 3062 spam · 0 fail | ✅ | Confirms isolation under real network conditions. Wall B *faster* than Wall A here — inversion flipped direction, definitively confirming the original anomaly was N=10 noise, not isolation failure. |
| 31 | Mixed peak 600 + 1500 / 30s | `stress-mixed 600 1500 30` | remote | uploads p95 1652 ms · reactions p95 79 ms · wall p95 1633 ms · 0 fail | ✅ | Upload p50→max gap of 33 ms = saturated upstream bandwidth from home connection, not server load. Reactions and wall reflect real server. |
| 32 | Sustained 3 min | `stress-sustained 3` | remote (laptop) | upload p95 85 ms · reaction p95 86 ms · wall p95 261 ms · 0 fail · flat over 3 min | ✅ | **New steady-state baseline.** Per-30s readouts: rx p95 76-87 ms, upload p95 79-98 ms, wall p95 237-293 ms — zero drift. Proves the CI sustained "drift" (entry 25) was inter-run variance, not server degradation. |

---

## Aggregate scorecard

| Date | Tests run | Total requests | Failures | Notes |
|---|---|---|---|---|
| 2026-05-13 | 1 | 600 | 0 | Pre-gzip baseline |
| 2026-05-15 | 4 | ~6,500 | 93 (expected rate-limit) | Gzip + new scripts |
| 2026-05-16 | 7 | ~10,000 | 0 | Upload optimization + first remote full suite |
| 2026-05-17 | 9 | ~20,000 | 91 (client-side, not backend) | Pre-launch deep check |
| 2026-05-18 | 10 | ~24,500 | 2 (client-side socket aborts in CI mixed test) | CI full suite + warm-up validation + local steady-state baselines |
| **Total** | **31** | **~61,500** | **0 backend failures** | |

---

## Significant changes that moved the baselines

| Date | Change | Effect |
|---|---|---|
| 2026-05-15 | SELECT * → explicit columns on wall poll + gzip via Node zlib | Wall 600c response 60 KB → 14 KB; p95 3.0 s → 2.55 s |
| 2026-05-15 | Added stress-multiwall, stress-cross-event, stress-poll-vote scripts | Coverage expanded to known failure modes |
| 2026-05-16 | Upload validation: separate queries → JOIN + 10s in-memory cache | Upload 600c p95 2.55 s → 1.80 s, 217 rps → 291 rps |
| 2026-05-16 | Added stress-upload-e2e for full presigned → R2 PUT → complete flow | First end-to-end measurement of real guest experience |
| 2026-05-17 | (No code changes — pure validation runs) | Confirmed all baselines hold; cross-event re-verified with larger sample |
| 2026-05-18 | Cross-event test: 3 discarded warm-up polls per slug before storm clock starts (commit bc8d7d6) | Wall B p95 805 ms → 526 ms (CI) and 168 ms (local). Eliminated cold-connection / cold prepared-statement bias that was making the quiet event look slower than the spammed one at N=10. |

---

## How to add a new entry

After running a stress test:

1. Add a row to the relevant date section (create new section if it's a new date)
2. Use the columns: `# | Test | Cmd | Env | Result | Verdict | Note`
3. If the result is the new best for its scenario, update the "Current best baselines" table at the top
4. If a code change drove the change, add a row to "Significant changes" with date + brief description
5. Increment the date-row in "Aggregate scorecard"

Keep notes brief — link to the commit hash if the run validates a specific change (e.g., `Validates 6c8e959`).

---

## Known artifacts to keep in mind when reading numbers

- **PowerShell 1000c upload from one laptop** can produce false failures via Windows TCP TIME_WAIT pressure. Re-run after 2 min wait or use lower concurrency. Real guests don't share a single IP/port pool.
- **Remote runs add ~600–1000 ms** of constant network overhead over local. Always note env when comparing.
- **Small-sample p95** (< 20 samples) is unreliable — one slow request dominates. Increase duration or concurrency for trustworthy tail latency.
- **Reaction writes occasionally rate-limited** at extreme spam (60/min per device cap). This is the rate limiter working correctly, not a failure.
