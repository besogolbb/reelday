import { timingSafeEqual } from 'crypto';
import { resolvePlan, galleryExpiryFor, uploadWindowEndFor } from '../lib/plans.js';
import { baseSlug, randomSuffix, isSlugCollision } from './events.js';

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
  // Stricter rate limit on admin routes — the global limiter (server.js)
  // bypasses any request carrying an Authorization header, which would
  // leave brute-forcing the ADMIN_TOKEN entirely unthrottled. Key on IP
  // (not the guest-id header) so a single attacker can't open multiple
  // sockets to widen their guess rate. 30/min is generous for legitimate
  // admin work but ruinous for any enumeration attempt.
  fastify.addHook('onRequest', fastify.rateLimit({
    max: 30,
    timeWindow: '1 minute',
    keyGenerator: req => req.ip,
    errorResponseBuilder: () => ({
      error: true,
      code: 'admin_rate_limited',
      message: 'Too many admin requests. Slow down.',
    }),
  }));

  // Apply the admin gate to every route in this plugin.
  fastify.addHook('preHandler', requireAdmin);

  // GET /api/admin/payments/pending — kept for backward-compat with any
  // older clients. New code should use /admin/payments?status=manual_pending.
  fastify.get('/admin/payments/pending', async () => {
    const { rows } = await fastify.db.query(
      `SELECT p.id, p.paymongo_payment_id, p.amount, p.plan, p.status, p.created_at,
              e.couple_names, e.slug, e.is_paid
       FROM payments p
  LEFT JOIN events e ON e.id = p.event_id
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

  // GET /api/admin/payments?status=… — full history with optional filter.
  // Joins events (may be NULL — admin-recorded payments aren't tied to a
  // specific event row) and users so a single fetch populates the UI.
  fastify.get('/admin/payments', async (request) => {
    const status = String(request.query?.status || '').toLowerCase();
    const validStatuses = new Set(['pending', 'manual_pending', 'succeeded', 'rejected', 'refunded']);
    const args = [];
    let where = '';
    if (status && validStatuses.has(status)) {
      args.push(status);
      where = `WHERE p.status = $1`;
    }
    const { rows } = await fastify.db.query(
      `SELECT p.id, p.user_id, p.event_id, p.paymongo_payment_id,
              p.amount, p.plan, p.tier, p.status, p.created_at,
              e.couple_names, e.slug,
              u.email AS user_email, u.full_name AS user_name
         FROM payments p
    LEFT JOIN events e ON e.id = p.event_id
    LEFT JOIN users  u ON u.id = p.user_id
         ${where}
     ORDER BY p.created_at DESC
        LIMIT 500`,
      args,
    );
    return {
      payments: rows.map(r => ({
        ...r,
        gcash_reference: r.paymongo_payment_id?.startsWith('gcash-')
          ? r.paymongo_payment_id.slice(6)
          : null,
      })),
    };
  });

  // POST /api/admin/payments/manual — admin records an out-of-band
  // payment (cash, bank transfer, etc.). Inserts as 'succeeded' and
  // upgrades the user's subscription_tier in the same transaction so the
  // change is immediate. event_id is optional — useful when the payment
  // is for a future event the user hasn't created yet.
  fastify.post('/admin/payments/manual', async (request, reply) => {
    const { user_id, tier, amount, reference, slug } = request.body ?? {};
    if (!user_id || !tier || amount === undefined || amount === null) {
      return reply.status(400).send({ error: true, message: 'user_id, tier and amount are required' });
    }
    if (!VALID_TIERS.has(String(tier).toLowerCase())) {
      return reply.status(400).send({ error: true, message: `Invalid tier. Allowed: ${[...VALID_TIERS].join(', ')}` });
    }
    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt < 0) {
      return reply.status(400).send({ error: true, message: 'amount must be a positive integer (centavos)' });
    }
    const tierLower = String(tier).toLowerCase();
    const ref = String(reference || `admin-${Date.now()}`).slice(0, 200);

    // Resolve event_id if a slug was provided.
    let eventId = null;
    if (slug) {
      const { rows: er } = await fastify.db.query('SELECT id FROM events WHERE slug = $1', [slug]);
      if (!er.length) return reply.status(404).send({ error: true, message: 'Event slug not found' });
      eventId = er[0].id;
    }

    // Run the three writes in a single transaction so a partial failure
    // never leaves the user upgraded without a corresponding payment row.
    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: ins } = await client.query(
        `INSERT INTO payments (user_id, event_id, paymongo_payment_id, amount, plan, tier, status)
         VALUES ($1, $2, $3, $4, $5, $5, 'succeeded')
         RETURNING id, created_at`,
        [user_id, eventId, ref, amt, tierLower],
      );
      await client.query(
        `UPDATE users SET subscription_tier = $2 WHERE id = $1`,
        [user_id, tierLower],
      );
      if (eventId) {
        await client.query(
          `UPDATE events SET is_paid = true, plan = $2 WHERE id = $1`,
          [eventId, tierLower],
        );
      }
      await client.query('COMMIT');
      return { success: true, payment_id: ins[0].id, created_at: ins[0].created_at };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/admin/payments/:id/refund — mark a succeeded payment as
  // refunded. Also flips the associated event back to is_paid=false
  // so the host can't use a refunded purchase to access paid features.
  // Does NOT contact PayMongo — that has to be done manually in their
  // dashboard. This just keeps our books straight.
  fastify.post('/admin/payments/:id/refund', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.db.query(
      `WITH refunded AS (
         UPDATE payments SET status = 'refunded'
         WHERE id = $1 AND status = 'succeeded'
         RETURNING event_id
       )
       UPDATE events SET is_paid = false
       FROM refunded
       WHERE events.id = refunded.event_id
       RETURNING events.id`,
      [id],
    );
    // If there was no event linked, the CTE still ran the UPDATE; verify.
    const { rows: check } = await fastify.db.query(
      'SELECT status FROM payments WHERE id = $1',
      [id],
    );
    if (!check.length) return reply.status(404).send({ error: true, message: 'Payment not found' });
    if (check[0].status !== 'refunded') {
      return reply.status(409).send({ error: true, message: 'Only succeeded payments can be refunded' });
    }
    return { success: true, event_unpaid: rows.length > 0 };
  });

  // GET /api/admin/events
  fastify.get('/admin/events', async () => {
    const { rows } = await fastify.db.query(
      `SELECT e.id, e.slug, e.couple_names, e.event_type, e.plan,
              e.event_date, e.gallery_expires_at, e.upload_window_ends_at,
              e.venue, e.event_time, e.welcome_message,
              e.is_paid, e.is_active, e.created_at,
              e.user_id,
              COUNT(up.id)::int AS upload_count,
              usr.email AS user_email
       FROM events e
       LEFT JOIN uploads  up  ON up.event_id = e.id
       LEFT JOIN users    usr ON usr.id = e.user_id
       GROUP BY e.id, usr.email
       ORDER BY COALESCE(e.event_date, e.created_at::date) DESC, e.created_at DESC`,
    );
    return { events: rows };
  });

  // POST /api/admin/events — admin-create an event for any user. Bypasses
  // the user-facing plan limits and the payment flow; the assumption is
  // that the admin already verified the comp/internal reason out-of-band.
  // Stamps gallery/upload windows from the chosen plan + event_date,
  // exactly like the user-facing create path.
  const VALID_PLANS = new Set(['tala', 'sinag', 'dalisay', 'hiraya']);
  fastify.post('/admin/events', async (request, reply) => {
    const b = request.body ?? {};
    const couple_names = String(b.couple_names || '').trim();
    if (!couple_names) {
      return reply.status(400).send({ error: true, message: 'couple_names is required' });
    }
    const user_id = b.user_id || null;
    if (user_id) {
      const { rows } = await fastify.db.query('SELECT id FROM users WHERE id = $1', [user_id]);
      if (!rows.length) return reply.status(400).send({ error: true, message: 'user_id not found' });
    }
    const plan = String(b.plan || 'tala').toLowerCase();
    if (!VALID_PLANS.has(plan)) {
      return reply.status(400).send({ error: true, message: `Invalid plan. Allowed: ${[...VALID_PLANS].join(', ')}` });
    }
    const resolved          = resolvePlan(plan);
    const event_date        = b.event_date || null;
    const stampDate         = event_date ? new Date(event_date) : new Date();
    const galleryExpiresAt  = galleryExpiryFor(resolved.id, stampDate);
    const uploadEndAt       = uploadWindowEndFor(resolved.id, stampDate);
    const is_paid           = b.is_paid === false ? false : true; // default true for admin-create
    const is_active         = b.is_active === false ? false : true;

    const base = baseSlug(couple_names);
    let slug = base;
    let inserted = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const { rows } = await fastify.db.query(
          `INSERT INTO events (
             slug, couple_names, event_type, event_date, plan, user_id,
             gallery_expires_at, upload_window_ends_at,
             is_paid, is_active,
             venue, event_time, welcome_message
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            slug,
            couple_names,
            b.event_type || 'wedding',
            event_date,
            resolved.id,
            user_id,
            galleryExpiresAt,
            uploadEndAt,
            is_paid,
            is_active,
            b.venue || null,
            b.event_time || null,
            b.welcome_message || null,
          ],
        );
        inserted = rows[0];
        break;
      } catch (err) {
        if (isSlugCollision(err)) { slug = `${base}-${randomSuffix()}`; continue; }
        throw err;
      }
    }
    if (!inserted) {
      return reply.status(500).send({ error: true, message: 'Could not allocate a unique URL — try a slightly different name.' });
    }
    return reply.status(201).send({ event: inserted });
  });

  // PATCH /api/admin/events/:slug — edit any field. Whitelisted columns
  // only. If plan or event_date changes, gallery_expires_at and
  // upload_window_ends_at are recomputed unless the caller explicitly
  // passes them (admin override wins). Reassigning user_id validates
  // the target exists first.
  const EDITABLE_COLS = new Set([
    'couple_names', 'event_type', 'event_date', 'plan',
    'is_paid', 'is_active', 'user_id',
    'venue', 'event_time', 'welcome_message',
    'gallery_expires_at', 'upload_window_ends_at',
  ]);
  fastify.patch('/admin/events/:slug', async (request, reply) => {
    const { slug } = request.params;
    const b = request.body ?? {};
    const cols = Object.keys(b).filter(k => EDITABLE_COLS.has(k));
    if (!cols.length) {
      return reply.status(400).send({ error: true, message: 'No editable fields supplied.' });
    }
    if (b.plan !== undefined && !VALID_PLANS.has(String(b.plan).toLowerCase())) {
      return reply.status(400).send({ error: true, message: `Invalid plan. Allowed: ${[...VALID_PLANS].join(', ')}` });
    }
    if (b.user_id !== undefined && b.user_id !== null) {
      const { rows } = await fastify.db.query('SELECT id FROM users WHERE id = $1', [b.user_id]);
      if (!rows.length) return reply.status(400).send({ error: true, message: 'user_id not found' });
    }

    // Recompute expiry stamps if plan or event_date changed and the
    // caller didn't override them directly. Cheaper UX than forcing the
    // admin to chain a /extend call after every edit.
    const planChanged = b.plan !== undefined;
    const dateChanged = b.event_date !== undefined;
    if ((planChanged || dateChanged) &&
        b.gallery_expires_at === undefined &&
        b.upload_window_ends_at === undefined) {
      const { rows: existing } = await fastify.db.query(
        'SELECT plan, event_date FROM events WHERE slug = $1',
        [slug],
      );
      if (!existing.length) return reply.status(404).send({ error: true, message: 'Event not found' });
      const effPlan = (b.plan !== undefined ? String(b.plan).toLowerCase() : existing[0].plan) || 'tala';
      const effDate = b.event_date !== undefined ? b.event_date : existing[0].event_date;
      const stampDate = effDate ? new Date(effDate) : new Date();
      const resolved = resolvePlan(effPlan);
      b.gallery_expires_at    = galleryExpiryFor(resolved.id, stampDate);
      b.upload_window_ends_at = uploadWindowEndFor(resolved.id, stampDate);
      cols.push('gallery_expires_at', 'upload_window_ends_at');
    }

    // Normalize plan to lowercase (validated above) before persisting.
    if (b.plan !== undefined) b.plan = String(b.plan).toLowerCase();

    const uniqueCols = [...new Set(cols)];
    const sets   = uniqueCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const params = [slug, ...uniqueCols.map(c => b[c])];

    const { rows } = await fastify.db.query(
      `UPDATE events SET ${sets} WHERE slug = $1 RETURNING *`,
      params,
    );
    if (!rows.length) return reply.status(404).send({ error: true, message: 'Event not found' });
    return { event: rows[0] };
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

  // DELETE /api/admin/events/:slug — hard-delete an event row. Child tables
  // (uploads, video_messages, reactions, polls, event_websites, event_rsvps,
  // event_seats, music_tracks) all have ON DELETE CASCADE so they vanish
  // automatically. Payments do NOT cascade — we null out their event_id
  // first so the payment audit trail survives a wiped event. The actual
  // file objects in storage are NOT removed here; they're orphaned and can
  // be reaped separately if needed. Prefer /deactivate over this for
  // anything other than spam / test data.
  fastify.delete('/admin/events/:slug', async (request, reply) => {
    const { slug } = request.params;
    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT id FROM events WHERE slug = $1', [slug]);
      if (!rows.length) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: true, message: 'Event not found' });
      }
      const eventId = rows[0].id;
      await client.query('UPDATE payments SET event_id = NULL WHERE event_id = $1', [eventId]);
      await client.query('DELETE FROM events WHERE id = $1', [eventId]);
      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /api/admin/events/:slug/extend
  // Recovery tool for the "upload window already closed" case (see
  // payments.js — historically the recompute anchored on payment time
  // rather than event_date, so many paid events ended up with windows
  // that closed before the celebration). Four mutually-exclusive modes:
  //   { restamp:true } — re-stamp from the owner's CURRENT plan, anchored
  //     to event_date (or NOW if absent). The magic-bullet fix for events
  //     stuck with stale stamps; updates events.plan too.
  //   { until:'2026-12-31T23:59:59Z' } — set the chosen stamp(s) to this
  //     absolute timestamp.
  //   { days:N } — set the chosen stamp(s) to event_date + N days
  //     (or NOW + N days if event_date is null).
  //   { clear:true } — NULL the chosen stamp(s); the gate then skips
  //     entirely (effectively "no expiry").
  // `mode` ('window' | 'gallery' | 'both', default 'both') chooses which
  // column(s) the until/days/clear actions touch; `restamp` always
  // updates both, since it's a re-stamp.
  //
  // NOTE: uploads.js caches the event-validation lookup for ~10s
  // per slug. Effects on guest uploads can lag by that much. Acceptable
  // for a manual admin action; revisit if it ever feels too slow.
  fastify.post('/admin/events/:slug/extend', async (request, reply) => {
    const { slug } = request.params;
    const body = request.body ?? {};
    const mode = body.mode || 'both';
    if (!['window', 'gallery', 'both'].includes(mode)) {
      return reply.status(400).send({ error: true, message: 'mode must be window | gallery | both' });
    }

    // ── Mode A: re-stamp from owner's current plan ──
    if (body.restamp === true) {
      const { rows } = await fastify.db.query(
        `SELECT e.id, e.event_date, COALESCE(u.subscription_tier, 'tala') AS tier
           FROM events e LEFT JOIN users u ON u.id = e.user_id
          WHERE e.slug = $1`,
        [slug],
      );
      if (!rows.length) return reply.status(404).send({ error: true, message: 'Event not found' });
      const plan      = resolvePlan(rows[0].tier);
      const stampDate = rows[0].event_date || new Date();
      const win       = uploadWindowEndFor(plan.id, stampDate);
      const gal       = galleryExpiryFor(plan.id, stampDate);
      const { rows: out } = await fastify.db.query(
        `UPDATE events
            SET plan                  = $2,
                upload_window_ends_at = $3,
                gallery_expires_at    = $4
          WHERE slug = $1
          RETURNING slug, plan, event_date, upload_window_ends_at, gallery_expires_at`,
        [slug, plan.id, win, gal],
      );
      return { success: true, event: out[0], applied: { restamp: true, plan: plan.id } };
    }

    // ── Mode B/C/D: until / days / clear ──
    let target;
    if (body.clear === true) {
      target = null;
    } else if (typeof body.until === 'string') {
      const d = new Date(body.until);
      if (Number.isNaN(d.getTime())) {
        return reply.status(400).send({ error: true, message: 'until must be a valid ISO date' });
      }
      target = d.toISOString();
    } else if (Number.isInteger(body.days) && body.days > 0) {
      const { rows } = await fastify.db.query(`SELECT event_date FROM events WHERE slug = $1`, [slug]);
      if (!rows.length) return reply.status(404).send({ error: true, message: 'Event not found' });
      const base = rows[0].event_date ? new Date(rows[0].event_date) : new Date();
      base.setUTCDate(base.getUTCDate() + body.days);
      target = base.toISOString();
    } else {
      return reply.status(400).send({
        error: true,
        message: 'Provide one of: restamp:true, until (ISO string), days (positive integer), or clear:true',
      });
    }

    const cols = [];
    if (mode === 'window' || mode === 'both') cols.push('upload_window_ends_at');
    if (mode === 'gallery' || mode === 'both') cols.push('gallery_expires_at');
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const params = [slug, ...cols.map(() => target)];

    const { rows } = await fastify.db.query(
      `UPDATE events SET ${sets} WHERE slug = $1
       RETURNING slug, event_date, upload_window_ends_at, gallery_expires_at`,
      params,
    );
    if (!rows.length) return reply.status(404).send({ error: true, message: 'Event not found' });
    return { success: true, event: rows[0], applied: { mode, target } };
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
