import fp from 'fastify-plugin';
import pg from 'pg';

const { Pool } = pg;

async function dbPlugin(fastify) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });

  // Verify connection on startup
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    fastify.log.info('PostgreSQL connected');
  } finally {
    client.release();
  }

  fastify.decorate('db', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
}

export default fp(dbPlugin, { name: 'database' });
