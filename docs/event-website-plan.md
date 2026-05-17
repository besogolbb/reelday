# Event Website — Engineering Plan

Per-event guest-facing microsite ("digital invitation + utility hub") that
wraps the existing live wall + guest upload. Gated to **Dalisay & Hiraya**
via the existing `plans.js` `website` feature flag (already `true` for
exactly those tiers).

Strategy: Reelday becomes event infrastructure — the hub guides guests for
the ~4 months before the event; the wall entertains for the ~4 hours during.

---

## 1. Architecture

- **Route:** path-based `reelday.ph/e/<slug>`. New `fastify.get('/e/:slug')`
  in `server.js`. The handler reads the static `frontend/event-site.html`,
  string-injects `<meta og:*>`, `data-theme`, and
  `<meta name="robots" content="noindex">` into the initial HTML (Viber /
  Messenger / FB crawlers don't run JS), then sends it. Everything else
  hydrates client-side via a new JSON endpoint — same pattern as
  `wall.html`/`upload.html`. **No templating engine, no new npm deps**
  (documented Easypanel build footgun: a new package → 502).
- **Gating:** owner's *effective* tier (reuse the effective-tier logic in
  `routes/events.js` GET — owner's current `users.subscription_tier`, not
  the cached `events.plan`). Not Dalisay/Hiraya → 404. Unpublished → 404.
  Default `noindex`. Optional site password (`events.password_hash`
  already exists, currently unused).
- **Theme:** auto from `events.event_type` (the 8-theme `data-theme`
  system already in `shared.css`); host can override (`events.theme_override`)
  and tweak accent. Per-event-type presets decide default sections,
  labels, and tone.
- **Styling:** reuse `frontend/css/shared.css` (Fraunces + Inter, warm
  paper, soft shadows). No Tailwind (the `.claude/weddings.html` mockup is
  a visual reference only).

## 2. Data model

Added to the `MIGRATIONS` block in `backend/plugins/database.js`
(idempotent, runs at boot) and mirrored into `database/schema.sql` for
documentation parity.

```sql
CREATE TABLE IF NOT EXISTS event_sites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  is_published BOOLEAN     NOT NULL DEFAULT false,
  config       JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- hero/story/schedule/logistics/faq/entourage/goodToKnow/section order+visibility
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id    VARCHAR(64)  NOT NULL,        -- X-Guest-Id (localStorage UUID)
  guest_name  VARCHAR(120) NOT NULL,
  email       VARCHAR(200),
  phone       VARCHAR(40),
  attending   BOOLEAN      NOT NULL DEFAULT true,
  party_size  INTEGER      NOT NULL DEFAULT 1,
  meal_choice VARCHAR(80),
  message     TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW(),
  PRIMARY KEY-equivalent UNIQUE (event_id, guest_id)   -- upsert on change-of-mind, poll_votes pattern
);

CREATE TABLE IF NOT EXISTS event_seats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_name    VARCHAR(160) NOT NULL,
  table_label   VARCHAR(80),
  location_note VARCHAR(200),  -- e.g. "Near the stage, left side"
  seat_note     VARCHAR(120),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_seats_lookup
  ON event_seats (event_id, lower(guest_name));

ALTER TABLE events ADD COLUMN IF NOT EXISTS theme_override VARCHAR(40);
```

(Implementation note: the `event_rsvps` uniqueness is a real
`UNIQUE (event_id, guest_id)` constraint + `ON CONFLICT` upsert — the
pseudo-syntax above just records intent.)

`config` JSONB shape (host content + section order/visibility):
`{ hero:{subtitle}, story:{label,body,photos[]}, schedule:[{time,label}],
venue:[{name,address,mapQuery}], dressCode:{note,swatches[]}, parking:{note},
gallery:{images[]}, faq:[{q,a}], entourage:[{group,people[]}],
goodToKnow:"...", sections:[{key,visible,order}], accent:"#hex" }`

## 3. Backend — `backend/routes/event-site.js`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/event-site/:slug` | public | gated (effective tier + published); short-TTL single-flight cache |
| GET | `/api/event-site/:slug/admin` | owner | full config incl. unpublished |
| PUT | `/api/event-site/:slug` | owner | upsert `config` + `is_published` |
| POST | `/api/event-site/:slug/rsvp` | public | rate-limited (`limiterKey`/`friendlyRateLimit`), validated, upsert per `(event_id, guest_id)` |
| GET | `/api/event-site/:slug/rsvps` | owner | list + CSV export |
| POST | `/api/event-site/:slug/seats/import` | owner | replace guest list (CSV/Excel-paste parsed client-side, posted as array) |
| GET | `/api/event-site/:slug/seat-lookup?q=` | public | **server-side match-only**, rate-limited, returns only the queried guest's record(s) — never the full list |

Hero/prenup image uploads reuse the existing presigned-R2 flow in
`routes/uploads.js`, key prefix `event-site/<event_id>/`.

`/e/:slug` HTML route lives in `server.js` (sibling of `/wall/:slug`).

## 4. Frontend — `frontend/event-site.html`

Single long-scroll, mobile-first page, `shared.css`. Sections (order &
visibility from `config`, defaulted by event-type preset):

1. **Hero** — full-bleed cover, names (Fraunces), date, live countdown →
   flips to *"Happening now → Open the live wall"* on event day.
2. **Story** — label per preset ("Our Story" / "About the Celebrant" …).
3. **Event details** — order-of-the-day timeline, venue card(s),
   **keyless Google Maps embed** (`https://www.google.com/maps?q=<addr>&output=embed`
   iframe — host pastes a Maps link or address, no API key/billing),
   dress-code swatches, parking & directions.
4. **Gallery** — prenup/highlights grid + lightbox.
5. **Find your seat** — guest types name → calls `seat-lookup` → their
   table + location in large Fraunces; no/ambiguous match → graceful
   "contact the host / approach the coordinator". Optional: echo RSVP
   status if name matches an `event_rsvps` row.
6. **RSVP** — attending, party size, meal, message.
7. **FAQ** — accordion (config).
8. **Entourage** — grouped lists (config; preset decides default groups).
9. **"Good to know"** — freeform expandable block (config).
10. **Footer** — site QR + share (reuse `utils/qr.js`), add-to-calendar
    (.ics Blob + Google Calendar URL, client-side; `event_time` is free
    text → best-effort parse, fallback all-day), link into `/upload/<slug>`.

EN/Tagalog **UI-labels-only** toggle (reuse the `frontend/js/i18n.js`
pattern). Host *content* stays single-language.

**Security:** all host-supplied + model-free text rendered via
`textContent`/a single escape helper — never raw `innerHTML`. This is the
highest-XSS-risk surface (public page rendering arbitrary host input).

## 5. Dashboard — `frontend/dashboard.html`

New plan-gated "Event Website" section (else upgrade nudge, like Sinag+
polls). First-run **wizard** (mirrors `/start`): cover → story → schedule
→ venue/map → gallery → seating import → RSVP options → FAQ/entourage/
good-to-know → **Publish**. Then an always-editable section editor
(show/hide + reorder, Preview, Publish/Unpublish), prenup/hero uploader
(presigned R2), seat import (CSV upload + Excel paste), RSVP list + CSV
export.

**Guardrail:** `dashboard.html` is ~4,300 lines, `type=module`. Grep for
any helper/const name before declaring it — a duplicate silently blanks
the page (commit 992872b).

## 6. Per-event-type presets

Server-side `EVENT_TYPE_PRESETS` map → default enabled sections, default
section labels, tone. Applied at first-run wizard; fully host-overridable
after. `events.couple_names` is generic; label swaps Couple / Celebrant /
Honoree / Company / Family. Theme auto from `event_type` via existing
`data-theme`. Wedding/Debut, Birthday/7th, Baptism (godparents central),
Reunion (seating by family/batch), Corporate (agenda/speakers, neutral
tone) ship in V1. **Memorial → V2** (sensitive tone needs deliberate
copy; also retired as an active category per PRODUCT.md §6).

## 7. Phasing

- **V1 (this build):** everything in §1–§6 above.
- **V2 (parked):** Memorial preset; AI concierge + plain-text knowledge
  blob (native `fetch` not SDK, Haiku, rate-limited, prompt-cached,
  strictly grounded — *not* RAG); RSVP analytics; manual seat editor
  polish.
- **V3 (Hiraya):** custom domains / subdomains (the `customDomain` flag
  is already Hiraya-only).

## 8. Build order

1. **Migration** — `database.js` MIGRATIONS + `schema.sql` mirror.
2. **Backend** — `routes/event-site.js`, register in `server.js`, add
   `/e/:slug` HTML route with OG/theme/noindex injection.
3. **Frontend** — `event-site.html` + its JS module.
4. **Dashboard** — "Event Website" wizard + editor, plan-gated.
5. **Docs** — update `PRODUCT.md` (new surface).

Commit + push after each step (standing rule).
