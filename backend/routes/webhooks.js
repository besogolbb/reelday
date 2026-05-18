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

  // ── Same Day Edit renderer callback ─────────────────────────────────
  //
  // Posted by lambda/sde.mjs at end-of-render. Status is 'ready' on
  // success, 'error' on failure. Shared WEBHOOK_SECRET is verified the
  // same way as video-ready. On 'ready' we flip event_sde to ready and
  // merge an `sde` block into event_sites.config (preserving any other
  // host-configured site fields). On 'error' we record the message and
  // leave event_sites alone.
  fastify.post('/webhooks/sde-ready', async (request, reply) => {
    const configuredSecret = process.env.WEBHOOK_SECRET;
    if (!configuredSecret) {
      request.log.error('WEBHOOK_SECRET is not set; rejecting sde-ready webhook');
      return reply.status(503).send({ error: true, message: 'Webhook handler disabled' });
    }

    const providedSecret = readWebhookSecret(request);
    if (providedSecret !== configuredSecret) {
      request.log.warn('Rejected sde-ready webhook with bad/missing secret');
      return reply.status(401).send({ error: true, message: 'Invalid webhook secret' });
    }

    const body = request.body || {};
    const eventId = readString(body.eventId, body.event_id);
    const status  = readString(body.status);

    if (!eventId || !UUID_RE.test(eventId)) {
      return reply.status(400).send({ error: true, message: 'Valid eventId required' });
    }
    if (status !== 'ready' && status !== 'error') {
      return reply.status(400).send({ error: true, message: "status must be 'ready' or 'error'" });
    }

    if (status === 'error') {
      const message = readString(body.message) || 'Render failed (no message)';
      const { rows } = await fastify.db.query(
        `UPDATE event_sde
            SET status = 'error',
                error_message = $2,
                updated_at = NOW()
          WHERE event_id = $1
          RETURNING event_id, status`,
        [eventId, message.slice(0, 1000)],
      );
      if (!rows.length) {
        return reply.status(404).send({ error: true, message: 'event_sde row not found' });
      }
      return { ok: true, status: 'error' };
    }

    // status === 'ready' from here.
    const videoKey  = readString(body.videoKey, body.video_key, body.outKey, body.out_key);
    const posterKey = readString(body.posterKey, body.poster_key);
    if (!videoKey)  return reply.status(400).send({ error: true, message: 'videoKey required for ready' });
    if (!posterKey) return reply.status(400).send({ error: true, message: 'posterKey required for ready' });

    const durationS = Number.isFinite(+body.durationS) ? Math.max(0, Math.round(+body.durationS))
                    : Number.isFinite(+body.duration_s) ? Math.max(0, Math.round(+body.duration_s))
                    : null;
    const clipCount = Number.isFinite(+body.clipCount) ? Math.max(0, Math.round(+body.clipCount))
                    : Number.isFinite(+body.clip_count) ? Math.max(0, Math.round(+body.clip_count))
                    : null;

    const videoUrl  = isAbsoluteUrl(videoKey)  ? videoKey  : buildPublicUrl(videoKey);
    const posterUrl = isAbsoluteUrl(posterKey) ? posterKey : buildPublicUrl(posterKey);

    const { rows } = await fastify.db.query(
      `UPDATE event_sde
          SET status        = 'ready',
              video_url     = $2,
              poster_url    = $3,
              duration_s    = COALESCE($4, duration_s),
              clip_count    = COALESCE($5, clip_count),
              error_message = NULL,
              rendered_at   = NOW(),
              updated_at    = NOW()
        WHERE event_id = $1
        RETURNING event_id, rendered_at`,
      [eventId, videoUrl, posterUrl, durationS, clipCount],
    );
    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'event_sde row not found' });
    }

    // Merge an `sde` block into event_sites.config. INSERT-on-conflict
    // pattern preserves existing is_published + other config fields; if
    // no site row exists yet we seed one as is_published=false so the
    // hub picks it up the moment the host turns the site on.
    const sdeBlock = {
      video_url:   videoUrl,
      poster_url:  posterUrl,
      duration_s:  durationS,
      clip_count:  clipCount,
      rendered_at: rows[0].rendered_at,
    };
    await fastify.db.query(
      `INSERT INTO event_sites (event_id, is_published, config, updated_at)
       VALUES ($1, false, jsonb_build_object('sde', $2::jsonb), NOW())
       ON CONFLICT (event_id) DO UPDATE
         SET config     = jsonb_set(
                            COALESCE(event_sites.config, '{}'::jsonb),
                            '{sde}',
                            EXCLUDED.config -> 'sde',
                            true
                          ),
             updated_at = NOW()`,
      [eventId, JSON.stringify(sdeBlock)],
    );

    return { ok: true, status: 'ready', video_url: videoUrl, poster_url: posterUrl };
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
