const PLANS = {
  libre:       { price: 99900,  label: 'Libre',       },  // ₱999
  selebrasyon: { price: 199900, label: 'Selebrasyon', },  // ₱1,999
  pro:         { price: 349900, label: 'Pro',          },  // ₱3,499
};

import { buildAppUrl } from '../utils/appUrl.js';

function paymongoAuth() {
  return `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}`;
}

export default async function paymentRoutes(fastify) {
  // GET /api/payments/plans
  fastify.get('/payments/plans', async () => ({ plans: PLANS }));

  // POST /api/payments/create — create PayMongo checkout session
  fastify.post('/payments/create', async (request, reply) => {
    const { slug, plan } = request.body ?? {};

    if (!slug || !plan) {
      return reply.status(400).send({ error: true, message: 'slug and plan are required' });
    }

    const planConfig = PLANS[plan];
    if (!planConfig) {
      return reply.status(400).send({ error: true, message: `Unknown plan: ${plan}` });
    }

    const { rows: eventRows } = await fastify.db.query(
      'SELECT id FROM events WHERE slug = $1',
      [slug],
    );

    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const eventId  = eventRows[0].id;
    const appUrl = buildAppUrl(request);

    // ── PayMongo checkout session ─────────────────────────
    let checkoutUrl = null;
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
              billing: { email: 'no-reply@reelday.ph' },
              line_items: [{
                name:     `Reelday ${planConfig.label}`,
                amount:   planConfig.price,
                currency: 'PHP',
                quantity: 1,
              }],
              payment_method_types: ['gcash', 'paymaya', 'card', 'qrph'],
              success_url: `${appUrl}/dashboard?slug=${slug}`,
              cancel_url:  `${appUrl}/create.html`,
              description: `Reelday - ${planConfig.label}`,
              metadata:    { slug, plan },
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
        const field  = pmErr?.source?.pointer ?? 'unknown field';
        fastify.log.error({ field, detail, appUrl, slug }, 'PayMongo field validation failed');
        return reply.status(502).send({ error: true, message: `PayMongo: ${field} — ${detail}`, raw: errBody });
      }
    } catch (networkErr) {
      fastify.log.error({ networkErr }, 'PayMongo unreachable');
      return reply.status(502).send({ error: true, message: 'Payment gateway unreachable. Please try again.' });
    }

    // ── Record payment in DB ──────────────────────────────
    await fastify.db.query(
      `INSERT INTO payments (event_id, paymongo_payment_id, amount, plan, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventId, paymentIntentId, planConfig.price, plan, 'pending'],
    );

    return reply.status(201).send({
      checkout_url:      checkoutUrl,
      payment_intent_id: paymentIntentId,
      amount:            planConfig.price,
    });
  });

  // POST /api/payments/manual — GCash manual reference submission
  fastify.post('/payments/manual', async (request, reply) => {
    const { slug, plan, reference } = request.body ?? {};

    if (!slug || !plan || !reference?.trim()) {
      return reply.status(400).send({ error: true, message: 'slug, plan, and reference are required' });
    }

    const planConfig = PLANS[plan];
    if (!planConfig) {
      return reply.status(400).send({ error: true, message: `Unknown plan: ${plan}` });
    }

    const { rows: eventRows } = await fastify.db.query(
      'SELECT id FROM events WHERE slug = $1',
      [slug],
    );
    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const eventId = eventRows[0].id;

    await fastify.db.query(
      `INSERT INTO payments (event_id, paymongo_payment_id, amount, plan, status)
       VALUES ($1, $2, $3, $4, 'manual_pending')`,
      [eventId, `gcash-${reference.trim()}`, planConfig.price, plan],
    );

    await fastify.db.query(
      'UPDATE events SET is_paid = true, plan = $2 WHERE slug = $1',
      [slug, plan],
    );

    return reply.status(201).send({ success: true, slug });
  });

  // POST /api/payments/webhook — PayMongo webhook
  fastify.post('/payments/webhook', async (request, reply) => {
    const payload = request.body;

    if (!payload?.data?.attributes) {
      return reply.status(400).send({ error: true, message: 'Invalid webhook payload' });
    }

    const type       = payload.data.attributes.type;
    const resourceId = payload.data.attributes.data?.id;

    if (type === 'checkout_session.payment.paid' && resourceId) {
      const meta = payload.data.attributes.data?.attributes?.metadata ?? {};
      const { slug, plan } = meta;

      if (slug) {
        await fastify.db.query(
          'UPDATE events SET is_paid = true, plan = $2 WHERE slug = $1',
          [slug, plan ?? 'selebrasyon'],
        );

        await fastify.db.query(
          `UPDATE payments SET status = 'succeeded'
           WHERE paymongo_payment_id = $1`,
          [resourceId],
        );
      }
    }

    // Legacy payment_intent webhook
    if (type === 'payment_intent.succeeded' && resourceId) {
      const { rows: paymentRows } = await fastify.db.query(
        `UPDATE payments SET status = 'succeeded'
         WHERE paymongo_payment_id = $1
         RETURNING *`,
        [resourceId],
      );

      if (paymentRows.length) {
        const payment = paymentRows[0];
        await fastify.db.query(
          'UPDATE events SET is_paid = true, plan = $2 WHERE id = $1',
          [payment.event_id, payment.plan],
        );
      }
    }

    return { received: true };
  });
}
