/**
 * Wall reactions — guests tap an emoji on the upload page, the wall
 * floats it up over the current slide.
 *
 * Public, no auth: identity is the X-Guest-Id token + a guest_name
 * captured at react-time. The rate-limiter is keyed on the same
 * X-Guest-Id so guests on shared venue WiFi each get their own bucket.
 *
 * Plan-gated: reactions feature flag (Sinag and above per
 * backend/lib/plans.js).
 */

import { resolvePlan } from '../lib/plans.js';
import { kickOffRender } from '../lib/sdeRender.js';

// Closed allow-list. Stops anyone from POSTing arbitrary unicode that
// would either break the wall layout or be used as a hidden channel.
// Skewed toward positive / celebration emoji — events are happy moments,
// no need for the angry / sad end of the spectrum.
const ALLOWED_EMOJI = [
  '❤️', '😂', '🔥', '👏', '💃', '🙏',
  '🥰', '✨', '🎉', '🥹', '🌹', '💖',
];

// SDE now-showing beacon: the wall reports its current slide via
// ?showing=<uuid> on its existing reactions poll so guest reactions
// (which carry no upload_id) can be credited to whatever is on screen.
// In-memory + single-process — confirmed safe, see
// docs/same-day-edit-plan.md §3.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOW_SHOWING_TTL_MS = 30_000;  // ignore the pointer if the wall stopped beaconing

export default async function reactionsRoutes(fastify) {
  // Tighter bucket for the write side — each row is a DB insert and
  // immediately fans out to every connected wall on its next poll.
  const REACT_WRITE_LIMIT = {
    rateLimit: {
      max: 60,                 // ~1/sec sustained per device
      timeWindow: '1 minute',
      keyGenerator: fastify.limiterKey,
      errorResponseBuilder: () => fastify.friendlyRateLimit,
    },
  };

  // Slug → { id, plan-allows-reactions } memo. Reaction bursts hammered
  // this lookup once per write (events JOIN users); during a storm the
  // pool drained and other events' wall GETs queued behind it. Cache
  // for a few seconds so plan/tier changes still propagate quickly.
  const EVENT_CACHE_TTL_MS = 5_000;
  const eventCache = new Map(); // slug -> { expires, event | null }

  // slug -> { uploadId, since } — last slide the wall reported showing.
  // Bounded by the number of active event slugs (one entry each).
  const nowShowing = new Map();

  // SDE auto-render: once we've fired (or confirmed already done /
  // ineligible), the slug is added here and we skip the check on
  // subsequent polls. Bounded by total slug count over process lifetime
  // (one tiny entry each); transient errors get the entry removed so
  // the next poll retries. See Slice 2D in docs/SDE-HANDOVER.md.
  const autoRenderFired = new Set();

  async function loadEventForReactions(slug, reply) {
    const now = Date.now();
    const hit = eventCache.get(slug);
    if (hit && hit.expires > now) {
      if (!hit.event) {
        reply.status(404).send({ error: true, message: 'Event not found' });
        return null;
      }
      if (!hit.allowed) {
        reply.status(403).send({
          error: true,
          code: 'reactions_locked',
          message: hit.event?.reactions_enabled === false
            ? 'Wall reactions are turned off for this event.'
            : 'Reactions need a Sinag plan or higher.',
        });
        return null;
      }
      return hit.event;
    }

    const { rows } = await fastify.db.query(
      `SELECT e.id, e.is_active, e.user_id, e.plan, e.reactions_enabled, u.subscription_tier
         FROM events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.slug = $1`,
      [slug],
    );
    if (!rows.length || rows[0].is_active === false) {
      eventCache.set(slug, { expires: now + EVENT_CACHE_TTL_MS, event: null });
      reply.status(404).send({ error: true, message: 'Event not found' });
      return null;
    }
    const event = rows[0];
    // Per-event tier: events.plan is the source of truth (locked at
    // create/upgrade). subscription_tier kept as legacy fallback.
    const plan  = resolvePlan(event.plan || event.subscription_tier || 'tala');
    const allowed = !!plan.features?.reactions && event.reactions_enabled !== false;
    eventCache.set(slug, { expires: now + EVENT_CACHE_TTL_MS, event, allowed });
    if (!allowed) {
      reply.status(403).send({
        error: true,
        code: 'reactions_locked',
        message: event.reactions_enabled === false
          ? 'Wall reactions are turned off for this event.'
          : 'Reactions need a Sinag plan or higher.',
      });
      return null;
    }
    return event;
  }

  // POST /api/reactions/:slug — record a single reaction.
  fastify.post('/reactions/:slug', { config: REACT_WRITE_LIMIT }, async (request, reply) => {
    const { slug } = request.params;
    const { emoji, upload_id, guest_name } = request.body ?? {};

    if (!ALLOWED_EMOJI.includes(emoji)) {
      return reply.status(400).send({ error: true, message: 'Invalid emoji' });
    }
    const name = (guest_name || '').trim();
    if (!name) {
      return reply.status(400).send({ error: true, message: 'Guest name is required to react' });
    }
    if (name.length > 120) {
      return reply.status(400).send({ error: true, message: 'Name too long' });
    }

    const event = await loadEventForReactions(slug, reply);
    if (!event) return;

    const guestId = String(request.headers['x-guest-id'] || request.ip).slice(0, 64);

    // The reaction panel sends no upload_id (the common case). Attribute
    // the tap to whatever the wall last reported it was showing for this
    // event, as long as that beacon is still fresh. The INSERT's
    // subquery below still validates the id belongs to this event, so a
    // stale/foreign pointer degrades to NULL rather than mis-crediting.
    let effectiveUploadId = upload_id || null;
    if (!effectiveUploadId) {
      const ns = nowShowing.get(slug);
      if (ns && Date.now() - ns.since < NOW_SHOWING_TTL_MS) {
        effectiveUploadId = ns.uploadId;
      }
    }

    // upload_id is optional; verify it belongs to this event inline so
    // the whole write is a single round-trip — under reaction bursts the
    // old SELECT+INSERT pattern was draining the pool and freezing other
    // events' wall GETs.
    const { rows: inserted } = await fastify.db.query(
      `INSERT INTO reactions (event_id, upload_id, guest_id, guest_name, emoji)
       VALUES (
         $1,
         (SELECT id FROM uploads WHERE id = $2::uuid AND event_id = $1),
         $3, $4, $5
       )
       RETURNING id, created_at`,
      [event.id, effectiveUploadId, guestId, name, emoji],
    );
    return reply.status(201).send({ id: inserted[0].id, created_at: inserted[0].created_at });
  });

  // GET /api/reactions/:slug?since=<iso> — wall polls this on a tick.
  // Returns only reactions newer than `since` so payloads stay tiny.
  // No plan gate on read so the wall on a downgraded event still
  // empties its queue (returns []).
  fastify.get('/reactions/:slug', async (request, reply) => {
    const { slug } = request.params;
    const since = request.query?.since;

    // Now-showing beacon: the wall appends ?showing=<current upload id>
    // to this poll it already makes every ~1s. Record it so guest
    // reactions can be attributed to the slide on screen. No DB write,
    // no extra query — just an in-memory pointer. See sde plan §3.
    const showing = request.query?.showing;
    if (typeof showing === 'string' && UUID_RE.test(showing)) {
      nowShowing.set(slug, { uploadId: showing, since: Date.now() });
    }

    try {
      let sinceTs;
      try {
        sinceTs = since ? new Date(since) : new Date(Date.now() - 5 * 60 * 1000);
      } catch {
        sinceTs = new Date(Date.now() - 5 * 60 * 1000);
      }
      if (Number.isNaN(sinceTs.getTime())) {
        sinceTs = new Date(Date.now() - 5 * 60 * 1000);
      }

      // Reuse the POST handler's event cache (slug → {event, expires}) to skip
      // a DB round-trip on the hot read path. Cache miss falls back to a single
      // JOIN query. Wall polls every 1s — without this it was 2 DB queries/poll.
      let cachedEv = eventCache.get(slug);
      let event;
      if (cachedEv && cachedEv.expires > Date.now()) {
        if (!cachedEv.event) {
          return reply.status(404).send({ error: true, message: 'Event not found' });
        }
        if (!cachedEv.allowed) {
          return reply.send({ reactions: [], server_time: new Date().toISOString(), sde_play: null });
        }
        event = cachedEv.event;
      } else {
        // Load full event fields (not just id) so the cached row has
        // everything both the POST plan-gate AND Slice 2D's auto-render
        // check need. Cache miss penalty is one tiny JOIN.
        const { rows: evRows } = await fastify.db.query(
          `SELECT e.id, e.plan, e.user_id, e.is_active, e.upload_window_ends_at,
                  e.reactions_enabled,
                  u.subscription_tier
             FROM events e
             LEFT JOIN users u ON u.id = e.user_id
            WHERE e.slug = $1 AND e.is_active = true`,
          [slug],
        );
        if (!evRows.length) {
          eventCache.set(slug, { expires: Date.now() + EVENT_CACHE_TTL_MS, event: null });
          return reply.status(404).send({ error: true, message: 'Event not found' });
        }
        event = evRows[0];
        const plan = resolvePlan(event.plan || event.subscription_tier || 'tala');
        eventCache.set(slug, {
          expires: Date.now() + EVENT_CACHE_TTL_MS,
          event,
          allowed: !!plan.features?.reactions && event.reactions_enabled !== false,
        });
        if (!plan.features?.reactions || event.reactions_enabled === false) {
          return reply.send({ reactions: [], server_time: new Date().toISOString(), sde_play: null });
        }
      }
      const eventId = event.id;

      const { rows } = await fastify.db.query(
        `SELECT id, emoji, guest_name, upload_id, created_at
           FROM reactions
          WHERE event_id = $1 AND created_at > $2
          ORDER BY created_at ASC
          LIMIT 200`,
        [eventId, sinceTs],
      );

      // ── SDE play state + auto-render check (Slice 2D) ──
      // One JOIN'd lookup carries both signals so we don't double the DB
      // load on the hot wall-poll path. Skipped entirely if the event's
      // plan doesn't include SDE (cheap plan resolve from cached event).
      const plan = resolvePlan(event.plan || event.subscription_tier || 'tala');
      let sde_play = null;
      if (plan.features?.sde) {
        const { rows: sdeRows } = await fastify.db.query(
          `SELECT e.sde_play_requested_at,
                  e.sde_play_cleared_at,
                  s.status         AS sde_status,
                  s.auto_rendered  AS sde_auto_rendered,
                  s.video_url      AS sde_video_url,
                  s.poster_url     AS sde_poster_url,
                  s.duration_s     AS sde_duration_s
             FROM events e
             LEFT JOIN event_sde s ON s.event_id = e.id
            WHERE e.id = $1
            LIMIT 1`,
          [eventId],
        );
        const sd        = sdeRows[0] || {};
        const requested = sd.sde_play_requested_at;
        const cleared   = sd.sde_play_cleared_at;
        const playActive = requested && (!cleared || new Date(cleared) < new Date(requested));
        if (playActive && sd.sde_status === 'ready' && sd.sde_video_url) {
          sde_play = {
            video_url:    sd.sde_video_url,
            poster_url:   sd.sde_poster_url,
            duration_s:   sd.sde_duration_s,
            requested_at: requested,
          };
        }

        // Auto-render trigger: when the upload window has closed and
        // no render has fired yet, kick one off. Fire-and-forget — the
        // wall doesn't wait on us. autoRenderFired set deduplicates
        // across the 1Hz poll storm + multi-wall events.
        if (!autoRenderFired.has(slug) && event.upload_window_ends_at) {
          const closed = new Date(event.upload_window_ends_at) < new Date();
          if (closed) {
            const inFlight = sd.sde_status === 'queued' || sd.sde_status === 'rendering';
            const settled  = sd.sde_status === 'ready'  || sd.sde_auto_rendered === true;
            if (inFlight || settled) {
              autoRenderFired.add(slug); // already handled
            } else {
              // Eligible: row missing or {status:'idle' OR 'error'} AND auto_rendered=false.
              // Optimistic add prevents a second concurrent poll from double-firing;
              // a transient failure removes it so the next poll can retry.
              autoRenderFired.add(slug);
              fastify.db.query(
                `SELECT id, slug, couple_names, event_date, venue
                   FROM events WHERE id = $1`,
                [eventId],
              ).then(({ rows: fullRows }) => {
                if (!fullRows.length) return null;
                return kickOffRender(fastify, fullRows[0], { auto_rendered: true });
              }).then(result => {
                if (result) fastify.log.info(
                  { event_id: eventId, slug, clip_count: result.clip_count },
                  'sde auto-render fired (upload-window closed)',
                );
              }).catch(err => {
                const terminal = err.code === 'sde_in_flight' || err.code === 'sde_no_clips';
                fastify.log.warn(
                  { err: err.message, code: err.code, event_id: eventId, slug, terminal },
                  'sde auto-render failed',
                );
                if (!terminal) autoRenderFired.delete(slug); // allow retry on next poll
              });
            }
          }
        }
      } else {
        // Plan doesn't include SDE — never check this slug again.
        autoRenderFired.add(slug);
      }

      // Stash on reply so the response builder below sees everything.
      reply.__reactions_rows = rows;
      reply.__sde_play = sde_play;
    } catch (err) {
      request.log.error({
        where: 'GET /api/reactions/:slug',
        slug,
        since,
        errName: err?.name,
        errMessage: err?.message,
        errCode: err?.code,
        errDetail: err?.detail,
        stack: err?.stack,
      }, 'reactions.get failed');
      return reply.status(500).send({ error: true, message: 'reactions read failed' });
    }
    const rows = reply.__reactions_rows;

    reply.header('Cache-Control', 'no-store');
    return {
      reactions:   rows,
      server_time: new Date().toISOString(),
      sde_play:    reply.__sde_play ?? null, // present + non-null when wall should enter takeover
    };
  });
}
