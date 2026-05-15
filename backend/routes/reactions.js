/**
 * Wall reactions — guests tap an emoji on the upload page, the wall
 * floats it up over the current slide.
 *
 * Public, no auth: identity is the X-Guest-Id token + a guest_name
 * captured at react-time. The rate-limiter is keyed on the same
 * X-Guest-Id so guests on shared venue WiFi each get their own bucket.
 *
 * Plan-gated: reactions feature flag (Sinag and above per
 * backend/lib/plans.js).
 */

import { resolvePlan } from '../lib/plans.js';

// Closed allow-list. Stops anyone from POSTing arbitrary unicode that
// would either break the wall layout or be used as a hidden channel.
// Skewed toward positive / celebration emoji — events are happy moments,
// no need for the angry / sad end of the spectrum.
const ALLOWED_EMOJI = [
  '❤️', '😂', '🔥', '👏', '💃', '🙏',
  '🥰', '✨', '🎉', '🥹', '🌹', '💖',
];

export default async function reactionsRoutes(fastify) {
  // Tighter bucket for the write side — each row is a DB insert and
  // immediately fans out to every connected wall on its next poll.
  const REACT_WRITE_LIMIT = {
    rateLimit: {
      max: 60,                 // ~1/sec sustained per device
      timeWindow: '1 minute',
      keyGenerator: fastify.limiterKey,
      errorResponseBuilder: () => fastify.friendlyRateLimit,
    },
  };

  // Slug → { id, plan-allows-reactions } memo. Reaction bursts hammered
  // this lookup once per write (events JOIN users); during a storm the
  // pool drained and other events' wall GETs queued behind it. Cache
  // for a few seconds so plan/tier changes still propagate quickly.
  const EVENT_CACHE_TTL_MS = 5_000;
  const eventCache = new Map(); // slug -> { expires, event | null }

  async function loadEventForReactions(slug, reply) {
    const now = Date.now();
    const hit = eventCache.get(slug);
    if (hit && hit.expires > now) {
      if (!hit.event) {
        reply.status(404).send({ error: true, message: 'Event not found' });
        return null;
      }
      if (!hit.allowed) {
        reply.status(403).send({
          error: true,
          code: 'reactions_locked',
          message: 'Reactions need a Sinag plan or higher.',
        });
        return null;
      }
      return hit.event;
    }

    const { rows } = await fastify.db.query(
      `SELECT e.id, e.is_active, e.user_id, u.subscription_tier
         FROM events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.slug = $1`,
      [slug],
    );
    if (!rows.length || rows[0].is_active === false) {
      eventCache.set(slug, { expires: now + EVENT_CACHE_TTL_MS, event: null });
      reply.status(404).send({ error: true, message: 'Event not found' });
      return null;
    }
    const event = rows[0];
    const plan  = resolvePlan(event.subscription_tier || 'tala');
    const allowed = !!plan.features?.reactions;
    eventCache.set(slug, { expires: now + EVENT_CACHE_TTL_MS, event, allowed });
    if (!allowed) {
      reply.status(403).send({
        error: true,
        code: 'reactions_locked',
        message: 'Reactions need a Sinag plan or higher.',
      });
      return null;
    }
    return event;
  }

  // POST /api/reactions/:slug — record a single reaction.
  fastify.post('/reactions/:slug', { config: REACT_WRITE_LIMIT }, async (request, reply) => {
    const { slug } = request.params;
    const { emoji, upload_id, guest_name } = request.body ?? {};

    if (!ALLOWED_EMOJI.includes(emoji)) {
      return reply.status(400).send({ error: true, message: 'Invalid emoji' });
    }
    const name = (guest_name || '').trim();
    if (!name) {
      return reply.status(400).send({ error: true, message: 'Guest name is required to react' });
    }
    if (name.length > 120) {
      return reply.status(400).send({ error: true, message: 'Name too long' });
    }

    const event = await loadEventForReactions(slug, reply);
    if (!event) return;

    const guestId = String(request.headers['x-guest-id'] || request.ip).slice(0, 64);

    // upload_id is optional; verify it belongs to this event inline so
    // the whole write is a single round-trip — under reaction bursts the
    // old SELECT+INSERT pattern was draining the pool and freezing other
    // events' wall GETs.
    const { rows: inserted } = await fastify.db.query(
      `INSERT INTO reactions (event_id, upload_id, guest_id, guest_name, emoji)
       VALUES (
         $1,
         (SELECT id FROM uploads WHERE id = $2::uuid AND event_id = $1),
         $3, $4, $5
       )
       RETURNING id, created_at`,
      [event.id, upload_id || null, guestId, name, emoji],
    );
    return reply.status(201).send({ id: inserted[0].id, created_at: inserted[0].created_at });
  });

  // GET /api/reactions/:slug?since=<iso> — wall polls this on a tick.
  // Returns only reactions newer than `since` so payloads stay tiny.
  // No plan gate on read so the wall on a downgraded event still
  // empties its queue (returns []).
  fastify.get('/reactions/:slug', async (request, reply) => {
    const { slug } = request.params;
    const since = request.query?.since;

    try {
      let sinceTs;
      try {
        sinceTs = since ? new Date(since) : new Date(Date.now() - 5 * 60 * 1000);
      } catch {
        sinceTs = new Date(Date.now() - 5 * 60 * 1000);
      }
      if (Number.isNaN(sinceTs.getTime())) {
        sinceTs = new Date(Date.now() - 5 * 60 * 1000);
      }

      // Reuse the POST handler's event cache (slug → {event, expires}) to skip
      // a DB round-trip on the hot read path. Cache miss falls back to a single
      // JOIN query. Wall polls every 1s — without this it was 2 DB queries/poll.
      let eventId;
      const cachedEv = eventCache.get(slug);
      if (cachedEv && cachedEv.expires > Date.now()) {
        if (!cachedEv.event) {
          return reply.status(404).send({ error: true, message: 'Event not found' });
        }
        eventId = cachedEv.event.id;
      } else {
        const { rows: evRows } = await fastify.db.query(
          'SELECT id FROM events WHERE slug = $1 AND is_active = true',
          [slug],
        );
        if (!evRows.length) {
          eventCache.set(slug, { expires: Date.now() + EVENT_CACHE_TTL_MS, event: null });
          return reply.status(404).send({ error: true, message: 'Event not found' });
        }
        eventId = evRows[0].id;
        // Warm the cache entry if missing (POST path may not have run yet).
        if (!cachedEv) {
          eventCache.set(slug, { expires: Date.now() + EVENT_CACHE_TTL_MS, event: evRows[0], allowed: true });
        }
      }

      const { rows } = await fastify.db.query(
        `SELECT id, emoji, guest_name, upload_id, created_at
           FROM reactions
          WHERE event_id = $1 AND created_at > $2
          ORDER BY created_at ASC
          LIMIT 200`,
        [eventId, sinceTs],
      );

      // Continue with the rest of the original handler — old code path picks up below.
      // (Wrapping the body in try/catch lets us log the *exact* error instead of letting
      //  the global handler swallow it as a generic "Internal server error".)
      reply.__reactions_rows = rows;
    } catch (err) {
      request.log.error({
        where: 'GET /api/reactions/:slug',
        slug,
        since,
        errName: err?.name,
        errMessage: err?.message,
        errCode: err?.code,
        errDetail: err?.detail,
        stack: err?.stack,
      }, 'reactions.get failed');
      return reply.status(500).send({ error: true, message: 'reactions read failed' });
    }
    const rows = reply.__reactions_rows;

    reply.header('Cache-Control', 'no-store');
    return { reactions: rows, server_time: new Date().toISOString() };
  });
}
