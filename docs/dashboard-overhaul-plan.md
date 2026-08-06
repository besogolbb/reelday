# Dashboard UI/UX Overhaul Plan

**Target:** `frontend/dashboard.html` (8,502 lines — the production file)
**Created:** 2026-08-06
**Status:** Phases 0–4 complete (items 33, 39, 40 deferred), Phases 5–6 pending

> **Cold start:** read "The diagnosis" then jump to the first unchecked phase.
> Every item cites a file:line so you can start without re-deriving anything.

---

## Source captures

Two full-page captures of `reelday.ph/dashboard?slug=margie-marie` drove this audit:

| Capture | State | Page height |
|---|---|---:|
| `06_26_28` | Event complete (uploads closed Jul 22) | 8,822 px |
| `06_43_22` | Pre-event (uploads open Aug 15) | 9,492 px |

Measured height budget on the pre-event capture:

| Region | Height | Share |
|---|---:|---:|
| Header + stats + Event info strip | ~720 px | 8% |
| Upload-window banner | ~90 px | 1% |
| **Live Questions & Poll (expanded)** | **~6,690 px** | **76%** |
| Event Website (expanded wizard) | ~800 px | 8% |
| Same Day Edit (collapsed sliver) | ~95 px | 1% |
| **Photo stream + 12 photos** | **~895 px** | **10%** |

The right column ends at roughly y=2,400 — leaving **~6,400 px (73% of page height) of empty column.**

---

## The diagnosis

Three root causes. Everything in this plan traces back to one of them.

### 1. Accordions were used as a substitute for navigation

Polls, Event Website, and Same Day Edit are not disclosure panels — each is a full
application screen (a 21-record poll manager, a 9-step website builder, a reel
curator). Stacking three apps in one scroll means expanding any one buries the
rest, and since several can be open at once the page has no predictable shape.

Symptom: the page already carries **four separate tab bars in three visual styles** —
header pill, poll sub-tabs, stream switcher, stream status tabs. The fix removes a
level rather than adding one.

### 2. The dashboard has exactly one mode

It cannot distinguish *before*, *during*, and *after* an event — the three states
where a host wants completely different things. The `LIVE · N guests sharing`
badge is unconditional, so it displayed 12 days **before** one event and 19 days
**after** another.

### 3. The page is monochrome in value

```
Page background   --paper / body gradient   ~#FBF6EF    L = 0.919
Card surface      --dash-surface            ~#FEFCF8    L = 0.966
                                            ─────────────────────
                                            contrast = 1.05 : 1
```

Cards are the same value as the page they sit on, and `--dash-border` at 10% alpha
computes to roughly 1.2:1. Nothing has an edge, so twenty stacked panels read as
one continuous cream wash. **That is the "crowded and confusing" feeling** — not
density, but the absence of boundaries.

---

## Scope decisions

- **Same Day Edit is NOT shipped.** No hero, no promotion. It stays behind its
  existing beta allowlist — invisible to every host not on it. Allowlisted hosts
  keep the full working feature, so the Feature pin (which only sets
  `sde_pinned`) and the `Reel` nav item are gated on that same flag rather than
  hidden outright: hiding the pin from a beta host would remove their only way
  to curate the reel.
- **No dark mode.** Considered and dropped.
- **The design system is retained.** Fraunces / Inter / JetBrains Mono, cream
  paper, terracotta accent, rounded panels, soft shadows. Nothing here changes the
  identity — the value ladder and the semantic layer are additions, not
  replacements.

---

## Phases at a glance

| Phase | Theme | Effort | Status |
|---|---|---:|---|
| **0** | Quick wins | 2 hrs | ✅ done |
| **1** | Section routing (the overhaul) | 1 day | ✅ done |
| **2** | Three states | 2 days | ✅ done |
| **3** | Live & mobile triage | 2 days | ✅ done (33 deferred) |
| **4** | Content density | 1.5 days | ✅ done (39, 40 deferred) |
| **5** | Correctness & accessibility | 1.5 days | ☐ |
| **6** | Trust & polish | 2.5 days | ☐ |

**56 items · ~10 working days**

---

## Phase 0 — Quick wins ✅

No structural risk. Changes how the product feels before any layout work, so
later phases can be judged against a fixed baseline.

| # | Fix | Where |
|---|---|---|
| 1 | Darken page gradient (`#efe5d7 → #f3ebe0`), card surface → solid `#FFFFFF`. Card/page contrast **1.05–1.11 → 1.18–1.25:1** (measured) | `dashboard.html:22`, `:53-58` |
| 2 | Visible hairline: `--dash-border` `rgba(83,48,33,.10)` → `#E0D2C0` (**1.48:1** measured) | `dashboard.html:23` |
| 3 | **AA fix:** birthday accent `#d97706` → `#B45309`. White-on-accent **3.19 → 5.02:1** (measured) | `css/shared.css:56` |
| 4 | Semantic danger `#dc3545` → `#B42318` (the Bootstrap red was off-palette) | `dashboard.html:1706,1882,1889,3334` |
| 5 | Stale collapse labels — "tap to expand" showed while expanded | `dashboard.html:5337,7226` |
| 6 | Sticky sidebar (`position:sticky; top:20px`) | `dashboard.html:1922` |
| 7 | Clip the `stream-tabs-3d` canvas artifact (gray smudge under active tab) | `dashboard.html:403` |
| 8 | Hide zero-count sub-tabs (4 of 5 read `0`); `All` always shown | `dashboard.html:3915` |
| 9 | Hide the Feature pin until SDE ships | `dashboard.html:4856` |
| 10 | Delete the stale root `dashboard.html` prototype (dummy data + TODOs) | repo root |

### Contrast note — correction

An earlier draft of this plan specified `#E3D5C4` at "3.1:1". That number was
wrong: `#E3D5C4` measures **~1.44:1** against white. Reaching a true 3:1 hairline
requires roughly `#A89078`, which reads as a heavy outline and would break the
editorial aesthetic.

The honest position: WCAG 1.4.11's 3:1 requirement targets *components whose state
must be perceived*, not decorative card boundaries. The real separation work is
done by the **surface step** (1.05 → 1.21:1); the border is a supporting hairline
at ~1.5:1. Form inputs and toggles — actual components — should still be brought
to 3:1 in Phase 5.

---

## Phase 1 — Section routing ✅

**The overhaul.** Replaces the accordion cards with a top navigation.

| # | Item | Detail |
|---|---|---|
| 11 | Promote the header nav to real section nav | `Gallery · Polls · Website · Settings` left; `Wall ↗` `Upload ↗` right. Adds zero new UI — the bar exists and does almost nothing today (`:3031-3037`) |
| 12 | One section renders at a time, `location.hash`-driven | `#gallery` default. Back/forward/refresh work; supports deep links from email |
| 13 | Sticky condensed bar once the header scrolls past | Sections stay long (21-question manager, website form); nav must survive scroll depth |
| 14 | Cut tab depth 4 → 2 | Header pill + poll sub-tabs + stream switcher + status tabs → section nav + gallery filter |
| 15 | Dead right column resolved | Falls out of 11–13 |
| 16 | Retire the Event info strip | Reads as a second stats row. `Plan`/`Wall expires` → Settings; `Download all` → Gallery sidebar |
| 17 | Mobile bottom nav = section nav | `Photos · Polls · Site · Settings` + pending badge. Replaced Home/QR/Details scroll shortcuts |

**Shipped notes**

- Sections live in `.col-main` as `<section class="dash-section" data-section="...">`; the
  router sets `document.body.dataset.section`, which drives the sidebar
  (Gallery only) and the single-column layout for every other section.
- The sticky bar is `position: fixed` + `translateY`, not `sticky` + `hidden` —
  toggling a sticky element in and out of flow shifts everything below it by its
  own height at the moment it appears.
- Panels auto-expand on section entry via a `dash:section` CustomEvent, so the
  three isolated modules keep their separate scopes.
- **Corrected from Phase 0:** the Feature pin had been hard-disabled, which
  removed reel curation for SDE beta hosts. The allowlist moved into the main
  module as the single source of truth and is published on `window.__sdeBeta`;
  the pin, the "Featured" tab and the new Reel section all gate on it.

**Result: 9,492 px → ~1,900 px default view. Photos move from the 88% scroll mark to the top.**

### Nav spec

```
Resting (in dark header):
  Reelday.ph   [ Gallery │ Polls │ Website │ ⚙ ]      Wall ↗  Upload ↗  benedictJan ▾

Stuck (header scrolled past):
  ⌂ MARGIE & MARIE │ Gallery │ Polls ② │ Website │ ⚙ │ Wall ↗
```

| State | Treatment |
|---|---|
| Active | Filled pill, `--surface` on the dark bar |
| Inactive | `rgba(251,245,236,.65)` |
| With count | Small badge, only when non-zero |
| Pending alert | `Gallery` carries an accent dot when pending ≥ 1 |
| External | Trailing `↗`, no active state, right-grouped |

The three panel bodies are already isolated `<script type="module">` blocks with no
shared scope (`:7201`, `:8020`), so this is mostly show/hide plus hash handling.

---

## Phase 2 — Three states ✅

| # | Item | Detail |
|---|---|---|
| 18 | Derive `dashState` from `event_date` + upload window + `archived_at` | All data already present |
| 19 | State badge | `◐ Opens in 9 days` (gold, static) / `● LIVE · 47 sharing` (green, **pulsing**) / `✓ Event complete` (muted, static). Pulse becomes meaningful because it only runs when live |
| 20 | **Upcoming:** readiness checklist replaces the stats row | Stats are three zeros pre-event |
| 21 | **Upcoming:** countdown is the hero | `Opens in 9 days` currently appears nowhere prominent |
| 22 | **Upcoming:** "Share QR" as a real task | Copy link + Poster buttons. Today the QR has no share affordance |
| 23 | **Complete:** `Download all (.zip)` becomes primary | Currently a mono micro-button in the 5th info-strip cell, while non-interactive `★ DALISAY` gets a large gold card |
| 24 | Swap dead CTAs per state | "Open upload page →" is the loudest sidebar button while uploads are CLOSED |
| 25 | Semantic banners: ℹ info vs ⚠ warning | "Uploads open soon" (good news) uses an orange warning triangle identical to the closed-window error |
| 26 | Drop `↑ 0 in last hour` at zero; de-dupe the window pill + banner | |

### Readiness checklist (Upcoming)

```
┌─ Get ready ─────────────────────────── 3 of 6 done ──┐
│  ✓  Event created                                     │
│  ✓  Wall music set          Party · Upbeat & Fun      │
│  ✓  Trivia ready            21 questions              │
│  ○  Event website           Draft      [Set up →]     │
│  ○  Welcome message         Not set    [Add →]        │
│  ○  Share QR with guests    [Copy link] [Poster .pdf] │
│  ──────────────────────────────────────────────────   │
│  Host test uploads   ████████░░░░  15 of 20           │
└───────────────────────────────────────────────────────┘
```

Sources: website `status`, `custom_music`, poll count, `welcome_message`, upload
count. No new endpoints. **This is also the first-run/onboarding screen** — it
should appear the moment an event is created and stay until the first guest
upload lands.

### Live layout

```
   ● LIVE · 47 guests sharing              [ Open wall ↗ ]
   ┌───────────┬───────────┬─────────────┐
   │    847    │    47     │  ⚠   3      │   ← only this one is tappable
   │  uploads  │  guests   │ need review │
   └───────────┴───────────┴─────────────┘
   ┌───────────────────────────────────────┐
   │      Review 3 pending  →              │   ← only when > 0
   └───────────────────────────────────────┘
   ▶ Run next question   ·   Q7 of 21        ← polls reduced to one control
```

Rules: pending is the only alert and vanishes at zero; polls collapse to the MC's
single action; Website is one nav tap away and takes zero pixels.

---

## Phase 3 — Live & mobile triage ✅

The state that matters most is currently served worst — the host is on a phone,
one-handed, in a dim venue.

| # | Item | Where |
|---|---|---|
| 27 | **Touch-visible tile actions.** `.actions-overlay` is `opacity:0` revealed only by `:hover`, not gated on `@media (hover:hover)` — **on touch, one-tap approve does not exist** | `:1812-1819` |
| 28 | **Bulk approve / feature / hide.** Select mode offers exactly one action and it's the irreversible one | `:3331` |
| 29 | **Preview modal ‹ › navigation** + auto-advance on approve. Five equal-weight buttons today with Delete two slots from Approve, and no way to move between items — clearing 40 pending costs ~160 interactions | `:3437-3443` |
| 30 | **Undo** on hide/delete (6s toast) + typed confirm for bulk delete | |
| 31 | Pending as the alert: tappable stat card + full-width CTA, both gone at zero | |
| 32 | Pending badge in the mobile bottom nav | |
| 33 | Polls collapse to `▶ Run next question` in the live state | |
| 34 | Keyboard shortcuts (desktop): `A` approve, `H` hide, `←/→` navigate | Nearly free once tiles are buttons (#48) |
| 35 | **Gallery empty state** — render the QR, Copy link, and Share (Web Share API → Viber/Messenger) inline. Today it says "Share the QR code with your guests!" and gives nothing to do it with | `:4791-4795` |
| 36 | Search + sort by uploader | No way to find one guest's photos in 800 tiles |
| 37 | Grid density toggle (2 / 4 / 8 col, persisted) | |

---

## Phase 4 — Content density ✅

| # | Item | Detail |
|---|---|---|
| 38 | **Poll recap → collapsed rows** + "Expand all" | 21 open cards = 6,690 px, 76% of the page |
| 39 | **Website: 9-step wizard → one grouped page** | Jump nav (`Basics · Story · Entourage · Registry · RSVP`) + sticky save. Copy says *"fill in any order"* but navigation is linear-only `Next →`; step 1 holds two fields |
| 40 | **Merge settings.** Sidebar form + Settings modal → one Settings section | A modal is the wrong container for 20+ fields. Today: name/date/toggles/danger in the modal (`:3562`), welcome/venue/time/music in the sidebar (`:3352`) |
| 41 | **Mono → Inter on all buttons** | `DOWNLOAD ALL (.ZIP)`, `SELECT`, `HOST RECAP`, `CLEAR RESULTS`. Mono uppercase is a label voice — on a button the control stops reading as clickable |
| 42 | Ink ramp + body size | 4 steps with stated ratios; panel copy 13px → 14px; `--ink-faint` (3.3:1) restricted to disabled only (`:396`) |
| 43 | `CLEAR RESULTS` → overflow menu, danger styling, confirm | Currently identical weight to the benign `HOST RECAP` beside it |
| 44 | **Header compression** — 760 px of chrome → ~390 px | `padding 32/28/96 → 24/28/72`; `h1 clamp 44–88 → 40–68`; stat padding `24/26 → 18/22`. Keeps the signature overlapping-cards move |

---

## Phase 5 — Correctness & accessibility ☐

| # | Item | Where |
|---|---|---|
| 45 | **Rename "Featured" → "In the reel"** (when SDE ships) | Tab filters `sde_pinned` but panel copy calls it a moderation status alongside pending/hidden (`:3906`, `:3292`) |
| 46 | **Fix 15 vs 12.** Stats count all streams, tab counts are stream-scoped | Show `15 total · 12 photos, 2 videos, 1 message` (`:4773`) |
| 47 | **Keyed diff instead of `innerHTML`** | Full grid teardown every 10 s destroys scroll, hover, lazy observers, and re-requests every image (`:4799`) |
| 48 | **Paginate** | All uploads fetched every 10 s with no limit — at 900 uploads that's a large payload on venue wifi (`:6873`) |
| 49 | **Pause timers on hidden tab** | Four intervals (10s/5s/3s/12s) run forever; `visibilitychange` only reloads on *return* (`:7189`, `:3654`) |
| 50 | **Tiles as `<button>`** with `aria-label` | Bare `<div>`s — no keyboard path to any upload (`:4862`) |
| 51 | `role="status" aria-live="polite"` on toast + pending counter | `:3419` |
| 52 | Visible `:focus-visible` rings on all custom controls | Tiles, pins, toggles, tabs — none today |
| 53 | Form inputs and toggles to 3:1 border contrast | The real WCAG 1.4.11 targets |

---

## Phase 6 — Trust & polish ☐

| # | Item | Detail |
|---|---|---|
| 54 | **Connection status.** `refreshUploads` catches every failure and falls back to `localStorage` silently (`:6886`) — if the API dies mid-reception the dashboard looks completely normal | `Updated 4s ago` → `⚠ Reconnecting…` after two consecutive failures |
| 55 | **Wall health indicator.** "Is the wall actually running?" is the top host anxiety during an event and the dashboard can't answer it. Wall playback errors are already collected (`:7191`) | `Wall: playing · 12 min` beside `Open wall ↗` |
| 56 | **Skeleton loading.** Centred spinner then everything at once (`:3116`); with an unpaginated 900-upload fetch that's a long blank | Skeleton stats + grid |
| 57 | **Real error states.** `😔 Event not found.` (`:3121`) with no retry and no distinction between wrong slug / not your event / API down | Retry button + distinct cases |
| 58 | **Event switcher** in the header | Hiraya is up to 10 events/yr; switching today is account menu → My events → find → click. Make the event name a dropdown with state dots |
| 59 | `prefers-reduced-motion` guard | Badge pulse, hover lifts, lazy video hydration — no guard anywhere (`:39`, `:4871`) |
| 60 | Remove `.stat:hover` lift on non-interactive cards | Implies clickability that isn't there (`:344`) |

---

## Verified contrast reference

White-on-accent, all eight themes (`css/shared.css`):

| Theme | Accent | Ratio | |
|---|---|---:|---|
| wedding | `#b85230` | 4.90 | ✓ |
| debut | `#b6457a` | 5.09 | ✓ |
| **birthday** | `#d97706` → **`#B45309`** | 3.19 → **5.05** | fixed in Phase 0 |
| baptism | `#3b6ea8` | 5.27 | ✓ |
| reunion | `#2d6a4a` | 6.39 | ✓ |
| corporate | `#2a3548` | 11.0 | ✓ |
| memorial | `#4a6b4a` | 6.01 | ✓ |
| seventh_birthday | `#7d3aa8` | 6.90 | ✓ |

The `wedding` token carries the comment *"darkened from #c45a3a so white-on-accent
clears WCAG AA"* — that fix was applied to one theme and never rolled out to the
other seven. Birthday was the only remaining failure.

### Proposed token additions (Phases 4–5)

```css
/* Surfaces — elevation ladder */
--canvas:        #F1E8DB;   /* page                          */
--surface:       #FFFFFF;   /* cards        1.21:1 vs canvas  */
--surface-2:     #FBF6EE;   /* inset / nested                 */
--surface-sunk:  #EFE6D8;   /* wells, disabled fields         */
--border:        #E0D2C0;   /* hairlines    ~1.5:1            */
--border-strong: #C9B49C;   /* section dividers               */

/* Ink — four steps, measured on --surface */
--ink:        #241611;   /* headings          14.8:1 */
--ink-body:   #4A382F;   /* body               8.2:1 */
--ink-muted:  #6E5B4E;   /* labels, meta       5.0:1 */
--ink-faint:  #8B7869;   /* disabled ONLY      3.3:1 */

/* Semantic layer */
--success: #2D7A4A;  --success-wash: rgba(45,122,74,.09);
--warning: #B45309;  --warning-wash: rgba(180,83,9,.09);
--danger:  #B42318;  --danger-wash:  rgba(180,35,24,.09);
--info:    #2D4A3D;  --info-wash:    rgba(45,74,61,.09);
```

### Typography voices

| Voice | Use for | Never for |
|---|---|---|
| JetBrains Mono, uppercase, ≥11px, ≤3 words | Field labels, metadata, badges | Buttons, sentences |
| Inter 13–15px sentence case | **All buttons**, body, hints | — |
| Fraunces | Headings, stat numbers | Body copy |

11px uppercase mono currently does far too many jobs: stat labels, info-strip
labels, the live badge, tab counts, `HOST RECAP`, `CLEAR RESULTS`, `SELECT`,
`FEATURE` pins, `STEP 1 OF 9`, the QR URL, and the `DOWNLOAD ALL (.ZIP)` button.

---

## Out of scope

Guest-side flows (upload page, wall), pricing surfaces, and the Same Day Edit
feature itself. Revisit SDE promotion once it ships.

---

## Phase 2 — shipped notes

- `computeDashState(event)` is the single source of truth: `complete` if
  `archived_at` or the window has closed, `upcoming` if it hasn't opened,
  otherwise `live`. Legacy events with no window dates read `live`, matching
  backend behaviour. `document.body.dataset.state` carries it to CSS.
- **`daysUntil` counts calendar days, not elapsed milliseconds.** A ms-based
  `ceil` told a host on 6 Aug that a 15 Aug window opened "in 10 days" as soon
  as the clock passed the opening time-of-day. Local midnights are compared
  instead.
- **`↑ N in last hour` was never computed** — the span was hardcoded `0` in
  markup, so it read "↑ 0 in last hour" permanently. Now derived from
  `created_at` and hidden entirely at zero.
- The informational banner tone (`.lock-banner.is-info`) already existed for the
  Tala demo branch; "Uploads open soon" simply never used it. Applied for paid
  hosts — an unpaid host still needs the warning plus the upgrade CTA.
- The readiness checklist covers what the main module can answer alone. The
  Website and Polls modules are in separate scopes, so they announce via a
  `dash:ready-item` CustomEvent and get spliced in; a locked plan never fires
  and the row simply never appears.
- The Wall music row is skipped on Tala, where walls are silent by design —
  otherwise it would be a task the host cannot complete.

### Verification

`computeDashState` is extracted from the shipped page and exercised against a
frozen clock at the capture timestamp, covering both real captures plus
archived, legacy-no-window, Tala in/after demo, and the opens-tomorrow boundary.
Run: `node state.test.mjs` (scratchpad).

---

## Phase 3 — shipped notes

- **`visibleUploads()` is the single source of truth** for what the grid shows
  (stream → tab → guest search). The chain was previously rebuilt by hand in
  three places, and they *had* to agree because the tile click handler maps a
  DOM index back into that list — a drift there sends an action to the wrong
  photo. Written once now; the test asserts the chain appears exactly once.
- Touch reveal: the overlay defaults to **visible** and the hover-reveal is
  gated behind `@media (hover: hover) and (pointer: fine)`, with
  `:focus-within` for keyboard. Previously `opacity: 0` + bare `:hover`, so
  one-tap approve did not exist on a phone.
- Bulk actions run **sequentially**, not `Promise.all` — a host clearing 200
  pending on venue wifi should not fire 200 simultaneous requests.
- Bulk Feature posts to `PATCH /api/events/:slug/sde/clips` with
  `{id, state:'pinned'}` — the same endpoint and payload as the per-tile pin.
  (An earlier draft invented `/api/sde/:slug/clips/:id`; corrected against
  `handleFeatureToggle`.) Hidden entirely while `SDE_SHIPPED` is false.
- **Undo is offered only where it is actually possible.** Hide is reversible, so it
  gets a 6-second Undo toast. Delete removes the object from R2 and cannot be
  undone, so bulk delete instead requires typing the item count — a one-word
  confirm is too cheap for an irreversible action on someone's wedding photos.
- `advanceAfterAction()` lands on the item that *slid into* the acted index
  rather than stepping past it, clamps at the end of the list, and closes the
  modal when the queue empties.
- Keyboard shortcuts bail out inside inputs/textareas/contenteditable and
  ignore modified keys, so they can't hijack typing.
- The pending stat card is a real `<button>`, so its children are spans —
  `<button>` only accepts phrasing content, and `<div>` children are invalid
  even though browsers tolerate them.

### Deferred

**Item 33 (polls collapse to "▶ Run next question" in the live state)** is not
done. It needs live-state behaviour that only manifests during an actual event
and cross-module coordination with the polls manager; shipping it untested
against a real event is a worse bet than leaving the current panel. Revisit
alongside Phase 4's poll-recap work.

### Verification

`triage.test.mjs` — 22 checks covering the single-source-of-truth invariant,
touch-reveal gating, bulk wiring and endpoint parity, undo-only-where-possible,
the `advanceAfterAction` neighbour rule (middle / first / last / only), and
shortcut guards. Run alongside `nav`, `router` and `state` suites.

---

## Phase 4 — shipped notes

Scoped to the five self-contained items (38, 41–44); the two form refactors
(39: 9-step website wizard, 40: merge sidebar + Settings modal) are large
enough to need their own pass and are deferred alongside item 33.

- **Poll recap cards are `<details>` now, collapsed by default.** 21 expanded
  cards measured ~6,690px — 76% of the whole dashboard — for a backtrack log
  the host consults occasionally. Each collapsed row shows the question, the
  winner (or "Not answered"), and a chevron; opening reveals the full history.
  An "Expand all" toggle sits beside Clear results for the rare full-scan.
- **Clear results now requires typing `CLEAR`.** It permanently deletes every
  recorded winner and previously sat beside the benign "Host recap" button
  with identical weight behind a one-click `confirm()`. Bulk delete's
  type-the-count pattern (Phase 3) is the template — same reasoning: a
  one-word confirm is too cheap for an action with no undo.
- **Header compressed.** `padding: 28px 28px 124px` → `22px 28px 96px`; h1
  clamp `48–82px` → `40–66px`. Roughly halves the chrome before the first
  useful pixel; the overlapping stat cards are untouched.
- **Mono → Inter on buttons that act.** `.info-download-btn` (Download all
  .zip — one of the most important post-event actions, previously reading as
  a caption), `#btn-select-mode`, `.lb-clear-btn`. Mono uppercase stays for
  labels/metadata/badges; sentence-case Inter is now the rule for anything
  clickable. Button label text was already sentence case in markup — only
  the CSS was shouting.
- **Ink ramp added as dashboard-local tokens**, not edits to the shared
  `--ink-faint` (a `shared.css` token other pages depend on):
  `--ink-body #4a382f` (11.1:1 on white) and `--dash-muted` darkened from
  `#7f6b62` to `#6e5b4e` (6.4:1). Panel description copy — `.panel-head-copy
  p`, `#stream-sub` — moved off `--dash-muted` onto `--ink-body` and 13px→14px.

### Verification

`density.test.mjs` — 17 checks: recap collapse structure, the CLEAR
confirmation gate (and that the old one-click confirm is gone), the header
compression values, that the three named buttons carry no mono/uppercase
styling, and the two new ink tokens computed against real WCAG contrast math
(both clear 4.5:1 AA on white — 11.06:1 and 6.42:1 respectively, better than
first drafted). nav/router/state/triage suites still pass.
