-- Reelday Database Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
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

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            VARCHAR(100) UNIQUE NOT NULL,
  couple_names    VARCHAR(200) NOT NULL,
  event_type      VARCHAR(50)  DEFAULT 'wedding',
  event_date      DATE,
  cover_photo_url TEXT,
  plan            VARCHAR(20)  DEFAULT 'tala',
  is_paid         BOOLEAN      DEFAULT false,
  is_active       BOOLEAN      DEFAULT true,
  password_hash   TEXT,
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- Uploads table
CREATE TABLE IF NOT EXISTS uploads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID REFERENCES events(id) ON DELETE CASCADE,
  file_url         TEXT         NOT NULL,
  file_type        VARCHAR(20)  DEFAULT 'photo',
  thumbnail_url    TEXT,
  uploader_name    VARCHAR(100),
  message          TEXT,
  is_video_message BOOLEAN      DEFAULT false,
  is_approved      BOOLEAN      DEFAULT true,
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- Video messages table
CREATE TABLE IF NOT EXISTS video_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID REFERENCES events(id) ON DELETE CASCADE,
  file_url         TEXT         NOT NULL,
  uploader_name    VARCHAR(100),
  duration_seconds INTEGER,
  is_played        BOOLEAN      DEFAULT false,
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             UUID REFERENCES events(id),
  paymongo_payment_id  VARCHAR(200),
  amount               INTEGER      NOT NULL,
  currency             VARCHAR(3)   DEFAULT 'PHP',
  status               VARCHAR(30)  DEFAULT 'pending',
  plan                 VARCHAR(20),
  created_at           TIMESTAMPTZ  DEFAULT NOW()
);

-- Add user_id to events (migration for existing databases)
ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- ── Subscription columns on users (Phase 2 plan enforcement) ──
-- subscription_tier: 'tala' | 'sinag' | 'dalisay' | 'hiraya'
-- subscription_expires_at: NULL for free / per-event purchases; set to NOW()+1yr
--   for Hiraya, the only yearly tier.
-- events_remaining: NULL = unlimited per the tier; set to 1 for Sinag/Dalisay
--   one-time purchases (accumulates on Sinag re-buy), and to 10 for Hiraya.
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier       VARCHAR(20)   DEFAULT 'tala';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS events_remaining        INTEGER;

-- tala_used: lifetime "1 free Tala event per account" flag. Set to true
-- the first time a user creates a plan='tala' event and never cleared,
-- so a Tala user who deletes their event can't claim another free one.
-- Backfilled at boot from existing plan='tala' rows. See backend/routes/events.js.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tala_used BOOLEAN NOT NULL DEFAULT false;

-- ── Per-event expiry stamps (computed from plan at creation time) ──
-- gallery_expires_at:      when the wall + downloads soft-lock
-- upload_window_starts_at: when guests can BEGIN uploading. NULL on
--   legacy rows created before the May 2026 centered-window shift; the
--   backend treats NULL as "no start check" (uploads always open until
--   ends_at), so old events keep their original wider window.
-- upload_window_ends_at:   when guests can no longer upload (exclusive)
ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery_expires_at      TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS upload_window_starts_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS upload_window_ends_at   TIMESTAMPTZ;

-- ── Optional event details surfaced on the upload page ──
-- venue:           free text, e.g. "Manila Hotel"
-- event_time:      free text, e.g. "5:00 PM"
-- welcome_message: greeting shown above the upload form
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue           VARCHAR(200);
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_time      VARCHAR(60);
ALTER TABLE events ADD COLUMN IF NOT EXISTS welcome_message TEXT;

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);

-- ── Phase 3: tie payments to the buyer (not just the event) ──
ALTER TABLE payments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tier    VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_uploads_event_id    ON uploads(event_id);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at  ON uploads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_messages_event ON video_messages(event_id);
CREATE INDEX IF NOT EXISTS idx_payments_event_id   ON payments(event_id);
CREATE INDEX IF NOT EXISTS idx_events_slug         ON events(slug);

-- ── Background music for the wall (Phase 1) ──
-- Curated, royalty-free playlists. Host picks one per event in the dashboard;
-- the wall streams the playlist on loop (with ducking during guest videos).
-- Tracks live in R2 under `music/<mood>/<filename>.mp3` and are served via
-- the bucket's public URL (no per-request signing — same as guest uploads).
CREATE TABLE IF NOT EXISTS music_playlists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(80)  NOT NULL,
  mood         VARCHAR(40)  NOT NULL,   -- 'ceremony' | 'cocktail' | 'dinner' | 'party'
  description  TEXT,
  cover_color  VARCHAR(20),             -- hex, used as picker swatch
  is_active    BOOLEAN      DEFAULT true,
  position     INTEGER      DEFAULT 0,  -- display order in the dashboard picker
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS music_tracks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id   UUID REFERENCES music_playlists(id) ON DELETE CASCADE,
  title         VARCHAR(160) NOT NULL,
  artist        VARCHAR(160),
  file_url      TEXT         NOT NULL,  -- absolute R2 public URL
  duration_s    INTEGER      NOT NULL DEFAULT 0,
  position      INTEGER      NOT NULL DEFAULT 0,
  license_info  TEXT,                   -- attribution string if required
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_music_tracks_playlist ON music_tracks(playlist_id, position);

ALTER TABLE events ADD COLUMN IF NOT EXISTS music_playlist_id UUID REFERENCES music_playlists(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS music_enabled     BOOLEAN DEFAULT true;

-- ── Per-event custom music (Phase 2) ──
-- When a host uploads their own tracks via the dashboard, rows get inserted
-- here with event_id + uploaded_by_user_id set. When both are NULL the row
-- is a curated-library track (existing behaviour). If an event has ANY
-- custom tracks, the wall plays those instead of the picked curated
-- playlist (the dashboard UI says so explicitly).
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS event_id            UUID REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES users(id);
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS r2_key              TEXT;          -- needed for delete-from-R2 on track removal
ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS original_filename   VARCHAR(255);  -- for display in the dashboard list
CREATE INDEX IF NOT EXISTS idx_music_tracks_event ON music_tracks(event_id, position);

-- ── Event Website (Dalisay/Hiraya) — per-event guest microsite at /e/<slug> ──
-- See docs/event-website-plan.md. All flexible host content lives in the
-- single event_sites.config JSONB. Public render requires is_published AND
-- the owner's effective tier having the 'website' feature.
CREATE TABLE IF NOT EXISTS event_sites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  is_published BOOLEAN     NOT NULL DEFAULT false,
  config       JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- hero/story/schedule/logistics/faq/entourage/goodToKnow + section order/visibility + accent
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guest RSVPs — one row per (event_id, guest_id), upserted on change-of-mind
-- (poll_votes pattern). guest_id = X-Guest-Id localStorage UUID.
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

-- Seat/table assignments — searched via a public match-only lookup
-- (never the whole list: scrape/privacy). lower(guest_name) index keeps
-- per-name lookup instant.
CREATE TABLE IF NOT EXISTS event_seats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_name    VARCHAR(160) NOT NULL,
  table_label   VARCHAR(80),
  location_note VARCHAR(200),
  seat_note     VARCHAR(120),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_seats_lookup ON event_seats (event_id, lower(guest_name));

-- Host override of the event-type-derived microsite theme.
ALTER TABLE events ADD COLUMN IF NOT EXISTS theme_override VARCHAR(40);
