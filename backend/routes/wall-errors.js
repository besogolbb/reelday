/**
 * Wall playback errors — when a video on the wall fails to load
 * (broken stream, R2 hiccup, codec the browser can't play), the wall
 * skips it and POSTs a beacon here so the host's dashboard can flag
 * the affected uploads.
 *
 * State lives in memory only (cleared on restart). Per-event ring of
 * the most recent failures keeps the footprint tiny.
 */

const MAX_PER_EVENT = 50;
// eventId -> Map<uploadId, { count, last_reason, last_at }>
const buffers = new Map();

function recordError(eventId, uploadId, reason) {
  let m = buffers.get(eventId);
  if (!m) { m = new Map(); buffers.set(eventId, m); }
  const existing = m.get(uploadId);
  if (existing) {
    existing.count       += 1;
    existing.last_reason  = reason;
    existing.last_at      = new Date().toISOString();
    // Re-insert so the entry is the most recently touched (Map preserves insertion order).
    m.delete(uploadId);
    m.set(uploadId, existing);
  } else {
    m.set(uploadId, { count: 1, last_reason: reason, last_at: new Date().toISOString() });
  }
  // Trim oldest if we exceed the cap.
  while (m.size > MAX_PER_EVENT) {
    const oldestKey = m.keys().next().value;
    m.delete(oldestKey);
  }
}

function listErrors(eventId) {
  const m = buffers.get(eventId);
  if (!m) return [];
  return Array.from(m.entries()).map(([upload_id, v]) => ({ upload_id, ...v }));
}

function clearErrors(eventId, uploadIds) {
  const m = buffers.get(eventId);
  if (!m) return;
  if (!uploadIds || !uploadIds.length) { buffers.delete(eventId); return; }
  uploadIds.forEach(id => m.delete(id));
  if (!m.size) buffers.delete(eventId);
}

export default async function wallErrorsRoutes(fastify) {
  const BEACON_LIMIT = {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute',
      keyGenerator: fastify.limiterKey,
      errorResponseBuilder: () => fastify.friendlyRateLimit,
    },
  };

  // Wall posts here when a video fails to play. Public on purpose —
  // the wall has no auth and we don't want to lose error signal because
  // of token plumbing. Rate-limited so a stuck loop can't flood us.
  fastify.post('/events/:slug/wall-errors', { config: BEACON_LIMIT }, async (request, reply) => {
    const slug = request.params.slug;
    const { rows } = await fastify.db.query(
      'SELECT id FROM events WHERE slug = $1 AND is_active = true',
      [slug],
    );
    if (!rows.length) return reply.status(404).send({ error: true, message: 'Event not found' });

    const uploadId = (request.body?.upload_id || '').toString().slice(0, 64);
    const reason   = (request.body?.reason    || 'video_error').toString().slice(0, 80);
    if (!uploadId) return reply.status(400).send({ error: true, message: 'upload_id required' });

    recordError(rows[0].id, uploadId, reason);
    return { success: true };
  });

  // Host polls this from the dashboard to surface a banner + tile badges.
  fastify.get('/events/:slug/wall-errors', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { rows } = await fastify.db.query(
      'SELECT id, user_id FROM events WHERE slug = $1',
      [request.params.slug],
    );
    if (!rows.length)                         return reply.status(404).send({ error: true, message: 'Event not found' });
    if (rows[0].user_id !== request.user?.id) return reply.status(403).send({ error: true, message: 'Not your event' });

    const items = listErrors(rows[0].id);
    return { items, count: items.length };
  });

  // Lets the host dismiss the banner / clear individual entries.
  fastify.delete('/events/:slug/wall-errors', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { rows } = await fastify.db.query(
      'SELECT id, user_id FROM events WHERE slug = $1',
      [request.params.slug],
    );
    if (!rows.length)                         return reply.status(404).send({ error: true, message: 'Event not found' });
    if (rows[0].user_id !== request.user?.id) return reply.status(403).send({ error: true, message: 'Not your event' });

    const ids = Array.isArray(request.body?.upload_ids) ? request.body.upload_ids : null;
    clearErrors(rows[0].id, ids);
    return { success: true };
  });
}
