/** Lambda `api`: Hono, alle Routen unter /api (TK 3.1, 7). */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { handle } from 'hono/aws-lambda';
import { createApp } from '../app';
import { s3DownloadSigner } from '../files/download';
import { lambdaJobInvoker } from '../jobs/enqueue';
import { lambdaDatabase } from '../lib/database';
import { lazy } from '../lib/lazy';
import { requiredEnv, ssmString } from '../lib/params';
import type { ApiServices } from '../routes/services';

const services = lazy<ApiServices>(async () => {
  const db = await lambdaDatabase();
  const now = () => new Date();
  return {
    repositories: (ctx) => db.repositories(ctx),
    downloads: s3DownloadSigner(new S3Client({}), requiredEnv('DATA_BUCKET'), now),
    jobInvoker: lambdaJobInvoker(new LambdaClient({}), requiredEnv('WORKER_FUNCTION_NAME')),
    now,
  };
});

export const handler = handle(
  createApp({
    originVerifyValue: ssmString(requiredEnv('ORIGIN_VERIFY_PARAM')),
    buildId: process.env.BUILD_ID ?? 'unknown',
    // Sitzungsprüfung folgt mit AP-04a; bis dahin ist jede Anfrage anonym.
    services,
  }),
);
