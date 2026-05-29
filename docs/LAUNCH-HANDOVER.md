# Reelday — Launch Handover (cold-start context)

*Compact context for a fresh session. Read this first; open the linked docs only when you need detail.*

**Product:** reelday.ph — live guest photo wall for PH celebrations (guests scan QR → photos/videos appear on venue screen, no app).
**Mission:** maximize **paying** customers by **June 30, 2026**. As of handover: ~zero traction (TikTok 3–5 views, IG ~100–200 views/0 engagement, FB group post pending).

## Locked constraints (2026-05-29)
- Goal = **paying customers** (not reach). Target ≥5 paid events June, stretch 10–12.
- Ad budget ≤ **₱5,000**. Owner can run only **1–3 free "hero" events**.

## Strategy (the thesis)
Sell to **intent, not reach** — only people with an event in ~1–3 months can buy, so broad reels get views but no sales. Channel priority: **FB groups + warm DMs > vendor partners > ₱5k ads (only after 1 testimonial) > IG > TikTok**. Conversion lever = **"Founding 20"**: first 20 June bookings get Dalisay ₱1,490 (50% off ₱2,990) + money-back guarantee, in exchange for a testimonial.

## Pricing (source of truth = `backend/lib/plans.js`)
Tala free · Sinag ₱1,490/evt · Dalisay ₱2,990/evt · Hiraya ₱9,990/yr (only yearly; coordinators). Per-event tiers; see [[project-plan-tiers-event-scoped]].

## What's BUILT (shipped to main)
**Coupon / promo-code system** (powers Founding 20). Admin creates codes → shares `?coupon=CODE` checkout links in DMs → discount auto-applies, recomputed server-side; redemption counts once on success. Tested 22/22.
- DB: `coupons` table + `payments.coupon_code` — in `schema.sql` AND boot migrations (`plugins/database.js`).
- `backend/lib/coupons.js`, routes in `payments.js` (validate-coupon public, /create applies, redeem on success) + `admin.js` (CRUD).
- Admin UI: 🎟️ Coupons tab in `frontend/admin.html`.
- Checkout: `frontend/js/coupon.js` captures `?coupon=`, threads into create calls (start/dashboard), shows a "₱2,990→₱1,490" banner.

## ⏳ Pending (blocks go-live)
1. **Redeploy** app in Easypanel → boot migration creates `coupons` table.
2. Admin → 🎟️ Coupons → create **FOUNDING20** (₱1,500 off · Dalisay · max 20 · expires Jun 30) → copy link.
3. Open link once → confirm banner + PayMongo charges ₱1,490.

## Marketing assets (docs/)
- `LAUNCH-MASTERPLAN-JUNE2026.md` — full 32-day plan (narrative)
- `LAUNCH-BLUEPRINT.md` — schematic (funnel/flywheel/decision tree)
- `launch-masterplan-tracker.html` — interactive checklist (22 tasks, localStorage)
- `week1-hero-event-kit.md` — hero-event post (3 versions) + 6 qualifying Qs + selection rubric + decline→Founding20
- `week1-outreach-pack.md` + `lead-tracker-template.csv` — FB-group playbook, DM sequences, vendor sequence, CRM
- **Jotform application:** https://form.jotform.com/261484731553056 (classic; Card layout couldn't be made via integration — optional manual rebuild)

## Plan timeline & where we are
W1 (May29–Jun4) Foundation: lock 1–3 hero events + make bookable + start groups/DMs/vendors. **#1 task = lock the hero event(s) — that's the proof pipeline.** Proof is *captured* W2 when an event actually runs (or sooner if a pending free-Dalisay applicant's event is this week).
W2 Capture & activate (run event → testimonial → turn on ₱5k ads). W3 Scale winner + scarcity. W4 Deadline close.

## Next action
Deploy + create FOUNDING20, then execute Week 1 (hero-event post → Jotform → pick 1–3; daily groups/DMs/vendors logged in the lead sheet).

*Related memory: [[project-launch-masterplan-june2026]], [[project-hiraya-launch]], [[reference-marketing-engine]].*
