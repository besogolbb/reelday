/**
 * Trigger the SDE renderer as an ECS Fargate task.
 *
 * Replaces the Lambda InvokeCommand path. Payload is staged to R2 first
 * (ECS env var overrides have a ~4 KB limit; clip lists can exceed that).
 * The Fargate container reads SDE_PAYLOAD_KEY from its env, fetches the
 * JSON from R2, renders, then POSTs the sde-ready webhook — same contract
 * as before, no other backend changes required.
 *
 * New env vars required:
 *   SDE_ECS_CLUSTER        — ECS cluster name (e.g. 'reelday-cluster')
 *   SDE_TASK_DEF           — task definition name (e.g. 'reelday-sde-renderer')
 *   SDE_ECS_SUBNETS        — comma-separated subnet IDs
 *   SDE_ECS_SECURITY_GROUP — security group ID
 *   AWS_REGION             — defaults to ap-southeast-1
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — optional (IAM role preferred)
 *   R2_*                   — reuse existing R2 env vars for payload staging
 */

import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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

export async function triggerSdeRender(payload) {
  // Stage payload JSON to R2 — avoids ECS env var size limit
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
}
