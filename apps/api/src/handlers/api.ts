/** Lambda `api`: Hono, alle Routen unter /api (TK 3.1, 7). */
import { handle } from 'hono/aws-lambda';
import { createApp } from '../app';
import { requiredEnv, ssmString } from '../lib/params';

export const handler = handle(
  createApp({
    originVerifyValue: ssmString(requiredEnv('ORIGIN_VERIFY_PARAM')),
    buildId: process.env.BUILD_ID ?? 'unknown',
  }),
);
