import { extname, posix as pathPosix } from 'path';
import { randomUUID } from 'crypto';
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolvePlan } from '../lib/plans.js';
import { triggerVideoTranscode } from '../lib/awsLambdaService.js';
import { verifyToken } from '../plugins/auth.js';
import { getCount as getPresenceCount } from './presence.js';

// Short TTL cache for GET /uploads/:slug (the wall's hot-read path).
// 600 walls polling every 2s would otherwise fire 600 DB queries per cycle.
// 1.5s TTL keeps staleness below one poll interval; dashboard bypasses it.
const UPLOADS_CACHE_TTL = 1500;
const uploadsCache  = new Map(); // slug → { payload, expiresAt }
const uploadsInflight = new Map(); // slug → Promise<payload>  (single-flight dedup)

export default async function uploadRoutes(fastify) {
  function publicMediaUrl(key) {
    const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
    const cleanKey = String(key || '').replace(/^\/+/, '');
    return `${base}/${cleanKey}`;
  }

  function derivedVideoKeys(originalKey) {
    const key = String(originalKey || '').replace(/^\/+/, '');
    const dir = pathPosix.dirname(key);
    const ext = pathPosix.extname(key);
    const base = pathPosix.basename(key, ext);
    const joinKey = name => (dir && dir !== '.' ? `${dir}/${name}` : name);

    return {
      webKeys: [
        `${key.slice(0, key.length - ext.length)}_web.mp4`,
        joinKey(`compressed_${base}.mp4`),
      ],
      posterKeys: [
        `${key.slice(0, key.length - ext.length)}_poster.jpg`,
        joinKey(`poster_${base}.jpg`),
      ],
    };
  }

  async function storageObjectExists(key) {
    if (!key || !process.env.R2_BUCKET_NAME) return false;
    try {
      await fastify.storage.send(new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      }));
      return true;
    } catch {
      return false;
    }
  }

  async function reconcileVideoUpload(row) {
    if (!row || row.file_type !== 'video') return row;

    const posterOnlyKey = extractStorageKey(row.poster_url);
    const existingWebKey = row.compressed_key || extractStorageKey(row.web_url);
    if ((row.video_status === 'ready' || row.web_url) && existingWebKey) {
      if (row.video_status === 'ready' && row.compressed_key) return row;

      const { rows } = await fastify.db.query(
        `UPDATE uploads
            SET video_status   = 'ready',
                compressed_key = COALESCE(compressed_key, $2)
          WHERE id = $1
        RETURNING *`,
        [row.id, existingWebKey],
      );
      return rows[0] || row;
    }

    if (!row.original_key) return row;

    const { webKeys, posterKeys } = derivedVideoKeys(row.original_key);
    const webKey = existingWebKey || (await (async () => {
      for (const candidate of webKeys) {
        if (await storageObjectExists(candidate)) return candidate;
      }
      return null;
    })());
    const posterKey = posterOnlyKey || (await (async () => {
      for (const candidate of posterKeys) {
        if (await storageObjectExists(candidate)) return candidate;
      }
      return null;
    })());
    const hasPoster = !!posterKey;
    const hasWeb = !!webKey;
    if (!hasWeb) {
      if (!hasPoster || row.poster_url) return row;

      const posterUrl = publicMediaUrl(posterKey);
      const { rows } = await fastify.db.query(
        `UPDATE uploads
            SET poster_url = COALESCE(poster_url, $2)
          WHERE id = $1
        RETURNING *`,
        [row.id, posterUrl],
      );
      return rows[0] || row;
    }

    const webUrl = publicMediaUrl(webKey);
    const posterUrl = hasPoster ? (row.poster_url || publicMediaUrl(posterKey)) : row.poster_url;

    const { rows } = await fastify.db.query(
      `UPDATE uploads
          SET video_status   = 'ready',
              compressed_key = $2,
              web_url        = $3,
              poster_url     = COALESCE($4, poster_url)
        WHERE id = $1
      RETURNING *`,
      [row.id, webKey, webUrl, posterUrl],
    );
    return rows[0] || row;
  }

  async function reconcileVideoUploads(rows) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    return Promise.all(rows.map(row => reconcileVideoUpload(row)));
  }

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

    if (isVideoMessage && !plan.features?.videoMessage) {
      return reply.status(403).send({
        error: true,
        message: 'Video messages need a Sinag plan or higher.',
      });
    }
    const filename       = `${randomUUID()}${fileExt}`;
    const fileUrl        = await fastify.uploadFile(fileBuffer, filename, fileMime);
    const originalKey    = isVideo ? extractStorageKey(fileUrl) : null;
    const videoStatus    = isVideo ? 'processing' : null;

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
         (event_id, file_url, file_type, uploader_name, message, is_video_message, is_approved, original_key, video_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        event.id,
        fileUrl,
        isVideo ? 'video' : 'photo',
        fields.uploader_name || null,
        fields.message       || null,
        isVideoMessage,
        isApproved,
        originalKey,
        videoStatus,
      ],
    );

    if (isVideo) {
      try {
        const filePath = extractStorageKey(fileUrl);
        if (filePath) {
          // Legacy multipart path doesn't collect a guest thumbnail, so
          // the lambda will fall back to the first video frame for bg.
          await triggerVideoTranscode(filePath, { preThumbKey: null, eventId: rows[0].event_id });
        } else {
          fastify.log.warn({ upload_id: rows[0].id, fileUrl }, 'lambda kickoff skipped: could not derive storage key');
        }
      } catch (err) {
        fastify.log.warn({ err: err.message, upload_id: rows[0].id }, 'transcode kickoff failed');
      }
    }

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
    const { slug, fileKey, uploader_name, message, file_type, is_video_message, poster_data_url, batch_id } = request.body;
    const guestId  = (request.headers['x-guest-id'] || '').trim().slice(0, 64) || null;
    const batchId  = (typeof batch_id === 'string' ? batch_id.trim().slice(0, 64) : null) || null;

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
    // Audio must be detected first — audio/webm shares the .webm extension
    // with video, so the regex below would misclassify it without this guard.
    const isAudio = file_type === 'audio';
    const isVideo = !isAudio && (file_type === 'video' || (file_type !== 'photo' && fileKey.match(/\.(mp4|webm|mov|m4v|ogg)$/i)));
    const isVidMsg = isVideo && is_video_message === true;
    const originalKey = isVideo ? fileKey : null;
    const videoStatus = isVideo ? 'processing' : null;

    // Persist the guest-browser thumbnail as a sibling R2 object instead
    // of inlining the data URL anywhere. Two reasons:
    //   1) SQS messages have a 256 KiB hard limit; a 960px JPEG data URL
    //      can blow past it, silently failing the transcode kickoff.
    //   2) The lambda webhook overwrites poster_url with the final poster,
    //      losing the guest's choice. Storing it under its own key lets
    //      the wall surface the guest thumb during the processing window.
    let preThumbUrl = null;
    let preThumbKey = null;
    if (
      isVideo &&
      typeof poster_data_url === 'string' &&
      /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(poster_data_url)
    ) {
      try {
        const match = poster_data_url.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
        if (match) {
          const ext = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
          const contentType = `image/${ext}`;
          const buffer = Buffer.from(match[2], 'base64');
          const dir = fileKey.includes('/') ? fileKey.slice(0, fileKey.lastIndexOf('/')) : '';
          const base = fileKey.includes('/') ? fileKey.slice(fileKey.lastIndexOf('/') + 1) : fileKey;
          const baseNoExt = base.replace(/\.[^.]+$/, '');
          preThumbKey = `${dir ? dir + '/' : ''}prethumb_${baseNoExt}.${ext === 'jpeg' ? 'jpg' : ext}`;
          preThumbUrl = await fastify.putFile(preThumbKey, buffer, contentType);
        }
      } catch (err) {
        fastify.log.warn({ err: err.message }, 'pre-thumb upload failed');
        preThumbUrl = null;
        preThumbKey = null;
      }
    }

    // Gate on the EFFECTIVE plan (computed from users.subscription_tier
    // inside getValidatedEvent), not event.plan — that column gets stale
    // after the host upgrades their account but the event row was created
    // on Tala. Hosts on Sinag/Dalisay/Hiraya should always be allowed.
    if (isVidMsg && !plan.features?.videoMessage) {
      return reply.status(403).send({
        error: true,
        message: 'Video messages need a Sinag plan or higher.',
      });
    }

    // Strict: ALL three approval gates require an explicit true. A NULL
    // column (older events that predate the toggle) is treated as OFF so
    // host review is the safe default.
    let isApproved;
    if (isAudio) {
      // Audio is companion content (voice message paired with a photo) — it is
      // never shown as standalone visual content, so it always auto-approves.
      // Without this, audio items sit pending and the wall never sees them,
      // breaking audio↔photo pairing entirely.
      isApproved = true;
    } else if (!isVideo) {
      isApproved = event.auto_approve === true;
    } else if (isVidMsg) {
      isApproved = event.video_message_auto_approve === true;
    } else {
      isApproved = event.video_auto_approve === true;
    }

    const { rows } = await fastify.db.query(
      `INSERT INTO uploads
         (event_id, file_url, file_type, uploader_name, message, is_video_message, is_approved, original_key, video_status, pre_thumb_url, guest_id, batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        event.id,
        fileUrl,
        isAudio ? 'audio' : isVideo ? 'video' : 'photo',
        uploader_name || null,
        message       || null,
        isVidMsg,
        isApproved,
        originalKey,
        videoStatus,
        preThumbUrl,
        guestId,
        batchId,
      ],
    );

    // Fire-and-forget the wall-friendly transcode for video uploads. The
    // lambda fetches the pre-thumb from R2 by key (kept tiny so the SQS
    // payload always fits) rather than receiving the raw data URL inline.
    if (isVideo) {
      try {
        await triggerVideoTranscode(fileKey, {
          preThumbKey,
          eventId: rows[0].event_id,
        });
      } catch (err) {
        fastify.log.warn({ err: err.message, upload_id: rows[0].id }, 'transcode kickoff failed');
      }
    }

    // Bidirectional audio_url linking — handles the race between photo and audio
    // uploads that run in parallel on the guest's device.
    //
    // Audio-arrives-first path: photo row doesn't exist yet when audio /complete
    // fires, so the UPDATE below finds nothing. When the photo /complete arrives
    // moments later it runs the photo-side link below to catch the orphaned audio.
    //
    // Photo-arrives-first path: audio /complete runs after photo row is inserted,
    // the UPDATE finds it immediately.
    if (isAudio && batchId) {
      try {
        await fastify.db.query(
          `UPDATE uploads
              SET audio_url = $1
            WHERE id = (
              SELECT id FROM uploads
               WHERE batch_id  = $2
                 AND file_type IN ('photo', 'video')
                 AND event_id  = $3
                 AND audio_url IS NULL
               ORDER BY created_at DESC
               LIMIT 1
            )`,
          [fileUrl, batchId, rows[0].event_id],
        );
      } catch (err) {
        fastify.log.warn({ err: err.message, batchId }, 'audio_url link failed');
      }
    }

    // Photo-side link: audio arrived before this photo row existed.
    // Find the earliest unlinked audio for this batch and attach it.
    if (!isAudio && batchId) {
      try {
        await fastify.db.query(
          `UPDATE uploads
              SET audio_url = (
                SELECT file_url FROM uploads
                 WHERE batch_id  = $2
                   AND file_type = 'audio'
                   AND event_id  = $3
                 ORDER BY created_at ASC
                 LIMIT 1
              )
            WHERE id = $1
              AND audio_url IS NULL`,
          [rows[0].id, batchId, rows[0].event_id],
        );
      } catch (err) {
        fastify.log.warn({ err: err.message, batchId }, 'photo-side audio_url link failed');
      }
    }

    return reply.status(201).send({ upload: rows[0] });
  });

  // POST /api/uploads/batch/:batchId/finalize — no-op kept for client compat.
  // audio_url is written directly by /uploads/complete when an audio file
  // lands with a matching batch_id, so no server-side pairing step is needed.
  fastify.post('/uploads/batch/:batchId/finalize', { config: UPLOAD_WRITE_LIMIT }, async (request, reply) => {
    const { batchId } = request.params;
    if (!batchId || batchId.length > 64) return reply.status(400).send({ error: true });
    return reply.send({ ok: true });
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
    const wantReconcile  = request.query?.reconcile === '1' || request.query?.reconcile === 'true';

    // ── Cache + single-flight for the wall's public read path ──────────
    // Dashboard (?include_pending) and ?reconcile always bypass both.
    if (!includePending && !wantReconcile) {
      const cached = uploadsCache.get(slug);
      if (cached && cached.expiresAt > Date.now()) {
        // guest_count is in-memory — recompute free on every hit.
        return { ...cached.payload, guest_count: getPresenceCount(slug) };
      }

      // Single-flight: if a DB query is already in-flight for this slug,
      // await the same promise instead of firing a duplicate query.
      // Eliminates the thundering-herd when 600 walls all poll at t=0.
      let inflight = uploadsInflight.get(slug);
      if (!inflight) {
        inflight = (async () => {
          const { rows: evRows } = await fastify.db.query(
            `SELECT id, slug, couple_names, gallery_expires_at, upload_window_ends_at,
                    playback_burst_id, playback_burst_queue
               FROM events WHERE slug = $1 AND is_active = true`, [slug],
          );
          if (!evRows.length) return null;
          const ev = evRows[0];
          const { rows: ups } = await fastify.db.query(
            `SELECT id, file_url, web_url, poster_url, pre_thumb_url, file_type,
                    uploader_name, message, is_video_message, audio_url,
                    created_at, video_status, compressed_key, batch_id, guest_id
               FROM uploads WHERE event_id = $1 AND is_approved = true ORDER BY created_at DESC`,
            [ev.id],
          );
          const now = new Date();
          const payload = {
            uploads: ups,
            event:   ev,
            locks: {
              gallery_locked: !!(ev.gallery_expires_at  && new Date(ev.gallery_expires_at)  < now),
              uploads_closed: !!(ev.upload_window_ends_at && new Date(ev.upload_window_ends_at) < now),
            },
          };
          uploadsCache.set(slug, { payload, expiresAt: Date.now() + UPLOADS_CACHE_TTL });
          return payload;
        })().finally(() => uploadsInflight.delete(slug));
        uploadsInflight.set(slug, inflight);
      }

      const payload = await inflight;
      if (!payload) return reply.status(404).send({ error: true, message: 'Event not found' });
      return { ...payload, guest_count: getPresenceCount(slug) };
    }

    // ── Dashboard / reconcile path — no cache ───────────────────────────
    const { rows: eventRows } = await fastify.db.query(
      'SELECT * FROM events WHERE slug = $1 AND is_active = true',
      [slug],
    );

    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const event = eventRows[0];

    const { rows: uploads } = await fastify.db.query(
      `SELECT * FROM uploads WHERE event_id = $1 ORDER BY created_at DESC`,
      [event.id],
    );
    // Reconcile is the slow self-healing fallback for missed transcode webhooks —
    // it does up to 4 R2 HeadObject calls per video row. Off by default; pass
    // ?reconcile=1 to force it for manual refresh.
    const hydratedUploads = wantReconcile ? await reconcileVideoUploads(uploads) : uploads;

    const now = new Date();
    const locks = {
      gallery_locked: !!(event.gallery_expires_at    && new Date(event.gallery_expires_at)    < now),
      uploads_closed: !!(event.upload_window_ends_at && new Date(event.upload_window_ends_at) < now),
    };

    return { uploads: hydratedUploads, event, locks, guest_count: getPresenceCount(slug) };
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
      `SELECT u.id, u.file_url, u.web_url, u.poster_url, u.event_id, e.user_id
              , u.original_key, u.compressed_key
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

    // Build the full set of R2 keys to drop: original + transcode
    // derivatives (_web.mp4, _poster.jpg) when present.
    const keys = [
      row.original_key,
      row.compressed_key,
      extractStorageKey(row.file_url),
      extractStorageKey(row.web_url),
      extractStorageKey(row.poster_url),
    ].filter(Boolean);
    if (keys.length && process.env.R2_BUCKET_NAME) {
      await Promise.all(keys.map(async key => {
        try {
          await fastify.storage.send(new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key:    key,
          }));
        } catch (err) {
          // Don't block the DB delete on a storage hiccup — the row is the
          // source of truth and a stale R2 object is recoverable later.
          request.log.warn({ err: err.message, upload_id: id, key }, 'R2 object delete failed');
        }
      }));
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
