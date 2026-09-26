/**
 * Änderungsanträge (AP-32b; FA-FRG-08; TK 7.2 „Änderungsanträge“):
 * - `POST /web/v1/projects/{id}/change-requests` (`changeRequest.create`, Objekt = Projekt: Admin oder
 *   Ersteller eines freigegebenen Projekts) → `201`.
 * - `GET /web/v1/projects/{id}/change-requests` (`project.read`): alle Anträge des Projekts.
 * - `GET /web/v1/change-requests/{id}` (`queue.read`).
 * - `PATCH /web/v1/change-requests/{id}` (`changeRequest.update`, Objekt = Antrag: Admin oder Antragsteller,
 *   solange offen) mit `If-Match` (Version des Antrags) → 412.
 * - `POST /web/v1/change-requests/{id}/withdraw` (`changeRequest.update`; nur der Antragsteller).
 * - `POST /web/v1/change-requests/{id}/decide` (`queue.decide`) mit `If-Match` und der gesehenen
 *   Projektversion → `409 change_request.conflict`, wenn sich das Projekt inzwischen geändert hat.
 * Jede Antwort enthält die Gegenüberstellung gegen die **aktuelle** Fassung des Projekts.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { ChangeRequestRecord } from '@nina-pm/db';
import {
  can,
  ChangeRequestDecision,
  ChangeRequestInput,
  ChangeRequestList,
  ChangeRequestUpdate,
  ChangeRequestView,
  changeRequestDiff,
  ProblemError,
  Uuid,
  type ProjectView,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';
import { scheduleProjectJobs } from './effort-trigger';
import { expectedVersion } from './web-approval';
import { projectView } from './web-projects';

const BASE = '/api/web/v1';
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const idParam = z.object({ id: Uuid });
const ifMatch = z.object({
  'if-match': z
    .string()
    .optional()
    .meta({ description: '`version` des Antrags; abweichend → 412' }),
});
const errors = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
  404: problemContent('resource.not_found'),
  422: problemContent('validation.failed'),
};

type View = z.output<typeof ChangeRequestView>;

/** Ansicht eines Antrags mit Gegenüberstellung gegen die aktuelle Fassung des Projekts. */
export function changeRequestView(
  r: ChangeRequestRecord,
  current: z.output<typeof ProjectView>,
): View {
  return {
    id: r.row.id,
    projectId: r.row.projectId,
    projectName: r.projectName,
    requestedBy: r.row.requestedBy,
    requestedByName: r.requestedByName,
    version: r.row.version,
    status: r.row.status,
    proposal: r.proposal,
    comment: r.comment,
    baseVersion: r.row.baseVersion,
    projectVersion: current.version,
    projectChangedSince: current.version !== r.row.baseVersion,
    diff: changeRequestDiff(current, r.proposal),
    createdAt: isoUtc(new Date(r.row.createdAt)),
    updatedAt: isoUtc(new Date(r.row.updatedAt)),
    decidedAt: isoUtcOrNull(r.row.decidedAt),
    decidedByName: r.decidedByName,
    decisionComment: r.row.decisionComment,
  };
}

export const createChangeRequestRoute = defineRoute(
  { action: 'changeRequest.create', requirements: ['FA-FRG-08'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/change-requests`,
    summary: 'Änderungsantrag für ein freigegebenes Projekt stellen',
    tags: ['approval'],
    request: { params: idParam, body: { ...json(ChangeRequestInput), required: true } },
    responses: {
      201: { description: 'Gestellt', ...json(ChangeRequestView) },
      ...errors,
      409: problemContent('approval.not_allowed'),
    },
  },
);

export const listChangeRequestsRoute = defineRoute(
  { action: 'project.read', requirements: ['FA-FRG-08', 'FA-FRG-12'] },
  {
    method: 'get',
    path: `${BASE}/projects/{id}/change-requests`,
    summary: 'Änderungsanträge eines Projekts',
    tags: ['approval'],
    request: { params: idParam },
    responses: { 200: { description: 'Anträge', ...json(ChangeRequestList) }, ...errors },
  },
);

export const getChangeRequestRoute = defineRoute(
  { action: 'queue.read', requirements: ['FA-FRG-08'] },
  {
    method: 'get',
    path: `${BASE}/change-requests/{id}`,
    summary: 'Änderungsantrag mit Gegenüberstellung',
    tags: ['approval'],
    request: { params: idParam },
    responses: { 200: { description: 'Antrag', ...json(ChangeRequestView) }, ...errors },
  },
);

export const updateChangeRequestRoute = defineRoute(
  { action: 'changeRequest.update', requirements: ['FA-FRG-08', 'FA-FRG-14'] },
  {
    method: 'patch',
    path: `${BASE}/change-requests/{id}`,
    summary: 'Offenen Änderungsantrag bearbeiten',
    tags: ['approval'],
    request: {
      params: idParam,
      headers: ifMatch,
      body: { ...json(ChangeRequestUpdate), required: true },
    },
    responses: {
      200: { description: 'Gespeichert', ...json(ChangeRequestView) },
      ...errors,
      409: problemContent('change_request.not_open'),
      412: problemContent('resource.version_conflict'),
    },
  },
);

export const withdrawChangeRequestRoute = defineRoute(
  { action: 'changeRequest.update', requirements: ['FA-FRG-08'] },
  {
    method: 'post',
    path: `${BASE}/change-requests/{id}/withdraw`,
    summary: 'Änderungsantrag zurückziehen (Antragsteller)',
    tags: ['approval'],
    request: { params: idParam, headers: ifMatch },
    responses: {
      200: { description: 'Zurückgezogen', ...json(ChangeRequestView) },
      ...errors,
      409: problemContent('change_request.not_open'),
      412: problemContent('resource.version_conflict'),
    },
  },
);

export const decideChangeRequestRoute = defineRoute(
  { action: 'queue.decide', requirements: ['FA-FRG-08', 'FA-FRG-10'] },
  {
    method: 'post',
    path: `${BASE}/change-requests/{id}/decide`,
    summary: 'Änderungsantrag annehmen oder ablehnen',
    tags: ['approval'],
    request: {
      params: idParam,
      headers: ifMatch,
      body: { ...json(ChangeRequestDecision), required: true },
    },
    responses: {
      200: { description: 'Entschieden', ...json(ChangeRequestView) },
      ...errors,
      409: problemContent(
        'change_request.conflict / change_request.not_open / approval.own_object',
      ),
      412: problemContent('resource.version_conflict'),
    },
  },
);

export const CHANGE_REQUEST_ROUTES = [
  createChangeRequestRoute,
  listChangeRequestsRoute,
  getChangeRequestRoute,
  updateChangeRequestRoute,
  withdrawChangeRequestRoute,
  decideChangeRequestRoute,
] as const;

export function webChangeRequestRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  const ctx = async (c: Parameters<typeof requireTenant>[0]) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    return { svc, auth, repos, projects: repos.projects(), requests: repos.changeRequests() };
  };
  type Ctx = Awaited<ReturnType<typeof ctx>>;
  const current = async (x: Ctx, projectId: string) => {
    const d = await x.projects.detail(projectId);
    if (!d) throw new ProblemError('resource.not_found');
    return projectView(d);
  };
  const view = async (x: Ctx, r: ChangeRequestRecord) =>
    changeRequestView(r, await current(x, r.row.projectId));
  /** Antrag laden und `changeRequest.update` mit dem Antrag prüfen (Antragsteller solange offen, Admin). */
  const editable = async (x: Ctx, id: string) => {
    const r = await x.requests.byId(id);
    const res = {
      tenantId: x.auth.tenantId ?? undefined,
      createdBy: r.row.requestedBy,
      status: r.row.status,
    };
    if (!can(x.auth, 'changeRequest.update', res as never))
      throw new ProblemError('permission.denied');
    return r;
  };

  app.openapi(createChangeRequestRoute, async (c) => {
    const x = await ctx(c);
    const id = c.req.valid('param').id;
    const meta = await x.projects.meta(id);
    if (!meta) throw new ProblemError('resource.not_found');
    const res = {
      tenantId: x.auth.tenantId ?? undefined,
      createdBy: meta.createdBy,
      approvalStatus: meta.approvalStatus as never,
    };
    if (!can(x.auth, 'changeRequest.create', res)) throw new ProblemError('permission.denied');
    const body = c.req.valid('json');
    const r = await x.requests.create(
      id,
      { id: body.id, proposal: body.proposal, comment: body.comment },
      x.svc.now(),
    );
    c.header('etag', `"${String(r.row.version)}"`);
    return c.json(await view(x, r), 201);
  });

  app.openapi(listChangeRequestsRoute, async (c) => {
    const x = await ctx(c);
    const id = c.req.valid('param').id;
    const meta = await x.projects.meta(id);
    if (!meta) throw new ProblemError('resource.not_found');
    const res = {
      tenantId: x.auth.tenantId ?? undefined,
      createdBy: meta.createdBy,
      approvalStatus: meta.approvalStatus as never,
    };
    if (!can(x.auth, 'project.read', res)) throw new ProblemError('resource.not_found');
    const [items, now] = await Promise.all([x.requests.forProject(id), current(x, id)]);
    c.header('cache-control', 'no-store');
    return c.json({ items: items.map((r) => changeRequestView(r, now)) }, 200);
  });

  app.openapi(getChangeRequestRoute, async (c) => {
    const x = await ctx(c);
    const r = await x.requests.byId(c.req.valid('param').id);
    c.header('cache-control', 'no-store');
    c.header('etag', `"${String(r.row.version)}"`);
    return c.json(await view(x, r), 200);
  });

  app.openapi(updateChangeRequestRoute, async (c) => {
    const x = await ctx(c);
    const id = c.req.valid('param').id;
    await editable(x, id);
    const body = c.req.valid('json');
    const r = await x.requests.update(
      id,
      { proposal: body.proposal, comment: body.comment },
      x.svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    c.header('etag', `"${String(r.row.version)}"`);
    return c.json(await view(x, r), 200);
  });

  app.openapi(withdrawChangeRequestRoute, async (c) => {
    const x = await ctx(c);
    const id = c.req.valid('param').id;
    await editable(x, id);
    const r = await x.requests.withdraw(
      id,
      x.svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    return c.json(await view(x, r), 200);
  });

  app.openapi(decideChangeRequestRoute, async (c) => {
    const x = await ctx(c);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const r = await x.requests.decide(
      id,
      { decision: body.decision, comment: body.comment, projectVersion: body.projectVersion },
      x.svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    // Angenommen: Aufwand-Kennzeichen neu rechnen (wie nach jeder Planänderung, AP-13e).
    if (r.row.status === 'approved') await scheduleProjectJobs(x.svc, x.repos, r.row.projectId);
    return c.json(await view(x, r), 200);
  });

  return app;
}
