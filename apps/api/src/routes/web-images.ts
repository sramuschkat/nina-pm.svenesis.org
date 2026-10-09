/**
 * Bilder im Projekt (AP-72b, FA-AUS-25): Liste der Lights mit Bewertung, mehrere verwerfen bzw. zurücknehmen,
 * „Behalten“. Verwerfen nutzt dieselbe Zählerlogik wie das manuelle Verwerfen (`rejectCapture`, FK 8.4).
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { PROJECT_IMAGE_LIMIT, rejectCapture } from '@nina-pm/db';
import {
  can,
  CaptureKeep,
  CaptureKeepResult,
  IMAGE_QUALITY_DEFAULTS,
  imageScale,
  ProblemError,
  ProjectImagesReject,
  ProjectImagesRejectResult,
  ProjectImagesView,
  Uuid,
} from '@nina-pm/shared';
import type { Context } from 'hono';
import type { ApiEnv } from '../lib/env';
import { projectImagesView } from '../sessions/project-images';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

const json = <S extends z.ZodType>(schema: S) => ({
  content: { 'application/json': { schema } },
});
const denied = {
  401: problemContent('Nicht angemeldet'),
  403: problemContent('Keine Berechtigung'),
};

export const projectImagesRoute = defineRoute(
  { action: 'session.read', requirements: ['FA-AUS-25', 'AP-72b', 'S-31'] },
  {
    method: 'get',
    path: '/api/web/v1/projects/{id}/images',
    summary:
      'Lights des Projekts über alle Nächte mit Messwerten, Bewertung und Datei (Reiter „Bilder“)',
    tags: ['sessions'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      200: { description: 'Bilder', ...json(ProjectImagesView) },
      ...denied,
      404: problemContent('resource.not_found'),
    },
  },
);

export const projectImagesRejectRoute = defineRoute(
  { action: 'session.correct', requirements: ['FA-AUS-25', 'FA-AUS-20', 'FK 8.4'] },
  {
    method: 'post',
    path: '/api/web/v1/projects/{id}/images/reject',
    summary: 'Mehrere Lights des Projekts verwerfen (Grund auto_quality) bzw. zurücknehmen',
    tags: ['sessions'],
    request: {
      params: z.object({ id: Uuid }),
      body: { ...json(ProjectImagesReject), required: true },
    },
    responses: {
      200: { description: 'Geändert', ...json(ProjectImagesRejectResult) },
      ...denied,
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
    },
  },
);

export const captureKeepRoute = defineRoute(
  { action: 'session.correct', requirements: ['FA-AUS-25'] },
  {
    method: 'patch',
    path: '/api/web/v1/captures/{id}/quality',
    summary: '„Behalten“: Light bestätigen, die Bildbewertung markiert es nicht wieder',
    tags: ['sessions'],
    request: {
      params: z.object({ id: Uuid }),
      body: { ...json(CaptureKeep), required: true },
    },
    responses: {
      200: { description: 'Gespeichert', ...json(CaptureKeepResult) },
      ...denied,
      404: problemContent('resource.not_found'),
      409: problemContent('capture.not_rejectable'),
    },
  },
);

export const IMAGE_ROUTES = [
  projectImagesRoute,
  projectImagesRejectRoute,
  captureKeepRoute,
] as const;

export function webImageRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  /** Darf der Aufrufer im Projekt verwerfen (wie `PATCH /captures/{id}`)? */
  const mayCorrect = async (c: Context<ApiEnv>, svc: ApiServices, createdBy: string) => {
    const { auth, tenant } = requireTenant(c);
    const settings = (await svc.repositories(tenant).tenant().settings()).settings;
    return can(auth, 'session.correct', {
      tenantId: tenant.tenantId,
      createdBy,
      settings: { userCorrections: settings.userCorrections },
    });
  };

  app.openapi(projectImagesRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    const projectId = c.req.valid('param').id;
    const detail = await repos.projects().detail(projectId);
    if (!detail) throw new ProblemError('resource.not_found');
    const project = detail.project;
    const eq = repos.equipment();
    const rig = project.rigId ? await eq.rig(project.rigId) : undefined;
    const [telescope, camera] = rig
      ? await Promise.all([eq.telescope(rig.telescopeId), eq.camera(rig.cameraId)])
      : [undefined, undefined];
    const rows = await repos.imageQuality().projectImages(projectId);
    c.header('cache-control', 'no-store');
    return c.json(
      projectImagesView({
        projectId,
        rigId: rig?.id ?? null,
        settings: rig?.imageQuality ?? IMAGE_QUALITY_DEFAULTS,
        scaleArcsecPx:
          telescope && camera ? imageScale({ ...telescope, ...camera }).scaleArcsecPx : null,
        rows: rows.slice(0, PROJECT_IMAGE_LIMIT),
        truncated: rows.length > PROJECT_IMAGE_LIMIT,
        canCorrect: await mayCorrect(c, svc, project.createdBy),
      }),
      200,
    );
  });

  app.openapi(projectImagesRejectRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    const projectId = c.req.valid('param').id;
    const body = c.req.valid('json');
    const project = await repos.projects().meta(projectId);
    if (!project) throw new ProblemError('resource.not_found');
    if (!(await mayCorrect(c, svc, project.createdBy))) throw new ProblemError('permission.denied');
    const review = repos.sessionReview();
    let changed = 0;
    let skipped = 0;
    let projectStatus: string | null = null;
    // Je Aufnahme eine Transaktion (Zeilen-Guard, ≤ 500 je Aufruf); fremde Projekte und nicht verwerfbare zählen als übersprungen.
    for (const captureId of [...new Set(body.captureIds)]) {
      const target = await review.rejectTarget(captureId).catch(() => null);
      if (target?.projectId !== projectId) {
        skipped++;
        continue;
      }
      try {
        const r = await rejectCapture(
          svc.db,
          {
            tenantId: tenant.tenantId,
            userId: tenant.memberId as string,
            captureId,
            rejected: body.rejected,
            reason: body.rejected ? 'auto_quality' : null,
          },
          svc.now(),
        );
        changed++;
        projectStatus = r.projectStatus ?? projectStatus;
      } catch (error) {
        if (error instanceof ProblemError && error.code === 'capture.not_rejectable') skipped++;
        else throw error;
      }
    }
    return c.json({ changed, skipped, projectStatus }, 200);
  });

  app.openapi(captureKeepRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const repos = svc.repositories(tenant);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const target = await repos.sessionReview().rejectTarget(id);
    if (!(await mayCorrect(c, svc, target.projectCreatedBy ?? '')))
      throw new ProblemError('permission.denied');
    const r = await repos.imageQuality().setKept(id, body.kept);
    if (!r) throw new ProblemError('capture.not_rejectable');
    return c.json({ captureId: id, kept: body.kept }, 200);
  });

  return app;
}
