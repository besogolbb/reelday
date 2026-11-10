# Reelday.ph — Conversion Audit & Turnaround Plan

**Date:** 2026-11-10 · **Scope:** the whole client journey from first visit to paid event, covering activation (sign-ups that never try anything), the free event-website lead magnet, and upgrading to paid.
**Method:** I read the code of every step a host goes through (`index.html` → `register.html` / `website-builder.html` → `start.html` → `dashboard.html` → `/api/payments/create`), plus the email code (`auth.js` welcome email and `jobs/wedding-website-drip.js`).
**Not done yet:** I did not query production data. Section 7 has the SQL to run. Every finding below comes from the code, so the numbers in section 7 will show which leaks cost the most.

---

## 1. Executive summary

People sign up, but the product never gets them to the moment that sells it: **a photo from their own phone appearing on the live wall.** When someone does want to pay, the path often breaks. There are five root causes:

1. **The homepage and the product promise two different things.** The hero sells a live wall: "Every shot. Every guest. One QR." Every "Start free" button opens a wedding-website form. People who came for the wall get a website builder. People who came for the website read about a QR wall first.
2. **The free plan punishes people for trying it.** Tala is shown as *"1 free event, ever"*, and that one event is supposed to be both the test and the real party. So people don't test, because a test would use up their only free event. The 48-hour demo window also starts when the event is created. For a website built 6 months before a wedding, it expires before anyone thinks about the wall.
3. **The upgrade buttons lead to the wrong place (P0 bug).** "Unlock guest experience" in the builder, and the CTAs in the t-30 and t-7 "money" emails, all point to `/#pricing`. From there, "Choose Sinag/Dalisay" opens `/start?plan=…`, which **pays for a brand-new event** instead of upgrading the one the host already built. The website and RSVPs stay on the free event. A host who wants to pay either gets confused or buys the wrong thing.
4. **Most new sign-ups get no follow-up.** The upsell emails only go to hosts with a *published* free site, but the builder saves new sites as *unpublished drafts*. People who sign up through `/start` or Google get no activation emails at all. Google sign-ups also get **no welcome email and no admin alert**, so your own sign-up count is too low.
5. **Pricing and trust claims contradict each other.** Dalisay lists "Full event website" as a paid feature even though the website is free. The welcome email says the same. The FAQ says "Do we keep the photos forever? **Yes**", but Tala keeps them 24 hours and Sinag 30 days. The flagship tier lists its headline feature (SDE) as "coming soon". The hero shows **"★★★★★ Trusted by 2,140+ celebrations"**. If that number isn't real, it's a liability (see §5).

**The turnaround in one sentence:** fix the broken upgrade path this week, give every new user a free test that doesn't cost their real event, walk them to "it's on the wall!" in their first 5 minutes, then follow up with emails timed to their event date and a personal Messenger/Viber message from you.

---

## 2. The journey, stage by stage, with leak points

```
Visit ─► Sign up ─► Event created ─► TRIED IT (aha) ─► Shared w/ guests ─► Upgrade intent ─► Checkout ─► Paid
  L1        L2            L3                L4                  L5                 L6             L7
```

| # | Stage | What happens today | Leak | Severity |
|---|---|---|---|---|
| L1 | Homepage → CTA | Hero pitches the QR wall; CTA opens the website builder (`index.html:1031-1053` vs `href="/website-builder"`) | Mismatch between promise and product | **High** |
| L2 | Sign-up | `register.html` → `/start`; **Google** sign-up ignores `?next=` and lands on an empty `/my-events` (`register.html` `handleGoogleCredential`) | Google users skip onboarding | Medium |
| L2 | Sign-up | Builder save modal has email+password only, **no Google button**. An already-registered email dead-ends with "check your email… then log in" (`website-builder.html:1511`) | Friction at the most valuable moment | Medium |
| L3 | Create event | `/start` asks for **plan choice before any value** ("Paid plans go through a quick checkout") and labels Tala "1 free event, ever" (`start.html:854-910`) | Choice paralysis, fear of using up the free event | **High** |
| L4 | First try | No guided "test it now" moment. The dashboard checklist has "Test upload" as row 6 of 7 with no button (`dashboard.html:5165`). The demo window is 48h from creation | No aha moment → no upgrade desire | **Critical** |
| L4 | First try | Tala is photo-only, 25 photos, static wall. Video, the most emotional part, can't be tried | The demo shows the weakest version | High |
| L5 | Website publish | Builder saves the site **unpublished** and redirects to the dashboard. The host has to find "Publish now" | Unpublished sites get no drip emails, no guest traffic, no viral footer | **High** |
| L6 | Upgrade intent | Builder upsell → `/#pricing` (`website-builder.html:1381`). Homepage pricing has no logged-in variant | Leaves the host's event context | **Critical** |
| L6 | Upgrade intent | Drip emails t30/t7 CTA → `https://reelday.ph/#pricing` (`wedding-website-drip.js`) | Same broken path, in the "money email" | **Critical** |
| L7 | Checkout | `/start?plan=sinag` creates a **new** event after payment (`start.html:1558-1570`, `success_path: 'start_resume'`) | Host pays for the wrong event and gets support pain or a refund | **Critical** |
| L7 | Checkout | No guarantee, no human to ask, no Messenger link. ₱1,490–₱2,990 from a brand with no visible reviews | Trust gap at the moment of payment | High |
| — | Nurture | Nothing between day 0 and t-30 (could be 6+ months for weddings). `/start` and Google sign-ups get nothing at all | Leads go cold | High |
| — | Measurement | GA4 only tracks builder events. No `sign_up`, `event_created`, `first_upload`, `wall_opened`, `checkout_started` | You can't see where people drop off | High |

The dashboard's own upgrade modal (`dashboard.html:7373`) is fine: it intercepts `/#pricing` and upgrades **this** event via `{ slug, tier }`. The fix for L6/L7 is to send every upgrade CTA through that path.

---

## 3. Why new sign-ups don't upload or try anything (activation)

This is the biggest leak, because everything after it depends on it.

**3.1 The aha moment is never staged.** Reelday's value is felt, not read: *scan QR → photo appears on the TV with your name.* To feel it, a host needs two screens (phone + laptop) and someone has to tell them to do it. Today nobody does. The checklist leads with venue, welcome message, and music, which are admin chores, and "Test upload" has no action button.

**3.2 Scarcity aimed the wrong way.** "1 free event, ever" makes a rational host think: *"I'll save my free event for the real party."* So they create nothing, or create the event and never touch it. The 48-hour demo window makes it worse because it starts at creation, not when they're ready.

**3.3 The free tier demos the weakest product.** Photos only, static slideshow, 25 photos. Video greetings, the cinematic wall, reactions, and polls are what make people say "wow", and none of them can be tried for free.

**3.4 Too many steps before value.** Path A: register (4 fields) → `/start` (type → names → date → **plan** → personalize) → dashboard. Path B (Google): sign up → empty `/my-events`. Neither ends with "scan this now".

**3.5 The welcome email talks about features, not the next step.** It lists limits ("Up to 25 photos", "24-hour retention"), upsells Dalisay with "event website" (which is free), and links to `/dashboard` with no slug. Google users don't receive it at all.

### Fix: a "Try the wall in 60 seconds" sandbox

- On first dashboard load, and as the last step of `/start` and the builder save, show **one full-screen card**: *"See it work — scan this with your phone."* It shows a QR for the host's event, the wall opens in a new tab, and when the first upload arrives the card turns into confetti and *"That's what your guests will see."* Track `first_upload` and `wall_opened`.
- **Test uploads don't count.** Host uploads during the first session (or uploads flagged `is_test`) don't count toward the 25 limit. Add a "Clear test photos" button.
- **Reword the scarcity.** Change "1 free event, ever" to *"Free for your first event — test as much as you like."* Keep the real one-event guard. The goal is to stop people being afraid to start.
- **Demo window = 48h from the first upload**, or reopenable once, instead of 48h from creation.
- **Unlock everything during the demo.** Video, cinematic wall, reactions, and one poll work during the 48h demo, watermarked "DEMO". The paid tier unlocks the same features for the real day. People buy what they've already seen work.

---

## 4. Why the lead magnet (free event website) isn't converting

The website builder is well built (anonymous draft, live preview, 4 templates, RSVP, seat finder, viral footer). The problems are what happens before and after it.

1. **Traffic doesn't match intent.** The homepage sells the wall, so builder visitors often came for the wall. People who *do* want a free wedding website mostly reach `/free-wedding-website`, but `robots`/SEO work is recent, so organic traffic is likely still thin. Check GA4 sessions per landing page.
2. **The save step goes to the dashboard, not to "your site is live".** The highest-intent moment, when someone has just built something they love, ends on a dense dashboard with the site still an unpublished draft. Instead, **publish on save** (or show a "Publish & share" screen with a preview, a copy-link button and Messenger/Viber share buttons). Sharing is what triggers RSVPs, which in turn trigger the drip and the viral footer.
3. **No Google sign-in on the save modal.** Most PH mobile users would take one tap over three fields.
4. **The upsell is generic and comes too early.** The upgrade panel shows immediately, links away to `/#pricing`, and the CTA path breaks (L6/L7). A couple who is 8 months out isn't ready to buy, and when they are ready, the button doesn't work.
5. **The event's free plan expires on the website's timeline.** The website lives for months but the Tala wall demo expires in 48h, so the "try the wall" hook is gone by the time it matters.
6. **No reason to come back between now and t-30.** Nothing pulls the couple back to Reelday during the months they spend planning. Each RSVP is a natural reason to email them (see §6 Phase 2).
7. **`/make-my-event` (uncommitted WIP) isn't live yet** (404 in production). It's a good idea: it qualifies by date and guest count and captures email before the builder. Ship it only after the P0 fixes, or it will feed more people into the same broken path.

---

## 5. Pricing, packaging & trust

| Issue | Where | Fix |
|---|---|---|
| Dalisay lists "Full event website" as a paid feature | `index.html` pricing, `start.html:854-910`, welcome email | Replace with "Free event website ✓" on **every** tier, starting with Tala. The free website should be the first line of the free card |
| Tala card doesn't mention the free website at all | `index.html:1359` | First bullet: "Free event website + RSVP" |
| "Do we keep the photos forever? Yes." | FAQ, `index.html:1468+` | Make it accurate: "Download everything as a .zip. Gallery stays online 24h (Tala) / 30 days (Sinag) / 90 days (Dalisay)" |
| "Same Day Edit recap reel (coming soon)" on the flagship tier | pricing | Remove until shipped, or change to "Beta: SDE recap reel included". "Coming soon" on the thing you're selling hurts trust |
| **"★★★★★ Trusted by 2,140+ celebrations across PH"** | hero, `index.html:1065` | **Verify against `SELECT COUNT(*) FROM events`.** If not real, remove it now. Under the Consumer Act (RA 7394), misleading claims are a liability, and a buyer who can't find a single review will distrust the whole page. Replace with something true: "Built in Laguna for Filipino celebrations", a real event count, or 2-3 named testimonials with photos from andrea-jm and other real events |
| Lock-banner placeholder says "all 50 uploads" when the limit is 25 | `dashboard.html:3586` | Small fix, but it's inconsistent |
| Dashboard website card: "Upgrade to unlock photo/video uploads" | `dashboard.html:8557` | Tala *has* photo uploads. Say "unlock video, the cinematic wall and reactions" |
| Big jump from ₱0 to ₱1,490 with no risk reversal | checkout | Add **"Gumana o refund — if the wall doesn't run on your event day, full refund."** You control the product, so the risk is low and the effect on conversion is high |
| No human channel | site-wide | Add a **Messenger + Viber "Ask us anything"** button on pricing, dashboard and checkout. PH buyers paying ₱1.5–3k usually want to chat with someone before paying |

**Packaging experiment (Phase 3):** test a **₱499–₱799 "Event-Day Pass"**: unlimited photos + videos for event day only, 7-day gallery, no polls or SDE. It's a low-commitment first purchase for birthdays and christenings and bridges the ₱0→₱1,490 jump. Run it as a coupon on Sinag first (the coupon system already exists) to test demand before building a tier.

**B2B angle (where the repeat revenue is):** couples buy once. Coordinators, photographers and venues buy every month. Hiraya is still hidden behind `HIRAYA_PUBLIC`. Once activation is fixed for single-event hosts, go after 10 coordinators by hand: free comped Hiraya for their next 2 events in exchange for putting the QR poster on their tables and a testimonial. Each coordinator brings 2-4 events a month of qualified guests who see the wall live. This builds on the supplier-led plan in `MARKETING-PLAN.md`.

---

## 6. Turnaround plan

### Phase 0 — Stop the bleeding (this week, ~2 evenings)

| # | Task | File(s) | Effort |
|---|---|---|---|
| 0.1 | **Fix upgrade routing.** Every logged-in upgrade CTA (builder panel, drip emails, account page) goes to `/dashboard?slug=<slug>&upgrade=1`, which opens the existing in-event upgrade modal (`{slug, tier}` → `/api/payments/create`). Make the dashboard read `?upgrade=1` | `website-builder.html:1381`, `wedding-website-drip.js` (pricingUrl → per-event URL), `dashboard.html` (auto-open modal) | S |
| 0.2 | Homepage pricing for **logged-in users with a Tala event**: change "Choose Sinag/Dalisay" to "Upgrade *<event name>*" with the same deep link | `index.html` | S |
| 0.3 | Send the welcome email **and admin alert** for Google sign-ups too | `auth.js` `/auth/google` (new-user branch) | XS |
| 0.4 | Google sign-up respects `?next=` and defaults to `/start`, not `/my-events` | `register.html`, `login.html` | XS |
| 0.5 | Fix the claims: remove or verify "2,140+", fix the FAQ "forever" answer, move "Free event website" onto Tala, remove "coming soon", fix the "50 uploads" copy and the "unlock photo uploads" copy | `index.html`, `start.html`, `auth.js` welcome email, `dashboard.html` | S |
| 0.6 | Add GA4 events: `sign_up` (method), `event_created` (plan, source), `first_upload`, `wall_opened`, `upgrade_modal_open`, `checkout_started`. `purchase` already exists | register/start/dashboard/wall | S |
| 0.7 | **Message every sign-up from the last 60 days by hand** (Messenger/Viber/SMS if you have their phone, otherwise email) using the script in §8 | — | 2 hrs |

### Phase 1 — Activation (weeks 2–3)

| # | Task | Expected effect |
|---|---|---|
| 1.1 | "Try the wall in 60 seconds" full-screen card on the first dashboard visit + at the end of `/start` and builder save (QR + open-wall button + confetti on first upload) | Biggest single lift in activation |
| 1.2 | Test uploads don't count toward the limit, plus a "Clear test photos" button | Removes the fear of trying |
| 1.3 | Demo window starts at the first upload, not at creation. All features unlocked (watermarked) during the demo | People experience video and reactions before paying |
| 1.4 | Change "1 free event, ever" to "Free for your first event — test as much as you like" | Fewer people skip creating an event |
| 1.5 | Shorten `/start`: **remove the plan step** (default Tala, upgrade later from the dashboard). Keep `?plan=` for direct paid links | Fewer steps before value |
| 1.6 | Builder: Google sign-in on the save modal. **Publish on save** → "Your site is live — share it" screen with Messenger/Viber/copy buttons | More published sites, so the drip and viral loop actually run |
| 1.7 | Reorder the dashboard checklist: **Test upload (with QR button)** → Share link → details. Chores go last | Puts the aha step first |

### Phase 2 — Lifecycle emails & nurture (weeks 3–5)

Add an **activation track** (based on behaviour) next to the existing **event-date track** (based on the event date):

| Trigger | Email | CTA |
|---|---|---|
| Signed up, no event after 24h | "Your wall takes 60 seconds — here's a 20s video of it working" | `/start` |
| Event created, 0 uploads after 24h | "Try this: scan your own QR" (GIF of a phone → TV) | dashboard, test card open |
| First upload happened | "That's the magic. Here's what it looks like with 80 guests + videos" | dashboard upgrade modal |
| Site published, every 5 new RSVPs | "12 guests have RSVP'd 🎉 — want them to also send photos?" | in-event upgrade |
| Site saved but unpublished, 48h | "Your website is ready — one tap to go live" | builder |
| t-60 | Real wedding story / mini case study (andrea-jm) | live demo |
| t-30 / t-7 (existing) | Keep, but CTA → **in-event upgrade** + a time-limited coupon (e.g. ₱300 off, 72h) | in-event upgrade |
| t+1 (paid) | Testimonial + referral ask ("Give ₱300, get ₱300") | review / referral |

Every email also includes "Reply or message us on Messenger — Benz, founder." For small volumes, replies are the best conversion channel you have.

### Phase 3 — Offer, proof & channel (weeks 5–8)

1. **Refund guarantee** on the pricing cards and checkout.
2. **Real social proof:** 3 testimonials with photos, plus a 30-second screen recording of a real wall on the hero. Use the Remotion pipeline (`tools/wall-recorder`).
3. **Split the homepage by intent:** make the hero about the live wall (what people pay for) with "Try the wall free". Give the free website its own entry (`/free-wedding-website`, "Free website" in the nav), each with a matching CTA.
4. **Test the Event-Day Pass** (₱499–₱799 coupon on Sinag) for birthdays and christenings.
5. **Coordinator pilot:** 10 coordinators, comped Hiraya for 2 events, QR posters at events, testimonial in exchange.
6. Then ship `/make-my-event` as the paid-traffic landing page.

---

## 7. Measurement — run these first (production DB)

The repo can't read production data from here, so run these on the VPS (`psql`) and record the numbers in this doc as the baseline.

```sql
-- A. Funnel by signup cohort (last 90 days)
WITH u AS (
  SELECT id, created_at, (google_id IS NOT NULL) AS via_google
  FROM users WHERE created_at > NOW() - INTERVAL '90 days'
)
SELECT
  COUNT(*)                                                         AS signups,
  COUNT(*) FILTER (WHERE via_google)                               AS google_signups,
  COUNT(DISTINCT e.user_id)                                        AS created_event,
  COUNT(DISTINCT e.user_id) FILTER (WHERE es.is_published)         AS published_site,
  COUNT(DISTINCT e.user_id) FILTER (WHERE up.n > 0)                AS any_upload,
  COUNT(DISTINCT e.user_id) FILTER (WHERE up.n >= 5)               AS five_plus_uploads,
  COUNT(DISTINCT e.user_id) FILTER (WHERE e.is_paid)               AS paid
FROM u
LEFT JOIN events e       ON e.user_id = u.id
LEFT JOIN event_sites es ON es.event_id = e.id
LEFT JOIN LATERAL (SELECT COUNT(*) n FROM uploads WHERE event_id = e.id) up ON true;

-- B. Did they come in through the builder (site config present) or /start?
SELECT (es.config <> '{}'::jsonb) AS via_builder, COUNT(*) events,
       COUNT(*) FILTER (WHERE es.is_published) published,
       COUNT(*) FILTER (WHERE e.is_paid) paid
FROM events e LEFT JOIN event_sites es ON es.event_id = e.id
WHERE e.created_at > NOW() - INTERVAL '90 days' GROUP BY 1;

-- C. How far out are hosts creating events? (drives nurture timing)
SELECT width_bucket((event_date - created_at::date), 0, 360, 6) AS bucket_60d, COUNT(*)
FROM events WHERE created_at > NOW() - INTERVAL '90 days' AND event_date IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- D. Abandoned checkouts (intent that didn't close)
SELECT status, plan, COUNT(*) FROM payments
WHERE created_at > NOW() - INTERVAL '90 days' GROUP BY 1,2 ORDER BY 1,2;

-- E. Sanity check for the "2,140+ celebrations" claim
SELECT COUNT(*) FROM events;
```

**Targets after Phases 0–2 (8 weeks):**

| Metric | Definition | Target |
|---|---|---|
| Activation | sign-ups with ≥1 upload within 7 days | ≥ 40% |
| Publish rate | builder sign-ups with a published site | ≥ 60% |
| Free → paid | events with event date passed that paid | ≥ 8–10% |
| Checkout completion | succeeded / created payments | ≥ 60% |

Look at these weekly. If activation moves but paid doesn't, the problem is the offer or trust (Phase 3). If activation doesn't move, the sandbox isn't being seen, so check `first_upload` vs `wall_opened` in GA4.

---

## 8. Founder outreach script (do this now — Phase 0.7)

At this volume, a personal message from you converts better than any automation. Send it to every sign-up from the last 60 days:

> Hi {first name}! Si Benz ito, founder ng Reelday 👋 Nakita kong nag-sign up ka para sa {event / "your event"}. Gusto ko lang i-check — kailan ang event mo, at may tanong ka ba? Kung gusto mo, I can set up your wall and test it with you in 5 mins over video call — libre. Para makita mo mismo bago ang araw mo. 🙂

Record every reply (objection, event date, guest count) in `docs/lead-tracker-template.csv`. **The first 10 replies will tell you more than this audit.** If people mostly say "too early", the nurture timing is the problem. If they say "too expensive", it's the offer. If they say "I didn't get it", it's activation.

---

## 9. Priority stack (if you only do five things)

1. **Fix the upgrade routing**: builder, drip emails and homepage pricing → in-event upgrade (P0, money is leaking right now).
2. **Message every recent sign-up yourself** and log the objections.
3. **"Try the wall in 60 seconds"** card + test uploads not counting toward the limit.
4. **Fix the false or inconsistent claims** (2,140+, "forever", website listed as Dalisay-only) and add Messenger chat + a refund guarantee.
5. **Activation and RSVP-triggered emails**, plus Google sign-ups getting the welcome email.
