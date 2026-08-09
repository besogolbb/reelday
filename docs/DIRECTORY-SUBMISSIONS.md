# Reelday.ph — Directory Submission Package
**Prepared 2026-08 · execute manually, ~45–60 min for the top batch**

Not a generic SaaS directory plan — Reelday is a consumer product for PH couples/
hosts, not a B2B tool developers browse on AlternativeTo. Most of the standard
"AI tool directory" / "MCP registry" / "no-code directory" playbook doesn't apply
here and is skipped on purpose. What's below is the subset that's actually a fit:
PH wedding-specific directories (highest relevance, real referral traffic) plus a
short list of general startup directories (backlink/DR value, GEO citation value).

**I can't do this step myself** — every one of these requires a human to create
an account, verify an email, pass a CAPTCHA, and accept terms as the business
owner. This doc is the copy-paste kit so it's fast, not a script that runs itself.

---

## Readiness check (do these first if not already true)

| Item | Status |
|---|---|
| Publicly accessible, no password wall | ✅ live |
| Pricing page | ✅ `/#pricing` |
| Terms live | ✅ `/terms` |
| Logo assets (PNG/SVG) | Check `frontend/images/LOGO.png` exists in both formats — most directories want a square 512×512+ version too; crop one if missing |
| 5–8 real product screenshots | ⚠️ Not confirmed to exist as a ready folder — grab these from the live site before starting (homepage, `/website-builder`, a published `/e/<slug>` example, the wall) |
| Demo video (60–90s) | ⚠️ Not built yet — the Remotion pipeline in `tools/wall-recorder/` can produce one (see MARKETING.md Post 9 concept), but don't block directory submission on this; most of the list below doesn't require it |
| Privacy policy | Confirm `/terms#privacy` actually covers privacy, not just terms of service |

None of the ⚠️ items are hard blockers for the directories below — they're listed so you're not caught mid-form without an asset.

---

## Ready-to-paste copy (vary the opening line per directory — don't paste the identical block everywhere)

**Tagline (under 10 words):**
> Free wedding website + RSVP. Live guest wall for the day.

**Short description (~60 words, PH-wedding-directory framing — lead with the free tool):**
> Reelday gives Filipino couples a free wedding website — countdown, love story, RSVP, entourage, and find-your-seat, all on one shareable link. When the big day comes, couples can add a live guest photo & video wall for the reception: guests upload from their phones and it plays on screen in real time, with reactions and trivia. Built for the Philippines — Tagalog-ready, GCash-native.

**Short description (~60 words, general-startup-directory framing — lead with the product mechanic, not the wedding niche):**
> Reelday is a free event-website builder with RSVP tracking that upgrades into a live, guest-powered photo & video wall for the event itself. Free tier lets anyone publish a shareable invitation site in minutes; the paid tier turns it into an interactive display where guests' own uploads appear on a screen in real time. Built for the Philippine market first.

**Long description (~150 words):**
> Reelday started as a live event wall — guests scan a QR at a wedding or party and their photos and videos appear on the venue's TV in real time, with emoji reactions and live trivia. In 2026 it added a free-forever event-website builder as the front door: couples build a full wedding site (RSVP, countdown, love story, venue details, entourage, find-your-seat) at no cost and no signup required to start. The free site is genuinely complete, not a trial — publishing it costs nothing. When the event approaches, hosts can add the live guest wall as a paid upgrade for the reception itself. Every published site carries a "make yours free" link back to Reelday, which is how most new users discover it. Built specifically for the Philippines: Tagalog/English toggle, GCash payment, and PH venue/program conventions baked in rather than adapted from a US template.

**Category tags:** wedding planning, event technology, RSVP software, wedding website builder, event website, live photo wall, Philippines, event tech, party planning

**Founder story (2–3 sentences, for directories that ask):**
> Built by a solo Filipino founder frustrated that every "free wedding website" option was either a static Canva template with no RSVP backend, or a US-first tool (Zola, The Knot) that doesn't understand PH venues, GCash, or Tagalog. Reelday is the free-website-plus-live-wall combo built specifically for how Filipino weddings and parties actually run.

---

## Tier 1 — PH wedding directories (highest relevance, do these first)

| Directory | URL | Why | Type |
|---|---|---|---|
| Kasal.com | kasal.com | Dominant PH wedding directory/marketplace, ~1M FB following, has an editorial/vendor-submission arm — the single highest-value listing on this list | Check their vendor/supplier submission form; may require a business inquiry rather than a self-serve form |
| Bridalpod | (PH-expanded wedding marketplace) | Real competitor-adjacent audience — couples actively planning | Self-serve or contact form, check site |
| My Wedding Planner Philippines | myweddingplanner.ph | Found in the SEO audit already ranking for "free wedding website philippines" — worth a resource-page or partnership inquiry even if not a listing per se | Contact form likely |
| Local wedding FB groups (not a directory, but same tier of effort) | — | Already planned as Loop 3 in `docs/LEAD-MAGNET-PLAN.md` — helpful-member replies, never a cold pitch post | N/A |

These are the ones actually worth the time investment — real PH couples, not developer traffic.

---

## Tier 2 — General startup/SaaS directories (backlink + GEO citation value)

Use the **general-startup framing** copy variant above for all of these, not the wedding-specific one.

| Directory | URL | Notes |
|---|---|---|
| Product Hunt | producthunt.com | Real launch-day mechanics apply (see below) — worth doing once positioning is stable, not urgent this week |
| AlternativeTo | alternativeto.net | List as an alternative to Zola / The Knot — legitimate category fit |
| SaaSHub | saashub.com | Same — list against Zola/The Knot |
| BetaList | betalist.com | Low effort, decent DR |
| Crunchbase | crunchbase.com | Free company profile — feeds AI-answer-engine training corpora per the audit's finding #5 on AI citation, not really a "directory" in the traffic sense but worth 10 minutes |
| Wikidata | wikidata.org | Same reasoning as Crunchbase — a factual entry AI engines pull from |
| LinkedIn Company Page | linkedin.com | If one doesn't exist yet — same GEO reasoning, plus it's where the social-presence gap from the audit could start getting rebuilt |

Skip entirely (wrong audience for a consumer wedding product): AI-tool directories (TAAFT, Futurepedia, Toolify), MCP/agent registries, no-code directories, dev-tool directories (Dev.to, Hashnode). These exist for developer/AI-tool audiences that will never plan a Filipino wedding.

---

## Product Hunt — only when ready, not urgent

The skill's full 3-week warm-up protocol applies if you want to do this properly (warm up a hunter account for 2 weeks beforehand, launch Tue/Wed/Thu at 12:01 AM PT, ask for feedback not upvotes, reply to every comment in under 30 minutes). Given the current priority is the PH wedding audience, **don't block on this** — it's a nice-to-have backlink/visibility event, not where the couples are. Revisit once the social-presence decision (still open from the audit) is resolved, since a PH launch benefits from having somewhere to point new followers.

---

## What NOT to do (from the skill's own rules, still true here)

- Don't pay for directory submission services — this is all free, an afternoon of copy-paste.
- Don't paste the identical description into every form — vary the opening line (two variants are ready above; write a third by hand if doing more than ~6 submissions).
- Don't submit to spam/low-quality directories just to pad a count — a handful of real PH wedding listings beats forty low-DR nothing-directories.
- Don't wait for the demo video or full screenshot set to be perfect before starting — most of Tier 1 doesn't require them.

---

## This week's realistic target

Kasal.com contact/submission form + AlternativeTo + SaaSHub + Crunchbase + Wikidata — five listings, under an hour, covers both the highest-relevance PH audience and the GEO/backlink foundation. Bridalpod and myweddingplanner.ph next if the first batch goes smoothly.
