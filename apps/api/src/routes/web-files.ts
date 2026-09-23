/**
 * `GET /api/web/v1/files/download-url?purpose=…&id=…` (TK 12, SEC-57): der Schlüssel entsteht
 * serverseitig aus Zweck und Objekt-ID; **feste Aktion je Zweck**. Kein Schlüssel vom Client.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  can,
  DownloadUrl,
  DownloadUrlQuery,
  ProblemError,
  type Action,
  type DownloadPurpose,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';
import { loadReadableJob } from './web-jobs';

/** Feste Aktion je Zweck (TK 12). */
export const DOWNLOAD_PURPOSE_ACTIONS: Readonly<Record<DownloadPurpose, Action>> = {
  job_result: 'job.read',
  export: 'tenant.export',
};

export const downloadUrlRoute = defineRoute(
  // Route-Aktion = die schwächste Zweck-Aktion; der Handler prüft die Aktion des Zwecks.
  { action: 'job.read', requirements: ['TK 12', 'SEC-57', 'FA-ADM-04'] },
  {
    method: 'get',
    path: '/api/web/v1/files/download-url',
    summary: 'Download-Link (presigned GET, 15 min) über Zweck und Objekt-ID',
    tags: ['files'],
    request: { query: DownloadUrlQuery },
    responses: {
      200: { description: 'Link', content: { 'application/json': { schema: DownloadUrl } } },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('Objekt nicht gefunden'),
    },
  },
);

export function webFileRoutes(services: () => Promise<ApiServices>) {
  return new OpenAPIHono<ApiEnv>().openapi(downloadUrlRoute, async (c) => {
    const { purpose, id } = c.req.valid('query');
    const { auth } = requireTenant(c);
    if (!can(auth, DOWNLOAD_PURPOSE_ACTIONS[purpose])) throw new ProblemError('permission.denied');
    const svc = await services();
    const job = await loadReadableJob(svc, c, id);
    const kindMatches = purpose === 'export' ? job.kind === 'export' : job.kind !== 'export';
    if (!kindMatches || job.status !== 'done' || !job.resultS3Key)
      throw new ProblemError('resource.not_found');
    c.header('cache-control', 'no-store');
    return c.json(await svc.downloads.presignGet(job.resultS3Key), 200);
  });
}
