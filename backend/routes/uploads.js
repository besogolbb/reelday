import { extname } from 'path';
import { randomUUID } from 'crypto';

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
