import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config as loadEnv } from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';

import dbPlugin from './plugins/database.js';
import storagePlugin from './plugins/storage.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import eventRoutes from './routes/events.js';
import uploadRoutes from './routes/uploads.js';
import paymentRoutes from './routes/payments.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';

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
// token (sent as `X-Guest-Id`, generated and persisted client-side in
// localStorage). Falls back to the source IP for clients that don't send
// the header so the limit can never be fully bypassed.
const limiterKey = req =>
  (typeof req.headers['x-guest-id'] === 'string' && req.headers['x-guest-id'].slice(0, 64)) ||
  req.ip;

await fastify.register(rateLimit, {
  global: true,
  max: 240,                   // generous global cap per device-token / IP
  timeWindow: '1 minute',
  ban: 0,
  // Logged-in hosts shouldn't get throttled by guest-facing limits while
  // they're triaging uploads in the dashboard.
  allowList: req => Boolean(req.headers.authorization),
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

await fastify.register(cors, {
  origin: ['https://reelday.ph', 'http://localhost:3000'], // Allow specific origins for production and local development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Allow necessary methods
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Guest-Id'],
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
});

await fastify.register(dbPlugin);
await fastify.register(storagePlugin);
await fastify.register(authPlugin);

await fastify.register(healthRoutes,  { prefix: '/api' });
await fastify.register(eventRoutes,   { prefix: '/api' });
await fastify.register(uploadRoutes,  { prefix: '/api' });
await fastify.register(paymentRoutes, { prefix: '/api' });
await fastify.register(authRoutes,    { prefix: '/api' });
await fastify.register(adminRoutes,   { prefix: '/api' });

// Serve index.html at root
fastify.get('/', (_request, reply) => {
  reply.sendFile('index.html');
});

// Serve create.html
fastify.get('/create', (_request, reply) => {
  reply.sendFile('create.html');
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

fastify.setErrorHandler((error, _request, reply) => {
  fastify.log.error(error);
  const statusCode = error.statusCode ?? 500;
  reply.status(statusCode).send({
    error: true,
    message: statusCode === 500 ? 'Internal server error' : error.message,
  });
});

const port = Number(process.env.PORT) || 3000;

try {
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`\n  Reelday running at http://localhost:${port}\n`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
