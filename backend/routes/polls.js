/**
 * Live polls — host pre-creates a question in the dashboard, taps
 * "Run on wall" to set status='live', and the wall pauses photos to
 * show the question + a live tally. Auto-ends after duration_s, or
 * the host can stop early.
 *
 * Route taxonomy:
 *   Host (auth required, ownership-checked):
 *     POST   /api/events/:slug/polls            — create draft
 *     GET    /api/events/:slug/polls            — list this event's polls
 *     PATCH  /api/events/:slug/polls/:id        — edit draft
 *     DELETE /api/events/:slug/polls/:id        — delete draft / ended
 *     POST   /api/events/:slug/polls/:id/start  — go live
 *     POST   /api/events/:slug/polls/:id/stop   — stop now
 *
 *   Guest (public, plan-gated):
 *     GET    /api/events/:slug/polls/active     — wall + upload page poll
 *     POST   /api/events/:slug/polls/:id/vote
 */

import { resolvePlan } from '../lib/plans.js';
// Shared with the quiz-session routes so the wall reveal can scope its
// leaderboard to the current Run-all session (see the reveal block below).
import { quizSessions } from '../lib/quizSessions.js';

const MAX_OPTIONS    = 4;
const MIN_OPTIONS    = 2;
const MIN_DURATION_S = 10;
const MAX_DURATION_S = 120;

// Run-all final leaderboard reveal. The dashboard pings the trigger
// endpoint once a Run-all session finishes; the wall then sees a
// `leaderboard` payload on /polls/active and shows it (with fireworks)
// for the configured window. In-memory is fine — a process restart just
// means the host can re-trigger it from the dashboard.
const leaderboardRevealUntil = new Map(); // event_id → epoch ms
const LEADERBOARD_REVEAL_MS = 25_000;

export default async function pollRoutes(fastify) {
  const POLL_VOTE_LIMIT = {
    rateLimit: {
      max: 30,
      timeWindow: '1 minute',
      keyGenerator: fastify.limiterKey,
      errorResponseBuilder: () => fastify.friendlyRateLimit,
    },
  };

  /**
   * Resolve event by slug. If `requireOwner`, also assert request.user.id
   * owns the event AND that the event's per-event plan includes polls.
   * Returns { event, plan } or sends a 401/403/404 and returns null.
   */
  async function loadEvent(slug, request, reply, { requireOwner }) {
    const { rows } = await fastify.db.query(
      `SELECT e.id, e.is_active, e.user_id, e.plan, u.subscription_tier
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
    // Per-event tier: events.plan wins. subscription_tier is the legacy
    // fallback for rows created before per-event plans existed.
    const plan  = resolvePlan(event.plan || event.subscription_tier || 'tala');
    if (!plan.features?.polls) {
      reply.status(403).send({
        error: true,
        code: 'polls_locked',
        message: 'Live Questions & Poll need a Dalisay plan or higher.',
      });
      return null;
    }
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
    return { event, plan };
  }

  /**
   * Sanitise + validate the user-supplied poll body. Throws on bad input.
   * Returns the cleaned shape ready to insert/update.
   */
  function normalizePollInput(body) {
    const question = (body?.question || '').toString().trim();
    if (!question || question.length > 200) {
      throw { statusCode: 400, message: 'Question is required (1-200 chars)' };
    }
    const rawOptions = Array.isArray(body?.options) ? body.options : [];
    if (rawOptions.length < MIN_OPTIONS || rawOptions.length > MAX_OPTIONS) {
      throw { statusCode: 400, message: `Polls need ${MIN_OPTIONS}-${MAX_OPTIONS} options` };
    }
    const seenKeys = new Set();
    const options  = rawOptions.map((opt, idx) => {
      const key   = (opt?.key || `o${idx}`).toString().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || `o${idx}`;
      const label = (opt?.label || '').toString().trim().slice(0, 80);
      if (!label) throw { statusCode: 400, message: `Option ${idx + 1} needs a label` };
      if (seenKeys.has(key)) throw { statusCode: 400, message: 'Option keys must be unique' };
      seenKeys.add(key);
      return { key, label };
    });
    let duration = parseInt(body?.duration_s, 10);
    if (!Number.isFinite(duration)) duration = 30;
    duration = Math.max(MIN_DURATION_S, Math.min(MAX_DURATION_S, duration));

    // 'poll'     = opinion poll, no correct answer (legacy default)
    // 'question' = trivia, one option is correct (correct_key required)
    const rawKind = (body?.kind || 'poll').toString().toLowerCase();
    const kind = rawKind === 'question' ? 'question' : 'poll';

    let correctKey = (body?.correct_key || '').toString().trim();
    if (kind === 'question') {
      if (!correctKey) {
        throw { statusCode: 400, message: 'Pick the correct answer for a question' };
      }
      if (!seenKeys.has(correctKey)) {
        throw { statusCode: 400, message: 'correct_key must match one of the options' };
      }
    } else {
      // Force-null for opinion polls so a leftover correct_key from an
      // earlier edit doesn't accidentally leak onto the wall.
      correctKey = null;
    }

    return { question, options, duration_s: duration, kind, correct_key: correctKey };
  }

  /**
   * Auto-end any poll whose started_at + duration_s has elapsed but is
   * still flagged 'live'. Cheap UPDATE that the host endpoints + the
   * /active read both call so we don't need a cron.
   */
  async function autoEndExpired(eventId) {
    await fastify.db.query(
      `UPDATE polls
          SET status = 'ended', ended_at = NOW()
        WHERE event_id = $1
          AND status = 'live'
          AND started_at + (duration_s || ' seconds')::INTERVAL <= NOW()`,
      [eventId],
    );
  }

  // ── Host endpoints ───────────────────────────────────────

  fastify.post('/events/:slug/polls', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;
    let payload;
    try { payload = normalizePollInput(request.body); }
    catch (e) { return reply.status(e.statusCode || 400).send({ error: true, message: e.message }); }

    const { rows } = await fastify.db.query(
      `INSERT INTO polls (event_id, question, options, duration_s, kind, correct_key)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       RETURNING *`,
      [ctx.event.id, payload.question, JSON.stringify(payload.options), payload.duration_s, payload.kind, payload.correct_key],
    );
    return reply.status(201).send({ poll: rows[0] });
  });

  fastify.get('/events/:slug/polls', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;
    await autoEndExpired(ctx.event.id);

    const { rows } = await fastify.db.query(
      `SELECT p.*,
              COALESCE(v.tally, '[]'::jsonb) AS tally,
              COALESCE(v.total, 0)           AS total_votes
         FROM polls p
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('key', option_key, 'count', cnt) ORDER BY option_key) AS tally,
                  SUM(cnt)::int AS total
             FROM (
               SELECT option_key, COUNT(*)::int AS cnt
                 FROM poll_votes
                WHERE poll_id = p.id
                GROUP BY option_key
             ) sub
         ) v ON true
        WHERE p.event_id = $1
        ORDER BY p.created_at DESC`,
      [ctx.event.id],
    );
    return { polls: rows };
  });

  fastify.patch('/events/:slug/polls/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;
    const { id } = request.params;

    const { rows: existing } = await fastify.db.query(
      'SELECT id, status FROM polls WHERE id = $1 AND event_id = $2',
      [id, ctx.event.id],
    );
    if (!existing.length) return reply.status(404).send({ error: true, message: 'Poll not found' });
    if (existing[0].status !== 'draft') {
      return reply.status(409).send({ error: true, message: 'Only draft polls can be edited' });
    }

    let payload;
    try { payload = normalizePollInput(request.body); }
    catch (e) { return reply.status(e.statusCode || 400).send({ error: true, message: e.message }); }

    const { rows } = await fastify.db.query(
      `UPDATE polls
          SET question = $2, options = $3::jsonb, duration_s = $4,
              kind = $5, correct_key = $6
        WHERE id = $1
        RETURNING *`,
      [id, payload.question, JSON.stringify(payload.options), payload.duration_s, payload.kind, payload.correct_key],
    );
    return { poll: rows[0] };
  });

  fastify.delete('/events/:slug/polls/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;
    const { rowCount } = await fastify.db.query(
      `DELETE FROM polls
         WHERE id = $1 AND event_id = $2 AND status <> 'live'`,
      [request.params.id, ctx.event.id],
    );
    if (!rowCount) return reply.status(404).send({ error: true, message: 'Poll not found or live' });
    return { success: true };
  });

  fastify.post('/events/:slug/polls/:id/start', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;

    // Stop any other live polls on this event first — only one can be on the wall at a time.
    await fastify.db.query(
      `UPDATE polls SET status = 'ended', ended_at = NOW()
        WHERE event_id = $1 AND status = 'live' AND id <> $2`,
      [ctx.event.id, request.params.id],
    );

    // Archive the previous run's votes before we wipe poll_votes for a
    // clean live tally. This is what keeps the Leaderboard tab from
    // losing data on every "Run again" — historic response times and
    // correct/incorrect flags are preserved per run. INSERT ... SELECT
    // is a no-op when there are no rows (first start), so we don't
    // need to guard it. Only the explicit "Clear results" button
    // touches poll_vote_history; no other code path wipes it.
    await fastify.db.query(
      `INSERT INTO poll_vote_history
         (poll_id, event_id, guest_id, guest_name, option_key,
          was_correct, voted_at, run_started_at)
       SELECT pv.poll_id, p.event_id, pv.guest_id, pv.guest_name, pv.option_key,
              (p.correct_key IS NOT NULL AND pv.option_key = p.correct_key),
              pv.created_at, p.started_at
         FROM poll_votes pv
         JOIN polls p ON p.id = pv.poll_id
        WHERE pv.poll_id = $1
          AND p.started_at IS NOT NULL`,
      [request.params.id],
    );

    // Wipe live poll_votes for a fresh tally on the wall. The history
    // archive above means the leaderboard keeps the previous data.
    await fastify.db.query(
      'DELETE FROM poll_votes WHERE poll_id = $1',
      [request.params.id],
    );

    // Idempotent: a fresh started_at + status='live' regardless of the
    // current status. The previous WHERE filter on ('draft','ended') made
    // /start silently 404 if a stale 'live' status sat in the row (e.g. a
    // prior /start that didn't auto-end yet), which surfaced as the
    // "Run again button does nothing" bug.
    const { rows } = await fastify.db.query(
      `UPDATE polls
          SET status = 'live',
              started_at = NOW(),
              ended_at = NULL
        WHERE id = $1 AND event_id = $2
        RETURNING *`,
      [request.params.id, ctx.event.id],
    );
    if (!rows.length) return reply.status(404).send({ error: true, message: 'Poll not found' });
    return { poll: rows[0] };
  });

  // Cumulative trivia tally across every kind='question' poll on this
  // event. Powers the "Run all" leaderboard the host sees once a quiz
  // finishes — who got the most correct answers, ranked.
  fastify.get('/events/:slug/polls/leaderboard', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;

    // The dashboard leaderboard is now both:
    //   1. a per-question recap across all runs, and
    //   2. a historical run log for each "Run again".
    // We still compute the aggregate winner/correct counts per question,
    // but we also keep each run separate so the frontend can show a
    // timeline instead of collapsing reruns into one blended card.
    const MAX_CORRECT = 20;
    const { rows: pollRows } = await fastify.db.query(
      `SELECT id AS poll_id, question, options, correct_key, status, started_at
         FROM polls
        WHERE event_id    = $1
          AND kind        = 'question'
          AND correct_key IS NOT NULL
        ORDER BY created_at ASC`,
      [ctx.event.id],
    );
    const { rows: voteRows } = await fastify.db.query(
      `WITH all_votes AS (
         SELECT h.poll_id,
                h.guest_name,
                h.was_correct,
                ROUND(EXTRACT(EPOCH FROM (h.voted_at - h.run_started_at))::numeric, 1) AS resp_s,
                h.run_started_at
           FROM poll_vote_history h
          WHERE h.event_id        = $1
            AND h.guest_name      IS NOT NULL
            AND h.guest_name      <> ''
            AND h.run_started_at  IS NOT NULL
         UNION ALL
         SELECT pv.poll_id,
                pv.guest_name,
                (p.correct_key IS NOT NULL AND pv.option_key = p.correct_key) AS was_correct,
                ROUND(EXTRACT(EPOCH FROM (pv.created_at - p.started_at))::numeric, 1) AS resp_s,
                p.started_at AS run_started_at
           FROM poll_votes pv
           JOIN polls p ON p.id = pv.poll_id
          WHERE p.event_id       = $1
            AND p.kind           = 'question'
            AND p.correct_key    IS NOT NULL
            AND pv.guest_name    IS NOT NULL
            AND pv.guest_name    <> ''
            AND p.started_at     IS NOT NULL
       )
       SELECT poll_id, guest_name, was_correct, resp_s, run_started_at
         FROM all_votes
        ORDER BY poll_id, run_started_at, resp_s ASC NULLS LAST, guest_name ASC`,
      [ctx.event.id],
    );

    const votesByPoll = new Map();
    for (const row of voteRows) {
      const list = votesByPoll.get(row.poll_id) || [];
      list.push(row);
      votesByPoll.set(row.poll_id, list);
    }

    const questions = pollRows.map(poll => {
      const votes = votesByPoll.get(poll.poll_id) || [];
      const answeredGuests = new Set();
      const bestCorrectByGuest = new Map();
      const runsMap = new Map();

      for (const vote of votes) {
        const guest = String(vote.guest_name || '').trim();
        if (!guest) continue;
        answeredGuests.add(guest);

        const runKey = vote.run_started_at ? new Date(vote.run_started_at).toISOString() : null;
        if (runKey) {
          let run = runsMap.get(runKey);
          if (!run) {
            run = {
              run_started_at: runKey,
              answeredGuests: new Set(),
              bestCorrectByGuest: new Map(),
            };
            runsMap.set(runKey, run);
          }
          run.answeredGuests.add(guest);
          if (vote.was_correct) {
            const secs = Number(vote.resp_s);
            const prev = run.bestCorrectByGuest.get(guest);
            if (prev == null || secs < prev) run.bestCorrectByGuest.set(guest, secs);
          }
        }

        if (vote.was_correct) {
          const secs = Number(vote.resp_s);
          const prev = bestCorrectByGuest.get(guest);
          if (prev == null || secs < prev) bestCorrectByGuest.set(guest, secs);
        }
      }

      const rankedCorrect = [...bestCorrectByGuest.entries()]
        .map(([guest_name, response_seconds]) => ({ guest_name, response_seconds }))
        .sort((a, b) => a.response_seconds - b.response_seconds || a.guest_name.localeCompare(b.guest_name));

      const winner = rankedCorrect[0]
        ? {
            guest_name: rankedCorrect[0].guest_name,
            response_seconds: rankedCorrect[0].response_seconds,
          }
        : null;

      const correct_others = rankedCorrect
        .slice(1, MAX_CORRECT)
        .map((r, idx) => ({
          guest_name: r.guest_name,
          response_seconds: r.response_seconds,
          rank: idx + 2,
        }));

      const runs = [...runsMap.values()]
        .map(run => {
          const rankedRun = [...run.bestCorrectByGuest.entries()]
            .map(([guest_name, response_seconds]) => ({ guest_name, response_seconds }))
            .sort((a, b) => a.response_seconds - b.response_seconds || a.guest_name.localeCompare(b.guest_name));
          return {
            run_started_at: run.run_started_at,
            answered_count: run.answeredGuests.size,
            correct_count: rankedRun.length,
            winner: rankedRun[0]
              ? {
                  guest_name: rankedRun[0].guest_name,
                  response_seconds: rankedRun[0].response_seconds,
                }
              : null,
          };
        })
        .sort((a, b) => new Date(b.run_started_at) - new Date(a.run_started_at));

      return {
        poll_id: poll.poll_id,
        question: poll.question,
        options: poll.options,
        correct_key: poll.correct_key,
        status: poll.status,
        answered_count: answeredGuests.size,
        correct_count: rankedCorrect.length,
        winner,
        correct_others,
        runs,
      };
    });

    return {
      total_questions: questions.length,
      questions,
    };
  });

  // Trigger the final-leaderboard reveal on the wall. Dashboard calls
  // this once Run-all finishes; the wall (which doesn't know whether a
  // run is happening) only flips into leaderboard mode once the host
  // explicitly says so.
  fastify.post('/events/:slug/polls/leaderboard/show', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;
    leaderboardRevealUntil.set(ctx.event.id, Date.now() + LEADERBOARD_REVEAL_MS);
    return { ok: true, expires_at: leaderboardRevealUntil.get(ctx.event.id) };
  });

  fastify.post('/events/:slug/polls/leaderboard/hide', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;
    leaderboardRevealUntil.delete(ctx.event.id);
    return { ok: true };
  });

  // Wipe historical trivia results for this event — the ONLY code path
  // that touches poll_vote_history (the /start archive only writes).
  // Powers the dashboard's "Clear results" button on the Leaderboard
  // tab. Deliberately leaves votes on *live* polls alone (those tallies
  // are on the wall right now) and only touches kind='question' polls
  // — opinion polls have their own value the host may want to keep.
  fastify.delete('/events/:slug/polls/leaderboard', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;

    // 1) Wipe the archive of past runs (this is what the new leaderboard
    //    reads first — without this the "Clear" button would visibly do
    //    nothing for hosts who'd re-run the same questions multiple times).
    const { rowCount: clearedHistory } = await fastify.db.query(
      `DELETE FROM poll_vote_history
        WHERE event_id = $1
          AND poll_id IN (
            SELECT id FROM polls
             WHERE event_id = $1
               AND kind     = 'question'
          )`,
      [ctx.event.id],
    );

    // 2) Wipe the current run's votes for any ended trivia poll — the
    //    leaderboard UNIONs both stores, so this is the second half.
    const { rowCount: clearedCurrent } = await fastify.db.query(
      `DELETE FROM poll_votes
        WHERE poll_id IN (
          SELECT id FROM polls
           WHERE event_id = $1
             AND kind     = 'question'
             AND status  <> 'live'
        )`,
      [ctx.event.id],
    );
    return { ok: true, cleared: clearedHistory + clearedCurrent };
  });

  fastify.post('/events/:slug/polls/:id/stop', { preHandler: fastify.authenticate }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: true });
    if (!ctx) return;
    const { rows } = await fastify.db.query(
      `UPDATE polls
          SET status = 'ended', ended_at = NOW()
        WHERE id = $1 AND event_id = $2 AND status = 'live'
        RETURNING *`,
      [request.params.id, ctx.event.id],
    );
    if (!rows.length) return reply.status(404).send({ error: true, message: 'Poll not live' });
    return { poll: rows[0] };
  });

  // ── Guest endpoints ──────────────────────────────────────

  // Public read — wall + upload page hit this every 2s. Returns the
  // currently-live poll if any (with live tally) or null. Also auto-ends
  // expired polls so a host who forgot to stop one doesn't strand it.
  fastify.get('/events/:slug/polls/active', async (request, reply) => {
    const { rows: eventRows } = await fastify.db.query(
      `SELECT e.id, e.plan, u.subscription_tier
         FROM events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.slug = $1 AND e.is_active = true`,
      [request.params.slug],
    );
    if (!eventRows.length) return reply.status(404).send({ error: true, message: 'Event not found' });
    const eventId = eventRows[0].id;

    // Per-event tier (see loadEvent above).
    const plan = resolvePlan(eventRows[0].plan || eventRows[0].subscription_tier || 'tala');
    if (!plan.features?.polls) {
      reply.header('Cache-Control', 'no-store');
      return { poll: null };
    }

    await autoEndExpired(eventId);

    const { rows } = await fastify.db.query(
      `SELECT p.id, p.question, p.options, p.duration_s, p.status,
              p.kind, p.correct_key,
              p.started_at, p.ended_at,
              EXTRACT(EPOCH FROM (p.started_at + (p.duration_s || ' seconds')::INTERVAL - NOW()))::int AS seconds_left,
              COALESCE(v.tally, '[]'::jsonb) AS tally,
              COALESCE(v.total, 0)           AS total_votes,
              f.fastest_voter
         FROM polls p
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('key', option_key, 'count', cnt) ORDER BY option_key) AS tally,
                  SUM(cnt)::int AS total
             FROM (
               SELECT option_key, COUNT(*)::int AS cnt
                 FROM poll_votes
                WHERE poll_id = p.id
                GROUP BY option_key
             ) sub
         ) v ON true
         LEFT JOIN LATERAL (
           -- For trivia questions we want the fastest *correct* answer
           -- (the dramatic reveal on the wall), so filter the fastest
           -- subquery to votes matching the correct_key. For plain polls
           -- there's no right answer, so we just pick the first voter.
           SELECT jsonb_build_object(
                    'guest_name', pv.guest_name,
                    'option_key', pv.option_key,
                    'response_seconds',
                      ROUND(EXTRACT(EPOCH FROM (pv.created_at - p.started_at))::numeric, 1)
                  ) AS fastest_voter
             FROM poll_votes pv
            WHERE pv.poll_id = p.id
              AND pv.guest_name IS NOT NULL
              AND pv.guest_name <> ''
              AND (p.kind <> 'question' OR p.correct_key IS NULL OR pv.option_key = p.correct_key)
            ORDER BY pv.created_at ASC
            LIMIT 1
         ) f ON true
        WHERE p.event_id = $1
          AND (
                p.status = 'live'
             OR (p.status = 'ended' AND p.ended_at > NOW() - INTERVAL '30 seconds')
              )
        ORDER BY (p.status = 'live') DESC, p.started_at DESC
        LIMIT 1`,
      [eventId],
    );
    reply.header('Cache-Control', 'no-store');

    // Final-leaderboard reveal: the host triggered it from the dashboard
    // after a Run-all finished. Compute and embed it inline so the wall
    // doesn't need a second public endpoint.
    let leaderboardPayload = null;
    const reveal = leaderboardRevealUntil.get(eventId);
    if (reveal && reveal > Date.now()) {
      // Scope the tally to the current Run-all session so votes left in
      // poll_votes from an earlier SOLO question run (never wiped because
      // that question wasn't re-run this time) don't leak in as phantom
      // results. When no session is recorded (e.g. backend restarted), fall
      // back to the unscoped count rather than showing nothing.
      const sinceDb = quizSessions.get(eventId)?.started_at_db || null;
      const { rows: questionsRows } = await fastify.db.query(
        `SELECT COUNT(*)::int AS n
           FROM polls
          WHERE event_id = $1 AND kind = 'question' AND correct_key IS NOT NULL
            AND ($2::timestamptz IS NULL OR started_at >= $2::timestamptz)`,
        [eventId, sinceDb],
      );
      const totalQuestions = questionsRows[0]?.n || 0;
      const { rows: lbRows } = await fastify.db.query(
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
          LIMIT 10`,
        [eventId, sinceDb],
      );
      leaderboardPayload = {
        total_questions: totalQuestions,
        leaderboard: lbRows,
        expires_at: reveal,
      };
    } else if (reveal) {
      leaderboardRevealUntil.delete(eventId);
    }

    return { poll: rows[0] || null, leaderboard: leaderboardPayload };
  });

  fastify.post('/events/:slug/polls/:id/vote', { config: POLL_VOTE_LIMIT }, async (request, reply) => {
    const ctx = await loadEvent(request.params.slug, request, reply, { requireOwner: false });
    if (!ctx) return;

    const { id } = request.params;
    const optionKey = (request.body?.option_key || '').toString().slice(0, 40);
    const guestName = (request.body?.guest_name || '').toString().trim().slice(0, 120) || null;
    const guestId   = String(request.headers['x-guest-id'] || request.ip).slice(0, 64);

    if (!optionKey) {
      return reply.status(400).send({ error: true, message: 'option_key is required' });
    }

    // Ensure the poll exists, is on this event, is live, and the
    // option_key matches one of its declared options.
    await autoEndExpired(ctx.event.id);
    const { rows: pollRows } = await fastify.db.query(
      `SELECT id, options, status
         FROM polls
        WHERE id = $1 AND event_id = $2`,
      [id, ctx.event.id],
    );
    if (!pollRows.length) return reply.status(404).send({ error: true, message: 'Poll not found' });
    if (pollRows[0].status !== 'live') {
      return reply.status(409).send({ error: true, code: 'poll_not_live', message: 'Poll is not accepting votes' });
    }
    const validKeys = new Set((pollRows[0].options || []).map(o => o.key));
    if (!validKeys.has(optionKey)) {
      return reply.status(400).send({ error: true, message: 'Unknown option' });
    }

    // Upsert lets a guest change their mind while the poll is live.
    await fastify.db.query(
      `INSERT INTO poll_votes (poll_id, guest_id, option_key, guest_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (poll_id, guest_id)
         DO UPDATE SET option_key = EXCLUDED.option_key,
                       guest_name = COALESCE(EXCLUDED.guest_name, poll_votes.guest_name),
                       created_at = NOW()`,
      [id, guestId, optionKey, guestName],
    );
    return reply.status(201).send({ success: true });
  });
}
