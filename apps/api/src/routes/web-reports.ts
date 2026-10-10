/**
 * Auswertung – Projekte S-63 und Himmel S-65 (AP-69): `GET /web/v1/reports/sky?from=&to=&status=&rigId=` (`project.read`)
 * – Projekte mit Bildfeld, Panels und Stunden je Filter im Zeitraum, Nächte je Rig mit Stunden je Projekt und der Mond je
 * Nacht. Unten der Projektbericht.
 *
 * Projektbericht S-63 (AP-34; FA-AUS-18, FA-AUS-10, FA-AUS-11, FA-AUS-13; TK 7.2 „Auswertung“):
 * `GET /web/v1/reports/projects?from=&to=&status=&rigId=&type=&projectId=` (`project.read`) – freigegebene Projekte
 * (Sichtbarkeit wie die Projektliste, FA-BER-02) mit Filter-Summen, Verlauf je Nacht, Sessions und
 * Kanalbalance. `from`/`to` sind Nacht-Schlüssel (NT-04); CSV und Druckansicht erzeugt der Browser.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { projectReportRows } from '@nina-pm/db';
import { daysFromKey, keyFromDays, moonAt, moonPhaseAngleDeg, nightBounds } from '@nina-pm/engine';
import {
  can,
  effectiveTenantSettings,
  imageScale,
  ProblemError,
  ProjectReport,
  ProjectReportQuery,
  projectReport,
  SKY_REPORT_MAX_NIGHTS,
  SkyReport,
  SkyReportQuery,
  type FilterType,
  type SkyProject,
} from '@nina-pm/shared';
import { timeZoneTransitions } from '../lib/night-table';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';
import { projectView } from './web-projects';

/** Höchstzahl Projekte je Bericht (Antwortgröße). */
const MAX_REPORT_PROJECTS = 200;

export const projectReportRoute = defineRoute(
  {
    action: 'project.read',
    requirements: ['FA-AUS-18', 'FA-AUS-10', 'FA-AUS-11', 'FA-AUS-13', 'S-63'],
  },
  {
    method: 'get',
    path: '/api/web/v1/reports/projects',
    summary: 'Projektbericht: Zeitraum, Status, Rig, Typ',
    tags: ['reports'],
    request: { query: ProjectReportQuery },
    responses: {
      200: { description: 'Bericht', content: { 'application/json': { schema: ProjectReport } } },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      422: problemContent('validation.failed'),
    },
  },
);

export const skyReportRoute = defineRoute(
  {
    action: 'project.read',
    requirements: ['FA-AUS-26', 'FA-AUS-27', 'FA-AUS-28', 'FA-AUS-29', 'S-65'],
  },
  {
    method: 'get',
    path: '/api/web/v1/reports/sky',
    summary: 'Himmel: Ganzhimmelkarte und Zeitachse je Rig (Zeitraum, Status, Rig)',
    tags: ['reports'],
    request: { query: SkyReportQuery },
    responses: {
      200: { description: 'Himmel', content: { 'application/json': { schema: SkyReport } } },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      422: problemContent('validation.failed'),
    },
  },
);

export const REPORT_ROUTES = [projectReportRoute, skyReportRoute] as const;

/** Höchstzahl Projekte der Himmelskarte (alle Projekte eines Mandanten passen bisher weit darunter). */
const MAX_SKY_PROJECTS = 500;
const round1 = (x: number) => Math.round(x * 10) / 10;

export function webReportRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  app.openapi(skyReportRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const q = c.req.valid('query');
    if (q.from > q.to)
      throw new ProblemError('validation.failed', [{ path: 'from', message: 'nach „bis“' }]);
    const count = daysFromKey(q.to) - daysFromKey(q.from) + 1;
    if (count > SKY_REPORT_MAX_NIGHTS)
      throw new ProblemError('validation.failed', [
        { path: 'from', message: `höchstens ${String(SKY_REPORT_MAX_NIGHTS)} Nächte` },
      ]);
    const repos = svc.repositories(tenant);
    const eq = repos.equipment();
    const list = await repos.projects().list({
      admin: can(auth, 'project.status'),
      deleted: false,
      approvalStatus: 'approved',
      mine: false,
      favorites: false,
      ...(q.rigId ? { rigId: q.rigId } : {}),
      ...(q.status ? { status: q.status } : {}),
    });
    const views = list
      .map((d) => projectView(d))
      .filter((p) => (q.rigId ? p.rigId === q.rigId : true))
      .slice(0, MAX_SKY_PROJECTS);
    const [rows, rigs, telescopes, cameras, filters, current] = await Promise.all([
      projectReportRows(
        svc.db,
        tenant.tenantId,
        views.map((p) => p.id),
        q.from,
        q.to,
        { sessions: false },
      ),
      eq.rigs(),
      eq.telescopes(),
      eq.cameras(),
      eq.filters(),
      repos.tenant().current(),
    ]);
    const report = projectReport({
      from: q.from,
      to: q.to,
      generatedAt: isoUtc(svc.now()),
      projects: views,
      rigNames: new Map(rigs.map((r) => [r.id, r.name])),
      nights: rows.nights,
      sessions: [],
    });
    // Bildfeld je Rig (Teleskop × Kamera, wie `rigView`).
    const telescopeOf = new Map(telescopes.map((t) => [t.id, t]));
    const cameraOf = new Map(cameras.map((x) => [x.id, x]));
    const fovOf = new Map(
      rigs.map((r) => {
        const t = telescopeOf.get(r.telescopeId);
        const k = cameraOf.get(r.cameraId);
        const s = t && k ? imageScale({ ...t, ...k }) : null;
        return [
          r.id,
          s && s.fovWidthDeg > 0 && s.fovHeightDeg > 0
            ? { widthDeg: s.fovWidthDeg, heightDeg: s.fovHeightDeg }
            : null,
        ] as const;
      }),
    );
    const typeOf = new Map(filters.map((f) => [f.id, f.filterType as FilterType]));
    const reportOf = new Map(report.projects.map((p) => [p.projectId, p]));
    const projects: SkyProject[] = [];
    const perNight = new Map<string, Map<string, number>>();
    for (const pv of views) {
      const r = reportOf.get(pv.id);
      const first = pv.panels[0];
      const raDeg = pv.raDeg ?? first?.raDeg ?? null;
      const decDeg = pv.decDeg ?? first?.decDeg ?? null;
      if (!r || raDeg === null || decDeg === null) continue;
      const lines = pv.panels.flatMap((panel) => panel.lines);
      const filterType = new Map(
        lines.map((l) => [l.filterShortName, l.filterId ? (typeOf.get(l.filterId) ?? null) : null]),
      );
      const byFilter = new Map<string, number>();
      let period = 0;
      for (const n of r.nights) {
        let night = 0;
        for (const f of n.filters) {
          byFilter.set(f.filter, (byFilter.get(f.filter) ?? 0) + f.integrationS);
          night += f.integrationS;
        }
        period += night;
        if (pv.rigId && night > 0) {
          const key = `${pv.rigId}|${n.night}`;
          const m = perNight.get(key) ?? new Map<string, number>();
          m.set(pv.id, (m.get(pv.id) ?? 0) + night);
          perNight.set(key, m);
        }
      }
      projects.push({
        id: pv.id,
        name: pv.name,
        createdBy: pv.createdBy,
        projectType: pv.projectType,
        status: pv.status,
        rigId: pv.rigId,
        raDeg,
        decDeg,
        rotationDeg: pv.rotationDeg ?? first?.rotationDeg ?? 0,
        fov: pv.rigId ? (fovOf.get(pv.rigId) ?? null) : null,
        panels: pv.panels
          .filter((panel) => panel.enabled && panel.raDeg !== null && panel.decDeg !== null)
          .map((panel) => ({
            raDeg: panel.raDeg as number,
            decDeg: panel.decDeg as number,
            rotationDeg: panel.rotationDeg ?? pv.rotationDeg ?? 0,
          })),
        periodIntegrationS: round1(period),
        totalIntegrationS: round1(pv.progress.integrationS),
        plannedS: round1(pv.progress.plannedS),
        percentDone: r.percentDone,
        byFilter: [...byFilter.entries()].map(([filter, integrationS]) => ({
          filter,
          filterType: filterType.get(filter) ?? null,
          integrationS: round1(integrationS),
        })),
      });
    }
    const nights = [...perNight.entries()]
      .map(([key, m]) => {
        const [rigId, night] = key.split('|') as [string, string];
        return {
          rigId,
          night,
          projects: [...m.entries()].map(([projectId, s]) => ({
            projectId,
            integrationS: round1(s),
          })),
        };
      })
      .sort((a, b) =>
        a.rigId === b.rigId ? (a.night < b.night ? -1 : 1) : a.rigId < b.rigId ? -1 : 1,
      );
    // Mond je Nacht um Mitternacht in der Zeitzone des Mandanten (Mitte Mittag–Mittag); Ort spielt für Phase und
    // Beleuchtung keine sichtbare Rolle.
    const zone = effectiveTenantSettings(current?.settings).tenantTimezone;
    const day = 86_400_000;
    const transitions = timeZoneTransitions(
      zone,
      daysFromKey(q.from) * day - 2 * day,
      daysFromKey(q.to) * day + 3 * day,
    );
    const moon = Array.from({ length: count }, (_, i) => {
      const night = keyFromDays(daysFromKey(q.from) + i);
      const b = nightBounds(night, transitions);
      const t = (b.noonStartUtc + b.noonEndUtc) / 2;
      return {
        night,
        illumPct: round1(moonAt(t, { latDeg: 0, lonDeg: 0 }).illumPct),
        phaseDeg: round1(moonPhaseAngleDeg(t)) % 360,
      };
    });
    const used = new Set([
      ...projects.flatMap((p) => (p.rigId ? [p.rigId] : [])),
      ...nights.map((n) => n.rigId),
    ]);
    c.header('cache-control', 'no-store');
    return c.json(
      {
        from: q.from,
        to: q.to,
        generatedAt: isoUtc(svc.now()),
        rigs: rigs.filter((r) => used.has(r.id)).map((r) => ({ id: r.id, name: r.name })),
        projects,
        nights,
        moon,
      } satisfies z.output<typeof SkyReport>,
      200,
    );
  });
  return app.openapi(projectReportRoute, async (c) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const q = c.req.valid('query');
    if (q.from && q.to && q.from > q.to)
      throw new ProblemError('validation.failed', [{ path: 'from', message: 'nach „bis“' }]);
    const repos = svc.repositories(tenant);
    const list = await repos.projects().list({
      admin: can(auth, 'project.status'),
      deleted: false,
      approvalStatus: 'approved',
      mine: false,
      favorites: false,
      ...(q.rigId ? { rigId: q.rigId } : {}),
      ...(q.status ? { status: q.status } : {}),
    });
    const projects = list
      .map((d) => projectView(d))
      .filter((p) => (q.type ? p.projectType === q.type : true))
      .filter((p) => (q.rigId ? p.rigId === q.rigId : true))
      .filter((p) => (q.projectId ? p.id === q.projectId : true))
      .slice(0, MAX_REPORT_PROJECTS);
    const [rows, rigs] = await Promise.all([
      projectReportRows(
        svc.db,
        tenant.tenantId,
        projects.map((p) => p.id),
        q.from ?? null,
        q.to ?? null,
      ),
      repos.equipment().rigs(),
    ]);
    const report = projectReport({
      from: q.from ?? null,
      to: q.to ?? null,
      generatedAt: isoUtc(svc.now()),
      projects,
      rigNames: new Map(rigs.map((r) => [r.id, r.name])),
      nights: rows.nights,
      sessions: rows.sessions,
      commentCounts: new Map(list.map((d) => [d.project.id, d.commentCount])),
    });
    c.header('cache-control', 'no-store');
    return c.json(report satisfies z.output<typeof ProjectReport>, 200);
  });
}
