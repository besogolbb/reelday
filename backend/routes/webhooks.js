function buildPublicUrl(storageKey) {
  const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
  const key = String(storageKey || '').replace(/^\/+/, '');
  return `${base}/${key}`;
}

function readWebhookSecret(request) {
  const headerSecret = request.headers['x-webhook-secret'];
  if (typeof headerSecret === 'string' && headerSecret) return headerSecret;

  const auth = request.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);

  return '';
}

export default async function webhookRoutes(fastify) {
  fastify.post('/webhooks/video-ready', async (request, reply) => {
    const configuredSecret = process.env.WEBHOOK_SECRET;
    if (!configuredSecret) {
      request.log.error('WEBHOOK_SECRET is not set; rejecting video-ready webhook');
      return reply.status(503).send({ error: true, message: 'Webhook handler disabled' });
    }

    const providedSecret = readWebhookSecret(request);
    if (providedSecret !== configuredSecret) {
      request.log.warn('Rejected video-ready webhook with bad/missing secret');
      return reply.status(401).send({ error: true, message: 'Invalid webhook secret' });
    }

    const originalKey = String(request.body?.originalKey || '').trim();
    const compressedKey = String(request.body?.compressedKey || '').trim();
    const posterKey = String(request.body?.posterKey || '').trim();

    if (!originalKey || !compressedKey) {
      return reply.status(400).send({
        error: true,
        message: 'originalKey and compressedKey are required',
      });
    }

    const compressedUrl = buildPublicUrl(compressedKey);
    const posterUrl = posterKey ? buildPublicUrl(posterKey) : null;

    const { rows } = await fastify.db.query(
      `UPDATE uploads
          SET video_status   = 'ready',
              compressed_key = $2,
              file_url       = $3,
              web_url        = $3,
              poster_url     = COALESCE($4, poster_url)
        WHERE file_type = 'video'
          AND original_key = $1
        RETURNING *`,
      [originalKey, compressedKey, compressedUrl, posterUrl],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Upload not found for originalKey' });
    }

    return { success: true, upload: rows[0] };
  });
}
