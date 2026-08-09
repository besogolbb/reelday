/**
 * Free event-website -> paid wall upsell drip.
 *
 * docs/LEAD-MAGNET-PLAN.md §6 designed a 7-touch email sequence for the
 * free-website lead magnet but flagged it as the plan's biggest unbuilt
 * piece ("if full automation isn't feasible this month, do steps 1 and 4
 * manually... the ₱ is in step 4"). This job automates the three
 * date-driven, highest-value stages — the ones a cron can trigger
 * correctly without a human deciding "is this couple ready for this
 * email yet":
 *
 *   - day0: the free site just went live — plant the wall idea lightly,
 *     no hard pitch (mirrors LEAD-MAGNET-PLAN.md §6 step 1).
 *   - t30:  ~30 days before the event — the actual money email
 *     (§6 step 4, "the money email").
 *   - t7:   ~7 days before the event — urgency follow-up if they haven't
 *     upgraded yet (§6 step 5).
 *
 * Deliberately NOT automated here (still manual/未built, same as the plan
 * doc left them): the +7d "tips" email, and the two post-event emails
 * (testimonial/referral ask). Those need real judgment about how the
 * event actually went, which this cron has no way to know.
 *
 * Scope: only events on the free Tala plan with a published website —
 * paid-tier hosts already have the wall, there's nothing to upsell.
 *
 * Idempotency: same CAS pattern as backend/jobs/renewal-reminders.js —
 * events.wall_upsell_emails_sent is claimed atomically per stage before
 * sending, so two instances or two ticks can't double-fire.
 */

import { Resend } from 'resend';

const SIX_HOURS_MS  = 6 * 60 * 60 * 1000;
const TWO_MINUTES_MS = 2 * 60 * 1000;

// Windows, not exact-day equality, for the same reason renewal-reminders
// uses windows: a 6h-tick cron must not miss a day. Idempotency (the CAS
// claim) ensures a stage only ever fires once even if a candidate sits
// inside the window across multiple ticks.
// day0 isn't in this list -- it's keyed on events.created_at (runDay0
// below), not event_date, so it doesn't fit the same window shape.
const DATE_STAGES = [
  { key: 't30', minEventDays: 27, maxEventDays: 33 },
  { key: 't7',  minEventDays: 5,  maxEventDays: 8  },
];

function resend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
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

export function startWeddingWebsiteDripJob(fastify) {
  if (!process.env.RESEND_API_KEY) {
    fastify.log.info('[wedding-website-drip] RESEND_API_KEY not set; drip cron disabled');
    return;
  }

  // Staggered behind renewal-reminders (60s) and gallery-cleanup (90s) so a
  // fresh-restart spike doesn't run three heavy queries against the pool
  // at once.
  setTimeout(() => {
    runOnce(fastify).catch(err =>
      fastify.log.warn({ err: err.message }, '[wedding-website-drip] first-tick failed'),
    );
  }, TWO_MINUTES_MS);

  setInterval(() => {
    runOnce(fastify).catch(err =>
      fastify.log.warn({ err: err.message }, '[wedding-website-drip] tick failed'),
    );
  }, SIX_HOURS_MS);

  fastify.log.info('[wedding-website-drip] cron started (6h interval)');
}

async function runOnce(fastify) {
  await runDay0(fastify);
  for (const stage of DATE_STAGES) {
    await runDateStage(fastify, stage);
  }
}

// day0: free Tala site published within the last 3 days. Keyed on
// events.created_at rather than the exact publish moment — event_sites
// has no "first published at" timestamp, and a new Tala event that never
// gets published isn't a lead worth emailing anyway.
async function runDay0(fastify) {
  const { rows } = await fastify.db.query(
    `SELECT e.id, e.slug, e.couple_names, u.id AS user_id, u.email, u.full_name
       FROM events e
       JOIN event_sites es ON es.event_id = e.id
       JOIN users u        ON u.id = e.user_id
      WHERE e.plan = 'tala'
        AND es.is_published = true
        AND e.created_at > NOW() - INTERVAL '3 days'
        AND (e.wall_upsell_emails_sent->>'day0') IS NULL`,
  );
  for (const row of rows) {
    await claimAndSend(fastify, row, 'day0');
  }
}

async function runDateStage(fastify, stage) {
  const { rows } = await fastify.db.query(
    `SELECT e.id, e.slug, e.couple_names, e.event_date, u.id AS user_id, u.email, u.full_name
       FROM events e
       JOIN event_sites es ON es.event_id = e.id
       JOIN users u        ON u.id = e.user_id
      WHERE e.plan = 'tala'
        AND es.is_published = true
        AND e.event_date IS NOT NULL
        AND e.event_date BETWEEN NOW() + ($1 || ' days')::interval
                              AND NOW() + ($2 || ' days')::interval
        AND (e.wall_upsell_emails_sent->>$3) IS NULL`,
    [stage.minEventDays, stage.maxEventDays, stage.key],
  );
  for (const row of rows) {
    await claimAndSend(fastify, row, stage.key);
  }
}

async function claimAndSend(fastify, row, stageKey) {
  // Atomic claim, same CAS pattern as renewal-reminders.js: only flip
  // missing -> set in one UPDATE. rowCount === 0 means another
  // instance/tick already claimed it.
  const claim = await fastify.db.query(
    `UPDATE events
        SET wall_upsell_emails_sent =
              COALESCE(wall_upsell_emails_sent, '{}'::jsonb)
              || jsonb_build_object($2::text, to_char(NOW(), 'YYYY-MM-DD'))
      WHERE id = $1
        AND (wall_upsell_emails_sent->>$2) IS NULL`,
    [row.id, stageKey],
  );
  if (claim.rowCount !== 1) return;

  try {
    await sendDripEmail(row, stageKey, fastify.log);
  } catch (err) {
    fastify.log.warn(
      { err: err.message, eventId: row.id, stage: stageKey },
      '[wedding-website-drip] send failed after claim',
    );
  }
}

async function sendDripEmail({ slug, couple_names, email, full_name }, stage, log) {
  if (!email) return;
  const name = full_name || 'there';
  const coupleLabel = couple_names || 'your event';
  const siteUrl = `https://reelday.ph/e/${encodeURIComponent(slug)}`;
  const pricingUrl = 'https://reelday.ph/#pricing';

  const COPY = {
    day0: {
      subject: `Your free event website is live — ${coupleLabel}`,
      headline: 'Your website is live!',
      intro: `Your free Reelday event website for <strong>${escapeHtml(coupleLabel)}</strong> is live — share it with your guests any time.`,
      body: `When you're ready, you can also add a live guest wall for the event itself: guests upload photos and videos that play on a screen in real time, with reactions and games. No rush — you can add it any time before the big day. And if you know another couple planning their own wedding, feel free to send them your site as an example — every Reelday site has a "make yours free" link at the bottom.`,
      ctaLabel: 'View your website',
      ctaUrl: siteUrl,
    },
    t30: {
      subject: `${coupleLabel} — add the live wall? (about a month to go)`,
      headline: 'About a month to go',
      intro: `Your event for <strong>${escapeHtml(coupleLabel)}</strong> is coming up in about a month. This is usually when hosts start locking in the day-of details.`,
      body: `Consider adding the live guest wall: guests upload photos & videos from their phones, and it plays on a screen in real time — with reactions, trivia, and video greetings from anyone who can't make it. It turns your reception into something guests interact with, not just watch.`,
      ctaLabel: 'Add the live wall',
      ctaUrl: pricingUrl,
    },
    t7: {
      subject: `${coupleLabel} — one week to go`,
      headline: 'One week to go',
      intro: `Your event for <strong>${escapeHtml(coupleLabel)}</strong> is about a week away.`,
      body: `If you'd still like the live guest wall for the day, now's the time — setup takes a few minutes and there's nothing to configure at the venue beyond a QR code.`,
      ctaLabel: 'Add the live wall',
      ctaUrl: pricingUrl,
    },
  };

  const c = COPY[stage];
  if (!c) return;

  const plainText = [
    c.headline,
    '',
    `Hi ${name},`,
    '',
    c.intro.replace(/<[^>]+>/g, ''),
    '',
    c.body,
    '',
    `${c.ctaLabel}: ${c.ctaUrl}`,
    '',
    'Please do not reply to this email. Questions? Email admin@reelday.ph.',
  ].join('\n');

  await withTimeout(resend().emails.send({
    from:    'Reelday <noreply@reelday.ph>',
    to:      email,
    bcc:     'admin@reelday.ph',
    replyTo: 'admin@reelday.ph',
    subject: c.subject,
    text:    plainText,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:2rem">
        <h2 style="color:#b85230;margin-bottom:1rem">${c.headline}</h2>
        <p>Hi ${escapeHtml(name)},</p>
        <p>${c.intro}</p>
        <p>${escapeHtml(c.body)}</p>
        <a href="${c.ctaUrl}" style="display:inline-block;background:#b85230;color:#fff;padding:.85rem 1.75rem;border-radius:8px;text-decoration:none;font-weight:700;margin:1rem 0">
          ${c.ctaLabel} &rarr;
        </a>
        <p style="font-size:.85rem;color:#888;margin-top:1.5rem">Please do not reply to this email. Questions? Email <a href="mailto:admin@reelday.ph" style="color:#b85230">admin@reelday.ph</a>.</p>
      </div>`,
  }), 10_000, `Resend (wedding-website-drip:${stage})`);

  log?.info?.({ stage, email }, '[wedding-website-drip] sent');
}
