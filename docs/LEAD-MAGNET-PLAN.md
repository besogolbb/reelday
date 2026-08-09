# REELDAY — FREE EVENT WEBSITE LEAD MAGNET PLAN
**Draft · Aug 2026 · runs alongside/after "Own the Party" (docs/MARKETING-PLAN.md, window closed Jul 31)**

Owner: Benz · Time budget: evenings + weekends · Cash budget: ≤ ₱5,000 (unspent from prior plan, reset)
Pricing source of truth: `backend/lib/plans.js`

---

## 0. The pivot, in one sentence

**Give away the event website (`/e/<slug>`) for free to every host, and sell the live wall
(guest uploads, reactions, trivia, video greetings, SDE recap) as the paid upgrade for the
actual event day.** This reopens **weddings** — the niche "Own the Party" deliberately
deferred — because a free wedding website is a far stronger organic pull (search demand,
shareability, "send this to 150 guests") than a free kids'-party tool ever was.

Two products, two jobs:
- **Free (Tala):** the *before* — RSVP, story, countdown, details, find-your-seat. Built to be
  shared with every guest, months out. This is the lead magnet.
- **Paid (Sinag/Dalisay):** the *during* — the live wall on the reception TV, guest photo/video
  uploads, reactions, trivia, video greetings, SDE recap reel. This is the upsell, timed to land
  as the event date approaches.

---

## 1. Why this works better than gating it

Today `website` is a Dalisay-only feature flag (`backend/lib/plans.js`,
`frontend/js/plans.js`, `docs/event-website-plan.md`). Two structural things make un-gating it
a lead-magnet play rather than just giving away revenue:

1. **The one-free-event guard already exists.** Tala is "one event per account for life"
   (`users.tala_used`). Giving Tala the `website` feature doesn't open a new abuse surface —
   it reuses a limit that's already enforced.
2. **The free product still funnels to the paid one by design.** A wedding website's whole
   point is that it gets shared with 100+ guests months before the wedding. Every one of those
   guests sees a "Powered by Reelday" footer and an "RSVP" flow — that's a bigger, more
   qualified audience than any ad we could buy. The paid wall then converts the *couple*
   (not the guests) at the one moment they're primed to spend: right before the big day, when
   they're already emotionally invested and have already built something with us.

**Net effect:** the free tool doesn't cannibalize Dalisay's positioning — the wall was always
the wow-moment feature (trivia, live reactions, video greetings, SDE). The website was always
prep-work most Dalisay buyers barely touted. Moving it to free removes a weak paid feature and
replaces it with the top of a funnel.

---

## 2. Product changes required (do this before any marketing spend)

- [ ] `backend/lib/plans.js` + `frontend/js/plans.js`: add `website: true` to Tala's feature
      set (keep `sde`, `reactions`, `polls`, `audioNotes` gated to Sinag/Dalisay/Hiraya as today).
- [ ] `backend/routes/event-site.js` / entitlement check: confirm it reads the feature flag, not
      a hardcoded tier check — if it's `event.plan !== 'dalisay'` anywhere, that needs to become
      a feature-flag lookup instead.
- [ ] Dashboard "Event Website" panel: remove the upgrade-nudge lock for Tala hosts.
- [ ] Footer / branding: confirm every published event site has a small "Made with Reelday.ph —
      make yours free" link. If it doesn't exist yet, this is the single highest-leverage
      3-line change in this whole plan — it's the viral loop.
- [ ] Pricing page + `/account` plan comparison table: drop "Event website" as a Dalisay
      differentiator; reposition Dalisay/Sinag around the wall (live uploads, reactions, trivia,
      video greetings) and Dalisay's SDE recap reel as the headline paid feature.
- [ ] `/start` wizard copy: for hosts who pick Tala, the confirmation screen should say "Your
      free event website is ready to share" — not just "your wall is ready" (today's framing).

None of this is large — it's a feature-flag move plus copy changes, not new engineering. This
plan assumes it ships in Week 1.

---

## 3. Positioning (new, for weddings)

**Category:** free wedding (and event) website builder, built for the Philippines —
Tagalog-ready, GCash-native upgrade path, and it already knows what a PH reception needs
(find-your-seat, entourage list, venue maps that don't need a Google Maps API key).

**The pitch, one breath:**
> Libre 'yung wedding website niyo — countdown, love story, RSVP, find-your-seat, lahat.
> Tapos kapag malapit na 'yung araw, pwede niyo i-on 'yung live wall: lalabas live sa TV sa
> reception 'yung mga photos at video greetings ng guests niyo, may trivia tungkol sa inyo,
> at may automatic recap video pagkatapos. Simula sa libre — bayad lang pag gusto niyo na ng
> live wall.

**Why free-first beats "book a demo":** couples building a wedding website are planning
6–12 months out. Nobody is ready to buy the wall that early. Forcing a sales conversation at
month 8 loses them to Canva/a free Notion template. Give them the thing they need *now* for
free, stay in their inbox until month 1.

**Proof/differentiation vs. what they'd otherwise use:**
| Alternative | Why it loses |
|---|---|
| Canva / Notion template | Static, no RSVP backend, no find-your-seat, they DIY the maps/countdown |
| Zola / The Knot | Not localized (USD, no GCash, no Tagalog, no PH venue conventions) |
| Kasal.com / Bridestory | Directory/marketplace, not a couple-owned website |
| Nothing (just a group chat) | No single shareable link, no RSVP tracking, no countdown |

---

## 4. The funnel

```
SEO / supplier referral / FB groups
        ↓
"Make your free wedding website" landing page (new, or repurposed /start entry point)
        ↓
Sign up (email) → build site (5-10 min, guided) → get shareable link
        ↓
Couple shares link with guests (this IS the distribution channel — guests see "Powered by
Reelday, make yours free" on every visit)
        ↓
Email/SMS drip keyed to event_date (RSVP + countdown means we know exactly how far out they are)
        ↓
Upsell moment ~60/30/14 days out: "Add the live wall for [event date] — see it in action"
        ↓
Sinag/Dalisay purchase → wall runs on the day → SDE recap after
        ↓
Post-event: testimonial ask + "which of your friends has a wedding coming up?" referral ask
```

---

## 5. Distribution — three loops, ranked

### Loop 1 — SEO + the site itself (compounding, low effort once live)
- Target queries: "free wedding website philippines", "libreng wedding website", "wedding
  RSVP website free", "wedding countdown website maker".
- One evergreen landing page optimized for these terms, linking straight into `/start`.
- **The viral loop is the product, not a campaign**: every published site is a backlink +
  impression surface. At even modest volume (50 sites/month × 100 guests each), that's 5,000
  monthly touches with zero ad spend. This is the highest-leverage single line item in the plan
  — get the "Made with Reelday" footer shipped first.

### Loop 2 — Wedding supplier-led (reuse the "Own the Party" playbook, new niche)
Same mechanic as the kids'-party supplier loop, retargeted at wedding coordinators,
bridal-fair organizers, prenup photographers, wedding videographers/SDE-adjacent vendors:
- Pitch: "Give every couple you work with a free wedding website with your branding/referral
  link on it — then we split the wall upsell with you." (₱500 referral per booked
  Sinag/Dalisay wall, same terms as the existing supplier deal.)
- These suppliers already sit in front of couples 6-12 months before the wedding — exactly
  the free-tool window, not the wall-sale window. They become the free tool's distribution,
  not just the wall's.
- Weekly quota: 10 supplier DMs (coordinators/photographers this time, not party hosts).

### Loop 3 — FB wedding-planning groups (parent-DM playbook, retargeted)
- PH has large, active "Kasal"/wedding-planning FB groups where couples post exactly the
  question this tool answers ("saan pwede gumawa ng free wedding website?").
- Helpful-member mode only, never a cold pitch post — same rule as the existing group-reply
  script in MARKETING-PLAN.md §6.

---

## 6. Email/SMS drip (the part that actually converts the free tool to revenue)

Keyed off `events.event_date` and `events.upload_window_ends_at`. Draft sequence:
1. **Day 0 (site created):** "Your wedding website is live — here's your link to share."
   Include a one-line teaser: "When you're ready, you can add a live guest wall for the
   reception — see an example."
2. **+7 days:** tips email — "3 things every guest-friendly wedding website has" (soft
   education, drives them to fill out sections they skipped — more complete site = more
   emotionally invested = stickier lead).
3. **~90 days out:** "Start planning your reception moments" — introduces the wall concept
   properly, one short demo clip, no hard pitch yet.
4. **~30 days out:** the actual offer. "Add the live wall for [event date] — guests upload
   photos & videos, trivia about you two, video greetings from family abroad, and you get a
   recap video after." Price + CTA. This is the money email.
5. **~7 days out:** urgency follow-up if no purchase — "still time to add the wall for
   [event date]."
6. **Post-event (if purchased):** testimonial + referral ask, same as MARKETING-PLAN.md Loop 2.
7. **Post-event (if never purchased):** "how did it go?" + soft referral ask anyway — they're
   still a warm node in someone else's future wedding.

This is the single biggest build item in this plan (needs Resend automation keyed to
event_date, not send-date). If full automation isn't feasible this month, do steps 1 and 4
manually via a spreadsheet of free-tier signups sorted by event date — the ₱ is in step 4.

---

## 7. What to measure

| Metric | What it tells you |
|---|---|
| Free sites created / week | Top-of-funnel health |
| % of free sites with RSVP data filled in | Real intent vs. tire-kickers |
| Guest visits per site (avg) | Size of the organic impression loop |
| Days-out at first wall-purchase click | Whether the ~30-day drip email is the right timing |
| Free → paid conversion rate | The number that matters |
| Time from site creation to event date, for converters | Tunes drip timing further |

**North star for this plan:** free → paid conversion rate, not free-site volume. A thousand
free sites that never upgrade is a hosting bill, not a business.

---

## 8. Open decisions (need your call before Week 1 work starts)

1. **Does the free tier keep "1 event for life" or get its own separate quota from the paid
   wall quota?** Recommendation: keep as-is (`tala_used`) — simplest, no new abuse surface,
   and it already nudges repeat hosts (parents with multiple kids, planners) toward a paid
   tier for event #2 regardless of reason.
2. **Does this replace or run alongside the kids'-party supplier engine from
   MARKETING-PLAN.md?** Recommendation: alongside — the supplier mechanic is proven, just
   points a second cohort (wedding suppliers) at a different lead magnet. Don't drop the
   party-supplier relationships already in motion.
3. **Who owns writing the ~30-day "add the wall" email copy — and is Resend automation by
   event_date feasible this month, or does it start as a manual spreadsheet process?**

---

## 9. First two weeks

**Week 1:** Ship the product changes in §2 (feature flag + footer branding link — this is the
whole plan's leverage). Write the free-wedding-website landing page. Draft the Day-0 and
~30-day-out emails (even if sent manually at first). Build the wedding-supplier hit list
(20 names: coordinators, photographers, bridal fair contacts).

**Week 2:** Publish landing page + start SEO indexing. Send first 10 wedding-supplier DMs.
Post 2 helpful-member replies in FB wedding groups (never cold pitches). If any free sites
exist already (Dalisay buyers pre-pivot), retroactively email them the "Powered by Reelday"
sharing nudge — they're already-built inventory for the viral loop.
