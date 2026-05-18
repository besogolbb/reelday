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

---

## 1. Architecture

- **Gating:** new `sde` flag in [backend/lib/plans.js](backend/lib/plans.js)
  + mirror in `frontend/js/plans.js`. `true` for `dalisay` + `hiraya`
  only. Reads effective tier the locked way:
  `resolvePlan(event.plan || event.subscription_tier || 'tala')` — see
  the project memory on event-scoped tiers. Tala/Sinag dashboard shows a
  locked upsell card (mirror how `website`/`polls` render locked).
- **Render compute:** new Lambda `reelday-sde-renderer` (separate
  function, separate file `lambda/sde.mjs`). Direct
  `InvocationType:'Event'` invoke via an `awsLambdaService`-style client
  — **not** the SQS FIFO transcoder (that's a per-upload stream; this is
  a one-shot batch job). Config: memory ~3008 MB, ephemeral `/tmp`
  bumped to 4–10 GB, timeout 600–900 s. Reports completion to a new
  `POST /webhooks/sde-ready` reusing `WEBHOOK_SECRET`.
- **Selection (Curator):** new pure module `backend/lib/sdeSelect.js`,
  owner-only, server-side. One indexed query (see §3).
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

-- Wall reveal command. Host "Play on wall" sets played_requested_at=NOW();
-- the wall compares it to its last-seen value on its existing poll tick.
ALTER TABLE events ADD COLUMN IF NOT EXISTS sde_play_requested_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sde_play_cleared_at   TIMESTAMPTZ;
```

The final SDE URL is also written into `event_sites.config.sde`
(`{ video_url, poster_url, duration_s, rendered_at }`) so the website
hub renders it with zero extra joins — consistent with how the event
site already reads everything from that one JSONB blob.

## 3. The Curator — `backend/lib/sdeSelect.js`

Single query, owner-only. Weighted score (love/fire > applause >
everything), pinned forced in, excluded forced out:

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
1. **Always include** `sde_pinned` rows.
2. Fill remaining slots from the rest by `score DESC, created_at DESC`.
3. **Fallback:** if selected count < `MIN_CLIPS` (≈12), top up with the
   most-recent non-excluded uploads until target or no uploads left.
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
  then `scale`/`pad` to fill 1920×1080, gentle accent.
- **Video → first 5 s:** `-t 5`, `scale`/`pad` to 1920×1080, drop guest
  audio in v1 (music bed only; ducking parked).
- **Endcard:** ~2.5 s brand card (event name + "ReelDay") via `drawtext`
  or a pre-rendered PNG overlaid on brand bg.

Compose: concat all bricks → silent master; take `audioKey`, trim/loop
to total duration, `afade` in/out, `-shortest`. Output H.264 1920×1080
`+faststart` + AAC. Upload `outKey` + a poster to R2. Then
`POST /webhooks/sde-ready` (HMAC-style shared secret like the existing
video-ready webhook) → backend updates `event_sde` and writes
`event_sites.config.sde`.

## 5. Backend routes — `backend/routes/sde.js`

- `GET   /api/events/:slug/sde` (owner) — status + video_url + the
  curated preview list with per-clip score / pinned / excluded.
- `PATCH /api/events/:slug/sde/clips` (owner) — set pinned/excluded.
- `POST  /api/events/:slug/sde/generate` (owner, `sde`-gated) — run
  Curator, build payload, invoke Lambda, set `status='queued'`.
  Debounced: reject if a render is already in flight for this event.
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
  ⚠️ Respect the standing rule: **grep before declaring any new
  const/function in `dashboard.html`** — a duplicate in a `type=module`
  script silently blanks the whole page.
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

## 8. Phasing

- **Phase 0** — `sde` flag (plans.js ×2) + migration (`event_sde`,
  `uploads.sde_*`, `events.sde_play_*`) + schema.sql mirror.
- **Phase 1** — Curator (`sdeSelect.js`) + owner `GET`/`PATCH` routes +
  dashboard preview/pin UI. No render yet — validate selection alone.
- **Phase 2** — `lambda/sde.mjs` + deploy + `generate` route +
  `sde-ready` webhook + status UI. End-to-end to a downloadable URL.
- **Phase 3** — Website hub pin (`event_sites.config.sde`).
- **Phase 4** — Wall reveal (command column + takeover reuse).
- **Phase 5** — Auto-generate at upload-window close.

## 9. Out of scope (v1) / parked

Vertical/Reels 9:16 cut · AI shot selection / face dedup ·
beat-synced transitions · guest-audio ducking under the bed ·
Hiraya white-label endcard · multi-track soundtrack ·
re-render diffing (each generate is a full re-render in v1).

## 10. Risk notes

- **Lambda ceiling:** 25 clips concat is a single long job — dedicated
  function with bumped `/tmp` + memory + timeout, isolated from the live
  per-upload transcoder. ~1–3 min render keeps the "5-minute SDE"
  promise.
- **Hot-path discipline:** the wall-state read must ride an existing
  poll, not add one. The Curator query is owner-only and rate-limited.
  Append a row to `docs/perf-test-database.md` if a render coincides
  with a stress run.
- **Sparse events:** the fallback (recency top-up) guarantees a reel; a
  truly empty event (0 approved uploads) returns a clear "nothing to
  edit yet" state, not an error.
</content>
</invoke>
