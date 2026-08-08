# Website Builder Funnel Handoff

## Goal

Reposition Reelday's Event Website Builder as the top-of-funnel lead magnet, then convert users into paid customers before the event by upgrading the free invitation into a full guest experience.

The desired flow is not "pay to build a website." The website is the free hook. Paid plans unlock the interactive event layer around the website: photo/video uploads, live wall, reactions, polls/questions, music, memory album, and longer retention.

## Current Product Context

- Guest invitation website URL remains `/e/{slug}`.
- Website feature is already enabled on every tier, including Tala/free.
- The old dashboard builder remains in `frontend/dashboard.html`, but Phase 1 made it dormant.
- The active authenticated builder now lives in `frontend/website-builder.html`.
- Public event site renderer lives in `frontend/event-site.html`.
- Backend APIs already exist in `backend/routes/event-site.js`.
- Paid conversion pressure currently comes more from upload limits, video/photo collection, polls, music, reactions, and retention than from the website itself.

## Recommended Architecture Direction

Create the website builder as a separate page rather than expanding `dashboard.html`.

Suggested host/admin builder URL:

`/website-builder?event={slug}`

Keep the dashboard Website tab lightweight:

- Shows draft/live status.
- Shows public guest URL `/e/{slug}`.
- Buttons: `Edit website`, `Open guest site`, `Copy link`.
- Optional: last updated date.

This keeps the dashboard fast and avoids adding a heavy split-screen editor, iframe preview, autosave, publish state, uploads, seat import, RSVP viewer, and mobile preview logic into an already-large dashboard file.

## Phase 1 Shipped

Phase 1 has been implemented.

Changed files:

- `backend/server.js`
- `frontend/dashboard.html`
- `frontend/website-builder.html`
- `docs/WEBSITE_BUILDER_FUNNEL_HANDOFF.md`

What shipped:

- Added `/website-builder`, serving `frontend/website-builder.html`.
- Added a standalone authenticated website builder at `/website-builder?event={slug}`.
- Kept guest website URL unchanged at `/e/{slug}`.
- Changed the dashboard Website section into a lightweight launcher/status card.
- Dashboard launcher now shows draft/live status, guest link, `Edit website`, `Open site`, and `Copy link`.
- Old dashboard wizard is still present but dormant behind `if (false && slug && panel)` for rollback during this transition.
- The standalone builder uses existing APIs:
  - `GET /api/event-site/:slug/admin`
  - `PUT /api/event-site/:slug`
  - `POST /api/event-site/:slug/image`
  - `PATCH /api/events/:slug` for cover photo
- The builder currently supports publishing with `is_published: true`.
- Seat import and RSVP CSV remain in the dashboard for this phase.

Validation run:

- `node --check backend\server.js`
- Extracted module syntax check for `frontend/website-builder.html`
- Extracted real dashboard module syntax checks for `frontend/dashboard.html`

Known Phase 1 limitations:

- No live iframe preview yet.
- No autosave yet.
- No no-signup public builder yet.
- Seat-list import and RSVP CSV are not yet moved into the standalone builder.
- The old dashboard wizard code should be deleted after the new builder is verified in-browser.

Correction (found during Phase 2 planning, by reading the actual shipped code
rather than trusting this list): the paid upgrade checklist and Memory Album
teaser copy were already implemented by the end of Phase 1, even though this
list originally said otherwise — see `renderUpgradePanel()` in
`frontend/website-builder.html` and the `isFreePlan` branch in
`frontend/event-site.html`'s Memory Album section. Keep this doc in sync with
the code going forward; don't let the two drift again.

## Guest Website URL

The guest invitation website should stay:

`/e/{slug}`

Example:

`https://reelday.ph/e/ana-miguel`

## Funnel Strategy

### 1. Landing Hook

Primary CTA:

`Create a free event website with RSVP`

The user should understand they can start without paying.

### 2. No-Signup Builder

Let users start building immediately before creating an account.

Fields can include:

- Event/couple name
- Event date and time
- Venue/address
- Cover photo
- Story/message
- Basic schedule
- Dress code and parking notes
- FAQ
- RSVP settings

The goal is to create emotional investment before asking for email.

### 3. Blurred or Soft-Gated Preview

Show a live or semi-live preview while the user builds.

The preview can be softly blurred, watermarked, or partially gated, but it should not feel hostile. The user should see enough to believe the site is real and desirable.

Avoid over-blurring. The preview should create desire, not frustration.

### 4. Finish Step Email Capture

Do not frame signup as a hard wall.

Recommended title:

`Save your event website`

Recommended copy:

`Create an email login so your invitation, RSVP setup, and edits don't get lost.`

Recommended CTA:

`Save and continue`

Small reassurance:

`Free to publish. Upgrade only when you want guest photo and video collection.`

### 5. Account Creation

After email/password or magic-link signup, convert the temporary builder draft into a real Tala/free event.

Then send the user to the authenticated builder or dashboard.

Recommended success message:

`Your website is saved. Publish it when you're ready.`

### 6. Free Publish

Let free users publish the basic website at:

`/e/{slug}`

Do not block publishing behind payment. Blocking publish risks feeling like bait-and-switch.

### 7. Pre-Share Upgrade Offer

After the website is saved or published, show the paid conversion offer before they share the link widely.

Recommended headline:

`Your invitation is ready. Want guests to do more than RSVP?`

Recommended CTA:

`Unlock guest experience`

The upgrade should be framed as preparing the event properly before guests arrive.

### 8. Setup Checklist

Show a pre-share checklist:

- Website ready
- RSVP ready
- Memory album locked
- Guest photo uploads locked
- Guest video uploads locked
- Live wall locked
- Polls/questions locked
- Reactions locked
- Music locked

This makes the value gap visible before the event.

## Free Website Builder Includes

Free should be valuable enough to share:

- Shareable event website at `/e/{slug}`
- Event name/couple name
- Event date and time
- Venue/address section
- Basic schedule
- Event story/message
- Dress code and parking notes
- Basic FAQ
- RSVP form
- Simple RSVP count in dashboard
- Basic cover photo
- Standard Reelday theme/template
- Reelday branding: `Powered by Reelday`
- Memory Album teaser section, but not full guest uploads
- Basic publish link and copy-link button

Free positioning:

`Create a free invitation website with RSVP.`

## Paid Upgrade Unlocks

Paid should not be positioned as "pay for the website." Position it as:

`Turn your invitation into a full guest experience.`

Paid unlocks:

- Guest photo uploads
- Guest video uploads
- Video greetings
- Live event wall
- Wall reactions
- Live polls/questions
- Background music
- Memory album
- Longer gallery retention
- Download/export memories
- QR sharing/signage kit
- Premium themes/custom colors, optional
- Remove or reduce Reelday branding, optional
- Seat finder/table lookup, optional if stronger pre-event conversion is needed
- RSVP export or advanced guest management, optional

## Pre-Event Conversion Levers

To make users upgrade before the event, emphasize planning and preparation benefits:

- `Before you share your invitation, add the guest experience.`
- `Let guests upload photos and videos from the same link.`
- `Show guest memories on your live event wall.`
- `Run polls and questions during the program.`
- `Create QR signs for tables, programs, and the welcome area.`
- `Keep memories available longer after the celebration.`

The paid plan should feel like the complete event hub, not a post-event cleanup tool.

## Memory Album as Conversion Bridge

The Memory Album placeholder is one of the strongest upgrade prompts.

On the free website, show a Memory Album teaser section with sample/empty/blurred cards:

`Memory Album`

`Unlock guest photo and video uploads so everyone can add memories from this event.`

CTA:

`Unlock Memory Album`

This works because guests are already visiting the invitation page. The paid plan unlocks better use of that traffic.

## Recommended Funnel Summary

`Build free invitation -> save account -> publish link -> upgrade before sharing to unlock guest experience`

Longer version:

1. User clicks `Create a free event website with RSVP`.
2. User builds without signup.
3. Preview personalizes as they type.
4. Finish step asks them to save with email so data is not lost.
5. Account and free event are created.
6. User can publish the basic website for free.
7. Before sharing, Reelday shows the guest-experience upgrade.
8. Paid plan unlocks guest uploads, live wall, reactions, polls/questions, music, retention, and memory album.

## Audit

This funnel is strong because:

- It has low initial friction.
- It lets users experience value before signup.
- It creates ownership before asking for an email.
- The free product is genuinely useful.
- The upgrade appears before sharing, when setup decisions are still being made.
- The value gap is clear: free equals invitation; paid equals interactive guest experience.
- It avoids bait-and-switch by not blocking basic publishing.
- It moves conversion earlier by selling event preparation, not after-event recovery.

Main caution:

Do not over-blur or over-limit the preview. The builder should feel useful and real. The upgrade should feel like making the event better, not escaping a trap.

## Implementation Notes

- Prefer a new builder page instead of expanding `frontend/dashboard.html`.
- Keep `/e/{slug}` unchanged for guests.
- Keep dashboard Website tab as a launcher/status panel.
- Avoid per-keystroke full-site iframe rendering as the default v1 if performance is a concern.
- Consider desktop-only preview, manual preview refresh, or section-debounced preview.
- If autosave is added, be careful with `is_published`: the current backend PUT route defaults missing `is_published` to `false`, which can accidentally unpublish a live site.
- A true draft-vs-live model requires backend/schema work. Without that, autosaving a published site updates the live config.

## Next Phase Recommendation

Phase 2 should focus on conversion and trust, not heavy preview complexity.

Recommended Phase 2 scope:

1. Add an upgrade/pre-share panel inside `frontend/website-builder.html`.
2. Add a Memory Album teaser to `frontend/event-site.html` for free/Tala events.
3. Add paid feature lock cards inside the builder checklist.
4. Add clearer free-vs-paid copy in dashboard and builder.
5. Move seat import and RSVP CSV into the standalone builder only if needed for product completeness.
6. Delete the dormant dashboard wizard after manual QA confirms the new builder works.

Recommended Phase 2 builder panel:

Title:

`Your invitation is ready. Want guests to do more than RSVP?`

Body:

`Turn this website into a full guest experience with photo uploads, video greetings, live wall, reactions, polls, music, and a memory album.`

CTA:

`Unlock guest experience`

Secondary:

`Publish free website only`

Checklist:

- Website ready
- RSVP ready
- Memory Album locked
- Photo uploads locked
- Video greetings locked
- Live wall locked
- Polls/questions locked
- Reactions locked
- Music locked

Recommended Phase 2 public-site Memory Album teaser:

Title:

`Memory Album`

Body:

`This event can collect guest photos and videos in one shared album.`

CTA for host-facing contexts:

`Unlock Memory Album`

Guest-safe version if visitors see it:

`Photo and video collection opens when the host enables Memory Album.`

Phase 2 caution:

Do not make the free invitation feel broken. The free website should remain publishable and useful. Paid should feel like the natural upgrade from invitation to interactive event hub.

## Phase 2 Shipped

Phase 2 has been implemented, scoped down from the recommendation above after
verifying against the actual shipped code (items 1 and 3 below were already
done by the end of Phase 1 — see the correction note above).

Changed files:

- `frontend/event-site.html`
- `frontend/dashboard.html`
- `frontend/website-builder.html`
- `docs/WEBSITE_BUILDER_FUNNEL_HANDOFF.md`

What shipped:

- Added a decorative, data-free Memory Album teaser (3 blurred/desaturated
  placeholder cards + a lock label) above the existing `isFreePlan` copy in
  `frontend/event-site.html`, so the free-plan upgrade copy has something
  visual to sit under instead of reading as bare text. Guest-safe: no CTA
  aimed at the guest, same restrained framing as before ("the host can
  unlock...").
- Added a free-vs-paid line to the dashboard's Event Website launcher card
  (`frontend/dashboard.html`), shown only for Tala/demo-plan events, with a
  link to `/#pricing`. Previously the launcher only ever showed Live/Draft
  status with no signal that anything was locked.
- Polished two feature-checklist labels in
  `frontend/website-builder.html`'s `renderUpgradePanel()` to match this
  doc's Phase 2 wording exactly ("Full Memory Album locked" → "Memory Album
  locked", "Unlimited photo uploads locked" → "Photo uploads locked").

Not done in this pass (per the Phase 2 recommendation's own guidance):

- Seat-list import / RSVP CSV migration into the standalone builder — still
  optional, no product signal yet that it's needed.
- Deleting the dormant dashboard wizard — still gated on manual in-browser QA.
- The no-signup public builder — a separate, larger future phase.

Validation run:

- `node --check` on the extracted inline `<script>` blocks of
  `frontend/event-site.html` and `frontend/dashboard.html`.
- Manual read-through confirming the free-plan gating (`isFreePlan` /
  `state.plan === 'tala' || state.plan === 'demo'`) is applied consistently
  across `event-site.html`, `dashboard.html`, and `website-builder.html`.

## Phase 3 Shipped

Phase 3 implements the "No-Signup Builder" (§2 above), but via a materially
different mechanism than originally sketched — two assumptions in this doc
turned out to be wrong when checked against the actual code rather than a
comment:

- **Anonymous event creation does not work today.** `tryGetUser()` in
  `backend/routes/events.js` (the source of this doc's "Anonymous event
  creation is still allowed (legacy)" claim) is dead code — never called.
  `POST /api/events` is hard-gated by `fastify.authenticate`; no token means
  a 401 before any handler logic runs.
- **There is no "claim an anonymous draft" mechanism anywhere**, and one
  built by inserting a null-`user_id` `events` row would fight the existing
  codebase: `uploads.js` explicitly 403s any orphan event, and every
  ownership check compares `user_id = $2`, which `NULL` can never satisfy.

Instead of new anonymous-draft infrastructure, Phase 3 extends `/start`'s
own proven pattern: it already collects event type, name, date, and plan
with zero account, and already stashes state in `sessionStorage` across a
full navigation to checkout and back for paid plans. **No new database
table, no new backend routes, no new unauthenticated write surface** — the
existing `POST /api/events` and `PUT /api/event-site/:slug` endpoints are
called slightly earlier in the existing flow.

Changed files: `frontend/start.html` only. No backend changes.

What shipped:

- One new optional, skippable slide ("Make it feel like yours") between the
  plan picker and account creation, collecting cover photo, venue, and a
  short story — the emotionally resonant fields, not the operational ones
  (schedule/FAQ/RSVP settings stay in the real builder, post-signup).
- A static hero-preview card (plain DOM text/background updates, not an
  iframe render of the real public site) — per this doc's own caution
  against per-keystroke full-site iframe previews.
- Cover photo needs no new anonymous upload endpoint: on the free/Tala path
  the picked `File` survives in memory for the whole page load, uploaded via
  the existing authenticated image endpoint immediately after the event is
  created. Not offered on the paid path (navigates away to checkout; a
  `File` object doesn't survive that) — paid hosts add it in the builder
  afterward, which they reach regardless.
- The write-back always sends `is_published: false`, exactly once,
  immediately after the event is created — content collected before a host
  has seen their dashboard must never go live on its own.
- Logged-in hosts starting a new event never see this slide — they already
  have an account and land straight in the full builder.

Not done (unchanged from Phase 2's open items):

- Seat-list import / RSVP CSV migration into the standalone builder.
- Deleting the dormant dashboard wizard — still gated on manual QA.

## Phase 4 Shipped

Phase 4 replaces Phase 3 as the primary free-tier entry point. Clarified
mid-session: the funnel's CTA should route straight into the real builder
(`frontend/website-builder.html`), matching the QuickWeds reference this
funnel was modeled on — not through `/start`'s wizard. `index.html`'s
marketing content is untouched; only where its free-tier CTAs point changed.

Two more assumptions in this doc turned out wrong, found the same way as
Phase 3's corrections — by reading the actual code, not trusting a comment:
`POST /api/events`'s `tryGetUser()` "anonymous creation allowed" comment
is dead code, never called; and an `events` row with `user_id = NULL` is
actively rejected elsewhere (`uploads.js`'s `orphan_event` 403, every
`user_id = $2` ownership check). So Phase 4 uses the same mechanism Phase 3
established — nothing written to the database until a real account exists
— just applied to the real builder page instead of a wizard slide.

Changed files: `frontend/website-builder.html`, `frontend/index.html`. No
backend changes.

What shipped:

- `website-builder.html` gains a third gate branch: no token + no slug =
  anonymous mode, using the real tabbed editor. A slug with no token is
  unchanged (still redirects to `/login` — editing a real event with no
  session is a different case).
- Welcome tab gains three anonymous-only fields (name, date, event type) —
  the basics `POST /api/events` needs, which live on `events` not
  `event_sites.config` and don't exist pre-signup.
- Cover photo and gallery uploads defer into memory (`File` objects, local
  blob-URL previews only) until a real event exists, then upload through
  the same authenticated endpoint the existing flow already uses.
- A static, non-iframe preview pane (names/date/venue/story, updating as
  typed) plus a Memory Album row reusing the exact blurred-card CSS
  already shipped on the public site (`event-site.html`'s
  `.es-album-teaser`) — not a second blur treatment.
- `localStorage` draft persistence (text only, not photos) — the one
  genuinely new mechanism this phase needed, since Phase 3's slide never
  left the page it lived on and so never risked a closed-tab loss.
- "Save your event website" finish panel: register → create the event →
  upload deferred photos → write the config with `is_published: false`
  (always, never a variable) → redirect to the dashboard. A
  "Continue editing" dismiss loses nothing, since the draft persists.
- Anonymous visitors' logo/Dashboard-button no longer point at
  `/my-events` (which would just bounce to `/login`); the upgrade panel
  is suppressed until there's a real event/RSVP count to back its
  checklist.
- `index.html`: hero CTAs, the final CTA, the five demo-type tiles, and
  the Tala pricing CTA now point at `/website-builder`. Sinag/Dalisay/
  Hiraya CTAs are untouched — `/start`'s checkout/resume flow keeps
  working exactly as before.

Phase 3's `/start` personalize slide is not removed — it still serves
paid-plan signups, which still go through `/start?plan=X`, unchanged. Its
audience narrows to that group now that free-tier visitors take the Phase 4
path instead.

Not done (unchanged from Phase 2/3's open items):

- Seat-list import / RSVP CSV migration into the standalone builder.
- Deleting the dormant dashboard wizard — still gated on manual QA.
- Google Sign-In in the anonymous builder — stays `/start`-only for now;
  email/password alone ships for v1.
- Magic-link signup and optional custom-slug entry at save time — both
  real ideas, both deferred.

## Next Phase Recommendation (updated)

With the real builder now reachable anonymously, the next real decision is
the same two open items as before, still not built speculatively: moving
seat import / RSVP CSV into the standalone builder (pending a real signal),
and deleting the dormant dashboard wizard (pending manual in-browser QA of
the full anonymous → signup → publish flow, now the more important QA
target given how much of the funnel now runs through it). A separate,
larger topic surfaced during Phase 4 planning — new pre-event paid gates on
currently-free functionality (RSVP caps/export, seat-finder gating, guest
reminders, QR kits, coordinator mode) — is deliberately out of scope here;
it's about gating existing free features to create new paid pressure
points, not about the funnel's entry point, and deserves its own planning
pass if pursued.

## Phase 4.1 Shipped — Template Robustness + Partial Flow QA

Triggered by a direct ask ("can we already share and market this?") rather
than by this doc's own Phase 4 plan — the answer surfaced real bugs, so the
work happened before the audit question could be answered honestly.

Changed files: `frontend/css/event-site.css`, `frontend/js/event-site-render.js`,
`frontend/website-builder.html`, `frontend/dashboard.html`.

What shipped:

- Fixed a chain of template bugs found while making the 4 style templates
  (Classic/Modern/Romantic/Bold Jewel) genuinely distinct rather than
  palette swaps: a `--card` cascade bug that left Bold Jewel's form
  fields/footer white (light text on white = invisible), a duplicated story
  heading, and the hero itself not reflecting the chosen template at all
  (the one thing visible without scrolling in the builder's phone preview).
- Ran an actual computed-WCAG-contrast pass (not eyeballing) across all 4
  templates. Found and fixed real AA failures: Romantic Blush's accent
  cleared only 3.18:1 as button text / 2.96:1 as small text on its own
  background (both fail 4.5:1) — darkened to a same-hue shade that clears
  ~5:1 in both roles. Bold Jewel's accent was fine as a button fill
  (6.28:1) but only 2.84:1 as text on its own dark surface, and no single
  shade of that hue passes both roles at once — split into `--accent` and
  a new `--accent-text` token (defaults to `--accent` everywhere else) so
  Bold Jewel's ~25 eyebrows/labels/icons use its existing lighter
  `--accent-soft` instead. Verified visually via headless-browser
  screenshots afterward, not just the contrast math.
- Mobile builder UX: the phone-mockup preview sat inline above the form on
  every single wizard step, so reaching that step's fields (or Back/
  Continue past them) meant scrolling past a tall re-rendered mockup every
  time. Below 860px it's now off-flow until a floating "Preview" button
  opens it as a full-screen overlay with a close button. Desktop unchanged.
- Dashboard: added a one-click "Publish now" button to the Event Website
  launcher card, shown only while draft. Closes a real gap in this doc's
  own §5/§6 flow — after "Save your event website" redirects here, the
  only prior path to actually going live was "Edit website" → reopen the
  entire wizard → hit Save & publish again on content already finished.
  Deliberately re-PUTs the exact `config` already fetched for the card
  (unchanged) rather than `{is_published:true}` alone — the endpoint is a
  full upsert that replaces `config` with whatever's in the body (empty
  object if omitted), so a naive version would have silently wiped the
  host's saved content.
- Found via headless-browser QA of the anonymous builder (not code
  review): the hero couple-names text could break mid-word around the
  ampersand ("Amara & Diego" → "Amara &Di" / "ego") on a narrow viewport.
  `buildCoupleNode()` joined name + `<span class="amp">` + name with no
  actual whitespace, only the span's CSS padding for visual spacing — one
  unbroken run with no valid break point once `overflow-wrap:break-word`
  needed to wrap it. Fixed with real space text nodes around the span.
  Shared render pipeline — this was live on the real guest page too, not
  just the preview.

Verification performed: headless-browser pass (Playwright/patchright) against
production — zero console/page errors, all 4 templates confirmed visually
distinct via screenshot, mobile floating-preview open/close confirmed
functional, RSVP form contrast confirmed legible on Romantic Blush and Bold
Jewel specifically. Production confirmed byte-identical to the repo after
each fix (diffed served CSS/JS against the committed files).

Not done — the launch/market question is not fully closed by this pass:

- No real end-to-end run of an actual signup → real account → real event →
  "Publish now" → viewing the live `/e/{slug}` guest page. Everything above
  verified the anonymous builder's UI and mechanics; it did not exercise a
  real conversion through account creation, which would create real test
  data in production and wasn't run without checking first.
- Deleting the dormant dashboard wizard is still gated on that same
  end-to-end run, unchanged from the Phase 4 recommendation above.
