/**
 * `POST /api/web/v1/simulations` (AP-13f, TK 7.2): speichert einen im Browser gerechneten Nachtplan als
 * `night_plan(origin = 'web_simulation')`. Der Plan muss zur angegebenen Nacht gehören; das Rig muss im
 * Mandanten existieren (404). Rechnen tut der Browser mit derselben Engine (FA-SIM-05).
 * `POST /api/web/v1/simulations/multi` (AP-32a, FA-SIM-04): Mehrnacht-Simulation als Job `multi_sim`
 * (`202 {jobId}`; höchstens 14 Nächte, dedupliziert je Rig und Startnacht, höchstens 3 offene Jobs je
 * Mitglied → `429 auth.rate_limited`).
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  dedupeKeys,
  JobAccepted,
  MultiSimInput,
  ProblemError,
  SimulationCreate,
  SimulationSaved,
} from '@nina-pm/shared';
import { enqueueJob } from '../jobs/enqueue';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { defineRoute, problemContent } from './define';
import type { ApiServices } from './services';
import { requireTenant } from './tenant';

export const createSimulationRoute = defineRoute(
  { action: 'simulation.run', requirements: ['FA-SIM-01', 'FA-SIM-05', 'TK 7.2'] },
  {
    method: 'post',
    path: '/api/web/v1/simulations',
    summary: 'Nachtplan einer Simulation speichern',
    tags: ['simulation'],
    request: {
      body: { content: { 'application/json': { schema: SimulationCreate } }, required: true },
    },
    responses: {
      201: {
        description: 'Gespeichert',
        content: { 'application/json': { schema: SimulationSaved } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
    },
  },
);

export const multiSimRoute = defineRoute(
  { action: 'simulation.run', requirements: ['FA-SIM-04', 'TK 7.4', 'SV-06'] },
  {
    method: 'post',
    path: '/api/web/v1/simulations/multi',
    summary: 'Mehrnacht-Simulation als Job starten',
    tags: ['simulation'],
    request: {
      body: { content: { 'application/json': { schema: MultiSimInput } }, required: true },
    },
    responses: {
      202: {
        description: 'Job angelegt bzw. schon offen',
        content: { 'application/json': { schema: JobAccepted } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
      429: problemContent('auth.rate_limited'),
    },
  },
);

export const SIMULATION_ROUTES = [createSimulationRoute, multiSimRoute] as const;

export function webSimulationRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  app.openapi(multiSimRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const input = c.req.valid('json');
    const repos = svc.repositories(tenant);
    if (!(await repos.equipment().rig(input.rigId))) throw new ProblemError('resource.not_found');
    const r = await enqueueJob(repos.job, svc.jobInvoker, {
      kind: 'multi_sim',
      input,
      dedupeKey: dedupeKeys.multiSim(input),
      createdBy: tenant.memberId ?? null,
    });
    return c.json({ jobId: r.jobId }, 202);
  });
  return app.openapi(createSimulationRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const { rigId, night, plan } = c.req.valid('json');
    if (plan.night !== night)
      throw new ProblemError('validation.failed', [
        { path: 'plan.night', message: 'Plan gehört zu einer anderen Nacht' },
      ]);
    const { blocks, ...summary } = plan;
    const saved = await svc.repositories(tenant).simulations().save(
      {
        rigId,
        night,
        engineVersion: plan.engineVersion,
        inputHash: plan.inputHash,
        summary,
        blocks,
      },
      svc.now(),
    );
    return c.json({ id: saved.id, createdAt: isoUtc(saved.createdAt) }, 201);
  });
}
