# Reelday — Infrastructure Cost Reference

Per-event and at-scale AWS Lambda + Cloudflare R2 cost analysis, with
profitability against current [plan tiers](../backend/lib/plans.js).
Last updated **2026-05-19**. Pricing snapshot: AWS Lambda `ap-southeast-1`
+ R2 standard rates.

## TL;DR

> **Infra cost: ~₱25/event** (Dalisay, 90-day retention) — about
> **0.8% of the ₱2,990 Dalisay price**. Free tier covers everything
> up to ~100 events/month. **Storage dominates beyond year 1** — set
> a retention policy before scale. R2's free egress is the moat
> (S3 would cost 5–10× more for the same wall playback workload).

## Pricing assumptions (current, in scope)

### AWS Lambda (ap-southeast-1)
- Compute: **$0.0000166667 / GB-second**
- Requests: $0.20 / million
- Free tier (always-on, not promotional): **400,000 GB-s/month + 1M requests/month**

### Cloudflare R2
- Storage: **$0.015 / GB / month**
- Class A operations (writes): $4.50 / million — free 1M/month
- Class B operations (reads): $0.36 / million — free 10M/month
- **Egress: $0.00** (R2's killer feature — biggest cost lever vs S3)

### Out of scope (separate cost lines)
- Easypanel / VPS hosting (backend + Postgres)
- Domain, SSL, email/SMS
- Payment gateway fees (typically 3–5% of revenue)
- Team labour, support, marketing

## SDE feature cost (per render)

Render = Lambda spinning `reelday-sde-renderer` to stitch one reel.

| Component | Value |
|---|---|
| Memory configured | 3008 MB = 2.94 GB |
| Render time (current: ultrafast + Ken Burns + cover bg + 68 clips) | ~6–10 min; assume **8 min = 480 s** |
| GB-seconds per render | 2.94 × 480 = **1,411 GB-s** |
| Lambda compute cost | 1,411 × $0.0000166667 = **$0.0235 (₱1.37)** |
| R2 write ops (mp4 + poster) | ~$0.0000135 (negligible) |
| R2 read ops (~70 inputs) | ~$0.0000252 (negligible) |
| **Cost per render** | **~$0.024 (~₱1.40)** |

### After-render storage

| Item | Per reel | Monthly |
|---|---|---|
| Rendered mp4 + poster | ~250 MB | $0.00375 (~₱0.22) |

## Full-event cost (photos + videos + SDE)

Typical event: **200 photos + 50 videos (30 s avg) + 2 SDE renders**.
Photos go directly to R2 (no Lambda); videos go through the transcoder
Lambda (`reelday-transcoder` / `index.mjs`).

### A. Compute (one-time, during event window)

| Lambda invocation | Per-unit | Per-event |
|---|---|---|
| Video transcode (3 GB × ~45 s) | ~$0.0023 | 50 × $0.0023 = **$0.115** |
| SDE renders (3 GB × ~480 s) | ~$0.024 | 2 × $0.024 = **$0.048** |
| **Total compute / event** | | **~$0.16 (~₱9)** |

### B. Storage (recurring monthly)

| Asset | Size per event | Monthly cost @ $0.015/GB |
|---|---|---|
| 200 photos (originals + thumbs) | ~0.9 GB | $0.014 |
| 50 videos (originals + transcoded + posters) | ~5 GB | $0.075 |
| 1 SDE reel (mp4 + poster) | ~0.25 GB | $0.004 |
| **Total storage / event** | **~6.15 GB** | **~$0.093 / month (~₱5.40)** |

### C. Ops + bandwidth (R2)

| Item | Per-event |
|---|---|
| Write ops (uploads + renders) | ~$0.001 |
| Read ops (wall playback + browsing) | ~$0.0002 |
| **Bandwidth (R2 egress = FREE)** | **$0.00** |

### Per-event totals

| Retention | One-time | Recurring (per month) | **Total (lifetime)** |
|---|---|---|---|
| **30 days** (Tala, Sinag) | $0.16 | $0.093 × 1 = $0.09 | **~$0.25 (~₱14)** |
| **90 days** (Dalisay) | $0.16 | $0.093 × 3 = $0.28 | **~$0.44 (~₱25)** |
| **1 year** | $0.16 | $0.093 × 12 = $1.12 | **~$1.28 (~₱74)** |
| **Forever (5 years)** | $0.16 | $0.093 × 60 = $5.58 | **~$5.74 (~₱333)** |

## At-scale projections

### Year-1 monthly cost, full retention

| Events/mo | Compute billable¹ | Storage at mo 12 | **Monthly** |
|---|---|---|---|
| 50 | $0 (free tier) | 3,690 GB × $0.015 = $55 | **~$55 (~₱3,200)** |
| 100 | $0 (free tier) | 7,380 GB × $0.015 = $111 | **~$111 (~₱6,400)** |
| 200 | ~$15 | 14,760 GB × $0.015 = $221 | **~$236 (~₱13,700)** |
| 500 | ~$50 | 36,900 GB × $0.015 = $554 | **~$604 (~₱35,000)** |
| 1,000 | ~$108 | 73,800 GB × $0.015 = $1,107 | **~$1,215 (~₱70,500)** |

¹ AWS free tier: 400,000 GB-s/month covers ~283 SDE renders OR ~8,800 video transcodes (or a mix).

### With 90-day retention (steady-state)

| Events/mo | Compute | Storage (steady at mo 3) | **Monthly** |
|---|---|---|---|
| 50 | $0 | 922 GB × $0.015 = $14 | **~$14 (~₱800)** |
| 100 | $0 | 1,845 GB × $0.015 = $28 | **~$28 (~₱1,600)** |
| 200 | $15 | 3,690 GB × $0.015 = $55 | **~$70 (~₱4,100)** |
| 500 | $50 | 9,225 GB × $0.015 = $138 | **~$188 (~₱11,000)** |
| 1,000 | $108 | 18,450 GB × $0.015 = $277 | **~$385 (~₱22,300)** |

**~3× cheaper** at scale vs full retention. The 90-day cap is what
the Dalisay plan already advertises.

## Margins vs current plan pricing

From [backend/lib/plans.js:13-110](../backend/lib/plans.js#L13):

| Tier | Price | Retention | Infra cost / evt | Gross margin |
|---|---|---|---|---|
| **Tala** | ₱0 (free) | 30 d | ₱14 | -₱14 (CAC) |
| **Sinag** | ₱1,490 / evt | 30 d | ₱14 | **₱1,476 (99.1%)** |
| **Dalisay** | ₱2,990 / evt | 90 d | ₱25 | **₱2,965 (99.2%)** |
| **Hiraya** | ₱9,990 / yr | 90 d (per event) | ₱25 × N events | depends on N |

### Hiraya break-even calculation

At ₱25/event infra cost, Hiraya covers infra until:

```
₱9,990 / ₱25 = 400 events per year per subscriber
```

A wedding coordinator doing **30–60 events/year** has ~98% gross margin.
A high-volume vendor doing **200+ events/year** drops to ~50% but is
still cash-positive. Only at **>400 events/year** would Hiraya start
losing money on infra alone — and at that volume the subscriber would
clearly upgrade or a custom enterprise tier would slot in.

## Cost levers, in order of impact

1. **Retention policy** — single biggest lever. Going from
   "forever" to "90 days" cuts infra by **~80% at scale**.
2. **Aggressive video compression** — videos are 80% of storage.
   Halving the bitrate of transcoded mp4s ≈ halves video storage cost.
3. **Free-tier sizing** — keep Tala small enough that median Tala
   user fits in AWS+R2 free tier. Don't subsidize unboundedly.
4. **Lambda memory tuning** — dropping SDE memory from 3008 → 2048 MB
   when the BtbN layer is fast enough would cut compute ~33%. Worth
   testing once the new layer + Ken Burns + cover-bg baseline is
   measured.
5. **AWS Service Quota raise (10 GB)** — *increases* per-render cost
   ~67% but buys xfade transitions + faster turnaround. Trade-off, not
   savings.

## What's NOT in this analysis (separate cost lines)

- **Easypanel / VPS** for the backend + Postgres — typically $5–50/mo
  depending on tier. Should grow with events but not linearly.
- **Database storage growth** — events, uploads, reactions, audio_notes,
  music_tracks, event_sites tables. Postgres rows are tiny but indexes
  + bloat matter eventually.
- **Domain, SSL, email/SMS** — fixed annual costs.
- **Payment gateway fees** — usually 3–5% of revenue (Stripe, PayMongo,
  Xendit, etc.).
- **Team time** — biggest non-infra cost for any small SaaS.
- **Customer acquisition cost** — marketing, partnerships.

## Sanity checks (so this is auditable)

- Lambda pricing: https://aws.amazon.com/lambda/pricing/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- AWS Free Tier: https://aws.amazon.com/free/

Numbers were computed manually on 2026-05-19 using prices live at that
date. If AWS or Cloudflare adjusts pricing, re-derive — the formulas
above (GB-s × rate, GB × $/GB/mo) stay the same.
