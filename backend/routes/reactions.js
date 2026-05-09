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

  /**
   * Resolve the event by slug, confirm reactions are allowed under the
   * owner's CURRENT subscription tier (not whatever the event row was
   * created on), and 404/403 cleanly when not.
   */
  async function loadEventForReactions(slug, reply) {
    const { rows } = await fastify.db.query(
      `SELECT e.id, e.is_active, e.user_id, u.subscription_tier
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
    const plan  = resolvePlan(event.subscription_tier || 'tala');
    if (!plan.features?.reactions) {
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

    // upload_id is optional; if provided, verify it belongs to this
    // event so we don't accept reactions tagged to other events.
    let scopedUploadId = null;
    if (upload_id) {
      const { rows } = await fastify.db.query(
        'SELECT id FROM uploads WHERE id = $1 AND event_id = $2',
        [upload_id, event.id],
      );
      if (rows.length) scopedUploadId = upload_id;
    }

    const { rows: inserted } = await fastify.db.query(
      `INSERT INTO reactions (event_id, upload_id, guest_id, guest_name, emoji)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [event.id, scopedUploadId, guestId, name, emoji],
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

    const { rows: eventRows } = await fastify.db.query(
      'SELECT id FROM events WHERE slug = $1 AND is_active = true',
      [slug],
    );
    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }
    const eventId = eventRows[0].id;

    let sinceTs;
    try {
      sinceTs = since ? new Date(since) : new Date(Date.now() - 5 * 60 * 1000);
    } catch {
      sinceTs = new Date(Date.now() - 5 * 60 * 1000);
    }
    if (Number.isNaN(sinceTs.getTime())) {
      sinceTs = new Date(Date.now() - 5 * 60 * 1000);
    }

    const { rows } = await fastify.db.query(
      `SELECT id, emoji, guest_name, upload_id, created_at
         FROM reactions
        WHERE event_id = $1 AND created_at > $2
        ORDER BY created_at ASC
        LIMIT 200`,
      [eventId, sinceTs],
    );

    reply.header('Cache-Control', 'no-store');
    return { reactions: rows, server_time: new Date().toISOString() };
  });
}
