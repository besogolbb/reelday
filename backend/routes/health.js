export default async function healthRoutes(fastify) {
  fastify.get('/health', async (request) => {
    const server_ms = Date.now() - (request.startAt ?? Date.now());
    return {
      status: 'ok',
      service: 'reelday',
      timestamp: new Date().toISOString(),
      server_ms,
    };
  });
}
