# SDE — Context Handover

Continuation notes for the **Same Day Edit (SDE)** feature build. Pick up
cold from here. Last updated: 2026-05-18. Working tree is clean and
everything below is pushed to `main`.

## What this feature is

Dalisay/Hiraya auto-rendered cinematic recap reel from guest uploads.
Authoritative spec: **[docs/same-day-edit-plan.md](same-day-edit-plan.md)**
(read it first — locked decisions + 7 build batches). Perf history:
**[docs/perf-test-database.md](perf-test-database.md)**.

Target reel length: **~4 minutes** (`maxTotalSec: 240`, `maxClips: 80`
in `backend/lib/sdeSelect.js`).

## Status — done & pushed

| Commit | What |
|---|---|
| `8ac9936`→`e90785e` | Plan doc: scope, batches, reactions-safe Curator, now-showing beacon, backend↔Lambda split |
| `85c32f4` | **Batch 0**: `sde` plan flag (`backend/lib/plans.js` + `frontend/js/plans.js`), migration (`event_sde`, `uploads.sde_pinned/sde_excluded`, `events.sde_play_*`) in `backend/plugins/database.js` + `database/schema.sql`, **now-showing beacon** in `backend/routes/reactions.js` + `frontend/wall.html` |
| `41abc94`,`ce50df6`,`245d540` | Perf entries 33–36 — beacon proven cost-free (local mixed rx p95 11 ms); full remote suite 0-fail |
| `d9f5869` | **Batch 1 backend**: `backend/lib/sdeSelect.js` (Curator) + `backend/routes/sde.js` (GET preview / PATCH pin-exclude), registered in `backend/server.js` |
| `ab81e4f` | **Batch 1 dashboard**: "Same Day Edit" panel + isolated `<script type="module">` at end of `frontend/dashboard.html` |
| `ee3da22` | Retune to ~4-minute reel |

Batches 0 & 1 are functionally complete and perf-validated. Migration
applies at backend boot — **a deploy/restart is required** for the new
routes + columns to be live.

## CURRENT TASK — in progress, NOT started in code

User request (verbatim intent): *change how the host picks SDE items.
On the **photo stream** and **video upload** dashboard tabs, every
thumbnail should have a **"Feature" button at the lower-left**. Enable
it. **All featured photos/videos must be in the Same Day Edit.** Then
**remove the cluttered all-uploads grid from the SDE panel** — the SDE
content is now whatever was preselected via the Feature button.*

So the curation model pivots: instead of the SDE panel's own
grid+pin/exclude, the host curates by "featuring" tiles in the normal
streams; SDE = featured set; SDE panel becomes a clean summary/strip
(no big toggle grid).

### Critical finding before any code (resolve this first)

`frontend/dashboard.html` **already has a `featured` concept** on
uploads, independent of the SDE work I added:
- a "Featured" sub-tab (~line 1903, `tab-featured-count`)
- filtering on `u.featured === true` (~lines 2400, 2415)
- `.up-card.featured` CSS ~line 1580 is the **pricing card, unrelated** — don't confuse them

**Unknown / must investigate next:** how is `uploads.featured`
persisted and toggled? Grep `backend/routes/uploads.js` (and admin.js,
schema/migrations) for `featured`. There is no `featured` column in
`database/schema.sql` / `database.js` MIGRATIONS that I added — find the
existing mechanism (column? endpoint? client-only?).

**Decision the next session must make and confirm with the user:**
does the "Feature" button drive (a) the **existing `featured` flag**
(then make `featured` the SDE source of truth — simplest if it's
already persisted), or (b) the **`sde_pinned`** column I added (via
existing `PATCH /api/events/:slug/sde/clips` with `state:'pinned'`)?
Recommended: reconcile to ONE flag. If `featured` is already a real
persisted column, reuse it and treat `featured == sde_pinned`; the
Curator (`sdeSelect.js`) should then select featured items first.

### Behavior to preserve

Keep the "always produces a reel" safety net: SDE = featured items;
**if zero featured, fall back to the existing reaction-ranked
auto-selection** in `sdeSelect.js` (don't delete the Curator logic —
the feature button just makes pins the primary path). Confirm this
with the user.

### Concrete next steps

1. Investigate the existing `featured` mechanism (uploads.js / admin.js
   / schema). Report findings + the (a)/(b) decision to the user.
2. Add/enable the lower-left Feature button on photo + video stream
   tiles in `dashboard.html` (find the tile/card builder — start near
   the thumbnail-URL helpers ~lines 2348–2400 and the sub-tab filter
   ~2400; the per-tile render function is in the **main** module).
3. Ensure the uploads list API returns the chosen flag so buttons
   render correct state on load.
4. Reconcile Curator: featured ⊆ SDE; reaction-rank fallback when none.
5. Declutter the SDE panel (the isolated module at end of
   `dashboard.html`): drop the all-uploads grid + per-tile Pin/Hide;
   show a clean featured-only summary + small ordered strip.
6. Syntax-check, commit, push.

## Standing rules (do NOT violate)

- **Commit AND push after every change, unprompted.** (User standing
  rule.) Use `Co-Authored-By: Claude ...` trailer.
- **`dashboard.html` footgun:** a duplicate top-level `const`/`function`
  inside one `<script type="module">` silently blanks the whole page.
  GREP before declaring. The SDE panel uses its **own isolated module**
  at end of `<body>` (3rd module) — that scope-isolation is deliberate;
  keep new SDE JS there. The main dashboard module is the large one
  starting ~line 2181 — be surgical there.
- **Perf process:** before any stress test read "Current best
  baselines" in `perf-test-database.md`; after, append a numbered entry
  to the date section, update baselines/scorecard/significant-changes
  if warranted, commit. `local` = Easypanel terminal
  `BASE_URL=http://localhost:3000`; `remote` = PH-laptop PowerShell
  (+600–1000 ms). Remote single-laptop back-to-back runs have a known
  TIME_WAIT latency artifact — not a backend regression.
- **Beacon perf is settled:** the now-showing beacon costs ~nothing
  (local mixed rx p95 11 ms). Don't re-litigate.
- **Single Node process confirmed** (Dockerfile `CMD`, no cluster) — the
  beacon's in-memory pointer is safe; only revisit if scaled to
  multiple replicas.
- **Counting is backend-only**; Lambda never touches the DB. Curator
  runs request-time only, never on the live wall path.
- **Tier gating:** `resolvePlan(event.plan || event.subscription_tier
  || 'tala')`; `sde` feature true for `dalisay`+`hiraya` only.
- **No new npm deps** (Easypanel build → 502 footgun).

## Key files

- `docs/same-day-edit-plan.md` — spec & batch roadmap (source of truth)
- `docs/perf-test-database.md` — perf log + process
- `backend/lib/sdeSelect.js` — the Curator (request-time tally + curate)
- `backend/routes/sde.js` — owner GET preview / PATCH pin-exclude
- `backend/routes/reactions.js` — now-showing beacon lives here
- `backend/lib/plans.js` / `frontend/js/plans.js` — `sde` flag (mirror)
- `frontend/dashboard.html` — main module (~2181) + **isolated SDE
  module at end of body**; existing `featured` sub-tab/flag to reconcile
- `frontend/wall.html` — beacon sends `&showing=<id>` on reactions poll

## Memory note

Auto-memory (`~/.claude/.../memory/`) has `project_same_day_edit.md`,
`project_event_website.md`, `project_plan_tiers_event_scoped.md`,
`reference_perf_log.md`, and the feedback rules — but that lives in the
user's home dir and **won't transfer across accounts/machines**. This
file + the two `docs/` files are the portable source of truth.
