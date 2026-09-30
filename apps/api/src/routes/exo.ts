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
  effectiveTenantSettings,
  ExoLockCreate,
  ExoObservationDecline,
  ExoProjectCreate,
  ExoProjectCreated,
  ExoProjectDetail,
  ExoProjectPatch,
  ExoTransitList,
  ExoTransitQuery,
  ProblemError,
  ProjectCreate,
  transitDeadlineMs,
  transitPlannedFrames,
  Uuid,
  type Action,
  type AuthContext,
} from '@nina-pm/shared';
import { nightWindows, rigTransitContext } from '../exo/context';
import { exoDetail, loadExoProject, lockModeFor, upcomingTransits } from '../exo/detail';
import { catalogUpdate, ephemerisOf, findMerged, mergedCatalog, snapshotOf } from '../exo/project';
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

const observationParams = z.object({ id: Uuid, observationId: Uuid });
const transitProblems = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
  404: problemContent('Projekt bzw. Beobachtung nicht gefunden'),
  409: problemContent(
    'transit.lock_not_allowed, transit.too_many_open, transit.window_overlap, transit.share_mismatch, transit.deadline_passed, transit.ephemeris_stale',
  ),
  422: problemContent('Ungültige Anfrage'),
};

export const lockTransitRoute = defineRoute(
  {
    action: 'transit.lock',
    requirements: ['FA-EXO-18', 'FA-EXO-19', 'FA-EXO-20', 'FA-EXO-33', 'FA-FRG-09'],
  },
  {
    method: 'post',
    path: '/api/web/v1/projects/{id}/exo/lock',
    summary: 'Transit festlegen bzw. wünschen (vor der Freigabe, mit Bestätigung)',
    tags: ['exo'],
    request: { params: idParam, body: { ...json(ExoLockCreate), required: true } },
    responses: {
      200: { description: 'Exoplaneten-Teil nach dem Festlegen', ...json(ExoProjectDetail) },
      ...transitProblems,
    },
  },
);

export const unlockTransitRoute = defineRoute(
  { action: 'transit.lock', requirements: ['FA-EXO-18', 'FA-EXO-21', 'FA-EXO-33'] },
  {
    method: 'delete',
    path: '/api/web/v1/projects/{id}/exo/lock/{observationId}',
    summary: 'Festlegung aufheben (storniert)',
    tags: ['exo'],
    request: { params: observationParams },
    responses: {
      200: { description: 'Exoplaneten-Teil nach dem Aufheben', ...json(ExoProjectDetail) },
      ...transitProblems,
    },
  },
);

export const patchExoProjectRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-EXO-19', 'FA-EXO-20'] },
  {
    method: 'patch',
    path: '/api/web/v1/projects/{id}/exo',
    summary: 'Transit-Einstellungen: Baseline, Puffer, Autofokus/Zentrieren, Defokus-Hinweis',
    tags: ['exo'],
    request: { params: idParam, body: { ...json(ExoProjectPatch), required: true } },
    responses: {
      200: { description: 'Exoplaneten-Teil', ...json(ExoProjectDetail) },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('Projekt nicht gefunden oder kein Exoplaneten-Projekt'),
      422: problemContent('Ungültige Anfrage'),
    },
  },
);

const decisionParams = z.object({ id: Uuid });

export const confirmTransitRoute = defineRoute(
  { action: 'queue.decide', requirements: ['FA-EXO-18', 'FA-FRG-04'] },
  {
    method: 'post',
    path: '/api/web/v1/transit-observations/{id}/confirm',
    summary: 'Transit-Bestätigung: festlegen (Warteschlange)',
    tags: ['exo'],
    request: { params: decisionParams },
    responses: { 204: { description: 'Festgelegt' }, ...transitProblems },
  },
);

export const declineTransitRoute = defineRoute(
  { action: 'queue.decide', requirements: ['FA-EXO-18', 'FA-FRG-04'] },
  {
    method: 'post',
    path: '/api/web/v1/transit-observations/{id}/decline',
    summary: 'Transit-Bestätigung ablehnen (storniert, mit Begründung)',
    tags: ['exo'],
    request: {
      params: decisionParams,
      body: { ...json(ExoObservationDecline), required: true },
    },
    responses: { 204: { description: 'Abgelehnt' }, ...transitProblems },
  },
);

export const EXO_ROUTES = [
  exoTransitsRoute,
  createExoProjectRoute,
  exoProjectRoute,
  refreshEphemerisRoute,
  lockTransitRoute,
  unlockTransitRoute,
  patchExoProjectRoute,
  confirmTransitRoute,
  declineTransitRoute,
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

  app.openapi(exoProjectRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const { id } = c.req.valid('param');
    await authorized(svc.repositories(tenant).projects(), auth, id, 'project.read');
    c.header('cache-control', 'no-store');
    return c.json(await exoDetail(svc, tenant, auth, id), 200);
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
    return c.json(await exoDetail(svc, tenant, auth, id), 200);
  });

  /**
   * Festlegen am Objekt prüfen (transit.md §8): freigegeben → `transit.lock` (Grenze offener Beobachtungen prüft
   * das Repository als 409), sonst `project.update` (Wunsch vor der Freigabe). Fremde/gelöschte Projekte 404.
   */
  const lockContext = async (
    svc: ApiServices,
    tenant: ReturnType<typeof requireTenant>['tenant'],
    auth: AuthContext,
    id: string,
  ) => {
    const repos = svc.repositories(tenant);
    const meta = await repos.projects().meta(id);
    if (!meta) throw new ProblemError('resource.not_found');
    const x = await loadExoProject(svc, tenant, id);
    const settings = effectiveTenantSettings((await repos.tenant().current())?.settings);
    const { mode, blocked } = lockModeFor(auth, x, settings);
    if (!mode) {
      if (blocked === 'no_right' || blocked === 'submitted')
        throw new ProblemError('permission.denied');
      throw new ProblemError('transit.lock_not_allowed', [
        { path: 'id', message: blocked ?? 'nicht festlegbar' },
      ]);
    }
    return { repos, x, mode, settings };
  };

  app.openapi(lockTransitRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const { id } = c.req.valid('param');
    const { epoch } = c.req.valid('json');
    const { repos, x, mode, settings } = await lockContext(svc, tenant, auth, id);
    const rc = x.rc as NonNullable<typeof x.rc>;
    const line = x.line as NonNullable<typeof x.line>;
    const { upcoming } = await upcomingTransits(svc, tenant, auth.memberId as string, x);
    const u = upcoming.find((t) => t.item.transit.n === epoch);
    if (!u)
      throw new ProblemError('validation.failed', [
        { path: 'epoch', message: 'kein beobachtbarer Transit in den nächsten Nächten' },
      ]);
    const t = u.item.transit;
    if (t.ephemerisAge === 'stale') throw new ProblemError('transit.ephemeris_stale');
    const now = svc.now();
    const windowStart = new Date(t.windowStartUtc);
    const windowEnd = new Date(t.windowEndUtc);
    const deadline = new Date(
      transitDeadlineMs(windowStart.getTime(), rc.rig.overhead.slewCenterS),
    );
    const admin = can(auth, 'project.status');
    if (!admin && now > deadline) throw new ProblemError('transit.deadline_passed');
    await repos.transits().lock(
      {
        observation: {
          projectId: id,
          ephemerisId: x.active.id,
          epoch,
          night: u.night,
          ingressUtc: new Date(t.ingressUtc),
          midUtc: new Date(t.tcUtc),
          egressUtc: new Date(t.egressUtc),
          windowStartUtc: windowStart,
          windowEndUtc: windowEnd,
          baselineBeforeMin: t.baselineBeforeMin,
          baselineAfterMin: t.baselineAfterMin,
          bufferMin: t.bufferS / 60,
          plannedCount: transitPlannedFrames(
            windowStart.getTime(),
            windowEnd.getTime(),
            line.line.exposureS,
            rc.rig.overhead.downloadS,
          ),
          confirmDeadlineUtc: deadline,
        },
        rigId: rc.rig.id,
        planet: x.exo.planet,
        mode: mode as NonNullable<typeof mode>,
        maxOpen: admin || mode === 'wish' ? null : settings.exoUserMaxOpenLocks,
        line: line.line,
      },
      now,
    );
    await scheduleProjectJobs(svc, repos, id);
    c.header('cache-control', 'no-store');
    return c.json(await exoDetail(svc, tenant, auth, id), 200);
  });

  app.openapi(unlockTransitRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const { id, observationId } = c.req.valid('param');
    const repos = svc.repositories(tenant);
    const meta = await repos.projects().meta(id);
    if (!meta) throw new ProblemError('resource.not_found');
    const res = {
      tenantId: auth.tenantId ?? undefined,
      createdBy: meta.createdBy,
      approvalStatus: meta.approvalStatus as never,
    };
    const allowed =
      meta.approvalStatus === 'approved'
        ? can(auth, 'transit.lock', { ...res, openLocks: 0 })
        : can(auth, 'project.update', res);
    if (!allowed) throw new ProblemError('permission.denied');
    await repos.transits().cancel(id, observationId, svc.now());
    await scheduleProjectJobs(svc, repos, id);
    c.header('cache-control', 'no-store');
    return c.json(await exoDetail(svc, tenant, auth, id), 200);
  });

  app.openapi(patchExoProjectRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const { id } = c.req.valid('param');
    const repos = svc.repositories(tenant);
    await authorized(repos.projects(), auth, id, 'project.update');
    await repos.projects().patchExoplanet(id, c.req.valid('json'), svc.now());
    c.header('cache-control', 'no-store');
    return c.json(await exoDetail(svc, tenant, auth, id), 200);
  });

  /** Warteschlange: Ersteller der Beobachtung ermitteln und `queue.decide` am Objekt prüfen (nicht eigene). */
  const decideTransit = async (
    c: Parameters<Parameters<typeof app.openapi>[1]>[0],
    decision: 'confirm' | 'decline',
    comment: string | null,
  ) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const { id } = c.req.param() as { id: string };
    const repos = svc.repositories(tenant);
    const o = await repos.transits().observation(id);
    if (!o) throw new ProblemError('resource.not_found');
    const meta = await repos.projects().meta(o.projectId);
    if (!meta) throw new ProblemError('resource.not_found');
    const res = {
      tenantId: auth.tenantId ?? undefined,
      createdBy: meta.createdBy,
      approvalStatus: meta.approvalStatus as never,
    };
    if (!can(auth, 'queue.decide', res)) throw new ProblemError('permission.denied');
    const r = await repos.transits().decide(id, decision, comment, svc.now());
    await scheduleProjectJobs(svc, repos, r.projectId);
  };

  app.openapi(confirmTransitRoute, async (c) => {
    await decideTransit(c, 'confirm', null);
    return c.body(null, 204);
  });

  app.openapi(declineTransitRoute, async (c) => {
    await decideTransit(c, 'decline', c.req.valid('json').comment);
    return c.body(null, 204);
  });

  return app;
}
