import fp from 'fastify-plugin';
import pg from 'pg';

const { Pool } = pg;

const MIGRATIONS = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  CREATE TABLE IF NOT EXISTS users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                VARCHAR(255) UNIQUE NOT NULL,
    password_hash        TEXT NOT NULL,
    full_name            VARCHAR(200),
    phone                VARCHAR(30),
    is_verified          BOOLEAN     DEFAULT false,
    verification_token   TEXT,
    reset_token          TEXT,
    reset_token_expires  TIMESTAMPTZ,
    created_at           TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

  ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100);
  ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
`;

async function dbPlugin(fastify) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });

  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    fastify.log.info('PostgreSQL connected');
    await client.query(MIGRATIONS);
    fastify.log.info('Migrations applied');
  } finally {
    client.release();
  }

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
}

export default fp(dbPlugin, { name: 'database' });
