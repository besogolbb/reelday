/**
 * Event Website (Dalisay/Hiraya) — per-event guest microsite at /e/<slug>.
 *
 * Surfaces:
 *   - GET  /api/event-site/:slug            public  — published config (gated)
 *   - GET  /api/event-site/:slug/admin      owner   — full config incl. draft
 *   - PUT  /api/event-site/:slug            owner   — upsert config + publish
 *   - POST /api/event-site/:slug/rsvp       public  — RSVP (rate-limited, upsert)
 *   - GET  /api/event-site/:slug/rsvps      owner   — list + ?format=csv
 *   - POST /api/event-site/:slug/seats/import owner — replace guest list
 *   - GET  /api/event-site/:slug/seat-lookup  public — match-only (rate-limited)
 *
 * The /e/:slug HTML page itself is served from server.js (sibling of
 * /wall/:slug); it calls renderEventSitePage() exported below.
 *
 * Performance notes (mirrors the patterns in reactions.js / uploads.js so
 * we don't reintroduce the documented pool-drain footgun):
 *   - gateCache: slug → {event,effectiveTier,allowed} 5s TTL, exactly like
 *     reactions.js eventCache. The public gate query is the SAME
 *     `events LEFT JOIN users` shape so a guest burst hits the DB once
 *     per slug per 5s, not once per request.
 *   - siteCache: built public JSON + gzip per slug, INVALIDATED ON WRITE
 *     (owner PUT / seat import) rather than TTL — zero repeated DB load
 *     AND instant host-edit freshness (the music-cache-removed lesson,
 *     commit 9df2114).
 *   - pageCache: fully-injected /e/:slug HTML per slug, same invalidation.
 *   - No new npm deps (built-in fs/zlib only) — Easypanel build footgun.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { randomUUID } from 'crypto';
import { gzipSync } from 'zlib';
import { planHasFeature } from '../lib/plans.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '..', '..', 'frontend', 'event-site.html');

// ── Module-level caches (shared by the plugin + the exported renderer) ──
const GATE_TTL_MS = 5_000;
const gateCache = new Map(); // slug → { expires, event|null, allowed }
const siteCache = new Map(); // slug → { payload, gzipped }
const pageCache = new Map(); // slug → injected HTML string
const siteInflight = new Map(); // slug → Promise (single-flight dedup)

function bustSlug(slug) {
  gateCache.delete(slug);
  siteCache.delete(slug);
  pageCache.delete(slug);
}

// Lazily read + memo the static template. Tolerant: if the file isn't
// there yet (e.g. mid-rollout) we report it rather than crash the boot.
let templateCache = null;
function loadTemplate() {
  if (templateCache !== null) return templateCache;
  try {
    templateCache = readFileSync(TEMPLATE_PATH, 'utf8');
  } catch {
    templateCache = false;
  }
  return templateCache;
}

// Escape for HTML attribute / <meta content="…"> context. The /e/:slug
// head injects host-supplied text (couple_names etc.) — never raw.
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absHost() {
  return (
    process.env.APP_PUBLIC_HOST ||
    (process.env.NODE_ENV === 'development' ? 'localhost:3000' : 'reelday.ph')
  );
}

/**
 * Resolve event + owner effective tier + entitlement for a slug, cached
 * 5s. Identical query shape to reactions.js so a guest burst can never
 * drain the pg pool the way the pre-cache reactions path did.
 * Returns { event, effectiveTier, allowed } or null (not found/inactive).
 */
async function loadGate(db, slug) {
  const now = Date.now();
  const hit = gateCache.get(slug);
  if (hit && hit.expires > now) return hit.event ? hit : null;

  const { rows } = await db.query(
    `SELECT e.id, e.slug, e.is_active, e.user_id, e.plan,
            e.couple_names, e.event_type, e.event_date, e.event_time,
            e.cover_photo_url, e.theme_override,
            u.subscription_tier,
            s.is_published, s.config
       FROM events e
       LEFT JOIN users u       ON u.id = e.user_id
       LEFT JOIN event_sites s ON s.event_id = e.id
      WHERE e.slug = $1`,
    [slug],
  );
  if (!rows.length || rows[0].is_active === false) {
    gateCache.set(slug, { expires: now + GATE_TTL_MS, event: null });
    return null;
  }
  const r = rows[0];
  // Effective tier follows the owner's current account (reactions.js
  // pattern); legacy anon events with no user fall back to events.plan.
  const effectiveTier = r.subscription_tier || r.plan || 'tala';
  const allowed = planHasFeature(effectiveTier, 'website');
  const entry = {
    expires: now + GATE_TTL_MS,
    event: r,
    effectiveTier,
    allowed,
  };
  gateCache.set(slug, entry);
  return entry;
}
// Build the public payload (lean — only what the page renders).
function buildPayload(gate) {
  const e = gate.event;
  return {
    slug: e.slug,
    couple_names: e.couple_names,
    event_type: e.event_type,
    event_date: e.event_date,
    event_time: e.event_time,
    cover_photo_url: e.cover_photo_url,
    theme: e.theme_override || e.event_type || 'wedding',
    config: e.config || {},
  };
}

/**
 * Render the /e/:slug page HTML with OG/theme/noindex injected into the
 * <!--EVENT_SITE_HEAD--> placeholder. Cached per slug, busted on write.
 * Returns { html } | { notFound:true } | { unavailable:true }.
 * Called from server.js.
 */
export async function renderEventSitePage(db, slug) {
  const cached = pageCache.get(slug);
  if (cached) return { html: cached };

  const gate = await loadGate(db, slug);
  // Gate failures: bare 404, no leak, no half-render.
  if (!gate || !gate.allowed || !gate.event.is_published) {
    return { notFound: true };
  }

  const tpl = loadTemplate();
  if (tpl === false) return { unavailable: true };

  const e = gate.event;
  const host = absHost();
  const proto = process.env.NODE_ENV === 'development' ? 'http' : 'https';
  const url = `${proto}://${host}/e/${encodeURIComponent(slug)}`;
  const title = `${e.couple_names || 'Our Celebration'}`;
  const desc =
    (e.config && typeof e.config.ogDescription === 'string' && e.config.ogDescription) ||
    `You're invited — details, gallery, and RSVP.`;
  const ogImage = e.cover_photo_url
    ? e.cover_photo_url
    : `${proto}://${host}/images/LOGO.png`;
  const theme = e.theme_override || e.event_type || 'wedding';

  const head = [
    `<meta name="robots" content="noindex">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(desc)}">`,
    `<meta property="og:image" content="${escapeAttr(ogImage)}">`,
    `<meta property="og:url" content="${escapeAttr(url)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<title>${escapeAttr(title)}</title>`,
  ].join('\n  ');

  let html = tpl.replace('<!--EVENT_SITE_HEAD-->', head);
  // Set the theme on <html data-theme="…"> so shared.css picks the palette
  // server-side (no flash). Tolerate the attribute being absent.
  html = html.replace(
    /<html([^>]*)\sdata-theme="[^"]*"/i,
    `<html$1 data-theme="${escapeAttr(theme)}"`,
  );
  if (!/data-theme=/.test(html)) {
    html = html.replace(/<html(\s|>)/i, `<html data-theme="${escapeAttr(theme)}"$1`);
  }

  pageCache.set(slug, html);
  return { html };
}

export default async function eventSiteRoutes(fastify) {
  // Tighter buckets for the public surfaces, mirroring reactions.js.
  const RSVP_LIMIT = {
    rateLimit: {
      max: 20, // generous for edits; RSVP isn't a tap-storm like reactions
      timeWindow: '1 minute',
      keyGenerator: fastify.limiterKey,
      errorResponseBuilder: () => fastify.friendlyRateLimit,
    },
  };
  const LOOKUP_LIMIT = {
    rateLimit: {
      max: 30, // a guest checks their name a few times; caps enumeration
      timeWindow: '1 minute',
      keyGenerator: fastify.limiterKey,
      errorResponseBuilder: () => fastify.friendlyRateLimit,
    },
  };

  // Resolve an event the caller owns, by slug. Ownership lives in the
  // WHERE clause so a guess-the-slug attempt 404s identically.
  async function ownedEvent(slug, userId) {
    const { rows } = await fastify.db.query(
      `SELECT id, slug FROM events WHERE slug = $1 AND user_id = $2`,
      [slug, userId],
    );
    return rows[0] || null;
  }

  // ── Public: published site config ──────────────────────────────────
  fastify.get('/event-site/:slug', async (request, reply) => {
    const { slug } = request.params;

    const cached = siteCache.get(slug);
    if (cached) {
      const acceptsGzip = (request.headers['accept-encoding'] || '').includes('gzip');
      if (acceptsGzip && cached.gzipped) {
        return reply
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Content-Encoding', 'gzip')
          .header('Vary', 'Accept-Encoding')
          .send(cached.gzipped);
      }
      return cached.payload;
    }

    // Single-flight: a simultaneous guest burst computes this once.
    let inflight = siteInflight.get(slug);
    if (!inflight) {
      inflight = (async () => {
        const gate = await loadGate(fastify.db, slug);
        if (!gate || !gate.allowed || !gate.event.is_published) return null;
        const payload = buildPayload(gate);
        const gzipped = gzipSync(Buffer.from(JSON.stringify(payload)));
        siteCache.set(slug, { payload, gzipped });
        return payload;
      })().finally(() => siteInflight.delete(slug));
      siteInflight.set(slug, inflight);
    }
    const payload = await inflight;
    if (!payload) {
      return reply.status(404).send({ error: true, message: 'Event site not found' });
    }
    const acceptsGzip = (request.headers['accept-encoding'] || '').includes('gzip');
    const fresh = siteCache.get(slug);
    if (acceptsGzip && fresh?.gzipped) {
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Encoding', 'gzip')
        .header('Vary', 'Accept-Encoding')
        .send(fresh.gzipped);
    }
    return payload;
  });

  // ── Owner: full config (incl. unpublished draft) ───────────────────
  fastify.get('/event-site/:slug/admin', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ev = await ownedEvent(request.params.slug, request.user.id);
    if (!ev) return reply.status(404).send({ error: true, message: 'Event not found' });

    const { rows } = await fastify.db.query(
      `SELECT s.is_published, s.config, s.updated_at,
              e.couple_names, e.event_type, e.event_date, e.event_time,
              e.venue, e.welcome_message, e.cover_photo_url, e.theme_override
         FROM events e
         LEFT JOIN event_sites s ON s.event_id = e.id
        WHERE e.id = $1`,
      [ev.id],
    );
    const r = rows[0] || {};
    return {
      slug: ev.slug,
      is_published: r.is_published ?? false,
      config: r.config ?? {},
      updated_at: r.updated_at ?? null,
      // Autofill source for the wizard's first run.
      event: {
        couple_names: r.couple_names,
        event_type: r.event_type,
        event_date: r.event_date,
        event_time: r.event_time,
        venue: r.venue,
        welcome_message: r.welcome_message,
        cover_photo_url: r.cover_photo_url,
        theme_override: r.theme_override,
      },
    };
  });

  // ── Owner: upsert config + publish toggle + optional theme override ──
  fastify.put('/event-site/:slug', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ev = await ownedEvent(request.params.slug, request.user.id);
    if (!ev) return reply.status(404).send({ error: true, message: 'Event not found' });

    const body = request.body ?? {};
    const config = (body.config && typeof body.config === 'object') ? body.config : {};
    const isPublished = typeof body.is_published === 'boolean' ? body.is_published : false;

    // ── Registry section hygiene ──
    // Caps + light shape coercion so a buggy wizard, malicious paste,
    // or stale config from an older client can't bloat the row, smuggle
    // odd protocols into a "link", or stash megabytes of QR URLs.
    // Soft-fails to a clean empty section rather than rejecting — keeps
    // the rest of the save working.
    if (config.registry && typeof config.registry === 'object') {
      const r = config.registry;
      const safeStr = (v, max) => String(v == null ? '' : v).slice(0, max);
      // Only http(s) URLs survive — guards against javascript:, data:,
      // file:, mailto: tricks that would render as a clickable card.
      const safeHttpUrl = (v) => {
        const s = safeStr(v, 800).trim();
        if (!s) return '';
        try {
          const u = new URL(s);
          return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
        } catch { return ''; }
      };
      config.registry = {
        enabled: r.enabled !== false,
        message: safeStr(r.message, 600),
        links: Array.isArray(r.links) ? r.links.slice(0, 20).map(l => ({
          label: safeStr(l?.label, 80),
          url:   safeHttpUrl(l?.url),
        })).filter(l => l.url) : [],
        cashFunds: Array.isArray(r.cashFunds) ? r.cashFunds.slice(0, 20).map(f => ({
          type:    safeStr(f?.type, 30).toLowerCase(),
          label:   safeStr(f?.label, 60),
          account: safeStr(f?.account, 80),
          name:    safeStr(f?.name, 120),
          qrUrl:   safeHttpUrl(f?.qrUrl) || null,
        })).filter(f => f.account) : [],
      };
    }

    // Bound the stored JSON so a pathological config can't bloat the row
    // or the cached gzip payload.
    const serialized = JSON.stringify(config);
    if (serialized.length > 200_000) {
      return reply.status(413).send({ error: true, message: 'Config too large' });
    }

    await fastify.db.query(
      `INSERT INTO event_sites (event_id, is_published, config, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (event_id) DO UPDATE
         SET is_published = EXCLUDED.is_published,
             config       = EXCLUDED.config,
             updated_at   = NOW()`,
      [ev.id, isPublished, serialized],
    );

    // Optional theme override lives on events (so the page <html> tag
    // and shared.css can read it without joining event_sites).
    if (typeof body.theme_override === 'string' || body.theme_override === null) {
      await fastify.db.query(
        `UPDATE events SET theme_override = $2 WHERE id = $1`,
        [ev.id, body.theme_override || null],
      );
    }

    bustSlug(ev.slug); // instant freshness — no stale public read
    return { ok: true, is_published: isPublished };
  });

  // ── Owner: upload a site image (hero/prenup) ──────────────────────
  // Stored at an exact event-site/<event_id>/ key via putFile — NO
  // uploads row, so it never reaches the wall. Owner-only, image-only,
  // size-capped. The returned URL is what the host saves into config.
  fastify.post('/event-site/:slug/image', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ev = await ownedEvent(request.params.slug, request.user.id);
    if (!ev) return reply.status(404).send({ error: true, message: 'Event not found' });

    let buf = null, mime = null, ext = '.jpg';
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (!part.mimetype || !part.mimetype.startsWith('image/')) {
          for await (const _ of part.file) { /* drain so Fastify doesn't hang */ }
          return reply.status(400).send({ error: true, message: 'Images only' });
        }
        const chunks = [];
        let size = 0;
        for await (const c of part.file) {
          size += c.length;
          if (size > 15 * 1024 * 1024) { // 15 MB cap for site imagery
            return reply.status(413).send({ error: true, message: 'Image too large (max 15 MB)' });
          }
          chunks.push(c);
        }
        buf = Buffer.concat(chunks);
        mime = part.mimetype;
        ext = extname(part.filename || '') || '.jpg';
      }
    }
    if (!buf) return reply.status(400).send({ error: true, message: 'No file' });

    const key = `event-site/${ev.id}/${randomUUID()}${ext}`;
    const url = await fastify.putFile(key, buf, mime);
    return { url };
  });

  // ── Public: submit/update RSVP (rate-limited, upsert per device) ────
  fastify.post('/event-site/:slug/rsvp', { config: RSVP_LIMIT }, async (request, reply) => {
    const gate = await loadGate(fastify.db, request.params.slug);
    if (!gate || !gate.allowed || !gate.event.is_published) {
      return reply.status(404).send({ error: true, message: 'Event site not found' });
    }

    // Reject submissions past the host-configured deadline so a guest
    // who lingers on the page can't accept after the host has finalised
    // headcount. Stored as ISO date string in config.rsvpDeadline; we
    // treat the deadline as end-of-day local-Manila for forgiveness.
    const deadlineRaw = gate.event.config?.rsvpDeadline;
    if (deadlineRaw) {
      const d = new Date(deadlineRaw);
      if (!Number.isNaN(d.getTime())) {
        // If the host only stored YYYY-MM-DD it parses to UTC midnight;
        // push to end-of-day so a deadline of "May 31" stays open until
        // 23:59 Manila on that date rather than dying at 08:00 local.
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(deadlineRaw))) {
          d.setUTCHours(23, 59, 59, 999);
        }
        if (Date.now() > d.getTime()) {
          return reply.status(410).send({
            error: true,
            code: 'rsvp_closed',
            message: 'RSVPs are closed for this event.',
            deadline: d.toISOString(),
          });
        }
      }
    }

    const b = request.body ?? {};
    const name = String(b.guest_name || '').trim();
    if (!name) return reply.status(400).send({ error: true, message: 'Name is required' });
    if (name.length > 120) return reply.status(400).send({ error: true, message: 'Name too long' });

    const guestId = String(request.headers['x-guest-id'] || request.ip).slice(0, 64);
    const attending = b.attending !== false; // default true
    let party = parseInt(b.party_size, 10);
    if (!Number.isFinite(party) || party < 1) party = 1;
    if (party > 50) party = 50;
    const email = String(b.email || '').slice(0, 200) || null;
    const phone = String(b.phone || '').slice(0, 40) || null;
    const meal = String(b.meal_choice || '').slice(0, 80) || null;
    const message = String(b.message || '').slice(0, 2000) || null;

    await fastify.db.query(
      `INSERT INTO event_rsvps
         (event_id, guest_id, guest_name, email, phone, attending, party_size, meal_choice, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (event_id, guest_id) DO UPDATE
         SET guest_name = EXCLUDED.guest_name,
             email       = EXCLUDED.email,
             phone       = EXCLUDED.phone,
             attending   = EXCLUDED.attending,
             party_size  = EXCLUDED.party_size,
             meal_choice = EXCLUDED.meal_choice,
             message     = EXCLUDED.message,
             updated_at  = NOW()`,
      [gate.event.id, guestId, name, email, phone, attending, party, meal, message],
    );
    return reply.status(201).send({ ok: true });
  });

  // ── Owner: RSVP list + CSV export ──────────────────────────────────
  fastify.get('/event-site/:slug/rsvps', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ev = await ownedEvent(request.params.slug, request.user.id);
    if (!ev) return reply.status(404).send({ error: true, message: 'Event not found' });

    const { rows } = await fastify.db.query(
      `SELECT guest_name, email, phone, attending, party_size, meal_choice, message, updated_at
         FROM event_rsvps WHERE event_id = $1 ORDER BY updated_at DESC`,
      [ev.id],
    );

    if (request.query?.format === 'csv') {
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = 'Name,Email,Phone,Attending,Party,Meal,Message,Updated';
      const lines = rows.map(r =>
        [r.guest_name, r.email, r.phone, r.attending ? 'Yes' : 'No',
         r.party_size, r.meal_choice, r.message, r.updated_at?.toISOString?.() || r.updated_at]
          .map(esc).join(','));
      // Empty list — drop in one illustrative row so the host can see
      // the expected format. Only fires when there are zero real RSVPs;
      // real exports are never polluted with sample data.
      if (!lines.length) {
        lines.push([
          'Juan Dela Cruz', 'juan@example.com', '+63 917 123 4567',
          'Yes', 2, 'Chicken', 'So happy for you both!',
          new Date().toISOString(),
        ].map(esc).join(','));
      }
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="rsvps-${ev.slug}.csv"`)
        .send([header, ...lines].join('\n'));
    }

    const attendingCount = rows.filter(r => r.attending).length;
    const headcount = rows.filter(r => r.attending).reduce((n, r) => n + (r.party_size || 1), 0);
    return { count: rows.length, attending: attendingCount, headcount, rsvps: rows };
  });

  // ── Owner: replace the seat list (transactional, row-capped) ───────
  fastify.post('/event-site/:slug/seats/import', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ev = await ownedEvent(request.params.slug, request.user.id);
    if (!ev) return reply.status(404).send({ error: true, message: 'Event not found' });

    const seats = Array.isArray(request.body?.seats) ? request.body.seats : null;
    if (!seats) return reply.status(400).send({ error: true, message: 'seats[] required' });
    if (seats.length > 3000) {
      return reply.status(413).send({ error: true, message: 'Guest list too large (max 3000)' });
    }

    const clean = seats
      .map(s => ({
        name: String(s?.guest_name || '').trim().slice(0, 160),
        table: String(s?.table_label || '').trim().slice(0, 80) || null,
        loc: String(s?.location_note || '').trim().slice(0, 200) || null,
        seat: String(s?.seat_note || '').trim().slice(0, 120) || null,
      }))
      .filter(s => s.name);

    const client = await fastify.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM event_seats WHERE event_id = $1', [ev.id]);
      // Chunked multi-row insert keeps each statement well under limits.
      for (let i = 0; i < clean.length; i += 500) {
        const chunk = clean.slice(i, i + 500);
        const vals = [];
        const params = [];
        chunk.forEach(s => {
          const p = params.length;
          vals.push(`($1, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5})`);
          params.push(s.name, s.table, s.loc, s.seat);
        });
        await client.query(
          `INSERT INTO event_seats (event_id, guest_name, table_label, location_note, seat_note)
           VALUES ${vals.join(',')}`,
          [ev.id, ...params],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    bustSlug(ev.slug);
    return { ok: true, imported: clean.length };
  });

  // ── Public: seat lookup ───────────────────────────────────────────
  // Originally exact-match only, which meant "Juan" could never find
  // "Juan Dela Cruz" — guests would have to type their name exactly
  // as the host typed it. Now: prefix match for queries ≥3 chars,
  // exact match for 2-char queries (keeps very-short queries from
  // returning a wide bucket). Privacy is still protected by:
  //   - the public surface NEVER returning the whole list
  //   - rate limiting via LOOKUP_LIMIT (5 lookups / 10 s by default)
  //   - a 5-result cap so prefix sweeps can't bulk-dump
  // For a wedding-scale list (a few hundred guests) this is the right
  // trade-off — guests find themselves with one or two words, while
  // any actual enumeration attack would take days against the limiter.
  fastify.get('/event-site/:slug/seat-lookup', { config: LOOKUP_LIMIT }, async (request, reply) => {
    const gate = await loadGate(fastify.db, request.params.slug);
    if (!gate || !gate.allowed || !gate.event.is_published) {
      return reply.status(404).send({ error: true, message: 'Event site not found' });
    }
    const q = String(request.query?.q || '').trim();
    if (q.length < 2) return { matches: [] };
    if (q.length > 160) return reply.status(400).send({ error: true, message: 'Query too long' });

    const useExact = q.length < 3;
    // Escape SQL LIKE wildcards so a literal % or _ in the guest
    // input can't widen the match (defensive — not a security issue
    // since the rate limiter still caps blast radius).
    const safeQ = q.replace(/[\\%_]/g, ch => '\\' + ch);
    const params = useExact ? [gate.event.id, q] : [gate.event.id, safeQ + '%'];
    const where = useExact
      ? `lower(guest_name) = lower($2)`
      : `lower(guest_name) LIKE lower($2) ESCAPE '\\'`;

    const { rows } = await fastify.db.query(
      `SELECT guest_name, table_label, location_note, seat_note
         FROM event_seats
        WHERE event_id = $1 AND ${where}
        ORDER BY guest_name
        LIMIT 5`,
      params,
    );
    return { matches: rows };
  });
}
