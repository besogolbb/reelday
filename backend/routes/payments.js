import { createHmac, timingSafeEqual } from 'crypto';
import { buildAppUrl } from '../utils/appUrl.js';
import { PLANS, resolvePlan, galleryExpiryFor, uploadWindowEndFor } from '../lib/plans.js';

/**
 * Verify a PayMongo webhook signature.
 * Header format: `t=<unix_ts>,te=<test_sig>,li=<live_sig>`.
 * The signed payload is `${timestamp}.${rawBody}` and the algorithm is
 * HMAC-SHA256 using the per-webhook secret.
 * Without this check anyone could POST a fake "payment.paid" event and
 * upgrade arbitrary user_id values for free.
 */
function verifyPaymongoSignature(rawBody, header, secret) {
  if (!header || !secret || !rawBody) return false;
  const parts = Object.fromEntries(
    header.split(',').map(kv => kv.split('=').map(s => s.trim())),
  );
  const ts  = parts.t;
  const sig = parts.li || parts.te;
  if (!ts || !sig) return false;
  const expected = createHmac('sha256', secret)
    .update(`${ts}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* Tier metadata for the checkout UI / receipts (centavo amounts for PayMongo) */
const PAID_TIERS = {
  sinag:   { label: 'Sinag',   amount: 99900  },  // ₱999
  dalisay: { label: 'Dalisay', amount: 249900 },  // ₱2,499
  hiraya:  { label: 'Hiraya',  amount: 499000 },  // ₱4,990
};

function paymongoAuth() {
  return `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}`;
}

/**
 * Apply a successful payment to the buyer's account.
 *  - subscription_tier is bumped to the purchased tier
 *  - events_remaining is replaced with the tier's eventLimit (Sinag accumulates by 1 each time)
 *  - subscription_expires_at gets +1 year for Hiraya, NULL otherwise
 *  - if a slug was passed, the targeted event is also marked is_paid + plan upgraded
 */
async function applyTierUpgrade(db, { userId, tier, slug }) {
  const plan = resolvePlan(tier);

  // Sinag accumulates (one credit per ₱999); Dalisay/Hiraya replace
  let updateSql, params;
  if (plan.id === 'sinag') {
    updateSql = `
      UPDATE users
         SET subscription_tier        = 'sinag',
             events_remaining         = COALESCE(events_remaining, 0) + 1,
             subscription_expires_at  = NULL
       WHERE id = $1`;
    params = [userId];
  } else if (plan.id === 'hiraya') {
    updateSql = `
      UPDATE users
         SET subscription_tier        = 'hiraya',
             events_remaining         = $2,
             subscription_expires_at  = NOW() + INTERVAL '1 year'
       WHERE id = $1`;
    params = [userId, plan.eventLimit];
  } else { // dalisay
    updateSql = `
      UPDATE users
         SET subscription_tier        = $2,
             events_remaining         = $3,
             subscription_expires_at  = NULL
       WHERE id = $1`;
    params = [userId, plan.id, plan.eventLimit];
  }

  await db.query(updateSql, params);

  if (slug) {
    // Re-stamp the event with the new plan's expiry windows
    const stampDate          = new Date();
    const galleryExpiresAt   = galleryExpiryFor(plan.id, stampDate);
    const uploadWindowEndsAt = uploadWindowEndFor(plan.id, stampDate);

    await db.query(
      `UPDATE events
         SET is_paid               = true,
             plan                  = $2,
             gallery_expires_at    = $3,
             upload_window_ends_at = $4
       WHERE slug = $1`,
      [slug, plan.id, galleryExpiresAt, uploadWindowEndsAt],
    );
  }
}

export default async function paymentRoutes(fastify) {
  // GET /api/payments/plans — public catalog
  fastify.get('/payments/plans', async () => ({
    tiers: Object.fromEntries(
      Object.entries(PAID_TIERS).map(([id, t]) => [
        id,
        {
          label:        t.label,
          amount:       t.amount,            // centavos
          peso:         t.amount / 100,
          event_limit:  PLANS[id].eventLimit,
          gallery_days: PLANS[id].galleryDays,
          features:     PLANS[id].features,
        },
      ]),
    ),
  }));

  // POST /api/payments/create — create PayMongo checkout session (auth required)
  fastify.post('/payments/create', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { tier, slug } = request.body ?? {};

    if (!tier) {
      return reply.status(400).send({ error: true, message: 'tier is required' });
    }

    const tierConfig = PAID_TIERS[tier];
    if (!tierConfig) {
      return reply.status(400).send({ error: true, message: `Unknown tier: ${tier}` });
    }

    const userId = request.user.id;
    const appUrl = buildAppUrl(request);

    // ── PayMongo checkout session ─────────────────────────
    let checkoutUrl     = null;
    let paymentIntentId = null;

    try {
      const checkoutRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': paymongoAuth(),
        },
        body: JSON.stringify({
          data: {
            attributes: {
              billing: { email: request.user.email || 'no-reply@reelday.ph' },
              line_items: [{
                name:     `Reelday ${tierConfig.label}`,
                amount:   tierConfig.amount,
                currency: 'PHP',
                quantity: 1,
              }],
              payment_method_types: ['gcash', 'paymaya', 'card', 'qrph'],
              success_url: slug
                ? `${appUrl}/dashboard?slug=${slug}&upgraded=${tier}`
                : `${appUrl}/my-events?upgraded=${tier}`,
              cancel_url:  `${appUrl}/#pricing`,
              description: `Reelday ${tierConfig.label} — account upgrade`,
              metadata:    { user_id: userId, tier, slug: slug ?? '' },
            },
          },
        }),
      });

      if (checkoutRes.ok) {
        const checkoutData = await checkoutRes.json();
        checkoutUrl     = checkoutData.data?.attributes?.checkout_url ?? null;
        paymentIntentId = checkoutData.data?.id ?? null;
      } else {
        const errBody = await checkoutRes.json().catch(() => ({}));
        fastify.log.error({ errBody }, 'PayMongo checkout session failed');
        const pmErr  = errBody?.errors?.[0];
        const detail = pmErr?.detail ?? errBody?.message ?? 'Payment gateway error. Please try again.';
        return reply.status(502).send({ error: true, message: `PayMongo: ${detail}`, raw: errBody });
      }
    } catch (networkErr) {
      fastify.log.error({ networkErr }, 'PayMongo unreachable');
      return reply.status(502).send({ error: true, message: 'Payment gateway unreachable. Please try again.' });
    }

    // ── Record pending payment ────────────────────────────
    await fastify.db.query(
      `INSERT INTO payments (user_id, event_id, paymongo_payment_id, amount, plan, tier, status)
       VALUES ($1, NULL, $2, $3, $4, $4, 'pending')`,
      [userId, paymentIntentId, tierConfig.amount, tier],
    );

    // If a slug was passed, also attach this payment to that event for traceability
    if (slug) {
      await fastify.db.query(
        `UPDATE payments
            SET event_id = (SELECT id FROM events WHERE slug = $1)
          WHERE paymongo_payment_id = $2`,
        [slug, paymentIntentId],
      );
    }

    return reply.status(201).send({
      checkout_url:      checkoutUrl,
      payment_intent_id: paymentIntentId,
      amount:            tierConfig.amount,
      tier,
    });
  });

  // POST /api/payments/manual — GCash manual reference submission (auth required)
  fastify.post('/payments/manual', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { tier, reference, slug } = request.body ?? {};

    if (!tier || !reference?.trim()) {
      return reply.status(400).send({ error: true, message: 'tier and reference are required' });
    }

    const tierConfig = PAID_TIERS[tier];
    if (!tierConfig) {
      return reply.status(400).send({ error: true, message: `Unknown tier: ${tier}` });
    }

    const userId = request.user.id;
    const ref    = `gcash-${reference.trim()}`;

    // Insert as manual_pending ONLY. The tier upgrade fires from
    // /admin/payments/verify/:id once an admin has actually checked the
    // GCash reference. The previous "optimistic" upgrade meant a user
    // could submit any string and immediately get the paid plan for free.
    await fastify.db.query(
      `INSERT INTO payments (user_id, event_id, paymongo_payment_id, amount, plan, tier, status)
       VALUES ($1, NULL, $2, $3, $4, $4, 'manual_pending')`,
      [userId, ref, tierConfig.amount, tier],
    );

    if (slug) {
      await fastify.db.query(
        `UPDATE payments SET event_id = (SELECT id FROM events WHERE slug = $1)
          WHERE paymongo_payment_id = $2`,
        [slug, ref],
      );
    }

    return reply.status(202).send({
      success: true,
      pending: true,
      tier,
      slug: slug ?? null,
      message: 'Reference submitted. Your upgrade will activate after we verify the GCash transfer (usually within a few hours).',
    });
  });

  // POST /api/payments/reconcile — caller-driven reconciliation.
  // Webhooks can fail to reach the server in local dev, behind certain
  // firewalls, or if the PayMongo dashboard configuration drifts. When
  // the host lands back at /dashboard?upgraded=<tier> after checkout,
  // the frontend posts here so we verify the payment server-to-server
  // with PayMongo and apply the upgrade if it actually went through —
  // independently of whatever the webhook did or didn't do.
  fastify.post('/payments/reconcile', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user.id;
    if (!process.env.PAYMONGO_SECRET_KEY) {
      return reply.status(503).send({ error: true, message: 'Payment gateway not configured' });
    }

    // Pull this user's recent pending payments — newest first. Cap at 5
    // so a stuck-pending row from weeks ago doesn't drown the call.
    const { rows: pending } = await fastify.db.query(
      `SELECT id, paymongo_payment_id, tier, event_id
         FROM payments
        WHERE user_id = $1 AND status = 'pending'
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC
        LIMIT 5`,
      [userId],
    );
    if (!pending.length) {
      return { reconciled: false, reason: 'no_pending_payments' };
    }

    let appliedTier = null;
    let appliedSlug = null;

    for (const pmt of pending) {
      if (!pmt.paymongo_payment_id || !PAID_TIERS[pmt.tier]) continue;
      let paid = false;
      try {
        const res = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${pmt.paymongo_payment_id}`, {
          headers: { 'Authorization': paymongoAuth() },
        });
        if (!res.ok) continue;
        const body = await res.json();
        const attr = body?.data?.attributes || {};
        // PayMongo marks a checkout session paid by populating .payments[]
        // with a payment whose status === 'paid'. payment_intent.status
        // can also surface 'succeeded' for the older flow, so we accept
        // either signal.
        const sessionPaid = (attr.payments || []).some(p => p?.attributes?.status === 'paid');
        const intentPaid  = attr.payment_intent?.attributes?.status === 'succeeded';
        paid = sessionPaid || intentPaid;
      } catch (err) {
        request.log.warn({ err: err.message, pmt: pmt.id }, 'Reconcile lookup failed');
        continue;
      }
      if (!paid) continue;

      // Resolve the slug we originally stored against this payment so
      // the targeted event gets re-stamped with the new plan windows.
      let slug = null;
      if (pmt.event_id) {
        const { rows: evRows } = await fastify.db.query(
          `SELECT slug FROM events WHERE id = $1`,
          [pmt.event_id],
        );
        slug = evRows[0]?.slug || null;
      }

      await applyTierUpgrade(fastify.db, { userId, tier: pmt.tier, slug });
      await fastify.db.query(
        `UPDATE payments SET status = 'succeeded' WHERE id = $1`,
        [pmt.id],
      );
      appliedTier = pmt.tier;
      appliedSlug = slug;
      break; // one upgrade per call — Sinag accumulates per row, but the
             // host needs to land on the dashboard between checkouts anyway
    }

    return appliedTier
      ? { reconciled: true, tier: appliedTier, slug: appliedSlug }
      : { reconciled: false, reason: 'not_paid_yet' };
  });

  // POST /api/payments/webhook — PayMongo webhook (signature-verified).
  fastify.post('/payments/webhook', async (request, reply) => {
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
    if (!secret) {
      // Refuse rather than silently accept anything when the secret isn't
      // wired up — no fail-open path on a money endpoint.
      request.log.error('PAYMONGO_WEBHOOK_SECRET is not set; rejecting webhook');
      return reply.status(503).send({ error: true, message: 'Webhook handler disabled' });
    }
    const sigHeader = request.headers['paymongo-signature'];
    if (!verifyPaymongoSignature(request.rawBody, sigHeader, secret)) {
      request.log.warn({ sigHeader }, 'Rejected webhook with bad/missing signature');
      return reply.status(401).send({ error: true, message: 'Invalid signature' });
    }

    const payload = request.body;
    if (!payload?.data?.attributes) {
      return reply.status(400).send({ error: true, message: 'Invalid webhook payload' });
    }

    const type       = payload.data.attributes.type;
    const resourceId = payload.data.attributes.data?.id;

    // Successful checkout. We trust the webhook here because the signature
    // matched our shared secret; the metadata user_id is what PayMongo
    // saw when we created the checkout session in createCheckoutSession.
    if (type === 'checkout_session.payment.paid' && resourceId) {
      const meta = payload.data.attributes.data?.attributes?.metadata ?? {};
      const { user_id: userId, tier, slug } = meta;

      if (userId && PAID_TIERS[tier]) {
        await applyTierUpgrade(fastify.db, { userId, tier, slug: slug || null });
        await fastify.db.query(
          `UPDATE payments SET status = 'succeeded'
            WHERE paymongo_payment_id = $1`,
          [resourceId],
        );
      }
    }

    // Legacy payment_intent webhook — find the payment we already created
    // and use ITS stored user_id (not anything from the webhook payload)
    // as a defense-in-depth measure if signature secrets are ever rotated.
    if (type === 'payment_intent.succeeded' && resourceId) {
      const { rows: paymentRows } = await fastify.db.query(
        `UPDATE payments SET status = 'succeeded'
            WHERE paymongo_payment_id = $1
        RETURNING *`,
        [resourceId],
      );

      if (paymentRows.length) {
        const payment = paymentRows[0];
        if (payment.user_id && PAID_TIERS[payment.tier]) {
          await applyTierUpgrade(fastify.db, {
            userId: payment.user_id,
            tier:   payment.tier,
            slug:   null,
          });
        }
      }
    }

    return { received: true };
  });
}
