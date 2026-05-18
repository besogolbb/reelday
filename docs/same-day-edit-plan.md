# Same Day Edit (SDE) — Engineering Plan

Transform a static pile of guest uploads into a cinematic, share-ready
recap reel, rendered automatically. Gated to **Dalisay & Hiraya** via a
new `plans.js` `sde` feature flag (same Dalisay+ pattern as `website` /
`polls` / `audioNotes`). This is the headline justification for the
₱2,990 Dalisay price point: it replaces a manual video-editing service
with a ~3-minute automated "Digital SDE".

Strategy: the wall entertains *during* the event; the SDE is the
keepsake the couple actually posts and shares *after*.

**Feasibility:** ~70% of the infra already exists — FFmpeg-on-Lambda
harness ([lambda/index.mjs](lambda/index.mjs),
[awsLambdaService.js](backend/lib/awsLambdaService.js)), R2 read/write,
the `reactions` table keyed by `upload_id`, a curated/custom music
library ([music.js](backend/routes/music.js)), the fullscreen-takeover
CSS on the wall ([wall.html:1064](frontend/wall.html#L1064)), the
`event_sites.config` JSONB hub, and the webhook callback pattern
([webhooks.js](backend/routes/webhooks.js)). The only genuinely new
heavy build is the stitch Lambda and the dashboard→wall command channel.

## Locked decisions (confirmed 2026-05-18)

1. **Output: landscape 1920×1080 only.** Cinematic 16:9, looks right on
   the venue TV; phone download is a normal landscape mp4. No vertical /
   Reels cut in v1 (parked).
2. **Curator: reaction-ranked + host pin/exclude.** Rank by weighted
   reaction score; host can force-include (pin) or drop (exclude)
   specific uploads from the dashboard before generating. Fallback:
   top-up with most-recent approved uploads so a low-engagement event
   still gets a full reel.
3. **Trigger: manual button + auto at upload-window close.** Host can
   "Generate SDE" anytime (re-rendable); one auto-render also fires once
   when `upload_window_ends_at` passes so there's always a final cut.
4. **Compute: new dedicated Lambda**, direct async-invoke (NOT the
   per-upload SQS FIFO), reports back via the existing webhook pattern.
5. **Reactions are counted at request-time, never during the live
   event** (see §3). Recording reactions is unchanged; only the *tally*
   moves off the hot path. Reaction score is a soft re-rank, not a hard
   dependency.

---

## 1. Architecture

- **Gating:** new `sde` flag in [backend/lib/plans.js](backend/lib/plans.js)
  + mirror in `frontend/js/plans.js`. `true` for `dalisay` + `hiraya`
  only. Reads effective tier the locked way:
  `resolvePlan(event.plan || event.subscription_tier || 'tala')`.
  Tala/Sinag dashboard shows a locked upsell card (mirror how
  `website`/`polls` render locked).
- **Render compute:** new Lambda `reelday-sde-renderer` (separate
  function, separate file `lambda/sde.mjs`). Direct
  `InvocationType:'Event'` invoke via an `awsLambdaService`-style client
  — **not** the SQS FIFO transcoder (that's a per-upload stream; this is
  a one-shot batch job). Config: memory ~3008 MB, ephemeral `/tmp`
  bumped to 4–10 GB, timeout 600–900 s. Reports completion to a new
  `POST /webhooks/sde-ready` reusing `WEBHOOK_SECRET`.
- **Selection (Curator):** new pure module `backend/lib/sdeSelect.js`,
  owner-only, server-side, request-time only (see §3).
- **Reveal channel:** the wall already polls (~1 s). Fold an `sde` block
  into an existing poll response rather than adding a new per-tick
  request (verify which existing endpoint the wall polls and piggyback —
  do **not** add a request to the hot path; the perf log notes wall GETs
  are pool-drain sensitive).
- **No new npm deps** (documented Easypanel build footgun → 502). All
  client code is vanilla ES modules reusing `frontend/css/shared.css`.

## 2. Data model

Added to the `MIGRATIONS` block in
[backend/plugins/database.js](backend/plugins/database.js) (idempotent,
runs at boot) and mirrored into `database/schema.sql` for parity.

```sql
CREATE TABLE IF NOT EXISTS event_sde (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  status               VARCHAR(20) NOT NULL DEFAULT 'idle', -- idle|queued|rendering|ready|error
  video_url            TEXT,
  poster_url           TEXT,
  duration_s           INTEGER,
  clip_count           INTEGER,
  track_id             UUID REFERENCES music_tracks(id),
  config               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- render-param snapshot (weights, order, endcard text)
  error_message        TEXT,
  auto_rendered        BOOLEAN NOT NULL DEFAULT false,      -- guards the one-shot auto render at window close
  requested_by_user_id UUID REFERENCES users(id),
  rendered_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Host curation, on the existing uploads table (matches the table's
-- existing ALTER ADD COLUMN migration style).
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS sde_pinned   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS sde_excluded BOOLEAN NOT NULL DEFAULT false;

-- Wall reveal command. Host "Play on wall" sets sde_play_requested_at=NOW();
-- the wall compares it to its last-seen value on its existing poll tick.
ALTER TABLE events ADD COLUMN IF NOT EXISTS sde_play_requested_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sde_play_cleared_at   TIMESTAMPTZ;
```

The final SDE URL is also written into `event_sites.config.sde`
(`{ video_url, poster_url, duration_s, rendered_at }`) so the website
hub renders it with zero extra joins — consistent with how the event
site already reads everything from that one JSONB blob.

## 3. The Curator — `backend/lib/sdeSelect.js` (reactions, the safe way)

**The core safety rule: recording a reaction stays exactly as it is
today; only the *counting* changes.** Two distinct operations:

| Operation | When | Cost | Changed? |
|---|---|---|---|
| **Record** a reaction (`INSERT` into `reactions`) | live, every tap, during the event | tiny, append-only | **No change.** Existing wall path, untouched. Adds zero new load. |
| **Tally** reactions (`GROUP BY upload_id`, the heavy aggregate) | only when SDE is requested (button click, or auto at window close) | one heavier query | **New, but off the hot path.** Never runs during the live reaction storm. |

Why this removes the outage risk: `reactions.js` already carries scars
from live aggregation draining the pool and freezing other events' wall
GETs. By the time the tally runs, either (a) the host explicitly clicked
Generate — a rare, owner-authed, debounced action — or (b) uploads have
closed and wall traffic is, by definition, zero.

Hardening on the tally query:
- Wrap in `SET LOCAL statement_timeout = '8s'` so a pathological event
  can never hang a pooled connection.
- **Debounce: one in-flight render per event.** `POST .../generate`
  rejects if `event_sde.status IN ('queued','rendering')`. So the heavy
  query can fire at most once per render, not per click.
- Owner-auth + rate-limited (`limiterKey`) — never reachable by guests,
  never on a poll.
- It is a single query, not N — the aggregate is computed once into the
  selection set, not re-run per clip.

The tally query (runs once, at request-time, owner-only):

```sql
SELECT u.id, u.file_type, u.file_url, u.web_url, u.compressed_key,
       u.original_key, u.poster_url, u.created_at,
       u.sde_pinned, u.sde_excluded,
       COALESCE(r.score, 0) AS score
  FROM uploads u
  LEFT JOIN (
    SELECT upload_id,
           SUM(CASE
                 WHEN emoji IN ('❤️','🔥','💖','🥰') THEN 3
                 WHEN emoji IN ('😂','👏','🎉','✨','🥹') THEN 2
                 ELSE 1
               END) AS score
      FROM reactions
     WHERE event_id = $1 AND upload_id IS NOT NULL
     GROUP BY upload_id
  ) r ON r.upload_id = u.id
 WHERE u.event_id = $1
   AND u.is_approved = true
   AND u.sde_excluded = false
```

Selection algorithm (in JS, deterministic):
1. **Always include** `sde_pinned` rows (host's hard picks — the spine).
2. Fill remaining slots from the rest by `score DESC, created_at DESC`.
3. **Fallback (soft signal):** if selected count < `MIN_CLIPS` (≈12),
   top up with the most-recent non-excluded uploads. So if reactions are
   sparse, noisy, or the tally is skipped entirely, the reel is still
   built from host picks + chronology. Reactions only ever *re-order
   within* the host's structure — they can never break the SDE.
4. Cap at `MAX_CLIPS` (≈25) and a `MAX_TOTAL_S` budget
   (photo = 3 s, video ≈ 5 s).
5. **Final reel order = chronological by `created_at`** of the selected
   set (ceremony → reception narrative). Order is a `config` knob so we
   can A/B "best-first" later.

Always yields a reel if ≥1 approved upload exists.

## 4. Pre-process + Stitch — `lambda/sde.mjs`

One Lambda invocation does everything (no separate per-brick jobs —
keeps it a single billable run). Payload:

```jsonc
{
  "eventId": "...", "slug": "...",
  "clips": [{ "key": "uploads/<slug>/123.jpg", "type": "photo", "dur": 3 },
            { "key": "uploads/<slug>/124_web.mp4", "type": "video", "dur": 5 }],
  "audioKey": "music/party/foo.mp3",
  "endcard": { "title": "Maria & Jose", "subtitle": "reelday.ph" },
  "outKey": "sde/<eventId>/sde-<ts>.mp4"
}
```

Per-clip normalization (every brick comes out byte-compatible so concat
is clean): 1920×1080, `yuv420p`, 24 fps, `setsar=1`, silent track.
- **Photo → 3 s Ken Burns:** `zoompan=z='min(zoom+0.0015,1.15)':d=72:s=1920x1080`,
  then `scale`/`pad` to fill 1920×1080.
- **Video → 5 s:** `scale`/`pad` to 1920×1080, drop guest audio in the
  basic render (music bed only; ducking parked).
- **Endcard:** ~2.5 s brand card (event name + "ReelDay") via `drawtext`
  or a pre-rendered PNG overlaid on brand bg.

Compose: concat all bricks → silent master; take `audioKey`, trim/loop
to total duration, `afade` in/out, `-shortest`. Output H.264 1920×1080
`+faststart` + AAC. Upload `outKey` + a poster to R2. Then
`POST /webhooks/sde-ready` (shared secret like the existing video-ready
webhook) → backend updates `event_sde` and writes `event_sites.config.sde`.

The cinematic polish (blurred-fill, beat-sync, transitions, LUT, pacing,
best-5s, loudnorm) layers onto this same module in Batch 3 — see §8.

## 5. Backend routes — `backend/routes/sde.js`

- `GET   /api/events/:slug/sde` (owner) — status + video_url + the
  curated preview list with per-clip score / pinned / excluded.
- `PATCH /api/events/:slug/sde/clips` (owner) — set pinned/excluded.
- `POST  /api/events/:slug/sde/generate` (owner, `sde`-gated) — run
  Curator (the request-time tally, §3), build payload, invoke Lambda,
  set `status='queued'`. Debounced: reject if a render is already in
  flight for this event.
- `POST  /api/events/:slug/sde/play` (owner) — set
  `sde_play_requested_at = NOW()`.
- `POST  /api/events/:slug/sde/stop` (owner) — set `sde_play_cleared_at`.
- `POST  /webhooks/sde-ready` (shared secret) — finalize the row + write
  the website hub block.
- Wall reveal state: piggyback `{ sde: { play, video_url, since } }`
  onto the wall's existing poll response (resolve which endpoint during
  build — likely the wall/reactions tick).
- Auto-render: lazy check (no cron in this codebase — verify) — when an
  owner/dashboard request observes `now > upload_window_ends_at` and
  `event_sde.auto_rendered = false`, fire one generate and set the flag.

## 6. Frontend

- **Dashboard** ([dashboard.html](frontend/dashboard.html)): "Same Day
  Edit" card — Generate button, status/progress, thumbnail grid of the
  curated selection with pin/exclude toggles, "Play on wall" / "Stop",
  copy-link + download for the finished mp4. Tala/Sinag → locked upsell.
  ⚠️ Standing rule: **grep before declaring any new const/function in
  `dashboard.html`** — a duplicate in a `type=module` script silently
  blanks the whole page.
- **Wall** ([wall.html](frontend/wall.html)): on poll, if `sde.play` and
  a `video_url`, enter the existing fullscreen takeover
  ([wall.html:1064](frontend/wall.html#L1064)), play the mp4 **with
  audio**, on `ended` or `stop` resume the slideshow.
- **Event site** (`event-site.html` + its JSON hydrate): if
  `config.sde.video_url`, pin a "Watch the recap" player to the top with
  a "Download to phone" button. Already Dalisay/Hiraya-gated by the
  `website` feature — lines up with the `sde` gate.

## 7. Music & licensing

Reuse the event's existing music: default the SDE track to the event's
selected curated playlist's lead track (or first custom upload); a small
SDE picker maps Romantic/Upbeat/Corporate → ceremony/party/dinner moods.
Pixabay library tracks are free for any use incl. redistribution in the
downloadable mp4; custom host uploads already carry the "host confirmed
rights" attestation in `music_tracks.license_info`.

---

## 8. Build batches

Each batch is independently shippable and leaves the product working.

### Batch 0 — Foundations
- `sde` flag in `backend/lib/plans.js` + mirror `frontend/js/plans.js`.
- Migration: `event_sde` table, `uploads.sde_pinned/sde_excluded`,
  `events.sde_play_requested_at/cleared_at`; mirror into `schema.sql`.
- **Done = ** schema in place, gate resolves Dalisay/Hiraya only.

### Batch 1 — The Curator (selection only, no video yet)
- `backend/lib/sdeSelect.js` with the request-time tally, the
  `statement_timeout` guard, the debounce check, and the soft-signal
  fallback (§3).
- `GET` + `PATCH .../sde` routes.
- Dashboard preview grid with pin/exclude toggles.
- **Done = ** host can see exactly which clips the SDE *would* use and
  curate them. Zero render cost. Validates selection in isolation, and
  proves the reactions tally is safe before any FFmpeg work.

### Batch 2 — Basic render (the SDE exists)
- `lambda/sde.mjs`: normalize bricks → concat → music bed → endcard →
  opening title card (event name + date + venue from the `events` row).
- Deploy `reelday-sde-renderer`; `POST .../generate`; `sde-ready`
  webhook; status UI on the dashboard card; download button.
- **Done = ** a real, downloadable 1920×1080 mp4 end-to-end. Looks like
  a clean slideshow with music — pipeline proven, not yet "cinematic".

### Batch 3 — Cinematic polish (pure FFmpeg, no AI)
Layered onto `lambda/sde.mjs`. This is what makes it look
professionally edited:
1. **Blurred-fill background** for portrait clips instead of black bars
   (reuse the wall's existing blurred-source recipe). *Highest visual
   gain per effort.*
2. **Beat-synced cuts** — annotate BPM / beat-grid into the existing
   `music-library/*/manifest.json` files **once** (no runtime lib, no
   new dep); the render aligns clip changes to the beat.
3. **Smooth transitions** — `xfade` crossfades / light zooms between
   bricks instead of hard cuts.
4. **Single cinematic color LUT** over every clip so mismatched phone
   cameras unify into one graded look.
5. **Pacing curve** off the beat grid — longer holds at the open,
   quicker cuts at the music peak, slow the closer.
6. **Best 5 s of a video by audio energy** — pick the loudest
   (cheer/applause) window instead of the first 5 s. Heuristic, no AI.
7. **`loudnorm` on the music bed** — every event's SDE lands at the
   same comfortable phone-speaker volume.
- **Done = ** the deliverable clears the "who edited this?" bar that
  justifies ₱2,990.

### Batch 4 — Delivery surfaces
- Website hub pin (`event_sites.config.sde` → "Watch the recap" +
  "Download to phone").
- Wall reveal: the `sde_play_*` command columns + reuse the fullscreen
  takeover. Host "Play on wall" / "Stop" from the dashboard.
- **Done = ** the "reveal at the reception" moment + the shareable hub.

### Batch 5 — Auto-generate at upload-window close
- Lazy check fires one render when `upload_window_ends_at` passes,
  guarded by `event_sde.auto_rendered`.
- **Done = ** every Dalisay+ event ends with a final SDE even if the
  host never clicks the button.

### Batch 6 — AI pass (premium; optional, after v1 proves out)
Runs **only on the already-curated top ~25** (never every upload — cost
and latency would explode):
- **Dedup + best-frame:** drop near-identical burst shots and blurry
  ones; pick the sharpest / most-smiling frame.
- **AI title + caption cards:** event name, a tasteful one-line opener,
  guest-name lower-thirds — text-gen via native `fetch` to Haiku
  (rate-limited, prompt-cached, no SDK dep — same pattern as the parked
  AI concierge).
- **Done = ** marketable as a genuine "AI Same Day Edit". This is the
  upsell headline, but it carries the real cost / latency / failure
  modes, so it ships *after* Batches 0–5 are solid.

## 9. Out of scope (parked)

Vertical/Reels 9:16 cut · full vision-model-on-every-upload ·
narrative-arc / scene-mood modeling · voice/speech detection ·
guest-audio ducking under the bed · Hiraya white-label endcard ·
multi-track soundtrack · re-render diffing (each generate is a full
re-render).

## 10. Risk notes

- **Reactions ≠ outage** *if* the tally is request-time only: see §3.
  Recording stays append-only and unchanged; the heavy `GROUP BY`
  runs once per render, owner-triggered, `statement_timeout`-guarded,
  debounced, never on a poll, never during the live storm. Reaction
  score is a soft re-rank, not a hard dependency.
- **Lambda ceiling:** ≤25 clips concat is a single long job — dedicated
  function with bumped `/tmp` + memory + timeout, isolated from the live
  per-upload transcoder. ~1–3 min render keeps the "5-minute SDE"
  promise.
- **Hot-path discipline:** the wall reveal-state read must ride an
  existing poll, not add one. Append a row to
  `docs/perf-test-database.md` if a render coincides with a stress run.
- **Sparse events:** the soft-signal fallback guarantees a reel; a truly
  empty event (0 approved uploads) returns a clear "nothing to edit yet"
  state, not an error.
