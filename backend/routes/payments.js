import { buildAppUrl } from '../utils/appUrl.js';
import { PLANS, resolvePlan, galleryExpiryFor, uploadWindowEndFor } from '../lib/plans.js';

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

    await fastify.db.query(
      `INSERT INTO payments (user_id, event_id, paymongo_payment_id, amount, plan, tier, status)
       VALUES ($1, NULL, $2, $3, $4, $4, 'manual_pending')`,
      [userId, ref, tierConfig.amount, tier],
    );

    // Optimistically apply the tier — admin verifies the reference later.
    await applyTierUpgrade(fastify.db, { userId, tier, slug });

    if (slug) {
      await fastify.db.query(
        `UPDATE payments SET event_id = (SELECT id FROM events WHERE slug = $1)
          WHERE paymongo_payment_id = $2`,
        [slug, ref],
      );
    }

    return reply.status(201).send({ success: true, tier, slug: slug ?? null });
  });

  // POST /api/payments/webhook — PayMongo webhook
  fastify.post('/payments/webhook', async (request, reply) => {
    const payload = request.body;

    if (!payload?.data?.attributes) {
      return reply.status(400).send({ error: true, message: 'Invalid webhook payload' });
    }

    const type       = payload.data.attributes.type;
    const resourceId = payload.data.attributes.data?.id;

    // Successful checkout — apply the tier purchase to the user
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

    // Legacy payment_intent webhook — look the payment up and apply
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
