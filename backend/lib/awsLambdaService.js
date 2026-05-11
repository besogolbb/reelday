import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// 1. Explicitly pass credentials or ensure they are in your Hostinger .env
const lambdaClient = new LambdaClient({ 
    region: 'ap-southeast-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

export async function triggerVideoTranscode(filePath) {
  const payload = { fileName: filePath };

  try {
    // 2. We use await to ensure the "ping" was sent, 
    // but wrapped in a try/catch so it doesn't break the main site.
    await lambdaClient.send(new InvokeCommand({
      FunctionName: 'reelday-transcoder-v2',
      InvocationType: 'Event', // This ensures it stays asynchronous
      Payload: Buffer.from(JSON.stringify(payload)),
    }));
    
    console.log("✅ Lambda trigger sent for:", filePath);
  } catch (error) {
    // This is the "Surgical" part: if AWS fails, we just log it.
    // The guest still gets their "Upload Success" from your VPS.
    console.error("❌ AWS Lambda Trigger Failed:", error.message);
  }
}