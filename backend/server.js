import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config as loadEnv } from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';

import dbPlugin from './plugins/database.js';
import storagePlugin from './plugins/storage.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import eventRoutes from './routes/events.js';
import uploadRoutes from './routes/uploads.js';
import reactionRoutes from './routes/reactions.js';
import pollRoutes from './routes/polls.js';
import musicRoutes from './routes/music.js';
import sdeRoutes from './routes/sde.js';
import wallErrorsRoutes from './routes/wall-errors.js';
import paymentRoutes from './routes/payments.js';
import webhookRoutes from './routes/webhooks.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import contactRoutes from './routes/contact.js';
import presenceRoutes from './routes/presence.js';
import eventSiteRoutes, { renderEventSitePage } from './routes/event-site.js';
import { reconcilePendingTranscodes } from './lib/videoTranscode.js';
import { startRenewalReminderJob } from './jobs/renewal-reminders.js';
import { startGalleryCleanupJob }  from './jobs/gallery-cleanup.js';
import { startSdeLambdaPoller }    from './jobs/sde-lambda-poller.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from the same directory as this file (backend/.env)
loadEnv({ path: join(__dirname, '.env') });

// Fail loud and early if any required secret is missing. We've been bitten
// by silent fallbacks before — a missing JWT_SECRET shouldn't let the
// server boot with a baked-in default that ships in the repo.
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[boot] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('[boot] JWT_SECRET must be at least 32 characters (use a long random string)');
  process.exit(1);
}

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
});

// Server-Timing header on every API response so browser DevTools can split
// server processing time from Cloudflare/network overhead at a glance.
// e.g. "Server-Timing: app;dur=42" means Fastify took 42ms; if the browser
// shows 280ms total, ~238ms was Cloudflare+network — not the app's fault.
fastify.addHook('onRequest', (request, _reply, done) => {
  request.startAt = Date.now();
  done();
});
fastify.addHook('onSend', (request, reply, _payload, done) => {
  if (request.url?.startsWith('/api/')) {
    reply.header('Server-Timing', `app;dur=${Date.now() - (request.startAt ?? Date.now())}`);
  }
  done();
});

// Friendly rate-limit response shown to guests when they exceed a bucket.
// The frontend checks for code === 'rate_limited' and surfaces a toast.
const FRIENDLY_RATE_LIMIT = {
  error: true,
  code: 'rate_limited',
  message: 'Easy lang po! Masyado mabilis ang upload niyo. Wait ng konti.',
};

// At a real event every guest shares one WiFi (= one public IP). Keying
// the limiter on IP would lump them all into a single bucket — 6 guests
// would already eat a 20/min cap. We instead key on an opaque per-device
// token (sent as `X-Guest-Id` for guests or `X-Wall-Id` for wall TVs,
// generated and persisted client-side in localStorage). Falls back to
// the source IP for clients that don't send the header so the limit
// can never be fully bypassed.
const limiterKey = req =>
  (typeof req.headers['x-guest-id'] === 'string' && req.headers['x-guest-id'].slice(0, 64)) ||
  (typeof req.headers['x-wall-id']  === 'string' && req.headers['x-wall-id'].slice(0, 64))  ||
  req.ip;

await fastify.register(rateLimit, {
  global: true,
  max: 1200,                  // generous cap — supports 1,000 guest burst + multiple walls, bumped slightly for more headroom
  timeWindow: '1 minute',
  ban: 0,
  // Skip rate-limiting for:
  //   1. Logged-in hosts (auth header present) — they're triaging uploads
  //   2. Non-API routes (HTML pages, JS, CSS, images) — these are never abusive
  //      and previously a wall page just loading triggered the limiter on the host
  allowList: req =>
    Boolean(req.headers.authorization) ||
    !req.url.startsWith('/api/') ||
    /\.(html|css|js|png|jpg|jpeg|gif|svg|ico)$/i.test(req.url),
  keyGenerator: limiterKey,
  errorResponseBuilder: () => FRIENDLY_RATE_LIMIT,
  addHeaders: {
    'x-ratelimit-limit':     true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset':     true,
    'retry-after':           true,
  },
});
// Expose the limiter key strategy + friendly payload to route files so
// they can apply tighter, per-route buckets without re-implementing both.
fastify.decorate('limiterKey',          limiterKey);
fastify.decorate('friendlyRateLimit',   FRIENDLY_RATE_LIMIT);

// Baseline security headers. Started permissive on purpose — the frontend
// has ~9 inline <script> blocks and ~13 inline style= attrs across the
// HTML pages, so strict-CSP would break the site on first load. The
// allowlist below covers our actual third parties (R2 for images/video,
// PayMongo + Google identity for checkout/login, fonts.googleapis for
// the display font, Resend tracking pixels in emails). Tighten in a
// follow-up once we move inline scripts into /js files and add nonces.
//
// What this still buys us today:
//   - HSTS (1 year, includeSubDomains) — locks browsers to HTTPS
//   - X-Frame-Options: DENY (via frameAncestors) — kills clickjacking
//   - X-Content-Type-Options: nosniff — kills MIME-sniffing XSS
//   - Referrer-Policy: strict-origin-when-cross-origin
//   - Cross-Origin-Resource-Policy: cross-origin (we serve R2 images
//     into pages on other origins for OG cards — must not be 'same-origin')
await fastify.register(helmet, {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src':  ["'self'"],
      'script-src':      ["'self'", "'unsafe-inline'", 'https://js.paymongo.com', 'https://accounts.google.com', 'https://apis.google.com', 'https://static.cloudflareinsights.com', 'https://cdn.jsdelivr.net'],
      // script-src-elem controls <script src=...> tags specifically. Helmet's
      // useDefaults:true injects its own script-src-elem (just 'self'), which
      // overrides the script-src fallback — so without this line, every
      // external script tag is blocked even though script-src allows it.
      // Mirror the script-src list here.
      'script-src-elem': ["'self'", "'unsafe-inline'", 'https://js.paymongo.com', 'https://accounts.google.com', 'https://apis.google.com', 'https://static.cloudflareinsights.com', 'https://cdn.jsdelivr.net'],
      // script-src-attr covers inline event handlers (onclick=, onload=, …).
      // Helmet defaults this to 'none' which is the correct hardening for
      // greenfield code, but a lot of our HTML uses inline handlers. Allowing
      // 'unsafe-inline' here matches the rest of our intentionally-permissive
      // baseline; tighten to 'none' once handlers are migrated to addEventListener.
      'script-src-attr': ["'unsafe-inline'"],
      'connect-src':     ["'self'", 'https://api.paymongo.com', 'https://accounts.google.com', 'https://cloudflareinsights.com', 'wss:', 'https:'],
      'style-src':       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
      'style-src-elem':  ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
      'font-src':     ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'img-src':      ["'self'", 'data:', 'blob:', 'https:'],
      'media-src':    ["'self'", 'blob:', 'https:'],
      'frame-src':    ["'self'", 'https://accounts.google.com', 'https://paymongo.com', 'https://www.google.com'],
      'frame-ancestors': ["'none'"],
      'object-src':   ["'none'"],
      'base-uri':     ["'self'"],
      'form-action':  ["'self'"],
      'upgrade-insecure-requests': [],
      // Browsers POST a JSON violation report here whenever a directive
      // blocks something. Lets us spot new CDNs / actual XSS attempts in
      // real traffic without waiting for a user to file a bug. The
      // endpoint below rate-limits and ring-buffers the last N reports.
      'report-uri':   ['/api/_csp-report'],
    },
  },
  crossOriginEmbedderPolicy: false, // we serve cross-origin R2 media
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

await fastify.register(cors, {
  origin: ['https://reelday.ph', 'http://localhost:3000'], // Allow specific origins for production and local development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Allow necessary methods
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Guest-Id', 'X-Wall-Id'],
});

await fastify.register(multipart, {
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB
    files: 10,
  },
});

await fastify.register(formbody);

// Capture the raw body for every JSON request so the PayMongo webhook can
// verify the signature against the exact bytes we received. Also still
// returns the parsed object to handlers transparently.
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    req.rawBody = body;
    if (!body.length) return done(null, undefined);
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  },
);

await fastify.register(staticFiles, {
  root: join(__dirname, '..', 'frontend'),
  prefix: '/',
  // Per-asset cache policy. Without these every visitor re-downloads
  // every CSS/JS/image/font on every visit, which dominates time-to-
  // interactive on slow PH mobile connections. We *don't* hash filenames
  // (no Vite/webpack pipeline), so the strategy is:
  //   - HTML: short cache + must-revalidate so deploys propagate fast
  //   - CSS / JS: also short — the dashboard's logic is split across
  //     dashboard.html AND /js/plans.js, so a stale JS file silently
  //     breaks features even when the HTML is fresh (2026-05-21: a
  //     1-day-cached plans.js kept showing the Dalisay Upgrade CTA
  //     after the nextTier fix had already shipped). Keep JS within
  //     the same revalidation window as HTML during active iteration.
  //   - Images / fonts / icons: 30 days (they almost never change;
  //     bust by renaming, e.g. ?v=2 in the markup).
  setHeaders: (res, filePath) => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    } else if (/\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|eot)$/.test(lower)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 days
    } else if (/\.(css|js|mjs|json)$/.test(lower)) {
      res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate'); // 1 min
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');                // 1 hour
    }
  },
});

await fastify.register(dbPlugin);
await fastify.register(storagePlugin);
await fastify.register(authPlugin);

await fastify.register(healthRoutes,  { prefix: '/api' });
await fastify.register(eventRoutes,   { prefix: '/api' });
await fastify.register(uploadRoutes,  { prefix: '/api' });
await fastify.register(reactionRoutes,{ prefix: '/api' });
await fastify.register(pollRoutes,    { prefix: '/api' });
await fastify.register(musicRoutes,   { prefix: '/api' });
await fastify.register(sdeRoutes,     { prefix: '/api' });
await fastify.register(wallErrorsRoutes, { prefix: '/api' });
await fastify.register(paymentRoutes, { prefix: '/api' });
await fastify.register(webhookRoutes, { prefix: '/api' });
await fastify.register(authRoutes,    { prefix: '/api' });
await fastify.register(adminRoutes,   { prefix: '/api' });
await fastify.register(contactRoutes, { prefix: '/api' });
await fastify.register(eventSiteRoutes,{ prefix: '/api' });
await fastify.register(presenceRoutes,{ prefix: '' });

// Serve index.html at root
fastify.get('/', (_request, reply) => {
  reply.sendFile('index.html');
});

// /create is superseded by /start — redirect permanently so saved links still work.
fastify.get('/create', (request, reply) => {
  const qs = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
  reply.redirect(301, `/start${qs}`);
});

// Serve start.html — Jotform-style free-tier wizard
fastify.get('/start', (_request, reply) => {
  reply.sendFile('start.html');
});

// Serve upload.html for any /upload/:slug path
fastify.get('/upload/:slug', (_request, reply) => {
  reply.sendFile('upload.html');
});

// Serve wall.html for any /wall/:slug path
fastify.get('/wall/:slug', (_request, reply) => {
  reply.sendFile('wall.html');
});

// Printable QR poster — host opens this in a new tab from the dashboard;
// the page auto-triggers window.print() so "Save as PDF" is two clicks.
fastify.get('/poster/:slug', (_request, reply) => {
  reply.sendFile('poster.html');
});

// Event Website (Dalisay/Hiraya) — /e/:slug. Not a plain sendFile: the
// page needs OG/theme/noindex injected into the initial HTML so Viber/
// Messenger/FB crawlers (which don't run JS) see the cover card. The
// render is cached per slug and busted on owner edit (see event-site.js),
// so a popular event is a buffer send with zero DB. Gate failures return
// a bare 404 — no leak, no half-render.
fastify.get('/e/:slug', async (request, reply) => {
  const res = await renderEventSitePage(fastify.db, request.params.slug);
  if (res.html) {
    return reply.type('text/html; charset=utf-8').send(res.html);
  }
  if (res.unavailable) {
    return reply.code(503).type('text/html').send('<h1>Event site temporarily unavailable</h1>');
  }
  return reply
    .code(404)
    .type('text/html')
    .send('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;text-align:center;padding:4rem"><h1>This event page isn\'t available</h1><p><a href="/">Go to Reelday</a></p>');
});

// Serve dashboard.html at /dashboard (slug passed as ?slug=)
fastify.get('/dashboard', (_request, reply) => {
  reply.sendFile('dashboard.html');
});

fastify.get('/admin',            (_r, reply) => reply.sendFile('admin.html'));
fastify.get('/login',            (_r, reply) => reply.sendFile('login.html'));
fastify.get('/register',         (_r, reply) => reply.sendFile('register.html'));
fastify.get('/verify',           (_r, reply) => reply.sendFile('verify.html'));
fastify.get('/forgot-password',  (_r, reply) => reply.sendFile('forgot-password.html'));
fastify.get('/reset-password',   (_r, reply) => reply.sendFile('reset-password.html'));
fastify.get('/my-events',        (_r, reply) => reply.sendFile('my-events.html'));
fastify.get('/account',          (_r, reply) => reply.sendFile('account.html'));
fastify.get('/terms',            (_r, reply) => reply.sendFile('terms.html'));
fastify.get('/privacy',          (_r, reply) => reply.redirect(301, '/terms#privacy'));
fastify.get('/pricing',          (_r, reply) => reply.redirect(301, '/#pricing'));
fastify.get('/contact',          (_r, reply) => reply.sendFile('contact.html'));

// In-memory ring buffer of recent 5xx errors so we can fetch them via HTTP
// without scrolling through Easypanel logs. GET /api/_errors?key=<DEBUG_KEY>
const recentErrors = [];
const MAX_ERRORS_BUFFERED = 100;
function pushRecentError(entry) {
  recentErrors.push({ ...entry, at: new Date().toISOString() });
  if (recentErrors.length > MAX_ERRORS_BUFFERED) recentErrors.shift();
}

fastify.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode ?? 500;
  if (statusCode >= 500 && error.code !== 'FST_RATE_LIMIT') {
    const entry = {
      tag: 'REELDAY_500',
      method: request.method,
      url: request.url,
      ip: request.ip,
      errName: error?.name,
      errMessage: error?.message,
      errCode: error?.code,
      errDetail: error?.detail,
      stack: error?.stack,
    };
    request.log.error(entry, `REELDAY_500 ${request.method} ${request.url}`);
    pushRecentError(entry);
  } else {
    request.log.error(error);
  }
  reply.status(statusCode).send({
    error: true,
    message: statusCode === 500 ? 'Internal server error' : error.message,
  });
});

// CSP violation collector. Browsers POST a JSON report here whenever a
// directive blocks a resource. Buffered in-memory only (no DB write,
// no third-party); fetch via /api/_errors?key=… alongside 500s.
// Heavily rate-limited because browser extensions can fire dozens of
// these per page load — without a cap a chatty user could spam the
// buffer in seconds. Accept both legacy `application/csp-report` and
// the newer `application/reports+json` content types.
const recentCspReports = [];
const MAX_CSP_REPORTS  = 50;
fastify.addContentTypeParser(
  ['application/csp-report', 'application/reports+json'],
  { parseAs: 'string' },
  (_req, body, done) => {
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body)); }
    catch { done(null, { raw: String(body).slice(0, 2000) }); }
  },
);
fastify.post('/api/_csp-report', {
  config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: req => req.ip } },
}, async (request, reply) => {
  const body = request.body || {};
  const r = body['csp-report'] || body.body || body;
  recentCspReports.push({
    at: new Date().toISOString(),
    ip: request.ip,
    ua: (request.headers['user-agent'] || '').slice(0, 200),
    directive:    r['violated-directive'] || r.effectiveDirective || null,
    blockedUri:   r['blocked-uri']        || r.blockedURL         || null,
    documentUri:  r['document-uri']       || r.documentURL        || null,
    sourceFile:   r['source-file']        || r.sourceFile         || null,
  });
  while (recentCspReports.length > MAX_CSP_REPORTS) recentCspReports.shift();
  return reply.code(204).send();
});

// Debug endpoint — returns the last N 500s as JSON. Gated by DEBUG_KEY env
// var so it's not public. Set DEBUG_KEY in Easypanel to enable; without it,
// the endpoint returns 404 (no information leak).
//
// Key MUST be sent as `Authorization: Bearer <key>` — passing it via the
// query string would leave it in CDN access logs, browser history, and
// any Referer header sent to the next click.
fastify.get('/api/_errors', async (request, reply) => {
  const key = process.env.DEBUG_KEY;
  const auth = request.headers.authorization || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!key || presented !== key) {
    return reply.status(404).send({ error: true, message: 'Not found' });
  }
  return {
    count:       recentErrors.length,
    errors:      recentErrors.slice().reverse(),
    csp_reports: recentCspReports.slice().reverse(),
  };
});

// Last-resort safety net: if any async work throws and isn't caught, this
// keeps the process alive and logs it. Without this, a single unhandled
// rejection can wedge the event loop and turn the whole site into 500s.
process.on('unhandledRejection', (reason, promise) => {
  fastify.log.error({
    tag: 'REELDAY_UNHANDLED_REJECTION',
    reason: reason instanceof Error
      ? { name: reason.name, message: reason.message, stack: reason.stack }
      : reason,
  }, 'REELDAY_UNHANDLED_REJECTION');
});
process.on('uncaughtException', (err) => {
  fastify.log.error({
    tag: 'REELDAY_UNCAUGHT_EXCEPTION',
    name: err.name, message: err.message, stack: err.stack,
  }, 'REELDAY_UNCAUGHT_EXCEPTION');
});

const port = Number(process.env.PORT) || 3000;

// Graceful shutdown: docker/k8s sends SIGTERM, Ctrl+C sends SIGINT.
// Without this, in-flight requests (uploads, transcode webhooks) get
// killed mid-flight on every deploy. fastify.close() drains open
// connections, runs the onClose hooks (which close the DB pool), then
// resolves so we can exit cleanly.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  fastify.log.info(`${signal} received — draining connections`);
  try {
    await fastify.close();
    process.exit(0);
  } catch (err) {
    fastify.log.error({ err }, 'Error during graceful shutdown');
    process.exit(1);
  }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

try {
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`\n  Reelday running at http://localhost:${port}\n`);

  // Re-queue any video uploads that landed but never finished transcoding
  // (typically because we restarted between insert and the background
  // ffmpeg job completing). Bounded to the last 24h server-side.
  reconcilePendingTranscodes(fastify).catch(err =>
    fastify.log.warn({ err: err.message }, 'Startup transcode reconcile failed'),
  );

  // In-process cron: walks Hiraya users daily-ish and sends T-30 / T-7 /
  // T-0 renewal reminders. CAS-based idempotency on users.renewal_reminders_sent
  // makes it safe across restarts and multiple instances.
  startRenewalReminderJob(fastify);

  // Daily gallery cleanup: 7 days after gallery_expires_at, R2 objects
  // + uploads rows are permanently removed and events.archived_at is
  // set. One warning email goes out at the start of the grace window
  // so the host has time to hit "Download all" before deletion.
  startGalleryCleanupJob(fastify);

  // Poll Remotion Lambda for in-flight SDE renders. No-op when
  // REMOTION_LAMBDA_FUNCTION_NAME isn't set (ECS-only mode).
  startSdeLambdaPoller(fastify);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
