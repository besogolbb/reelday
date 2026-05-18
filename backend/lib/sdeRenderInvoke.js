/**
 * Async-invoke the SDE renderer Lambda (`reelday-sde-renderer`).
 *
 * Sibling of awsLambdaService.js (the per-upload transcoder invoker),
 * deliberately kept as its own tiny module so the SDE path has zero
 * coupling to the transcode/SQS pipeline. No queue here: the SDE fires
 * at most once per host click, debounced upstream by the route, so
 * direct Lambda `InvocationType: 'Event'` is the right shape.
 *
 * Env:
 *   AWS_REGION           — defaults to ap-southeast-1 (matches transcoder)
 *   AWS_ACCESS_KEY_ID    — optional; falls back to the Lambda exec role
 *   AWS_SECRET_ACCESS_KEY
 *   SDE_LAMBDA_NAME      — defaults to 'reelday-sde-renderer'
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const region = process.env.AWS_REGION || 'ap-southeast-1';
const functionName = process.env.SDE_LAMBDA_NAME || 'reelday-sde-renderer';

const creds = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
  : undefined;

const lambda = new LambdaClient({ region, ...(creds && { credentials: creds }) });

export async function triggerSdeRender(payload) {
  await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}
