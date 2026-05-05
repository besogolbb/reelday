import { generateQR } from '../utils/qr.js';

function makeSlug(coupleNames) {
  const base = coupleNames
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanum → dash
    .replace(/^-+|-+$/g, '')        // trim leading/trailing dashes
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6); // 4 random chars e.g. "x4k2"
  return `${base}-${suffix}`;
}

export default async function eventRoutes(fastify) {
  // POST /api/events — create a new event
  fastify.post('/events', async (request, reply) => {
    const { couple_names, event_type, event_date, plan, user_id } = request.body ?? {};

    if (!couple_names) {
      return reply.status(400).send({ error: true, message: 'couple_names is required' });
    }

    const slug = makeSlug(couple_names);

    const { rows } = await fastify.db.query(
      `INSERT INTO events (slug, couple_names, event_type, event_date, plan, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [slug, couple_names, event_type ?? 'wedding', event_date ?? null, plan ?? 'libre', user_id ?? null],
    );

    const event = rows[0];
    const qr_code = await generateQR(slug);

    return reply.status(201).send({ event, qr_code });
  });

  // GET /api/events/:slug — fetch event + upload count
  fastify.get('/events/:slug', async (request, reply) => {
    const { slug } = request.params;

    const { rows } = await fastify.db.query(
      'SELECT * FROM events WHERE slug = $1 AND is_active = true',
      [slug],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const event = rows[0];

    const { rows: countRows } = await fastify.db.query(
      'SELECT COUNT(*)::int AS count FROM uploads WHERE event_id = $1 AND is_approved = true',
      [event.id],
    );

    return { event, upload_count: countRows[0].count };
  });

  // GET /api/events/:slug/qr — regenerate QR code
  fastify.get('/events/:slug/qr', async (request, reply) => {
    const { slug } = request.params;

    const { rows } = await fastify.db.query(
      'SELECT id FROM events WHERE slug = $1',
      [slug],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const qr_code = await generateQR(slug);
    return { qr_code };
  });

  // PATCH /api/events/:slug — update event settings
  fastify.patch('/events/:slug', async (request, reply) => {
    const { slug } = request.params;
    const { couple_names, event_date, cover_photo_url, is_active } = request.body ?? {};

    const { rows } = await fastify.db.query(
      `UPDATE events
       SET couple_names    = COALESCE($2, couple_names),
           event_date      = COALESCE($3, event_date),
           cover_photo_url = COALESCE($4, cover_photo_url),
           is_active       = COALESCE($5, is_active)
       WHERE slug = $1
       RETURNING *`,
      [slug, couple_names ?? null, event_date ?? null, cover_photo_url ?? null, is_active ?? null],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    return { event: rows[0] };
  });
}
