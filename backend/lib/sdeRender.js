/**
 * SDE render orchestrator — shared between the manual POST
 * /sde/generate route and the auto-trigger that fires on upload-window
 * close (reactions.js hot path).
 *
 * Originally inline in routes/sde.js; lifted here so the auto-trigger
 * can reuse the exact same path without copy-pasting the curator →
 * music → invoke → upsert sequence. Errors are surfaced as
 * SdeRenderError with .code + .statusCode so the manual route can map
 * them straight to HTTP responses and the auto-trigger can log them.
 */

import { runCurator, SELECT_DEFAULTS } from './sdeSelect.js';
import { triggerSdeRender }            from './sdeRenderInvoke.js';

// Strip the R2 public host so the Lambda gets a bucket key, not a URL.
// Returns null for foreign hosts (shouldn't happen for R2-backed media,
// but failing soft is better than passing a half-key into the Lambda).
export function r2KeyFromUrl(value) {
  if (!value) return null;
  const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
  const str = String(value);
  if (str.startsWith(base + '/')) return str.slice(base.length + 1);
  if (!/^https?:\/\//i.test(str)) return str.replace(/^\/+/, '');
  return null;
}

// What R2 key should the Lambda download for this clip? Videos prefer
// the transcoded mp4; photos use the original upload (Ken Burns wants
// headroom).
export function clipKey(row) {
  if (row.file_type === 'video') {
    return row.compressed_key || row.original_key || r2KeyFromUrl(row.file_url);
  }
  return row.original_key || r2KeyFromUrl(row.file_url);
}

// "May 18, 2026 · Tagaytay" / "May 18, 2026" / "Tagaytay" / null —
// whichever pieces the event actually has. Asia/Manila locale because
// every customer event is local; the timezone is non-negotiable for
// "today's" SDE so we don't shift the date in a UTC render window.
function formatSubtitle(eventDate, venue) {
  let datePart = null;
  if (eventDate) {
    const d = eventDate instanceof Date ? eventDate : new Date(eventDate);
    if (!Number.isNaN(d.getTime())) {
      datePart = d.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
      });
    }
  }
  const venuePart = (venue || '').trim() || null;
  return [datePart, venuePart].filter(Boolean).join(' · ') || null;
}

// Music chain: event's custom upload → curated playlist lead → baked
// default → null (silent). Returns the R2 key + a track_id pointer
// (for event_sde.track_id when we picked from music_tracks).
async function pickMusicForRender(fastify, eventId) {
  const { rows: own } = await fastify.db.query(
    `SELECT id, r2_key, file_url
       FROM music_tracks
      WHERE event_id = $1
      ORDER BY position ASC, created_at ASC
      LIMIT 1`,
    [eventId],
  );
  if (own.length) {
    const key = own[0].r2_key || r2KeyFromUrl(own[0].file_url);
    if (key) return { audioKey: key, trackId: own[0].id };
  }

  const { rows: ev } = await fastify.db.query(
    `SELECT music_enabled, music_playlist_id FROM events WHERE id = $1`,
    [eventId],
  );
  const event = ev[0] || {};
  if (event.music_enabled !== false && event.music_playlist_id) {
    const { rows: pl } = await fastify.db.query(
      `SELECT id, r2_key, file_url
         FROM music_tracks
        WHERE playlist_id = $1 AND event_id IS NULL
        ORDER BY position ASC, created_at ASC
        LIMIT 1`,
      [event.music_playlist_id],
    );
    if (pl.length) {
      const key = pl[0].r2_key || r2KeyFromUrl(pl[0].file_url);
      if (key) return { audioKey: key, trackId: pl[0].id };
    }
  }

  const fallback = process.env.SDE_DEFAULT_AUDIO_KEY;
  if (fallback) return { audioKey: fallback, trackId: null };

  return { audioKey: null, trackId: null };
}

/**
 * Distinct error class so callers can branch cleanly (HTTP status code
 * baked in for the route; .code stable for telemetry). Throwing rather
 * than returning unions keeps the success path readable.
 */
export class SdeRenderError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name       = 'SdeRenderError';
    this.code       = code;
    this.statusCode = statusCode;
  }
}

/**
 * Run one render kickoff. Idempotent at the row level (debounced) so
 * the manual and auto paths can fire concurrently without doubling up.
 *
 *   1. Reject if event_sde.status ∈ {queued, rendering}.
 *   2. Curate clips (request-time only — never on the wall hot path
 *      directly; the wall poll calls this fire-and-forget once per
 *      event-window-close, so the cost is amortized to one curator run).
 *   3. Pick music via the documented chain.
 *   4. Build the Lambda payload (text-card path, drawtext-rendered).
 *   5. Async-invoke the SDE Lambda.
 *   6. Upsert event_sde to 'queued' — `auto_rendered` reflects the path
 *      that fired so we can tell manual vs auto in analytics.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{id: string, slug: string, couple_names?: string, event_date?: Date|string, venue?: string}} event
 * @param {{requested_by_user_id?: string|null, auto_rendered?: boolean}} [opts]
 * @returns {Promise<{status: 'queued', clip_count: number, has_audio: boolean, track_id: string|null}>}
 * @throws {SdeRenderError}
 */
export async function kickOffRender(fastify, event, opts = {}) {
  const { requested_by_user_id = null, auto_rendered = false } = opts;

  // 1. Debounce
  const { rows: existing } = await fastify.db.query(
    `SELECT status FROM event_sde WHERE event_id = $1`,
    [event.id],
  );
  const currentStatus = existing[0]?.status;
  if (currentStatus === 'queued' || currentStatus === 'rendering') {
    throw new SdeRenderError(
      'sde_in_flight',
      'A render is already in progress for this event.',
      409,
    );
  }

  // 2. Curator
  let curated;
  try {
    curated = await runCurator(fastify, event.id);
  } catch (err) {
    throw new SdeRenderError('curator_failed', err.message || 'Curator failed', 503);
  }
  if (!curated.ordered.length) {
    throw new SdeRenderError(
      'sde_no_clips',
      'No clips available yet. Wait for guest uploads first.',
      422,
    );
  }

  // 3. Clip payload — drop rows we can't resolve to an R2 key (defensive:
  //    clipKey returning null means a foreign-host or never-uploaded row,
  //    which would crash the Lambda download).
  const clips = curated.ordered
    .map(row => ({
      key:           clipKey(row),
      type:          row.file_type,
      dur:           row.file_type === 'video' ? SELECT_DEFAULTS.videoSec : SELECT_DEFAULTS.photoSec,
      createdAt:     row.created_at ?? new Date().toISOString(),
      reactionCount: row.reaction_count ?? 0,
      isPinned:      row.sde_pinned ?? false,
    }))
    .filter(c => c.key);
  if (!clips.length) {
    throw new SdeRenderError(
      'sde_no_clips',
      'Selected clips are missing storage keys. Re-upload and try again.',
      422,
    );
  }

  // 4. Music + text cards
  const { audioKey, trackId } = await pickMusicForRender(fastify, event.id);
  const title       = (event.couple_names || '').trim() || null;
  const subtitle    = formatSubtitle(event.event_date, event.venue);
  const endcardText = 'Thank you for celebrating with us.';

  // Cover photo from the Event Website — used by the Lambda as the
  // blurred-darkened background for title + endcard. Looked up here
  // (one cheap row) instead of demanding callers thread it through;
  // not all callers (auto-render trigger, dashboard fallback) have
  // the column already in scope. Null is fine: Lambda falls back to
  // tinted-bg cards.
  let coverImageUrl = null;
  try {
    const { rows: coverRows } = await fastify.db.query(
      `SELECT cover_photo_url FROM events WHERE id = $1`,
      [event.id],
    );
    coverImageUrl = (coverRows[0]?.cover_photo_url || '').trim() || null;
  } catch (err) {
    fastify.log?.warn?.({ err, event_id: event.id }, '[sde] cover_photo_url lookup failed; skipping');
  }

  const outKey = `sde/${event.id}/sde-${Date.now()}.mp4`;
  const payload = {
    eventId:      event.id,
    slug:         event.slug,
    clips,
    audioKey,
    title,
    subtitle,
    endcardText,
    coverImageUrl,        // optional; Lambda blurs + darkens it as card bg
    titleCardKey: null,   // text path wins; PNG fields kept null
    endcardKey:   null,
    outKey,
  };

  // 5. Async-invoke the Lambda
  try {
    await triggerSdeRender(payload);
  } catch (err) {
    throw new SdeRenderError(
      'sde_invoke_failed',
      err.message || 'Could not start the render.',
      502,
    );
  }

  // 6. Upsert. Preserves prior video_url/poster_url on conflict so the
  //    dashboard keeps showing the last good render while the new one
  //    is in flight. auto_rendered records which path triggered.
  await fastify.db.query(
    `INSERT INTO event_sde
       (event_id, status, clip_count, track_id, requested_by_user_id,
        auto_rendered, error_message, updated_at)
     VALUES ($1, 'queued', $2, $3, $4, $5, NULL, NOW())
     ON CONFLICT (event_id) DO UPDATE
       SET status               = 'queued',
           clip_count           = EXCLUDED.clip_count,
           track_id             = EXCLUDED.track_id,
           requested_by_user_id = EXCLUDED.requested_by_user_id,
           auto_rendered        = EXCLUDED.auto_rendered,
           error_message        = NULL,
           updated_at           = NOW()`,
    [event.id, clips.length, trackId, requested_by_user_id, auto_rendered],
  );

  return {
    status:     'queued',
    clip_count: clips.length,
    has_audio:  !!audioKey,
    track_id:   trackId,
  };
}
