-- Reelday Database Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_uploads_event_id    ON uploads(event_id);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at  ON uploads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_messages_event ON video_messages(event_id);
CREATE INDEX IF NOT EXISTS idx_payments_event_id   ON payments(event_id);
CREATE INDEX IF NOT EXISTS idx_events_slug         ON events(slug);
