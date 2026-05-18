# Reelday.ph — Product overview

This document describes what Reelday.ph is and how the whole system fits
together, end-to-end. It's written so a new contributor (human or AI)
can pick up context without having to read the codebase first.

---

## 1. What it is, in one sentence

**Reelday.ph is a live event wall for Filipino celebrations: guests
upload photos and short video messages from their phones, and the wall
on the venue TV plays them as a continuously-updating cinematic
slideshow with live reactions and polls.**

Think "Instagram Story for a single event, projected on the big screen
at a wedding / debut / corporate gala, curated by the host."

---

## 2. Who it's for

- **Hosts** — couples getting married, families holding a debut /
  birthday / baptism / reunion, companies running a Christmas party or
  team-building. They sign up, create an event, share a QR / link, and
  run the wall on a TV at the venue.
- **Guests** — anyone at the event with a phone. They scan a QR, type
  their name once, then upload moments. No account needed.
- **Admin (us)** — internal staff who manage payments (especially
  manual GCash references), comp tiers, and moderate misbehaving
  events.

---

## 3. The three surfaces of the product

### 3.1 The marketing site (`/`)

Public landing page in English + Tagalog. Explains the product, shows
the event categories we support (Wedding, Birthday, Baptism, Reunion,
Corporate), pricing, FAQ. The login state changes the header: logged-out
visitors see "Log in / Start free"; logged-in users see their name with
a dropdown to Account / Log out.

### 3.2 The host product (logged-in)

- **My Events** (`/my-events`) — list of all events the host owns,
  with status badges and quick links.
- **Create Event** (`/start`) — wizard that captures event type,
  couple/celebrant names, date, then auto-generates a unique slug and
  a wall URL. (`/create` redirects here permanently.)
- **Dashboard** (`/dashboard?slug=…`) — per-event control center:
  - Real-time queue of pending upload approvals when auto-approve is off.
  - Toggles for auto-approve (photos / videos / video messages).
  - QR / link to share with guests.
  - Live polls / questions creator (Sinag tier and above).
  - "Play video messages now" burst control that interrupts the
    slideshow and queues a specific set of video messages.
  - Stats and download-all for the gallery.
- **Account** (`/account`) — profile, plan summary with limits,
  feature checkmarks, and an upgrade nudge tailored to the next tier.

### 3.3 The guest experience (no login)

- **Upload page** (`/upload/<slug>`) — mobile-first. Guest types their
  name once (saved in localStorage), then can:
  - Upload photos or short videos from their camera roll.
  - Record a 30-second video message in-page.
  - Tap an emoji to send a live reaction that floats up over the
    current slide on the wall.
  - Vote on live polls/questions the host is running.

### 3.4 The wall (`/wall/<slug>`)

Designed for a TV / projector on a venue WiFi. Fullscreen-ready.
Polls the upload list every 2 seconds and shows new uploads in
near-real-time. Features:

- **Slideshow** with Ken Burns animation, cross-fade transitions.
- **Aspect-aware fit**: 16:9 sources fill the screen; portrait /
  square / 4:3 sources are contained with a blurred-poster backdrop
  that samples the source's left/right edges (so the bars feel like
  ambient scene-light, not a copy of the subject's face).
- **Live emoji reactions** float up over the active slide as guests
  tap them on their phones.
- **Live polls / questions** take over the wall when the host
  launches one; the wall shows the question, the running tally, and a
  countdown timer.
- **Processing state**: video uploads display the guest's own captured
  thumbnail while transcoding is in flight, then auto-swap to the
  playing video when ready.
- **"Just-ready" promotion**: when a video finishes transcoding while
  a different slide is on screen, the wall queues it to play right
  after the current slide (max ~10s wait), so the live feel never
  blocks the rhythm.
- **Live ticker** at top with broadcast-red LIVE dot, moment count
  pill, guests-sharing count pill (each breathing in offset pulse),
  date, and the event short-code.

### 3.5 The admin panel (`/admin`)

Single-password gate (ADMIN_TOKEN env var, never a user account).
Lets internal staff:

- See platform-wide stats (total events, paid events, pending
  payments, total revenue).
- **Users** — list, search, override subscription tier (Tala / Sinag
  / Dalisay / Hiraya), toggle email-verified, soft-deactivate /
  reactivate users.
- **Payments** — full history filterable by status (pending card,
  pending GCash, succeeded, rejected, refunded). Verify or reject
  pending GCash references. Record manual cash / bank-transfer
  payments that immediately upgrade the user. Refund a succeeded
  payment (also flips the linked event back to unpaid).
- **Events** — list every event, deactivate them.

### 3.6 The event website (`/e/<slug>`) — Dalisay & Hiraya

A per-event guest microsite — the "4 months before" companion to the
wall's "4 hours during". Gated to the **Dalisay/Hiraya** tiers via the
`website` plan feature flag (owner's *effective* tier, not the cached
`events.plan`). Unpublished or not-entitled → bare 404 (no leak).

- **Served from `server.js`** at `/e/:slug` (sibling of `/wall/:slug`).
  It's not a plain `sendFile`: the handler injects Open Graph / theme /
  `noindex` meta into the initial HTML so Viber / Messenger / FB
  crawlers (which don't run JS) render the cover card. The injected
  page is cached per slug and busted on owner edit, so a popular event
  is a buffer send with zero DB. The body then hydrates client-side
  from `GET /api/event-site/:slug` — same static-page + JSON pattern as
  the wall/upload pages. No SPA framework, no new npm deps.
- **Sections** (all from one `event_sites.config` JSONB, ordered by an
  event-type preset, host-overridable): hero + live countdown that
  flips to "Happening now → open the live wall" at event time, story,
  details (order-of-the-day, venue cards, keyless Google Maps embed,
  dress code, parking), prenup/gallery, **find-your-seat** (type your
  name → your table; server-side exact match only, rate-limited — never
  the whole list, an anti-scrape decision), RSVP, FAQ, entourage,
  "good to know", footer (.ics + Google Calendar, Web Share, link into
  `/upload/<slug>`). EN/Tagalog toggle is UI-labels-only by design.
- **Performance**: the public read reuses the reactions.js 5s
  slug→event TTL cache shape (so a guest burst can't drain the pg pool)
  plus single-flight + a pre-built gzip buffer, invalidated on owner
  write for instant freshness.
- **Host editing** lives in a plan-gated "Event Website" panel on the
  dashboard, implemented as an isolated `<script type="module">` so it
  shares no scope with the main dashboard module. Autofills from the
  event row; structured fields; cover/prenup upload via an owner-only
  image endpoint that uses `putFile` (no `uploads` row → never on the
  wall); seat paste-import; RSVP list + CSV export.

Parked for later: Memorial preset (sensitive tone), an AI concierge
over a plain-text knowledge blob, RSVP analytics (V2); Hiraya custom
domains (V3). See `docs/event-website-plan.md`.

---

## 4. The core flows, end-to-end

### 4.1 Host creates an event and runs the wall

1. Host signs up at `/register` (email + password or Google OAuth).
2. Verifies email via Resend-delivered link (`/verify?token=…`).
3. Clicks "Create event", picks a category, types couple names + date.
4. System mints a slug, creates an `events` row, sets `gallery_expires_at`
   and `upload_window_ends_at` from the host's plan limits.
5. Host pays via PayMongo card checkout or submits a GCash reference
   for admin verification. (Tala / free tier skips this.)
6. Host opens `/dashboard?slug=…`, shares the QR (`/upload/<slug>`) with
   guests, opens `/wall/<slug>` on the venue TV in fullscreen.

### 4.2 Guest uploads a moment

1. Guest scans QR → lands on `/upload/<slug>`.
2. Types their name (stored in localStorage, persists across reloads).
3. Picks a photo / video from camera roll OR records in-page.
4. Browser captures a poster thumbnail for video uploads (canvas
   `toDataURL`).
5. Client requests a presigned R2 URL from `/api/uploads/presigned`,
   uploads directly to R2 (so the Reelday server never proxies bytes).
6. Client POSTs to `/api/uploads/complete`. Backend:
   - Saves the poster thumb to R2 as a sibling object
     (`prethumb_<base>.jpg`).
   - Inserts the `uploads` row with `pre_thumb_url` pointing at it.
   - For videos, enqueues a transcode job onto an SQS FIFO queue keyed
     by event id (per-event ordering, backpressure, retries).
7. Photos appear on the wall instantly (next 2s poll). Videos show
   the guest's poster + "Polishing your Reel…" loader while the
   Lambda transcodes them; the wall auto-swaps to the ready video.

### 4.3 Transcode pipeline (videos only)

1. Backend SQS FIFO `reelday-transcode.fifo` receives a message with
   `{ originalKey, preThumbKey, eventId }`.
2. AWS Lambda (`reelday-transcoder-v3-singapore`) picks it up:
   - Downloads source + pre-thumb from R2.
   - Single ffmpeg pass with libx264 superfast preset, CRF 24,
     `scale=1280:720:force_original_aspect_ratio=decrease` — output
     keeps the source's native aspect ratio inside a 1280×720
     bounding box (so portrait clips come out at, e.g., 405×720, not
     a 16:9 file with baked side bars; the wall handles letterboxing
     in CSS with a much nicer blur).
   - Also extracts a poster frame at t=1s.
3. Lambda fires two webhooks to `/api/webhooks/transcode`:
   - `poster_ready` → updates `poster_url` on the uploads row so the
     wall can swap from pre-thumb to the lambda-generated poster.
   - `video_ready` → sets `compressed_key`, `file_url`, `web_url`,
     `video_status='ready'`.
4. Wall sees the row flip to `ready` on its next 2s poll and either
   in-place-swaps (if currently displaying that slide) or queues it
   to play right after the current slide.

### 4.4 Live reactions

1. Guest taps an emoji on the upload page.
2. POST `/api/reactions/<slug>` with `{ emoji, guest_name }`. Backend
   gates on the event's effective plan (Sinag+) and inserts in a
   single round-trip (`INSERT … VALUES (…, (SELECT id FROM uploads
   WHERE …), …)` so an optional `upload_id` check piggybacks on the
   write).
3. Wall polls `/api/reactions/<slug>?since=<iso>` every second, gets
   only reactions newer than `since`, spawns floating emojis over the
   current slide. Cap of 18 concurrent floaters; tap-storms get
   frame-dropped so the GPU doesn't churn.

### 4.5 Live polls

1. Host pre-creates poll questions in the dashboard (`status='draft'`).
2. Host taps "Run on wall" → `status='live'`, `started_at=NOW()`.
3. Wall poll at 2s tick picks it up, pauses the slideshow, takes over
   the screen with the question, options, live tally, and countdown.
4. Guests vote on `/upload/<slug>` (vote row keyed by `guest_id` so a
   guest can change their mind while live).
5. Poll auto-ends after `duration_s` seconds, or host stops early.
   Wall shows final results + fastest-voter callout, then fades back
   to the slideshow.

### 4.6 Payment flow

1. Host picks a paid tier on `/pricing` or in the create-event flow.
2. **Card**: `/api/payments/create` makes a PayMongo checkout session,
   inserts `payments` row with `status='pending'`. PayMongo webhook
   on success flips to `succeeded` and upgrades the user's tier.
3. **GCash manual**: guest sends GCash transfer to our number, types
   their reference number on the site. `/api/payments/manual` saves
   it as `status='manual_pending'`. Admin verifies in `/admin`:
   - Accept → tier upgrade fires from the verify endpoint.
   - Reject → status flips to `rejected`, no upgrade.
4. **Admin comp**: admin records a manual cash / bank-transfer
   payment in the admin panel; transactional insert immediately
   upgrades user + event.

---

## 5. Plan tiers

Defined in `backend/lib/plans.js` and `frontend/js/plans.js` (kept in
sync). Backend is the source of truth.

| Tier | Price | Events | Uploads/event | Gallery | Upload window | Notable features |
|---|---|---|---|---|---|---|
| **Tala** | Free | 1 | 25 photos | 24 hours | 1 day | Photos only |
| **Sinag** | ₱1,490 / event | 1 | unlimited | 30 days | 1 day | + Reactions, Video messages |
| **Dalisay** | ₱2,990 / event | 1 | unlimited | 90 days | 7 days | + Audio notes, Polls, Event website |
| **Hiraya** | ₱9,990 / year | 10 / yr | unlimited | 365 days | 180 days | Yearly subscription for coordinators, photographers & venues; + Custom domain |

---

## 6. Event categories

Currently five (Memorial was retired). Today they're cosmetic tags;
the product behaves the same regardless. Likely to be consolidated to
3 (Wedding / Birthday / Corporate) with each made meaningfully
distinct via:

- Per-type wall emoji set (THEME_META in `wall.html`)
- Per-type default copy ("Bride & Groom" vs "Celebrant" vs "Company")
- Per-type default poll templates
- Per-type wall theme accent colors

Open product decision; not committed yet.

---

## 7. Tech architecture

### Stack

- **Frontend**: vanilla HTML + ES module JS. No SPA framework. Mobile-first
  upload page, TV-first wall, dashboard works on tablet+desktop. i18n
  in `frontend/js/i18n.js` (English / Tagalog).
- **Backend**: Fastify on Node.js. Auth via JWT (plus Google OAuth and
  email verification with Resend). Postgres via the `pg` Pool. R2 for
  media (S3-compatible, via `@aws-sdk/client-s3`). PayMongo for cards.
  AWS SQS + Lambda for video transcoding.
- **Storage**: Cloudflare R2 (public via `media.reelday.ph`,
  CDN-image-transformed via `/cdn-cgi/image/` for thumbnails).
- **Hosting**: backend behind `reelday.ph`; AWS for the
  transcoder; PayMongo / Resend as external SaaS.

### Key data model

- `users` — auth, profile, `subscription_tier`, `is_verified`,
  `is_active` (admin soft-deactivate).
- `events` — `slug` (URL identity), `couple_names`, `event_date`,
  `event_type`, `plan` (cached at event creation), `is_paid`,
  `is_active`, `auto_approve` flags, `gallery_expires_at`,
  `upload_window_ends_at`, plus `playback_burst_*` columns for
  the host-triggered video-burst feature.
- `uploads` — `event_id`, `file_url` (R2 URL),
  `compressed_key`/`web_url` (transcoded video), `poster_url`,
  `pre_thumb_url`, `original_key`, `video_status`
  ('processing'/'ready'), `is_approved`, `uploader_name`.
- `reactions` — `event_id`, optional `upload_id`, `guest_id`,
  `guest_name`, `emoji`.
- `polls` — `event_id`, `question`, `options` JSONB, `kind`
  ('poll' or 'question'), `correct_key`, `status`, `duration_s`.
- `poll_votes` — `poll_id` + `guest_id` PK; one vote per guest per
  poll, upserted on change-of-mind.
- `payments` — `user_id`, optional `event_id`,
  `paymongo_payment_id`, `amount` (centavos), `tier`, `status`.

### Rate limiting

Global Fastify rate-limiter keyed by `X-Guest-Id` (guests),
`X-Wall-Id` (wall TVs — every wall persists a per-device UUID), or
`req.ip` fallback. Static asset routes and authenticated hosts are
exempt. Per-route tighter buckets on writes (POST reactions,
uploads, poll votes, wall-error beacons).

### Performance characteristics (measured 15 May 2026)

- **Wall poll** (`GET /api/uploads/:slug`): 14 KB gzip response. p95 = 0.94 s
  at 200 concurrent, 2.55 s at 600 concurrent. In-memory single-flight
  cache (1.5 s TTL) + pre-built gzip buffer so cache hits are a raw
  buffer send. DB partial index on `(event_id, created_at DESC) WHERE
  is_approved = true`.
- **Upload kickoff** (`POST /api/uploads/presigned`): p95 = 2.7 s at 500
  concurrent, 0 failures. Photos skip Lambda entirely — appear on wall
  within one 2 s poll cycle.
- **Reactions**: write p95 = 116 ms at 200 concurrent. Read (wall polls
  every 1 s) uses a shared `eventCache` (5 s TTL) so the event-ID lookup
  is free on warm hits — one DB query per reaction GET, not two.
- **Poll votes**: upsert storm of 300 simultaneous voters, 0 failures,
  p95 = 1.74 s. Tally reads unaffected (124 ms).
- **Cross-event isolation**: a 200-spammer reaction storm on Event A does
  not degrade Event B's wall (p95 280 ms, indistinguishable from idle).
  DB pool (50 conns) never saturates across event boundaries.
- **Transcode ceiling**: 10 concurrent Lambda invocations ≈ 35 videos/min
  total across all events. This — not the HTTP layer — is the bottleneck
  for large events.

### Things the codebase has learned (i.e. footguns we've patched)

- Don't send big base64 data URLs through SQS — 256 KiB hard cap.
  Always store binary in R2 and pass keys.
- Don't replace `wall.items` on every poll — it wipes any custom
  ordering (new-upload splices, just-ready promotions) before
  they get to display.
- Don't write `event_id` lookup queries on the reactions hot path —
  cache slug→event for ~5s; bursts otherwise drain the pg pool.
- Don't bake blurred backdrops into the transcoded video file — the
  wall does it better in CSS and you can tune it without
  re-transcoding everything.
- Don't use `object-fit: cover` blindly on portrait sources — it
  reads as aggressive head-zoom. Detect aspect at slide-time and
  pick cover for ~16:9, contain (with blurred backdrop) for the rest.
- Don't use `SELECT *` on the wall poll hot path — at 100+ uploads the
  payload ballooned to 156 KB and caused 600-concurrent p95 to spike to
  9 s. Select only the 15 columns the wall reads.
- Don't add new npm packages for compression — `@fastify/compress` failed
  to install in the Easypanel Docker build and caused a 502. Use Node's
  built-in `zlib.gzipSync` on the specific hot endpoint instead.

---

## 8. What's intentionally NOT in scope (today)

- **In-app messaging / chat** between guests. Reactions and uploads
  are the only social affordances.
- **Public galleries**. Walls are accessible by URL, but they're
  scoped to one event slug; we don't aggregate or index them.
- **Editing uploads after upload**. Hosts can approve / unapprove /
  delete; nobody can edit captions or replace media.
- **Mobile apps**. Mobile web only.
- **International payments**. PayMongo is PH-only.

---

## 9. Where to look in the code

| Concern | Files |
|---|---|
| Marketing pages, i18n | `frontend/index.html`, `frontend/js/i18n.js` |
| Host dashboard | `frontend/dashboard.html` |
| Guest upload page | `frontend/upload.html` |
| Live wall | `frontend/wall.html` |
| Account page | `frontend/account.html` |
| Admin panel | `frontend/admin.html` |
| API server entry | `backend/server.js` |
| Auth / login / register | `backend/routes/auth.js` |
| Uploads + presigned | `backend/routes/uploads.js` |
| Wall reactions | `backend/routes/reactions.js` |
| Live polls | `backend/routes/polls.js` |
| Payments (PayMongo + manual) | `backend/routes/payments.js` |
| Admin endpoints | `backend/routes/admin.js` |
| Transcode webhook | `backend/routes/webhooks.js` |
| Plan definitions | `backend/lib/plans.js`, `frontend/js/plans.js` |
| Event website (guest) | `frontend/event-site.html`, `/e/:slug` in `backend/server.js` |
| Event website (API) | `backend/routes/event-site.js` |
| Event website (host editor) | isolated module at end of `frontend/dashboard.html` |
| Event website plan/scope | `docs/event-website-plan.md` |
| Lambda transcoder | `lambda/index.mjs` |
| DB schema + migrations | `backend/plugins/database.js` |
