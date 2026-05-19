import { createHmac, timingSafeEqual } from 'crypto';
import { Resend } from 'resend';
import { buildAppUrl } from '../utils/appUrl.js';
import { PLANS, resolvePlan, galleryExpiryFor, uploadWindowStartFor, uploadWindowEndFor } from '../lib/plans.js';

/**
 * Verify a PayMongo webhook signature.
 * Header format: `t=<unix_ts>,te=<test_sig>,li=<live_sig>`.
 * The signed payload is `${timestamp}.${rawBody}` and the algorithm is
 * HMAC-SHA256 using the per-webhook secret.
 * Without this check anyone could POST a fake "payment.paid" event and
 * upgrade arbitrary user_id values for free.
 */
function resend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )),
  ]);
}

async function sendBookingConfirmationEmail(db, { userId, tier, slug }, log) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { rows: userRows } = await db.query(
      `SELECT email, full_name FROM users WHERE id = $1`,
      [userId],
    );
    if (!userRows.length) return;
    const { email, full_name: name } = userRows[0];

    let coupleNames  = null;
    let eventDateStr = null;
    if (slug) {
      const { rows: evRows } = await db.query(
        `SELECT couple_names, event_date FROM events WHERE slug = $1 AND user_id = $2`,
        [slug, userId],
      );
      if (evRows.length) {
        coupleNames = evRows[0].couple_names;
        eventDateStr = evRows[0].event_date
          ? new Date(evRows[0].event_date).toLocaleDateString('en-PH', {
              year: 'numeric', month: 'long', day: 'numeric',
            })
          : null;
      }
    }

    const tierLabels = { sinag: 'Sinag', dalisay: 'Dalisay', hiraya: 'Hiraya' };
    const tierLabel  = tierLabels[tier] || tier;
    const eventLine  = coupleNames
      ? `<p><strong>Event:</strong> ${coupleNames}${eventDateStr ? ` &mdash; ${eventDateStr}` : ''}</p>`
      : '';
    const dashUrl = `https://reelday.ph/dashboard${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`;

    const faqRow = (q, a) => `
      <tr>
        <td style="padding:.75rem 0;border-bottom:1px solid #f0f0f0;vertical-align:top">
          <p style="margin:0 0 .25rem;font-size:.9rem;font-weight:700;color:#333">${q}</p>
          <p style="margin:0;font-size:.85rem;color:#555;line-height:1.5">${a}</p>
        </td>
      </tr>`;

    await withTimeout(resend().emails.send({
      from:    'Reelday <noreply@reelday.ph>',
      to:      email,
      subject: `Booking Confirmed — Reelday ${tierLabel}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem">
          <h2 style="color:#e8735a">Booking Confirmed!</h2>
          <p>Hi ${name},</p>
          <p>Your <strong>Reelday ${tierLabel}</strong> plan is now active. Thank you for choosing Reelday to capture your special moments.</p>
          ${eventLine}
          <a href="${dashUrl}" style="display:inline-block;background:#e8735a;color:#fff;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:700;margin:1rem 0">
            Go to Dashboard
          </a>
          <hr style="border:none;border-top:1px solid #eee;margin:1.5rem 0">
          <h3 style="font-size:1rem;color:#333;margin:0 0 .5rem">Things to know before your event</h3>
          <table style="width:100%;border-collapse:collapse">
            ${faqRow(
              '&#127916; 500-guest video upload peak',
              'For events over 500 guests, if everyone uploads videos at the same time, your wall may take 5&ndash;10 minutes to fully display all guest videos during peak moments. Nothing is lost &mdash; the wall catches up automatically.',
            )}
            ${faqRow(
              '&#8987; Know your upload window',
              'Guests can only upload within the upload window tied to your plan. Make sure to share the wall link with guests before it opens &mdash; check your dashboard for the exact dates.',
            )}
            ${faqRow(
              '&#128100; Assign a dedicated wall operator',
              'For the best experience, have one person in charge of the wall display during the event. They can control which uploads appear, keeping the show running smoothly.',
            )}
            ${faqRow(
              '&#128187; Use Microsoft Edge on the wall device',
              'Edge uses significantly less RAM than Chrome, which matters when the wall is displaying high-res videos for hours. We recommend Edge as your wall browser.',
            )}
            ${faqRow(
              '&#128246; Stable internet at your venue',
              'The wall streams video and receives live uploads in real time. Test your venue WiFi ahead of time, or bring a dedicated mobile hotspot as backup.',
            )}
            ${faqRow(
              '&#9989; Do a dry run before guests arrive',
              'Open the wall on the actual venue screen and do a test upload the day before or a few hours before the event. Confirm the display, audio levels, and internet connection.',
            )}
          </table>
          <p style="font-size:.85rem;color:#888;margin-top:1.5rem">Questions? Reply to this email or visit <a href="https://reelday.ph" style="color:#e8735a">reelday.ph</a>.</p>
        </div>`,
    }), 10_000, 'Resend (booking-confirm)');
  } catch (err) {
    log?.warn({ err: err.message }, 'sendBookingConfirmationEmail failed (non-fatal)');
  }
}

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

/* Tier metadata for the checkout UI / receipts (centavo amounts for PayMongo).
 * KEEP IN SYNC with backend/lib/plans.js price fields — this is what PayMongo
 * actually charges, so a drift here means the user is billed the wrong amount.
 * Sinag / Dalisay are per-event one-time payments; Hiraya is a yearly
 * subscription — applyTierUpgrade adds +1 year to subscription_expires_at. */
const PAID_TIERS = {
  sinag:   { label: 'Sinag',   amount: 10000 },   // ₱100 — TEST PRICE, restore to 149000
  dalisay: { label: 'Dalisay', amount: 299000 },  // ₱2,990 / event
  hiraya:  { label: 'Hiraya',  amount: 999000 },  // ₱9,990 / year
};

function paymongoAuth() {
  return `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}`;
}

/**
 * Apply a successful payment to the buyer's account.
 *  - subscription_tier is bumped to the purchased tier
 *  - events_remaining is replaced with the tier's eventLimit (Sinag accumulates by 1 each time)
 *  - subscription_expires_at gets +1 year for Hiraya (yearly sub), NULL otherwise
 *  - if a slug was passed, the targeted event is also marked is_paid + plan upgraded
 */
async function applyTierUpgrade(db, { userId, tier, slug }) {
  const plan = resolvePlan(tier);

  // Sinag accumulates (one credit per ₱1,490); Dalisay replaces (1-event package);
  // Hiraya replaces with a 10-event yearly bucket.
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
    // Re-stamp the event with the new plan's expiry windows. Anchor on
    // the event's actual date — NOT payment time. Otherwise an event
    // scheduled 30 days out gets a window that closes ~days after
    // payment (e.g. Dalisay's 7-day window expires 23 days before the
    // celebration). Falls back to NOW only when the event has no date
    // set, which preserves the original behaviour for date-less events.
    // The WHERE clause includes user_id so a crafted webhook payload
    // (or metadata.slug pointing at someone else's event) can't upgrade
    // an event the buyer doesn't actually own.
    const { rows: evRows } = await db.query(
      `SELECT event_date FROM events WHERE slug = $1 AND user_id = $2`,
      [slug, userId],
    );
    if (evRows.length) {
      const stampDate            = evRows[0].event_date || new Date();
      const galleryExpiresAt     = galleryExpiryFor(plan.id, stampDate);
      const uploadWindowStartsAt = uploadWindowStartFor(plan.id, stampDate);
      const uploadWindowEndsAt   = uploadWindowEndFor(plan.id, stampDate);

      await db.query(
        `UPDATE events
           SET is_paid                 = true,
               plan                    = $2,
               gallery_expires_at      = $3,
               upload_window_starts_at = $4,
               upload_window_ends_at   = $5
         WHERE slug = $1 AND user_id = $6`,
        [slug, plan.id, galleryExpiresAt, uploadWindowStartsAt, uploadWindowEndsAt, userId],
      );
    }
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
    const { tier, slug, success_path } = request.body ?? {};

    if (!tier) {
      return reply.status(400).send({ error: true, message: 'tier is required' });
    }

    const tierConfig = PAID_TIERS[tier];
    if (!tierConfig) {
      return reply.status(400).send({ error: true, message: `Unknown tier: ${tier}` });
    }

    const userId = request.user.id;
    const appUrl = buildAppUrl(request);
    // success_path is a tiny enum (NOT a free-form URL) so we can't be tricked
    // into an open-redirect by a crafted body. Today the only non-default
    // case is 'start_resume' — used by the /start wizard when the user hits
    // a plan_limit_events 403 mid-create, pays for credits, and needs to be
    // bounced back to /start to finalize the in-progress event payload that
    // sessionStorage stashed pre-checkout.
    const resumeStart = success_path === 'start_resume' && !slug;
    const successUrl = slug
      ? `${appUrl}/dashboard?slug=${slug}&upgraded=${tier}`
      : resumeStart
        ? `${appUrl}/start?resumeCreate=1&upgraded=${tier}`
        : `${appUrl}/my-events?upgraded=${tier}`;
    const cancelUrl  = `${appUrl}/#pricing`;
    request.log.info({ appUrl, successUrl, cancelUrl, tier }, 'Creating PayMongo checkout session');

    // ── PayMongo checkout session ─────────────────────────
    let checkoutUrl     = null;
    let paymentIntentId = null;

    try {
      const checkoutRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
        method: 'POST',
        // Hard 15s ceiling — without this a hung PayMongo socket holds
        // the request thread until the upstream client gives up.
        signal: AbortSignal.timeout(15_000),
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
              success_url: successUrl,
              cancel_url:  cancelUrl,
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
          signal: AbortSignal.timeout(10_000),
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
      sendBookingConfirmationEmail(fastify.db, { userId, tier: pmt.tier, slug }, request.log).catch(() => {});
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
    const innerAttrs = payload.data.attributes.data?.attributes ?? {};
    const meta       = innerAttrs.metadata ?? {};

    // Log every accepted webhook so production has a paper trail of what
    // PayMongo is actually delivering — invaluable when "I configured the
    // webhook but the upgrade didn't apply" turns out to be an event-type
    // mismatch in the PayMongo dashboard.
    request.log.info({
      webhook_type: type,
      resource_id:  resourceId,
      has_metadata: Object.keys(meta).length > 0,
      meta_user:    meta.user_id || null,
      meta_tier:    meta.tier    || null,
    }, 'PayMongo webhook received');

    let applied = false;

    // ── checkout_session.payment.paid ─────────────────────
    // Direct path: metadata is on the checkout session resource we
    // attached in /payments/create.
    if (type === 'checkout_session.payment.paid' && resourceId) {
      const { user_id: userId, tier, slug } = meta;
      if (userId && PAID_TIERS[tier]) {
        await applyTierUpgrade(fastify.db, { userId, tier, slug: slug || null });
        await fastify.db.query(
          `UPDATE payments SET status = 'succeeded' WHERE paymongo_payment_id = $1`,
          [resourceId],
        );
        sendBookingConfirmationEmail(fastify.db, { userId, tier, slug: slug || null }, request.log).catch(() => {});
        applied = true;
      }
    }

    // ── payment.paid ──────────────────────────────────────
    // PayMongo dashboards default to "Payment paid" rather than the
    // checkout-session variant; the inner resource is the payment, not
    // the session, so we walk back to a session by matching the source
    // checkout in the related-resources block, or by metadata if PayMongo
    // happens to have copied it through.
    if (!applied && type === 'payment.paid' && resourceId) {
      // PayMongo's payment object exposes the originating checkout
      // session via `attributes.source.id` (varies by integration) or
      // via `attributes.metadata` (when the metadata was attached to
      // the underlying payment intent). Try metadata first, fall back
      // to the most recent matching pending row.
      let userId = meta.user_id;
      let tier   = meta.tier;
      let slug   = meta.slug || null;
      let pendingRowId = null;

      if (!userId || !PAID_TIERS[tier]) {
        // Best effort: look up the most recent pending payment whose
        // total matches this payment's amount. This is conservative —
        // we still require an authenticated payments-table row that we
        // ourselves created in /payments/create.
        const amount = innerAttrs.amount;
        if (amount) {
          const { rows } = await fastify.db.query(
            `SELECT id, user_id, tier, event_id
               FROM payments
              WHERE status = 'pending' AND amount = $1
                AND created_at > NOW() - INTERVAL '24 hours'
              ORDER BY created_at DESC
              LIMIT 1`,
            [amount],
          );
          if (rows.length) {
            userId = rows[0].user_id;
            tier   = rows[0].tier;
            pendingRowId = rows[0].id;
            if (rows[0].event_id) {
              const { rows: ev } = await fastify.db.query(
                `SELECT slug FROM events WHERE id = $1`, [rows[0].event_id],
              );
              slug = ev[0]?.slug || null;
            }
          }
        }
      }

      if (userId && PAID_TIERS[tier]) {
        await applyTierUpgrade(fastify.db, { userId, tier, slug });
        if (pendingRowId) {
          await fastify.db.query(
            `UPDATE payments SET status = 'succeeded' WHERE id = $1`, [pendingRowId],
          );
        } else if (resourceId) {
          await fastify.db.query(
            `UPDATE payments SET status = 'succeeded' WHERE paymongo_payment_id = $1`, [resourceId],
          );
        }
        sendBookingConfirmationEmail(fastify.db, { userId, tier, slug: slug || null }, request.log).catch(() => {});
        applied = true;
      }
    }

    // ── payment_intent.succeeded (legacy) ─────────────────
    if (!applied && type === 'payment_intent.succeeded' && resourceId) {
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
            userId: payment.user_id, tier: payment.tier, slug: null,
          });
          sendBookingConfirmationEmail(fastify.db, { userId: payment.user_id, tier: payment.tier, slug: null }, request.log).catch(() => {});
          applied = true;
        }
      }
    }

    if (!applied) {
      request.log.warn({ webhook_type: type, resource_id: resourceId },
        'Webhook accepted but no upgrade applied — event type or metadata may be unexpected');
    }

    return { received: true, applied };
  });
}
