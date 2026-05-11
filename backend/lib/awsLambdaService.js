import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClientConfig = { region: 'ap-southeast-2' };

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  lambdaClientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const lambdaClient = new LambdaClient(lambdaClientConfig);

export async function triggerVideoTranscode(filePath) {
  const payload = { fileName: filePath };

  await lambdaClient.send(new InvokeCommand({
    FunctionName: 'reelday-transcoder-v2',
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}
