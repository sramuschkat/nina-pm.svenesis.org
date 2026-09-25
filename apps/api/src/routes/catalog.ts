/**
 * Objektkatalog (AP-20; FA-FRM-01, FA-FRM-15, S-21, S-82):
 * - `GET /web/v1/dso` (`catalog.read`): Suche und Filter im Speicher (Katalog ≤ 10 min alt).
 * - `GET /system/v1/catalogs` (`system.manage`): Stand – Version, Quellzeilen, Zeilen, letzter Job.
 * - `POST /system/v1/catalogs/dso/refresh` (`system.manage`): Job `catalog_refresh` → `202 {jobId}`.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { dsoCatalogStatus, enqueueSystemJob, readDsoCatalog } from '@nina-pm/db';
import meta from '@nina-pm/catalog-data/openngc/catalog-meta.json' with { type: 'json' };
import { CatalogStatus, DsoList, DsoQuery, JobAccepted, ProblemError } from '@nina-pm/shared';
import { cachedCatalog, searchDso } from '../catalog/search';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});
const denied = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
};

export const dsoSearchRoute = defineRoute(
  { action: 'catalog.read', requirements: ['FA-FRM-01', 'FA-FRM-15', 'S-21'] },
  {
    method: 'get',
    path: '/api/web/v1/dso',
    summary: 'Objektkatalog durchsuchen und filtern',
    tags: ['catalog'],
    request: { query: DsoQuery },
    responses: { 200: { description: 'Treffer', ...json(DsoList) }, ...denied },
  },
);

export const catalogStatusRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-FRM-01', 'S-82'] },
  {
    method: 'get',
    path: '/api/system/v1/catalogs',
    summary: 'Stand der Kataloge (Objektkatalog aus OpenNGC)',
    tags: ['system'],
    responses: { 200: { description: 'Stand', ...json(CatalogStatus) }, ...denied },
  },
);

export const catalogRefreshRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-FRM-01', 'S-82', 'TK 13'] },
  {
    method: 'post',
    path: '/api/system/v1/catalogs/dso/refresh',
    summary: 'Objektkatalog neu importieren (Job catalog_refresh)',
    tags: ['system'],
    responses: { 202: { description: 'Job angelegt', ...json(JobAccepted) }, ...denied },
  },
);

export const CATALOG_ROUTES = [dsoSearchRoute, catalogStatusRoute, catalogRefreshRoute] as const;

interface Meta {
  version: string;
  fetchedAt: string;
  counts: { ngcCsv: number; addendumCsv: number; rows: number; sharpless: number };
  warnings: number;
}
const catalogMeta = meta as Meta;

export function catalogRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(dsoSearchRoute, async (c) => {
    const svc = await services();
    const index = await cachedCatalog(() => readDsoCatalog(svc.db), svc.now().getTime());
    c.header('cache-control', 'private, max-age=60');
    return c.json(searchDso(index, c.req.valid('query')), 200);
  });

  app.openapi(catalogStatusRoute, async (c) => {
    const svc = await services();
    const s = await dsoCatalogStatus(svc.db);
    c.header('cache-control', 'no-store');
    return c.json(
      {
        dso: {
          version: catalogMeta.version,
          fetchedAt: catalogMeta.fetchedAt,
          ngcCsvRows: catalogMeta.counts.ngcCsv,
          addendumCsvRows: catalogMeta.counts.addendumCsv,
          expectedRows: catalogMeta.counts.rows,
          sharplessRows: catalogMeta.counts.sharpless,
          warnings: catalogMeta.warnings,
          rows: s.rows,
          lastImportAt: isoUtcOrNull(s.lastImportAt),
          sources: s.sources,
          lastJob: s.lastJob
            ? {
                id: s.lastJob.id,
                status: s.lastJob.status as 'pending' | 'running' | 'done' | 'failed',
                error: s.lastJob.error,
                createdAt: isoUtc(s.lastJob.createdAt),
                finishedAt: isoUtcOrNull(s.lastJob.finishedAt),
              }
            : null,
        },
      },
      200,
    );
  });

  app.openapi(catalogRefreshRoute, async (c) => {
    const svc = await services();
    const auth = c.get('auth');
    if (!auth || auth.ctx !== 'system') throw new ProblemError('permission.denied');
    const job = await enqueueSystemJob(svc.db, {
      kind: 'catalog_refresh',
      dedupeKey: 'catalog_refresh:dso',
    });
    if (job.created) await svc.jobInvoker.invoke(job.jobId);
    return c.json({ jobId: job.jobId }, 202);
  });

  return app;
}
