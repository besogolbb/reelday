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

// Global rate-limit. Routes that need a tighter bucket (uploads) re-register
// the plugin per-route with their own max/timeWindow.
await fastify.register(rateLimit, {
  global: true,
  max: 120,                   // ~2 req/sec sustained per IP
  timeWindow: '1 minute',
  ban: 0,
  // Logged-in hosts shouldn't get throttled by guest-facing limits while
  // they're triaging uploads in the dashboard.
  allowList: req => Boolean(req.headers.authorization),
  errorResponseBuilder: () => FRIENDLY_RATE_LIMIT,
  addHeaders: {
    'x-ratelimit-limit':     true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset':     true,
    'retry-after':           true,
  },
});

await fastify.register(cors, {
  origin: ['https://reelday.ph', 'http://localhost:3000'], // Allow specific origins for production and local development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Allow necessary methods
});

await fastify.register(multipart, {
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB
    files: 10,
  },
});

await fastify.register(formbody);

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
