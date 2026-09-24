/** Lambda `api`: Hono, alle Routen unter /api (TK 3.1, 7). */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { handle } from 'hono/aws-lambda';
import { createApp } from '../app';
import { parseIdList, PROD_REDIRECT_URI } from '../auth/config';
import { httpDiscordClient } from '../auth/discord';
import { s3DownloadSigner } from '../files/download';
import { lambdaJobInvoker } from '../jobs/enqueue';
import { lambdaDatabase } from '../lib/database';
import { lazy } from '../lib/lazy';
import { requiredEnv, ssmSecret, ssmString } from '../lib/params';
import type { ApiServices } from '../routes/services';

const bootstrapSuperUsers = ssmString(requiredEnv('BOOTSTRAP_SUPER_USERS_PARAM'));

const services = lazy<ApiServices>(async () => {
  const db = await lambdaDatabase();
  const now = () => new Date();
  return {
    repositories: (ctx) => db.repositories(ctx),
    tenantAdmin: (actor) => db.tenantAdmin(actor),
    auth: db.auth(),
    authConfig: {
      cookieSecret: ssmSecret(requiredEnv('COOKIE_SECRET_PARAM')),
      discordClientId: ssmString(requiredEnv('DISCORD_CLIENT_ID_PARAM')),
      discordClientSecret: ssmSecret(requiredEnv('DISCORD_CLIENT_SECRET_PARAM')),
      bootstrapSuperUsers: async () => parseIdList(await bootstrapSuperUsers()),
      redirectUri: PROD_REDIRECT_URI,
    },
    discord: httpDiscordClient(),
    downloads: s3DownloadSigner(new S3Client({}), requiredEnv('DATA_BUCKET'), now),
    jobInvoker: lambdaJobInvoker(new LambdaClient({}), requiredEnv('WORKER_FUNCTION_NAME')),
    now,
  };
});

// Kein Test-Login im Lambda-Bundle: die Route gibt es nur in src/local.ts (TK 17, security-auth.md).
export const handler = handle(
  createApp({
    originVerifyValue: ssmString(requiredEnv('ORIGIN_VERIFY_PARAM')),
    buildId: process.env.BUILD_ID ?? 'unknown',
    services,
  }),
);
