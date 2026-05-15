// In-memory presence tracking: upload-page guests ping every 30s.
// Entries expire after 90s (3 missed pings). No DB writes needed.

const PRESENCE_TTL_MS = 90_000;

// slug → Map<guestId, { name, lastSeen }>
const store = new Map();

function pruneAndGet(slug) {
  const map = store.get(slug);
  if (!map) return [];
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [id, entry] of map) {
    if (entry.lastSeen < cutoff) map.delete(id);
  }
  return [...map.values()];
}

// Called by the uploads GET route so guest_count rides the existing poll response.
export function getCount(slug) {
  return pruneAndGet(slug).length;
}

export default async function presenceRoutes(fastify) {
  // Upload-page heartbeat — called every 30s per guest
  fastify.post('/api/events/:slug/presence', {
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { slug } = request.params;
    const guestId  = (request.headers['x-guest-id'] || '').trim().slice(0, 64);
    if (!guestId) return reply.code(400).send({ error: 'missing guest_id' });

    const { name = '' } = request.body || {};

    const { rows } = await fastify.db.query('SELECT id FROM events WHERE slug = $1', [slug]);
    if (!rows.length) return reply.code(404).send({ error: 'not found' });

    if (!store.has(slug)) store.set(slug, new Map());
    store.get(slug).set(guestId, {
      name:     String(name).trim().slice(0, 120),
      lastSeen: Date.now(),
    });

    return reply.send({ ok: true });
  });

  // Read — wall and dashboard poll this
  fastify.get('/api/events/:slug/presence', async (request, reply) => {
    const { slug }  = request.params;
    const entries   = pruneAndGet(slug);
    const guestNames = entries.map(e => e.name).filter(Boolean);
    return reply.send({ count: entries.length, guests: guestNames });
  });
}
