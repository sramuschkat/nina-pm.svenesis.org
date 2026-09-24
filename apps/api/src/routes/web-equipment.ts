/**
 * Ausrüstung (AP-09a; TK 7.2; FA-STO, FA-TEL, FA-KAM, FA-FIL, FA-BPL, FA-MON, FA-RIG-01…14, NT-02):
 * CRUD für Standorte, Standort-Links, Teleskope, Kameras, Filter, Mondprofile, Belichtungsvorlagen und
 * Rigs (lesen `equipment.read`, schreiben `equipment.write`), Scheduler-Einstellungen und
 * Filterradbelegung (`rig.settings.write`, nur Admin/Owner) sowie die Nacht-Tabelle je Standort
 * (`project.read`). Anlage mit Client-UUID; Löschen in Verwendung → `409 resource.in_use`.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import type {
  CameraRow,
  EquipmentRepository,
  MoonProfileRow,
  RigRow,
  TelescopeRow,
  TemplateRow,
} from '@nina-pm/db';
import {
  CameraCreate,
  CameraInput,
  CameraView,
  ExposureTemplateCreate,
  ExposureTemplateInput,
  ExposureTemplateView,
  FilterCreate,
  FilterInput,
  FilterView,
  FilterWheelPut,
  FilterWheelView,
  imageScale,
  MoonProfileCreate,
  MoonProfileInput,
  MoonProfileView,
  NightsQuery,
  ProblemError,
  RigCreate,
  RigInput,
  RigView,
  SchedulerSettings,
  SiteCreate,
  SiteInput,
  SiteLinkCreate,
  SiteLinkInput,
  SiteLinkView,
  SiteNightsView,
  SiteView,
  TelescopeCreate,
  TelescopeInput,
  TelescopeView,
  Uuid,
} from '@nina-pm/shared';
import type { Context } from 'hono';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { siteNights } from '../lib/night-table';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const BASE = '/api/web/v1';
const idParam = z.object({ id: Uuid });
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const read = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
};
const write = {
  ...read,
  404: problemContent('resource.not_found'),
  422: problemContent('validation.failed'),
};

// ---- Ansichten ------------------------------------------------------------------------------------

/** Felder des Schemas aus der Zeile übernehmen; Zeitpunkte als ISO-UTC (rules/api.md). */
function pick<S extends z.ZodObject>(schema: S, row: object): z.output<S> {
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = source[key];
    out[key] = value instanceof Date ? isoUtc(value) : value;
  }
  return out as z.output<S>;
}

const cameraView = (row: CameraRow) => pick(CameraView, row);
const moonProfileView = (row: MoonProfileRow) => pick(MoonProfileView, row);
const telescopeView = (row: TelescopeRow) => pick(TelescopeView, row);

function templateView(row: TemplateRow): z.output<typeof ExposureTemplateView> {
  return {
    ...pick(ExposureTemplateView.omit({ lines: true }), row),
    lines: row.lines.map((l) => ({
      id: l.id,
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
    })),
  };
}

function rigView(
  row: RigRow,
  telescope: TelescopeRow | undefined,
  camera: CameraRow | undefined,
): z.output<typeof RigView> {
  const scale =
    telescope && camera
      ? imageScale({ ...telescope, ...camera })
      : { effFocalMm: 0, scaleArcsecPx: 0, fovWidthDeg: 0, fovHeightDeg: 0 };
  return {
    ...pick(RigInput, row),
    id: row.id,
    scheduler: pick(SchedulerSettings, row),
    filterWheel: row.filterWheel.map((s) => ({ ...s })),
    settingsVersion: row.settingsVersion,
    derived: {
      effFocalMm: scale.effFocalMm,
      scaleArcsecPx: scale.scaleArcsecPx,
      fovWidthDeg: scale.fovWidthDeg,
      fovHeightDeg: scale.fovHeightDeg,
    },
    createdAt: isoUtc(row.createdAt),
    updatedAt: isoUtc(row.updatedAt),
  };
}

// ---- Routen ---------------------------------------------------------------------------------------

const ifMatch = z.object({
  'if-match': z.string().optional().meta({
    description: '`settingsVersion` aus dem ETag; abweichend → 412 resource.version_conflict',
  }),
});

interface CrudSpec<P extends string> {
  readonly path: P;
  readonly tag: string;
  readonly noun: string;
  readonly requirements: readonly string[];
  readonly create: z.ZodType;
  readonly input: z.ZodType;
  readonly view: z.ZodType;
  readonly listQuery?: z.ZodObject;
  /** Zusätzliche Löschsperren-/Konfliktbeschreibung. */
  readonly conflicts?: string;
  /** Änderung mit `If-Match` (`settingsVersion`, nur Rigs) → sonst `412 resource.version_conflict`. */
  readonly versioned?: boolean;
}

function crudRoutes<P extends string>(spec: CrudSpec<P>) {
  const reqs = spec.requirements;
  const conflicts = problemContent(spec.conflicts ?? 'resource.in_use (Verwender in errors[])');
  return {
    list: defineRoute(
      { action: 'equipment.read', requirements: reqs },
      {
        method: 'get',
        path: `${BASE}${spec.path}`,
        summary: `${spec.noun}: Liste`,
        tags: [spec.tag],
        ...(spec.listQuery ? { request: { query: spec.listQuery } } : {}),
        responses: {
          200: { description: 'Liste', ...json(z.object({ items: z.array(spec.view) })) },
          ...read,
        },
      },
    ),
    get: defineRoute(
      { action: 'equipment.read', requirements: reqs },
      {
        method: 'get',
        path: `${BASE}${spec.path}/{id}`,
        summary: `${spec.noun}: lesen`,
        tags: [spec.tag],
        request: { params: idParam },
        responses: {
          200: { description: spec.noun, ...json(spec.view) },
          ...read,
          404: problemContent('resource.not_found'),
        },
      },
    ),
    create: defineRoute(
      { action: 'equipment.write', requirements: [...reqs, 'rules/api.md Idempotenz'] },
      {
        method: 'post',
        path: `${BASE}${spec.path}`,
        summary: `${spec.noun}: anlegen (Client-UUID; Wiederholung liefert das Objekt erneut)`,
        tags: [spec.tag],
        request: { body: { ...json(spec.create), required: true } },
        responses: { 201: { description: 'Angelegt', ...json(spec.view) }, ...write },
      },
    ),
    update: defineRoute(
      { action: 'equipment.write', requirements: reqs },
      {
        method: 'put',
        path: `${BASE}${spec.path}/{id}`,
        summary: `${spec.noun}: ändern`,
        tags: [spec.tag],
        request: {
          params: idParam,
          ...(spec.versioned ? { headers: ifMatch } : {}),
          body: { ...json(spec.input), required: true },
        },
        responses: {
          200: { description: 'Geändert', ...json(spec.view) },
          ...write,
          409: problemContent('resource.read_only (mitgelieferte Mondprofile)'),
          ...(spec.versioned ? { 412: problemContent('resource.version_conflict') } : {}),
        },
      },
    ),
    remove: defineRoute(
      { action: 'equipment.write', requirements: [...reqs, 'FA-RIG-13'] },
      {
        method: 'delete',
        path: `${BASE}${spec.path}/{id}`,
        summary: `${spec.noun}: löschen (gesperrt, solange verwendet)`,
        tags: [spec.tag],
        request: { params: idParam },
        responses: { 204: { description: 'Gelöscht' }, ...write, 409: conflicts },
      },
    ),
  };
}

const siteRoutes = crudRoutes({
  path: '/sites',
  tag: 'equipment',
  noun: 'Standort',
  requirements: ['FA-STO-01', 'FA-STO-04', 'FA-STO-06', 'TK 7.2'],
  create: SiteCreate,
  input: SiteInput,
  view: SiteView,
});
const siteLinkRoutes = crudRoutes({
  path: '/site-links',
  tag: 'equipment',
  noun: 'Standort-Link',
  requirements: ['FA-STO-05', 'TK 7.2'],
  create: SiteLinkCreate,
  input: SiteLinkInput,
  view: SiteLinkView,
  listQuery: z.object({ siteId: Uuid.optional() }),
});
const telescopeRoutes = crudRoutes({
  path: '/telescopes',
  tag: 'equipment',
  noun: 'Teleskop',
  requirements: ['FA-TEL-01', 'FA-TEL-02', 'TK 7.2'],
  create: TelescopeCreate,
  input: TelescopeInput,
  view: TelescopeView,
});
const cameraRoutes = crudRoutes({
  path: '/cameras',
  tag: 'equipment',
  noun: 'Kamera',
  requirements: ['FA-KAM-01…06', 'NT-E2', 'NT-38', 'TK 7.2'],
  create: CameraCreate,
  input: CameraInput,
  view: CameraView,
});
const filterRoutes = crudRoutes({
  path: '/filters',
  tag: 'equipment',
  noun: 'Filter',
  requirements: ['FA-FIL-01…05', 'NT-41', 'TK 7.2'],
  create: FilterCreate,
  input: FilterInput,
  view: FilterView,
});
const moonProfileRoutes = crudRoutes({
  path: '/moon-profiles',
  tag: 'equipment',
  noun: 'Mondprofil',
  requirements: ['FA-MON-01', 'FA-MON-02', 'moon.md §1', 'AST-M8', 'TK 7.2'],
  create: MoonProfileCreate,
  input: MoonProfileInput,
  view: MoonProfileView,
  conflicts: 'resource.in_use (Verwender in errors[]), resource.read_only (mitgeliefert)',
});
const templateRoutes = crudRoutes({
  path: '/exposure-templates',
  tag: 'equipment',
  noun: 'Belichtungsvorlage',
  requirements: ['FA-BPL-01', 'FA-BPL-02', 'NT-38', 'TK 7.2'],
  create: ExposureTemplateCreate,
  input: ExposureTemplateInput,
  view: ExposureTemplateView,
});
const rigRoutes = crudRoutes({
  path: '/rigs',
  tag: 'equipment',
  noun: 'Rig',
  requirements: ['FA-RIG-01…03', 'FA-RIG-05', 'FA-RIG-08…11', 'TK 7.2'],
  create: RigCreate,
  input: RigInput,
  view: RigView,
  versioned: true,
});

const versioned = {
  ...write,
  412: problemContent('resource.version_conflict'),
};

export const schedulerSettingsRoute = defineRoute(
  {
    action: 'rig.settings.write',
    requirements: ['FA-RIG-04', 'FA-SCH', 'sort-chain.md', 'flip-rotation.md §1'],
  },
  {
    method: 'put',
    path: `${BASE}/rigs/{id}/scheduler-settings`,
    summary: 'Scheduler-Einstellungen des Rigs (erhöht settingsVersion)',
    tags: ['equipment'],
    request: {
      params: idParam,
      headers: ifMatch,
      body: { ...json(SchedulerSettings), required: true },
    },
    responses: {
      200: { description: 'Geändert', ...json(RigView) },
      ...versioned,
      422: problemContent('validation.failed, rig.sort_chain_invalid, rig.flip_settings_invalid'),
    },
  },
);

export const getFilterWheelRoute = defineRoute(
  { action: 'equipment.read', requirements: ['FA-RIG-14', 'NT-E1'] },
  {
    method: 'get',
    path: `${BASE}/rigs/{id}/filter-wheel`,
    summary: 'Filterradbelegung mit NINA-Meldung und Vorschlägen',
    tags: ['equipment'],
    request: { params: idParam },
    responses: {
      200: { description: 'Belegung', ...json(FilterWheelView) },
      ...read,
      404: problemContent('resource.not_found'),
    },
  },
);

export const putFilterWheelRoute = defineRoute(
  { action: 'rig.settings.write', requirements: ['FA-RIG-14', 'NT-E1'] },
  {
    method: 'put',
    path: `${BASE}/rigs/{id}/filter-wheel`,
    summary: 'Filterradbelegung bestätigen (nur Admin/Owner; erhöht settingsVersion)',
    tags: ['equipment'],
    request: {
      params: idParam,
      headers: ifMatch,
      body: { ...json(FilterWheelPut), required: true },
    },
    responses: { 200: { description: 'Bestätigt', ...json(FilterWheelView) }, ...versioned },
  },
);

export const siteNightsRoute = defineRoute(
  { action: 'project.read', requirements: ['NT-02', 'NT-01', 'H1', 'night.md §1'] },
  {
    method: 'get',
    path: `${BASE}/sites/{id}/nights`,
    summary: 'Nacht-Tabelle des Standorts (ab from bzw. ab der Mittagsnacht, count ≤ 400)',
    tags: ['equipment'],
    request: { params: idParam, query: NightsQuery },
    responses: {
      200: { description: 'Nacht-Tabelle', ...json(SiteNightsView) },
      ...read,
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
    },
  },
);

const all = [
  siteRoutes,
  siteLinkRoutes,
  telescopeRoutes,
  cameraRoutes,
  filterRoutes,
  moonProfileRoutes,
  templateRoutes,
  rigRoutes,
];

export const EQUIPMENT_ROUTES = [
  ...all.flatMap((r) => [r.list, r.get, r.create, r.update, r.remove]),
  schedulerSettingsRoute,
  getFilterWheelRoute,
  putFilterWheelRoute,
  siteNightsRoute,
] as const;

// ---- Handler --------------------------------------------------------------------------------------

type Repo = EquipmentRepository;

interface CrudOps<Row> {
  list(repo: Repo, query: Record<string, string | undefined>): Promise<Row[]>;
  get(repo: Repo, id: string): Promise<Row | undefined>;
  create(repo: Repo, id: string, input: never, now: Date): Promise<Row>;
  update(repo: Repo, id: string, input: never, now: Date, version?: number): Promise<Row>;
  remove(repo: Repo, id: string, now: Date): Promise<void>;
  view(row: Row, repo: Repo): unknown;
}

/** `If-Match: "7"` bzw. `7` → 7; fehlt der Header, gilt keine Versionsprüfung. */
function expectedVersion(header: string | undefined): number | undefined {
  if (header === undefined) return undefined;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  if (!m) throw new ProblemError('resource.version_conflict');
  return Number(m[1]);
}

export function webEquipmentRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  const repoOf = async (c: Context<ApiEnv>) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    return { repo: svc.repositories(tenant).equipment(), svc };
  };

  const rigContext = async (repo: Repo) => {
    const [telescopes, cameras] = await Promise.all([repo.telescopes(), repo.cameras()]);
    return (row: RigRow) =>
      rigView(
        row,
        telescopes.find((t) => t.id === row.telescopeId),
        cameras.find((k) => k.id === row.cameraId),
      );
  };

  function mount<Row>(routes: ReturnType<typeof crudRoutes>, ops: CrudOps<Row>) {
    // Die Routen-Typen sind je Objektart gleich gebaut; die Handler arbeiten über `ops` generisch.
    const on = app.openapi.bind(app) as unknown as (
      route: unknown,
      handler: (c: Context<ApiEnv>) => Promise<Response>,
    ) => void;
    const valid = (c: Context<ApiEnv>, target: 'param' | 'json' | 'query') =>
      (c.req as unknown as { valid(t: string): Record<string, unknown> }).valid(target);

    on(routes.list, async (c) => {
      const { repo } = await repoOf(c);
      const rows = await ops.list(repo, valid(c, 'query') as Record<string, string | undefined>);
      const items = await Promise.all(rows.map((r) => ops.view(r, repo)));
      c.header('cache-control', 'no-store');
      return c.json({ items }, 200);
    });
    on(routes.get, async (c) => {
      const { repo } = await repoOf(c);
      const row = await ops.get(repo, valid(c, 'param').id as string);
      if (!row) throw new ProblemError('resource.not_found');
      c.header('cache-control', 'no-store');
      return c.json(await ops.view(row, repo), 200);
    });
    on(routes.create, async (c) => {
      const { repo, svc } = await repoOf(c);
      const { id, ...input } = valid(c, 'json');
      const row = await ops.create(repo, id as string, input as never, svc.now());
      return c.json(await ops.view(row, repo), 201);
    });
    on(routes.update, async (c) => {
      const { repo, svc } = await repoOf(c);
      const row = await ops.update(
        repo,
        valid(c, 'param').id as string,
        valid(c, 'json') as never,
        svc.now(),
        expectedVersion(c.req.header('if-match')),
      );
      return c.json(await ops.view(row, repo), 200);
    });
    on(routes.remove, async (c) => {
      const { repo, svc } = await repoOf(c);
      await ops.remove(repo, valid(c, 'param').id as string, svc.now());
      return c.body(null, 204);
    });
  }

  mount(siteRoutes, {
    list: (r) => r.sites(),
    get: (r, id) => r.site(id),
    create: (r, id, input, now) => r.createSite(id, input, now),
    update: (r, id, input, now) => r.updateSite(id, input, now),
    remove: (r, id, now) => r.deleteSite(id, now),
    view: (row) => pick(SiteView, row),
  });
  mount(siteLinkRoutes, {
    list: (r, q) => r.siteLinks(q.siteId),
    get: async (r, id) => (await r.siteLinks()).find((l) => l.id === id),
    create: (r, id, input, now) => r.createSiteLink(id, input, now),
    update: (r, id, input, now) => r.updateSiteLink(id, input, now),
    remove: (r, id, now) => r.deleteSiteLink(id, now),
    view: (row) => pick(SiteLinkView, row),
  });
  mount(telescopeRoutes, {
    list: (r) => r.telescopes(),
    get: (r, id) => r.telescope(id),
    create: (r, id, input, now) => r.createTelescope(id, input, now),
    update: (r, id, input, now) => r.updateTelescope(id, input, now),
    remove: (r, id, now) => r.deleteTelescope(id, now),
    view: telescopeView,
  });
  mount(cameraRoutes, {
    list: (r) => r.cameras(),
    get: (r, id) => r.camera(id),
    create: (r, id, input, now) => r.createCamera(id, input, now),
    update: (r, id, input, now) => r.updateCamera(id, input, now),
    remove: (r, id, now) => r.deleteCamera(id, now),
    view: cameraView,
  });
  mount(filterRoutes, {
    list: (r) => r.filters(),
    get: (r, id) => r.filter(id),
    create: (r, id, input, now) => r.createFilter(id, input, now),
    update: (r, id, input, now) => r.updateFilter(id, input, now),
    remove: (r, id, now) => r.deleteFilter(id, now),
    view: (row) => pick(FilterView, row),
  });
  mount(moonProfileRoutes, {
    list: (r) => r.moonProfiles(),
    get: (r, id) => r.moonProfile(id),
    create: (r, id, input, now) => r.createMoonProfile(id, input, now),
    update: (r, id, input, now) => r.updateMoonProfile(id, input, now),
    remove: (r, id, now) => r.deleteMoonProfile(id, now),
    view: moonProfileView,
  });
  mount(templateRoutes, {
    list: (r) => r.templates(),
    get: (r, id) => r.template(id),
    create: (r, id, input, now) => r.createTemplate(id, input, now),
    update: (r, id, input, now) => r.updateTemplate(id, input, now),
    remove: (r, id, now) => r.deleteTemplate(id, now),
    view: templateView,
  });
  mount<RigRow>(rigRoutes, {
    list: (r) => r.rigs(),
    get: (r, id) => r.rig(id),
    create: (r, id, input, now) => r.createRig(id, input, now),
    update: (r, id, input, now, version) => r.updateRig(id, input, now, version),
    remove: (r, id, now) => r.deleteRig(id, now),
    view: async (row, repo) => (await rigContext(repo))(row),
  });

  app.openapi(schedulerSettingsRoute, async (c) => {
    const { repo, svc } = await repoOf(c);
    const row = await repo.updateScheduler(
      c.req.valid('param').id,
      c.req.valid('json'),
      svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    c.header('etag', `"${String(row.settingsVersion)}"`);
    return c.json((await rigContext(repo))(row), 200);
  });

  app.openapi(getFilterWheelRoute, async (c) => {
    const { repo } = await repoOf(c);
    const view = await repo.filterWheel(c.req.valid('param').id);
    c.header('cache-control', 'no-store');
    c.header('etag', `"${String(view.settingsVersion)}"`);
    return c.json(view, 200);
  });

  app.openapi(putFilterWheelRoute, async (c) => {
    const { repo, svc } = await repoOf(c);
    const id = c.req.valid('param').id;
    await repo.putFilterWheel(
      id,
      c.req.valid('json'),
      svc.now(),
      expectedVersion(c.req.valid('header')['if-match']),
    );
    const view = await repo.filterWheel(id);
    c.header('etag', `"${String(view.settingsVersion)}"`);
    return c.json(view, 200);
  });

  app.openapi(siteNightsRoute, async (c) => {
    const { repo, svc } = await repoOf(c);
    const site = await repo.site(c.req.valid('param').id);
    if (!site) throw new ProblemError('resource.not_found');
    const { from, count } = c.req.valid('query');
    c.header('cache-control', 'no-store');
    return c.json(siteNights(site, svc.now(), from, count), 200);
  });

  return app;
}
