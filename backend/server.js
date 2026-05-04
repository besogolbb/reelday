import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config as loadEnv } from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import staticFiles from '@fastify/static';

import dbPlugin from './plugins/database.js';
import storagePlugin from './plugins/storage.js';
import healthRoutes from './routes/health.js';
import eventRoutes from './routes/events.js';
import uploadRoutes from './routes/uploads.js';
import paymentRoutes from './routes/payments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from the same directory as this file (backend/.env)
loadEnv({ path: join(__dirname, '.env') });

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
});

await fastify.register(cors, { origin: '*' });

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

await fastify.register(healthRoutes,  { prefix: '/api' });
await fastify.register(eventRoutes,   { prefix: '/api' });
await fastify.register(uploadRoutes,  { prefix: '/api' });
await fastify.register(paymentRoutes, { prefix: '/api' });

// Serve index.html at root
fastify.get('/', (_request, reply) => {
  reply.sendFile('index.html');
});

// Serve create.html
fastify.get('/create', (_request, reply) => {
  reply.sendFile('create.html');
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
