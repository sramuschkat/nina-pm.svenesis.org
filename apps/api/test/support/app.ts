import type { AuthContext } from '@nina-pm/shared';
import { createApp } from '../../src/app';
import type { ApiServices } from '../../src/routes/services';
import { MemoryJobs } from './memory-jobs';

export const SECRET = 'a'.repeat(43);
export const viaCloudFront = { 'x-origin-verify': SECRET };
export const NOW = new Date('2026-09-23T12:00:00Z');

export function testApp(auth: AuthContext | null, jobs = new MemoryJobs(() => NOW)) {
  const services: ApiServices = {
    repositories: (ctx) => ({ job: jobs.forTenant(ctx.tenantId) }),
    downloads: {
      presignGet: (key) =>
        Promise.resolve({
          url: `https://svenesis-nina-pm-data.s3.eu-central-1.amazonaws.com/${key}?X-Amz-Signature=x`,
          expiresAt: '2026-09-23T12:15:00Z',
        }),
    },
    jobInvoker: { invoke: () => Promise.resolve() },
    now: () => NOW,
  };
  const app = createApp({
    originVerifyValue: () => Promise.resolve(SECRET),
    buildId: 'b1',
    resolveAuth: () => Promise.resolve(auth),
    services: () => Promise.resolve(services),
  });
  return { app, jobs };
}
