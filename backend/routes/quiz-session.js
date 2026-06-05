/**
 * Quiz session — when the host hits "Run all" on the dashboard, the
 * wall needs to know it's in a sequential-question session so it can:
 *   * keep the photo slideshow paused for the *entire* run instead of
 *     flickering photos in the 1-2s gap between question overlays
 *   * show a final leaderboard overlay once the run completes
 *
 * State is in-memory only; cleared on backend restart, which is fine
 * because Run-all is a host-driven foreground action (no recovery
 * needed across restarts).
 */

import { quizSessions as sessions } from '../lib/quizSessions.js';

export default async function quizSessionRoutes(fastify) {
  async function loadOwnedEvent(request, reply) {
    const { rows } = await fastify.db.query(
      'SELECT id, user_id FROM events WHERE slug = $1',
      [request.params.slug],
    );
    if (!rows.length)                         { reply.status(404).send({ error: true, message: 'Event not found' }); return null; }
    if (rows[0].user_id !== request.user?.id) { reply.status(403).send({ error: true, message: 'Not your event' }); return null; }
    return rows[0];
  }

  // Snapshot the leaderboard at the moment a Run-all ends so the wall sees
  // a stable list rather than racing the next vote in.
  //
  // `sinceDb` is the session start (DB-clock ISO). We scope BOTH the score
  // counts and the question total to polls started during THIS run — without
  // it, votes left in poll_votes from an earlier *solo* question run (never
  // wiped because that question wasn't re-run) leak into the result, showing
  // phantom answers nobody gave this session.
  async function snapshotLeaderboard(eventId, sinceDb) {
    const { rows: counts } = await fastify.db.query(
      `SELECT COUNT(*)::int AS n
         FROM polls
        WHERE event_id = $1 AND kind = 'question' AND correct_key IS NOT NULL
          AND ($2::timestamptz IS NULL OR started_at >= $2::timestamptz)`,
      [eventId, sinceDb || null],
    );
    const total_questions = counts[0]?.n || 0;

    const { rows } = await fastify.db.query(
      `SELECT pv.guest_name,
              COUNT(*) FILTER (WHERE pv.option_key = p.correct_key)::int AS correct_count,
              ROUND(AVG(EXTRACT(EPOCH FROM (pv.created_at - p.started_at)))
                FILTER (WHERE pv.option_key = p.correct_key)::numeric, 1) AS avg_correct_seconds
         FROM poll_votes pv
         JOIN polls p ON p.id = pv.poll_id
        WHERE p.event_id = $1
          AND p.kind = 'question'
          AND p.correct_key IS NOT NULL
          AND pv.guest_name IS NOT NULL
          AND pv.guest_name <> ''
          AND ($2::timestamptz IS NULL OR p.started_at >= $2::timestamptz)
        GROUP BY pv.guest_name
        ORDER BY correct_count DESC, avg_correct_seconds ASC NULLS LAST, pv.guest_name ASC
        LIMIT 20`,
      [eventId, sinceDb || null],
    );
    return { total_questions, leaderboard: rows };
  }

  // Host marks the start of a Run-all session.
  fastify.post('/events/:slug/quiz/start', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ev = await loadOwnedEvent(request, reply);
    if (!ev) return;
    const total = Math.max(1, parseInt(request.body?.total, 10) || 1);
    // Capture the start from the DB clock so it lines up exactly with the
    // poll.started_at values we later compare against (no app-vs-DB skew).
    const { rows: nowRows } = await fastify.db.query('SELECT NOW() AS now');
    sessions.set(ev.id, {
      active: true,
      total,
      started_at: Date.now(),
      started_at_db: nowRows[0]?.now || null,
      ended_at: null,
      leaderboard: null,
      total_questions: 0,
    });
    return { success: true };
  });

  // Host marks the end. Snapshot the leaderboard so the wall can read
  // a stable result during its display window.
  fastify.post('/events/:slug/quiz/end', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ev = await loadOwnedEvent(request, reply);
    if (!ev) return;

    const prev = sessions.get(ev.id);
    const { leaderboard, total_questions } = await snapshotLeaderboard(ev.id, prev?.started_at_db || null);

    sessions.set(ev.id, {
      ...(prev || { total: total_questions, started_at: Date.now() }),
      active: false,
      ended_at: Date.now(),
      leaderboard,
      total_questions,
    });
    // Auto-clear the snapshot after 60s so we don't pin stale state in
    // memory once the wall has had a chance to display it.
    setTimeout(() => {
      const s = sessions.get(ev.id);
      if (s && s.ended_at && Date.now() - s.ended_at >= 55000) sessions.delete(ev.id);
    }, 60000);
    return { success: true, leaderboard, total_questions };
  });

  // Public — wall polls this so it knows when to freeze the slideshow
  // and when to flip to the leaderboard overlay. No auth: same model as
  // /polls/active. Cache disabled so polling sees state changes promptly.
  fastify.get('/events/:slug/quiz/state', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { rows } = await fastify.db.query(
      'SELECT id FROM events WHERE slug = $1 AND is_active = true',
      [request.params.slug],
    );
    if (!rows.length) return reply.status(404).send({ error: true, message: 'Event not found' });
    const s = sessions.get(rows[0].id);
    if (!s) return { state: { active: false } };
    // Only surface the leaderboard for ~30s after end so the wall has
    // time to show it but stale data doesn't linger on the wall forever.
    const expired = s.ended_at && (Date.now() - s.ended_at) > 30000;
    return {
      state: {
        active: !!s.active,
        total: s.total,
        ended_at: s.ended_at,
        leaderboard: (!s.active && !expired) ? (s.leaderboard || []) : null,
        total_questions: s.total_questions || 0,
      },
    };
  });
}
