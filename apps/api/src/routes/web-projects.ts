/**
 * Projekte (AP-11a; TK 7.2 „Projekte“, „Projektstatus & Priorität“, „Verlauf“, „Notizen“; FA-PRJ-01…22):
 * CRUD für Projekte, Panels und Zeilen, Vorlage anwenden, Duplizieren, Status, Priorität je Rig,
 * Favoriten, Notizen, Verlauf, Rig-Wechsel-Prüfung und Papierkorb. Die Routen-Aktion prüft die Rolle;
 * die Entscheidung mit dem geladenen Objekt (eigene Entwürfe, Freigabestatus) fällt im Handler mit `can`.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { ProjectDetail, ProjectRepository } from '@nina-pm/db';
import {
  ApplyTemplate,
  can,
  EffortDetail,
  EffortView,
  HistoryEntry,
  LineCreate,
  lineCounters,
  LineDuplicate,
  LinePatch,
  NoteCreate,
  NoteView,
  PanelCreate,
  PanelPatch,
  PriorityChange,
  ProblemError,
  ProjectCreate,
  ProjectDuplicate,
  ProjectListItem,
  ProjectListQuery,
  ProjectPatch,
  projectProgress,
  ProjectView,
  RigCheckView,
  StatusChange,
  Uuid,
  type Action,
  type AuthContext,
  type ProjectStatus,
} from '@nina-pm/shared';
import type { Context } from 'hono';
import type { ApiEnv } from '../lib/env';
import { isoUtc, isoUtcOrNull } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { scheduleEffort } from './effort-trigger';
import { requireTenant } from './tenant';

const BASE = '/api/web/v1';
const idParam = z.object({ id: Uuid });
const panelParam = z.object({ id: Uuid, panelId: Uuid });
const lineParam = z.object({ id: Uuid, lineId: Uuid });
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const errors = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
  404: problemContent('resource.not_found'),
  422: problemContent('validation.failed'),
};
const ifMatch = z.object({
  'if-match': z
    .string()
    .optional()
    .meta({ description: '`version` des Projekts; abweichend → 412' }),
});

// ---- Ansicht --------------------------------------------------------------------------------------

/**
 * Gespeichertes Aufwand-Kennzeichen (`project.effort_*`, AP-13e) als `EffortView`; `null`, solange der
 * Job noch nie gerechnet hat. Ein unlesbares `effort_detail` (ältere Engine) gilt als nicht berechnet.
 */
export function effortView(p: {
  effortTag: string | null;
  effortNights: number | null;
  effortDetail: unknown;
  effortComputedAt: Date | string | null;
}): EffortView | null {
  if (p.effortComputedAt === null) return null;
  const detail = EffortDetail.safeParse(
    typeof p.effortDetail === 'string' ? JSON.parse(p.effortDetail) : p.effortDetail,
  );
  if (!detail.success) return null;
  const tag = EffortView.shape.tag.safeParse(p.effortTag);
  return {
    ...detail.data,
    tag: tag.success ? tag.data : null,
    nights: p.effortNights,
    computedAt: isoUtc(new Date(p.effortComputedAt)),
  };
}

export function projectView(d: ProjectDetail): z.output<typeof ProjectView> {
  const p = d.project;
  const allLines = d.panels.flatMap((panel) => panel.lines);
  const progress = projectProgress(allLines, d.overshootPct);
  const active = allLines.filter((l) => l.enabled);
  return {
    id: p.id,
    name: p.name,
    projectType: p.projectType,
    rigId: p.rigId ?? p.requestedRigId,
    createdBy: p.createdBy,
    targetName: p.targetName,
    targetType: p.targetType,
    dsoObjectId: p.dsoObjectId,
    catalogNames: p.catalogNames,
    descriptionMd: p.descriptionMd,
    raDeg: p.raDeg,
    decDeg: p.decDeg,
    rotationDeg: p.rotationDeg,
    startDate: p.startDate,
    dueDate: p.dueDate,
    requestPeriodFrom: p.requestPeriodFrom,
    requestPeriodTo: p.requestPeriodTo,
    requestComment: p.requestComment,
    conditions: {
      minAltitudeDeg: p.minAltitudeDeg,
      minTimeOnTargetH: p.minTimeOnTargetH,
      twilight: p.twilight as 'astronomical' | 'nautical' | 'civil',
      moonAvoidanceEnabled: p.moonAvoidanceEnabled,
      moonMustBeDown: p.moonMustBeDown,
      moonSeparationDeg: p.moonSeparationDeg,
      moonWidthDays: p.moonWidthDays,
      moonRelaxScale: p.moonRelaxScale,
      moonMinAltDeg: p.moonMinAltDeg,
      moonMaxAltDeg: p.moonMaxAltDeg,
      moonMaxIlluminationPct: p.moonMaxIlluminationPct,
    },
    approvalStatus: p.approvalStatus as z.output<typeof ProjectView>['approvalStatus'],
    status: p.status as ProjectStatus | null,
    priority: p.priority,
    effortStale: p.effortStale,
    effort: effortView(p),
    favorite: d.favorite,
    version: p.version,
    deletedAt: isoUtcOrNull(p.deletedAt),
    createdAt: isoUtc(p.createdAt),
    updatedAt: isoUtc(p.updatedAt),
    progress: {
      ...progress,
      plannedS: active.reduce((s, l) => s + l.plannedCount * l.exposureS, 0),
      integrationS: allLines.reduce((s, l) => s + l.integrationS, 0),
    },
    panels: d.panels.map((panel) => ({
      id: panel.id,
      panelIndex: panel.panelIndex,
      label: panel.label,
      raDeg: panel.raDeg,
      decDeg: panel.decDeg,
      rotationDeg: panel.rotationDeg,
      notes: panel.notes,
      lines: panel.lines.map((l) => ({
        id: l.id,
        panelId: l.panelId,
        filterId: l.filterId,
        filterShortName: l.filterShortName,
        exposureS: l.exposureS,
        plannedCount: l.plannedCount,
        gain: l.gain,
        offsetAdu: l.offsetAdu,
        binning: l.binning,
        readoutMode: l.readoutMode,
        moonMode: l.moonMode as 'profile' | 'project_default' | 'none',
        moonProfileId: l.moonProfileId,
        enabled: l.enabled,
        orderIndex: l.orderIndex,
        notes: l.notes,
        hasCaptures: l.hasCaptures,
        counters: { ...lineCounters(l, d.overshootPct), integrationS: l.integrationS },
      })),
    })),
  };
}

/** Plan je Filter über alle aktiven, nicht gelöschten Zeilen (Reihenfolge wie im Plan). */
export function filterPlanSummary(d: ProjectDetail) {
  const out = new Map<
    string,
    {
      filterId: string | null;
      filterShortName: string;
      exposureS: number;
      planned: number;
      accepted: number;
      lines: number;
    }
  >();
  for (const panel of d.panels)
    for (const l of panel.lines) {
      if (!l.enabled) continue;
      const key = l.filterId ?? l.filterShortName;
      const c = lineCounters(l, d.overshootPct);
      const prev = out.get(key);
      out.set(key, {
        filterId: l.filterId,
        filterShortName: l.filterShortName,
        exposureS: prev?.exposureS ?? l.exposureS,
        planned: (prev?.planned ?? 0) + c.planned,
        accepted: (prev?.accepted ?? 0) + c.accepted,
        lines: (prev?.lines ?? 0) + 1,
      });
    }
  return [...out.values()];
}

export const listItem = (d: ProjectDetail & { createdByName: string }) => {
  const view: Partial<ReturnType<typeof projectView>> = projectView(d);
  delete view.panels;
  delete view.descriptionMd;
  return {
    ...(view as Omit<ReturnType<typeof projectView>, 'panels' | 'descriptionMd'>),
    createdByName: d.createdByName,
    panelCount: d.panels.length,
    filters: filterPlanSummary(d),
  };
};

// ---- Routen ---------------------------------------------------------------------------------------

export const listProjectsRoute = defineRoute(
  { action: 'project.read', requirements: ['FA-PRJ-14', 'FA-PRJ-19', 'FA-PRJ-15', 'FA-BER-02'] },
  {
    method: 'get',
    path: `${BASE}/projects`,
    summary:
      'Projektliste (Filter Status/Rig/Freigabe/eigene/Favoriten); `deleted=true` = Papierkorb (nur Admin)',
    tags: ['projects'],
    request: { query: ProjectListQuery },
    responses: {
      200: { description: 'Projekte', ...json(z.object({ items: z.array(ProjectListItem) })) },
      401: errors[401],
      403: errors[403],
    },
  },
);

export const createProjectRoute = defineRoute(
  { action: 'project.create', requirements: ['FA-PRJ-01', 'FA-PRJ-03', 'FA-PRJ-18', 'NT-04'] },
  {
    method: 'post',
    path: `${BASE}/projects`,
    summary: 'Projekt als Entwurf anlegen (Client-UUID; unvollständig erlaubt)',
    tags: ['projects'],
    request: { body: { ...json(ProjectCreate), required: true } },
    responses: { 201: { description: 'Angelegt', ...json(ProjectView) }, ...errors },
  },
);

export const getProjectRoute = defineRoute(
  { action: 'project.read', requirements: ['FA-PRJ-10', 'FA-PRJ-21', 'FK 8.4'] },
  {
    method: 'get',
    path: `${BASE}/projects/{id}`,
    summary: 'Projekt mit Panels, Zeilen und Zählern',
    tags: ['projects'],
    request: { params: idParam },
    responses: { 200: { description: 'Projekt', ...json(ProjectView) }, ...errors },
  },
);

export const patchProjectRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-PRJ-01', 'FA-PRJ-03', 'FA-RIG-12', 'TK 7.1'] },
  {
    method: 'patch',
    path: `${BASE}/projects/{id}`,
    summary: 'Projekt ändern (If-Match: version); Rig-Wechsel mit Konfliktprüfung',
    tags: ['projects'],
    request: { params: idParam, headers: ifMatch, body: { ...json(ProjectPatch), required: true } },
    responses: {
      200: { description: 'Geändert', ...json(ProjectView) },
      ...errors,
      409: problemContent('approval.rig_conflict, rig.change_has_captures'),
      412: problemContent('resource.version_conflict'),
    },
  },
);

export const deleteProjectRoute = defineRoute(
  { action: 'project.delete', requirements: ['FA-PRJ-15', 'E4'] },
  {
    method: 'delete',
    path: `${BASE}/projects/{id}`,
    summary: 'Projekt in den Papierkorb (immer weich)',
    tags: ['projects'],
    request: { params: idParam },
    responses: { 204: { description: 'Gelöscht' }, ...errors },
  },
);

export const restoreProjectRoute = defineRoute(
  { action: 'project.status', requirements: ['FA-PRJ-15', 'E4'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/restore`,
    summary: 'Projekt aus dem Papierkorb wiederherstellen (unveränderter Status)',
    tags: ['projects'],
    request: { params: idParam },
    responses: { 200: { description: 'Wiederhergestellt', ...json(ProjectView) }, ...errors },
  },
);

export const duplicateProjectRoute = defineRoute(
  { action: 'project.create', requirements: ['FA-PRJ-08', 'FA-RIG-12'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/duplicate`,
    summary: 'Projekt als neuen Entwurf duplizieren (Zähler 0)',
    tags: ['projects'],
    request: { params: idParam, body: { ...json(ProjectDuplicate), required: true } },
    responses: { 201: { description: 'Dupliziert', ...json(ProjectView) }, ...errors },
  },
);

export const addPanelRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-PRJ-06'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/panels`,
    summary: 'Panel hinzufügen',
    tags: ['projects'],
    request: { params: idParam, body: { ...json(PanelCreate), required: true } },
    responses: { 201: { description: 'Angelegt', ...json(ProjectView) }, ...errors },
  },
);

export const patchPanelRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-PRJ-06'] },
  {
    method: 'patch',
    path: `${BASE}/projects/{id}/panels/{panelId}`,
    summary: 'Panel ändern (Koordinaten, Rotation, Bezeichnung)',
    tags: ['projects'],
    request: { params: panelParam, body: { ...json(PanelPatch), required: true } },
    responses: { 200: { description: 'Geändert', ...json(ProjectView) }, ...errors },
  },
);

const deleted = z.object({ soft: z.boolean() });

export const deletePanelRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-PRJ-06', 'E4'] },
  {
    method: 'delete',
    path: `${BASE}/projects/{id}/panels/{panelId}`,
    summary: 'Panel löschen (mit Aufnahmen weich, sonst endgültig)',
    tags: ['projects'],
    request: { params: panelParam },
    responses: { 200: { description: 'Gelöscht', ...json(deleted) }, ...errors },
  },
);

export const addLineRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-PRJ-05', 'FA-PRJ-20', 'FA-PRJ-22', 'NT-38'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/lines`,
    summary: 'Belichtungszeile hinzufügen',
    tags: ['projects'],
    request: { params: idParam, body: { ...json(LineCreate), required: true } },
    responses: { 201: { description: 'Angelegt', ...json(ProjectView) }, ...errors },
  },
);

export const patchLineRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-PRJ-05', 'FA-PRJ-07', 'NT-E3'] },
  {
    method: 'patch',
    path: `${BASE}/projects/{id}/lines/{lineId}`,
    summary: 'Zeile ändern (mit Aufnahmen: nur geplant, Mondprofil, aktiv)',
    tags: ['projects'],
    request: { params: lineParam, body: { ...json(LinePatch), required: true } },
    responses: {
      200: { description: 'Geändert', ...json(ProjectView) },
      ...errors,
      409: problemContent('line.locked_by_captures'),
    },
  },
);

export const deleteLineRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-PRJ-07', 'E4'] },
  {
    method: 'delete',
    path: `${BASE}/projects/{id}/lines/{lineId}`,
    summary: 'Zeile löschen (mit Aufnahmen weich, sonst endgültig)',
    tags: ['projects'],
    request: { params: lineParam },
    responses: { 200: { description: 'Gelöscht', ...json(deleted) }, ...errors },
  },
);

export const duplicateLineRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-PRJ-05', 'NT-E3'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/lines/{lineId}/duplicate`,
    summary: 'Zeile duplizieren (Zähler 0; alte optional deaktivieren)',
    tags: ['projects'],
    request: { params: lineParam, body: { ...json(LineDuplicate), required: true } },
    responses: { 201: { description: 'Dupliziert', ...json(ProjectView) }, ...errors },
  },
);

export const applyTemplateRoute = defineRoute(
  { action: 'project.update', requirements: ['FA-BPL-04', 'FA-BPL-05', 'FA-PRJ-05'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/apply-template`,
    summary: 'Belichtungsvorlage anwenden (nur ohne Aufnahmen)',
    tags: ['projects'],
    request: { params: idParam, body: { ...json(ApplyTemplate), required: true } },
    responses: {
      200: { description: 'Angewendet', ...json(ProjectView) },
      ...errors,
      409: problemContent('line.locked_by_captures'),
    },
  },
);

export const statusRoute = defineRoute(
  { action: 'project.status', requirements: ['FA-PRJ-11', 'FA-PRJ-12', 'FA-PRJ-01'] },
  {
    method: 'put',
    path: `${BASE}/projects/{id}/status`,
    summary: 'Projektstatus ändern (projectStatusTransitions; Aktivieren prüft Vollständigkeit)',
    tags: ['projects'],
    request: { params: idParam, body: { ...json(StatusChange), required: true } },
    responses: {
      200: { description: 'Geändert', ...json(ProjectView) },
      ...errors,
      409: problemContent('project.status_transition_invalid'),
      422: problemContent('approval.incomplete'),
    },
  },
);

export const priorityRoute = defineRoute(
  { action: 'project.status', requirements: ['FA-PRJ-13'] },
  {
    method: 'put',
    path: `${BASE}/projects/{id}/priority`,
    summary: 'Priorität im Rig (1 = höchste); die übrigen Projekte des Rigs rücken nach',
    tags: ['projects'],
    request: { params: idParam, body: { ...json(PriorityChange), required: true } },
    responses: {
      200: { description: 'Neue Reihenfolge', ...json(z.object({ order: z.array(Uuid) })) },
      ...errors,
      409: problemContent('project.status_transition_invalid'),
    },
  },
);

const favoriteParam = z.object({ projectId: Uuid });

export const addFavoriteRoute = defineRoute(
  { action: 'me.favorites', requirements: ['FA-PRJ-16'] },
  {
    method: 'put',
    path: `${BASE}/me/favorites/{projectId}`,
    summary: 'Projekt als Favorit markieren',
    tags: ['projects'],
    request: { params: favoriteParam },
    responses: { 204: { description: 'Markiert' }, ...errors },
  },
);

export const removeFavoriteRoute = defineRoute(
  { action: 'me.favorites', requirements: ['FA-PRJ-16'] },
  {
    method: 'delete',
    path: `${BASE}/me/favorites/{projectId}`,
    summary: 'Favorit entfernen',
    tags: ['projects'],
    request: { params: favoriteParam },
    responses: { 204: { description: 'Entfernt' }, ...errors },
  },
);

export const listNotesRoute = defineRoute(
  { action: 'project.read', requirements: ['FA-PRJ-17'] },
  {
    method: 'get',
    path: `${BASE}/projects/{id}/notes`,
    summary: 'Notizverlauf des Projekts',
    tags: ['projects'],
    request: { params: idParam },
    responses: {
      200: { description: 'Notizen', ...json(z.object({ items: z.array(NoteView) })) },
      ...errors,
    },
  },
);

export const addNoteRoute = defineRoute(
  { action: 'project.note.write', requirements: ['FA-PRJ-17'] },
  {
    method: 'post',
    path: `${BASE}/projects/{id}/notes`,
    summary: 'Notiz hinzufügen (Markdown)',
    tags: ['projects'],
    request: { params: idParam, body: { ...json(NoteCreate), required: true } },
    responses: { 201: { description: 'Angelegt', ...json(NoteView) }, ...errors },
  },
);

export const historyRoute = defineRoute(
  { action: 'project.history.read', requirements: ['FA-BER-03', 'FA-FRG-12'] },
  {
    method: 'get',
    path: `${BASE}/projects/{id}/history`,
    summary: 'Freigabe- und Änderungsverlauf',
    tags: ['projects'],
    request: { params: idParam },
    responses: {
      200: { description: 'Verlauf', ...json(z.object({ items: z.array(HistoryEntry) })) },
      ...errors,
    },
  },
);

export const rigCompatibilityRoute = defineRoute(
  { action: 'project.read', requirements: ['FA-RIG-12'] },
  {
    method: 'post',
    path: `${BASE}/rigs/{id}/compatibility`,
    summary: 'Rig-Wechsel prüfen: Filterrad, Binning, Auslesemodus, Bildfeld, Optik mit Aufnahmen',
    tags: ['projects'],
    request: {
      params: idParam,
      body: { ...json(z.object({ projectId: Uuid }).strict()), required: true },
    },
    responses: { 200: { description: 'Konflikte', ...json(RigCheckView) }, ...errors },
  },
);

export const PROJECT_ROUTES = [
  listProjectsRoute,
  createProjectRoute,
  getProjectRoute,
  patchProjectRoute,
  deleteProjectRoute,
  restoreProjectRoute,
  duplicateProjectRoute,
  addPanelRoute,
  patchPanelRoute,
  deletePanelRoute,
  addLineRoute,
  patchLineRoute,
  deleteLineRoute,
  duplicateLineRoute,
  applyTemplateRoute,
  statusRoute,
  priorityRoute,
  addFavoriteRoute,
  removeFavoriteRoute,
  listNotesRoute,
  addNoteRoute,
  historyRoute,
  rigCompatibilityRoute,
] as const;

// ---- Handler --------------------------------------------------------------------------------------

function expectedVersion(header: string | undefined): number | undefined {
  if (header === undefined) return undefined;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  if (!m) throw new ProblemError('resource.version_conflict');
  return Number(m[1]);
}

export function webProjectRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  const ctx = async (c: Context<ApiEnv>) => {
    const svc = await services();
    const { auth, tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    /** Aufwand-Kennzeichen neu rechnen (Job `effort`, AP-13e). */
    const effort = (projectId: string) => scheduleEffort(svc, repos, projectId);
    return { svc, auth, repo: repos.projects(), effort };
  };

  /**
   * Objekt laden und die Aktion mit dem Objekt prüfen (TK 5.5): fremde bzw. gelöschte Projekte sind
   * `404`, fehlendes Recht am Objekt `403 permission.denied`.
   */
  const authorized = async (
    repo: ProjectRepository,
    auth: AuthContext,
    id: string,
    action: Action,
    includeDeleted = false,
  ) => {
    const meta = await repo.meta(id, includeDeleted);
    if (!meta) throw new ProblemError('resource.not_found');
    const res = {
      tenantId: auth.tenantId ?? undefined,
      createdBy: meta.createdBy,
      approvalStatus: meta.approvalStatus as never,
    };
    if (!can(auth, action, res)) throw new ProblemError('permission.denied');
    return meta;
  };

  const view = async (repo: ProjectRepository, id: string) => {
    const d = await repo.detail(id);
    if (!d) throw new ProblemError('resource.not_found');
    return projectView(d);
  };

  app.openapi(listProjectsRoute, async (c) => {
    const { repo, auth } = await ctx(c);
    const q = c.req.valid('query');
    const deletedView = q.deleted === 'true';
    if (deletedView && !can(auth, 'project.status')) throw new ProblemError('permission.denied');
    const items = await repo.list({
      admin: can(auth, 'project.status'),
      deleted: deletedView,
      ...(q.rigId ? { rigId: q.rigId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.approvalStatus ? { approvalStatus: q.approvalStatus } : {}),
      mine: q.mine === 'true',
      favorites: q.favorites === 'true',
    });
    c.header('cache-control', 'no-store');
    return c.json({ items: items.map(listItem) }, 200);
  });

  app.openapi(createProjectRoute, async (c) => {
    const { repo, svc, effort } = await ctx(c);
    const d = await repo.create(c.req.valid('json'), svc.now());
    await effort(d.project.id);
    return c.json(projectView(d), 201);
  });

  app.openapi(getProjectRoute, async (c) => {
    const { repo, auth } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.read');
    c.header('cache-control', 'no-store');
    const v = await view(repo, id);
    c.header('etag', `"${String(v.version)}"`);
    return c.json(v, 200);
  });

  app.openapi(patchProjectRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const body = c.req.valid('json');
    const d = await repo.patch(
      id,
      body,
      svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    await effort(id);
    c.header('etag', `"${String(d.project.version)}"`);
    return c.json(projectView(d), 200);
  });

  app.openapi(deleteProjectRoute, async (c) => {
    const { repo, auth, svc } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.delete');
    await repo.softDelete(id, svc.now());
    return c.body(null, 204);
  });

  app.openapi(restoreProjectRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.status', true);
    const result = projectView(await repo.restore(id, svc.now()));
    await effort(id);
    return c.json(result, 200);
  });

  app.openapi(duplicateProjectRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.read');
    const d = await repo.duplicate(id, c.req.valid('json'), svc.now());
    await effort(d.project.id);
    return c.json(projectView(d), 201);
  });

  app.openapi(addPanelRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const result = projectView(await repo.addPanel(id, c.req.valid('json'), svc.now()));
    await effort(id);
    return c.json(result, 201);
  });

  app.openapi(patchPanelRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id, panelId } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const result = projectView(await repo.patchPanel(id, panelId, c.req.valid('json'), svc.now()));
    await effort(id);
    return c.json(result, 200);
  });

  app.openapi(deletePanelRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id, panelId } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const result = await repo.deletePanel(id, panelId, svc.now());
    await effort(id);
    return c.json(result, 200);
  });

  app.openapi(addLineRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const result = projectView(await repo.addLine(id, c.req.valid('json'), svc.now()));
    await effort(id);
    return c.json(result, 201);
  });

  app.openapi(patchLineRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id, lineId } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const result = projectView(await repo.patchLine(id, lineId, c.req.valid('json'), svc.now()));
    await effort(id);
    return c.json(result, 200);
  });

  app.openapi(deleteLineRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id, lineId } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const result = await repo.deleteLine(id, lineId, svc.now());
    await effort(id);
    return c.json(result, 200);
  });

  app.openapi(duplicateLineRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id, lineId } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const result = projectView(
      await repo.duplicateLine(id, lineId, c.req.valid('json'), svc.now()),
    );
    await effort(id);
    return c.json(result, 201);
  });

  app.openapi(applyTemplateRoute, async (c) => {
    const { repo, auth, svc, effort } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.update');
    const result = projectView(await repo.applyTemplate(id, c.req.valid('json'), svc.now()));
    await effort(id);
    return c.json(result, 200);
  });

  app.openapi(statusRoute, async (c) => {
    const { repo, auth, svc } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.status');
    return c.json(
      projectView(await repo.setStatus(id, c.req.valid('json').status, svc.now())),
      200,
    );
  });

  app.openapi(priorityRoute, async (c) => {
    const { repo, auth, svc } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.status');
    return c.json(await repo.setPriority(id, c.req.valid('json').position, svc.now()), 200);
  });

  app.openapi(addFavoriteRoute, async (c) => {
    const { repo, auth, svc } = await ctx(c);
    const { projectId } = c.req.valid('param');
    await authorized(repo, auth, projectId, 'project.read');
    await repo.setFavorite(projectId, true, svc.now());
    return c.body(null, 204);
  });

  app.openapi(removeFavoriteRoute, async (c) => {
    const { repo, auth, svc } = await ctx(c);
    const { projectId } = c.req.valid('param');
    await authorized(repo, auth, projectId, 'project.read');
    await repo.setFavorite(projectId, false, svc.now());
    return c.body(null, 204);
  });

  app.openapi(listNotesRoute, async (c) => {
    const { repo, auth } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.read');
    const notes = await repo.notes(id);
    return c.json({ items: notes.map((n) => ({ ...n, createdAt: isoUtc(n.createdAt) })) }, 200);
  });

  app.openapi(addNoteRoute, async (c) => {
    const { repo, auth, svc } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.note.write');
    const note = await repo.addNote(id, c.req.valid('json').bodyMd, svc.now());
    const [created] = (await repo.notes(id)).filter((n) => n.id === note.id);
    if (!created) throw new ProblemError('resource.not_found');
    return c.json({ ...created, createdAt: isoUtc(created.createdAt) }, 201);
  });

  app.openapi(historyRoute, async (c) => {
    const { repo, auth } = await ctx(c);
    const { id } = c.req.valid('param');
    await authorized(repo, auth, id, 'project.history.read');
    const items = await repo.history(id);
    return c.json({ items: items.map((h) => ({ ...h, createdAt: isoUtc(h.createdAt) })) }, 200);
  });

  app.openapi(rigCompatibilityRoute, async (c) => {
    const { repo, auth } = await ctx(c);
    const { id } = c.req.valid('param');
    const { projectId } = c.req.valid('json');
    await authorized(repo, auth, projectId, 'project.read');
    return c.json(await repo.rigCheck(projectId, id), 200);
  });

  return app;
}
