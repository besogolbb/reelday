# Hiraya — Launch Plan

Yearly subscription (₱9,990 / yr, cap 10 events) for coordinators,
photographers, and venues. Currently functionally usable but not
launch-ready. This doc tracks what's left so a future session can
pick up cold without re-deriving the audit.

Last updated: 2026-05-20

**Status: PRIVATE LAUNCH (2026-05-20).** Backend fully live; public buy
CTAs hidden behind `HIRAYA_PUBLIC` flag in
[frontend/js/plans.js](../frontend/js/plans.js). Phase 3 deferred —
revisit after 30-60 days of real coordinator feedback (Option 4 from the
2026-05-20 plan discussion: don't build blind, comp coordinators and
listen first).

**Relaunching publicly when ready:** flip `HIRAYA_PUBLIC=true` in
[frontend/js/plans.js](../frontend/js/plans.js) AND uncomment the
`<!-- HIRAYA HIDDEN -->` block in
[frontend/index.html](../frontend/index.html) (grep for that marker).
Re-enables: landing pricing card, /start plan picker, dashboard upgrade
modal card. Comp/renew/badge/lapsed paths are untouched and work while
hidden.

**Comping a coordinator while hidden:** admin → "comp-Hiraya for N
months" action (shipped 2026-05-20). They land in their dashboard with
the badge, gold tier theming, "✓ Included" affordance on /start, and the
full lapsed/renewal UX exactly as if they'd paid.

---

## TL;DR status

| Area | State |
|---|---|
| DB schema (`subscription_expires_at`, `hiraya_credits`) | ✅ shipped |
| PayMongo billing (₱9,990 / yr, +1y on `subscription_expires_at`) | ✅ shipped |
| `applyTierUpgrade` cross-buy guard (one-time purchase doesn't yank Hiraya) | ✅ shipped |
| Event create gate (active sub + rolling 10/yr cap) | ✅ shipped 2026-05-20 |
| Feature gates read `event.plan` first | ✅ shipped May 2026 |
| Dashboard tier theming (gold Plan row + engraved type) | ✅ shipped 2026-05-20 |
| Cap-reached UX panel (`/start` shows support contact, not rebuy) | ✅ shipped 2026-05-20 |
| Sinag production price restored (₱1,490) | ✅ shipped 2026-05-20 |
| Marketing copy honest about what's actually built | ✅ shipped 2026-05-21 |
| Renewal reminder emails (T-30 / T-7 / T-0) | ✅ shipped 2026-05-21 |
| Lapsed-sub UX (specific 402 code + dashboard banner) | ✅ shipped 2026-05-21 |
| One-click renewal endpoint | ✅ shipped 2026-05-21 |
| At least one Hiraya-exclusive perk wired in code | ⏸ deferred to post-launch (Dalisay already has website; volume + retention is the actual Hiraya pitch — see "Why we skipped Phase 3" below) |
| Admin: PayMongo healthcheck endpoint + UI | ✅ shipped 2026-05-20 (fixed probe endpoint same day — was /v1/links, now /v1/payments) |
| Admin: comp-Hiraya for N months action | ✅ shipped 2026-05-20 |
| Production PayMongo end-to-end purchase verified | ✅ verified 2026-05-20 — prod healthcheck green: sk_live_…Gyqh, NODE_ENV=production, PayMongo reachable ~500ms |

---

## Context for a cold reader

- **The 2026 pricing model is event-scoped.** Tala/Sinag/Dalisay are
  per-event one-time. Hiraya is the only user-level yearly tier. See
  [[project-plan-tiers-event-scoped]] memory.
- **Feature gating reads `events.plan` first**, with
  `users.subscription_tier` as a legacy fallback. So an event purchased
  as Dalisay keeps Dalisay features even if the owner later subscribes
  to Hiraya — and vice versa. The user-level tier only matters for
  (a) the event-creation quota and (b) Hiraya-only *account-wide* perks
  (which are currently unbuilt — see Phase 3).
- **Source-of-truth files**:
  - [backend/lib/plans.js](../backend/lib/plans.js) — plan definitions,
    `eventLimit`, feature flags
  - [backend/routes/payments.js](../backend/routes/payments.js) —
    `PAID_TIERS` (centavos), `applyTierUpgrade`
  - [backend/routes/events.js](../backend/routes/events.js) — create-gate
    (Tala lifetime, Hiraya rolling cap, paid-sub check)
  - [database/schema.sql](../database/schema.sql) — column DDL

---

## Phase 1 — Tell the truth in marketing (1 day, no engineering risk)

The fastest unlock is to stop selling perks that don't exist. From
[backend/lib/plans.js:138-147](../backend/lib/plans.js#L138):

> Matrix rows NOT enforced in code (intentionally) — these
> differentiate tiers in marketing but have no code gate yet:
> Wall style, White-label / "Your Logo", Data Export / Leads,
> Custom domain, Priority Processing.

**Actions:**
- Audit Hiraya bullets on [frontend/index.html](../frontend/index.html)
  pricing section, [frontend/pricing.html](../frontend/pricing.html) (if
  exists), and the upgrade cards in [frontend/start.html](../frontend/start.html).
- **Strip**: "Custom domain", "White-label / Your Logo", "Data Export /
  Leads", "Priority Processing".
- **Keep / amplify**: 10 events/year, 365-day galleries, 31-day upload
  window, audio notes + SDE + website on every event, multi-event
  creation under one account.
- **Add disclosure**: "₱9,990 billed yearly. No auto-renew — we'll
  email 30 days before expiry." (depends on Phase 2 actually shipping
  that email.)

---

## Phase 2 — Don't lose the renewal (3-4 days)

A yearly product without renewal infrastructure is a one-shot business.
Three pieces:

### 2a. Renewal reminder emails

New daily cron `backend/jobs/renewal-reminders.js`:

- **Schedule:** runs once daily (e.g. 9am Manila), processes all users
  with `subscription_tier='hiraya' AND subscription_expires_at IS NOT
  NULL`.
- **Thresholds:** T-30, T-7, T-0 days from `subscription_expires_at`.
- **Idempotency:** add `renewal_reminders_sent JSONB DEFAULT '{}'` to
  users; check `{t30, t7, t0}` keys before sending, write date on send.
  Survives re-runs and accidental cron double-fires.
- **Email content:**
  - T-30: "Your Hiraya year ends {date}" + summary of events created
    this cycle + one-click renew link
  - T-7: harder nudge, list events that lose Hiraya-tier *account-wide*
    features at lapse (galleries don't lose their 365-day window —
    `event.plan` is sticky — but new-event creation stops)
  - T-0: "Subscription expired" + renew CTA + reassurance that existing
    events are unaffected

Reuse existing email infrastructure (see how booking confirmation /
payment confirmation work in [backend/routes/payments.js](../backend/routes/payments.js)
and the email senders they import).

### 2b. Lapsed-sub UX, not silent 402

When `subscription_expires_at < NOW()` and user tries to create a new
Hiraya event, [events.js:172-179](../backend/routes/events.js#L172) returns
generic `payment_required`. Instead:

- Return `code: 'subscription_lapsed'` with `expired_at` field.
- Frontend [start.html](../frontend/start.html) `showUpgradePanel` adds
  a branch matching the Hiraya cap-reached pattern: "Your Hiraya year
  ended on {date} — renew for ₱9,990?" with a single renew CTA.
- On [/my-events](../frontend/my-events.html) add an amber dashboard
  banner: "Hiraya expired N days ago — renew" with the same CTA. Only
  shown when `user.subscription_tier === 'hiraya' && new
  Date(user.subscription_expires_at) < new Date()`.

### 2c. One-click renewal endpoint

`POST /api/payments/renew` — creates a Hiraya PayMongo checkout
pre-keyed to the logged-in user, skipping the wizard entirely. Returns
the checkout URL. Used by all three reminder emails and both lapsed-sub
UIs above.

Reuse [backend/routes/payments.js](../backend/routes/payments.js)
`POST /payments/create` — likely just a thin wrapper that hardcodes
`tier: 'hiraya'` and a `success_path` that drops back on `/my-events?renewed=1`.

---

## Why we skipped Phase 3 at launch (2026-05-20)

The original premise — "Hiraya needs a marquee perk to feel distinct
from Dalisay" — assumed Dalisay didn't have the event website. It does
([backend/lib/plans.js:104](../backend/lib/plans.js#L104)). So custom
domain was always going to be "domain on top of the website you already
get", not "you get a website". That's a much weaker differentiator.

Re-reading what Hiraya actually offers over Dalisay in code:

| Dimension | Dalisay | Hiraya |
|---|---|---|
| Events | 1 per ₱2,990 purchase | 10 per ₱9,990 yr (~₱999 each) |
| Gallery retention | 90 days | 365 days |
| Upload window | 7 days centered | 31 days centered |
| Feature flags | identical to Hiraya except customDomain | + customDomain (unbuilt) |

That's a **volume + retention** pitch. It's a real, defensible pitch
for coordinators/photographers/venues doing 4+ events/year. It's NOT a
pitch for individual couples — they'll correctly choose Dalisay.

**Launch strategy that follows from this:**
- Hiraya CTA stays OFF the public landing page (couples see Dalisay).
- Direct outreach to known coordinators; comp 3-5 friendly ones first.
- Phase 3 revisits after 30-60 days based on what those coordinators
  actually ask for — could be custom domain, multi-event dashboard,
  branded RSVP emails, etc. Building blind before that is wasted.

## Phase 3 — Ship one marquee perk so Hiraya feels distinct (1 week)

Right now a Hiraya event is "Dalisay with a longer window". To justify
₱2,990 → ₱9,990 (3.3× per-event jump if you only use it once) we need
one feature a coordinator can demo to their client.

| Perk | Effort | Value | Verdict |
|---|---|---|---|
| **Custom domain** on event website | M — Caddy/nginx SNI config + DNS verify flow + `events.custom_domain` column + UI to attach | High for venues/coordinators (their-brand.com/juans-wedding) | **Pick this.** Only item that's both visible and defensible. |
| **White-label** (hide Reelday branding on event site/QR) | S — single `branding_hidden` flag, swap a logo block | Medium — coordinators want it; couples don't care | Pair with custom domain — same audience |
| CSV export of RSVPs/uploads | S | Low — most won't use | Skip unless someone asks |
| Multi-event dashboard view (cross-event analytics) | M | Medium for 5+/yr coordinators | Skip until first 5 paying Hirayas |
| Priority video processing (SDE queue jump) | S engineering, big ops complexity | High ops cost for marginal gain | Skip — solve with capacity, not tiering |

**Recommendation: custom domain + white-label as a paired feature
(~1 week).** Wire `customDomain` from `plans.js` (already defined,
unread) into [backend/routes/event-site.js](../backend/routes/event-site.js).

**Plan for custom domain:**
1. Add `events.custom_domain VARCHAR(253) UNIQUE` + `events.custom_domain_verified BOOLEAN` to schema.
2. Server: accept `Host` header on `/e/:slug`, look up event by
   `custom_domain` first, fall back to slug routing.
3. Caddy/Easypanel: wildcard SAN cert OR on-demand TLS issuance for
   verified custom domains.
4. Verification flow: owner sets domain in dashboard, gets a TXT record
   to add, we verify via DNS lookup, flip `custom_domain_verified=true`.
5. Gate: only `event.plan === 'hiraya'` (or owner's `subscription_tier
   === 'hiraya'`) can set `custom_domain`.

**Plan for white-label:**
1. Add `events.branding_hidden BOOLEAN DEFAULT false`.
2. In [frontend/event-site.html](../frontend/event-site.html) and the
   wall, hide the "Powered by Reelday" footer/QR overlay when set.
3. Gate: only `planHasFeature(event.plan, 'customDomain')` (re-use the
   same Hiraya-only flag) can toggle it.

---

## Phase 4 — Soft launch (before any paid marketing)

- Confirm one full real Hiraya purchase end-to-end on production
  PayMongo. Right now I'm not sure if production keys are wired — verify
  the env vars / receipt webhook on the real PayMongo dashboard.
- Comp Hiraya to 3-5 friendly coordinators, ship Phase 3 perks, gather
  30 days of feedback.
- Then enable the Hiraya CTA on the landing page.

---

## Open questions

1. **Auto-renew or not?** Current flow is one-time PayMongo charge with
   manual renew. PayMongo supports subscriptions (recurring tokenized
   charges) — worth it? Tradeoff: lower churn vs. higher friction at
   first purchase (some Filipino users will balk at saving a card).
   **Default position: manual renew with strong reminders. Revisit
   after first cohort renewal rate is known.**

2. **Grace period after expiry?** Should a Hiraya user have, say, 14
   days post-expiry where they can still create events? Friendlier UX
   but harder to communicate. **Default: hard cutoff, but renewal email
   at T-0 includes a "renew now, your old events stay safe" reassurance.**

3. **Pro-rated upgrades?** If a Sinag user wants to switch to Hiraya
   mid-event, do they get credit for the Sinag purchase? **Default: no.
   Sinag is per-event, Hiraya is user-level — different products.**

---

## Files touched / to touch

| File | Phase | What |
|---|---|---|
| [backend/routes/payments.js](../backend/routes/payments.js) | 2c | Add `POST /payments/renew` |
| backend/jobs/renewal-reminders.js (new) | 2a | Daily cron |
| backend/lib/email-templates.js (or wherever they live) | 2a | Three new templates |
| [backend/routes/events.js](../backend/routes/events.js) | 2b | Differentiate `subscription_lapsed` from `payment_required` |
| [frontend/start.html](../frontend/start.html) | 2b | Lapsed-sub panel branch in `showUpgradePanel` |
| [frontend/my-events.html](../frontend/my-events.html) | 2b | Lapsed-sub banner |
| [frontend/index.html](../frontend/index.html) | 1 | Strip overstated perks |
| [database/schema.sql](../database/schema.sql) | 2a, 3 | `renewal_reminders_sent`, `custom_domain`, `branding_hidden` |
| [backend/routes/event-site.js](../backend/routes/event-site.js) | 3 | Custom-domain Host lookup, white-label render |
| [backend/lib/plans.js](../backend/lib/plans.js) | 1 | Update the "NOT enforced" comment block as flags get wired |

---

## Reference

- Memory: [[project-plan-tiers-event-scoped]] — 2026 pricing model
- Recent commits (May 2026): `0b39e2f` Sinag restore, `2a1a717` /
  `e34e374` dashboard tier theming, `4af83ad` cap UX, `e541fd8` Hiraya
  10/yr cap enforcement
