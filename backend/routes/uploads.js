import { extname } from 'path';
import { randomUUID } from 'crypto';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolvePlan } from '../lib/plans.js';
import { verifyToken } from '../plugins/auth.js';

export default async function uploadRoutes(fastify) {
  function extractStorageKey(fileUrl) {
    if (!fileUrl) return null;

    try {
      const parsed = new URL(fileUrl);
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    } catch {
      const match = String(fileUrl).match(/(?:^|\/)(uploads\/.+)$/);
      return match ? decodeURIComponent(match[1]) : null;
    }
  }

  // Helper to optionally get user from token without forcing authentication
  function tryGetUser(request) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try { return verifyToken(header.slice(7)); }
    catch { return null; }
  }

  // Helper to validate event status and plan limits before allowing uploads
  // Reused by both legacy multipart and new presigned flows.
  async function getValidatedEvent(slug, currentUser = null) {
    const { rows: eventRows } = await fastify.db.query(
      'SELECT * FROM events WHERE slug = $1',
      [slug],
    );

    if (!eventRows.length || eventRows[0].is_active === false) {
      throw { statusCode: 404, message: 'Event not found' };
    }
    const event = eventRows[0];

    // QR / event must belong to a registered account.
    if (!event.user_id) {
      throw { statusCode: 403, code: 'orphan_event', message: 'This event is not linked to an account.' };
    }

    const isOwner = currentUser && currentUser.id === event.user_id;

    fastify.log.info({ slug, isOwner, userId: currentUser?.id, eventUserId: event.user_id }, 'Validating event upload');

    // Owner must still exist (account not deleted). Pulls the live tier as well.
    let effectiveTier = event.plan;
    const { rows: ownerRows } = await fastify.db.query(
      `SELECT subscription_tier FROM users WHERE id = $1`,
      [event.user_id],
    );
    if (!ownerRows.length) {
      throw { statusCode: 403, code: 'owner_missing', message: 'Event owner account no longer exists.' };
    }
    if (ownerRows[0].subscription_tier) {
      effectiveTier = ownerRows[0].subscription_tier;
    }
    const plan = resolvePlan(effectiveTier);

    // NOTE: uploads are intentionally OPEN regardless of event.is_paid —
    // PH manual-payment flow can lag, and we don't want guests blocked at the QR.
    // Viewing the gallery is still gated elsewhere when is_paid is false.

    if (!isOwner && event.gallery_expires_at && new Date(event.gallery_expires_at) < new Date()) {
      throw { statusCode: 403, code: 'gallery_locked', message: 'Gallery archived. Uploads closed.' };
    }

    if (!isOwner && event.upload_window_ends_at && new Date(event.upload_window_ends_at) < new Date()) {
      throw { statusCode: 403, code: 'upload_window_closed', message: 'Upload window has ended.' };
    }

    if (plan.uploadLimit) {
      const { rows: countRows } = await fastify.db.query(
        'SELECT COUNT(*)::int AS count FROM uploads WHERE event_id = $1',
        [event.id],
      );
      const used = countRows[0].count;
      if (used >= plan.uploadLimit) {
        throw { statusCode: 403, code: 'plan_limit_uploads', message: `Upload limit reached for ${plan.name} plan.` };
      }
    }
    return { event, plan };
  }

  // Tighter cap for upload-write endpoints (presigned URL / R2 PUT / DB
  // insert). Keyed on the per-device token so guests sharing one venue
  // WiFi don't share one bucket. Plan-level upload caps still apply via
  // getValidatedEvent(); this just stops a single device from hammering.
  const UPLOAD_WRITE_LIMIT = {
    rateLimit: {
      max: 40,
      timeWindow: '1 minute',
      keyGenerator: fastify.limiterKey,
      errorResponseBuilder: () => fastify.friendlyRateLimit,
    },
  };

  // POST /api/uploads/:slug — legacy multipart upload (kept for compatibility)
  fastify.post('/uploads/:slug', { config: UPLOAD_WRITE_LIMIT }, async (request, reply) => {
    const { slug } = request.params;
    let event, plan;
    try {
      ({ event, plan } = await getValidatedEvent(slug, tryGetUser(request)));
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ error: true, ...e });
    }

    const fields = {};
    let fileBuffer = null;
    let fileMime = null;
    let fileExt = '.jpg';

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (!part.mimetype.startsWith('image/') && !part.mimetype.startsWith('video/')) {
          // Drain the stream so Fastify doesn't hang
          for await (const _ of part.file) { /* noop */ }
          return reply.status(400).send({
            error: true,
            message: 'Tanggap lang ang mga larawan at video.',
          });
        }

        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileBuffer = Buffer.concat(chunks);
        fileMime   = part.mimetype;
        fileExt    = extname(part.filename || '') || (part.mimetype.startsWith('video/') ? '.mp4' : '.jpg');
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!fileBuffer) {
      return reply.status(400).send({ error: true, message: 'Walang file na na-upload.' });
    }

    const isVideo        = fileMime.startsWith('video/');
    const isVideoMessage = isVideo && fields.is_video_message === 'true';

    if (isVideoMessage && (event.plan === 'tala' || event.plan === 'libre')) {
      return reply.status(403).send({ error: true, message: 'Upgrade to Sinag to send video messages' });
    }
    const filename       = `${randomUUID()}${fileExt}`;
    const fileUrl        = await fastify.uploadFile(fileBuffer, filename, fileMime);

    // Approval defaults by upload kind:
    //  - photo:         auto-approve unless the host turned it off (legacy)
    //  - video upload:  manual review unless video_auto_approve is on
    //  - video message: manual review unless video_message_auto_approve is on
    let isApproved;
    if (!isVideo) {
      isApproved = event.auto_approve === true;
    } else if (isVideoMessage) {
      isApproved = event.video_message_auto_approve === true;
    } else {
      isApproved = event.video_auto_approve === true;
    }

    const { rows } = await fastify.db.query(
      `INSERT INTO uploads
         (event_id, file_url, file_type, uploader_name, message, is_video_message, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        event.id,
        fileUrl,
        isVideo ? 'video' : 'photo',
        fields.uploader_name || null,
        fields.message       || null,
        isVideoMessage,
        isApproved,
      ],
    );

    return reply.status(201).send({
      upload:  rows[0],
      message: 'Salamat! Na-share mo na ang iyong momento.',
    });
  });

  // POST /api/uploads/presigned — generate a PUT URL for direct R2 upload
  fastify.post('/uploads/presigned', { config: UPLOAD_WRITE_LIMIT }, async (request, reply) => {
    const { slug, filename, contentType } = request.body;

    // Optionally authenticate the user if a token is present
    request.user = tryGetUser(request);
    fastify.log.info({ slug, userId: request.user?.id, filename, bucket: process.env.R2_BUCKET_NAME }, 'Generating presigned URL');

    try {
      await getValidatedEvent(slug, request.user);
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ error: true, ...e });
    }

    const fileKey = `uploads/${slug}/${Date.now()}-${filename}`;
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(fastify.storage, command, { expiresIn: 300 });
    return { uploadUrl, fileKey };
  });

  // POST /api/uploads/complete — confirm R2 upload and save to DB
  fastify.post('/uploads/complete', { config: UPLOAD_WRITE_LIMIT }, async (request, reply) => {
    const { slug, fileKey, uploader_name, message, file_type, is_video_message } = request.body;

    // Optionally authenticate the user if a token is present
    request.user = tryGetUser(request);

    let event, plan;
    try {
      ({ event, plan } = await getValidatedEvent(slug, request.user));
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ error: true, ...e });
    }

    const publicBase = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
    const fileUrl = `${publicBase}/${fileKey}`;
    const isVideo = file_type === 'video' || (file_type !== 'photo' && fileKey.match(/\.(mp4|webm|mov|m4v|ogg)$/i));
    const isVidMsg = isVideo && is_video_message === true;

    if (isVidMsg && (event.plan === 'tala' || event.plan === 'libre')) {
      return reply.status(403).send({ error: true, message: 'Upgrade to Sinag for video messages' });
    }

    // Strict: ALL three approval gates require an explicit true. A NULL
    // column (older events that predate the toggle) is treated as OFF so
    // host review is the safe default.
    let isApproved;
    if (!isVideo) {
      isApproved = event.auto_approve === true;
    } else if (isVidMsg) {
      isApproved = event.video_message_auto_approve === true;
    } else {
      isApproved = event.video_auto_approve === true;
    }

    const { rows } = await fastify.db.query(
      `INSERT INTO uploads
         (event_id, file_url, file_type, uploader_name, message, is_video_message, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        event.id,
        fileUrl,
        isVideo ? 'video' : 'photo',
        uploader_name || null,
        message       || null,
        isVidMsg,
        isApproved,
      ],
    );

    return reply.status(201).send({ upload: rows[0] });
  });

  // GET /api/uploads/file/:id — stream an uploaded file through this app.
  // This keeps rendering working even when the R2 bucket is private or the
  // configured R2 public URL is not browser-readable.
  fastify.get('/uploads/file/:id', async (request, reply) => {
    const { id } = request.params;

    const { rows } = await fastify.db.query(
      'SELECT file_url, file_type FROM uploads WHERE id = $1',
      [id],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Upload not found' });
    }

    const key = extractStorageKey(rows[0].file_url);
    if (!key) {
      return reply.status(404).send({ error: true, message: 'Upload file key not found' });
    }

    try {
      const range = request.headers.range;
      const object = await fastify.getFile(key, range);

      const contentType =
        object.ContentType ||
        (rows[0].file_type === 'video' ? 'video/mp4' : 'image/jpeg');

      reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('Accept-Ranges', 'bytes');

      // R2/S3 returns ContentRange + 206-style metadata when a Range was requested.
      if (object.ContentRange) reply.header('Content-Range', object.ContentRange);
      if (object.ContentLength != null) reply.header('Content-Length', object.ContentLength);

      // If a Range header came in and the storage replied with a partial body,
      // mirror that with a 206 so <video> seeks/streams correctly.
      if (range && object.ContentRange) {
        reply.code(206);
      }

      return reply.send(object.Body);
    } catch (err) {
      request.log.warn({ err, upload_id: id, key }, 'failed to stream uploaded file');
      return reply.status(404).send({ error: true, message: 'Upload file not found' });
    }
  });

  // GET /api/uploads/:slug — list all uploads for an event.
  // Pass ?include_pending=1 to also return rows where is_approved=false
  // (used by the dashboard so the host can review pending videos).
  fastify.get('/uploads/:slug', async (request, reply) => {
    const { slug } = request.params;
    const includePending = request.query?.include_pending === '1' ||
                           request.query?.include_pending === 'true';

    const { rows: eventRows } = await fastify.db.query(
      'SELECT * FROM events WHERE slug = $1 AND is_active = true',
      [slug],
    );

    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const event = eventRows[0];

    const { rows: uploads } = await fastify.db.query(
      `SELECT * FROM uploads
        WHERE event_id = $1
          ${includePending ? '' : 'AND is_approved = true'}
        ORDER BY created_at DESC`,
      [event.id],
    );

    const now = new Date();
    const locks = {
      gallery_locked: !!(event.gallery_expires_at && new Date(event.gallery_expires_at) < now),
      uploads_closed: !!(event.upload_window_ends_at && new Date(event.upload_window_ends_at) < now),
    };

    return { uploads, event, locks };
  });

  // GET /api/uploads/:slug/download — list all file URLs for bulk download
  fastify.get('/uploads/:slug/download', async (request, reply) => {
    const { slug } = request.params;

    const { rows: eventRows } = await fastify.db.query(
      'SELECT id, gallery_expires_at FROM events WHERE slug = $1 AND is_active = true',
      [slug],
    );

    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const event = eventRows[0];

    if (event.gallery_expires_at && new Date(event.gallery_expires_at) < new Date()) {
      return reply.status(403).send({
        error: true,
        code: 'gallery_locked',
        message: 'This event gallery has been archived. Downloads are no longer available — upgrade to extend retention.',
        gallery_expires_at: event.gallery_expires_at,
      });
    }

    const { rows: uploads } = await fastify.db.query(
      `SELECT file_url, uploader_name, file_type
       FROM uploads
       WHERE event_id = $1 AND is_approved = true
       ORDER BY created_at DESC`,
      [event.id],
    );

    return {
      files: uploads.map(u => ({
        url:  u.file_url,
        name: u.uploader_name,
        type: u.file_type,
      })),
    };
  });

  // Confirms `request.user` (a JWT-authenticated host) owns the event that
  // this upload belongs to. Returns the joined { upload, event } rows or
  // sends a 401/403/404 and returns null.
  async function loadUploadForOwner(request, reply, uploadId) {
    if (!request.user?.id) {
      reply.status(401).send({ error: true, message: 'Authentication required' });
      return null;
    }
    const { rows } = await fastify.db.query(
      `SELECT u.id, u.file_url, u.event_id, e.user_id
         FROM uploads u
         JOIN events  e ON e.id = u.event_id
        WHERE u.id = $1`,
      [uploadId],
    );
    if (!rows.length) {
      reply.status(404).send({ error: true, message: 'Upload not found' });
      return null;
    }
    if (rows[0].user_id !== request.user.id) {
      reply.status(403).send({ error: true, message: 'Not your event' });
      return null;
    }
    return rows[0];
  }

  // DELETE /api/uploads/:id — remove an upload (event owner only).
  // Also removes the underlying object from R2 so storage doesn't leak.
  fastify.delete('/uploads/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params;
    const row = await loadUploadForOwner(request, reply, id);
    if (!row) return;

    const key = extractStorageKey(row.file_url);
    if (key && process.env.R2_BUCKET_NAME) {
      try {
        await fastify.storage.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key:    key,
        }));
      } catch (err) {
        // Don't block the DB delete on a storage hiccup — the row is the
        // source of truth and a stale R2 object is recoverable later.
        request.log.warn({ err, upload_id: id, key }, 'R2 object delete failed');
      }
    }

    await fastify.db.query('DELETE FROM uploads WHERE id = $1', [id]);
    return { success: true };
  });

  // PATCH /api/uploads/:id/approve — toggle approval (event owner only).
  fastify.patch('/uploads/:id/approve', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id } = request.params;
    const { is_approved } = request.body ?? {};
    const row = await loadUploadForOwner(request, reply, id);
    if (!row) return;

    const { rows } = await fastify.db.query(
      'UPDATE uploads SET is_approved = $2 WHERE id = $1 RETURNING *',
      [id, is_approved ?? true],
    );
    return { upload: rows[0] };
  });

  // PATCH/POST /api/uploads/:id/flag — event owner re-classifies an upload
  // as a video message (or back to a regular video). Only is_video_message
  // is mutable here so this can't accidentally be used to bypass the
  // approval flow. Accepts both PATCH and POST so deploys behind proxies
  // that strip PATCH (some Caddy/Traefik configs) still work.
  async function flagHandler(request, reply) {
    const { id } = request.params;
    const flag = request.body?.is_video_message;

    if (typeof flag !== 'boolean') {
      return reply.status(400).send({
        error: true,
        message: 'is_video_message (boolean) is required',
      });
    }

    const row = await loadUploadForOwner(request, reply, id);
    if (!row) return;

    const { rows } = await fastify.db.query(
      'UPDATE uploads SET is_video_message = $2 WHERE id = $1 RETURNING *',
      [id, flag],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Upload not found' });
    }

    return { upload: rows[0] };
  }
  fastify.patch('/uploads/:id/flag', { preHandler: fastify.authenticate }, flagHandler);
  fastify.post('/uploads/:id/flag',  { preHandler: fastify.authenticate }, flagHandler);
}
