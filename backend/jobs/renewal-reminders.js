/**
 * Hiraya renewal-reminder cron.
 *
 * No external scheduler (cron daemon, GitHub Actions, etc.) — this runs
 * in-process on every backend instance via setInterval. That's safe
 * because each reminder is "claimed" by an atomic CAS update on
 * users.renewal_reminders_sent before the email actually sends, so two
 * instances (or two ticks separated by a restart) can't double-fire.
 *
 * Tick cadence: every 6 hours. The cron's job is just to "wake up
 * frequently enough that the day-of trigger doesn't miss" — the per-user
 * idempotency check on the JSONB column does the real work. A user who
 * crosses the T-30 boundary at, say, 03:00 Manila gets their reminder on
 * the next tick (worst case ~6h later).
 *
 * Schema of users.renewal_reminders_sent: { t30: "2026-05-08", t7, t0 }
 * — values are ISO-date strings (UTC) so a manual audit is readable.
 * applyTierUpgrade clears the JSONB to '{}' on renewal so the next cycle
 * starts fresh.
 */

import { sendHirayaRenewalEmail } from '../routes/payments.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

// Thresholds: (stage, [min, max] inclusive day window). We use a window
// instead of an exact equality so a cron that runs every 6h doesn't miss
// a day; the idempotency check ensures we only fire once per stage even
// if the window catches the user across multiple ticks.
//   • T-30: days_until_expiry in [27, 30]
//   • T-7:  days_until_expiry in [5,  7]
//   • T-0:  days_until_expiry <= 0 (already expired, up to 14d back)
const STAGES = [
  { key: 't30', minDays: 27, maxDays: 30 },
  { key: 't7',  minDays: 5,  maxDays: 7  },
  { key: 't0',  minDays: -14, maxDays: 0 },
];

export function startRenewalReminderJob(fastify) {
  // No Resend key = no point running. Don't crash, just log and skip —
  // local dev shouldn't have to set up Resend just to run the server.
  if (!process.env.RESEND_API_KEY) {
    fastify.log.info('[renewal-reminders] RESEND_API_KEY not set; reminder cron disabled');
    return;
  }

  // First run 60s after boot so we don't compete with route registration
  // / DB pool warmup, then every 6h.
  setTimeout(() => {
    runOnce(fastify).catch(err =>
      fastify.log.warn({ err: err.message }, '[renewal-reminders] first-tick failed'),
    );
  }, ONE_MINUTE_MS);

  setInterval(() => {
    runOnce(fastify).catch(err =>
      fastify.log.warn({ err: err.message }, '[renewal-reminders] tick failed'),
    );
  }, SIX_HOURS_MS);

  fastify.log.info('[renewal-reminders] cron started (6h interval)');
}

async function runOnce(fastify) {
  // Pull every Hiraya user whose expiry is anywhere in the active window
  // (anywhere from 14 days past to 31 days future — superset of all
  // stage windows). Cheap query: small population, indexed on the tier
  // column in practice.
  const { rows } = await fastify.db.query(
    `SELECT id, email, full_name, subscription_expires_at, renewal_reminders_sent
       FROM users
      WHERE subscription_tier = 'hiraya'
        AND subscription_expires_at IS NOT NULL
        AND subscription_expires_at BETWEEN NOW() - INTERVAL '14 days'
                                        AND NOW() + INTERVAL '31 days'`,
  );

  if (!rows.length) return;

  fastify.log.info({ candidates: rows.length }, '[renewal-reminders] tick start');

  let sentCount = 0;
  for (const u of rows) {
    const expiresAt = u.subscription_expires_at;
    const daysUntil = Math.floor(
      (new Date(expiresAt).getTime() - Date.now()) / 86_400_000,
    );

    for (const stage of STAGES) {
      if (daysUntil < stage.minDays || daysUntil > stage.maxDays) continue;

      // Atomic claim: only flip the key from missing → set in a single
      // UPDATE. If another instance / earlier tick already did it,
      // rowCount === 0 and we skip the send.
      const claim = await fastify.db.query(
        `UPDATE users
            SET renewal_reminders_sent =
                  COALESCE(renewal_reminders_sent, '{}'::jsonb)
                  || jsonb_build_object($2::text, to_char(NOW(), 'YYYY-MM-DD'))
          WHERE id = $1
            AND (renewal_reminders_sent->>$2) IS NULL`,
        [u.id, stage.key],
      );
      if (claim.rowCount !== 1) continue;

      // We won the claim — fire the email. Failure here means we lose
      // ONE reminder (can't unclaim safely without re-introducing a
      // double-send race). Better to miss one than spam.
      try {
        await sendHirayaRenewalEmail(
          {
            email:     u.email,
            fullName:  u.full_name,
            expiresAt,
            stage:     stage.key,
          },
          fastify.log,
        );
        sentCount++;
      } catch (err) {
        fastify.log.warn(
          { err: err.message, userId: u.id, stage: stage.key },
          '[renewal-reminders] send failed after claim',
        );
      }
    }
  }

  fastify.log.info({ sent: sentCount }, '[renewal-reminders] tick done');
}
