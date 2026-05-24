/**
 * Background poller for in-flight Remotion Lambda renders.
 *
 * Remotion Lambda doesn't fire webhooks when done — you poll
 * getRenderProgress() until it reports done or failed. This job runs
 * every 10s, finds event_sde rows with status='queued' AND a
 * config.lambda.renderId, and either:
 *   - marks the row 'ready' with video_url + duration + clip_count when done
 *   - marks 'error' with the error message when failed
 *
 * Mirrors the SQL the /webhooks/sde-ready handler does for the ECS path,
 * so frontend behavior is identical regardless of which renderer ran.
 *
 * Times out a render after 20 min (Lambda's own timeout is 15 min × N
 * chunks, but we cap at 20 from kickoff to detect zombie tracking rows).
 */

import { getRenderProgress } from '@remotion/lambda-client';

const POLL_INTERVAL_MS = 30_000;
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;
const REGION = process.env.REMOTION_LAMBDA_REGION || 'ap-southeast-1';

export function startSdeLambdaPoller(fastify) {
  const functionName = process.env.REMOTION_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    fastify.log.info('[sde-lambda-poller] REMOTION_LAMBDA_FUNCTION_NAME not set, skipping');
    return null;
  }

  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const { rows } = await fastify.db.query(
        `SELECT event_id, config, created_at, updated_at
           FROM event_sde
          WHERE status = 'queued'
            AND config ? 'lambda'`,
      );

      for (const row of rows) {
        const tracking = row.config?.lambda;
        if (!tracking?.renderId || !tracking?.bucketName) continue;

        const startedAt = tracking.startedAt ? new Date(tracking.startedAt) : new Date(row.updated_at);
        if (Date.now() - startedAt.getTime() > RENDER_TIMEOUT_MS) {
          fastify.log.warn(`[sde-lambda-poller] render ${tracking.renderId} for event ${row.event_id} exceeded ${RENDER_TIMEOUT_MS / 60000}min — marking error`);
          await fastify.db.query(
            `UPDATE event_sde SET status='error', error_message=$2, updated_at=NOW() WHERE event_id=$1`,
            [row.event_id, `Render timed out after ${RENDER_TIMEOUT_MS / 60000} minutes`],
          );
          continue;
        }

        let progress;
        try {
          progress = await getRenderProgress({
            renderId: tracking.renderId,
            bucketName: tracking.bucketName,
            functionName,
            region: REGION,
          });
        } catch (err) {
          fastify.log.warn(`[sde-lambda-poller] getRenderProgress failed for ${tracking.renderId}: ${err.message}`);
          continue;
        }

        if (progress.fatalErrorEncountered) {
          const msg = progress.errors?.[0]?.message || 'Lambda render failed (no error message)';
          fastify.log.error(`[sde-lambda-poller] render ${tracking.renderId} fatal: ${msg}`);
          await fastify.db.query(
            `UPDATE event_sde SET status='error', error_message=$2, updated_at=NOW() WHERE event_id=$1`,
            [row.event_id, msg.slice(0, 1000)],
          );
          continue;
        }

        if (progress.done && progress.outputFile) {
          // Lambda dumps to its own S3 bucket; we copy/proxy via the
          // public URL it returns. The frontend's dashboard reads
          // video_url + poster_url straight from event_sde, so we can
          // just store the Lambda S3 URL directly.
          const videoUrl  = progress.outputFile;
          const posterUrl = videoUrl.replace(/\.mp4$/, '.jpeg'); // Lambda generates a poster
          const durationS = progress.renderMetadata?.estimatedRenderLambdaInvokations
            ? Math.round(progress.estimatedTotalSeconds || 0)
            : null;

          await fastify.db.query(
            `UPDATE event_sde
                SET status='ready',
                    video_url=$2,
                    poster_url=$3,
                    duration_s=COALESCE($4, duration_s),
                    error_message=NULL,
                    rendered_at=NOW(),
                    updated_at=NOW()
              WHERE event_id=$1`,
            [row.event_id, videoUrl, posterUrl, durationS],
          );
          fastify.log.info(`[sde-lambda-poller] render ${tracking.renderId} ready: ${videoUrl}`);
          continue;
        }

        // Still in progress — log every ~20% boundary.
        const pct = Math.round((progress.overallProgress || 0) * 100);
        if (pct > 0 && pct % 20 === 0) {
          fastify.log.info(`[sde-lambda-poller] render ${tracking.renderId} at ${pct}%`);
        }
      }
    } catch (err) {
      fastify.log.error({ err }, '[sde-lambda-poller] tick failed');
    }
  }

  const interval = setInterval(tick, POLL_INTERVAL_MS);
  // Run one tick immediately so first render gets checked promptly.
  tick();

  fastify.log.info(`[sde-lambda-poller] started, polling every ${POLL_INTERVAL_MS / 1000}s`);
  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}
