/**
 * Shared in-memory Run-all session store.
 *
 * Lives in its own module (not inside a route plugin) so BOTH the
 * quiz-session routes and the polls routes can read it — Fastify plugin
 * encapsulation means a decorator added in one sibling plugin isn't visible
 * to another, but a plain module import is shared process-wide.
 *
 *   eventId -> {
 *     active,            // bool — a Run-all is currently in progress
 *     total,             // questions the host queued for this run
 *     started_at,        // Date.now() ms — used for the cleanup timer
 *     started_at_db,     // ISO timestamp from the DB clock — the cutoff used
 *                        //   to scope the leaderboard to THIS session's votes
 *                        //   (apples-to-apples with poll.started_at)
 *     ended_at,          // Date.now() ms when the run finished/stopped
 *     leaderboard,       // snapshot taken at end (optional)
 *     total_questions,   // questions actually played this session
 *   }
 *
 * State is cleared on process restart, which is fine: Run-all is a
 * host-driven foreground action with no cross-restart recovery need.
 */
export const quizSessions = new Map();
