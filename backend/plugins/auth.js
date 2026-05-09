import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';

// Read the secret at call time so dotenv has populated process.env first.
// Bail loudly if it's missing — silent fallback to a baked-in string would
// mean every JWT in production is forgeable by anyone who reads the repo.
function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET env is missing or too short (need >=32 chars)');
  }
  return s;
}

export function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '30d' });
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

async function authPlugin(fastify) {
  fastify.decorate('authenticate', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: true, message: 'Authentication required' });
    }
    try {
      request.user = verifyToken(header.slice(7));
    } catch {
      return reply.status(401).send({ error: true, message: 'Invalid or expired token' });
    }
  });
}

export default fp(authPlugin, { name: 'auth' });
