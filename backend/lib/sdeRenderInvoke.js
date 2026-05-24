/**
 * Dispatch an SDE render to the renderer configured by SDE_RENDERER:
 *   - 'lambda' → Remotion Lambda (fast, fan-out, ~3-5 min, ~$0.30/render)
 *   - 'ecs'    → ECS Fargate task (single big box, ~15-20 min, ~$0.20/render)
 *   - unset    → 'ecs' (safe default — pre-Lambda behavior)
 *
 * Lambda path: returns { renderId, bucketName } so the poller can track it.
 * ECS path: returns nothing — the container fires its own webhook on done.
 *
 * Both paths receive the same payload shape (from kickOffRender).
 */

import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { triggerLambdaRender } from './sdeRenderInvokeLambda.js';

const region = process.env.AWS_REGION || 'ap-southeast-1';
const creds = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
  : undefined;

const ecs = new ECSClient({ region, ...(creds && { credentials: creds }) });
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function triggerEcsRender(payload) {
  const payloadKey = `sde/${payload.eventId}/payload-${Date.now()}.json`;
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: payloadKey,
    Body: JSON.stringify(payload),
    ContentType: 'application/json',
  }));

  await ecs.send(new RunTaskCommand({
    cluster: process.env.SDE_ECS_CLUSTER,
    taskDefinition: process.env.SDE_TASK_DEF,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env.SDE_ECS_SUBNETS.split(','),
        securityGroups: [process.env.SDE_ECS_SECURITY_GROUP],
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [{
        name: 'sde-renderer',
        environment: [{ name: 'SDE_PAYLOAD_KEY', value: payloadKey }],
      }],
    },
  }));
  return null; // ECS posts its own webhook
}

export async function triggerSdeRender(payload) {
  const renderer = (process.env.SDE_RENDERER || 'ecs').toLowerCase();
  if (renderer === 'lambda') {
    return triggerLambdaRender(payload);
  }
  return triggerEcsRender(payload);
}
