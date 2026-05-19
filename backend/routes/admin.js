import { timingSafeEqual } from 'crypto';
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { resolvePlan, galleryExpiryFor, uploadWindowStartFor, uploadWindowEndFor } from '../lib/plans.js';
import { applyTierUpgrade } from './payments.js';
import { extractStorageKey } from '../lib/storageKeys.js';
import { syncEventToGcal, deleteGcalEvent } from '../lib/gcal.js';
import { baseSlug, randomSuffix, isSlugCollision } from './events.js';

// Best-effort Google Calendar sync after an admin event mutation. Never
// throws into the request path — a Calendar hiccup must not fail the DB
// write (same philosophy as the R2 reaper); the next edit or the backfill
// script reconciles. Persists/clears events.gcal_event_id so create→insert,
// edit→patch and unschedule→delete stay idempotent.
async function syncEventCalendar(fastify, ev, log) {
  try {
    const gid = await syncEventToGcal(ev);
    if (gid && gid !== ev.gcal_event_id) {
      await fastify.db.query('UPDATE events SET gcal_event_id = $2 WHERE id = $1', [ev.id, gid]);
      ev.gcal_event_id = gid;
    } else if (!gid && ev.gcal_event_id) {
      await fastify.db.query('UPDATE events SET gcal_event_id = NULL WHERE id = $1', [ev.id]);
      ev.gcal_event_id = null;
    }
  } catch (err) {
    log.warn({ err: err.message, slug: ev.slug }, 'gcal sync failed');
  }
}

// Best-effort R2 reaper for a hard-deleted event. Gathers every object the
// event owns and batch-deletes it so a wipe doesn't leak storage:
//   • uploads     — original_key, compressed_key, and the keys behind
//                    file_url / web_url / poster_url (mirrors the per-upload
//                    deleter in routes/uploads.js, same 5-key set)
//   • music_tracks — host-uploaded custom tracks only (event_id scoped, so
//                    curated-library tracks are never touched) via r2_key
//   • event-site   — host hero/prenup imagery, all under the deterministic
//                    `event-site/<event_id>/` prefix (listed straight from R2)
//
// Storage is NOT the source of truth — the DB rows are. So this runs AFTER
// the row delete has committed and never throws: a storage hiccup leaves a
// recoverable orphan, it must not resurrect a deleted event or 500 the call.
async function reapEventStorage(fastify, eventId, uploadRows, musicRows, log) {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) return;

  const keys = new Set();
  for (const r of uploadRows) {
    if (r.original_key)   keys.add(r.original_key);
    if (r.compressed_key) keys.add(r.compressed_key);
    for (const k of [
      extractStorageKey(r.file_url),
      extractStorageKey(r.web_url),
      extractStorageKey(r.poster_url),
    ]) if (k) keys.add(k);
  }
  for (const r of musicRows) if (r.r2_key) keys.add(r.r2_key);

  // Site imagery isn't tracked in its own table (URLs live inside the
  // event_sites.config JSONB at arbitrary paths), but every object is
  // written under this one prefix — list it rather than parse the blob.
  try {
    let ContinuationToken;
    do {
      const page = await fastify.storage.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `event-site/${eventId}/`,
        ContinuationToken,
      }));
      for (const obj of page.Contents || []) if (obj.Key) keys.add(obj.Key);
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
  } catch (err) {
    log.warn({ err: err.message, event_id: eventId }, 'event-site R2 list failed');
  }

  const all = [...keys];
  // S3/R2 DeleteObjects caps at 1000 keys per request; a large event can
  // blow past that, so chunk it.
  for (let i = 0; i < all.length; i += 1000) {
    const batch = all.slice(i, i + 1000);
    try {
      await fastify.storage.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true },
      }));
    } catch (err) {
      log.warn({ err: err.message, event_id: eventId, count: batch.length },
               'event R2 batch delete failed');
    }
  }
}

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
  const headerTok = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Exception: the calendar.ics feed is meant to be pasted into Google
  // Calendar's "Add by URL", which can't send custom headers. Accept the
  // token via ?token= for this one route only. Treat the query token as
  // the same secret as the bearer header — admins who share the .ics URL
  // are effectively sharing admin access, document this in the UI.
  const queryTok = request.url.startsWith('/api/admin/calendar.ics')
    ? String(request.query?.token || '')
    : '';
  const got = headerTok || queryTok;
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
      await client.query('COMMIT');
      // applyTierUpgrade uses its own db queries (not the transaction client)
      // but the payment row is already committed above so the user credit is safe.
      await applyTierUpgrade(fastify.db, { userId: user_id, tier: tierLower, slug: slug ?? null });
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

  // GET /api/admin/calendar.ics — iCalendar feed of every scheduled event,
  // designed for Google Calendar's "Add by URL" subscriber (also works in
  // Apple Calendar / Outlook). Refreshes server-side on every fetch but
  // Google polls roughly every 12-24 h — there's no way to force faster.
  // Events without an event_date are omitted (can't plot a non-date).
  // Inactive / unpaid events still appear so the admin sees the full
  // schedule on their phone; STATUS:TENTATIVE marks the unpaid ones and
  // STATUS:CANCELLED marks the inactive ones.
  fastify.get('/admin/calendar.ics', async (request, reply) => {
    const { rows } = await fastify.db.query(
      `SELECT e.id, e.slug, e.couple_names, e.event_type, e.plan,
              e.event_date, e.venue, e.event_time, e.is_paid, e.is_active,
              e.created_at, e.updated_at,
              usr.email AS user_email
         FROM events e
    LEFT JOIN users usr ON usr.id = e.user_id
        WHERE e.event_date IS NOT NULL
        ORDER BY e.event_date ASC`,
    );

    const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const ymd = d => {
      const dt = (d instanceof Date) ? d : new Date(d);
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dt.getUTCDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    };
    const stamp = d => new Date(d || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    // RFC 5545 line folding: max 75 octets per line, continuation lines
    // start with a single space. Cheap byte-length check is fine for
    // ASCII-heavy event data; non-ASCII may end up slightly under 75 per
    // wrap which is harmless.
    const fold = line => {
      if (line.length <= 75) return line;
      const out = [];
      let i = 0;
      while (i < line.length) {
        out.push((i === 0 ? '' : ' ') + line.slice(i, i + (i === 0 ? 75 : 74)));
        i += (i === 0 ? 75 : 74);
      }
      return out.join('\r\n');
    };

    const host = process.env.APP_PUBLIC_HOST || 'reelday.ph';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Reelday//Admin Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Reelday Events',
      'X-WR-TIMEZONE:Asia/Manila',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
    ];

    for (const e of rows) {
      const start = ymd(e.event_date);
      // DTEND for VALUE=DATE is exclusive; add one day so the event spans
      // the single date correctly in all clients.
      const endDate = new Date(e.event_date);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const end = ymd(endDate);

      const status = e.is_active === false ? 'CANCELLED' : (e.is_paid === false ? 'TENTATIVE' : 'CONFIRMED');
      const planLabel = e.plan ? e.plan.charAt(0).toUpperCase() + e.plan.slice(1) : 'Tala';
      const summary = `${e.couple_names}${e.is_paid === false ? ' (UNPAID)' : ''}${e.is_active === false ? ' (INACTIVE)' : ''}`;
      const descParts = [
        `Type: ${e.event_type || 'wedding'}`,
        `Plan: ${planLabel}`,
        e.venue       ? `Venue: ${e.venue}`               : null,
        e.event_time  ? `Time: ${e.event_time}`           : null,
        e.user_email  ? `Owner: ${e.user_email}`          : 'Owner: (none)',
        `Slug: ${e.slug}`,
      ].filter(Boolean).join('\\n');

      lines.push(
        'BEGIN:VEVENT',
        fold(`UID:${e.id}@${host}`),
        `DTSTAMP:${stamp(e.updated_at || e.created_at)}`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        fold(`SUMMARY:${esc(summary)}`),
        fold(`DESCRIPTION:${descParts}`),
        e.venue ? fold(`LOCATION:${esc(e.venue)}`) : null,
        fold(`URL:https://${host}/dashboard?slug=${encodeURIComponent(e.slug)}`),
        `CATEGORIES:${planLabel}`,
        `STATUS:${status}`,
        `TRANSP:OPAQUE`,
        'END:VEVENT',
      );
    }

    lines.push('END:VCALENDAR');

    reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'inline; filename="reelday-events.ics"')
      // Tell intermediaries not to cache an auth'd response.
      .header('Cache-Control', 'private, no-store')
      .send(lines.filter(Boolean).join('\r\n') + '\r\n');
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
    const uploadStartAt     = uploadWindowStartFor(resolved.id, stampDate);
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
             gallery_expires_at, upload_window_starts_at, upload_window_ends_at,
             is_paid, is_active,
             venue, event_time, welcome_message
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            slug,
            couple_names,
            b.event_type || 'wedding',
            event_date,
            resolved.id,
            user_id,
            galleryExpiresAt,
            uploadStartAt,
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
    // Same rationale as the PATCH path: feature gates read the owner's
    // users.subscription_tier, not events.plan. Lift the assigned owner to
    // the chosen plan so an admin-comped event actually behaves like one.
    // Per-ACCOUNT, so it raises all of that owner's events to this plan.
    if (user_id) {
      await fastify.db.query(
        'UPDATE users SET subscription_tier = $2 WHERE id = $1',
        [user_id, resolved.id],
      );
    }
    await syncEventCalendar(fastify, inserted, request.log);
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
    'gallery_expires_at', 'upload_window_starts_at', 'upload_window_ends_at',
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
        b.upload_window_starts_at === undefined &&
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
      b.gallery_expires_at      = galleryExpiryFor(resolved.id, stampDate);
      b.upload_window_starts_at = uploadWindowStartFor(resolved.id, stampDate);
      b.upload_window_ends_at   = uploadWindowEndFor(resolved.id, stampDate);
      cols.push('gallery_expires_at', 'upload_window_starts_at', 'upload_window_ends_at');
    }

    // Normalize plan to lowercase (validated above) before persisting.
    if (b.plan !== undefined) b.plan = String(b.plan).toLowerCase();

    const uniqueCols = [...new Set(cols)];
    const sets   = uniqueCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const params = [slug, ...uniqueCols.map(c => b[c])];

    const client = await fastify.db.connect();
    let saved;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE events SET ${sets} WHERE slug = $1 RETURNING *`,
        params,
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: true, message: 'Event not found' });
      }
      const ev = rows[0];
      // For an OWNED event, events.plan is otherwise cosmetic: every
      // feature gate resolves the effective plan from the owner's
      // users.subscription_tier (event-site.js loadGate, uploads.js
      // getValidatedEvent), and that column defaults to 'tala' and is
      // never null — so the `|| events.plan` fallback only ever fires for
      // ownerless legacy events. Propagate the chosen plan onto the
      // owner's tier so changing it in the admin editor actually unlocks
      // features. NOTE: tier is per-ACCOUNT, so this lifts every event
      // that owner has to this plan, not just this one. b.plan is already
      // lowercased + validated against VALID_PLANS (== VALID_TIERS).
      if (planChanged && ev.user_id) {
        await client.query(
          'UPDATE users SET subscription_tier = $2 WHERE id = $1',
          [ev.user_id, b.plan],
        );
      }
      await client.query('COMMIT');
      saved = ev;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }

    // Post-commit, best-effort: mirror the change into Google Calendar.
    await syncEventCalendar(fastify, saved, request.log);
    return { event: saved };
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
      `UPDATE payments SET status = 'succeeded'
        WHERE id = $1 AND status = 'manual_pending'
        RETURNING user_id, event_id, tier`,
      [id],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Payment not found or already processed' });
    }

    const { user_id, event_id, tier } = rows[0];

    // Resolve slug so applyTierUpgrade can re-stamp the event's windows.
    let slug = null;
    if (event_id) {
      const { rows: evRows } = await fastify.db.query(
        'SELECT slug FROM events WHERE id = $1', [event_id],
      );
      slug = evRows[0]?.slug ?? null;
    }

    await applyTierUpgrade(fastify.db, { userId: user_id, tier, slug });

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

  // DELETE /api/admin/payments/:id — hard-delete a payment record.
  // Does NOT undo any subscription/tier changes that were applied when
  // the payment was verified; use refund first if that matters.
  fastify.delete('/admin/payments/:id', async (request, reply) => {
    const { id } = request.params;
    const { rowCount } = await fastify.db.query(
      'DELETE FROM payments WHERE id = $1',
      [id],
    );
    if (!rowCount) return reply.status(404).send({ error: true, message: 'Payment not found' });
    return { success: true };
  });

  // POST /api/admin/events/:slug/deactivate
  fastify.post('/admin/events/:slug/deactivate', async (request, reply) => {
    const { slug } = request.params;

    const { rows } = await fastify.db.query(
      'UPDATE events SET is_active = false WHERE slug = $1 RETURNING *',
      [slug],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    // Reflect the cancellation in Google Calendar (best-effort).
    await syncEventCalendar(fastify, rows[0], request.log);
    return { success: true };
  });

  // DELETE /api/admin/events/:slug — hard-delete an event row. Child tables
  // (uploads, video_messages, reactions, polls, event_sites, event_rsvps,
  // event_seats, music_tracks) all have ON DELETE CASCADE so they vanish
  // automatically. Payments do NOT cascade — we null out their event_id
  // first so the payment audit trail survives a wiped event. The R2 objects
  // those rows referenced are then reaped (best-effort) via reapEventStorage
  // so a wipe doesn't leak storage. Prefer /deactivate over this for
  // anything other than spam / test data.
  fastify.delete('/admin/events/:slug', async (request, reply) => {
    const { slug } = request.params;
    const client = await fastify.db.connect();
    let eventId, gcalEventId, uploadRows = [], musicRows = [];
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT id, gcal_event_id FROM events WHERE slug = $1', [slug]);
      if (!rows.length) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: true, message: 'Event not found' });
      }
      eventId = rows[0].id;
      gcalEventId = rows[0].gcal_event_id;
      // Snapshot the storage keys BEFORE the cascade removes the rows.
      ({ rows: uploadRows } = await client.query(
        `SELECT original_key, compressed_key, file_url, web_url, poster_url
           FROM uploads WHERE event_id = $1`,
        [eventId],
      ));
      ({ rows: musicRows } = await client.query(
        `SELECT r2_key FROM music_tracks
          WHERE event_id = $1 AND r2_key IS NOT NULL`,
        [eventId],
      ));
      await client.query('UPDATE payments SET event_id = NULL WHERE event_id = $1', [eventId]);
      await client.query('DELETE FROM events WHERE id = $1', [eventId]);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }

    // Row delete is committed and authoritative; clean storage afterwards so
    // a slow/failed R2 call can't roll back the wipe (reaper never throws).
    await reapEventStorage(fastify, eventId, uploadRows, musicRows, request.log);
    if (gcalEventId) {
      try { await deleteGcalEvent(gcalEventId); }
      catch (err) { request.log.warn({ err: err.message, slug }, 'gcal delete failed'); }
    }
    return { success: true };
  });

  // DELETE /api/admin/users/:id — hard-delete a user and all their data.
  // Order matters: payments have no FK cascade so we null event/user refs
  // first. Then delete events (cascades uploads, music_tracks, reactions,
  // polls, event_sde, etc.). Then delete the user.
  fastify.delete('/admin/users/:id', async (request, reply) => {
    const { id } = request.params;
    const client = await fastify.db.connect();
    let allUploadRows = [], allMusicRows = [], eventIds = [];
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query(
        'SELECT id FROM users WHERE id = $1', [id],
      );
      if (!userRows.length) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: true, message: 'User not found' });
      }

      // Snapshot event IDs so we can reap R2 storage after commit.
      const { rows: evRows } = await client.query(
        'SELECT id FROM events WHERE user_id = $1', [id],
      );
      eventIds = evRows.map(r => r.id);

      if (eventIds.length) {
        // Snapshot storage keys before cascade removes the rows.
        ({ rows: allUploadRows } = await client.query(
          `SELECT original_key, compressed_key, file_url, web_url, poster_url
             FROM uploads WHERE event_id = ANY($1)`,
          [eventIds],
        ));
        ({ rows: allMusicRows } = await client.query(
          `SELECT r2_key FROM music_tracks
            WHERE event_id = ANY($1) AND r2_key IS NOT NULL`,
          [eventIds],
        ));

        // Null payment event_id refs before events are deleted (no cascade on payments).
        await client.query(
          'UPDATE payments SET event_id = NULL WHERE event_id = ANY($1)', [eventIds],
        );

        // Delete events — cascades uploads, music_tracks, reactions, polls, event_sde, etc.
        await client.query('DELETE FROM events WHERE user_id = $1', [id]);
      }

      // Null remaining user FK refs that have no cascade.
      await client.query('UPDATE payments SET user_id = NULL WHERE user_id = $1', [id]);

      await client.query('DELETE FROM users WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }

    // Reap R2 storage for every deleted event (best-effort, never throws).
    for (let i = 0; i < eventIds.length; i++) {
      await reapEventStorage(fastify, eventIds[i], allUploadRows, allMusicRows, request.log);
    }

    return { success: true };
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
      const winStart  = uploadWindowStartFor(plan.id, stampDate);
      const winEnd    = uploadWindowEndFor(plan.id, stampDate);
      const gal       = galleryExpiryFor(plan.id, stampDate);
      const { rows: out } = await fastify.db.query(
        `UPDATE events
            SET plan                    = $2,
                upload_window_starts_at = $3,
                upload_window_ends_at   = $4,
                gallery_expires_at      = $5
          WHERE slug = $1
          RETURNING slug, plan, event_date,
                    upload_window_starts_at, upload_window_ends_at, gallery_expires_at`,
        [slug, plan.id, winStart, winEnd, gal],
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
              u.events_remaining,
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
