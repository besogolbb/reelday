/**
 * Background music for the wall (Phase 1).
 *
 * Public:
 *   GET  /api/events/:slug/music         — wall fetches this once on load
 *
 * Host (auth required):
 *   GET  /api/music/playlists            — picker options for the dashboard
 *
 * The wall calls /events/:slug/music once when it loads and again whenever
 * the host edits the event. Tracks are absolute R2 public URLs; the wall
 * streams them directly from Cloudflare. No backend involvement after the
 * initial JSON payload — keeps perf baselines untouched.
 *
 * Music is intentionally NOT plan-gated in Phase 1: every event gets it for
 * free so the launch wall feels alive. If we later want it to be a Sinag+
 * differentiator, gate the GET endpoint by `plan.features.music`.
 */

export default async function musicRoutes(fastify) {
  // Public — wall reads the active playlist for an event.
  fastify.get('/events/:slug/music', async (request, reply) => {
    const { slug } = request.params;

    const { rows: eventRows } = await fastify.db.query(
      `SELECT id, music_playlist_id, music_enabled
         FROM events
        WHERE slug = $1 AND is_active = true`,
      [slug],
    );
    if (!eventRows.length) {
      return reply.status(404).send({ error: true, message: 'Event not found' });
    }
    const event = eventRows[0];

    // No playlist picked, or host explicitly disabled music for this event.
    if (!event.music_playlist_id || event.music_enabled === false) {
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
        WHERE playlist_id = $1
        ORDER BY position ASC, created_at ASC`,
      [playlist.id],
    );

    // Cache for 5 min on the client — the wall only refetches on full reload,
    // and playlist content rarely changes mid-event. Saves a few round-trips
    // if the wall reloads.
    reply.header('Cache-Control', 'private, max-age=300');
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
            WHERE playlist_id = p.id
         ) t ON true
        WHERE p.is_active = true
        ORDER BY p.position ASC, p.name ASC`,
    );
    reply.header('Cache-Control', 'private, max-age=60');
    return { playlists: rows };
  });
}
