import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID, createHash } from 'crypto';

const region = process.env.AWS_REGION || 'ap-southeast-1';
const sqsQueueUrl = process.env.TRANSCODE_SQS_URL || '';
const lambdaFunctionName = process.env.TRANSCODE_LAMBDA_NAME || 'reelday-transcoder-v3-singapore';

const awsCreds = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
  : undefined;

const lambdaClient = new LambdaClient({ region, ...(awsCreds && { credentials: awsCreds }) });
const sqsClient = sqsQueueUrl ? new SQSClient({ region, ...(awsCreds && { credentials: awsCreds }) }) : null;

// Derive a stable group id when caller didn't pass one. Files are typically stored under
// an event-prefixed key, so the parent folder is a reasonable per-event grouping.
function deriveGroupId(filePath, explicitEventId) {
  if (explicitEventId) return String(explicitEventId);
  const parts = String(filePath || '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : 'default';
}

export async function triggerVideoTranscode(filePath, options = {}) {
  const payload = {
    originalKey: filePath,
    fileName: filePath,
    preThumbDataUrl: options.preThumbDataUrl || null,
  };

  // Preferred path: enqueue to SQS FIFO. Lambda is wired to the queue as event source,
  // giving us per-event ordering, backpressure, and retries with a DLQ.
  if (sqsClient && sqsQueueUrl) {
    const groupId = deriveGroupId(filePath, options.eventId);
    // Dedup id is content-derived so accidental double-enqueue within 5 minutes is collapsed.
    const dedupId = createHash('sha256').update(filePath).digest('hex').slice(0, 64);
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: sqsQueueUrl,
      MessageBody: JSON.stringify(payload),
      MessageGroupId: groupId,
      MessageDeduplicationId: dedupId,
    }));
    return;
  }

  // Fallback: direct async Lambda invoke (legacy path — used until SQS is provisioned).
  await lambdaClient.send(new InvokeCommand({
    FunctionName: lambdaFunctionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}
