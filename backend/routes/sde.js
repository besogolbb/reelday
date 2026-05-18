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
import { runCurator } from '../lib/sdeSelect.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
}
