import { extname, posix as pathPosix } from 'path';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { gzipSync } from 'zlib';
import archiver from 'archiver';
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolvePlan, isDemoWindowOpen } from '../lib/plans.js';
import { extractStorageKey } from '../lib/storageKeys.js';
import { triggerVideoTranscode } from '../lib/awsLambdaService.js';
import { verifyToken } from '../plugins/auth.js';
import { getCount as getPresenceCount } from './presence.js';

// Signed download tokens for the bulk-ZIP endpoint. Browsers can't add
// Authorization headers to a top-level navigation, so we issue a short-
// lived HMAC token via a JSON POST that the frontend then appends to a
// regular GET URL. 5-minute TTL is plenty for "click button → server
// starts streaming". Reuses JWT_SECRET so we don't need another env var.
const DOWNLOAD_TOKEN_TTL_SEC = 300;
function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}
function signDownloadToken(slug, userId) {
  const payload = JSON.stringify({
    s: slug, u: userId, e: Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SEC,
  });
  const body = b64url(payload);
  const sig  = b64url(createHmac('sha256', process.env.JWT_SECRET).update(body).digest());
  return `${body}.${sig}`;
}
function verifyDownloadToken(token, expectedSlug) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = b64url(createHmac('sha256', process.env.JWT_SECRET).update(body).digest());
  const wantBuf = Buffer.from(want);
  const gotBuf  = Buffer.from(sig);
  if (wantBuf.length !== gotBuf.length || !timingSafeEqual(wantBuf, gotBuf)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')); }
  catch { return null; }
  if (!payload || payload.s !== expectedSlug) return null;
  if (typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) return null;
  return { userId: payload.u };
}

// Build the per-upload filename inside the ZIP. We want files that read
// cleanly in a Mac/Windows file picker: a zero-padded sequence so the
// natural sort matches upload order, a slug of the uploader's name,
// and the original extension preserved from the R2 key.
function zipEntryName(upload, index) {
  const seq = String(index + 1).padStart(3, '0');
  const safeName = String(upload.uploader_name || 'guest')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'guest';
  const key = upload.original_key || extractStorageKey(upload.file_url) || '';
  const ext = (extname(key) || extname(upload.file_url || '') || '.bin').toLowerCase();
  let folder = 'photos';
  if (upload.file_type === 'video' || upload.is_video_message) folder = 'videos';
  else if (upload.file_type === 'audio_note' || upload.file_type === 'audio') folder = 'audio-notes';
  return `${folder}/${seq}_${safeName}${ext}`;
}

// Short TTL cache for GET /uploads/:slug (the wall's hot-read path).
// 600 walls polling every 2s would otherwise fire 600 DB queries per cycle.
// 1.5s TTL keeps staleness below one poll interval; dashboard bypasses it.
// Each cache entry also stores a pre-built gzip buffer (built once on the DB
// query that populates the entry) so cache hits are a cheap buffer send.
const UPLOADS_CACHE_TTL = 1500;
const uploadsCache  = new Map(); // slug → { payload, gzipped, expiresAt }
const uploadsInflight = new Map(); // slug → Promise<payload>  (single-flight dedup)

// Cache for upload validation (event + owner plan). During a burst 600 guests
// all hit presigned at the same instant — without this each fires 2 sequential
// DB queries (events + users). A 10s TTL covers the entire burst window while
// keeping plan/window changes visible within one cache cycle.
const EVENT_VALIDATION_TTL = 10_000;
const eventValidationCache = new Map(); // slug → { data: {event, plan}, expiresAt }
const eventValidationInflight = new Map(); // slug → Promise<{event,plan}|null>  (single-flight dedup)

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

  // Helper to optionally get user from token without forcing authentication
  function tryGetUser(request) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try { return verifyToken(header.slice(7)); }
    catch { return null; }
  }

  // Helper to validate event status and plan limits before allowing uploads.
  // Reused by both legacy multipart and new presigned flows.
  //
  // Optimisations vs the original three-sequential-query version:
  //   1. Single LEFT JOIN fetches event + owner tier in one round-trip.
  //   2. Result is cached per slug for EVENT_VALIDATION_TTL (10 s) so a
  //      600-guest simultaneous burst hits the DB once, not 600 times.
  //      Owner requests bypass the cache so hosts always get live data.
  async function getValidatedEvent(slug, currentUser = null) {
    const isOwnerRequest = Boolean(currentUser);
    let eventData = null;

    if (!isOwnerRequest) {
      const hit = eventValidationCache.get(slug);
      if (hit && hit.expiresAt > Date.now()) eventData = hit.data;

      // Single-flight: if another request is already fetching this slug, wait for it
      // rather than stampeding the DB with duplicate queries.
      if (!eventData && eventValidationInflight.has(slug)) {
        eventData = await eventValidationInflight.get(slug);
      }
    }

    if (!eventData) {
      let settle;
      if (!isOwnerRequest) {
        // Register inflight promise before the await so concurrent arrivals coalesce.
        const promise = new Promise(resolve => { settle = resolve; });
        eventValidationInflight.set(slug, promise);
      }

      try {
        // One query: event columns + owner's live subscription tier via LEFT JOIN.
        // LEFT JOIN (not INNER) so we can distinguish owner_missing from not_found.
        const { rows } = await fastify.db.query(
          `SELECT e.id, e.slug, e.user_id, e.plan, e.is_active, e.created_at,
                  e.gallery_expires_at, e.upload_window_starts_at, e.upload_window_ends_at,
                  e.auto_approve, e.video_auto_approve, e.video_message_auto_approve,
                  e.couple_names, e.playback_burst_id, e.playback_burst_queue,
                  u.id AS owner_db_id, u.subscription_tier, u.is_active AS owner_is_active
             FROM events e
             LEFT JOIN users u ON u.id = e.user_id
            WHERE e.slug = $1`,
          [slug],
        );

        if (!rows.length || rows[0].is_active === false) {
          throw { statusCode: 404, message: 'Event not found' };
        }
        const row = rows[0];

        if (!row.user_id) {
          throw { statusCode: 403, code: 'orphan_event', message: 'This event is not linked to an account.' };
        }
        if (!row.owner_db_id) {
          throw { statusCode: 403, code: 'owner_missing', message: 'Event owner account no longer exists.' };
        }

        // Per-event tier: events.plan is the source of truth (locked in at
        // create / upgrade time). users.subscription_tier is the legacy
        // fallback for rows created before per-event plans existed.
        const effectiveTier = row.plan || row.subscription_tier;
        const plan = resolvePlan(effectiveTier);
        const event = row;

        eventData = { event, plan };
        if (!isOwnerRequest) {
          eventValidationCache.set(slug, { data: eventData, expiresAt: Date.now() + EVENT_VALIDATION_TTL });
          settle(eventData);
          eventValidationInflight.delete(slug);
        }
      } catch (e) {
        if (settle) {
          settle(null); // unblock waiters; they will re-attempt their own query
          eventValidationInflight.delete(slug);
        }
        throw e;
      }
    }

    const { event, plan } = eventData;
    const isOwner = currentUser && currentUser.id === event.user_id;

    fastify.log.info({ slug, isOwner, userId: currentUser?.id, eventUserId: event.user_id }, 'Validating event upload');

    // NOTE: uploads are intentionally OPEN regardless of event.is_paid —
    // PH manual-payment flow can lag, and we don't want guests blocked at the QR.
    // Viewing the gallery is still gated elsewhere when is_paid is false.

    if (!isOwner && event.gallery_expires_at && new Date(event.gallery_expires_at) < new Date()) {
      throw { statusCode: 403, code: 'gallery_locked', message: 'Gallery archived. Uploads closed.' };
    }
    // Tala demo window: allow uploads for 48h after event creation so new
    // users can try the product before their event date arrives. Both
    // window gates are bypassed while the demo window is open.
    const demoOpen = !isOwner && isDemoWindowOpen(plan.id, event.created_at);

    // Start-of-window gate: NULL means legacy event (centered model
    // wasn't a thing when it was created) — skip the check so those
    // events keep their original "open from creation" behavior.
    if (!isOwner && !demoOpen && event.upload_window_starts_at && new Date(event.upload_window_starts_at) > new Date()) {
      throw {
        statusCode: 403,
        code: 'upload_window_not_open',
        message: 'Uploads open closer to the event date.',
        opens_at: event.upload_window_starts_at,
      };
    }
    if (!isOwner && !demoOpen && event.upload_window_ends_at && new Date(event.upload_window_ends_at) < new Date()) {
      throw { statusCode: 403, code: 'upload_window_closed', message: 'Upload window has ended.' };
    }

    if (plan.uploadLimit) {
      const { rows: countRows } = await fastify.db.query(
        'SELECT COUNT(*)::int AS count FROM uploads WHERE event_id = $1',
        [event.id],
      );
      if (countRows[0].count >= plan.uploadLimit) {
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
      return reply.status(e.statusCode || 500).send({ error: true, message: e.message || 'Upload error', ...e });
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

    // Tala is photos-only — block all video, not just video messages.
    if (isVideo && !plan.features?.videoUpload) {
      return reply.status(403).send({
        error: true,
        code: 'plan_no_video',
        message: 'Video uploads need a Sinag plan or higher. The free plan is photos only.',
      });
    }
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

    let presignPlan;
    try {
      ({ plan: presignPlan } = await getValidatedEvent(slug, request.user));
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ error: true, message: e.message || 'Upload error', ...e });
    }

    // Plan gate at the door — reject before issuing the PUT URL so
    // disallowed media never reaches R2 at all (Tala = photos only;
    // audio notes are Dalisay+). Matches the deeper checks in the
    // multipart + /complete paths.
    const ct = String(contentType || '');
    if (ct.startsWith('video/') && !presignPlan.features?.videoUpload) {
      return reply.status(403).send({
        error: true, code: 'plan_no_video',
        message: 'Video uploads need a Sinag plan or higher. The free plan is photos only.',
      });
    }
    if (ct.startsWith('audio/') && !presignPlan.features?.audioNotes) {
      return reply.status(403).send({
        error: true, code: 'plan_no_audio',
        message: 'Voice notes need a Dalisay plan or higher.',
      });
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
    const { slug, fileKey, uploader_name, message, file_type, is_video_message, poster_data_url, thumb_data_url, batch_id } = request.body;
    const guestId  = (request.headers['x-guest-id'] || '').trim().slice(0, 64) || null;
    const batchId  = (typeof batch_id === 'string' ? batch_id.trim().slice(0, 64) : null) || null;

    // Optionally authenticate the user if a token is present
    request.user = tryGetUser(request);

    let event, plan;
    try {
      ({ event, plan } = await getValidatedEvent(slug, request.user));
    } catch (e) {
      return reply.status(e.statusCode || 500).send({ error: true, message: e.message || 'Upload error', ...e });
    }

    const publicBase = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
    const fileUrl = `${publicBase}/${fileKey}`;
    // Audio must be detected first — audio/webm shares the .webm extension
    // with video, so the regex below would misclassify it without this guard.
    const isAudio = file_type === 'audio';
    const isVideo = !isAudio && (file_type === 'video' || (file_type !== 'photo' && fileKey.match(/\.(mp4|webm|mov|m4v|ogg)$/i)));
    const isVidMsg = isVideo && is_video_message === true;

    // Defense in depth — the presign step already gated this, but a
    // client could call /complete with a hand-built fileKey. Reject so
    // a Tala video / non-Dalisay audio never gets a DB row (the bytes
    // may exist in R2 but stay orphaned and invisible).
    if (isVideo && !plan.features?.videoUpload) {
      return reply.status(403).send({
        error: true, code: 'plan_no_video',
        message: 'Video uploads need a Sinag plan or higher. The free plan is photos only.',
      });
    }
    if (isAudio && !plan.features?.audioNotes) {
      return reply.status(403).send({
        error: true, code: 'plan_no_audio',
        message: 'Voice notes need a Dalisay plan or higher.',
      });
    }
    const originalKey = isVideo ? fileKey : null;
    const videoStatus = isVideo ? 'processing' : null;

    // Persist the guest-browser thumbnail as a sibling R2 object.
    // Videos send poster_data_url (a frame captured from the video element).
    // Photos send thumb_data_url (a 320px canvas JPEG).
    // Both end up in pre_thumb_url so the wall can show something while the
    // full asset loads, and so the polaroid strip on the upload page uses the
    // small version instead of the full-resolution file.
    let preThumbUrl = null;
    let preThumbKey = null;
    const rawThumb = isVideo ? poster_data_url : (!isAudio ? thumb_data_url : null);
    if (typeof rawThumb === 'string' && /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(rawThumb)) {
      try {
        const match = rawThumb.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
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
        const acceptsGzip = (request.headers['accept-encoding'] || '').includes('gzip');
        if (acceptsGzip && cached.gzipped) {
          // Fast path: pre-built gzip buffer, no CPU work needed.
          // guest_count is baked into gzipped at cache-fill time (max 1.5s stale — fine).
          return reply
            .header('Content-Type', 'application/json; charset=utf-8')
            .header('Content-Encoding', 'gzip')
            .header('Vary', 'Accept-Encoding')
            .send(cached.gzipped);
        }
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
            `SELECT id, slug, couple_names, gallery_expires_at, created_at, plan,
                    upload_window_starts_at, upload_window_ends_at,
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
          const demoWindowOpen = isDemoWindowOpen(ev.plan, ev.created_at);
          const payload = {
            uploads: ups,
            event:   ev,
            locks: {
              gallery_locked:        !!(ev.gallery_expires_at      && new Date(ev.gallery_expires_at)      < now),
              uploads_not_yet_open:  !demoWindowOpen && !!(ev.upload_window_starts_at && new Date(ev.upload_window_starts_at) > now),
              uploads_closed:        !demoWindowOpen && !!(ev.upload_window_ends_at   && new Date(ev.upload_window_ends_at)   < now),
            },
          };
          // Build gzip once at cache-fill time. guest_count is sampled now
          // (max 1.5s stale on subsequent hits — acceptable for a display counter).
          const fullPayload = { ...payload, guest_count: getPresenceCount(slug) };
          const gzipped = gzipSync(JSON.stringify(fullPayload));
          uploadsCache.set(slug, { payload, gzipped, expiresAt: Date.now() + UPLOADS_CACHE_TTL });
          return payload;
        })().finally(() => uploadsInflight.delete(slug));
        uploadsInflight.set(slug, inflight);
      }

      const payload = await inflight;
      if (!payload) return reply.status(404).send({ error: true, message: 'Event not found' });
      // After inflight resolves the cache entry (with gzip) is populated.
      const afterCache = uploadsCache.get(slug);
      const acceptsGzip = (request.headers['accept-encoding'] || '').includes('gzip');
      if (acceptsGzip && afterCache?.gzipped) {
        return reply
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Content-Encoding', 'gzip')
          .header('Vary', 'Accept-Encoding')
          .send(afterCache.gzipped);
      }
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
    const demoWindowOpen = isDemoWindowOpen(event.plan, event.created_at);
    const locks = {
      gallery_locked:        !!(event.gallery_expires_at      && new Date(event.gallery_expires_at)      < now),
      uploads_not_yet_open:  !demoWindowOpen && !!(event.upload_window_starts_at && new Date(event.upload_window_starts_at) > now),
      uploads_closed:        !demoWindowOpen && !!(event.upload_window_ends_at   && new Date(event.upload_window_ends_at)   < now),
    };

    return { uploads: hydratedUploads, event, locks, guest_count: getPresenceCount(slug) };
  });

  // POST /api/uploads/:slug/download-token — owner-only. Issues a short-
  // lived HMAC token the dashboard uses to navigate to the streaming-ZIP
  // endpoint below. We need this two-step dance because browser top-level
  // navigations can't carry an Authorization header.
  fastify.post('/uploads/:slug/download-token', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params;
    const { rows } = await fastify.db.query(
      `SELECT id, user_id, gallery_expires_at, couple_names
         FROM events WHERE slug = $1 AND is_active = true`,
      [slug],
    );
    if (!rows.length) return reply.status(404).send({ error: true, message: 'Event not found' });
    const event = rows[0];
    if (event.user_id !== request.user.id) {
      return reply.status(403).send({ error: true, message: 'Not your event' });
    }
    if (event.gallery_expires_at && new Date(event.gallery_expires_at) < new Date()) {
      return reply.status(403).send({
        error: true,
        code: 'gallery_locked',
        message: 'This event gallery has been archived. Downloads are no longer available — upgrade to extend retention.',
        gallery_expires_at: event.gallery_expires_at,
      });
    }
    const { rows: countRows } = await fastify.db.query(
      `SELECT COUNT(*)::int AS n FROM uploads WHERE event_id = $1 AND is_approved = true`,
      [event.id],
    );
    if (!countRows[0].n) {
      return reply.status(400).send({ error: true, code: 'empty_gallery', message: 'No uploads to download yet.' });
    }
    return {
      token:        signDownloadToken(slug, request.user.id),
      expires_in:   DOWNLOAD_TOKEN_TTL_SEC,
      upload_count: countRows[0].n,
    };
  });

  // GET /api/uploads/:slug/download.zip?t=<token> — streams a ZIP of every
  // approved upload to the browser. No Authorization header needed (the
  // token IS the auth). Streams to reply.raw so we never buffer the full
  // archive in memory — works for 2+ GB wedding galleries on cheap nodes.
  //
  // ZIP structure:
  //   photos/      001_<uploader>.jpg
  //   videos/      001_<uploader>.mp4
  //   audio-notes/ 001_<uploader>.m4a
  // Files in chronological order so wedding timelines read naturally.
  // No re-compression (zlib level 0) — JPEG/MP4/AAC are already compressed,
  // running deflate over them wastes CPU for ~0% size gain.
  fastify.get('/uploads/:slug/download.zip', async (request, reply) => {
    const { slug } = request.params;
    const token = request.query?.t;
    const verified = verifyDownloadToken(token, slug);
    if (!verified) {
      return reply.status(401).send({ error: true, message: 'Invalid or expired download token' });
    }

    const { rows: eventRows } = await fastify.db.query(
      `SELECT id, user_id, gallery_expires_at, couple_names
         FROM events WHERE slug = $1 AND is_active = true`,
      [slug],
    );
    if (!eventRows.length) return reply.status(404).send({ error: true, message: 'Event not found' });
    const event = eventRows[0];
    if (event.user_id !== verified.userId) {
      return reply.status(403).send({ error: true, message: 'Not your event' });
    }
    if (event.gallery_expires_at && new Date(event.gallery_expires_at) < new Date()) {
      return reply.status(403).send({
        error: true,
        code: 'gallery_locked',
        message: 'This event gallery has been archived.',
      });
    }

    const { rows: uploads } = await fastify.db.query(
      `SELECT id, file_url, original_key, file_type, uploader_name,
              is_video_message, created_at
         FROM uploads
        WHERE event_id = $1 AND is_approved = true
        ORDER BY created_at ASC`,
      [event.id],
    );
    if (!uploads.length) {
      return reply.status(400).send({ error: true, code: 'empty_gallery', message: 'No uploads to download.' });
    }

    if (!process.env.R2_BUCKET_NAME) {
      return reply.status(503).send({ error: true, message: 'Storage backend not configured' });
    }

    // Filename guests will see in their Downloads folder. Falls back to
    // the slug if couple_names is missing (legacy rows).
    const baseName = String(event.couple_names || slug)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || slug;
    const today = new Date().toISOString().slice(0, 10);
    const zipName = `${baseName}-reelday-${today}.zip`;

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${zipName}"`);
    // No Content-Length — archive size is unknown until finalize.

    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.on('warning', err => {
      if (err.code !== 'ENOENT') request.log.warn({ err: err.message, slug }, 'archive warning');
    });
    archive.on('error', err => {
      request.log.error({ err: err.message, slug }, 'archive error');
      // Stream has already started — best we can do is destroy reply.raw.
      try { reply.raw.destroy(err); } catch { /* */ }
    });

    // Hijack so Fastify doesn't also try to send a response.
    reply.hijack();
    archive.pipe(reply.raw);

    // Sequentially fetch + append each upload. Parallel would be faster
    // but blows up memory on a 500-photo gallery; sequential keeps the
    // working set to one file at a time. Each Body is a Readable stream
    // piped straight into the archive — no intermediate buffer.
    for (let i = 0; i < uploads.length; i++) {
      const u = uploads[i];
      const key = u.original_key || extractStorageKey(u.file_url);
      if (!key) {
        request.log.warn({ upload_id: u.id }, 'skipped: no R2 key');
        continue;
      }
      try {
        const obj = await fastify.storage.send(new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key:    key,
        }));
        archive.append(obj.Body, { name: zipEntryName(u, i) });
      } catch (err) {
        request.log.warn({ err: err.message, upload_id: u.id, key }, 'r2 fetch failed; skipping');
        // Don't fail the whole ZIP for one missing object — host gets the
        // rest. The DB still references it but the file isn't recoverable
        // (likely deleted out-of-band). Future cleanup work can prune.
      }
    }

    await archive.finalize();
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
