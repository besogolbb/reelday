# Reelday.ph — Final Sprint: June 11–30, 2026

**Execution layer on top of `LAUNCH-MASTERPLAN-JUNE2026.md`** (strategy there still
stands: intent > reach, Founding 20, ≤₱5k ads). This doc adds what changed since:
the positioning decision, the pool-party hero asset, and a day-by-day close plan
for the last 19 days. Time budget: ~60–90 min weekday evenings, more on weekends
(job search is the day priority).

---

## 1. POSITIONING — decided

**Reelday is not a photo wall. It's the party program, powered by the guests.**

The "live photo wall" category is passive — photos rotate, people glance, done.
What actually sells Reelday to a Filipino host is that the wall is **something the
whole venue plays with**:

- Photos & videos appear live → *the spectacle*
- Emoji reactions raining on screen → *the cheering*
- **Live trivia & polls with a leaderboard → parlor games, digitized**
- Video greetings on the big screen → *messages from the people who couldn't come*

That third bullet is the cultural unlock. Every Filipino birthday, christening,
debut, and reception already has parlor games and an emcee running them — with
paper, shouting, and "raise your hand!". Reelday makes the emcee's game digital:
question on the big screen, guests answer on their phones, live tally races,
winner reveal with fireworks. **We are not teaching the market a new behavior; we
are upgrading one they already love.**

The fourth bullet is the emotional unlock: **video greetings from family abroad
playing on the venue screen.** Every PH celebration has someone in Dubai, Riyadh,
or Toronto who couldn't come. "Nakita ng lola ang greeting ng apo niya sa screen"
sells harder than any feature list.

### Messaging house

| Layer | Copy |
|---|---|
| Category | **Interactive live wall** (own this phrase in all bios/captions) |
| One-liner (EN) | The live wall your guests play with — photos, reactions, games, and greetings on your venue screen. |
| One-liner (Taglish) | Hindi lang photo wall. **Buong party program — sa isang QR.** |
| Game angle | Parlor games, pero digital. Tanong sa big screen, sagot sa phone, may winner, may fireworks. 🏆 |
| OFW angle | Para sa mga hindi nakapunta — video greetings nila, live sa screen. 🥹 |
| Trust line (keep) | Walang app. Walang login. Kahit si Lola kaya. |
| Proof line | Totoong event 'to — hindi mockup. *(pair with pool-party footage)* |

**Demo-the-moment rule:** never demo a feature, demo a *moment*. The four moments,
ranked by punch:
1. **Trivia about the celebrant** — "Anong unang salita ni baby [name]?" → phones
   up → tally races → winner + fireworks. Personal + competitive + screen-native.
2. **Lola/kids dancing, live on the big screen** while reactions rain.
3. **Video greeting from abroad** plays, lola tears up.
4. The wall filling up with guest photos in real time (the classic — still works,
   but it's the *third* thing we show now, not the first).

### Pricing fit (why this positioning sells the right tier)

Live polls/trivia are **Dalisay-and-up** (`backend/lib/plans.js`). The Founding 20
offer is Dalisay at ₱1,490 — the *same price* as Sinag. So the interactive
positioning sells exactly the discounted tier, and the urgency line writes itself:

> "Lahat ng interactive features — games, polls, video greetings, event website —
> sa presyo ng basic plan. Hanggang June 30 lang, first 20 events lang."

Steer everyone to Founding Dalisay until June 30. Sinag returns as the entry
tier in July.

### Offer clarification (critical — add to ALL offer copy)

**"Book by June 30 — your event can be anytime."** With 19 days left, most June
events are already locked. The buyers now are July–September hosts. The Founding
20 deadline is the *payment* date, not the event date. Without this line we're
selling to an empty room.

---

## 2. ASSET MAP — what we have and what each one is for

| Asset | Market it owns | Use |
|---|---|---|
| **3yo pool party footage (real event)** | Kids' parties, christenings, family celebrations — the **volume** market (way more 1st birthdays than weddings, lower price friction, mommy groups are huge) | The anchor of every proof post + the ad creative |
| `reference/dancinglola.mp4` | Emotional/share-bait | "Kahit si Lola" posts, reaction-rain demo |
| UI demo video | Weddings/debuts (until we get a wedding hero) | How-it-works posts, DM follow-up material |
| `tools/wall-recorder` Remotion templates | All production | FB 16:9, IG 9:16, TikTok 9:16 — don't build new tooling |

**Strategic call:** the pool party means we lead with the **kids-party/family
market** for the rest of June, with weddings as the secondary track via the UI
demo + group/DM outreach. Parents decide faster than couples (no 12-month
planning cycle), spend ₱50–150k on a 1st birthday without blinking, and mommy
groups have 10–50× the membership of wedding groups.

Video production rules: `reference/REVIEW-LOGIC.md` is law — inverted structure
(climax in first 3s, hook text at 3–5s, product context by 8s, end card only in
last 4s), safe zones, and the pre-post checklist.

---

## 3. THE 19-DAY SPRINT

### Phase 1 — Re-arm (Jun 11–14, Thu–Sun)
*Theme: ship the pool-party proof + flip all messaging to interactive.*

- [ ] **Cut 3 posts from the pool party** (Remotion templates, one evening each or
      batch on the weekend):
      1. **"Totoong event"** montage — climax: kids' faces watching themselves on
         the big screen / the most chaotic-joyful 2 seconds. Hook: *"Hindi 'to
         mockup — totoong 3rd birthday sa [city]."*
      2. **Trivia moment** — if any game/poll footage exists from the party, lead
         with the tally racing. If not, screen-record a trivia run about the
         celebrant ("Anong paborito ni [name]?") over party footage. Hook:
         *"Parlor games, pero digital."*
      3. **Parents' POV** — wall filling up + caption hook: *"200 photos mula sa
         guests — wala kaming hiningi, nag-scan lang sila ng QR."*
- [ ] **Flip all 3 bios + pinned posts** to the interactive one-liner + Founding
      offer + "book by June 30, event anytime."
- [ ] **Join 10 mommy/kiddie-party groups** (in addition to wedding groups):
      city-based mommy groups, "Kiddie Party Suppliers PH"-type groups,
      christening/baptism planning groups. Read rules. Helpful-member mode, same
      as the masterplan's wedding-group rules.
- [ ] Restart the **10 warm DMs/day** cadence — now split: 5 to parents posting
      upcoming birthday/christening prep, 5 to engaged couples. Scripts in §5.
- **Exit criteria:** 3 pool-party posts live (IG first — it's our best-performing
  platform), bios flipped, 10 new groups joined, 40 DMs out.

### Phase 2 — Paid + partners (Jun 15–22, Mon–Mon)
*Theme: put ₱5k behind the proven clip; recruit the people who run the games.*

- [ ] **Launch the ₱5k paid layer** (was waiting on a hero asset — we have it now):
      - **₱3,000 — Messenger-objective ad** (not lead form: PH small-ticket buyers
        convert better in chat). Creative = the best-performing pool-party post
        after 3–4 days of organic data. Audience: PH parents 25–40, interests
        kids' parties/birthday planning/christening + a second ad set for
        engaged/wedding planning, 22–40. Daily budget ~₱375 across Jun 15–22.
      - **₱2,000 reserved** for Week 4: boost the scarcity-counter post to page
        engagers + video viewers (retargeting warm eyes for the close).
      - Auto-reply + your fast follow-up: every ad conversation gets the demo
        link + the Founding pitch within the hour during 7–10 PM.
- [ ] **Party-host/emcee outreach (NEW partner tier — 5 this week).** Kiddie party
      hosts, magicians, emcees run the games at every party. Pitch: Reelday makes
      *their* program look high-tech — trivia on the big screen, they hold the
      mic. Free Hiraya account + referral cut (same structure as the
      coordinator/photographer offer in the masterplan §6). One active host =
      2–4 events/month.
- [ ] Keep coordinator/photographer outreach running (2–3 touches/week).
- [ ] **"X of 20 spots left" counter post** mid-week — real number, FB Page +
      IG Story.
- [ ] Answer 2–3 group threads/day (mommy + wedding groups), 7–10 PM block.
- **Exit criteria:** ads live with ≥20 conversations started, 5 host/emcee convos,
  first paid bookings from the kids'-party track.

### Phase 3 — Close (Jun 23–30, Tue–Tue)
*Theme: deadline. Everything funnels to "Founding closes June 30."*

- [ ] Daily IG/FB **Story countdown** ("7 days / X spots left") — 5 minutes/day.
- [ ] **Personal follow-up to every warm lead** from the whole month, oldest
      first: "Still planning [event]? Founding price closes Tuesday — I can hold
      a spot for you today." One message, one clear out.
- [ ] Deploy the reserved **₱2k boost** on the counter post (Jun 24–29).
- [ ] **Jun 28–29 weekend:** "last weekend" post — best pool-party clip recut
      with the countdown overlay.
- [ ] **Jul 1:** "Founding 20 closed / June in review" proof post → pivots the
      page to full-price July + sets up Hiraya for vendors.
- **Exit criteria:** masterplan floor of 5 paid events; every lead got a clean
  yes/no; ≥3 testimonials banked (pool party + June customers).

---

## 4. CONTENT BRIEFS — 8 posts, ready to produce

Cadence: ~4/week is enough (job-search reality). IG is the priority platform
(93.7% non-follower reach in the Day-2 analytics); FB second (boostable +
groups); TikTok gets the same vertical cut, zero extra effort, zero expectations.
Every post: ONE CTA — **"Comment WALL or DM us for a 30-second demo link."**

| # | Hook (first 3 sec — visual first, text at 3s) | Body | Asset |
|---|---|---|---|
| 1 | Kids screaming at their own faces on the big screen | "Totoong event 'to. Hindi mockup." → how it happened | Pool party |
| 2 | Trivia tally racing, names climbing | "Parlor games, pero digital. May winner, may fireworks." | Pool party / screen rec |
| 3 | Wall filling with photos, counter going up | "200 photos galing sa guests niyo — isang QR lang." | Pool party |
| 4 | Lola dancing on screen, reactions raining | "Walang app. Walang login. Kahit si Lola kaya." | dancinglola.mp4 |
| 5 | Video greeting playing, family watching | "Para sa mga hindi nakapunta." (OFW angle) | UI demo / staged |
| 6 | ₱2,990 crossed out → ₱1,490 | Founding 20 explainer — book by Jun 30, event anytime | Graphic + clips |
| 7 | "X of 20 slots left" counter | Real scarcity update + 1 testimonial quote | Graphic |
| 8 | Best 5 seconds of everything | Final countdown recut, "closes Tuesday" | Recut of #1–4 |

Captions per platform per `REVIEW-LOGic.md` §Caption Rules (Taglish on IG/FB,
POV format on TikTok, #ReeldayPH always).

---

## 5. OUTREACH SCRIPTS — new tracks only (wedding scripts live in the masterplan §6)

**DM — parent with an upcoming birthday/christening (found via groups/FB posts):**
> Hi [name]! Saw you're preparing for [child]'s [birthday/binyag] — ang saya!
> 🎉 I run **reelday.ph** — an interactive live wall for parties: guests scan a
> QR and their photos show up live on your venue screen, may **live trivia game
> pa about sa celebrant** na sasagutan ng guests sa phones nila (parang parlor
> games, pero digital — may leaderboard at winner!). We're onboarding our first
> 20 events at 50% off (₱1,490, money-back guarantee) — book by June 30, kahit
> kailan pa ang event. Want a 30-second demo link to play with?

**DM — kiddie party host / emcee / magician:**
> Hi [name]! Nakita ko 'yung hosting niyo sa [event/page] — galing! 🎤 I build
> **reelday.ph**, an interactive live wall for parties. For hosts like you it's
> a program upgrade: trivia questions on the big screen, guests answer on their
> phones, live leaderboard, winner reveal — ikaw pa rin ang may hawak ng mic,
> pero mukhang concert production na 'yung game. I'd love to give you a **free
> account for your next 2 events** + a referral cut for clients you bring. Open
> to a quick chat?

**Group thread reply — parent asking for party ideas/suppliers (helpful mode):**
> For the program — something our guests went crazy for: a live wall on the TV
> kung saan lumalabas agad 'yung photos nila pag nag-scan sila ng QR, tapos may
> trivia game about the celebrant na sinasagot nila sa phone (may live
> leaderboard!). Kept the titos & titas off their seats 😄 Happy to share how if
> useful!

**Objection bank (memorize):**
- *"May WiFi ba kailangan?"* → "Yes po, venue WiFi or isang mobile hotspot lang —
  we'll help you test it before the event (kasama sa setup guide)."
- *"Paano kung walang mag-upload?"* → "Money-back guarantee po — kung hindi
  napuno ng guests ang wall, full refund, no questions."
- *"Mahal ba?"* → "₱1,490 one-time para sa buong event — mas mura pa sa isang
  tier ng cake 😄 at kasama na lahat: games, greetings, website."

---

## 6. DAILY RHYTHM (sustainable next to the job search)

- **Lunch break (10 min, phone):** reply to all DMs/comments; log new leads in
  `docs/lead-tracker-template.csv`.
- **Evening block (45–60 min, 7–10 PM PHT):**
  - 10 DMs (5 parents, 5 couples) — 20 min
  - 2–3 group thread replies — 10 min
  - Publish/engage on the day's post (post days: Mon/Wed/Fri/Sun) — 15 min
  - Ad conversations same-hour replies — whatever's left
- **Weekend:** batch-produce the week's posts (one Remotion session), Sunday
  review vs targets, plan follow-ups.

## 7. TARGETS (sprint-scoped, feeds masterplan §5)

| Metric | Floor | Stretch |
|---|---|---|
| Paid bookings by Jun 30 | 5 cumulative | 10 |
| — from kids'-party track | 2 | 5 |
| Messenger conversations from ads | 30 | 60 |
| Host/emcee partners active | 1 | 3 |
| Pool-party posts shipped | 3 by Jun 14 | +5 more by Jun 30 |
| Cost per booking (paid layer) | ≤ ₱1,000 | ≤ ₱500 |

**The one metric that matters daily: conversations started with people who have
a real event date.** Everything else is supporting cast.
