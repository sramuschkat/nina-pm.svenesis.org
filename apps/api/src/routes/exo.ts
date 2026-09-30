/**
 * Exoplaneten (AP-42; FA-EXO-01…17, FK 14.3):
 * - `GET /web/v1/exo/transits` (`catalog.read`): Transits der gewählten Kataloge für ein Rig und eine Nacht,
 *   gerechnet mit der Engine (transit.md §2). Ohne `night` die laufende Nacht des Standorts (NT-01).
 * - `POST /web/v1/exo/projects` (`project.create`): Exoplaneten-Projekt aus einer Ergebniszeile (FA-EXO-15/16);
 *   eindeutig je Planet, Rig und Ersteller (OP-22) – ein vorhandenes eigenes Projekt kommt zurück.
 * - `GET /web/v1/projects/{id}/exo` (`project.read`): Reiter *Exoplanet-Transit* (FA-EXO-17) mit Ephemeride,
 *   Historie, Katalog-Angebot, Projekten anderer Mitglieder und den kommenden beobachtbaren Transits.
 * - `POST /web/v1/projects/{id}/ephemeris/refresh` (`project.update`): Katalog-Ephemeride übernehmen (FA-EXO-16).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  exoCatalogStatus,
  myExoProjectCounts,
  readExoCatalog,
  type ExoCatalog,
  type ProjectRepository,
} from '@nina-pm/db';
import { mapBandToRig, recommendedBand, TWILIGHT_DEG } from '@nina-pm/engine';
import {
  can,
  DEFAULT_CONDITIONS,
  EXO_CATALOG_NAMES,
  ExoProjectCreate,
  ExoProjectCreated,
  ExoProjectDetail,
  ExoTransitList,
  ExoTransitQuery,
  ProblemError,
  ProjectCreate,
  Uuid,
  type Action,
  type AuthContext,
  type ExoTransitView,
} from '@nina-pm/shared';
import { nightWindows, rigTransitContext } from '../exo/context';
import {
  catalogUpdate,
  entryFromProject,
  ephemerisOf,
  ephemerisView,
  findMerged,
  mergedCatalog,
  snapshotOf,
} from '../exo/project';
import { cachedExoCatalog, searchTransits } from '../exo/search';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { siteNights } from '../lib/night-table';
import { defineRoute, problemContent } from './define';
import { scheduleProjectJobs } from './effort-trigger';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});

const idParam = z.object({ id: Uuid });

/** Nächte der Vorhersage im Reiter *Exoplanet-Transit* (FA-EXO-17; Entscheidung 30.09.2026: 60 Nächte). */
export const EXO_UPCOMING_NIGHTS = 60;

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

export const createExoProjectRoute = defineRoute(
  { action: 'project.create', requirements: ['FA-EXO-15', 'FA-EXO-16', 'FA-EXO-05', 'OP-22'] },
  {
    method: 'post',
    path: '/api/web/v1/exo/projects',
    summary: 'Exoplaneten-Projekt aus der Transitsuche anlegen bzw. das eigene öffnen',
    tags: ['exo'],
    request: { body: { ...json(ExoProjectCreate), required: true } },
    responses: {
      200: { description: 'Eigenes Projekt existiert bereits', ...json(ExoProjectCreated) },
      201: { description: 'Angelegt', ...json(ExoProjectCreated) },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('Rig oder Planet nicht gefunden'),
      409: problemContent('resource.in_use'),
      422: problemContent('Ungültige Anfrage'),
    },
  },
);

export const exoProjectRoute = defineRoute(
  { action: 'project.read', requirements: ['FA-EXO-15', 'FA-EXO-16', 'FA-EXO-17'] },
  {
    method: 'get',
    path: '/api/web/v1/projects/{id}/exo',
    summary: 'Exoplanet-Transit eines Projekts: Ephemeride, Angebot, kommende Transits',
    tags: ['exo'],
    request: { params: idParam },
    responses: {
      200: { description: 'Exoplaneten-Teil', ...json(ExoProjectDetail) },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('Projekt nicht gefunden oder kein Exoplaneten-Projekt'),
    },
  },
);

export const refreshEphemerisRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-EXO-16'] },
  {
    method: 'post',
    path: '/api/web/v1/projects/{id}/ephemeris/refresh',
    summary: 'Neuere Katalog-Ephemeride übernehmen (frühere bleibt als Historie)',
    tags: ['exo'],
    request: { params: idParam },
    responses: {
      200: { description: 'Exoplaneten-Teil nach der Übernahme', ...json(ExoProjectDetail) },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('Projekt nicht gefunden oder Planet nicht mehr im Katalog'),
    },
  },
);

export const EXO_ROUTES = [
  exoTransitsRoute,
  createExoProjectRoute,
  exoProjectRoute,
  refreshEphemerisRoute,
] as const;

export function exoRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(exoTransitsRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const query = c.req.valid('query');
    const rc = await rigTransitContext(svc.repositories(tenant).equipment(), query.rigId);
    if (!rc) throw new ProblemError('resource.not_found');
    const { rig, site } = rc;

    const nights = siteNights(site, svc.now(), undefined, 2);
    const night = query.night ?? nights.currentNight;
    const [window] = nightWindows(site, night, 1);
    if (!window) throw new ProblemError('resource.not_found');
    const times = { nightWindow: window };

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
      rigApertureMm: rc.apertureMm,
      rigFilters: rc.rigFilters,
      unconfirmedRigFilters: rc.unconfirmedRigFilters,
      exposureRig: rc.exposureRig,
      myProjects: await myExoProjectCounts(svc.db, tenant.tenantId, auth.memberId as string),
    });

    c.header('cache-control', 'private, max-age=60');
    return c.json(
      {
        rig: { id: rig.id, name: rig.name, apertureMm: rc.apertureMm },
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

  /** Projekt laden und die Aktion am Objekt prüfen (TK 5.5): fremd/gelöscht 404, ohne Recht 403. */
  const authorized = async (
    repo: ProjectRepository,
    auth: AuthContext,
    id: string,
    action: Action,
  ) => {
    const meta = await repo.meta(id);
    if (!meta) throw new ProblemError('resource.not_found');
    const res = {
      tenantId: auth.tenantId ?? undefined,
      createdBy: meta.createdBy,
      approvalStatus: meta.approvalStatus as never,
    };
    if (!can(auth, action, res)) throw new ProblemError('permission.denied');
  };

  app.openapi(createExoProjectRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const body = c.req.valid('json');
    const repos = svc.repositories(tenant);
    const rc = await rigTransitContext(repos.equipment(), body.rigId);
    if (!rc) throw new ProblemError('resource.not_found');
    const entries = await cachedExoCatalog(() => readExoCatalog(svc.db), svc.now().getTime());
    const m = findMerged(mergedCatalog(entries), body.catalog, body.planet);
    if (!m) throw new ProblemError('resource.not_found');

    const own = await repos.exoProjects().ownFor(m.planet, body.rigId);
    if (own) return c.json({ projectId: own, created: false }, 200);

    const snapshot = snapshotOf(m);
    const mag =
      m.magBandUsed === 'V'
        ? m.magVJohnson
        : m.magBandUsed === 'R'
          ? m.magRCousins
          : m.magBandUsed === 'G'
            ? m.magGaiaG
            : m.magBandUsed === 'T'
              ? m.magTess
              : null;
    const choice = mapBandToRig(recommendedBand(snapshot.teffK, mag), rc.rigFilters);
    const input = ProjectCreate.parse({
      id: body.id,
      name: m.planet,
      rigId: body.rigId,
      targetName: m.star,
      targetType: 'exoplanet',
      catalogNames: [m.planet, m.star, snapshot.ticId ? `TIC ${snapshot.ticId}` : null]
        .filter((x): x is string => x !== null)
        .join(', ')
        .slice(0, 500),
      raDeg: m.raDeg,
      decDeg: m.decDeg,
      conditions: {
        ...DEFAULT_CONDITIONS,
        // Aus dem Suchfilter, damit gefundene Transits planbar bleiben (FA-EXO-05); Mond nur Hinweis (FA-EXO-20).
        minAltitudeDeg: body.minAltDeg,
        twilight: body.twilight,
        moonAvoidanceEnabled: false,
      },
    });
    const d = await repos.projects().createExoplanet(
      input,
      {
        planet: m.planet,
        star: m.star,
        catalog: m.catalog,
        catalogEntryId: m.id,
        bufferSigma: 1,
        catalogSnapshot: snapshot,
        ephemeris: ephemerisOf(m),
        line: choice ? { filterId: choice.filterId, exposureS: body.exposureS ?? 60 } : null,
      },
      svc.now(),
    );
    await scheduleProjectJobs(svc, repos, d.project.id);
    return c.json({ projectId: d.project.id, created: true }, 201);
  });

  /** Exoplaneten-Teil eines Projekts inkl. Vorhersage (FA-EXO-17). */
  const exoDetail = async (
    svc: ApiServices,
    tenant: ReturnType<typeof requireTenant>['tenant'],
    memberId: string,
    projectId: string,
  ): Promise<ExoProjectDetail> => {
    const repos = svc.repositories(tenant);
    const d = await repos.projects().detail(projectId);
    if (!d || d.project.projectType !== 'exoplanet') throw new ProblemError('resource.not_found');
    const exoRepo = repos.exoProjects();
    const exo = await exoRepo.exoProject(projectId);
    const ephemerides = await exoRepo.ephemerides(projectId);
    const active = ephemerides.find((e) => e.isActive) ?? ephemerides[0];
    if (!exo || !active) throw new ProblemError('resource.not_found');

    const p = d.project;
    const rigId = p.rigId ?? p.requestedRigId;
    const rc = rigId ? await rigTransitContext(repos.equipment(), rigId) : undefined;
    const entry = entryFromProject(exo.catalogSnapshot, active);
    const k = Math.min(3, Math.max(1, Math.round(exo.bufferSigma))) as 1 | 2 | 3;
    const twilight = p.twilight as ExoProjectDetail['twilight'];
    const minAltDeg = Number(p.minAltitudeDeg);

    let upcoming: { night: string; item: ExoTransitView }[] = [];
    let fromNight: string | null = null;
    if (rc && entry) {
      fromNight = siteNights(rc.site, svc.now(), undefined, 2).currentNight;
      const myProjects = await myExoProjectCounts(svc.db, tenant.tenantId, memberId);
      for (const w of nightWindows(rc.site, fromNight, EXO_UPCOMING_NIGHTS)) {
        const items = searchTransits({
          entries: [entry],
          catalogs: [entry.catalog],
          site: { latDeg: rc.site.latitudeDeg, lonDeg: rc.site.longitudeDeg },
          nightStartUtc: w.startUtc,
          nightEndUtc: w.endUtc,
          minAltDeg,
          twilightDeg: TWILIGHT_DEG[twilight],
          k,
          rigApertureMm: rc.apertureMm,
          rigFilters: rc.rigFilters,
          unconfirmedRigFilters: rc.unconfirmedRigFilters,
          exposureRig: rc.exposureRig,
          myProjects,
        });
        upcoming.push(
          ...items.filter((x) => x.transit.observable).map((item) => ({ night: w.night, item })),
        );
      }
      // Dieselbe Epoche kann in zwei Nachtfenstern liegen (Fenster über Mittag): einmal zeigen.
      const seen = new Set<number>();
      upcoming = upcoming.filter((x) => {
        if (seen.has(x.item.transit.n)) return false;
        seen.add(x.item.transit.n);
        return true;
      });
    }

    const entries = await cachedExoCatalog(() => readExoCatalog(svc.db), svc.now().getTime());
    const current = findMerged(mergedCatalog(entries), exo.catalog, exo.planet);
    return {
      projectId,
      planet: exo.planet,
      star: exo.star,
      catalog: exo.catalog as ExoProjectDetail['catalog'],
      baselineBeforeMin: Number(exo.baselineBeforeMin),
      baselineAfterMin: Number(exo.baselineAfterMin),
      bufferSigma: exo.bufferSigma,
      ephemeris: ephemerisView(active),
      history: ephemerides.filter((e) => e.id !== active.id).map(ephemerisView),
      catalogUpdate: current
        ? catalogUpdate(
            active,
            current,
            Number(p.raDeg ?? current.raDeg),
            Number(p.decDeg ?? current.decDeg),
            svc.now().getTime() / 1000,
          )
        : null,
      others: await exoRepo.others(exo.planet, projectId),
      rig: rc ? { id: rc.rig.id, name: rc.rig.name, apertureMm: rc.apertureMm } : null,
      site: rc
        ? {
            id: rc.site.id,
            name: rc.site.name,
            timeZone: rc.site.timeZone,
            latDeg: rc.site.latitudeDeg,
            lonDeg: rc.site.longitudeDeg,
          }
        : null,
      minAltDeg,
      twilight,
      fromNight,
      nights: EXO_UPCOMING_NIGHTS,
      upcoming,
    };
  };

  app.openapi(exoProjectRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const { id } = c.req.valid('param');
    await authorized(svc.repositories(tenant).projects(), auth, id, 'project.read');
    c.header('cache-control', 'no-store');
    return c.json(await exoDetail(svc, tenant, auth.memberId as string, id), 200);
  });

  app.openapi(refreshEphemerisRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const { id } = c.req.valid('param');
    const repos = svc.repositories(tenant);
    await authorized(repos.projects(), auth, id, 'project.update');
    const exo = await repos.exoProjects().exoProject(id);
    if (!exo) throw new ProblemError('resource.not_found');
    const entries = await cachedExoCatalog(() => readExoCatalog(svc.db), svc.now().getTime());
    const m = findMerged(mergedCatalog(entries), exo.catalog, exo.planet);
    if (!m) throw new ProblemError('resource.not_found');
    const active = (await repos.exoProjects().ephemerides(id)).find((e) => e.isActive);
    // Nur übernehmen, wenn sich etwas geändert hat (sonst entstünde eine gleiche Historienzeile).
    if (!active || catalogUpdate(active, m, m.raDeg, m.decDeg, svc.now().getTime() / 1000)) {
      await repos.projects().replaceEphemeris(
        id,
        {
          catalog: m.catalog,
          catalogEntryId: m.id,
          catalogSnapshot: snapshotOf(m),
          ephemeris: ephemerisOf(m),
        },
        svc.now(),
      );
      await scheduleProjectJobs(svc, repos, id);
    }
    c.header('cache-control', 'no-store');
    return c.json(await exoDetail(svc, tenant, auth.memberId as string, id), 200);
  });

  return app;
}
