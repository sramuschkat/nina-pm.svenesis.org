/**
 * Projektbericht S-63 (AP-34; FA-AUS-18, FA-AUS-10, FA-AUS-11, FA-AUS-13; TK 7.2 „Auswertung“):
 * `GET /web/v1/reports/projects?from=&to=&status=&rigId=&type=` (`project.read`) – freigegebene Projekte
 * (Sichtbarkeit wie die Projektliste, FA-BER-02) mit Filter-Summen, Verlauf je Nacht, Sessions und
 * Kanalbalance. `from`/`to` sind Nacht-Schlüssel (NT-04); CSV und Druckansicht erzeugt der Browser.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { projectReportRows } from '@nina-pm/db';
import {
  can,
  ProblemError,
  ProjectReport,
  ProjectReportQuery,
  projectReport,
} from '@nina-pm/shared';
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

export const REPORT_ROUTES = [projectReportRoute] as const;

export function webReportRoutes(services: () => Promise<ApiServices>) {
  return new OpenAPIHono<ApiEnv>().openapi(projectReportRoute, async (c) => {
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
