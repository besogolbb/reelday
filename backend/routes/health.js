export default async function healthRoutes(fastify) {
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'reelday',
    timestamp: new Date().toISOString(),
  }));
}
