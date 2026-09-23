/** `GET /api/web/v1/jobs/{id}` (TK 7.4): Status, Fortschritt, Ergebnis vorhanden. */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { parseJobError, type Job } from '@nina-pm/db';
import { can, JobView, ProblemError, Uuid, type JobKind } from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function toJobView(job: Job): JobView {
  return {
    id: job.id,
    kind: job.kind as JobKind,
    status: job.status,
    attempts: job.attempts,
    errorCode: parseJobError(job.error)?.code ?? null,
    createdAt: iso(job.createdAt) ?? '',
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    hasResult: job.status === 'done' && job.resultS3Key !== null,
  };
}

export const getJobRoute = defineRoute(
  { action: 'job.read', requirements: ['TK 7.4', 'FA-SIM-04', 'FA-FRG-05'] },
  {
    method: 'get',
    path: '/api/web/v1/jobs/{id}',
    summary: 'Job-Status abfragen',
    tags: ['jobs'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: { description: 'Job', content: { 'application/json': { schema: JobView } } },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('job.not_found'),
    },
  },
);

/** Lädt einen Job des Sitzungsmandanten und prüft `can` mit dem Objekt (Ersteller). */
export async function loadReadableJob(
  services: ApiServices,
  c: Parameters<typeof requireTenant>[0],
  id: string,
): Promise<Job> {
  const { auth, tenant } = requireTenant(c);
  const job = await services.repositories(tenant).job.byId(id);
  if (!job) throw new ProblemError('job.not_found');
  if (!can(auth, 'job.read', { tenantId: job.tenantId ?? undefined, createdBy: job.createdBy })) {
    throw new ProblemError('permission.denied');
  }
  return job;
}

export function webJobRoutes(services: () => Promise<ApiServices>) {
  return new OpenAPIHono<ApiEnv>().openapi(getJobRoute, async (c) => {
    const job = await loadReadableJob(await services(), c, c.req.valid('param').id);
    c.header('cache-control', 'no-store');
    return c.json(toJobView(job), 200);
  });
}
