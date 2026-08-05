import { Resend } from 'resend';
import { generateQR } from '../utils/qr.js';
import { resolvePlan, galleryExpiryFor, uploadWindowStartFor, uploadWindowEndFor, isDemoWindowOpen } from '../lib/plans.js';
import { verifyToken } from '../plugins/auth.js';
import { sendBookingConfirmationEmail } from './payments.js';

// Event dates are admin-managed (the host PATCH can't move them — see the
// hardcoded NULL $3 in the PATCH below). Hosts request a change here and
// the form emails the admin inbox. Mirrors the Resend pattern in auth.js.
const ADMIN_EMAIL = 'admin@reelday.ph';

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// "Your event is live" email — fires for every newly-created event, every
// tier. Warm-first tone: congratulations land before the tool links, since
// Filipino hosts told us the demo-window-close nudge felt "transactional
// from the start" with no human moment before it. Sinag/Dalisay/Hiraya
// still also receive the payment-confirmation email from payments.js;
// this one is the "event is set up" companion, not a duplicate receipt.
//
// Tala adds a single sentence flagging the 48h preview window so the
// demo-window-close nudge that fires later doesn't feel out of the blue.
async function sendEventCreatedEmail(opts, log) {
  if (!process.env.RESEND_API_KEY) return;
  const {
    toEmail, firstName, eventLabel, eventDate, planId, demoDays,
    dashUrl, uploadUrl, qrPngUrl,
  } = opts;
  if (!toEmail) return;

  const safeFirst = escapeHtml(firstName || 'kabayan');
  const safeLabel = escapeHtml(eventLabel || 'your celebration');
  const safeDate  = eventDate
    ? new Date(eventDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const demoNote = planId === 'tala' && demoDays
    ? `<p style="margin:18px 0 0;font-size:13px;color:#7a6655;line-height:1.55">
         Heads up — your free Tala plan includes a ${demoDays}-day preview window
         from now so you can test uploads with a few friends. After that the wall
         stays quiet until your event day, when it reopens automatically. We'll
         send a friendly nudge when the preview wraps.
       </p>`
    : '';

  try {
    await withTimeout(resend().emails.send({
      from:    'Reelday <noreply@reelday.ph>',
      to:      toEmail,
      subject: `Your Reelday event is live, ${safeFirst}!`,
      html: `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;color:#3f2318;background:#fbf5ec">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:30px;color:#c45a3a;line-height:1.15">
              Maligayang bati, ${safeFirst}!
            </div>
            <div style="margin-top:10px;font-size:15px;color:#5a443a;line-height:1.5">
              Your event for <strong>${safeLabel}</strong>${safeDate ? ` on <strong>${safeDate}</strong>` : ''} is all set up.
              We're so glad you're celebrating with Reelday — your guests are going to love it.
            </div>
          </div>

          <div style="background:#fff;border:1px solid #ebdec6;border-radius:14px;padding:22px;margin-bottom:18px">
            <div style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c45a3a;margin-bottom:10px">
              What's next
            </div>
            <ol style="padding-left:18px;margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f2318">
              <li>Open your dashboard to see your QR code and event details.</li>
              <li>Print or display the QR at your venue so guests can scan to upload.</li>
              <li>Share the upload link below in your invite or group chat.</li>
            </ol>

            <div style="text-align:center;margin:18px 0 6px">
              <a href="${dashUrl}"
                 style="display:inline-block;background:#c45a3a;color:#fff;text-decoration:none;
                        padding:13px 30px;border-radius:999px;font-weight:700;font-size:14px;
                        letter-spacing:.06em">
                Open your dashboard →
              </a>
            </div>
          </div>

          <div style="background:#fff;border:1px solid #ebdec6;border-radius:14px;padding:18px 22px;margin-bottom:18px">
            <div style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5a443a;margin-bottom:8px">
              Share with guests
            </div>
            <div style="font-size:13px;line-height:1.5;color:#5a443a;margin-bottom:8px">
              Copy this link into Messenger, Viber, or your invite — no app, no signup, just scan or tap:
            </div>
            <div style="font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;background:#f4ead9;padding:10px 14px;border-radius:8px;word-break:break-all;color:#c45a3a">
              ${escapeHtml(uploadUrl)}
            </div>
          </div>

          <div style="background:#fff;border:1px solid #ebdec6;border-radius:14px;padding:18px 22px;margin-bottom:18px">
            <div style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5a443a;margin-bottom:10px">
              Before your event
            </div>
            <ul style="padding-left:18px;margin:0;font-size:14px;line-height:1.65;color:#3f2318">
              <li>Test the wall on the actual venue Wi-Fi before guests arrive.</li>
              <li>Do one real test upload: one photo and one video from a guest phone.</li>
              <li>Use Microsoft Edge on the wall device when possible.</li>
              <li>Bring a backup mobile hotspot in case the venue internet is weak.</li>
              <li>If internet gets slow during the event, ask guests to upload photos first before long videos.</li>
              <li>Assign one person to operate the wall so someone can keep the show smooth.</li>
            </ul>
          </div>

          ${demoNote}

          <p style="margin:24px 0 0;font-size:12px;color:#8a7468;text-align:center">
            Need a hand? Just reply to this email and a real human gets back to you.
          </p>
          <p style="margin:8px 0 0;font-size:11px;color:#a89683;text-align:center;letter-spacing:.06em">
            ★ Powered by reelday.ph
          </p>
        </div>`,
    }), 10_000, 'Resend (event-created)');
  } catch (err) {
    log?.warn?.({ err: err.message, planId }, 'event-created email failed');
  }
}

// Sanitised, no-suffix slug from the couple/celebrant names. We try this
// first; only when it collides with an existing event do we append a
// random suffix (see the INSERT retry loop below). Empty/all-junk input
// falls back to "event" so we never insert an empty slug.
export function baseSlug(coupleNames) {
  const base = (coupleNames || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanum → dash
    .replace(/^-+|-+$/g, '')        // trim leading/trailing dashes
    .slice(0, 40);
  return base || 'event';
}
export function randomSuffix() {
  return Math.random().toString(36).slice(2, 6); // 4 alphanumerics ≈ 1.7M
}
// Postgres unique_violation on the slug uniqueness (constraint OR index).
export function isSlugCollision(err) {
  return err && err.code === '23505' && /slug/i.test(err.constraint || err.detail || '');
}

/* Best-effort: pull a user from the Authorization header without
   forcing auth. Anonymous event creation is still allowed (legacy). */
function tryGetUser(request) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try { return verifyToken(header.slice(7)); }
  catch { return null; }
}

async function loadUserWithPlan(db, userId) {
  if (!userId) return null;
  const { rows } = await db.query(
    `SELECT id, subscription_tier, subscription_expires_at, tala_used
       FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function countUserActiveEvents(db, userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM events
       WHERE user_id = $1 AND is_active = true`,
    [userId],
  );
  return rows[0].count;
}

// Hiraya is a yearly subscription with a soft cap of 10 events/year.
// We count active plan='hiraya' events created in the last 365 days —
// a rolling window matches the marketing copy ("up to 10 events / year")
// and avoids edge cases with mid-cycle renewals (where pinning to
// subscription_expires_at - 1y would drop pre-renewal events from the count).
async function countRecentHirayaEvents(db, userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM events
       WHERE user_id = $1
         AND is_active = true
         AND plan = 'hiraya'
         AND created_at > NOW() - INTERVAL '1 year'`,
    [userId],
  );
  return rows[0].count;
}

export default async function eventRoutes(fastify) {
  // POST /api/events — create a new event (auth required)
  fastify.post('/events', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { couple_names, event_type, event_date, plan: requestedPlan } = request.body ?? {};

    if (!couple_names) {
      return reply.status(400).send({ error: true, message: 'couple_names is required' });
    }

    const userId = request.user.id;
    const user   = await loadUserWithPlan(fastify.db, userId);
    if (!user) {
      return reply.status(404).send({ error: true, message: 'User not found' });
    }

    // Event-scoped plan model: honour any explicit plan id the client sent
    // (including 'tala'), and only fall back to the user's subscription_tier
    // when the body omitted plan entirely. Previously 'tala' was treated as
    // "missing" and silently overridden by subscription_tier — so a Dalisay
    // account picking Tala in the wizard got a Dalisay event instead. See
    // project-plan-tiers-event-scoped: each event carries its own plan and
    // is bought / gated independently from the user-level tier.
    const PAID_PLAN_IDS = new Set(['sinag', 'dalisay', 'hiraya']);
    const VALID_PLAN_IDS = new Set(['tala', ...PAID_PLAN_IDS]);
    const planForEvent = VALID_PLAN_IDS.has(requestedPlan)
      ? resolvePlan(requestedPlan)
      : resolvePlan(user.subscription_tier);

    // Tala lifetime cap — one free event per account, ever.
    if (planForEvent.id === 'tala' && user.tala_used) {
      return reply.status(403).send({
        error: true,
        code:     'plan_limit_events',
        message:  `You've already used your free Tala event. Upgrade to add more.`,
        plan:     planForEvent.id,
        tala_used: true,
      });
    }

    // Tala eventLimit fallback (counts active events vs the 1-event cap).
    if (planForEvent.id === 'tala') {
      const existing = await countUserActiveEvents(fastify.db, userId);
      if (existing >= planForEvent.eventLimit) {
        return reply.status(403).send({
          error: true,
          code:         'plan_limit_events',
          message:      `Your Tala plan allows ${planForEvent.eventLimit} active event. Upgrade to add more.`,
          plan:         planForEvent.id,
          event_limit:  planForEvent.eventLimit,
          active_events: existing,
        });
      }
    }

    // Hiraya yearly cap: 10 active hiraya events per rolling 12 months.
    // Without this gate the subscription_expires_at check alone would let a
    // single ₱9,990 purchase mint unlimited events for the next year.
    if (planForEvent.id === 'hiraya') {
      const existing = await countRecentHirayaEvents(fastify.db, userId);
      if (existing >= planForEvent.eventLimit) {
        return reply.status(403).send({
          error: true,
          code:         'plan_limit_events',
          message:      `Your Hiraya plan allows ${planForEvent.eventLimit} events per year. Renew next year or contact us to extend.`,
          plan:         planForEvent.id,
          event_limit:  planForEvent.eventLimit,
          active_events: existing,
        });
      }
    }

    // Determine whether this event is already covered by an existing payment.
    // Two cases where we can skip checkout:
    //   1. Hiraya yearly sub: subscription_expires_at is still in the future.
    //   2. Sinag/Dalisay upgrade-panel path: the user paid moments ago via the
    //      upgrade panel (which has no slug at checkout time), so there is a
    //      recent succeeded payment row with event_id still NULL.
    let isPaid = false;
    let claimPaymentId = null;
    let paidViaSubscription = false;

    if (planForEvent.id === 'hiraya') {
      paidViaSubscription = !!(user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date());
      isPaid = paidViaSubscription;
    }
    // Also run the claim-search for ALL paid tiers (including Hiraya) so
    // we can link the matching payment to this event AND fire the deferred
    // payment-confirmation email with the new slug. For Hiraya, isPaid was
    // already set above via the subscription window; the claim here is
    // strictly for the email + payment-event linkage on a fresh purchase.
    //
    // No time window for Sinag/Dalisay: the payment IS the event credit,
    // and a buyer who paid but only came back to finish the wizard the
    // next day (or in a fresh browser that lost the sessionStorage stash)
    // must still be able to mint their event — the old 30-minute cutoff
    // left them at a permanent 402 with money already collected.
    // event_id IS NULL prevents double-spending a payment; the link
    // UPDATE after the insert re-checks it atomically. Oldest-first so
    // multiple stockpiled credits are spent FIFO.
    //
    // Hiraya keeps the 30-minute window: its isPaid comes from the
    // subscription, the claim is only linkage + the deferred receipt
    // email — a renewal payment from months ago (always un-linked, since
    // renewals have no slug) must not attach itself, and re-send a
    // receipt, for whatever event the host creates next.
    if (PAID_PLAN_IDS.has(planForEvent.id)) {
      const { rows: pmtRows } = await fastify.db.query(
        `SELECT id FROM payments
         WHERE user_id = $1 AND tier = $2 AND status = 'succeeded'
           AND event_id IS NULL
           AND ($3::boolean OR created_at > NOW() - INTERVAL '30 minutes')
         ORDER BY created_at ASC LIMIT 1`,
        [userId, planForEvent.id, planForEvent.id !== 'hiraya'],
      );
      if (pmtRows.length) {
        isPaid = true;
        claimPaymentId = pmtRows[0].id;
      }
    }

    // Hard gate: paid plans must actually be paid. The wizard normally
    // sends the user through PayMongo before this endpoint is called, so a
    // request landing here without a matching payment is either an aborted
    // checkout the client forgot to clean up, or a crafted request trying
    // to mint a paid event for free. Either way: refuse, point them back
    // to checkout. Tala still flows through unchanged (it has its own
    // lifetime/cap checks above).
    if (PAID_PLAN_IDS.has(planForEvent.id) && !isPaid) {
      // Differentiate a lapsed Hiraya subscription from "never paid". A
      // user whose subscription_tier is still 'hiraya' but whose
      // expires_at has passed needs the renew flow, not the wizard's
      // upgrade-from-Tala flow. The frontend reads `subscription_lapsed`
      // to surface a dedicated renew panel + dashboard banner; without
      // the differentiator they'd see a generic "payment required" wall
      // and assume the system broke.
      if (planForEvent.id === 'hiraya'
          && user.subscription_tier === 'hiraya'
          && user.subscription_expires_at
          && new Date(user.subscription_expires_at) < new Date()) {
        return reply.status(402).send({
          error: true,
          code:       'subscription_lapsed',
          message:    `Your Hiraya subscription expired on ${new Date(user.subscription_expires_at).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' })}. Renew to create more events.`,
          plan:       'hiraya',
          expired_at: user.subscription_expires_at,
        });
      }
      return reply.status(402).send({
        error: true,
        code:    'payment_required',
        message: `Please complete checkout for ${planForEvent.name} before creating this event.`,
        plan:    planForEvent.id,
      });
    }

    const stampDate            = event_date || new Date();
    const galleryExpiresAt     = galleryExpiryFor(planForEvent.id, stampDate);
    const uploadWindowStartsAt = uploadWindowStartFor(planForEvent.id, stampDate);
    const uploadWindowEndsAt   = uploadWindowEndFor(planForEvent.id, stampDate);

    // Slug allocation: try the clean name first ("juan-and-maria"); only
    // append a random suffix when that exact slug already exists. We
    // attempt the INSERT and react to the Postgres unique_violation
    // instead of checking-then-inserting, so concurrent creates with the
    // same name can't both win the race.
    const base = baseSlug(couple_names);
    let slug = base;
    let inserted = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const { rows } = await fastify.db.query(
          `INSERT INTO events (
             slug, couple_names, event_type, event_date, plan, user_id,
             is_paid, gallery_expires_at, upload_window_starts_at, upload_window_ends_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            slug,
            couple_names,
            event_type ?? 'wedding',
            event_date ?? null,
            planForEvent.id,
            userId,
            isPaid,
            galleryExpiresAt,
            uploadWindowStartsAt,
            uploadWindowEndsAt,
          ],
        );
        inserted = rows[0];
        break;
      } catch (err) {
        if (isSlugCollision(err)) {
          lastErr = err;
          slug = `${base}-${randomSuffix()}`; // first collision + every subsequent retry
          continue;
        }
        throw err;
      }
    }
    if (!inserted) {
      fastify.log.warn({ base, lastErr: lastErr?.message }, 'Slug allocation exhausted retries');
      return reply.status(500).send({
        error: true,
        message: 'Could not allocate a unique URL — please try a slightly different name.',
      });
    }

    // Burn the free-Tala slot on first Tala insert. After this, the
    // lifetime check above blocks any future plan='tala' attempts —
    // even if this event later gets soft- or hard-deleted.
    if (planForEvent.id === 'tala' && !user.tala_used) {
      await fastify.db.query(
        `UPDATE users SET tala_used = true WHERE id = $1`,
        [userId],
      );
    }

    // Link the pre-claimed payment to this event (upgrade-panel path where
    // payment completed before event creation, leaving event_id NULL).
    // The `event_id IS NULL` re-check makes the claim atomic: two
    // concurrent creates can both find the same unclaimed payment in the
    // SELECT above, but only one can win this UPDATE.
    if (claimPaymentId) {
      const { rowCount: claimed } = await fastify.db.query(
        `UPDATE payments SET event_id = $1 WHERE id = $2 AND event_id IS NULL`,
        [inserted.id, claimPaymentId],
      );
      if (!claimed && !paidViaSubscription) {
        // Lost the race — another event already spent this payment, and
        // nothing else funds this one (Hiraya-on-subscription doesn't get
        // here). Remove the just-inserted row rather than keeping a paid
        // event nobody paid for; a retry re-runs the claim search and
        // picks up the user's next unclaimed payment if they have one.
        await fastify.db.query('DELETE FROM events WHERE id = $1', [inserted.id]);
        return reply.status(402).send({
          error: true,
          code:    'payment_required',
          message: `Please complete checkout for ${planForEvent.name} before creating this event.`,
          plan:    planForEvent.id,
        });
      }
      // Deferred payment-confirmation email: reconcile/webhook skipped it
      // because slug was null at payment time. Now that the event exists,
      // fire the email with the proper slug so "Go to Dashboard" lands on
      // the actual event instead of a bare /dashboard.
      if (claimed) {
        sendBookingConfirmationEmail(
          fastify.db,
          { userId, tier: planForEvent.id, slug: inserted.slug },
          request.log,
        ).catch(() => {});
      }
    }

    const event = inserted;

    // Same logic as the regen endpoint: pin to APP_PUBLIC_HOST in
    // production so the QR reaches the canonical domain regardless of
    // which host the backend is currently serving from.
    const protocol = process.env.NODE_ENV === 'development'
      ? (request.headers['x-forwarded-proto'] || 'http')
      : 'https';
    const host =
      process.env.APP_PUBLIC_HOST ||
      (process.env.NODE_ENV === 'development'
        ? (request.headers.host || 'localhost:3000')
        : 'reelday.ph');
    const uploadUrl = `${protocol}://${host}/upload/${slug}`;
    const qr_code = await generateQR(uploadUrl);

    // "Your event is live" welcome email — fires for every tier so Tala
    // hosts (who previously got nothing until the 48h demo-close nudge)
    // hear from us at the actual moment of setup. Paid tiers also get
    // it as the warmer companion to the payment-confirmation receipt.
    const dashUrl = `${protocol}://${host}/dashboard?slug=${encodeURIComponent(event.slug)}`;
    const firstName = (request.user.full_name || '').split(' ')[0];
    sendEventCreatedEmail({
      toEmail:    request.user.email,
      firstName,
      eventLabel: event.couple_names,
      eventDate:  event.event_date,
      planId:     planForEvent.id,
      demoDays:   planForEvent.demoDays,
      dashUrl,
      uploadUrl,
    }, request.log).catch(() => {});

    // Schedule the demo-window-close nudge email for Tala events.
    // Fires exactly when demoDays expires (48h after created_at) via
    // Resend's scheduledAt — no cron or background job needed.
    if (planForEvent.id === 'tala' && planForEvent.demoDays) {
      const demoEndsAt = new Date(
        new Date(event.created_at).getTime() + planForEvent.demoDays * 86_400_000,
      );
      const firstName = (request.user.full_name || '').split(' ')[0] || 'there';
      const eventLabel = escapeHtml(event.couple_names);
      const dashUrl = `https://reelday.ph/dashboard?slug=${encodeURIComponent(event.slug)}`;
      const pricingUrl = 'https://reelday.ph/#pricing';

      withTimeout(resend().emails.send({
        from:        'Reelday <noreply@reelday.ph>',
        to:          request.user.email,
        subject:     `Your Reelday demo window just closed — ready to upgrade?`,
        scheduledAt: demoEndsAt.toISOString(),
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:1.5rem;color:#3f2318">
            <h2 style="color:#c45a3a;margin:0 0 .75rem">Your 2-day demo has ended, ${escapeHtml(firstName)}!</h2>
            <p style="margin:0 0 1rem;line-height:1.6">
              Thanks for trying Reelday with <strong>${eventLabel}</strong>.
              Your free demo window is now closed — but your event-day upload window
              will still open automatically on the day of the event.
            </p>
            <p style="margin:0 0 1.5rem;line-height:1.6">
              Want to give your guests a fuller experience? Upgrading unlocks:
            </p>
            <table style="border-collapse:collapse;font-size:14px;width:100%;margin-bottom:1.5rem">
              <tr style="background:#faf3ec">
                <td style="padding:10px 14px;font-weight:700;color:#c45a3a">Sinag — ₱1,490</td>
                <td style="padding:10px 14px">Unlimited photos &amp; videos · 30-day gallery · reactions</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-weight:700;color:#c45a3a">Dalisay — ₱2,990</td>
                <td style="padding:10px 14px">+ Audio notes · live polls · event website · Same Day Edit reel</td>
              </tr>
            </table>
            <a href="${pricingUrl}"
               style="display:inline-block;background:#c45a3a;color:#fff;text-decoration:none;
                      padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px">
              View plans &amp; upgrade →
            </a>
            <p style="margin:1.5rem 0 0;font-size:13px;color:#999">
              You can also manage your event anytime from your
              <a href="${dashUrl}" style="color:#c45a3a">dashboard</a>.
            </p>
          </div>`,
      }), 10_000, 'Resend (demo-window-close nudge)').catch(err => {
        fastify.log.warn({ err: err.message, slug: event.slug }, 'demo-window nudge email schedule failed');
      });
    }

    return reply.status(201).send({ event, qr_code });
  });

  // GET /api/events/:slug — fetch event + upload count + plan info
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
    // This endpoint is intentionally PUBLIC (the wall + guest upload
    // page consume it without a host token), so `SELECT *` is dangerous
    // — every column we add to the events table gets shipped to anyone
    // who knows the slug. Denylist the fields no public consumer reads:
    //   - user_id          — join key to users PII (2026-05-19 host report)
    //   - password_hash    — bcrypt hash of event password; leaking it
    //                        would let an attacker brute-force offline
    //   - gcal_event_id    — internal Calendar binding, not user-facing
    // Owner-only mutations (PATCH, play-videos, …) are still gated by
    // their own `fastify.authenticate` preHandlers.
    delete event.user_id;
    delete event.password_hash;
    delete event.gcal_event_id;

    const { rows: countRows } = await fastify.db.query(
      'SELECT COUNT(*)::int AS count FROM uploads WHERE event_id = $1 AND is_approved = true',
      [event.id],
    );

    // RSVP headcount — feeds the dashboard's Tala-tier milestone banner
    // (frontend/dashboard.html) without a separate endpoint/query.
    const { rows: rsvpRows } = await fastify.db.query(
      `SELECT COALESCE(SUM(party_size), 0)::int AS headcount
         FROM event_rsvps WHERE event_id = $1 AND attending = true`,
      [event.id],
    );
    const attendingHeadcount = rsvpRows[0].headcount;

    // Per-event tier (locked in at create / upgrade time). The wall +
    // upload page gate features off the event's plan, NOT the owner's
    // current account tier — so an event the host paid for as Dalisay
    // keeps its audio notes / polls / website even if the host later
    // buys a Sinag credit (which would flip subscription_tier to
    // 'sinag'). Conversely, upgrading the user later doesn't
    // retroactively unlock paid features on an existing free event.
    // Matches the project-plan-tiers-event-scoped memory.
    const planInfo = resolvePlan(event.plan);

    // Soft-lock state derived from stored expiry stamps
    const now = new Date();
    const galleryLocked = event.gallery_expires_at
      ? new Date(event.gallery_expires_at) < now
      : false;
    // uploads_not_yet_open is the centered-window pre-opening state.
    // NULL on legacy rows -> false (no pre-event gating, just like before).
    // Tala's 48h post-creation demo window overrides both pre-open and closed states.
    const demoWindowOpen = isDemoWindowOpen(event.plan, event.created_at);
    const uploadsNotYetOpen = !demoWindowOpen && !!(event.upload_window_starts_at
      && new Date(event.upload_window_starts_at) > now);
    const uploadsClosed = !demoWindowOpen && !!(event.upload_window_ends_at
      && new Date(event.upload_window_ends_at) < now);

    return {
      event,
      upload_count: countRows[0].count,
      attending_headcount: attendingHeadcount,
      plan_info: {
        id:           planInfo.id,
        name:         planInfo.name,
        upload_limit: planInfo.uploadLimit,
        event_limit:  planInfo.eventLimit,
        features:     planInfo.features,
      },
      locks: {
        gallery_locked:       galleryLocked,
        uploads_not_yet_open: uploadsNotYetOpen,
        uploads_closed:       uploadsClosed,
      },
    };
  });

  // POST /api/events/:slug/play-videos — push a burst to the wall.
  // Event-owner only. Body: { ids: ['<upload-uuid>', ...] }; pass an
  // empty array to "stop the current burst and resume photos".
  fastify.post('/events/:slug/play-videos', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params;
    const ids = Array.isArray(request.body?.ids) ? request.body.ids : [];

    const { rows: ownerRows } = await fastify.db.query(
      'SELECT id, user_id FROM events WHERE slug = $1',
      [slug],
    );
    if (!ownerRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }
    if (ownerRows[0].user_id !== request.user.id) {
      return reply.status(403).send({ error: true, message: 'Not your event' });
    }

    // Ensure each id is actually an upload on this event so we don't
    // queue arbitrary UUIDs from outside.
    let validIds = [];
    if (ids.length) {
      const { rows: validRows } = await fastify.db.query(
        `SELECT id FROM uploads
          WHERE event_id = $1
            AND id = ANY($2::uuid[])
            AND is_approved = true`,
        [ownerRows[0].id, ids],
      );
      const ok = new Set(validRows.map(r => r.id));
      validIds = ids.filter(id => ok.has(id));
    }

    const { rows } = await fastify.db.query(
      `UPDATE events
          SET playback_burst_id    = COALESCE(playback_burst_id, 0) + 1,
              playback_burst_queue = $2::jsonb
        WHERE slug = $1
        RETURNING playback_burst_id, playback_burst_queue`,
      [slug, JSON.stringify(validIds)],
    );

    return {
      playback_burst_id:    rows[0].playback_burst_id,
      playback_burst_queue: rows[0].playback_burst_queue,
    };
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

    // Encode the full upload URL. APP_PUBLIC_HOST wins so the QR can be
    // pinned to a canonical domain (e.g. reelday.ph) even when the
    // backend itself is served from a staging/easypanel host. In dev we
    // fall through to the request's host so localhost works.
    const protocol = process.env.NODE_ENV === 'development'
      ? (request.headers['x-forwarded-proto'] || 'http')
      : 'https';
    const host =
      process.env.APP_PUBLIC_HOST ||
      (process.env.NODE_ENV === 'development'
        ? (request.headers.host || 'localhost:3000')
        : 'reelday.ph');
    const qr_code = await generateQR(`${protocol}://${host}/upload/${slug}`);
    return { qr_code };
  });

  // PATCH /api/events/:slug — update event settings (owner only).
  fastify.patch('/events/:slug', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params;
    const {
      couple_names, cover_photo_url, is_active,
      venue, event_time, welcome_message,
      auto_approve,
      video_auto_approve,
      video_message_auto_approve,
      reactions_enabled,
      music_playlist_id, music_enabled,
    } = request.body ?? {};

    // Treat empty string as "clear this field"; treat undefined as "leave alone"
    const orNull = v => (v === undefined ? null : v);

    // music_playlist_id == '' means "remove the picked playlist". Anything
    // else gets passed through; the FK constraint guards bad IDs.
    const musicPlaylistArg =
      music_playlist_id === undefined ? undefined
      : music_playlist_id === ''      ? null
      : music_playlist_id;

    // The WHERE clause carries the ownership check so a guess-the-slug
    // attempt against someone else's event returns the same 404 either way.
    const { rows } = await fastify.db.query(
      `UPDATE events
       SET couple_names               = COALESCE($2, couple_names),
           -- event_date is admin-only: $3 is hardcoded NULL below so the
           -- host PATCH can never move it (keeps upload-window stamps sane).
           event_date                 = COALESCE($3, event_date),
           cover_photo_url            = COALESCE($4, cover_photo_url),
           is_active                  = COALESCE($5, is_active),
           venue                      = COALESCE($6, venue),
           event_time                 = COALESCE($7, event_time),
           welcome_message            = COALESCE($8, welcome_message),
           auto_approve               = COALESCE($9,  auto_approve),
           video_auto_approve         = COALESCE($10, video_auto_approve),
           video_message_auto_approve = COALESCE($11, video_message_auto_approve),
           reactions_enabled          = COALESCE($12, reactions_enabled),
           music_playlist_id          = CASE WHEN $14::boolean THEN $15::uuid ELSE music_playlist_id END,
           music_enabled              = COALESCE($16, music_enabled)
       WHERE slug = $1 AND user_id = $13
       RETURNING *`,
      [
        slug,
        couple_names    ?? null,
        null, // $3 event_date — admin-only, never set via host PATCH
        cover_photo_url ?? null,
        is_active       ?? null,
        orNull(venue),
        orNull(event_time),
        orNull(welcome_message),
        typeof auto_approve               === 'boolean' ? auto_approve               : null,
        typeof video_auto_approve         === 'boolean' ? video_auto_approve         : null,
        typeof video_message_auto_approve === 'boolean' ? video_message_auto_approve : null,
        typeof reactions_enabled === 'boolean' ? reactions_enabled : null,
        request.user.id,
        musicPlaylistArg !== undefined,        // $14 — was a value (incl. null) provided?
        musicPlaylistArg ?? null,              // $15 — the value to set (or NULL to clear)
        typeof music_enabled === 'boolean' ? music_enabled : null,
      ],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    return { event: rows[0] };
  });

  // Host-facing "request an event date change" — the date itself is
  // admin-only, so this just emails the admin inbox with the ask. The
  // host's account email goes in the body so admin can reply directly.
  fastify.post('/events/:slug/request-date-change', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params;
    const newDate = String(request.body?.new_date ?? '').trim();
    const reason  = String(request.body?.reason ?? '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      return reply.status(400).send({ error: true, message: 'A valid new date is required.' });
    }
    if (reason.length < 5) {
      return reply.status(400).send({ error: true, message: 'Please add a short reason for the change.' });
    }
    if (reason.length > 1000) {
      return reply.status(400).send({ error: true, message: 'Reason is too long (max 1000 characters).' });
    }

    // Ownership check doubles as existence check.
    const { rows } = await fastify.db.query(
      'SELECT couple_names, event_date FROM events WHERE slug = $1 AND user_id = $2',
      [slug, request.user.id],
    );
    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }
    const ev = rows[0];
    const currentDate = ev.event_date
      ? new Date(ev.event_date).toISOString().slice(0, 10)
      : '(not set)';

    try {
      await withTimeout(resend().emails.send({
        from:    'Reelday <noreply@reelday.ph>',
        to:      ADMIN_EMAIL,
        replyTo: request.user.email,
        subject: `Date change request — ${ev.couple_names} (${slug})`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:1.5rem;color:#3f2318">
            <h2 style="color:#c45a3a;margin:0 0 1rem">Event date change request</h2>
            <table style="border-collapse:collapse;font-size:14px;width:100%">
              <tr><td style="padding:6px 12px 6px 0;color:#888">Event</td><td style="padding:6px 0;font-weight:700">${escapeHtml(ev.couple_names)}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#888">Slug</td><td style="padding:6px 0"><a href="https://reelday.ph/dashboard?slug=${encodeURIComponent(slug)}">${escapeHtml(slug)}</a></td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#888">Current date</td><td style="padding:6px 0">${escapeHtml(currentDate)}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#888">Requested date</td><td style="padding:6px 0;font-weight:700;color:#c45a3a">${escapeHtml(newDate)}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#888">Requested by</td><td style="padding:6px 0">${escapeHtml(request.user.full_name || '—')} &lt;${escapeHtml(request.user.email)}&gt;</td></tr>
            </table>
            <p style="margin:1.25rem 0 .35rem;color:#888;font-size:13px">Reason</p>
            <div style="white-space:pre-wrap;background:#faf3ec;border:1px solid #eadbce;border-radius:10px;padding:12px;font-size:14px;line-height:1.5">${escapeHtml(reason)}</div>
            <p style="font-size:12px;color:#999;margin-top:1.5rem">Apply via Admin → Events → edit (recomputes the upload window). Reply to this email to reach the host.</p>
          </div>`,
      }), 10_000, 'Resend (date-change request)');
    } catch (err) {
      request.log.error({ err: err.message, slug }, 'date-change request email failed');
      return reply.status(502).send({
        error: true,
        message: 'Could not send your request right now. Please email admin@reelday.ph directly.',
      });
    }

    return { ok: true };
  });
}
