/**
 * Qualität im Projekt (AP-77, FA-AUS-25; ersetzt den Reiter „Bilder“ aus AP-72b): Anteile der Lights innerhalb der
 * Grenzen des Rigs je Nacht, Filter und Session sowie die Dateiliste zum Stacken als CSV. Einzelne Bilder werden nicht
 * mehr markiert, behalten oder gesammelt verworfen; verworfen wird nur über Korrekturen (FA-AUS-06/20).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { PROJECT_IMAGE_LIMIT } from '@nina-pm/db';
import {
  IMAGE_QUALITY_DEFAULTS,
  ProblemError,
  ProjectQualityFilesQuery,
  ProjectQualityView,
  Uuid,
} from '@nina-pm/shared';
import type { ApiEnv } from '../lib/env';
import {
  gradeProjectLights,
  projectQualityView,
  qualityFilesCsv,
} from '../sessions/project-images';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const denied = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
};

export const projectQualityRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-AUS-25', 'AP-77', 'S-31'] },
  {
    method: 'get',
    path: '/api/web/v1/projects/{id}/quality',
    summary:
      'Qualität des Projekts: Anteile guter Lights je Nacht, Filter und Session (Reiter „Qualität“)',
    tags: ['sessions'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: {
        description: 'Qualität',
        content: { 'application/json': { schema: ProjectQualityView } },
      },
      ...denied,
      404: problemContent('resource.not_found'),
    },
  },
);

export const projectQualityFilesRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-AUS-25', 'AP-77', 'S-31'] },
  {
    method: 'get',
    path: '/api/web/v1/projects/{id}/quality/files',
    summary: 'Dateiliste zum Stacken als CSV: alle bzw. nur gute Lights mit relativem Pfad',
    tags: ['sessions'],
    request: { params: z.object({ id: Uuid }), query: ProjectQualityFilesQuery },
    responses: {
      200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } },
      ...denied,
      404: problemContent('resource.not_found'),
    },
  },
);

export const IMAGE_ROUTES = [projectQualityRoute, projectQualityFilesRoute] as const;

export function webImageRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  /** Projekt, Grenzwerte seines Rigs und die Lights (neueste zuerst, höchstens `PROJECT_IMAGE_LIMIT`). */
  const load = async (
    svc: ApiServices,
    tenant: ReturnType<typeof requireTenant>['tenant'],
    id: string,
  ) => {
    const repos = svc.repositories(tenant);
    const project = await repos.projects().meta(id);
    if (!project) throw new ProblemError('resource.not_found');
    const [rig, rows] = await Promise.all([
      project.rigId ? repos.equipment().rig(project.rigId) : Promise.resolve(undefined),
      repos.imageQuality().projectImages(id),
    ]);
    return {
      rigId: rig?.id ?? null,
      settings: rig?.imageQuality ?? IMAGE_QUALITY_DEFAULTS,
      rows: rows.slice(0, PROJECT_IMAGE_LIMIT),
      truncated: rows.length > PROJECT_IMAGE_LIMIT,
    };
  };

  app.openapi(projectQualityRoute, async (c) => {
    const svc = await services();
    const projectId = c.req.valid('param').id;
    const data = await load(svc, requireTenant(c).tenant, projectId);
    c.header('cache-control', 'no-store');
    return c.json(projectQualityView({ projectId, ...data }), 200);
  });

  app.openapi(projectQualityFilesRoute, async (c) => {
    const svc = await services();
    const projectId = c.req.valid('param').id;
    const good = c.req.valid('query').good === 'true';
    const data = await load(svc, requireTenant(c).tenant, projectId);
    const csv = qualityFilesCsv(gradeProjectLights(data.rows, data.settings), good);
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="project-${projectId}-${good ? 'good' : 'all'}.csv"`,
      'cache-control': 'no-store',
    });
  });

  return app;
}
