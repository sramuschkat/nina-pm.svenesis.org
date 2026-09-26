/** Lambda `api`: Hono, alle Routen unter /api (TK 3.1, 7). */
import { randomUUID } from 'node:crypto';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { handle } from 'hono/aws-lambda';
import { createApp } from '../app';
import { parseIdList, PROD_REDIRECT_URI } from '../auth/config';
import { httpDiscordClient } from '../auth/discord';
import { s3DownloadSigner } from '../files/download';
import { s3JobResultStore } from '../files/job-results';
import { s3TenantFileStore } from '../files/tenant-files';
import { createUploadTicket } from '../files/upload-ticket';
import { lambdaJobInvoker } from '../jobs/enqueue';
import { lambdaDatabase } from '../lib/database';
import { emitDsqlRetries } from '../lib/metrics';
import { lazy } from '../lib/lazy';
import { requiredEnv, ssmSecret, ssmString } from '../lib/params';
import { ninaTokenLookup, ninaTouch, readMaintenanceBanner } from '@nina-pm/db';
import type { ApiServices } from '../routes/services';
import { UPLOAD_LIMITS } from '@nina-pm/shared';

// Metrik `DsqlRetries` (TK 16.2) aus jeder OCC-Wiederholung.
emitDsqlRetries(process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'nina-pm-api');

const bootstrapSuperUsers = ssmString(requiredEnv('BOOTSTRAP_SUPER_USERS_PARAM'));

const cookieSecret = ssmSecret(requiredEnv('COOKIE_SECRET_PARAM'));

const services = lazy<ApiServices>(async () => {
  const db = await lambdaDatabase();
  const now = () => new Date();
  const s3 = new S3Client({});
  return {
    repositories: (ctx) => {
      const repos = db.repositories(ctx);
      return { ...repos, tenant: () => repos.tenant };
    },
    tenantAdmin: (actor) => db.tenantAdmin(actor),
    db: db.db,
    uploads: {
      // Planprotokoll als presigned POST mit content-length-range (SEC-23, TK 12).
      planLog: async (tenantId, sessionId) => {
        const t = await createUploadTicket(
          {
            s3,
            bucket: requiredEnv('DATA_BUCKET'),
            secret: cookieSecret,
            now,
            uuid: () => randomUUID(),
          },
          'plan_log',
          tenantId,
          sessionId,
          UPLOAD_LIMITS.plan_log.sizeMax,
          UPLOAD_LIMITS.plan_log.contentTypes,
        );
        return { url: t.url, fields: t.fields };
      },
    },
    nina: {
      lookup: (hash) => ninaTokenLookup(db.db, hash),
      touch: (p, at) => ninaTouch(db.db, p, at),
    },
    auth: db.auth(),
    authConfig: {
      cookieSecret,
      discordClientId: ssmString(requiredEnv('DISCORD_CLIENT_ID_PARAM')),
      discordClientSecret: ssmSecret(requiredEnv('DISCORD_CLIENT_SECRET_PARAM')),
      bootstrapSuperUsers: async () => parseIdList(await bootstrapSuperUsers()),
      redirectUri: PROD_REDIRECT_URI,
    },
    discord: httpDiscordClient(),
    downloads: s3DownloadSigner(s3, requiredEnv('DATA_BUCKET'), now),
    tenantFiles: s3TenantFileStore(s3, requiredEnv('DATA_BUCKET')),
    jobResults: s3JobResultStore(s3, requiredEnv('DATA_BUCKET')),
    maintenanceBanner: () => readMaintenanceBanner(db.db),
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
