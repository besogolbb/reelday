import fp from 'fastify-plugin';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

async function storagePlugin(fastify) {
  const s3 = new S3Client({
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  async function uploadFile(buffer, filename, contentType) {
    const key = `uploads/${Date.now()}-${filename}`;

    await s3.send(new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET_NAME,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    }));

    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }

  async function getFile(key, range) {
    return s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key:    key,
      ...(range ? { Range: range } : {}),
    }));
  }

  fastify.decorate('storage', s3);
  fastify.decorate('uploadFile', uploadFile);
  fastify.decorate('getFile', getFile);
}

export default fp(storagePlugin, { name: 'storage' });
