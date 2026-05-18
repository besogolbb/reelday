/**
 * Same Day Edit — owner routes (Batch 1: selection only, no render).
 *
 *   GET   /api/events/:slug/sde         — status + curated preview
 *   PATCH /api/events/:slug/sde/clips   — toggle one clip pin/exclude
 *
 * The Curator (lib/sdeSelect.js) runs only here, owner-authed,
 * request-time — never on the live wall. GET returns 200 even when the
 * plan lacks `sde` so the dashboard can render the upsell card (same
 * shape as the music-uploads endpoint). PATCH is hard-gated.
 */

import { resolvePlan } from '../lib/plans.js';
import { runCurator, SELECT_DEFAULTS } from '../lib/sdeSelect.js';
import { triggerSdeRender } from '../lib/sdeRenderInvoke.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Strip the R2 public host so the Lambda gets a bucket key, not a URL.
// Returns null for foreign hosts (shouldn't happen for R2-backed media,
// but failing soft is better than passing a half-key into the Lambda).
function r2KeyFromUrl(value) {
  if (!value) return null;
  const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
  const str = String(value);
  if (str.startsWith(base + '/')) return str.slice(base.length + 1);
  if (!/^https?:\/\//i.test(str)) return str.replace(/^\/+/, '');
  return null;
}

// What R2 key should the Lambda download for this clip? Videos prefer the
// transcoded mp4; photos use the original upload (Ken Burns wants headroom).
function clipKey(row) {
  if (row.file_type === 'video') {
    return row.compressed_key || row.original_key || r2KeyFromUrl(row.file_url);
  }
  return row.original_key || r2KeyFromUrl(row.file_url);
}

// Music chain: event's custom upload → curated playlist lead → baked
// default → null (silent). Returns the R2 key + a track_id pointer (for
// event_sde.track_id when we picked from music_tracks).
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

export default async function sdeRoutes(fastify) {
  async function loadOwnedEvent(slug, request, reply) {
    if (!request.user?.id) {
      reply.status(401).send({ error: true, message: 'Authentication required' });
      return null;
    }
    const { rows } = await fastify.db.query(
      `SELECT e.id, e.slug, e.is_active, e.user_id, e.plan,
              e.couple_names, e.event_date, e.venue,
              u.subscription_tier
         FROM events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.slug = $1`,
      [slug],
    );
    if (!rows.length || rows[0].is_active === false) {
      reply.status(404).send({ error: true, message: 'Event not found' });
      return null;
    }
    const event = rows[0];
    if (event.user_id !== request.user.id) {
      reply.status(403).send({ error: true, message: 'Not your event' });
      return null;
    }
    // Per-event tier (events.plan first, subscription_tier legacy fallback) —
    // the locked rule, consistent with reactions.js / music.js.
    const plan = resolvePlan(event.plan || event.subscription_tier || 'tala');
    return { event, plan, sdeUnlocked: !!plan.features?.sde };
  }

  function pickThumb(row) {
    if (row.file_type === 'video') {
      return row.poster_url || row.pre_thumb_url || row.thumbnail_url || row.file_url;
    }
    return row.thumbnail_url || row.file_url;
  }

  // GET — status + curated preview. 200 even when locked so the
  // dashboard can render the upsell (mirrors the music uploads route).
  fastify.get('/events/:slug/sde', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadOwnedEvent(request.params.slug, request, reply);
    if (!ctx) return;
    const { event, plan, sdeUnlocked } = ctx;

    reply.header('Cache-Control', 'no-store');

    if (!sdeUnlocked) {
      return {
        sde_unlocked: false, plan: plan.id, status: 'locked',
        clips: [], summary: null, sde: null,
      };
    }

    const { rows: sdeRows } = await fastify.db.query(
      `SELECT status, video_url, poster_url, duration_s, clip_count,
              error_message, rendered_at, updated_at
         FROM event_sde WHERE event_id = $1`,
      [event.id],
    );
    const sde = sdeRows[0] || { status: 'idle' };

    let curated;
    try {
      curated = await runCurator(fastify, event.id);
    } catch (err) {
      request.log.error({ err: err.message, event_id: event.id }, 'sde curator failed');
      return reply.status(503).send({
        error: true, code: 'curator_failed',
        message: 'Could not build the preview right now. Try again.',
      });
    }

    const { rows, selectedIds, ordered, summary } = curated;
    const orderPos = new Map(ordered.map((r, i) => [r.id, i]));

    const clips = rows.map(r => ({
      id:             r.id,
      type:           r.file_type,
      thumb:          pickThumb(r),
      uploader:       r.uploader_name || null,
      created_at:     r.created_at,
      score:          r.score,
      reaction_count: r.reaction_count,
      pinned:         r.sde_pinned,
      excluded:       r.sde_excluded,
      selected:       selectedIds.has(r.id),
      order:          orderPos.has(r.id) ? orderPos.get(r.id) : null,
    }));
    // Grid order: selected first (in reel order), then the rest by
    // recency so the host can scan what is NOT making the cut.
    clips.sort((a, b) => {
      if (a.selected && b.selected) return a.order - b.order;
      if (a.selected) return -1;
      if (b.selected) return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    return {
      sde_unlocked: true,
      plan: plan.id,
      status: sde.status || 'idle',
      sde: sde.video_url ? {
        video_url:  sde.video_url,
        poster_url: sde.poster_url,
        duration_s: sde.duration_s,
        rendered_at: sde.rendered_at,
      } : null,
      summary,
      clips,
    };
  });

  // PATCH — toggle one clip's pin/exclude state. Pinned and excluded
  // are mutually exclusive by construction. Hard-gated.
  fastify.patch('/events/:slug/sde/clips', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadOwnedEvent(request.params.slug, request, reply);
    if (!ctx) return;
    if (!ctx.sdeUnlocked) {
      return reply.status(403).send({
        error: true, code: 'sde_locked',
        message: 'Same Day Edit is a Dalisay plan feature.',
      });
    }

    const { id, state } = request.body ?? {};
    if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
      return reply.status(400).send({ error: true, message: 'Valid clip id required' });
    }
    if (!['pinned', 'excluded', 'neutral'].includes(state)) {
      return reply.status(400).send({ error: true, message: 'state must be pinned|excluded|neutral' });
    }

    const { rows } = await fastify.db.query(
      `UPDATE uploads
          SET sde_pinned   = ($2 = 'pinned'),
              sde_excluded = ($2 = 'excluded')
        WHERE id = $1::uuid AND event_id = $3
        RETURNING id, sde_pinned, sde_excluded`,
      [id, state, ctx.event.id],
    );
    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Clip not found for this event' });
    }
    return { id: rows[0].id, pinned: rows[0].sde_pinned, excluded: rows[0].sde_excluded };
  });

  // POST — owner clicks "Generate". Debounced at the row level (reject if
  // a render is already queued or rendering). Runs the Curator, picks
  // music, async-invokes the SDE Lambda, and parks the row at 'queued';
  // the sde-ready webhook flips it to 'ready' or 'error'. Title/endcards
  // are passed as text fields — the Lambda renders them via drawtext
  // (no PNG generation in the backend; see SDE-HANDOVER §"Locked
  // decisions").
  fastify.post('/events/:slug/sde/generate', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadOwnedEvent(request.params.slug, request, reply);
    if (!ctx) return;
    if (!ctx.sdeUnlocked) {
      return reply.status(403).send({
        error: true, code: 'sde_locked',
        message: 'Same Day Edit is a Dalisay plan feature.',
      });
    }

    // Debounce: cheap row read before doing curator/lambda work.
    const { rows: existing } = await fastify.db.query(
      `SELECT status FROM event_sde WHERE event_id = $1`,
      [ctx.event.id],
    );
    const currentStatus = existing[0]?.status;
    if (currentStatus === 'queued' || currentStatus === 'rendering') {
      return reply.status(409).send({
        error: true, code: 'sde_in_flight',
        message: 'A render is already in progress for this event.',
        status: currentStatus,
      });
    }

    let curated;
    try {
      curated = await runCurator(fastify, ctx.event.id);
    } catch (err) {
      request.log.error({ err: err.message, event_id: ctx.event.id }, 'sde curator failed (generate)');
      return reply.status(503).send({
        error: true, code: 'curator_failed',
        message: 'Could not curate the reel right now. Try again.',
      });
    }
    if (!curated.ordered.length) {
      return reply.status(422).send({
        error: true, code: 'sde_no_clips',
        message: 'No clips available yet. Wait for guest uploads first.',
      });
    }

    // Curator rows → Lambda payload. Drop any clip we can't resolve to
    // an R2 key (defensive: clipKey returning null means a foreign-host
    // or never-uploaded row, which would crash the Lambda download).
    const clips = curated.ordered
      .map(row => ({
        key:  clipKey(row),
        type: row.file_type,
        dur:  row.file_type === 'video' ? SELECT_DEFAULTS.videoSec : SELECT_DEFAULTS.photoSec,
      }))
      .filter(c => c.key);

    if (!clips.length) {
      return reply.status(422).send({
        error: true, code: 'sde_no_clips',
        message: 'Selected clips are missing storage keys. Re-upload and try again.',
      });
    }

    const { audioKey, trackId } = await pickMusicForRender(fastify, ctx.event.id);

    const outKey = `sde/${ctx.event.id}/sde-${Date.now()}.mp4`;
    const payload = {
      eventId:      ctx.event.id,
      slug:         ctx.event.slug,
      clips,
      audioKey,
      titleCardKey: null, // drawtext path lands in a follow-up commit
      endcardKey:   null,
      outKey,
    };

    try {
      await triggerSdeRender(payload);
    } catch (err) {
      request.log.error({ err: err.message, event_id: ctx.event.id }, 'sde lambda invoke failed');
      return reply.status(502).send({
        error: true, code: 'sde_invoke_failed',
        message: 'Could not start the render. Try again in a minute.',
      });
    }

    // Upsert to 'queued'. We deliberately leave video_url/poster_url/
    // duration_s/rendered_at untouched on conflict so the dashboard can
    // keep showing the last good render while the new one is in flight.
    await fastify.db.query(
      `INSERT INTO event_sde
         (event_id, status, clip_count, track_id, requested_by_user_id,
          error_message, updated_at)
       VALUES ($1, 'queued', $2, $3, $4, NULL, NOW())
       ON CONFLICT (event_id) DO UPDATE
         SET status               = 'queued',
             clip_count           = EXCLUDED.clip_count,
             track_id             = EXCLUDED.track_id,
             requested_by_user_id = EXCLUDED.requested_by_user_id,
             error_message        = NULL,
             updated_at           = NOW()`,
      [ctx.event.id, clips.length, trackId, request.user.id],
    );

    return {
      ok:         true,
      status:     'queued',
      clip_count: clips.length,
      has_audio:  !!audioKey,
    };
  });
}
