/**
 * Objektkatalog (AP-20; FA-FRM-01, FA-FRM-15, S-21, S-82):
 * - `GET /web/v1/dso` (`catalog.read`): Suche und Filter im Speicher (Katalog ≤ 10 min alt).
 * - `GET /system/v1/catalogs` (`system.manage`): Stand – Version, Quellzeilen, Zeilen, letzter Job.
 * - `POST /system/v1/catalogs/{catalog}/refresh` (`system.manage`): Job `catalog_refresh` → `202 {jobId}` –
 *   `dso` aus `packages/catalog-data`, `exoclock`/`nasa`/`toi` von der Quelle (AP-40, FA-EXO-04).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { dsoCatalogStatus, enqueueSystemJob, exoCatalogStatus, readDsoCatalog } from '@nina-pm/db';
import meta from '@nina-pm/catalog-data/openngc/catalog-meta.json' with { type: 'json' };
import {
  CatalogParam,
  CatalogStatus,
  DsoList,
  DsoQuery,
  DsoRegion,
  DsoRegionQuery,
  JobAccepted,
  ProblemError,
} from '@nina-pm/shared';
import { cachedNightEvaluator, nightEvaluator, type NightEvaluator } from '../catalog/night';
import { cachedCatalog, searchDso, searchRegion } from '../catalog/search';
import { requireTenant } from './tenant';
import { buildNightTable, siteNights } from '../lib/night-table';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { enqueueExoCatalog } from '../exo/job';
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
    responses: {
      200: { description: 'Treffer', ...json(DsoList) },
      ...denied,
      404: problemContent('Standort nicht gefunden'),
      422: problemContent('Ungültige Anfrage'),
    },
  },
);

export const dsoRegionRoute = defineRoute(
  { action: 'catalog.read', requirements: ['FA-FRM-09', 'S-20'] },
  {
    method: 'get',
    path: '/api/web/v1/dso/region',
    summary: 'Katalog-Overlay der Sternkarte: Objekte in einem Himmelsausschnitt',
    tags: ['catalog'],
    request: { query: DsoRegionQuery },
    responses: {
      200: { description: 'Objekte im Ausschnitt', ...json(DsoRegion) },
      ...denied,
      422: problemContent('Ungültige Anfrage'),
    },
  },
);

export const catalogStatusRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-FRM-01', 'S-82'] },
  {
    method: 'get',
    path: '/api/system/v1/catalogs',
    summary: 'Stand der Kataloge (Objektkatalog aus OpenNGC, Exoplaneten-Kataloge)',
    tags: ['system'],
    responses: { 200: { description: 'Stand', ...json(CatalogStatus) }, ...denied },
  },
);

export const catalogRefreshRoute = defineRoute(
  { action: 'system.manage', requirements: ['FA-FRM-01', 'FA-EXO-04', 'S-82', 'TK 13'] },
  {
    method: 'post',
    path: '/api/system/v1/catalogs/{catalog}/refresh',
    summary: 'Katalog neu importieren (Job catalog_refresh)',
    tags: ['system'],
    request: { params: CatalogParam },
    responses: {
      202: { description: 'Job angelegt', ...json(JobAccepted) },
      ...denied,
      422: problemContent('Unbekannter Katalog'),
    },
  },
);

export const CATALOG_ROUTES = [
  dsoSearchRoute,
  dsoRegionRoute,
  catalogStatusRoute,
  catalogRefreshRoute,
] as const;

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
    const query = c.req.valid('query');
    const index = await cachedCatalog(() => readDsoCatalog(svc.db), svc.now().getTime());
    let night: NightEvaluator | undefined;
    if (query.siteId) {
      const { tenant } = requireTenant(c);
      const site = await svc.repositories(tenant).equipment().site(query.siteId);
      if (!site) throw new ProblemError('resource.not_found');
      const key = query.night ?? siteNights(site, svc.now(), undefined, 2).currentNight;
      const table = buildNightTable(site, key, 1);
      night = cachedNightEvaluator(
        [
          site.id,
          site.latitudeDeg,
          site.longitudeDeg,
          site.timeZone,
          key,
          query.minAltDeg,
          query.twilight,
        ].join('|'),
        () =>
          nightEvaluator({
            site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg, timeZone: site.timeZone },
            night: key,
            timeZoneTransitions: table.timeZoneTransitions.map((z) => ({
              atUtc: Date.parse(z.atUtc) / 1000,
              utcOffsetMinutes: z.utcOffsetMinutes,
            })),
            minAltDeg: query.minAltDeg,
            twilight: query.twilight,
          }),
      );
    } else if (
      query.minUsableHours !== undefined ||
      query.sort === 'usable' ||
      query.sort === 'altitude' ||
      query.sort === 'score'
    )
      throw new ProblemError('validation.failed', [
        { path: 'siteId', message: 'Nachtfilter und -sortierung nur mit Standort' },
      ]);
    if (query.sort === 'score' && query.rigFovArcmin === undefined)
      throw new ProblemError('validation.failed', [
        { path: 'rigFovArcmin', message: 'Bewertung „Beste der Nacht“ nur mit Rig-Bildfeld' },
      ]);
    c.header('cache-control', 'private, max-age=60');
    return c.json(
      searchDso(index, query, night, {
        version: catalogMeta.version,
        fetchedAt: catalogMeta.fetchedAt,
      }),
      200,
    );
  });

  app.openapi(dsoRegionRoute, async (c) => {
    const svc = await services();
    const index = await cachedCatalog(() => readDsoCatalog(svc.db), svc.now().getTime());
    c.header('cache-control', 'private, max-age=300');
    return c.json(searchRegion(index, c.req.valid('query')), 200);
  });

  app.openapi(catalogStatusRoute, async (c) => {
    const svc = await services();
    const s = await dsoCatalogStatus(svc.db);
    const exo = await exoCatalogStatus(svc.db);
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
        exo: exo.map((e) => ({
          catalog: e.catalog,
          rows: e.rows,
          unknownTimeSystem: e.unknownTimeSystem,
          lastImportAt: isoUtcOrNull(e.lastImportAt),
          lastJob: e.lastJob
            ? {
                id: e.lastJob.id,
                status: e.lastJob.status as 'pending' | 'running' | 'done' | 'failed',
                error: e.lastJob.error,
                createdAt: isoUtc(e.lastJob.createdAt),
                finishedAt: isoUtcOrNull(e.lastJob.finishedAt),
              }
            : null,
        })),
      },
      200,
    );
  });

  app.openapi(catalogRefreshRoute, async (c) => {
    const svc = await services();
    const auth = c.get('auth');
    if (!auth || auth.ctx !== 'system') throw new ProblemError('permission.denied');
    const { catalog } = c.req.valid('param');
    const job =
      catalog === 'dso'
        ? await enqueueSystemJob(svc.db, {
            kind: 'catalog_refresh',
            dedupeKey: 'catalog_refresh:dso',
            input: { catalog },
          })
        : await enqueueExoCatalog(svc.db, catalog);
    if (job.created) await svc.jobInvoker.invoke(job.jobId);
    return c.json({ jobId: job.jobId }, 202);
  });

  return app;
}
