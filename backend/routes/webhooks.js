function buildPublicUrl(storageKey) {
  const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
  const key = String(storageKey || '').replace(/^\/+/, '');
  return `${base}/${key}`;
}

function readString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
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

    const originalKey = readString(
      request.body?.originalKey,
      request.body?.original_key,
      request.body?.fileName,
      request.body?.file_name,
    );
    const compressedKey = readString(
      request.body?.compressedKey,
      request.body?.compressed_key,
      request.body?.outputKey,
      request.body?.output_key,
      request.body?.webKey,
      request.body?.web_key,
      request.body?.compressedUrl,
      request.body?.compressed_url,
    );
    const posterKey = readString(
      request.body?.posterKey,
      request.body?.poster_key,
      request.body?.thumbnailKey,
      request.body?.thumbnail_key,
      request.body?.posterUrl,
      request.body?.poster_url,
    );

    if (!originalKey || !compressedKey) {
      return reply.status(400).send({
        error: true,
        message: 'originalKey and compressedKey are required',
      });
    }

    const compressedUrl = isAbsoluteUrl(compressedKey) ? compressedKey : buildPublicUrl(compressedKey);
    const posterUrl = !posterKey ? null : (isAbsoluteUrl(posterKey) ? posterKey : buildPublicUrl(posterKey));

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
