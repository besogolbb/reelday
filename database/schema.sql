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
  plan            VARCHAR(20)  DEFAULT 'libre',
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
-- subscription_expires_at: NULL for free / per-event purchases; set for Hiraya yearly
-- events_remaining: NULL = unlimited per the tier; set for Dalisay package (3) and Hiraya (10)
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier       VARCHAR(20)   DEFAULT 'tala';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS events_remaining        INTEGER;

-- ── Per-event expiry stamps (computed from plan at creation time) ──
-- gallery_expires_at: when the wall + downloads soft-lock
-- upload_window_ends_at: when guests can no longer upload
ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery_expires_at     TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS upload_window_ends_at  TIMESTAMPTZ;

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
