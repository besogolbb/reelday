/**
 * Background music for the wall.
 *
 * Phase 1 — curated playlists:
 *   GET  /api/events/:slug/music             — wall fetches this on load
 *   GET  /api/music/playlists                — dashboard picker options
 *
 * Phase 2 — per-event uploads (Sinag+):
 *   POST   /api/events/:slug/music/upload-url    — presigned PUT to R2
 *   POST   /api/events/:slug/music/complete      — register the track in DB
 *   GET    /api/events/:slug/music/uploads       — list the host's tracks
 *   DELETE /api/events/:slug/music/uploads/:id   — remove one
 *
 * When an event has ANY custom uploaded tracks, the wall plays those
 * instead of the picked curated playlist (the dashboard UI says so
 * explicitly). This keeps the wall code simple — one playlist per event,
 * either fully curated or fully custom.
 */

import { randomUUID } from 'crypto';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolvePlan } from '../lib/plans.js';

const MAX_TRACK_BYTES = 25 * 1024 * 1024;   // 25 MB per track (covers ~25 min of 128 kbps MP3)
const MAX_TRACKS_PER_EVENT = 20;            // cap so a single event can't fill the bucket
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/m4a', 'audio/x-m4a',
  'audio/wav', 'audio/x-wav',
  'audio/ogg', 'audio/webm',
  'audio/aac',
]);

export default async function musicRoutes(fastify) {
  function publicMediaUrl(key) {
    const base = (process.env.R2_PUBLIC_URL || 'https://media.reelday.ph').replace(/\/+$/, '');
    return `${base}/${String(key).replace(/^\/+/, '')}`;
  }

  // Load event + owner plan. If `requireOwner`, also asserts request.user.id
  // owns the event. Returns { event, plan } or sends a response and null.
  async function loadEvent(slug, request, reply, { requireOwner = false, requireCustomMusic = false } = {}) {
    const { rows } = await fastify.db.query(
      `SELECT e.id, e.is_active, e.user_id, e.music_playlist_id, e.music_enabled,
              u.subscription_tier
         FROM events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.slug = $1`,
      [slug],
    );
    if (!rows.length || rows[0].is_active === false) {
      reply.status(404).send({ error: true, message: 'Event not found' });
      return null;
    }
    const event = rows[0];
    const plan  = resolvePlan(event.subscription_tier || 'tala');

    if (requireOwner) {
      if (!request.user?.id) {
        reply.status(401).send({ error: true, message: 'Authentication required' });
        return null;
      }
      if (event.user_id !== request.user.id) {
        reply.status(403).send({ error: true, message: 'Not your event' });
        return null;
      }
    }
    if (requireCustomMusic && !plan.features?.customMusic) {
      reply.status(403).send({
        error: true,
        code: 'custom_music_locked',
        message: 'Upload your own music with a Sinag plan or higher.',
      });
      return null;
    }
    return { event, plan };
  }

  // ── PHASE 1: curated playlists ────────────────────────────────

  // Public — wall reads the active playlist for an event. When custom
  // uploaded tracks exist, those take precedence over the curated pick.
  fastify.get('/events/:slug/music', async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, {});
    if (!ctx) return;
    const { event } = ctx;

    if (event.music_enabled === false) {
      reply.header('Cache-Control', 'no-store');
      return { playlist: null };
    }

    // First: do we have ANY custom tracks for this event? If yes, use them.
    const { rows: customRows } = await fastify.db.query(
      `SELECT id, title, artist, file_url, duration_s, license_info
         FROM music_tracks
        WHERE event_id = $1
        ORDER BY position ASC, created_at ASC`,
      [event.id],
    );
    if (customRows.length) {
      // no-store so dashboard changes are reflected on the next wall reload
      reply.header('Cache-Control', 'no-store');
      return {
        playlist: {
          id:          'custom-' + event.id,
          name:        'Your Uploaded Music',
          mood:        'custom',
          cover_color: '#7a4ad6',
          description: 'Tracks you uploaded for this event',
          tracks:      customRows,
          is_custom:   true,
        },
      };
    }

    // Otherwise fall through to the curated playlist (if picked).
    if (!event.music_playlist_id) {
      reply.header('Cache-Control', 'no-store');
      return { playlist: null };
    }

    const { rows: playlistRows } = await fastify.db.query(
      `SELECT id, name, mood, cover_color, description
         FROM music_playlists
        WHERE id = $1 AND is_active = true`,
      [event.music_playlist_id],
    );
    if (!playlistRows.length) {
      reply.header('Cache-Control', 'no-store');
      return { playlist: null };
    }
    const playlist = playlistRows[0];

    const { rows: trackRows } = await fastify.db.query(
      `SELECT id, title, artist, file_url, duration_s, license_info
         FROM music_tracks
        WHERE playlist_id = $1 AND event_id IS NULL
        ORDER BY position ASC, created_at ASC`,
      [playlist.id],
    );

    // no-store so dashboard changes (switching playlist, turning off) are
    // reflected on the next wall reload — the bandwidth cost of an extra
    // ~3KB JSON fetch per wall load is trivial.
    reply.header('Cache-Control', 'no-store');
    return {
      playlist: {
        id:          playlist.id,
        name:        playlist.name,
        mood:        playlist.mood,
        cover_color: playlist.cover_color,
        description: playlist.description,
        tracks:      trackRows,
      },
    };
  });

  // Auth — dashboard picker.
  fastify.get('/music/playlists', { preHandler: fastify.authenticate }, async (_request, reply) => {
    const { rows } = await fastify.db.query(
      `SELECT p.id, p.name, p.mood, p.description, p.cover_color,
              COALESCE(t.track_count, 0)::int AS track_count,
              COALESCE(t.total_duration_s, 0)::int AS total_duration_s
         FROM music_playlists p
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS track_count,
                  COALESCE(SUM(duration_s), 0)::int AS total_duration_s
             FROM music_tracks
            WHERE playlist_id = p.id AND event_id IS NULL
         ) t ON true
        WHERE p.is_active = true
        ORDER BY p.position ASC, p.name ASC`,
    );
    reply.header('Cache-Control', 'private, max-age=60');
    return { playlists: rows };
  });

  // ── PHASE 2: per-event custom uploads ─────────────────────────

  // Presigned PUT URL for the host to upload a music file directly to R2.
  fastify.post('/events/:slug/music/upload-url', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, {
      requireOwner: true, requireCustomMusic: true,
    });
    if (!ctx) return;

    const { filename, contentType } = request.body ?? {};
    if (!filename || typeof filename !== 'string') {
      return reply.status(400).send({ error: true, message: 'filename is required' });
    }
    if (!contentType || !ALLOWED_AUDIO_TYPES.has(String(contentType).toLowerCase())) {
      return reply.status(400).send({
        error: true,
        message: 'Only audio files are allowed (MP3, M4A, WAV, OGG, AAC).',
      });
    }

    // Enforce track count cap before issuing a URL
    const { rows: countRows } = await fastify.db.query(
      `SELECT COUNT(*)::int AS n FROM music_tracks WHERE event_id = $1`,
      [ctx.event.id],
    );
    if (countRows[0].n >= MAX_TRACKS_PER_EVENT) {
      return reply.status(403).send({
        error: true,
        code: 'music_track_limit',
        message: `Max ${MAX_TRACKS_PER_EVENT} custom tracks per event.`,
      });
    }

    // Sanitise filename; keep extension so the browser MIME-sniffs correctly
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'track';
    const fileKey = `music/custom/${ctx.event.id}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET_NAME,
      Key:         fileKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(fastify.storage, command, { expiresIn: 300 });
    return { uploadUrl, fileKey };
  });

  // Confirm the R2 PUT happened and create the DB row.
  fastify.post('/events/:slug/music/complete', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, {
      requireOwner: true, requireCustomMusic: true,
    });
    if (!ctx) return;

    const { fileKey, title, original_filename, duration_s } = request.body ?? {};
    if (!fileKey || typeof fileKey !== 'string' || !fileKey.startsWith(`music/custom/${ctx.event.id}/`)) {
      return reply.status(400).send({ error: true, message: 'fileKey is required and must belong to this event' });
    }
    const cleanTitle = (title || original_filename || 'Uploaded track').toString().trim().slice(0, 160);
    const cleanFilename = (original_filename || '').toString().trim().slice(0, 255) || null;
    const dur = Math.max(0, Math.min(60 * 30, parseInt(duration_s, 10) || 0)); // cap at 30 min

    // Find next position
    const { rows: posRows } = await fastify.db.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
         FROM music_tracks WHERE event_id = $1`,
      [ctx.event.id],
    );
    const nextPos = posRows[0].next_pos;

    const { rows } = await fastify.db.query(
      `INSERT INTO music_tracks
         (event_id, uploaded_by_user_id, title, file_url, duration_s, position,
          r2_key, original_filename, license_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, file_url, duration_s, position, original_filename, created_at`,
      [
        ctx.event.id, request.user.id, cleanTitle, publicMediaUrl(fileKey),
        dur, nextPos, fileKey, cleanFilename,
        'Uploaded by event host (host confirmed they have rights to use this audio)',
      ],
    );
    return reply.status(201).send({ track: rows[0] });
  });

  // List the host's custom tracks for this event (dashboard).
  fastify.get('/events/:slug/music/uploads', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;

    const { rows } = await fastify.db.query(
      `SELECT id, title, original_filename, duration_s, position, created_at
         FROM music_tracks
        WHERE event_id = $1
        ORDER BY position ASC, created_at ASC`,
      [ctx.event.id],
    );
    reply.header('Cache-Control', 'no-store');
    return { tracks: rows, custom_music_unlocked: !!ctx.plan.features?.customMusic };
  });

  // Remove one custom track + its R2 object.
  fastify.delete('/events/:slug/music/uploads/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;
    const { id } = request.params;

    const { rows } = await fastify.db.query(
      `SELECT id, r2_key FROM music_tracks
        WHERE id = $1 AND event_id = $2`,
      [id, ctx.event.id],
    );
    if (!rows.length) {
      return reply.status(404).send({ error: true, message: 'Track not found' });
    }

    if (rows[0].r2_key && process.env.R2_BUCKET_NAME) {
      try {
        await fastify.storage.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key:    rows[0].r2_key,
        }));
      } catch (err) {
        // Don't block the DB delete on a storage hiccup — the row is the
        // source of truth and a stray R2 object is recoverable later.
        request.log.warn({ err: err.message, track_id: id, key: rows[0].r2_key },
                         'music track R2 delete failed');
      }
    }

    await fastify.db.query('DELETE FROM music_tracks WHERE id = $1', [id]);
    return { success: true };
  });
}
