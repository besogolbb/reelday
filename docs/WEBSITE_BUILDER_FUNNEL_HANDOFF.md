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

## Next Phase Recommendation (updated)

With Phase 2's conversion/trust surfaces in place, the next real decision is
whether to invest in the no-signup public builder (§2 above) or in moving
seat import / RSVP CSV into the standalone builder — both are still open.
Recommend gathering a signal first (e.g. drop-off rate on `/start`'s signup
step, or hosts asking for seat-list editing outside the dashboard) before
committing to either, rather than building speculatively.
