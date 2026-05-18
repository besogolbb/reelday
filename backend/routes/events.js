import { generateQR } from '../utils/qr.js';
import { resolvePlan, galleryExpiryFor, uploadWindowEndFor } from '../lib/plans.js';
import { verifyToken } from '../plugins/auth.js';

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
    `SELECT id, subscription_tier, subscription_expires_at,
            events_remaining, tala_used
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

export default async function eventRoutes(fastify) {
  // POST /api/events — create a new event (auth required)
  fastify.post('/events', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { couple_names, event_type, event_date } = request.body ?? {};

    if (!couple_names) {
      return reply.status(400).send({ error: true, message: 'couple_names is required' });
    }

    const userId = request.user.id;
    const user   = await loadUserWithPlan(fastify.db, userId);
    if (!user) {
      return reply.status(404).send({ error: true, message: 'User not found' });
    }

    const planForEvent = resolvePlan(user.subscription_tier);

    // ── Tala lifetime cap (1 free event per account, ever) ──
    // Hard rule that overrides the count-based check below — a Tala user
    // who deletes their event must NOT be able to claim another free
    // slot. tala_used is set the first time a plan='tala' row is
    // inserted (below) and is never cleared.
    if (planForEvent.id === 'tala' && user.tala_used) {
      return reply.status(403).send({
        error: true,
        code: 'plan_limit_events',
        message: `You've already used your free Tala event. Upgrade to add more.`,
        plan: planForEvent.id,
        tala_used: true,
      });
    }

    // ── Enforce events_remaining first (paid tiers), eventLimit second (Tala) ──
    if (user.events_remaining !== null && user.events_remaining !== undefined) {
      // User has a finite credit balance from a paid tier
      if (user.events_remaining <= 0) {
        return reply.status(403).send({
          error: true,
          code: 'plan_limit_events',
          message: `Your ${planForEvent.name} plan has no event credits left. Upgrade to add more.`,
          plan: planForEvent.id,
          events_remaining: 0,
        });
      }
    } else {
      // No credit balance — fall back to counting active events vs eventLimit
      const existing = await countUserActiveEvents(fastify.db, userId);
      if (existing >= planForEvent.eventLimit) {
        return reply.status(403).send({
          error: true,
          code: 'plan_limit_events',
          message: `Your ${planForEvent.name} plan allows ${planForEvent.eventLimit} active event${planForEvent.eventLimit === 1 ? '' : 's'}. Upgrade to add more.`,
          plan: planForEvent.id,
          event_limit: planForEvent.eventLimit,
          active_events: existing,
        });
      }
    }

    const stampDate          = event_date || new Date();
    const galleryExpiresAt   = galleryExpiryFor(planForEvent.id, stampDate);
    const uploadWindowEndsAt = uploadWindowEndFor(planForEvent.id, stampDate);

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
             gallery_expires_at, upload_window_ends_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            slug,
            couple_names,
            event_type ?? 'wedding',
            event_date ?? null,
            planForEvent.id,
            userId,
            galleryExpiresAt,
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

    // Decrement events_remaining if it's set (paid-tier credit pool)
    if (user.events_remaining !== null && user.events_remaining !== undefined) {
      await fastify.db.query(
        `UPDATE users SET events_remaining = GREATEST(events_remaining - 1, 0) WHERE id = $1`,
        [userId],
      );
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
    const qr_code = await generateQR(`${protocol}://${host}/upload/${slug}`);

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

    const { rows: countRows } = await fastify.db.query(
      'SELECT COUNT(*)::int AS count FROM uploads WHERE event_id = $1 AND is_approved = true',
      [event.id],
    );

    // Effective plan follows the owner's current account tier.
    // Tolerate the column not existing yet on un-migrated DBs.
    let effectiveTier = event.plan;
    if (event.user_id) {
      try {
        const { rows: ownerRows } = await fastify.db.query(
          `SELECT subscription_tier FROM users WHERE id = $1`,
          [event.user_id],
        );
        if (ownerRows.length && ownerRows[0].subscription_tier) {
          effectiveTier = ownerRows[0].subscription_tier;
        }
      } catch (e) {
        fastify.log.warn({ err: e.message }, 'subscription_tier lookup failed — schema may not be migrated');
      }
    }
    const planInfo = resolvePlan(effectiveTier);

    // Soft-lock state derived from stored expiry stamps
    const now = new Date();
    const galleryLocked = event.gallery_expires_at
      ? new Date(event.gallery_expires_at) < now
      : false;
    const uploadsClosed = event.upload_window_ends_at
      ? new Date(event.upload_window_ends_at) < now
      : false;

    return {
      event,
      upload_count: countRows[0].count,
      plan_info: {
        id:           planInfo.id,
        name:         planInfo.name,
        upload_limit: planInfo.uploadLimit,
        event_limit:  planInfo.eventLimit,
        features:     planInfo.features,
      },
      locks: {
        gallery_locked:  galleryLocked,
        uploads_closed:  uploadsClosed,
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
      couple_names, event_date, cover_photo_url, is_active,
      venue, event_time, welcome_message,
      auto_approve,
      video_auto_approve,
      video_message_auto_approve,
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
           event_date                 = COALESCE($3, event_date),
           cover_photo_url            = COALESCE($4, cover_photo_url),
           is_active                  = COALESCE($5, is_active),
           venue                      = COALESCE($6, venue),
           event_time                 = COALESCE($7, event_time),
           welcome_message            = COALESCE($8, welcome_message),
           auto_approve               = COALESCE($9,  auto_approve),
           video_auto_approve         = COALESCE($10, video_auto_approve),
           video_message_auto_approve = COALESCE($11, video_message_auto_approve),
           music_playlist_id          = CASE WHEN $13::boolean THEN $14::uuid ELSE music_playlist_id END,
           music_enabled              = COALESCE($15, music_enabled)
       WHERE slug = $1 AND user_id = $12
       RETURNING *`,
      [
        slug,
        couple_names    ?? null,
        event_date      ?? null,
        cover_photo_url ?? null,
        is_active       ?? null,
        orNull(venue),
        orNull(event_time),
        orNull(welcome_message),
        typeof auto_approve               === 'boolean' ? auto_approve               : null,
        typeof video_auto_approve         === 'boolean' ? video_auto_approve         : null,
        typeof video_message_auto_approve === 'boolean' ? video_message_auto_approve : null,
        request.user.id,
        musicPlaylistArg !== undefined,        // $13 — was a value (incl. null) provided?
        musicPlaylistArg ?? null,              // $14 — the value to set (or NULL to clear)
        typeof music_enabled === 'boolean' ? music_enabled : null,
      ],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    return { event: rows[0] };
  });
}
