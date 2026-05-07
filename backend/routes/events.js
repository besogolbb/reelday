import { generateQR } from '../utils/qr.js';
import { resolvePlan, galleryExpiryFor, uploadWindowEndFor } from '../lib/plans.js';
import { verifyToken } from '../plugins/auth.js';

function makeSlug(coupleNames) {
  const base = coupleNames
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanum → dash
    .replace(/^-+|-+$/g, '')        // trim leading/trailing dashes
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6); // 4 random chars
  return `${base}-${suffix}`;
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
    `SELECT id, subscription_tier, subscription_expires_at, events_remaining
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

    const slug = makeSlug(couple_names);

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

    // Decrement events_remaining if it's set (paid-tier credit pool)
    if (user.events_remaining !== null && user.events_remaining !== undefined) {
      await fastify.db.query(
        `UPDATE users SET events_remaining = GREATEST(events_remaining - 1, 0) WHERE id = $1`,
        [userId],
      );
    }

    const event   = rows[0];

    // Generate the QR code encoding the full absolute URL based on the current request host
    const protocol = request.headers['x-forwarded-proto'] || 'https';
    const host = process.env.NODE_ENV === 'development' ? (request.headers.host || 'localhost:3000') : 'reelday.ph';
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
  // Body: { ids: ['<upload-uuid>', ...] }. Pass an empty array to
  // signal "stop the current burst and resume photos immediately".
  fastify.post('/events/:slug/play-videos', async (request, reply) => {
    const { slug } = request.params;
    const ids = Array.isArray(request.body?.ids) ? request.body.ids : [];

    // Ensure each id is actually an upload on this event so we don't
    // queue arbitrary UUIDs from outside.
    let validIds = [];
    if (ids.length) {
      const { rows: validRows } = await fastify.db.query(
        `SELECT id FROM uploads
          WHERE event_id = (SELECT id FROM events WHERE slug = $1)
            AND id = ANY($2::uuid[])
            AND is_approved = true`,
        [slug, ids],
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

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

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

    // Encode the full upload URL so a phone scan opens the right page,
    // matching how POST /events generates the initial QR.
    const protocol = request.headers['x-forwarded-proto'] || 'https';
    const host = process.env.NODE_ENV === 'development'
      ? (request.headers.host || 'localhost:3000')
      : 'reelday.ph';
    const qr_code = await generateQR(`${protocol}://${host}/upload/${slug}`);
    return { qr_code };
  });

  // PATCH /api/events/:slug — update event settings
  fastify.patch('/events/:slug', async (request, reply) => {
    const { slug } = request.params;
    const {
      couple_names, event_date, cover_photo_url, is_active,
      venue, event_time, welcome_message,
      video_auto_approve,
      video_message_auto_approve,
    } = request.body ?? {};

    // Treat empty string as "clear this field"; treat undefined as "leave alone"
    const orNull = v => (v === undefined ? null : v);

    const { rows } = await fastify.db.query(
      `UPDATE events
       SET couple_names               = COALESCE($2, couple_names),
           event_date                 = COALESCE($3, event_date),
           cover_photo_url            = COALESCE($4, cover_photo_url),
           is_active                  = COALESCE($5, is_active),
           venue                      = COALESCE($6, venue),
           event_time                 = COALESCE($7, event_time),
           welcome_message            = COALESCE($8, welcome_message),
           video_auto_approve         = COALESCE($9,  video_auto_approve),
           video_message_auto_approve = COALESCE($10, video_message_auto_approve)
       WHERE slug = $1
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
        typeof video_auto_approve         === 'boolean' ? video_auto_approve         : null,
        typeof video_message_auto_approve === 'boolean' ? video_message_auto_approve : null,
      ],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    return { event: rows[0] };
  });
}
