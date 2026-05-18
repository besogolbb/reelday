# SDE — Handover

Cold-start pointer for the **Same Day Edit** build. Working tree clean,
all on `main`. Spec: [same-day-edit-plan.md](same-day-edit-plan.md).
Perf log: [perf-test-database.md](perf-test-database.md). Last updated
**2026-05-18** (Slice 2B backend + Slice 2C frontend both shipped;
first real reel rendered end-to-end and verified by host; SDE feature
is now host-usable on a 3 GB Lambda).

## Shipped (chronological)

| Commit | Slice | What |
|---|---|---|
| `85c32f4` | B0 | `sde` plan flag, migrations (`event_sde`, `uploads.sde_pinned/excluded`, `events.sde_play_*`), now-showing beacon |
| `d9f5869` | B1-be | [backend/lib/sdeSelect.js](../backend/lib/sdeSelect.js) Curator + [backend/routes/sde.js](../backend/routes/sde.js) GET/PATCH |
| `ab81e4f`,`ee3da22` | B1-fe | SDE panel in [frontend/dashboard.html](../frontend/dashboard.html) (isolated module); retune to ~4 min |
| `ff88437` | pivot | **Feature pin = SDE source of truth.** Persistent lower-left ★ on every tile → PATCH `/sde/clips`. Dead frontend-only `featured` flag retired. `filterUploads`+`updateTabCounts` now key on `sde_pinned`. |
| `0c28572` | pivot | Live sync: main dispatches `reelday:sde-changed`, panel listens (120 ms debounce, skip-if-collapsed). |
| `24fdd50` | pivot | SDE strip: dropped `#N/68` badge; left-to-right order carries meaning. |
| `ff9f816` | copy | Empty-state: *"your reel will auto-build by AI."* |
| `22a2baf` | perf | SDE strip thumbs via inline `sdeThumb` (CDN `width=200`); main grid 600→360. |
| `2d67215` | **B2A** | [lambda/sde.mjs](../lambda/sde.mjs) — pure media worker (477 LOC). Not yet invoked. |
| `632cb81` | 2B-1 | `POST /api/events/:slug/sde/generate` + [backend/lib/sdeRenderInvoke.js](../backend/lib/sdeRenderInvoke.js) — owner-gated, row-debounced, async-invokes the Lambda |
| `8c3b9d2` | 2B-2 | `POST /api/webhooks/sde-ready` — mirrors `video-ready` pattern; updates `event_sde` + merges `event_sites.config.sde` |
| `705eafc` | 2B-3 | Title/endcard via `drawtext` (no PNG step). New payload fields `title`/`subtitle`/`endcardText`; font from `SDE_FONT_PATH` |
| `d4e0735` | hardening | Card render failure must never fail the whole render (drawtext can be unavailable on minimal FFmpeg layers) |
| `369691d` | hardening | `SDE_X264_PRESET` + `SDE_KEN_BURNS` env knobs so 68-clip 1080p reels fit in the AWS new-account 3 GB Lambda cap |
| `cce2489` | polish | Blur-fill background instead of letterbox black bars (split + boxblur + overlay) |
| `b76815e` | hardening | Await the success-path webhook (silent webhook-miss bug: render succeeded, DB stayed stale) |
| `a41a3b3` | hardening | Fix video-clip freeze at brick boundaries (`-fflags +shortest` + finite anullsrc); resolved the duration anomaly too (397s → 231s, matches Curator's 240s cap) |
| `183865e` | **2C** | Generate button + status pill + Watch / Regenerate in [dashboard.html](../frontend/dashboard.html) SDE panel — drives the render bar off `GET /sde.status` + `POST /sde/generate`; polls every 12 s while queued/rendering; auto-resumes on refresh; stops on collapse |

## Curation model (current truth)

- `uploads.sde_pinned` is the **only** curation flag the UI touches.
- Featured ≡ pinned ≡ guaranteed in the SDE.
- `uploads.sde_excluded` column exists but **no UI sets it** (Hide removed from SDE panel during pivot). Orphan-but-cheap; revisit only if hosts ask.
- Curator order: **pinned-first → score-fill → recency top-up → final chronological sort by `created_at`** ([sdeSelect.js:109-158](../backend/lib/sdeSelect.js#L109-L158)).
- Empty-featured ⇒ pure reaction-rank fill (the safety net we keep).

## Locked decisions (don't relitigate)

- **No manual reordering / drag-drop** — AI-only positioning is the product story.
- **SDE strip read-only** — host curates via the Feature pin in stream tiles, never inside the panel.
- **Lambda renders silent if `audioKey` null** — backend picks defaults (Slice 2B). Silent path is a safety net, not the product experience.
- **Cards = pre-rendered PNG overlays** (not `drawtext`). PNG generation lives in backend Slice 2B.
- **Beat-sync, transitions, LUT = Batch 3.** Slice 2A produces hard cuts; this is intentional.
- **Counting backend-only; Lambda never touches DB.** Curator runs request-time only.
- **No new npm deps** (Easypanel 502 footgun).
- **Beacon settled** — local mixed rx p95 11 ms, single Node process confirmed; safe.

## Slice 2B — DONE (backend plumbing shipped)

All three pieces landed across `632cb81`/`8c3b9d2`/`705eafc`:

1. **`POST /api/events/:slug/sde/generate`** ([sde.js](../backend/routes/sde.js)) — owner, `sde`-gated, row-debounced (rejects 409 if `status IN ('queued','rendering')`). Runs Curator → resolves R2 key per clip (`compressed_key`→`original_key`→derived) → picks music (chain: event's `music_tracks` → curated playlist lead → `SDE_DEFAULT_AUDIO_KEY` env → null) → builds payload → async-invokes via [backend/lib/sdeRenderInvoke.js](../backend/lib/sdeRenderInvoke.js) (env `SDE_LAMBDA_NAME`) → upserts `event_sde.status='queued'` (preserves last good `video_url`/`poster_url` for dashboard continuity).
2. **`POST /api/webhooks/sde-ready`** ([webhooks.js](../backend/routes/webhooks.js)) — shared `WEBHOOK_SECRET` (`X-Webhook-Secret` or `Bearer`). On `ready`: updates `event_sde.{status,video_url,poster_url,duration_s,clip_count,rendered_at}` AND merges an `sde` block into `event_sites.config` via `jsonb_set` INSERT-on-conflict (preserves existing `is_published` + other site fields). On `error`: records `error_message`, leaves `event_sites` alone.
3. **Title/endcard via `drawtext`** ([sde.mjs:158-217](../lambda/sde.mjs#L158)) — chosen over PNG generation per Q&A. Pure FFmpeg (`color=` source + `drawtext` filter, text via `textfile=` so no escaping). Skips silently if the font file is missing — operator can ship a font later without breaking renders.

## 3 GB Lambda — current operating state

AWS new accounts cap per-function memory at **3008 MB** until you file a
Service Quota / Support case for the standard 10240 MB ceiling. The
SDE Lambda was sized for 10 GB / 6 vCPU but ships fine on 3 GB / 2 vCPU
with two env-controlled compromises. **Both go away when the quota
lands** — just remove the env vars and restore the polished defaults.

| Env var | Now (3 GB) | Restore (10 GB) | Why |
|---|---|---|---|
| `SDE_X264_PRESET` | `ultrafast` | unset → `veryfast` default | Was the difference between 14:57 timeout and ~5 min normalize |
| `SDE_KEN_BURNS` | `false` | unset → `true` default | Zoompan dominates photo encode; off saves ~30% |
| Lambda memory | `3008` | `10240` | Whole point of the quota raise |

### When the quota raise lands — also queued for then

- **Transitions (Batch 3)**: 0.3 s xfade between every clip. ~6-8 min single-pass re-encode of the stitched output — fits comfortably in 10 GB / 6 vCPU but blows the 15-min ceiling on 3 GB. Decision deferred 2026-05-18 explicitly.
- **Blur-fill in Ken Burns path**: currently the kenBurns:true branch in [normalizePhoto](../lambda/sde.mjs) still uses `pad=color=black` on the 2400×1350 upscale because zoompan reads that frame. When Ken Burns comes back on, apply BLUR_FILL_GRAPH to the upscale too.
- **Beat-sync + LUT**: original Batch 3 scope, still parked.

## Slice 2C — DONE (frontend render controls shipped)

`183865e` adds `#sde-render-bar` to the existing isolated SDE module
in [dashboard.html](../frontend/dashboard.html). State machine reads
straight from `GET /sde.status`:

| Status | Bar shows |
|---|---|
| `idle` | `[Generate reel]` (disabled if `approvedCount === 0`) + meta hint |
| `queued` / `rendering` | spinning pill + ~5–8 min hint; polls every 12 s |
| `ready` | `[▶ Watch reel]` + `[Regenerate]` + duration + "n min ago" |
| `error` | red `Last render failed` pill + `[Try again]` |

Polling lifecycle: starts when load() returns queued/rendering, stops
on terminal states OR on panel collapse. Refresh mid-render
auto-resumes because polling is decided from each payload, not from
the click. 409 `sde_in_flight` is treated as success (someone already
started it → just poll). All new JS identifiers stay inside the
isolated `<script type="module">` so the dashboard top-level-collision
footgun stays defused.

## Active task — Slice 2D (wall reveal + auto-render)

Two pieces:

1. **Wall reveal** — `events.sde_play_requested_at` / `sde_play_cleared_at` columns already exist (migration B0). Owner taps a new "Play on wall" button in the dashboard SDE panel (next to Watch reel) → backend stamps `sde_play_requested_at = NOW()`. The wall ([frontend/wall.html](../wall.html)) already polls on its tick (the now-showing beacon); compare it against its last-seen value and trigger a fullscreen video takeover with `event_sde.video_url`. "Stop" stamps `sde_play_cleared_at`.
2. **Auto-render at upload-window close** — when `events.ends_at` passes, a hook on the existing upload-window-close path calls the same generate logic with `event_sde.auto_rendered = true`. Host gets a finished reel without clicking anything.

After 2D: SDE feature is feature-complete pre-Batch-3 polish. The
quota-raise follow-ups (transitions, Ken Burns blur-fill on upscale,
beat-sync, LUT) all sit waiting for the 10 GB Lambda bump.

## Operator: pre-flight before first render

- [ ] Deploy [lambda/sde.mjs](../lambda/sde.mjs) as `reelday-sde-renderer` (memory 3008 MB, /tmp 4 GB, timeout 900 s, FFmpeg layer).
- [ ] Bundle a TTF/OTF at `/opt/fonts/Inter-Bold.ttf` (or set `SDE_FONT_PATH`). Without it, cards are skipped — render still works, but the reel opens/closes on a guest moment.
- [ ] Backend env: `SDE_LAMBDA_NAME=reelday-sde-renderer`. Optional: `SDE_DEFAULT_AUDIO_KEY=...` for the silent-event fallback.
- [ ] Lambda env: `WEBHOOK_URL=https://<host>/api/webhooks/sde-ready` (NOTE: `/api/` prefix), `WEBHOOK_SECRET` (shared with backend), plus the `R2_*` set used by the transcoder.

## Lambda deploy notes

Deploy [lambda/sde.mjs](../lambda/sde.mjs) as **separate function**
`reelday-sde-renderer`. Config in file header — memory 3008 MB, /tmp 4
GB, timeout 900 s, reuse the FFmpeg layer the transcoder uses
(`/opt/bin/ffmpeg`). Env: `R2_*` (same as transcoder), `WEBHOOK_URL =
https://<host>/api/webhooks/sde-ready` (the `/api/` prefix matters —
this is where `webhookRoutes` mounts), `WEBHOOK_SECRET` (shared),
`SDE_FONT_PATH` (defaults to `/opt/fonts/Inter-Bold.ttf` — ship a TTF
in the layer or zip, else cards are silently skipped). Backend env
needs `SDE_LAMBDA_NAME=reelday-sde-renderer`.

Payload contract (current — drawtext path):
```jsonc
{
  "eventId": "...", "slug": "...",
  "clips": [{ "key": "uploads/<slug>/x.jpg", "type": "photo", "dur": 3 }, ...],
  "audioKey":    "music/.../foo.mp3" | null,

  // Text path (preferred — drawtext on black). Skipped if SDE_FONT_PATH
  // file is missing. Either of title/subtitle alone is valid.
  "title":       "Maria & Juan"               | null,
  "subtitle":    "May 18, 2026 · Tagaytay"    | null,
  "endcardText": "Thank you for celebrating." | null,

  // Legacy PNG path (kept for compatibility; backend never sets these
  // today — text path wins if both are provided).
  "titleCardKey": "sde/<eventId>/title.png" | null,
  "endcardKey":   "sde/<eventId>/end.png"   | null,

  "outKey":       "sde/<eventId>/sde-<ts>.mp4"
}
```

## Standing rules (do NOT violate)

- **Commit AND push after every change, unprompted.** User standing rule. `Co-Authored-By: Claude ...` trailer.
- **`dashboard.html` footgun:** duplicate top-level `const`/`function` inside a `<script type="module">` silently blanks the page. **Grep before declaring.** SDE panel is the **3rd / isolated** module at end of body — keep new SDE JS there.
- **Tier gating:** `resolvePlan(event.plan || event.subscription_tier || 'tala')`; `sde` true for `dalisay`+`hiraya`.
- **Perf process:** check baselines in `perf-test-database.md` before any stress test; append numbered entry after. `local`=Easypanel terminal, `remote`=PH laptop (+600-1000 ms).

## Key files (quick map)

- [docs/same-day-edit-plan.md](same-day-edit-plan.md) — spec, batch roadmap, locked decisions
- [backend/lib/sdeSelect.js](../backend/lib/sdeSelect.js) — Curator
- [backend/routes/sde.js](../backend/routes/sde.js) — owner GET/PATCH/POST (`/generate`)
- [backend/routes/webhooks.js](../backend/routes/webhooks.js) — `video-ready` + `sde-ready`
- [backend/lib/sdeRenderInvoke.js](../backend/lib/sdeRenderInvoke.js) — Lambda invoker (env `SDE_LAMBDA_NAME`)
- [backend/lib/awsLambdaService.js](../backend/lib/awsLambdaService.js) — the transcoder invoker (reference pattern)
- [backend/plugins/database.js:241-280](../backend/plugins/database.js) — migrations (idempotent at boot)
- [lambda/sde.mjs](../lambda/sde.mjs) — renderer (B2A, header has deploy config)
- [lambda/index.mjs](../lambda/index.mjs) — reference for env/idioms (the transcoder)
- [frontend/dashboard.html](../frontend/dashboard.html) — main module ~L2200; isolated SDE module ~L5723; Feature pin button in `renderGallery` ~L3110; `handleFeatureToggle` ~L3214
- [frontend/wall.html](../wall.html) — beacon already shipped (`&showing=<id>`)

## Memory + portability

Auto-memory at `~/.claude/.../memory/` holds project files but won't
cross machines. **This file + the two `docs/` files are the portable
source of truth.** If you update the curation model, the Lambda
contract, or any locked decision, edit here first.
