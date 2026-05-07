import { extname } from 'path';
import { randomUUID } from 'crypto';
import { resolvePlan } from '../lib/plans.js';

export default async function uploadRoutes(fastify) {
  // POST /api/uploads/:slug — upload a photo or video
  fastify.post('/uploads/:slug', async (request, reply) => {
    const { slug } = request.params;

    const { rows: eventRows } = await fastify.db.query(
      'SELECT * FROM events WHERE slug = $1 AND is_active = true',
      [slug],
    );

    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const event = eventRows[0];

    // Effective plan = owner's current subscription tier (per-account model).
    // Falls back to event.plan if event has no owner (legacy / anonymous).
    let effectiveTier = event.plan;
    if (event.user_id) {
      const { rows: ownerRows } = await fastify.db.query(
        `SELECT subscription_tier FROM users WHERE id = $1`,
        [event.user_id],
      );
      if (ownerRows.length && ownerRows[0].subscription_tier) {
        effectiveTier = ownerRows[0].subscription_tier;
      }
    }
    const plan = resolvePlan(effectiveTier);

    // ── Feature gating ────────────────────────────────────
    // Only block when the event is on a *paid* tier without payment.
    // Free tiers (tala, libre legacy) accept uploads without payment.
    if (!event.is_paid && plan.price > 0 && plan.id !== resolvePlan(event.plan).id) {
      // Owner upgraded their account but the event itself isn't marked paid.
      // That's fine — the account-tier covers it. Skip the legacy check.
    } else if (!event.is_paid && plan.price > 0) {
      return reply.status(403).send({ error: true, message: 'Payment pending verification' });
    }

    // ── Plan enforcement: upload window ──────────────────
    if (event.upload_window_ends_at && new Date(event.upload_window_ends_at) < new Date()) {
      return reply.status(403).send({
        error: true,
        code: 'upload_window_closed',
        message: 'The upload window for this event has ended.',
        upload_window_ends_at: event.upload_window_ends_at,
      });
    }

    // ── Plan enforcement: upload count ───────────────────
    if (plan.uploadLimit) {
      const { rows: countRows } = await fastify.db.query(
        'SELECT COUNT(*)::int AS count FROM uploads WHERE event_id = $1',
        [event.id],
      );
      const used = countRows[0].count;
      if (used >= plan.uploadLimit) {
        return reply.status(403).send({
          error: true,
          code: 'plan_limit_uploads',
          message: `This event has reached the ${plan.name} plan's ${plan.uploadLimit}-upload limit. Upgrade to keep sharing.`,
          plan:         plan.id,
          upload_limit: plan.uploadLimit,
          used,
        });
      }
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

    if (isVideoMessage && event.plan === 'libre') {
      return reply.status(403).send({ error: true, message: 'Upgrade to Selebrasyon to send video messages' });
    }
    const filename       = `${randomUUID()}${fileExt}`;
    const fileUrl        = await fastify.uploadFile(fileBuffer, filename, fileMime);

    const { rows } = await fastify.db.query(
      `INSERT INTO uploads
         (event_id, file_url, file_type, uploader_name, message, is_video_message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        event.id,
        fileUrl,
        isVideo ? 'video' : 'photo',
        fields.uploader_name || null,
        fields.message       || null,
        isVideoMessage,
      ],
    );

    return reply.status(201).send({
      upload:  rows[0],
      message: 'Salamat! Na-share mo na ang iyong momento.',
    });
  });

  // GET /api/uploads/:slug — list all uploads for an event
  fastify.get('/uploads/:slug', async (request, reply) => {
    const { slug } = request.params;

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
       WHERE event_id = $1 AND is_approved = true
       ORDER BY created_at DESC`,
      [event.id],
    );

    return { uploads, event };
  });

  // GET /api/uploads/:slug/download — list all file URLs for bulk download
  fastify.get('/uploads/:slug/download', async (request, reply) => {
    const { slug } = request.params;

    const { rows: eventRows } = await fastify.db.query(
      'SELECT id FROM events WHERE slug = $1 AND is_active = true',
      [slug],
    );

    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }

    const { rows: uploads } = await fastify.db.query(
      `SELECT file_url, uploader_name, file_type
       FROM uploads
       WHERE event_id = $1 AND is_approved = true
       ORDER BY created_at DESC`,
      [eventRows[0].id],
    );

    return {
      files: uploads.map(u => ({
        url:  u.file_url,
        name: u.uploader_name,
        type: u.file_type,
      })),
    };
  });

  // DELETE /api/uploads/:id — remove an upload (admin)
  fastify.delete('/uploads/:id', async (request, reply) => {
    const { id } = request.params;

    const { rowCount } = await fastify.db.query(
      'DELETE FROM uploads WHERE id = $1',
      [id],
    );

    if (!rowCount) {
      return reply.status(404).send({ error: true, message: 'Upload not found' });
    }

    return { success: true };
  });

  // PATCH /api/uploads/:id/approve — toggle approval (admin)
  fastify.patch('/uploads/:id/approve', async (request, reply) => {
    const { id } = request.params;
    const { is_approved } = request.body ?? {};

    const { rows } = await fastify.db.query(
      'UPDATE uploads SET is_approved = $2 WHERE id = $1 RETURNING *',
      [id, is_approved ?? true],
    );

    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Upload not found' });
    }

    return { upload: rows[0] };
  });
}
