/**
 * Transitsuche S-22 (AP-42; FA-EXO-01…14, FK 14.3):
 * - `GET /web/v1/exo/transits` (`catalog.read`): Transits der gewählten Kataloge für ein Rig und eine Nacht,
 *   gerechnet mit der Engine (transit.md §2). Ohne `night` die laufende Nacht des Standorts (NT-01).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { exoCatalogStatus, myExoProjectCounts, readExoCatalog, type ExoCatalog } from '@nina-pm/db';
import { nightTimes, TWILIGHT_DEG, type RigFilter } from '@nina-pm/engine';
import { EXO_CATALOG_NAMES, ExoTransitList, ExoTransitQuery, ProblemError } from '@nina-pm/shared';
import { exposureRig } from '../exo/exposure';
import { cachedExoCatalog, searchTransits } from '../exo/search';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { buildNightTable, siteNights } from '../lib/night-table';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});

export const exoTransitsRoute = defineRoute(
  {
    action: 'catalog.read',
    requirements: [
      'FA-EXO-01',
      'FA-EXO-02',
      'FA-EXO-03',
      'FA-EXO-05',
      'FA-EXO-06',
      'FA-EXO-07',
      'FA-EXO-08',
      'FA-EXO-10',
      'FA-EXO-11',
      'FA-EXO-12',
      'FA-EXO-13',
      'FA-EXO-14a',
      'S-22',
    ],
  },
  {
    method: 'get',
    path: '/api/web/v1/exo/transits',
    summary: 'Transitsuche je Rig und Nacht (S-22)',
    tags: ['exo'],
    request: { query: ExoTransitQuery },
    responses: {
      200: { description: 'Transits der Nacht', ...json(ExoTransitList) },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('Rig nicht gefunden'),
      422: problemContent('Ungültige Anfrage'),
    },
  },
);

export const EXO_ROUTES = [exoTransitsRoute] as const;

export function exoRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(exoTransitsRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const query = c.req.valid('query');
    const equipment = svc.repositories(tenant).equipment();
    const rig = await equipment.rig(query.rigId);
    if (!rig) throw new ProblemError('resource.not_found');
    const site = rig.siteId ? await equipment.site(rig.siteId) : undefined;
    if (!site) throw new ProblemError('resource.not_found');
    const telescope = rig.telescopeId ? await equipment.telescope(rig.telescopeId) : undefined;
    const camera = rig.cameraId ? await equipment.camera(rig.cameraId) : undefined;

    const nights = siteNights(site, svc.now(), undefined, 2);
    const night = query.night ?? nights.currentNight;
    const table = buildNightTable(site, night, 1);
    const times = nightTimes({
      site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
      night,
      timeZoneTransitions: table.timeZoneTransitions.map((z) => ({
        atUtc: Date.parse(z.atUtc) / 1000,
        utcOffsetMinutes: z.utcOffsetMinutes,
      })),
    });

    // Bestätigte Filterradbelegung (FA-RIG-14): Platz mit Filter und bestätigtem NINA-Namen.
    const filters = await equipment.filters();
    const rigFilters: RigFilter[] = rig.filterWheel
      .filter((s) => s.filterId !== null && s.ninaFilterName !== null && s.ninaConfirmedAt !== null)
      .map((s) => filters.find((f) => f.id === s.filterId))
      .filter((f): f is NonNullable<typeof f> => f !== undefined)
      .map((f) => ({
        id: f.id,
        shortName: f.shortName,
        photometricBand: f.photometricBand,
        filterType: f.filterType,
        centerWavelengthNm: f.centerWavelengthNm === null ? null : Number(f.centerWavelengthNm),
      }));

    const catalogs = (query.catalogs?.split(',') ?? [...EXO_CATALOG_NAMES]) as ExoCatalog[];
    const entries = await cachedExoCatalog(() => readExoCatalog(svc.db), svc.now().getTime());
    const status = await exoCatalogStatus(svc.db);
    const items = searchTransits({
      entries,
      catalogs,
      site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
      nightStartUtc: times.nightWindow.startUtc,
      nightEndUtc: times.nightWindow.endUtc,
      minAltDeg: query.minAltDeg,
      twilightDeg: TWILIGHT_DEG[query.twilight],
      k: query.k as 1 | 2 | 3,
      rigApertureMm:
        telescope?.apertureMm === undefined || telescope.apertureMm === null
          ? null
          : Number(telescope.apertureMm),
      rigFilters,
      exposureRig: exposureRig({
        telescope,
        camera,
        site,
        downloadS: rig.overhead.downloadS,
        filters,
      }),
      myProjects: await myExoProjectCounts(svc.db, tenant.tenantId, auth.memberId as string),
    });

    c.header('cache-control', 'private, max-age=60');
    return c.json(
      {
        rig: {
          id: rig.id,
          name: rig.name,
          apertureMm:
            telescope?.apertureMm === undefined || telescope.apertureMm === null
              ? null
              : Number(telescope.apertureMm),
        },
        site: {
          id: site.id,
          name: site.name,
          timeZone: site.timeZone,
          latDeg: site.latitudeDeg,
          lonDeg: site.longitudeDeg,
        },
        night,
        currentNight: nights.currentNight,
        nightStartUtc: isoUtc(new Date(times.nightWindow.startUtc * 1000)),
        nightEndUtc: isoUtc(new Date(times.nightWindow.endUtc * 1000)),
        minAltDeg: query.minAltDeg,
        twilight: query.twilight,
        catalogs: status.map((s) => ({
          catalog: s.catalog,
          rows: s.rows,
          fetchedAt: isoUtcOrNull(s.lastImportAt),
        })),
        items,
      },
      200,
    );
  });

  return app;
}
