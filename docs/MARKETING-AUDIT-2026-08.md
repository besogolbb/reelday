# Reelday.ph Marketing Audit — August 2026

**Date:** 2026-08-09 · **Scope:** landing site/funnel, technical SEO, social presence, competitor snapshot, content-production capability.
**Method:** repo read + live headless-browser check of https://reelday.ph and https://reelday.ph/website-builder + WebSearch/curl against production.

---

## Executive Summary

1. **The homepage has already fully pivoted to the lead-magnet positioning — no mismatch found.** `frontend/index.html`'s `<title>`, meta description, OG tags, JSON-LD, hero H1 ("Your free event website. RSVP included."), and every free-tier CTA already read "free event website," not "interactive party wall." This was verified live, not just in the repo — production is byte-identical to what's in git. The kids'-party positioning in `docs/MARKETING-PLAN.md` is dead in the copy; only the doc itself is stale.
2. **`robots.txt` blocks `/e/` — the exact URL pattern the lead-magnet plan's whole growth loop depends on.** Every published free event website lives at `/e/<slug>` (`docs/event-website-plan.md`, `PRODUCT.md` §3.6), and `docs/LEAD-MAGNET-PLAN.md` §4 explicitly banks on "every published site is a backlink + impression surface... 5,000 monthly touches with zero ad spend." Google cannot index a single one of those pages today. This is the single highest-impact fix in this audit (see Top 5).
3. **`sitemap.xml` has 3 URLs total** (`/`, `/contact`, `/terms`) — no `/website-builder`, no landing pages for the target keywords the lead-magnet plan assumes, no blog. There is no content/blog section anywhere on the site.
4. **Zero social presence.** WebSearch for "Reelday.ph facebook" and "Reelday Instagram philippines" returned nothing — no Facebook page, no Instagram account findable. This matches what was already found by grepping the frontend HTML. `reference/REVIEW-LOGIC.md`'s own "Analytics (Day 2)" section logs real FB/IG/TikTok post data (176 FB views, 316 IG views, 93.7% non-follower IG reach) — so posting *has* happened at some point, but the accounts aren't surfacing in search at all today, which usually means either very low follower count, a since-unpublished/renamed page, or a handle that doesn't match the brand name.
5. **reelday.ph does not rank for "free wedding website philippines"** — page-1 results are My Wedding Planner Philippines (myweddingplanner.ph), Bridalpod (bridalpod.ph), Vowly (vowly-ph.com — closest direct competitor, same free-website+RSVP pitch), plus international Zola/The Knot/WithJoy. Reelday only surfaces when searched by name directly.
6. **`robots.txt` also disallows every major AI crawler** (GPTBot, ClaudeBot, Google-Extended, Amazonbot, CCBot, Bytespider, meta-externalagent) via both a blanket `Content-Signal: ai-train=no` and explicit per-bot `Disallow: /`. Meanwhile `index.html` carries a JSON-LD `Organization` block with an explicit comment saying it's there "for AI answer engines (Google AI Overviews, Perplexity, ChatGPT search)." Those two decisions contradict each other — the structured data can't be picked up by the bots that would use it to cite Reelday in an AI answer.
7. **The content-production engine already exists and is non-trivial** — `tools/wall-recorder/MARKETING.md` documents a working Remotion pipeline (3 reusable templates: FB 16:9, IG/TikTok 9:16, brand constants, safe-zone rules, hook-timing rules) with 5 of 8 planned posts already built. `reference/REVIEW-LOGIC.md` encodes real lessons from actual published posts (inverted-structure fix, ffmpeg contact-sheet unreliability). Any content-automation routine should reuse this pipeline, not rebuild it — but it's currently built around the "Own the Party" kids'-party/trivia narrative (sample slug `andrea-jm`, hooks about parlor games) and hasn't been repointed at the free-website/wedding-lead-magnet story yet.
8. **Page load is on the slow side for a lead-gen funnel entry point**: homepage `load` was 6.7s in the headless check (production, cold), despite real perf engineering already present (deferred GA, preloaded LCP image, modulepreload, font-swap). `/website-builder` loaded faster at 2.8s. Zero console errors or failed requests on either page — the page mounts cleanly, this is a raw speed number, not a broken-page number.

---

## Site & Funnel

**Verified live (2026-08-09) via headless browser against production:**

| Page | HTTP | Title | Load time | Console errors | Failed requests |
|---|---|---|---|---|---|
| `https://reelday.ph` | 200 | "Reelday — Free Event Website with RSVP" | 6730ms | 0 | 0 |
| `https://reelday.ph/website-builder` | 200 | "Event Website Builder - Reelday" | 2847ms | 0 | 0 |

Homepage extracted text confirms the pivot is live: *"Your free event website. RSVP included. Countdown, details, seat finder, and RSVP — all in one link, free forever."* — exact match to `frontend/index.html:1026-1046`.

**Repo-vs-plan cross-check:**
- `frontend/index.html:1012,1048,1506` — all three primary CTAs ("Start free →" ×2, "Start free — no card needed →") point to `/website-builder`, matching `WEBSITE_BUILDER_FUNNEL_HANDOFF.md`'s Phase 4 change ("hero CTAs, the final CTA, the five demo-type tiles, and the Tala pricing CTA now point at `/website-builder`").
- `frontend/index.html:1306-1324` — the four event-type tiles are Wedding/Kasal, Birthday/Kaarawan, Baptism/Binyag, Corporate/Kompanya — general celebration framing, not kids'-party-specific. Matches the pivot; no residue of the "Own the Party" niche language (no "trivia," "leaderboard," or "Busog Guarantee" copy found on the page).
- `frontend/index.html:34-70` — meta/OG/JSON-LD all say "Free Event Website with RSVP," consistent with `backend/lib/plans.js:28-30`'s comment that `website` is "Free on every tier (lead magnet)."
- Live `/website-builder` (Phase 4's anonymous no-signup builder per `WEBSITE_BUILDER_FUNNEL_HANDOFF.md`) confirmed reachable and rendering: "Build your free event website... DRAFT... nothing is saved online until you save your website" with a 7-tab wizard (Welcome, Story, Schedule & Venue, Details, Guests, Gallery, Gifts...). This matches Phase 3/4's documented behavior exactly.

**Conclusion:** there is no landing-copy/positioning mismatch to flag. The funnel described in `docs/LEAD-MAGNET-PLAN.md` is shipped and live, and `docs/MARKETING-PLAN.md`'s kids'-party positioning is fully retired from the site (the doc itself just hasn't been marked superseded the way `LEAD-MAGNET-PLAN.md` was).

---

## Technical SEO

**Meta / OG / structured data (frontend/index.html:22-70):** present and correct — title, description, OG title/description/image/locale, Twitter card, and an `Organization` JSON-LD block with a `makesOffer` for the free Tala tier. This is genuinely more SEO groundwork than most solo-founder sites ship.

**robots.txt (verified via `curl -A "Mozilla/5.0" https://reelday.ph/robots.txt`):**
```
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /
[Cloudflare-managed AI-bot blocklist: Amazonbot, Applebot-Extended, Bytespider,
 CCBot, ClaudeBot, CloudflareBrowserRenderingCrawler, Google-Extended, GPTBot,
 meta-externalagent — all Disallow: /]

User-agent: *
Allow: /
Disallow: /e/
Disallow: /dashboard
Disallow: /upload
Disallow: /account
Disallow: /admin
Disallow: /my-events
Disallow: /wall
Disallow: /login
Disallow: /register
Disallow: /reset-password
Disallow: /forgot-password
Disallow: /verify

Sitemap: https://reelday.ph/sitemap.xml
```
- `Disallow: /e/` blocks the guest event-website pages — the asset the lead-magnet plan is explicitly betting the organic loop on. This is very likely a leftover from when `/e/<slug>` was a paid-only, "don't index other people's private wedding info" page (a reasonable original reason — the pages contain seat-finder/RSVP data). But now that `/e/` is the free product's shareable surface, blocking it from search also blocks the SEO half of its own growth loop. Worth an explicit decision, not silent inheritance: either allow indexing (accepting that couples' names/venues become searchable — check with the host-privacy angle first) or keep it disallowed and accept the loop is guest-to-guest sharing only, not search-driven.
- The blanket AI-bot disallow (likely a Cloudflare default toggle, "Content Signal" panel) blocks the exact crawlers that would read the JSON-LD block `index.html`'s own comment says was added for. If AI-answer-engine visibility matters to the strategy, this needs to be revisited per-bot (e.g., allow GPTBot/ClaudeBot for `ai-input`/reference use while keeping `ai-train=no`).

**sitemap.xml (verified via curl, plain `curl` without UA got a 403 from Cloudflare bot protection — `curl -A "Mozilla/5.0"` succeeded with 200):**
```xml
<url><loc>https://reelday.ph/</loc></url>
<url><loc>https://reelday.ph/contact</loc></url>
<url><loc>https://reelday.ph/terms</loc></url>
```
Three URLs, no `/website-builder`, no `/start`, no keyword-targeted landing page, no blog. `docs/LEAD-MAGNET-PLAN.md` §3's Loop 1 explicitly calls for "One evergreen landing page optimized for these terms [free wedding website philippines, libreng wedding website, wedding RSVP website free, wedding countdown website maker]" — that page does not exist yet, on-site or in the sitemap.

**Keyword ranking check (WebSearch, "free wedding website philippines"):** reelday.ph does not appear on page 1. Results: myweddingplanner.ph, bridalpod.ph, brideandbreakfast.ph (blog), palawanwedding.com, lovedconcepts.com, withjoy.com, theknot.com, Wikipedia. Reelday only surfaces when the query includes the brand name itself ("reelday.ph wedding website free").

**No blog/content section found anywhere in `frontend/` or the sitemap.** There is a documented content *production* pipeline (Remotion videos, see Content Engine below) but no on-site written content — no blog posts, no guides, nothing indexable beyond the single homepage and `/website-builder`.

**Performance:** homepage 6.73s cold load in headless Chromium against production, `/website-builder` 2.85s. Zero console errors, zero failed requests on both — this is a speed number, not a broken-page number. `index.html` already has real perf work done (deferred `gtag.js`, `modulepreload` for `auth.js`/`coupon.js`, LCP image preload with `fetchpriority=high`, font-swap via `media=print` trick) — see the extensive inline comments at `frontend/index.html:1-115`. Given that groundwork already exists, 6.7s cold is worth a fresh Lighthouse pass rather than assuming a quick fix; it may be render-blocking CSS (`shared.css`) or Cloudflare edge cold-start, not something the existing perf comments already ruled out.

---

## Social Presence

WebSearch confirms what grepping `frontend/*.html` already found: **zero discoverable social presence.**

- `"Reelday.ph" facebook"` → no Reelday Facebook page in results (top hits were unrelated PH entertainment pages).
- `"Reelday.ph" OR "Reelday" instagram philippines` → no matching Reelday Instagram account (top hit "reelday.mdp" appears to be an unrelated personal account, not the brand).
- The homepage itself links to zero social profiles anywhere in its markup (confirmed by the user's own prior grep, consistent with what's visible in the rendered `<header>`/`<footer>` read here).

**Contradiction worth flagging:** `reference/REVIEW-LOGIC.md` (last updated May 2026) contains a "Session Handoff Context" section with real published-post analytics — "Facebook: 176 views, 11% watched... Instagram: 316 views, 93.7% non-follower reach, 4 followers gained... TikTok: 3–4 views (new account throttle)." That means accounts existed and had at least a few posts up as of May 2026. Either those accounts have since been deleted/deactivated, renamed away from "Reelday," or search simply isn't surfacing low-follower pages — but the net effect today is that a prospective customer searching for the brand on social finds nothing, and neither does organic search.

---

## Competitor Snapshot

- **Zola (US, international):** Free wedding website + RSVP + zero-fee cash registry is the core free product; revenue comes from registry purchases and premium add-ons (custom domains, advanced design). Positions itself as an integrated toolkit — website, registry, and budget tools in one account. Sets the bar for "free is genuinely complete," which is the same bar `WEBSITE_BUILDER_FUNNEL_HANDOFF.md` explicitly aims for ("The free website should remain publishable and useful").
- **The Knot (US, international):** Same free-website-plus-registry model as Zola under the same parent company (XO Group/TheKnot Worldwide); leans on its vendor-directory and planning-tools ecosystem to keep couples in-app long before the website matters.
- **Kasal.com (PH):** Not a website-builder competitor at all — it's the Philippines' longest-running wedding *vendor directory/marketplace* (~20,000 suppliers, ~1M FB following) with an editorial content arm. It's a distribution channel/potential partner more than a rival product; still worth noting as the dominant PH wedding-content brand for SEO comparison purposes.
- **Bridestory (Indonesia, PH-expanded):** Also a vendor marketplace/app (15,000+ vendors, mood boards), not a website builder. Same category note as Kasal.com.
- **Direct local competitors surfaced by the keyword search that the existing docs don't mention:** My Wedding Planner Philippines (myweddingplanner.ph) and Bridalpod (bridalpod.ph) — both PH-based, both offer free wedding websites bundled with budget/guest-list/RSVP tools. Vowly (vowly-ph.com) is the closest positioning match to Reelday's own pitch — a dedicated free wedding-website-builder-with-RSVP-tracking play aimed at Filipino couples. None of these four were named in `docs/LEAD-MAGNET-PLAN.md`'s competitor table (which only listed Canva/Notion, Zola/The Knot, Kasal.com/Bridestory, and "nothing"); the PH-specific direct competitors are a gap in that doc's competitive picture.

---

## Content Engine

Already exists, more mature than the marketing docs give it credit for:

- **`tools/wall-recorder/MARKETING.md`** — a working Remotion (React/TypeScript) pipeline with fixed brand constants (colors, fonts), 3 reusable per-platform templates (FB 16:9 horizontal, IG Reel 9:16, TikTok 9:16 — same component, prop-swapped), reusable components (`WallFrame`, `TopStickyBar`, `POVCaption`, `EmojiFloat`, `BrandFooter`), and hard timing/safe-zone rules (hook minimum 90 frames, photo minimum 90 frames + 15-frame crossfade, platform-specific UI safe zones). Render scripts already wired in `package.json`. Content catalog shows **5 of 8 planned posts already built** (Product intro, How it works, Emoji reactions, Live poll, Live trivia — FB/IG/TikTok variants).
- **`reference/REVIEW-LOGIC.md`** — codified QA protocol from real published-post failures: ffmpeg contact sheets are unreliable for verifying playback order (must extract specific timestamp frames + get human confirmation instead), inverted-structure rule (climax at 0-3s, hook text 3-5s, content 5-25s, end card last 4s) traced directly to a real 0:04 drop-off problem on a real FB post, per-platform caption/hashtag conventions, and a pre-post checklist.
- **The gap:** both files are built around the "Own the Party" kids'-party/trivia narrative — sample slug `andrea-jm` is labeled as a wedding demo in `MARKETING.md`, but the hook copy examples throughout ("POV: May trivia tungkol sa couple," "🗳️ LIVE POLL — Bumoto na!") and the whole Post 5/6 catalog are trivia/poll-first, matching the retired kids'-party "the game" pillar, not the free-website-first wedding pivot. **A recurring content-automation routine should reuse this pipeline as-is (don't rebuild the Remotion infra) but needs new post concepts pointed at the free-website hook** ("libre ang wedding website niyo," the "Powered by Reelday" viral share moment, the Memory Album upgrade teaser) rather than only trivia/poll moments.

---

## Top 5 Priorities (ranked by impact/effort)

1. **Unblock `/e/` in `robots.txt` (or make an explicit, documented decision to keep it blocked).** Highest impact, near-zero engineering effort — it's a one-line robots.txt edit. Right now the lead-magnet plan's core organic-growth loop (every published free site = a backlink/impression surface, `LEAD-MAGNET-PLAN.md` §5 Loop 1) is structurally impossible: Google can't index pages it's told not to crawl. If there's a real privacy reason `/e/` was blocked (guest RSVP/seat data), resolve it per-page (e.g., `noindex` only for unpublished/private ones, allow published ones) rather than blanket-blocking the whole path. This should happen before any SEO content work below, since that work is wasted if the destination pages can't be indexed anyway.

2. **Publish the keyword-targeted landing page + expand the sitemap.** `docs/LEAD-MAGNET-PLAN.md` §3 Loop 1 already specifies the target queries ("free wedding website philippines," "libreng wedding website," "wedding RSVP website free," "wedding countdown website maker") and says this is "the highest-leverage single line item in the plan" — it just hasn't shipped. Low-to-medium effort (one page, reusing existing design system), high impact given competitors like Vowly, Bridalpod, and My Wedding Planner Philippines are already ranking for exactly this query and Reelday currently is not. Add it, `/website-builder`, and any future content pages to `sitemap.xml` (currently only 3 URLs).

3. **Resolve the social-presence gap — either revive/rebrand the existing FB/IG/TikTok accounts that `REVIEW-LOGIC.md` shows once had real posts and analytics, or explicitly decide social isn't a channel right now.** Medium effort, medium-high impact: a prospect who searches the brand name today finds a working product but no social proof anywhere, which is a trust gap at exactly the moment (email/SMS drip touchpoints in `LEAD-MAGNET-PLAN.md` §6) Reelday wants a warm lead to click through. Given the content-production pipeline already exists (see below), the blocker isn't content creation capacity — it's an account/distribution decision.

4. **Repoint the existing Remotion content pipeline at the free-website hook instead of only trivia/polls.** Medium effort (reuses all existing infra — brand constants, templates, timing rules — just needs new post concepts and a new demo asset showing the `/website-builder` flow and the "Powered by Reelday" guest-facing footer), medium impact. This is the natural fuel for whichever social-revival decision comes out of priority 3, and it's the piece a recurring content-automation routine should actually produce week to week.

5. **Re-scope the AI-bot allowlist in `robots.txt` if AI-answer-engine visibility is a real goal.** Lower impact today (AI Overviews/Perplexity citation volume is unlikely to be a near-term revenue driver at Reelday's current stage) but very low effort — a few lines in the Cloudflare-managed block — and directly contradicts work already done (`index.html`'s JSON-LD `Organization` block, added explicitly "for AI answer engines" per its own comment). Either allow `ai-input`/reference use for the major bots to make that JSON-LD investment pay off, or drop the "for AI answer engines" framing from the comment so the code and the stated intent agree.
