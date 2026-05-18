# SDE — Handover

Cold-start pointer for the **Same Day Edit** build. Working tree clean,
all on `main`. Spec: [same-day-edit-plan.md](same-day-edit-plan.md).
Perf log: [perf-test-database.md](perf-test-database.md). Last updated
**2026-05-18** (Slice 2B backend shipped).

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

## Active task — Slice 2C (frontend)

Generate button + status pill + Download in the isolated SDE module in
[dashboard.html](../frontend/dashboard.html) (~L5723). Wire `POST
/api/events/<slug>/sde/generate`; poll `GET /api/events/<slug>/sde` for
status transitions `idle → queued → rendering → ready` (the webhook
flips queued → ready/error directly; `rendering` is reserved for a
future Lambda-side ping). On `ready`, render the video URL + a Download
link to `video_url`. On `error`, surface `error_message`.

After 2C: **Slice 2D** = wall reveal (`sde_play_*`) + auto-render at
upload-window close.

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
