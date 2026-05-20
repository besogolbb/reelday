/**
 * Gallery cleanup cron.
 *
 * Each plan ships with a `galleryDays` retention window. When that
 * window passes, the event soft-locks (no new uploads, wall shows
 * "Archived") — but the photos/videos still sit in R2 forever,
 * paying storage cost long after the event has stopped earning.
 *
 * Two-stage purge:
 *
 *   gallery_expires_at      gallery_expires_at + 7 days
 *           │                        │
 *           ├─ soft-lock (existing)  │
 *           ├─ send warning email    │
 *           │   "you have 7 days to download all before permanent
 *           │    deletion — your event will not be recoverable"     │
 *           │                        ├─ hard-delete R2 objects
 *           │                        ├─ DELETE FROM uploads
 *           │                        └─ set events.archived_at = NOW()
 *
 * The 7-day grace lets a host who got the warning email act: they
 * can hit "Download all (.zip)" on the dashboard while the soft-lock
 * still permits the bulk-download endpoint (which we'll relax below
 * for the warned-but-not-yet-archived window).
 *
 * Idempotency:
 *   - cleanup_warning_sent_at is CAS-claimed in a single UPDATE before
 *     the email goes out. Two instances / two ticks → only one email.
 *   - archived_at is set in a transaction with the DELETE FROM uploads,
 *     so re-runs after a crash either complete the work or do nothing.
 *
 * Tick cadence: every 6 hours. Same reasoning as renewal-reminders —
 * frequent enough that nothing slips a day, idempotent enough that
 * frequency doesn't matter.
 */

import { Resend } from 'resend';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { extractStorageKey } from '../lib/storageKeys.js';

const SIX_HOURS_MS  = 6 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const GRACE_DAYS    = 7;
const R2_BATCH_SIZE = 500;   // DeleteObjectsCommand max is 1000; stay below

function resend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

export function startGalleryCleanupJob(fastify) {
  if (!process.env.R2_BUCKET_NAME) {
    fastify.log.info('[gallery-cleanup] R2_BUCKET_NAME not set; cleanup cron disabled');
    return;
  }

  // First run 90s after boot — staggered behind the renewal-reminders
  // cron's 60s offset so two heavy queries don't compete for the pool
  // on a fresh-restart spike.
  setTimeout(() => {
    runOnce(fastify).catch(err =>
      fastify.log.warn({ err: err.message }, '[gallery-cleanup] first-tick failed'),
    );
  }, 90 * 1000);

  setInterval(() => {
    runOnce(fastify).catch(err =>
      fastify.log.warn({ err: err.message }, '[gallery-cleanup] tick failed'),
    );
  }, SIX_HOURS_MS);

  fastify.log.info('[gallery-cleanup] cron started (6h interval, 7-day grace)');
}

// Exported so admin can fire a tick on demand from the dashboard
// instead of waiting up to 6 hours. Returns the per-pass counts so
// the admin UI can show how many warnings + purges happened.
export async function runGalleryCleanupOnce(fastify) {
  return runOnce(fastify);
}

async function runOnce(fastify) {
  const warned   = await passWarnings(fastify);
  const purged   = await passPurge(fastify);
  if (warned || purged) {
    fastify.log.info({ warned, purged }, '[gallery-cleanup] tick done');
  }
  return { warned, purged };
}

// ── Pass 1: send warning emails for galleries that JUST expired ──
// Catches every event whose gallery_expires_at has passed but whose
// cleanup_warning_sent_at is still NULL. Sends one email per host.
async function passWarnings(fastify) {
  const { rows } = await fastify.db.query(
    `SELECT e.id, e.slug, e.couple_names, e.gallery_expires_at, e.user_id,
            u.email, u.full_name
       FROM events e
       JOIN users  u ON u.id = e.user_id
      WHERE e.gallery_expires_at IS NOT NULL
        AND e.gallery_expires_at <  NOW()
        AND e.cleanup_warning_sent_at IS NULL
        AND e.archived_at IS NULL
        AND e.is_active = true
      LIMIT 100`,
  );
  if (!rows.length) return 0;

  let sent = 0;
  for (const ev of rows) {
    // CAS claim: only the first instance to flip NULL → NOW() owns
    // the send. If another tick raced us, rowCount is 0 and we skip.
    const claim = await fastify.db.query(
      `UPDATE events
          SET cleanup_warning_sent_at = NOW()
        WHERE id = $1
          AND cleanup_warning_sent_at IS NULL`,
      [ev.id],
    );
    if (claim.rowCount !== 1) continue;

    if (!process.env.RESEND_API_KEY) {
      // Mark as warned even without Resend so we don't keep retrying
      // every tick on a misconfigured environment.
      fastify.log.warn({ slug: ev.slug }, '[gallery-cleanup] warning skipped (no RESEND key)');
      continue;
    }

    const purgeDate = new Date(
      new Date(ev.gallery_expires_at).getTime() + GRACE_DAYS * 86_400_000,
    );
    const firstName = (ev.full_name || '').split(' ')[0] || 'kabayan';
    const coupleNames = ev.couple_names || 'your celebration';
    const dashUrl = `https://reelday.ph/dashboard?slug=${encodeURIComponent(ev.slug)}`;
    const purgeStr = purgeDate.toLocaleDateString('en-PH', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    try {
      await resend().emails.send({
        from:    'Reelday <noreply@reelday.ph>',
        to:      ev.email,
        subject: `Action needed — ${coupleNames} memories delete on ${purgeStr}`,
        html: `
          <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px 24px;color:#3f2318;background:#fbf5ec">
            <div style="text-align:center;margin-bottom:24px">
              <div style="font-family:Georgia,serif;font-style:italic;font-size:28px;color:#c45a3a;line-height:1.2">
                Heads up, ${escapeHtml(firstName)} —
              </div>
              <div style="margin-top:10px;font-size:15px;color:#5a443a;line-height:1.5">
                Your event gallery for <strong>${escapeHtml(coupleNames)}</strong> has reached the end of its retention window. You have <strong>${GRACE_DAYS} days</strong> to download your photos and videos before they are permanently removed from our system.
              </div>
            </div>

            <div style="background:#fff;border:1px solid #ebdec6;border-radius:14px;padding:22px;margin-bottom:18px">
              <div style="font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c44a3a;margin-bottom:10px">
                ⚠ Permanent deletion on ${escapeHtml(purgeStr)}
              </div>
              <div style="font-size:14px;line-height:1.6;color:#3f2318;margin-bottom:16px">
                After this date your photos, videos, and audio notes will be deleted from our storage <strong>and cannot be recovered</strong>. Existing event records stay in your dashboard, but the media files themselves are gone.
              </div>
              <div style="text-align:center;margin-top:16px">
                <a href="${dashUrl}"
                   style="display:inline-block;background:#c45a3a;color:#fff;text-decoration:none;
                          padding:13px 30px;border-radius:999px;font-weight:700;font-size:14px;
                          letter-spacing:.06em">
                  Download all now →
                </a>
              </div>
              <div style="font-size:12px;color:#8a7468;margin-top:14px;text-align:center;line-height:1.5">
                Open your dashboard, scroll to <em>Backup</em>, and click <em>Download all (.zip)</em>. You'll get a single archive with every photo, video, and voice note — organised into folders and ready to share.
              </div>
            </div>

            <p style="margin:24px 0 0;font-size:12px;color:#8a7468;text-align:center">
              Need more time? Just reply to this email and we'll see what we can do.
            </p>
            <p style="margin:8px 0 0;font-size:11px;color:#a89683;text-align:center;letter-spacing:.06em">
              ★ Powered by reelday.ph
            </p>
          </div>`,
      });
      sent++;
    } catch (err) {
      // Send failed AFTER we claimed the row. We don't unclaim — better
      // to lose ONE warning than risk double-emailing. The host can
      // still download via the in-app banner, and the purge pass below
      // won't fire until +7 days from gallery_expires_at regardless.
      fastify.log.warn(
        { err: err.message, slug: ev.slug },
        '[gallery-cleanup] warning email failed after CAS claim',
      );
    }
  }
  return sent;
}

// ── Pass 2: hard-delete galleries past their grace window ──
// Anything whose gallery_expires_at + 7 days has passed and that
// hasn't already been archived gets its R2 objects + uploads rows
// removed. The event row itself stays as a tombstone (archived_at
// set) so /my-events can still show it as "archived".
async function passPurge(fastify) {
  const { rows } = await fastify.db.query(
    `SELECT id, slug, couple_names, gallery_expires_at
       FROM events
      WHERE gallery_expires_at IS NOT NULL
        AND gallery_expires_at < NOW() - INTERVAL '${GRACE_DAYS} days'
        AND archived_at IS NULL
      LIMIT 25`,
  );
  if (!rows.length) return 0;

  let purged = 0;
  for (const ev of rows) {
    try {
      await purgeEvent(fastify, ev);
      purged++;
    } catch (err) {
      fastify.log.error(
        { err: err.message, slug: ev.slug, stack: err.stack?.split('\n').slice(0,3).join(' | ') },
        '[gallery-cleanup] purge failed; leaving archived_at NULL so we retry',
      );
    }
  }
  return purged;
}

async function purgeEvent(fastify, ev) {
  // Pull every R2 key referenced by uploads in this event. Mirror of
  // backend/routes/admin.js cascade-delete: we drop the original file,
  // the video transcode derivatives (web.mp4, poster.jpg), and any
  // direct file_url-derived key.
  const { rows: uploads } = await fastify.db.query(
    `SELECT id, original_key, compressed_key, file_url, web_url, poster_url
       FROM uploads
      WHERE event_id = $1`,
    [ev.id],
  );

  const keys = new Set();
  for (const u of uploads) {
    if (u.original_key)   keys.add(u.original_key);
    if (u.compressed_key) keys.add(u.compressed_key);
    const a = extractStorageKey(u.file_url);   if (a) keys.add(a);
    const b = extractStorageKey(u.web_url);    if (b) keys.add(b);
    const c = extractStorageKey(u.poster_url); if (c) keys.add(c);
  }

  // Batch delete from R2. DeleteObjects accepts up to 1000 keys per
  // call; we use 500 to leave headroom for the response envelope and
  // to keep failures localised if a batch errors out.
  const keyArr = [...keys];
  for (let i = 0; i < keyArr.length; i += R2_BATCH_SIZE) {
    const batch = keyArr.slice(i, i + R2_BATCH_SIZE);
    try {
      await fastify.storage.send(new DeleteObjectsCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
      }));
    } catch (err) {
      // A storage hiccup here is recoverable: we haven't touched the
      // DB yet, so next tick will try again. Don't proceed to the
      // DELETE FROM uploads — that would orphan files in R2 forever.
      throw new Error(`R2 batch delete failed at offset ${i}: ${err.message}`);
    }
  }

  // R2 is clear (or was already clear). Now atomically remove the
  // uploads rows and stamp the event as archived. Wrap in a tx so a
  // mid-flight crash leaves us in a re-runnable state.
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM uploads WHERE event_id = $1', [ev.id]);
    await client.query(
      `UPDATE events
          SET archived_at = NOW()
        WHERE id = $1
          AND archived_at IS NULL`,
      [ev.id],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  fastify.log.info(
    { slug: ev.slug, files: keyArr.length, uploads: uploads.length },
    '[gallery-cleanup] event purged',
  );
}
