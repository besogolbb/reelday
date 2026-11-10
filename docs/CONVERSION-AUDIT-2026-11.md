# Reelday.ph — Conversion Audit & Turnaround Plan (FINAL v2)

**Date:** 2026-11-10 · **Status:** final. v2 replaces the first draft (§9 lists what the self-audit changed and why).
**Scope:** the whole journey from first visit to paid event, covering activation (sign-ups that never try anything), the free event-website lead magnet, and upgrading to paid.
**Method:** I read the code of every step a host goes through (`index.html` → `register.html` / `website-builder.html` → `start.html` → `dashboard.html` → `/api/uploads` → `/api/payments/create`) and the email code (`auth.js`, `jobs/wedding-website-drip.js`). Every claim below was checked against that code.
**Not yet done:** production numbers. Run §8 *before* shipping anything, so there's a baseline to measure against.
**Time budget:** written for evenings and weekends while the job search comes first. About 6–8 hrs/week, with three 2-week sprints plus a "later, only if data says so" list.

---

## 1. Diagnosis (one paragraph)

People sign up, but the product never gets them to the moment that sells it: **"I scanned the QR on my phone and my photo appeared on the big screen."** That moment is never set up for them. The free plan also discourages trying ("1 free event, ever", and a 48-hour demo window that starts when the event is created). When someone does want to pay, **most upgrade buttons send them to the homepage pricing section, which sells a new event instead of upgrading theirs.** A cancelled checkout also lands back on the homepage with no follow-up. Most new sign-ups get no follow-up email at all. And the site makes claims a careful buyer can catch: "2,140+ celebrations", "photos forever", the free website listed as a paid feature, and the main feature of the top tier labelled "coming soon".

---

## 2. The final funnel: two doors, one hallway, one checkout

```
 DOOR A — wall intent                 DOOR B — website intent
 Homepage hero                        /free-wedding-website, nav "Free website"
 "Try the live wall free"             "Make your free wedding website"
        │                                     │
   /start (3 steps,                     /website-builder (anonymous draft)
   account last, no plan step)          → Save (Google 1-tap or email)
        │                               → "Preview & publish" screen → share to guests
        └───────────────┬─────────────────────┘
                        ▼
        THE HALLWAY — event dashboard, first screen = "Test it now" card
        (30-min Test Session: scan with your phone → see it on the wall)   ← AHA
                        ▼
        Follow-up by behaviour + RSVP count + event date (§5)
                        ▼
        ONE CHECKOUT — in-event upgrade modal
        /dashboard?slug=X&upgrade=<tier>   (every CTA, every email, every page)
        cancel → back to the modal, with help · abandoned → reminder email after 1h
                        ▼
                    PAID EVENT
```

**Rules that keep it aligned**

1. **Every upgrade CTA goes to the in-event upgrade modal.** Nothing logged-in ever points at `/#pricing` or `/start?plan=`. The modal already upgrades the right event (`dashboard.html:7373`, `{slug, tier}`), and success already returns to the dashboard (`payments.js` `successUrl`).
2. **Every event starts free; you pay by upgrading it.** You never pay before the event exists. The only exception is a user who has already used their free event (`tala_used`), who still sees the plan step.
3. **The aha comes before the ask.** No pricing in onboarding. The first upgrade prompt appears after the first test upload or the first RSVPs.
4. **Every claim has to be true.** Anything you can't prove from the database or the code comes off the site.
5. **The activation metric:** events with ≥1 Test Session upload within 7 days of sign-up. If this number doesn't move, nothing after it will.

---

## 3. Verified findings, by stage

Severity: **P0** = losing money now · **P1** = big conversion drag · **P2** = polish.

### Acquisition / homepage
| Finding | Evidence | Sev |
|---|---|---|
| Hero sells the QR wall but every "Start free" opens the website builder | `index.html:1031-1053`, CTAs `href="/website-builder"` | P1 |
| "★★★★★ Trusted by 2,140+ celebrations across PH" is unverified | `index.html:1065` (check with §8 query E) | P0 if false |
| FAQ: "Do we keep the photos forever? Yes." Real retention is 24h (Tala) / 30d / 90d | FAQ vs `plans.js` `galleryDays` | P1 |
| Free website missing from the Tala card; listed as a Dalisay feature in pricing, `/start`, and the welcome email | `index.html:1359-1387`, `start.html:854-910`, `auth.js:58` | P1 |
| "Same Day Edit recap reel (coming soon)" on the flagship tier | pricing, `/start` | P2 |
| No human contact on pricing or checkout (no Messenger/Viber), no risk reversal | site-wide | P1 |

### Sign-up / onboarding
| Finding | Evidence | Sev |
|---|---|---|
| Google sign-ups get **no welcome email and no admin alert**, so your sign-up count is too low | `auth.js`: `sendWelcomeEmail`/`sendAdminNewUserEmail` only in `/auth/register` | P1 |
| Google sign-up on `/register` ignores `?next=` and dumps users on an empty `/my-events` | `register.html` `handleGoogleCredential` | P1 |
| `/start` asks for a plan before any value and labels Tala "1 free event, ever" | `start.html:854-910` | P1 |
| Builder save modal: no Google sign-in; an already-registered email dead-ends | `website-builder.html:600-620, 1511` | P1 |
| Builder save → unpublished draft → dense dashboard. Unpublished sites get no drip and no guest traffic | `website-builder.html:1562`, drip `WHERE is_published` | P1 |

### Activation
| Finding | Evidence | Sev |
|---|---|---|
| No guided test. "Test upload" is checklist row 6 of 7 with no button | `dashboard.html:5165` | P1 |
| **The phone self-test is blocked after 48h.** Scanning your own QR on a phone counts as a *guest* upload, and guest uploads only work in the demo window (48h from `created_at`). The host bypass only applies when logged in on the same device | `uploads.js:327-378`, `plans.js:216` | P1 |
| Tala demos the weakest product (photos only, static wall, 25 cap) | `plans.js` tala features | P1 |

### Upgrade / checkout
| Finding | Evidence | Sev |
|---|---|---|
| Builder "Unlock guest experience" → `/#pricing` → `/start?plan=` → **pays for a new event** | `website-builder.html:1381`, `start.html:1558-1570` | **P0** |
| Drip t-30 / t-7 "money emails" CTA → `https://reelday.ph/#pricing` (same broken path) | `wedding-website-drip.js` `pricingUrl` | **P0** |
| Account page upgrade CTA → `/#pricing` | `account.html:484` | P0 |
| **Cancelled/abandoned checkout → `cancel_url = /#pricing`** (homepage). No recovery, no reminder | `payments.js` `cancelUrl` | **P0** |
| PayMongo line item says "account upgrade" for what is a per-event purchase | `payments.js` `description` | P2 |
| Dashboard website card says "Upgrade to unlock photo/video uploads", but Tala has photo uploads | `dashboard.html:8557` | P2 |

### Nurture & measurement
| Finding | Evidence | Sev |
|---|---|---|
| Only *published* Tala sites get emails. `/start` and Google users get nothing after the welcome email. Nothing between day 0 and t-30 (can be months) | `wedding-website-drip.js` | P1 |
| GA4 only tracks builder events. No `sign_up`, `event_created`, `test_upload`, `wall_opened`, `checkout_started` | grep `gtag('event'` | P1 |

**What already works (keep it):** the in-event upgrade modal and its success redirect, `/login?next=` handling (so email deep links survive a login), the anonymous builder draft, the RSVP flow, the "Powered by Reelday" footer, coupon infrastructure, and PayMongo GCash/Maya/QRPh.

---

## 4. The fixes, designed

### 4.1 One checkout (fixes all P0s)
- **Deep link:** `/dashboard?slug=X&upgrade=<tier>` opens the upgrade modal with that tier pre-selected. Add a small reader next to `openUpgradeModal()` (`dashboard.html:7138`).
- **Every CTA uses it:** builder upsell panel, drip t-30/t-7 (`pricingUrl` becomes per-event), account page, dashboard website card.
- **Logged-in homepage pricing:** if the user has exactly one Tala event, "Choose Dalisay" becomes "Upgrade *Ana & Miguel* →" (deep link). With several events, link to `/my-events?upgrade=<tier>`, where they pick the event. Logged-out visitors keep the current links.
- **Cancel:** `cancel_url` becomes `/dashboard?slug=X&checkout=cancelled`. Show a small card: "Payment didn't go through? Try GCash QR, or message us — Benz will help." with a Messenger button.
- **Abandoned-checkout email:** a `payments` row still `pending` after 1h → one email: "Your Dalisay upgrade for *{event}* is waiting" plus the deep link. Send once (same claim-before-send pattern as the drip, so it can't double-send).
- Line item: `Reelday Dalisay — {event name}`.

### 4.2 Test Session (fixes activation)
Replaces the 48h-from-creation idea. It works from the host's own phone because it opens the guest window on demand.
- The dashboard's first card for any event with 0 uploads: **"See it work in 60 seconds."** A **Start test** button opens a 30-minute test session: the guest upload page works for anyone, **all features are unlocked** (video, cinematic wall, reactions), and the wall shows a **"TEST" watermark**. The card shows the QR big enough to scan, plus "Open the wall on your laptop/TV".
- On the first upload: confetti and "That's exactly what your guests will see." Then: **"For your real day, unlock videos, reactions & the cinematic wall →"** (deep-link upgrade). This is the first upgrade prompt, at the moment they want it most.
- **Guardrails:** max 15 uploads per session, max 3 sessions per event, test uploads tagged `is_test`, excluded from the 25-photo limit and auto-deleted after 24h. The watermark makes it useless for running a real event.
- Existing Tala event-day rules stay the same (the actual free event).
- Copy: "1 free event, ever" becomes **"Your first event is free. Test as many times as you like."**

### 4.3 Doors
- **Door A, homepage hero.** Keep the wall pitch (it's what people pay for):
  - H1: *"Every shot. Every guest. One QR."*
  - Sub: *"Guests scan, upload, and see it live on the big screen — no app."*
  - Primary CTA: **"Try the live wall free →"** to `/start`
  - Secondary: **"Free wedding website →"** to `/free-wedding-website`
  - Under the buttons: *"Free to start · No card · Pay only when you want video & live wall"*
- **Door B, lead magnet.** Nav item "Free website" → `/free-wedding-website` → builder. Builder save modal gets **Google 1-tap**. An already-registered email gets **"Log in to save"**, which keeps the draft in localStorage (it's already re-read on load).
- **After saving in the builder:** a **"Preview & publish"** screen: phone preview of their site, one big **Publish & share** button, then share sheet (Messenger / Viber / copy link). Publishing stays a deliberate click (existing code rule: content never goes live before the host has reviewed it). After publishing, show the Test Session card.
- **`/start`:** type → names → date → account (if logged out). Remove the plan step, except for `tala_used` users. Finish on the dashboard with the Test Session card.

### 4.4 Trust & offer (copy-only, ship with Phase 0)
- Hero proof line: replace "2,140+" with a number you can prove, or *"Made in Laguna for Filipino celebrations · Live at andrea-jm"* (link to the live example).
- **Guarantee** on pricing cards and in the upgrade modal: *"Gumana o refund. If the wall doesn't run on your event day, full refund."* Refunds already exist in admin.
- **Messenger + Viber** "Ask Benz" button on pricing, upgrade modal, checkout cancel card, and every email footer.
- **Pricing cards:**
  - Tala, first bullet: "Free event website + RSVP".
  - Remove "Full event website" from Dalisay.
  - Remove "coming soon" from Dalisay (or show "SDE recap reel — beta").
  - Under Dalisay: *"Most couples pick Dalisay · ≈ ₱20 per guest for 150 guests"*.
- FAQ retention answer: *"Download a full-res .zip anytime. Gallery stays online 24h (Tala), 30 days (Sinag), 90 days (Dalisay)."*

---

## 5. Follow-up emails (one engine, three triggers)

One job (an extension of `wedding-website-drip.js`, same claim-before-send pattern). Every email: one CTA (deep link), a plain-text feel, signed "Benz, founder — reply anytime", plus a Messenger link.

| Trigger | Email | CTA |
|---|---|---|
| **Behaviour:** signed up, no event after 24h | "Your wall is 60 seconds away" (GIF: phone → TV) | `/start` |
| **Behaviour:** event, no test upload after 24h | "Try this: scan your own QR" | dashboard, Test Session |
| **Behaviour:** site saved, unpublished after 48h | "Your website is ready — one tap to go live" | builder Preview & publish |
| **Behaviour:** checkout pending 1h | "Your upgrade is waiting" | upgrade deep link |
| **RSVP milestone:** 10 / 25 / 50 RSVPs | "25 guests are coming 🎉 — let them send photos & video greetings too" | upgrade deep link |
| **Date:** t-60 | Real event story (andrea-jm) + "what guests see" | live demo |
| **Date:** t-30 *(existing; fix CTA)* | Money email + ₱300-off coupon valid 72h | upgrade deep link |
| **Date:** t-7 *(existing; fix CTA)* | "One week to go — setup is a QR code" | upgrade deep link |
| **Paid, t+1** | Thank-you + testimonial ask + "Give ₱300, get ₱300" | review / referral |

**Welcome email rewrite** (also sent to Google sign-ups): drop the limits table. Subject: *"Kamusta {name} — see your wall work in 60 seconds"*. One CTA: the dashboard Test Session (or `/start` if no event yet).

---

## 6. Execution plan (sized for ~6–8 hrs/week)

### Sprint 0 — Baseline & stop the leaks (this week + next, ~12.5 hrs)
| # | Task | Hrs |
|---|---|---|
| 0.1 | Run §8 SQL and record the baseline numbers in this doc | 0.5 |
| 0.2 | GA4 events: `sign_up{method}`, `event_created{source}`, `test_upload`, `wall_opened`, `upgrade_modal_open{trigger}`, `checkout_started`, `checkout_cancelled` (`purchase` already exists) | 1.5 |
| 0.3 | **One checkout:** `?upgrade=` deep link; fix builder, drip, account, and dashboard website-card CTAs; `cancel_url` back to the dashboard | 2.5 |
| 0.4 | Google sign-up → welcome email + admin alert + respect `?next=` | 0.5 |
| 0.5 | Copy & trust pass (§4.4) + hero CTA relabel (§4.3 Door A) + Messenger/Viber button | 1.5 |
| 0.6 | **Personal outreach** to every sign-up from the last 60 days (§7), log replies | 1 + replies |
| 0.7 | **Lead-funnel bugs** (`LEAD-FUNNEL-AUDIT-2026-11.md` L1–L3): draft lost when the email is already registered, logged-in visitors bounced off the builder, `tala_used` dead end, seat finder on with no seats, footer link → `/free-wedding-website` + UTM, builder analytics | 5.5 |

### Sprint 1 — Activation + builder redesign (weeks 2–4, ~23 hrs)
| # | Task | Hrs |
|---|---|---|
| 1.1 | Test Session: backend (`test_session_until`, `is_test` uploads, limits, 24h cleanup) | 4 |
| 1.2 | Test Session: dashboard card, QR, confetti on first upload, wall "TEST" watermark, post-aha upgrade prompt | 4 |
| 1.3 | `/start`: remove plan step (keep for `tala_used`), end on Test Session | 1.5 |
| 1.4 | **Builder redesign "Website in 60 seconds"** (`LEAD-FUNNEL-AUDIT-2026-11.md` §4, L4–L6): 2-field Quick Start → full-screen preview → Google 1-tap save → Publish & share → optional "Make it yours" checklist with row inputs instead of pipe syntax | 13 |

### Sprint 2 — Follow-up & recovery (weeks 5–6, ~13.5 hrs; includes lead-funnel L7–L8)
| # | Task | Hrs |
|---|---|---|
| 2.1 | Welcome email rewrite | 1 |
| 2.2 | Behaviour triggers (no event / no test / unpublished) | 3 |
| 2.3 | Abandoned-checkout email | 1.5 |
| 2.4 | RSVP-milestone emails | 2 |
| 2.5 | t-60 story email + t-30 coupon + t+1 testimonial/referral | 2.5 |

### Later — only if the numbers say so
| Idea | Do it when… |
|---|---|
| ₱499–799 "Event-Day Pass" coupon test (birthdays/christenings) | activation ≥ 30% but free→paid stays low and outreach replies say "too expensive" |
| Coordinator pilot (10 coordinators, comped Hiraya ×2 events) | the one-checkout flow is stable and you have ≥ 3 real testimonials |
| Ship `/make-my-event` for paid traffic | Sprints 0–2 are live (otherwise it feeds people into the old leaks) |
| Real-wall hero video (Remotion) | you have footage from a real event with permission |

---

## 7. Founder outreach (Sprint 0.6, the fastest feedback you can get)

> Hi {first name}! Si Benz ito, founder ng Reelday 👋 Nakita kong nag-sign up ka para sa {event / "your event"}. Kailan ang event mo, at may tanong ka ba? Kung gusto mo, sabay nating i-test ang wall mo in 5 mins over video call — libre — para makita mo mismo bago ang araw mo. 🙂

Log every reply (event date, guest count, objection) in `docs/lead-tracker-template.csv`. What the answers mean:
- **"Too early / malayo pa"** → follow-up timing matters most (Sprint 2 first).
- **"Hindi ko na-gets / didn't try"** → activation (Sprint 1 first).
- **"Mahal / too expensive"** → offer (the Event-Day Pass test).
- **"Saan ako magbabayad / paano i-upgrade"** → confirms the P0s.

---

## 8. Baseline queries (run on the production DB before Sprint 0 ships)

```sql
-- A. Funnel by signup cohort (last 90 days)
WITH u AS (
  SELECT id, created_at, (google_id IS NOT NULL) AS via_google
  FROM users WHERE created_at > NOW() - INTERVAL '90 days'
)
SELECT
  COUNT(DISTINCT u.id)                                             AS signups,
  COUNT(DISTINCT u.id) FILTER (WHERE via_google)                   AS google_signups,
  COUNT(DISTINCT e.user_id)                                        AS created_event,
  COUNT(DISTINCT e.user_id) FILTER (WHERE es.is_published)         AS published_site,
  COUNT(DISTINCT e.user_id) FILTER (WHERE up.n > 0)                AS any_upload,
  COUNT(DISTINCT e.user_id) FILTER (WHERE up.n >= 5)               AS five_plus_uploads,
  COUNT(DISTINCT e.user_id) FILTER (WHERE e.is_paid)               AS paid
FROM u
LEFT JOIN events e       ON e.user_id = u.id
LEFT JOIN event_sites es ON es.event_id = e.id
LEFT JOIN LATERAL (SELECT COUNT(*) n FROM uploads WHERE event_id = e.id) up ON true;

-- B. Builder door vs /start door
SELECT (es.config IS NOT NULL AND es.config <> '{}'::jsonb) AS via_builder,
       COUNT(*) events,
       COUNT(*) FILTER (WHERE es.is_published) published,
       COUNT(*) FILTER (WHERE e.is_paid)       paid
FROM events e LEFT JOIN event_sites es ON es.event_id = e.id
WHERE e.created_at > NOW() - INTERVAL '90 days' GROUP BY 1;

-- C. Lead time: days from creation to event (drives follow-up timing)
SELECT width_bucket((event_date - created_at::date), 0, 360, 6) AS bucket_60d, COUNT(*)
FROM events WHERE created_at > NOW() - INTERVAL '90 days' AND event_date IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- D. Checkout intent vs completion
SELECT status, plan, COUNT(*) FROM payments
WHERE created_at > NOW() - INTERVAL '90 days' GROUP BY 1,2 ORDER BY 1,2;

-- E. Verify the homepage "2,140+ celebrations" claim
SELECT COUNT(*) AS all_events, COUNT(*) FILTER (WHERE is_paid) AS paid_events FROM events;
```

**Targets (8 weeks after Sprint 0):**

| Metric | Definition | Target |
|---|---|---|
| Activation | sign-ups with a test upload ≤ 7 days | ≥ 35% |
| Publish rate | builder sign-ups with a published site | ≥ 50% |
| Checkout completion | succeeded / created payments | ≥ 60% |
| Free → paid | events whose date has passed that paid | ≥ 5% (stretch 10%) |

Check weekly. **If activation rises but paid doesn't**, the problem is the offer or trust (Later list). **If activation doesn't rise**, compare `test_upload` with `wall_opened` in GA4 to see whether people find the card but don't complete the test.

---

## 9. Self-audit: what changed from the v1 draft and why

| v1 said | Problem found | v2 decision |
|---|---|---|
| Demo window starts at the first upload | The host's phone scan is a *guest* upload, blocked outside the demo window. The window would never open for the test that matters (`uploads.js:327-378`) | On-demand **Test Session** (§4.2) |
| Unlock all features during the demo | Someone could run a real small event inside the demo | 30-min sessions, 15-upload cap, **TEST watermark**, 3 sessions max |
| Publish the builder site on save | Breaks the existing rule that content never goes live before the host reviews it (`website-builder.html:1562` comment) | **Preview & publish** screen, publish stays one deliberate tap |
| Hero rework, guarantee, Messenger in Phase 3 | These are copy and link changes for high-severity problems; waiting wastes traffic | Moved to **Sprint 0** |
| "Lock banner says 50 uploads" | False positive: JS overwrites it with the real limit (`dashboard.html:5439`) | Dropped |
| Upgrade-routing fix covered builder + drip only | Missed **checkout cancel → homepage** and no abandoned-checkout recovery (`payments.js` `cancelUrl`) | Added to the one-checkout design |
| Remove the plan step from `/start` | Would break users whose free event is already used | Keep it **only** for `tala_used` users |
| Logged-in pricing → "Upgrade *event*" | Ambiguous for users with several events | One Tala event → deep link; several → `/my-events?upgrade=` picker |
| Free→paid target 8–10% | Optimistic as a first target | 5% target, 10% stretch |
| ~25 tasks, no sizing | Doesn't fit evenings/weekends during the job search | 3 sized sprints (~29 hrs) + a "Later, only if data says" list |
| Ship fixes, then measure | No baseline means you can't tell what worked | Baseline SQL + GA4 events are Sprint 0 steps 1–2 |
| Event-Day Pass, coordinator pilot, `/make-my-event` as plan items | Unproven; risk of building before you have evidence | Moved to "Later", each with a condition for when to do it |
