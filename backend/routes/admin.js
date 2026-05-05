export default async function adminRoutes(fastify) {
  // GET /api/admin/payments/pending
  fastify.get('/admin/payments/pending', async () => {
    const { rows } = await fastify.db.query(
      `SELECT p.id, p.paymongo_payment_id, p.amount, p.plan, p.status, p.created_at,
              e.couple_names, e.slug, e.is_paid
       FROM payments p
       JOIN events e ON e.id = p.event_id
       WHERE p.status = 'manual_pending'
       ORDER BY p.created_at DESC`,
    );
    return {
      payments: rows.map(r => ({
        ...r,
        gcash_reference: r.paymongo_payment_id?.replace(/^gcash-/, '') ?? null,
      })),
    };
  });

  // GET /api/admin/events
  fastify.get('/admin/events', async () => {
    const { rows } = await fastify.db.query(
      `SELECT e.id, e.slug, e.couple_names, e.event_type, e.plan,
              e.is_paid, e.is_active, e.created_at,
              COUNT(up.id)::int AS upload_count,
              usr.email AS user_email
       FROM events e
       LEFT JOIN uploads  up  ON up.event_id = e.id
       LEFT JOIN users    usr ON usr.id = e.user_id
       GROUP BY e.id, usr.email
       ORDER BY e.created_at DESC`,
    );
    return { events: rows };
  });

  // GET /api/admin/stats
  fastify.get('/admin/stats', async () => {
    const { rows } = await fastify.db.query(
      `SELECT
         COUNT(DISTINCT e.id)::int                                        AS total_events,
         COUNT(DISTINCT e.id) FILTER (WHERE e.is_paid = true)::int       AS paid_events,
         COUNT(p.id) FILTER (WHERE p.status = 'manual_pending')::int     AS pending_payments,
         COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'succeeded'), 0)::int AS total_revenue
       FROM events e
       LEFT JOIN payments p ON p.event_id = e.id`,
    );
    return rows[0];
  });

  // POST /api/admin/payments/verify/:id
  fastify.post('/admin/payments/verify/:id', async (request, reply) => {
    const { id } = request.params;

    const { rows } = await fastify.db.query(
      `WITH verified AS (
         UPDATE payments SET status = 'succeeded'
         WHERE id = $1 AND status = 'manual_pending'
         RETURNING event_id, plan
       )
       UPDATE events SET is_paid = true, plan = verified.plan
       FROM verified
       WHERE events.id = verified.event_id
       RETURNING events.id`,
      [id],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Payment not found or already processed' });
    }

    return { success: true };
  });

  // POST /api/admin/payments/reject/:id
  fastify.post('/admin/payments/reject/:id', async (request, reply) => {
    const { id } = request.params;

    const { rowCount } = await fastify.db.query(
      `UPDATE payments SET status = 'rejected'
       WHERE id = $1 AND status = 'manual_pending'`,
      [id],
    );

    if (!rowCount) {
      return reply.status(404).send({ error: true, message: 'Payment not found or already processed' });
    }

    return { success: true };
  });

  // POST /api/admin/events/:slug/deactivate
  fastify.post('/admin/events/:slug/deactivate', async (request, reply) => {
    const { slug } = request.params;

    const { rowCount } = await fastify.db.query(
      'UPDATE events SET is_active = false WHERE slug = $1',
      [slug],
    );

    if (!rowCount) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    return { success: true };
  });
}
