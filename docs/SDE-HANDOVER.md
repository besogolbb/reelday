# SDE — Handover

Cold-start pointer for the **Same Day Edit** build. Working tree clean,
all on `main`. Spec: [same-day-edit-plan.md](same-day-edit-plan.md).
Perf log: [perf-test-database.md](perf-test-database.md). Last updated
**2026-05-23** — Remotion on ECS Fargate renderer shipped (see section
below). AWS infra setup IN PROGRESS — script ready, not yet run to
completion. Wall reveal plays via **iframe-isolated player**
(`/sde-play.html`), not an in-page `<video>` — see
[Wall takeover architecture](#wall-takeover-architecture) before
touching that path. Remaining polish waits on the 10 GB Lambda quota
raise — see operating-state table below).

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
| `1813efb` | 2D-1 | Backend: extract `kickOffRender` to [lib/sdeRender.js](../backend/lib/sdeRender.js); add `POST /sde/play` + `POST /sde/stop`; auto-render trigger on the reactions GET hot path + on host's GET `/sde` fallback (both deduped via in-memory `autoRenderFired` Set) |
| `498dd3a` | 2D-2 | Wall: `#sde-takeover` fullscreen overlay driven by `sde_play` block in the reactions poll response; loops the reel; "Tap for sound" hint if autoplay is blocked unmuted |
| `576f29b` | 2D-3 | Dashboard: `[📺 Play on wall]` / `[● Stop wall]` button in the render bar (ready state only); flips to live-red style with pulsing dot when active |
| `83ee7e8` | wall-fix | Frozen-at-first-frame on cold tabs: unmuted `play()` resolved but didn't actually play. Always start muted. |
| `b26a62a` | wall-fix | Pause gallery vidA/vidB + bg music + clear slideTimer during takeover (decoder/audio contention) |
| `f6111ff` | wall-fix | Remove auto-unmute — Chrome PAUSES the video if the unmute is rejected without a gesture ([goo.gl/xX8pDD](https://goo.gl/xX8pDD)). Hint-tap is the only safe sound path. |
| `ceb60a5` | wall-fix | Prebuffer wait (`canplaythrough` + fallbacks) + "Loading reel" spinner before play |
| `4ca705e` | wall-fix | FULLY release gallery videos (`pause` + `removeAttribute('src')` + `load()`) — paused-but-loaded still holds decoder/memory |
| `6b862bd` | wall-fix | First-poll swallow: refreshing the wall must NOT auto-resume a takeover from a still-active play signal |
| `70b9da7` | **wall arch** | **iframe-isolated player.** New [frontend/sde-play.html](../frontend/sde-play.html); wall mounts it in an `<iframe>` instead of an in-page `<video>`. The wall runtime (1Hz polls + gallery + music + emoji + DOM) was starving in-page playback; the iframe gets its own JS context / network pool / decoder slot. `handleSdePlay` slimmed to lifecycle-only. |
| `b3636d3` | polish | SDE cards: event cover photo as blurred-darkened title/endcard background (fallback: tinted navy) |
| `3da4a12` | polish | **Ken Burns rework** — two-stage: blur-fill composite (portrait keeps aspect, no black bars) at 5760×3240 supersample → smooth sub-pixel zoom to 1080p (kills the stair-step "ladder"). Replaces `pad=color=black`. +80 s total, still ~4× headroom on 3 GB. |
| `9029df2` | polish | **Warm-film colour grade** (`COLOR_GRADE`, stock curves+eq, no `.cube` asset) on every guest brick — flat photo + video via `BLUR_FILL_GRAPH`, photos via KB stage-2. Cards untouched. LUT pulled forward from Batch 3 on host go. |

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
- ~~Cards = pre-rendered PNG overlays~~ **SUPERSEDED 2026-05-18:** cards are `drawtext`-on-black, rendered in the Lambda (`705eafc`). The PNG `titleCardKey`/`endcardKey` payload fields still exist for compatibility but the backend never sets them. Decision reversed via the Q&A at 2B kickoff — no PNG generation anywhere.
- **Beat-sync + transitions = still Batch 3.** Slice 2A produces hard cuts; this is intentional. **LUT — SHIPPED 2026-05-19** (`9029df2`, warm-film grade, host pick): the capacity premise behind parking it was disproven by the measured ~4× headroom; pulled forward on explicit host go. Don't revert as a "locked violation" — it's a host-approved decision now.
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

- **Transitions (Batch 3)**: 0.3 s xfade between every clip. Originally estimated ~6-8 min single-pass re-encode "blows the 15-min ceiling on 3 GB" — but the 2026-05-19 measured run (220 s of 900 s, **with** the heavier two-stage Ken Burns) shows that premise no longer holds; xfade almost certainly fits on 3 GB now. Still parked only because it kills the `-c copy` concat fast path (full timeline re-encode + cumulative offsets + music crossfade) — a real architectural change, not a capacity blocker. Awaiting explicit host go.
- ~~Blur-fill in Ken Burns path~~ **SHIPPED 2026-05-19** (`3da4a12`): the kenBurns branch was reworked to a two-stage pipeline — stage 1 builds a blur-fill composite (portrait keeps aspect, no black bars) at a 5760×3240 supersample canvas, stage 2 runs the slow zoompan straight to 1080p so integer crop steps are sub-pixel (kills the stair-step "ladder"). `pad=color=black` is gone. Cost: normalize 114 s → 193 s, total 140 s → 220 s — still ~4× headroom on 3 GB.
- **Beat-sync**: original Batch 3 scope, still parked (needs beat detection; "no new npm deps" applies). **LUT shipped** — see locked-decisions note above (`9029df2`).

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

## Slice 2D — DONE (wall reveal + auto-render shipped)

`1813efb` / `498dd3a` / `576f29b` close out the SDE 2-series.

**Wall reveal** is end-to-end host-controlled:

1. Host clicks `[📺 Play on wall]` in dashboard → `POST /sde/play`
   stamps `events.sde_play_requested_at = NOW()` and clears
   `sde_play_cleared_at`.
2. Wall's existing 1Hz reactions poll picks up the `sde_play` block
   in the response within ~1 s.
3. Wall **mounts an `<iframe src="/sde-play.html?src=…&poster=…">`**
   into the `#sde-takeover` overlay (z-index 200). The iframe page
   plays the reel; the wall just owns mount/unmount.
4. Host clicks `[● Stop wall]` → `POST /sde/stop` stamps
   `sde_play_cleared_at`; wall sets `frame.src = 'about:blank'` (full
   teardown) and resumes the gallery on its next poll.

## Wall takeover architecture

**Why an iframe.** In-page `<video>` playback stuttered badly on the
wall even though the *same URL played perfectly in a standalone tab*.
Root cause: the wall runtime is heavy — 1Hz reactions poll, uploads/
burst/polls polling, music subsystem, emoji animations, and a huge
DOM all competing for the main thread, network connection pool, and
(on weaker devices) the 1–2 hardware video decoders. Freeing
individual culprits helped but never fully fixed it. The iframe
(`70b9da7`) gives the player its own everything — same isolation as
the standalone tab that worked.

**Files:**
- [frontend/sde-play.html](../frontend/sde-play.html) — ~90-line
  standalone player. Reads `?src=` + `?poster=`. Muted autoplay +
  loop + `canplaythrough` prebuffer + "Tap for sound". **No polling**
  — the parent wall owns lifecycle. Served by `@fastify/static`
  (root=`frontend`, prefix=`/`) — no backend route needed.
- [frontend/wall.html](../wall.html) `handleSdePlay` — lifecycle only:
  mount iframe on a NEW `requested_at`, `about:blank` on stop/null.
  Still releases gallery media + hides emoji on entry (gives the
  iframe a clean decoder slot), restores on exit.

**Hard-won constraints (do NOT regress):**
- **Never call `video.muted = false` from code.** Chrome *pauses*
  the element if the unmute is rejected without a user gesture
  ([goo.gl/xX8pDD](https://goo.gl/xX8pDD)). Sound is opt-in via the
  in-iframe "Tap for sound" hint — a tap there is activation for the
  iframe's own context. For event-day, host taps it once on the TV.
- **Always start muted.** Muted autoplay is universally permitted;
  unmuted is not, and a silently-blocked unmuted `play()` resolves
  its promise while the video stays frozen at frame 0.
- **First-poll swallow.** On the wall's first reactions poll after
  load, an already-active `sde_play` is remembered but NOT entered —
  refreshing the wall (or a stale forgotten-Stop signal) must not
  surprise-play. Only a *new* `requested_at` triggers takeover.
- **Known cosmetic mismatch:** after a wall refresh that swallowed an
  active signal, the dashboard still shows `[● Stop wall]` (server
  `playing` is true). Host clicks Stop → state clears → next Play
  works normally. Fixing properly needs a wall→server "I refreshed"
  signal — deliberately out of scope.

**If it still stutters fully isolated** → it's genuine network
bandwidth on the ~150–300 MB ultrafast-preset mp4. The real fix is
lowering the encoder bitrate (a `SDE_X264_CRF` knob, default ~26
instead of the hard-coded 22) at render time — drafted then reverted
2026-05-18 when the standalone-tab test proved the file itself was
fine. Revisit only if iframe isolation doesn't resolve it.

**Auto-render** fires once per event when `upload_window_ends_at`
passes, via TWO trigger paths so events with or without a live wall
both get covered:

- **reactions GET hot path** (one extra JOIN'd query per poll on
  SDE-enabled events) — catches close within seconds during active
  events.
- **host's GET `/sde` fallback** — catches close even for events
  whose walls have all closed by then (small venues, async hosts).

Both deduped via in-process `autoRenderFired` Set (one entry per slug
per process — bounded, terminal failures keep the slug muted,
transient ones retry on next poll). `event_sde.auto_rendered = true`
distinguishes auto from manual in analytics.

## Renderer — Remotion on ECS Fargate (replaces FFmpeg Lambda)

`lambda/sde.mjs` has been **deleted**. The renderer is now the `sde-renderer/`
directory — a Remotion TypeScript project that runs as an ECS Fargate task.

### Architecture change summary

| Before | After |
|---|---|
| `lambda/sde.mjs` — FFmpeg filter graphs | `sde-renderer/` — Remotion React compositions |
| AWS Lambda (3 GB, 15 min timeout) | ECS Fargate (8 vCPU / 16 GB, ~3 min render) |
| `@aws-sdk/client-lambda` InvokeCommand | `@aws-sdk/client-ecs` RunTaskCommand |
| Payload in Lambda JSON body | Payload staged to R2, key passed via env var |
| Hard cuts only | Crossfade / dip-to-black / zoom-push transitions |
| FFmpeg drawtext cards | React components (Cormorant Garamond serif) |
| ~$0.10/render (3 GB Lambda) | ~$0.023/render (Fargate + TTS) |

### Animations shipped

- Ken Burns (CSS, smooth sub-pixel) + blur-fill parallax background
- Horizontal pan for landscape/group photos
- Micro-zoom on video clips; slow motion on pinned clips
- Cycling transitions: crossfade → dip-to-black → zoom-push
- Flash cut sequence at emotional peak (6–8 photos, 3 frames each)
- Film grain (audio-reactive via feTurbulence)
- Vignette (audio-reactive radial gradient)
- Cinematic letterbox bars (animate in/out)
- Photo flash on clip entry (white opacity spike)
- Warm-film color grade (CSS filter)
- Film leader opener (3→2→1 countdown)
- Opening title card (bokeh bg, serif stagger, animated divider)
- Chapter markers (Preparation / Ceremony / Cocktail Hour / Reception)
- Hero moment (highest-reacted clip: 8s, freeze frame, warm glow border)
- Collage at chapter transitions (2–4 photo grid → collapses to hero)
- End card (animated counters, QR code, bokeh)
- Reelday slate with iris close
- AI voice over (OpenAI TTS, nova voice) — over title + first chapter
- Guest ambient audio mix (top-3 reacted videos at -18dB)
- Music ducking under voice over

### Key files

- [sde-renderer/render.mjs](../sde-renderer/render.mjs) — Fargate entry point
- [sde-renderer/src/SdeComposition.tsx](../sde-renderer/src/SdeComposition.tsx) — main composition
- [sde-renderer/src/types.ts](../sde-renderer/src/types.ts) — InputProps + constants
- [sde-renderer/Dockerfile](../sde-renderer/Dockerfile) — Node 20 bookworm + Chrome + ffmpeg
- [backend/lib/sdeRenderInvoke.js](../backend/lib/sdeRenderInvoke.js) — ECS RunTask invoker

### New backend env vars required

```
SDE_ECS_CLUSTER=reelday-cluster
SDE_TASK_DEF=reelday-sde-renderer
SDE_ECS_SUBNETS=subnet-xxx,subnet-yyy
SDE_ECS_SECURITY_GROUP=sg-xxx
OPENAI_API_KEY=sk-...            # for TTS voice over (optional — skipped if absent)
```

### AWS setup — CURRENT STATE (2026-05-23, IN PROGRESS)

One-shot script at [sde-renderer/setup-ecs.sh](../sde-renderer/setup-ecs.sh).
Run from the VPS host (not the Easypanel container):

```bash
# On the host (ssh root@srv1603244)
cd /tmp/sde-setup                          # repo cloned here already
eval $(docker inspect a37ab46a817b \       # app container ID — re-check with: docker ps | grep reelday
  --format='{{range .Config.Env}}export {{println .}}{{end}}')
bash sde-renderer/setup-ecs.sh
```

Script prints the 4 backend env vars at the end — paste into Easypanel,
restart backend, trigger a test render. **Script has not been run yet.**

### AWS setup checklist (from scratch, ap-southeast-1)

1. Create ECR repo `reelday-sde-renderer`, push Docker image
2. Create ECS cluster `reelday-cluster` (Fargate)
3. Create task definition `reelday-sde-renderer` (CPU 8192, Mem 16384, image from ECR)
4. IAM task execution role: `AmazonECSTaskExecutionRolePolicy`
5. Set env vars in task def: R2_*, WEBHOOK_URL, WEBHOOK_SECRET, OPENAI_API_KEY
6. Set backend env vars above

### Parked (not yet implemented)

- Beat sync — parked until music source is decided
- Reactions overlay — later slice

## Active task — none queued (Remotion Fargate renderer shipped)

The SDE feature is host-usable end-to-end on the current 3 GB Lambda:
host curates via Feature pins, render fires on upload-window close,
host plays on wall when ready. Remaining roadmap depends on the AWS
10 GB quota raise (see [3 GB Lambda — current operating state](#3-gb-lambda--current-operating-state)
above):

- Transitions (xfade) — single-pass re-encode; measured to fit on 3 GB
  now (220/900 s), parked only on the `-c copy` architectural cost +
  awaiting host go (not capacity)
- ~~Ken Burns blur-fill~~ — **SHIPPED `3da4a12`** (two-stage, smooth)
- ~~LUT~~ — **SHIPPED `9029df2`** (warm-film grade)
- Beat-sync — still parked (beat detection; no new npm deps)

Visual polish (Ken Burns smoothing + blur-fill + warm-film grade) is
done on the live 3 GB Lambda — the old "wait for the 10 GB quota"
framing for those is obsolete. Only xfade transitions + beat-sync
remain, and xfade is now a host-decision/architecture call, not a
capacity one. **All three new commits require a Lambda redeploy** —
git push does not update AWS.

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
- [backend/routes/sde.js](../backend/routes/sde.js) — owner GET/PATCH/POST (`/generate`, `/play`, `/stop`); GET returns `playing`; dashboard auto-render fallback
- [backend/routes/webhooks.js](../backend/routes/webhooks.js) — `video-ready` + `sde-ready`
- [backend/lib/sdeRender.js](../backend/lib/sdeRender.js) — **`kickOffRender` orchestrator** (curator→music→invoke→upsert) + `SdeRenderError`; shared by `/generate` route AND the reactions-poll auto-trigger
- [backend/lib/sdeRenderInvoke.js](../backend/lib/sdeRenderInvoke.js) — Lambda invoker (env `SDE_LAMBDA_NAME`)
- [backend/routes/reactions.js](../backend/routes/reactions.js) — wall poll; carries `sde_play` block + fires the auto-render trigger (`autoRenderFired` Set)
- [backend/plugins/database.js:241-280](../backend/plugins/database.js) — migrations (idempotent at boot)
- [lambda/sde.mjs](../lambda/sde.mjs) — renderer (B2A, header has deploy config + env knobs)
- [lambda/index.mjs](../lambda/index.mjs) — reference for env/idioms (the transcoder)
- [frontend/dashboard.html](../frontend/dashboard.html) — isolated SDE module ~L5723; render bar (`#sde-render-bar`) state machine; Play/Stop wall buttons
- [frontend/sde-play.html](../frontend/sde-play.html) — **isolated wall player** loaded in the takeover iframe
- [frontend/wall.html](../wall.html) — `handleSdePlay` (takeover lifecycle, iframe mount/unmount); beacon (`&showing=<id>`)

## Memory + portability

Auto-memory at `~/.claude/.../memory/` holds project files but won't
cross machines. **This file + the two `docs/` files are the portable
source of truth.** If you update the curation model, the Lambda
contract, or any locked decision, edit here first.
