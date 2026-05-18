# SDE — Handover

Cold-start pointer for the **Same Day Edit** build. Working tree clean,
all on `main`. Spec: [same-day-edit-plan.md](same-day-edit-plan.md).
Perf log: [perf-test-database.md](perf-test-database.md). Last updated
**2026-05-18**.

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

## Active task — Slice 2B (backend plumbing)

Three pieces, all in [backend/routes/sde.js](../backend/routes/sde.js)
+ [backend/routes/webhooks.js](../backend/routes/webhooks.js) + new
helper:

1. **`POST /api/events/:slug/sde/generate`** — owner, `sde`-gated, debounced (reject if `status IN ('queued','rendering')`). Runs Curator → picks music (chain: event's `music_tracks` → curated playlist lead → baked R2 default → null) → pre-renders title/endcard PNGs → uploads to R2 → builds payload → async-invokes Lambda via [backend/lib/awsLambdaService.js](../backend/lib/awsLambdaService.js) pattern (new `triggerSdeRender()` fn, env `SDE_LAMBDA_NAME`) → `event_sde.status='queued'`.
2. **`POST /webhooks/sde-ready`** — shared `WEBHOOK_SECRET` (`X-Webhook-Secret` header, see [webhooks.js:29](../backend/routes/webhooks.js#L29)). Body `{status, eventId, videoKey, posterKey, durationS, clipCount, message?}`. Updates `event_sde.{status,video_url,poster_url,duration_s,clip_count,rendered_at,error_message}` and writes `event_sites.config.sde` block.
3. **Title/endcard PNG generation** — decision pending: pure-Node SVG-to-PNG (no dep allowed) vs. a tiny Cloudflare Worker vs. canvas-via-FFmpeg drawtext fallback. **Ask the user before coding this.**

After 2B: **Slice 2C** = Generate button + status pill + Download in the
isolated SDE module in `dashboard.html`. **Slice 2D** = wall reveal
(`sde_play_*`) + auto-render at upload-window close.

## Lambda deploy notes (for 2A)

Deploy [lambda/sde.mjs](../lambda/sde.mjs) as **separate function**
`reelday-sde-renderer`. Config in file header — memory 3008 MB, /tmp 4
GB, timeout 900 s, reuse the FFmpeg layer the transcoder uses
(`/opt/bin/ffmpeg`). Env: `R2_*` (same as transcoder), `WEBHOOK_URL →
https://<host>/webhooks/sde-ready`, `WEBHOOK_SECRET` (shared). Backend
2B will need `SDE_LAMBDA_NAME=reelday-sde-renderer`.

Payload contract (frozen):
```jsonc
{
  "eventId": "...", "slug": "...",
  "clips": [{ "key": "uploads/<slug>/x.jpg", "type": "photo", "dur": 3 }, ...],
  "audioKey": "music/.../foo.mp3" | null,
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
- [backend/routes/sde.js](../backend/routes/sde.js) — owner GET/PATCH (Generate route lands here in 2B)
- [backend/routes/webhooks.js](../backend/routes/webhooks.js) — mirror `video-ready` pattern for `sde-ready`
- [backend/lib/awsLambdaService.js](../backend/lib/awsLambdaService.js) — invoke pattern to mirror
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
