import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'reelday2026ph';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
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
