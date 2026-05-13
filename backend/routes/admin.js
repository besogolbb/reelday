import { timingSafeEqual } from 'crypto';

// Admin gate: every /admin/* route must present `Authorization: Bearer <ADMIN_TOKEN>`
// matching the env var. Compared via timingSafeEqual to defeat timing oracles.
// We deliberately do NOT use the user-JWT system here so a compromised host
// account can't escalate to admin without also stealing the env secret.
function requireAdmin(request, reply, done) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) {
    reply.status(503).send({ error: true, message: 'Admin disabled (no ADMIN_TOKEN configured)' });
    return;
  }
  const header = request.headers.authorization || '';
  const got = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.status(401).send({ error: true, message: 'Admin authentication required' });
    return;
  }
  done();
}

export default async function adminRoutes(fastify) {
  // Apply the admin gate to every route in this plugin.
  fastify.addHook('preHandler', requireAdmin);

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

  // ── Users ───────────────────────────────────────────────
  // Valid subscription tiers we'll accept for plan overrides. Kept in
  // step with backend/lib/plans.js — the actual feature gating still
  // reads from that file via resolvePlan().
  const VALID_TIERS = new Set(['tala', 'sinag', 'dalisay', 'hiraya']);

  // GET /api/admin/users — list every registered user with their event
  // count, plan tier, verified / active flags. Single query joins events
  // so the admin table loads in one round-trip.
  fastify.get('/admin/users', async () => {
    const { rows } = await fastify.db.query(
      `SELECT u.id, u.email, u.full_name, u.phone,
              u.is_verified, u.is_active,
              u.subscription_tier, u.subscription_expires_at,
              u.created_at,
              COUNT(e.id) FILTER (WHERE e.is_active IS NOT FALSE)::int AS active_event_count,
              COUNT(e.id)::int AS total_event_count
         FROM users u
    LEFT JOIN events e ON e.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
    );
    return { users: rows };
  });

  // POST /api/admin/users/:id/plan — manually set a user's subscription
  // tier. Useful for refunds, comped events, or fixing payments that came
  // in outside the normal PayMongo flow. Does NOT touch any payments row;
  // pair with a manual payment entry if you want the audit trail.
  fastify.post('/admin/users/:id/plan', async (request, reply) => {
    const { id } = request.params;
    const tier = String(request.body?.tier || '').toLowerCase();
    if (!VALID_TIERS.has(tier)) {
      return reply.status(400).send({ error: true, message: `Invalid tier. Allowed: ${[...VALID_TIERS].join(', ')}` });
    }
    const { rowCount } = await fastify.db.query(
      'UPDATE users SET subscription_tier = $2 WHERE id = $1',
      [id, tier],
    );
    if (!rowCount) return reply.status(404).send({ error: true, message: 'User not found' });
    return { success: true, tier };
  });

  // POST /api/admin/users/:id/verify — toggle the verified flag without
  // sending an email. Useful when a guest can't receive verification
  // mail (typo, deliverability issue) and you can confirm identity
  // out-of-band.
  fastify.post('/admin/users/:id/verify', async (request, reply) => {
    const { id } = request.params;
    const verified = request.body?.is_verified !== false; // default true
    const { rowCount } = await fastify.db.query(
      'UPDATE users SET is_verified = $2 WHERE id = $1',
      [id, verified],
    );
    if (!rowCount) return reply.status(404).send({ error: true, message: 'User not found' });
    return { success: true, is_verified: verified };
  });

  // POST /api/admin/users/:id/active — toggle the soft-deactivate flag.
  // Inactive users are blocked at login (see auth.js). Their data stays
  // intact so reactivation is a one-click reversal.
  fastify.post('/admin/users/:id/active', async (request, reply) => {
    const { id } = request.params;
    const active = request.body?.is_active !== false; // default true
    const { rowCount } = await fastify.db.query(
      'UPDATE users SET is_active = $2 WHERE id = $1',
      [id, active],
    );
    if (!rowCount) return reply.status(404).send({ error: true, message: 'User not found' });
    return { success: true, is_active: active };
  });
}
