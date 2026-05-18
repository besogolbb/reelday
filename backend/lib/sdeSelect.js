/**
 * The SDE "Curator" — decides which uploads go into the Same Day Edit.
 *
 * CRITICAL (see docs/same-day-edit-plan.md §3): this runs ONLY at
 * request-time — when the host opens the SDE card or clicks Generate —
 * NEVER on the live wall path. The reaction tally is the one heavy
 * query; it is wrapped in a transaction-scoped statement_timeout so a
 * pathological event can't pin a pooled connection, and the
 * generate-route debounce means it fires at most once per render.
 *
 * Reaction score is a SOFT signal: the spine of the reel is the host's
 * pin/exclude choices + chronological order. Reactions only re-rank the
 * un-pinned middle, and a recency fallback guarantees a full reel even
 * with zero reactions.
 */

export const SELECT_DEFAULTS = {
  // Target a ~4-minute reel. maxTotalSec (240 s) is the real governor;
  // maxClips is set high enough that the duration cap binds first even
  // for a photo-only event (240 / 3 s = 80) — otherwise the count would
  // cap the reel at ~2 min before it ever reaches 4. A video-heavy
  // event tops out at ~48 clips (240 / 5 s) and still hits 4 min.
  maxClips:    80,   // ceiling on bricks; duration cap usually binds first
  minClips:    12,   // floor — below this, top up with most-recent uploads
  photoSec:    3,    // Ken Burns still
  videoSec:    5,    // trimmed guest clip
  maxTotalSec: 240,  // 4 min — hard length ceiling for the reel
};

// Weighted reaction score. Buckets mirror the wall's allowed emoji
// (backend/routes/reactions.js ALLOWED_EMOJI): love/fire highest,
// celebration mid, the rest 1. Aggregated in SQL so it's one pass.
const TALLY_SQL = `
  SELECT u.id,
         u.file_type,
         u.file_url,
         u.web_url,
         u.poster_url,
         u.thumbnail_url,
         u.pre_thumb_url,
         u.original_key,
         u.compressed_key,
         u.uploader_name,
         u.created_at,
         u.sde_pinned,
         u.sde_excluded,
         COALESCE(r.score, 0)::int AS score,
         COALESCE(r.cnt,   0)::int AS reaction_count
    FROM uploads u
    LEFT JOIN (
      SELECT upload_id,
             SUM(CASE
                   WHEN emoji IN ('❤️','🔥','💖','🥰')      THEN 3
                   WHEN emoji IN ('😂','👏','🎉','✨','🥹') THEN 2
                   ELSE 1
                 END) AS score,
             COUNT(*)  AS cnt
        FROM reactions
       WHERE event_id = $1 AND upload_id IS NOT NULL
       GROUP BY upload_id
    ) r ON r.upload_id = u.id
   WHERE u.event_id = $1
     AND u.is_approved = true
     AND u.file_type IN ('photo', 'video')
   ORDER BY u.created_at ASC
`;

/**
 * Run the reaction tally for one event. Owner-only, request-time only.
 * Transaction-scoped statement_timeout: SET LOCAL auto-reverts on
 * COMMIT/ROLLBACK so the tighter limit can never leak onto another
 * query that reuses this pooled connection.
 *
 * Returns every approved photo/video row (incl. excluded ones, so the
 * dashboard can render them as toggled-off) with its score.
 */
export async function fetchCandidates(fastify, eventId, { timeoutMs = 8000 } = {}) {
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);
    const { rows } = await client.query(TALLY_SQL, [eventId]);
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already bad */ }
    throw err;
  } finally {
    client.release();
  }
}

function clipSeconds(row, opts) {
  return row.file_type === 'video' ? opts.videoSec : opts.photoSec;
}

/**
 * Pure selection algorithm — no DB. Deterministic given the same rows.
 *
 *   1. pinned rows always included (the host's hard picks)
 *   2. fill the rest by score desc, then recency, within the clip +
 *      duration budget
 *   3. if still under minClips, top up with the most-recent remaining
 *      uploads (the soft-signal fallback — guarantees a full reel)
 *   4. final reel order = chronological (ceremony → reception)
 *
 * Returns { selectedIds:Set, ordered:[rows], totalSec }.
 */
export function curate(rows, options = {}) {
  const opts = { ...SELECT_DEFAULTS, ...options };
  const candidates = rows.filter(r => !r.sde_excluded);

  const byRecencyDesc = (a, b) => new Date(b.created_at) - new Date(a.created_at);

  const pinned = candidates
    .filter(r => r.sde_pinned)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const pool = candidates
    .filter(r => !r.sde_pinned)
    .sort((a, b) => (b.score - a.score) || byRecencyDesc(a, b));

  const selected = [];
  const chosen = new Set();
  let totalSec = 0;

  const tryAdd = (row) => {
    if (chosen.has(row.id)) return false;
    if (selected.length >= opts.maxClips) return false;
    const sec = clipSeconds(row, opts);
    if (totalSec + sec > opts.maxTotalSec && selected.length > 0) return false;
    selected.push(row);
    chosen.add(row.id);
    totalSec += sec;
    return true;
  };

  // 1 + 2: pinned first, then the score-ranked pool.
  for (const row of pinned) tryAdd(row);
  for (const row of pool)   tryAdd(row);

  // 3: recency top-up if the reel is too thin.
  if (selected.length < opts.minClips) {
    const remaining = candidates
      .filter(r => !chosen.has(r.id))
      .sort(byRecencyDesc);
    for (const row of remaining) {
      if (selected.length >= opts.minClips) break;
      tryAdd(row);
    }
  }

  // 4: present the chosen set in chronological order.
  const ordered = selected
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return { selectedIds: chosen, ordered, totalSec };
}

/**
 * Fetch + curate in one call. Returns the raw candidate rows (for the
 * dashboard grid) alongside the selection result + a summary.
 */
export async function runCurator(fastify, eventId, options = {}) {
  const rows = await fetchCandidates(fastify, eventId, options);
  const { selectedIds, ordered, totalSec } = curate(rows, options);
  const opts = { ...SELECT_DEFAULTS, ...options };
  return {
    rows,
    selectedIds,
    ordered,
    summary: {
      approvedCount: rows.length,
      excludedCount: rows.filter(r => r.sde_excluded).length,
      pinnedCount:   rows.filter(r => r.sde_pinned && !r.sde_excluded).length,
      selectedCount: ordered.length,
      totalSec,
      minClips: opts.minClips,
      maxClips: opts.maxClips,
      maxTotalSec: opts.maxTotalSec,
    },
  };
}
