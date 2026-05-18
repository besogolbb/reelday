import fp from 'fastify-plugin';
import pg from 'pg';

const { Pool } = pg;

const MIGRATIONS = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  CREATE TABLE IF NOT EXISTS users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                VARCHAR(255) UNIQUE NOT NULL,
    password_hash        TEXT NOT NULL,
    full_name            VARCHAR(200),
    phone                VARCHAR(30),
    is_verified          BOOLEAN     DEFAULT false,
    verification_token   TEXT,
    reset_token          TEXT,
    reset_token_expires  TIMESTAMPTZ,
    created_at           TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

  ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100);
  ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;

  -- Admin-toggleable soft-deactivate flag for users. Distinct from
  -- is_verified (email-verified) — an active-but-unverified user can
  -- still log in; an inactive user cannot.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

  -- Optional event details surfaced on the upload page
  ALTER TABLE events ADD COLUMN IF NOT EXISTS venue           VARCHAR(200);
  ALTER TABLE events ADD COLUMN IF NOT EXISTS event_time      VARCHAR(60);
  ALTER TABLE events ADD COLUMN IF NOT EXISTS welcome_message TEXT;

  -- Per-event moderation: photos default to auto-approve (legacy behaviour),
  -- videos default to manual review so the host can screen messages.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS auto_approve               BOOLEAN DEFAULT true;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS video_auto_approve         BOOLEAN DEFAULT false;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS video_message_auto_approve BOOLEAN DEFAULT false;

  -- "Play video messages now" burst: dashboard increments burst_id and
  -- stores an ordered list of upload IDs. The wall polls these fields,
  -- detects a new burst, plays the queue, then resumes photos.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS playback_burst_id    INTEGER DEFAULT 0;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS playback_burst_queue JSONB   DEFAULT '[]'::jsonb;

  -- Google Calendar sync: id of this event's entry in the shared service-
  -- account calendar (lib/gcal.js). NULL = never synced / not configured.
  -- Lets create→insert, edit→patch, delete→delete stay idempotent.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS gcal_event_id VARCHAR(256);

  -- Server-side video transcode pipeline: web_url is the wall-friendly
  -- 720p H.264 MP4 (with faststart), poster_url is a JPEG of the first
  -- frame. Both are NULL until the background ffmpeg job finishes; the
  -- frontend falls back to file_url while the transcode is in flight.
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS web_url    TEXT;
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS poster_url TEXT;
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS original_key   TEXT;
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS compressed_key TEXT;
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS video_status   VARCHAR(20);
  -- Guest-browser thumbnail captured at upload time. Persisted as a
  -- real R2 object (not a giant data URL in the row) so it survives
  -- the lambda webhook overwriting poster_url with the final poster.
  -- The wall reads this while the video is still transcoding.
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS pre_thumb_url TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_uploads_original_key
    ON uploads(original_key) WHERE original_key IS NOT NULL;

  -- Guest device identity for audio↔photo pairing on the wall.
  -- Populated from the X-Guest-Id header (localStorage UUID) so all uploads
  -- from the same browser session share an id, regardless of uploader name.
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS guest_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_uploads_guest_id ON uploads(guest_id) WHERE guest_id IS NOT NULL;

  -- Submission batch: all files uploaded in one "Share" tap share a UUID.
  -- Used by the wall to pair audio with its companion photo/video precisely,
  -- with no timestamp fuzzing or name matching required.
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS batch_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_uploads_batch_id ON uploads(batch_id) WHERE batch_id IS NOT NULL;

  -- Direct server-side audio link. Set immediately when an audio upload lands:
  -- the /uploads/complete handler finds the companion photo (same batch_id) and
  -- writes its file_url here. The wall reads this — no JS matching needed.
  ALTER TABLE uploads ADD COLUMN IF NOT EXISTS audio_url TEXT;

  -- Audio is companion content and always auto-approves. Backfill any rows
  -- that were uploaded before this rule was in place.
  UPDATE uploads SET is_approved = true WHERE file_type = 'audio' AND is_approved = false;

  -- Backfill legacy rows so already-compressed videos remain playable on
  -- the wall, while videos still lacking a compressed derivative stay in
  -- processing mode until a webhook marks them ready.
  UPDATE uploads
     SET video_status = CASE
       WHEN web_url IS NOT NULL THEN 'ready'
       ELSE 'processing'
     END
   WHERE file_type = 'video'
     AND video_status IS NULL;

  -- Wall reactions: guests tap an emoji on the upload page, the wall
  -- floats it up over the current slide. guest_id is the X-Guest-Id
  -- header (also used by the rate-limiter); guest_name is captured at
  -- react-time so old reactions still credit the right person even if
  -- the guest later changes their name.
  CREATE TABLE IF NOT EXISTS reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    upload_id   UUID NULL REFERENCES uploads(id) ON DELETE SET NULL,
    guest_id    VARCHAR(64)  NOT NULL,
    guest_name  VARCHAR(120) NOT NULL,
    emoji       VARCHAR(8)   NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_event_time ON reactions(event_id, created_at DESC);

  -- Wall poll hot path: GET /uploads/:slug filters by event + approved, orders by time.
  -- Partial index covers only approved rows so it stays small and the planner always picks it.
  CREATE INDEX IF NOT EXISTS idx_uploads_event_approved_time
    ON uploads(event_id, created_at DESC) WHERE is_approved = true;

  -- Event lookup by slug is called on every single API request — make it instant.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug ON events(slug);

  -- Live polls: host pre-creates questions in the dashboard, then taps
  -- "Run on wall" to set status='live'. The wall poll picks it up,
  -- pauses photos, and shows the question + a live tally. Auto-ends
  -- after duration_s seconds, or the host can stop early.
  CREATE TABLE IF NOT EXISTS polls (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    question    VARCHAR(200) NOT NULL,
    options     JSONB NOT NULL,           -- [{key:'a', label:'Beach'}, ...]
    duration_s  INTEGER NOT NULL DEFAULT 30,
    status      VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft|live|ended
    started_at  TIMESTAMPTZ,
    ended_at    TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_polls_event_status ON polls(event_id, status);

  -- Polls have two kinds:
  --   'poll'     - opinion poll, no right answer (legacy default)
  --   'question' - trivia-style; one option is the correct answer and the
  --               wall flags it on the results screen
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS kind        VARCHAR(16) DEFAULT 'poll';
  ALTER TABLE polls ADD COLUMN IF NOT EXISTS correct_key VARCHAR(40);

  -- One vote per guest per poll. Upsert via the primary key lets a
  -- guest change their mind while the poll is live.
  CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id     UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    guest_id    VARCHAR(64) NOT NULL,
    option_key  VARCHAR(40) NOT NULL,
    guest_name  VARCHAR(120),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (poll_id, guest_id)
  );

  -- ── Event Website (Dalisay/Hiraya) ──
  -- Per-event guest microsite served at /e/<slug>. One row per event;
  -- all flexible host content (hero/story/schedule/logistics/faq/
  -- entourage/goodToKnow + section order & visibility + accent) lives in
  -- the single config JSONB — same approach as polls.options. The site
  -- only renders publicly when is_published AND the owner's effective
  -- tier has the 'website' feature.
  CREATE TABLE IF NOT EXISTS event_sites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    is_published BOOLEAN     NOT NULL DEFAULT false,
    config       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Guest RSVPs. One row per (event_id, guest_id) — upserted on
  -- change-of-mind, same pattern as poll_votes. guest_id is the
  -- X-Guest-Id localStorage UUID; guest_name captured at submit time.
  CREATE TABLE IF NOT EXISTS event_rsvps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    guest_id    VARCHAR(64)  NOT NULL,
    guest_name  VARCHAR(120) NOT NULL,
    email       VARCHAR(200),
    phone       VARCHAR(40),
    attending   BOOLEAN      NOT NULL DEFAULT true,
    party_size  INTEGER      NOT NULL DEFAULT 1,
    meal_choice VARCHAR(80),
    message     TEXT,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW(),
    UNIQUE (event_id, guest_id)
  );
  CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps(event_id, created_at DESC);

  -- Seat/table assignments. Searchable by guest name via a public
  -- match-only lookup endpoint (never the whole list — scrape/privacy).
  -- The lower(guest_name) index keeps the per-name lookup instant.
  CREATE TABLE IF NOT EXISTS event_seats (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    guest_name    VARCHAR(160) NOT NULL,
    table_label   VARCHAR(80),
    location_note VARCHAR(200),
    seat_note     VARCHAR(120),
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_event_seats_lookup
    ON event_seats (event_id, lower(guest_name));

  -- Host can override the event-type-derived theme for the microsite.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS theme_override VARCHAR(40);

  -- ── Free-tier lifetime cap ──
  -- Tala is "1 free event per account, ever" — without this column the
  -- count-based active-events check in events.js lets a Tala user
  -- delete their event and claim another free one. Set to true the
  -- first time a user creates a plan='tala' event (events.js does the
  -- write) and never cleared. Backfilled below for accounts that
  -- already have a Tala-tier event on record.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tala_used BOOLEAN NOT NULL DEFAULT false;
  UPDATE users
     SET tala_used = true
   WHERE tala_used = false
     AND id IN (
       SELECT DISTINCT user_id FROM events
        WHERE plan = 'tala' AND user_id IS NOT NULL
     );
`;

async function dbPlugin(fastify) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    max: 50,                    // bumped from 30: reaction bursts on event A were saturating the pool and freezing wall GETs for event B
    idleTimeoutMillis: 30_000,
    // Kill any single query that runs longer than 30s. Without this, a
    // hung or pathological query holds a pool connection forever and
    // subsequent requests start failing. NOTE: we deliberately do NOT
    // set connectionTimeoutMillis — burst stress (1000 concurrent) needs
    // requests to queue, not error out at 10s. statement_timeout is
    // sufficient to keep the pool from getting permanently jammed.
    statement_timeout: 30_000,
  });

  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    fastify.log.info('PostgreSQL connected');
    await client.query(MIGRATIONS);
    fastify.log.info('Migrations applied');
  } finally {
    client.release();
  }

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
}

export default fp(dbPlugin, { name: 'database' });
