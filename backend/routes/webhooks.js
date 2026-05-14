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
    const status = readString(
      request.body?.status,
      request.body?.transcodeStatus,
      request.body?.transcode_status,
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

    // combine_ready — photo+audio merge completed in Lambda
    if (status === 'combine_ready') {
      const combinedKey = readString(request.body?.combinedKey, request.body?.combined_key);
      const uploadId    = request.body?.uploadId;
      if (!uploadId || !combinedKey) {
        return reply.status(400).send({ error: true, message: 'uploadId and combinedKey required for combine_ready' });
      }
      const combinedUrl = isAbsoluteUrl(combinedKey) ? combinedKey : buildPublicUrl(combinedKey);
      const { rows } = await fastify.db.query(
        `UPDATE uploads SET combined_url = $2, is_video_message = true WHERE id = $1 RETURNING *`,
        [uploadId, combinedUrl],
      );
      if (!rows.length) return reply.status(404).send({ error: true, message: 'Upload not found' });
      return { success: true, upload: rows[0] };
    }

    if (!originalKey || !status) {
      return reply.status(400).send({
        error: true,
        message: 'originalKey and status are required',
      });
    }
    if (status !== 'poster_ready' && status !== 'video_ready') {
      return reply.status(400).send({ error: true, message: 'Unsupported status' });
    }
    if (status === 'poster_ready' && !posterKey) {
      return reply.status(400).send({ error: true, message: 'posterKey is required for poster_ready' });
    }
    if (status === 'video_ready' && !compressedKey) {
      return reply.status(400).send({ error: true, message: 'compressedKey is required for video_ready' });
    }

    const compressedUrl = !compressedKey ? null : (isAbsoluteUrl(compressedKey) ? compressedKey : buildPublicUrl(compressedKey));
    const posterUrl = !posterKey ? null : (isAbsoluteUrl(posterKey) ? posterKey : buildPublicUrl(posterKey));

    const query = status === 'poster_ready'
      ? {
          text: `UPDATE uploads
                    SET poster_url   = $2,
                        video_status = COALESCE(video_status, 'processing')
                  WHERE file_type = 'video'
                    AND original_key = $1
                  RETURNING *`,
          values: [originalKey, posterUrl],
        }
      : {
          text: `UPDATE uploads
                    SET compressed_key = $2,
                        file_url       = $3,
                        web_url        = $3,
                        poster_url     = COALESCE($4, poster_url),
                        video_status   = 'ready'
                  WHERE file_type = 'video'
                    AND original_key = $1
                  RETURNING *`,
          values: [originalKey, compressedKey, compressedUrl, posterUrl],
        };

    const { rows } = await fastify.db.query(query.text, query.values);

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Upload not found for originalKey' });
    }

    return { success: true, upload: rows[0] };
  });
}
