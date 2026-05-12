import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClientConfig = { region: 'ap-southeast-1' };

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  lambdaClientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const lambdaClient = new LambdaClient(lambdaClientConfig);

export async function triggerVideoTranscode(filePath, options = {}) {
  const payload = {
    originalKey: filePath,
    fileName: filePath,
    preThumbDataUrl: options.preThumbDataUrl || null,
  };

  await lambdaClient.send(new InvokeCommand({
    FunctionName: 'reelday-transcoder-v3-singapore',
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}
