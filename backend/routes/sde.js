/**
 * Same Day Edit — owner routes.
 *
 *   GET   /api/events/:slug/sde           — status + curated preview + play state
 *   PATCH /api/events/:slug/sde/clips     — toggle one clip pin/exclude
 *   POST  /api/events/:slug/sde/generate  — manually kick off a render
 *   POST  /api/events/:slug/sde/play      — stamp events.sde_play_requested_at
 *                                            (the wall picks this up on its next
 *                                            reactions poll and enters takeover)
 *   POST  /api/events/:slug/sde/stop      — stamp events.sde_play_cleared_at
 *
 * The Curator (lib/sdeSelect.js) runs only here, owner-authed,
 * request-time — never on the live wall. GET returns 200 even when the
 * plan lacks `sde` so the dashboard can render the upsell card (same
 * shape as the music-uploads endpoint). All mutating routes are
 * hard-gated.
 *
 * Render orchestration lives in lib/sdeRender.js (shared with the
 * auto-trigger on upload-window close in routes/reactions.js).
 */

import { resolvePlan }                    from '../lib/plans.js';
import { runCurator }                     from '../lib/sdeSelect.js';
import { kickOffRender, SdeRenderError }  from '../lib/sdeRender.js';

// Cross-route memo: same set spirit as the one in reactions.js (we
// don't share the actual Set across modules because each route file
// has its own closure, and the cost of "fire once per slug per
// process per route" is fine). When the host opens the dashboard
// post-event-close on a slug that no wall ever polled (e.g. small
// venue, no TV), this fallback triggers auto-render anyway.
const autoRenderFiredFromDashboard = new Set();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Active play signal: requested_at set AND (cleared_at is null OR older).
function isPlaying(event) {
  if (!event?.sde_play_requested_at) return false;
  if (!event?.sde_play_cleared_at)   return true;
  return new Date(event.sde_play_cleared_at) < new Date(event.sde_play_requested_at);
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
              e.sde_play_requested_at, e.sde_play_cleared_at,
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

  // GET — status + curated preview + play state. 200 even when locked
  // so the dashboard can render the upsell (mirrors music uploads).
  fastify.get('/events/:slug/sde', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadOwnedEvent(request.params.slug, request, reply);
    if (!ctx) return;
    const { event, plan, sdeUnlocked } = ctx;

    reply.header('Cache-Control', 'no-store');

    if (!sdeUnlocked) {
      return {
        sde_unlocked: false, plan: plan.id, status: 'locked',
        clips: [], summary: null, sde: null, playing: false,
      };
    }

    const { rows: sdeRows } = await fastify.db.query(
      `SELECT status, video_url, poster_url, duration_s, clip_count,
              error_message, rendered_at, auto_rendered, updated_at
         FROM event_sde WHERE event_id = $1`,
      [event.id],
    );
    const sde = sdeRows[0] || { status: 'idle', auto_rendered: false };

    // Auto-render fallback for events with no live wall poll (small
    // venues, host visits dashboard post-close). Mirrors the trigger
    // in routes/reactions.js — fire-and-forget, deduplicated by slug.
    if (!autoRenderFiredFromDashboard.has(event.slug)) {
      const { rows: evWindow } = await fastify.db.query(
        `SELECT upload_window_ends_at FROM events WHERE id = $1`, [event.id],
      );
      const closedAt = evWindow[0]?.upload_window_ends_at;
      if (closedAt && new Date(closedAt) < new Date()) {
        const inFlight = sde.status === 'queued' || sde.status === 'rendering';
        const settled  = sde.status === 'ready'  || sde.auto_rendered === true;
        if (inFlight || settled) {
          autoRenderFiredFromDashboard.add(event.slug);
        } else {
          autoRenderFiredFromDashboard.add(event.slug);
          kickOffRender(fastify, event, { auto_rendered: true })
            .then(result => {
              request.log.info(
                { event_id: event.id, slug: event.slug, clip_count: result.clip_count },
                'sde auto-render fired (dashboard fallback)',
              );
            })
            .catch(err => {
              const terminal = err.code === 'sde_in_flight' || err.code === 'sde_no_clips';
              request.log.warn(
                { err: err.message, code: err.code, event_id: event.id, terminal },
                'sde auto-render failed (dashboard fallback)',
              );
              if (!terminal) autoRenderFiredFromDashboard.delete(event.slug);
            });
        }
      }
    }

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

    // Play state is meaningful only when there's an actual rendered reel
    // to play. The wall will refuse to enter takeover without video_url.
    const playing = isPlaying(event) && sde.status === 'ready' && !!sde.video_url;

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
      playing,
      play_requested_at: playing ? event.sde_play_requested_at : null,
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

  // POST — owner clicks "Generate". Delegates to the shared kickoff
  // helper (also used by the auto-render trigger on upload-window
  // close, see routes/reactions.js). The helper handles debounce,
  // curator, music, Lambda invoke, and event_sde upsert; we just map
  // its SdeRenderError → HTTP.
  fastify.post('/events/:slug/sde/generate', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadOwnedEvent(request.params.slug, request, reply);
    if (!ctx) return;
    if (!ctx.sdeUnlocked) {
      return reply.status(403).send({
        error: true, code: 'sde_locked',
        message: 'Same Day Edit is a Dalisay plan feature.',
      });
    }

    try {
      const result = await kickOffRender(fastify, ctx.event, {
        requested_by_user_id: request.user.id,
        auto_rendered:        false,
      });
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof SdeRenderError) {
        if (err.code === 'sde_in_flight') {
          // Include current status so the dashboard's 409 handler can
          // start polling instead of showing an error pill.
          const { rows } = await fastify.db.query(
            `SELECT status FROM event_sde WHERE event_id = $1`, [ctx.event.id],
          );
          return reply.status(err.statusCode).send({
            error: true, code: err.code, message: err.message,
            status: rows[0]?.status,
          });
        }
        request.log.error({ err: err.message, code: err.code, event_id: ctx.event.id },
                          'sde generate failed');
        return reply.status(err.statusCode).send({
          error: true, code: err.code, message: err.message,
        });
      }
      throw err;
    }
  });

  // POST /sde/play — owner taps "Play on wall". Stamps the request
  // timestamp; the wall picks it up on its next reactions poll (~1 s)
  // and enters fullscreen takeover with event_sde.video_url. Refuses
  // when there's no rendered reel to play.
  fastify.post('/events/:slug/sde/play', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadOwnedEvent(request.params.slug, request, reply);
    if (!ctx) return;
    if (!ctx.sdeUnlocked) {
      return reply.status(403).send({
        error: true, code: 'sde_locked',
        message: 'Same Day Edit is a Dalisay plan feature.',
      });
    }

    const { rows } = await fastify.db.query(
      `SELECT status, video_url FROM event_sde WHERE event_id = $1`,
      [ctx.event.id],
    );
    const sde = rows[0];
    if (!sde || sde.status !== 'ready' || !sde.video_url) {
      return reply.status(409).send({
        error: true, code: 'sde_not_ready',
        message: 'Render a reel first — there’s nothing to play on the wall yet.',
      });
    }

    // Clear cleared_at AND stamp a new requested_at — a fresh request
    // restarts playback even if the wall was already showing the reel
    // (host can re-trigger the moment from the beginning).
    await fastify.db.query(
      `UPDATE events
          SET sde_play_requested_at = NOW(),
              sde_play_cleared_at   = NULL
        WHERE id = $1`,
      [ctx.event.id],
    );
    return { ok: true, playing: true };
  });

  // POST /sde/stop — owner taps "Stop wall". Stamps cleared_at; the
  // wall sees the cleared timestamp newer than requested and exits
  // takeover on its next reactions poll.
  fastify.post('/events/:slug/sde/stop', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadOwnedEvent(request.params.slug, request, reply);
    if (!ctx) return;
    if (!ctx.sdeUnlocked) {
      return reply.status(403).send({
        error: true, code: 'sde_locked',
        message: 'Same Day Edit is a Dalisay plan feature.',
      });
    }

    await fastify.db.query(
      `UPDATE events SET sde_play_cleared_at = NOW() WHERE id = $1`,
      [ctx.event.id],
    );
    return { ok: true, playing: false };
  });

  // POST /sde/wall-finished — PUBLIC, called by the wall iframe when
  // the reel ends (the iframe doesn't loop; one play then auto-return
  // to gallery). Stamps cleared_at so:
  //   - subsequent 1 Hz reactions polls don't re-mount the takeover
  //   - the dashboard's "Stop wall" pill flips back to "Play on wall"
  //     within a poll cycle, no host action needed
  //
  // Validated by requested_at — wall sends the timestamp it just
  // finished playing; server clears only if it still matches the
  // active requested_at. Prevents a slow wall (one that took 30 s
  // to finish after the host already re-triggered) from killing a
  // fresh playback. Race-safe.
  //
  // Public on purpose: walls have no auth. Worst-case griefer with
  // event slug + active requested_at ends a takeover early; host can
  // just re-tap Play. Same trust model as the reactions write path.
  fastify.post('/events/:slug/sde/wall-finished', async (request, reply) => {
    const { slug } = request.params;
    const requestedAt = request.body && request.body.requested_at;
    if (!requestedAt) {
      return reply.status(400).send({
        error: true, code: 'missing_requested_at',
        message: 'requested_at is required.',
      });
    }

    // Conditional UPDATE — only clears if the wall's requested_at still
    // matches the event's. RETURNING tells us whether the clear hit
    // (visibility only; the wall doesn't act on it).
    //
    // ⚠️ Precision footgun: Postgres timestamptz has microsecond
    // precision, JS Date has millisecond precision. The pg driver
    // truncates microseconds on read, so the requested_at the wall
    // echoes back is `.789` while the row in DB has `.789012`. A
    // naive `= $2` comparison ALWAYS misses → UPDATE never runs →
    // dashboard never flips back to "Play on wall". Truncate both
    // sides to milliseconds for a robust round-trip match.
    const { rows } = await fastify.db.query(
      `UPDATE events
          SET sde_play_cleared_at = NOW()
        WHERE slug = $1
          AND date_trunc('milliseconds', sde_play_requested_at)
              = date_trunc('milliseconds', $2::timestamptz)
          AND (sde_play_cleared_at IS NULL
               OR sde_play_cleared_at < sde_play_requested_at)
        RETURNING id`,
      [slug, requestedAt],
    );
    return { ok: true, cleared: rows.length > 0 };
  });
}
