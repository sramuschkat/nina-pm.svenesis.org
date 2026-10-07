/**
 * `POST /api/web/v1/simulations` (AP-13f, TK 7.2): speichert einen im Browser gerechneten Nachtplan als
 * `night_plan(origin = 'web_simulation')`. Der Plan muss zur angegebenen Nacht gehören; das Rig muss im
 * Mandanten existieren (404). Rechnen tut der Browser mit derselben Engine (FA-SIM-05).
 * `POST /api/web/v1/simulations/multi` (AP-32a, FA-SIM-04): Mehrnacht-Simulation als Job `multi_sim`
 * (`202 {jobId}`; höchstens 14 Nächte, dedupliziert je Rig, Startnacht, Mitglied und Optionen, höchstens 3 offene Jobs je
 * Mitglied → `429 auth.rate_limited`).
 * `GET /api/web/v1/simulations/transits` (06.10.2026): festgelegte Transits einer Nacht an einem Rig für den
 * Web-Simulator – dieselbe Auswahl wie `POST /plan` (`lockedTransits`), sonst fehlten Exoplaneten im Web-Plan.
 * `GET /api/web/v1/simulations/input` (AP-53c, FA-SIM-05, FA-SIM-10): Engine-Eingabe der Nacht aus derselben Funktion
 * wie `POST /plan` (`nightPlanInput`), dazu Ist, letzte und erste gespeicherte Planrevision – eine Eingabe-Quelle für
 * Web-Simulator, „Heute Nacht“ und Plugin.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  dedupeKeys,
  JobAccepted,
  MultiSimInput,
  ProblemError,
  currentNightRow,
  SimulationCreate,
  SimulationInput,
  SimulationInputQuery,
  SimulationSaved,
  SimulationTransits,
  SimulationTransitsQuery,
} from '@nina-pm/shared';
import { canonicalInputJson, sha256hex } from '@nina-pm/engine';
import { enqueueJob } from '../jobs/enqueue';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { siteNights } from '../lib/night-table';
import { nightActual } from '../nina/actual';
import { nightPlanInput, rigData } from '../nina/sync';
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

export const simulationTransitsRoute = defineRoute(
  { action: 'simulation.run', requirements: ['FA-SIM-05', 'FA-EXO-20', 'TK 7.2'] },
  {
    method: 'get',
    path: '/api/web/v1/simulations/transits',
    summary: 'Festgelegte Transits einer Nacht an einem Rig (Web-Simulator)',
    tags: ['simulation'],
    request: { query: SimulationTransitsQuery },
    responses: {
      200: {
        description: 'Transits der Nacht',
        content: { 'application/json': { schema: SimulationTransits } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
    },
  },
);

export const simulationInputRoute = defineRoute(
  { action: 'simulation.run', requirements: ['FA-SIM-05', 'FA-SIM-10', 'AP-53c'] },
  {
    method: 'get',
    path: '/api/web/v1/simulations/input',
    summary: 'Engine-Eingabe, Ist und gespeicherter Plan einer Nacht',
    tags: ['simulation'],
    request: { query: SimulationInputQuery },
    responses: {
      200: { description: 'Eingabe der Nacht', content: { 'application/json': { schema: SimulationInput } } },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('Keine Berechtigung'),
      404: problemContent('resource.not_found'),
      422: problemContent('validation.failed'),
    },
  },
);

export const SIMULATION_ROUTES = [
  createSimulationRoute,
  multiSimRoute,
  simulationTransitsRoute,
  simulationInputRoute,
] as const;

export function webSimulationRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();
  app.openapi(simulationInputRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const { rigId, night } = c.req.valid('query');
    const repos = svc.repositories(tenant);
    if (!(await repos.equipment().rig(rigId))) throw new ProblemError('resource.not_found');
    const ref = { tenantId: tenant.tenantId, rigId };
    const now = svc.now();
    const d = await rigData(svc, ref);
    // Autofokus-Trigger wie beim Planaufbau: zuletzt gemeldeter Zustand der NINA-Instanz des Rigs (M7).
    const instance = (await repos.ninaInstances().list(rigId))
      .filter((x) => x.lastSeenAt !== null)
      .sort((a, b) => new Date(b.lastSeenAt!).getTime() - new Date(a.lastSeenAt!).getTime())[0];
    const lastState = typeof instance?.lastState === 'string' ? JSON.parse(instance.lastState) : (instance?.lastState ?? null);
    const currentNight = currentNightRow(siteNights(d.site, now, undefined, 3), isoUtc(now)).night;
    const { input, projects } = await nightPlanInput(svc, { ...ref, lastState }, d, {
      night,
      currentNight,
      now,
      startAtUtc: null,
      tonight: null,
      pendingByLine: {},
      ignoreDeliverySwitch: true,
    });
    const names = new Map(projects.map((x) => [x.id, x.name] as const));
    const actual = await nightActual(svc, ref, d, { night, currentNight, now, names });
    return c.json(
      {
        night,
        currentNight,
        inputHash: `sha256:${sha256hex(canonicalInputJson(input))}`,
        // Engine-Typen sind `readonly`, der Vertrag nicht – gleiche Form.
        input: input as unknown as SimulationInput['input'],
        projectNames: Object.fromEntries(names),
        moonProfileNames: Object.fromEntries(d.profiles.map((m) => [m.id, m.name])),
        filterColors: Object.fromEntries(d.filters.map((f) => [f.shortName, f.colorHex])),
        ...actual,
      },
      200,
    );
  });
  app.openapi(simulationTransitsRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const { rigId, night } = c.req.valid('query');
    const repos = svc.repositories(tenant);
    if (!(await repos.equipment().rig(rigId))) throw new ProblemError('resource.not_found');
    // Je Projekt der früheste festgelegte Transit mit aktiver Zeile – wie `deliverableByNight` für `POST /plan`.
    const seen = new Set<string>();
    const items = [];
    for (const t of await repos.ninaRig(rigId).lockedTransits([night], svc.now())) {
      if (t.lineId === null || seen.has(t.projectId)) continue;
      seen.add(t.projectId);
      items.push({
        projectId: t.projectId,
        observationId: t.observationId,
        lineId: t.lineId,
        windowStartUtc: isoUtc(t.windowStartUtc),
        windowEndUtc: isoUtc(t.windowEndUtc),
        lockedAtUtc: isoUtc(t.lockedAt),
      });
    }
    return c.json({ items }, 200);
  });
  app.openapi(multiSimRoute, async (c) => {
    const svc = await services();
    const { tenant } = requireTenant(c);
    const input = c.req.valid('json');
    const repos = svc.repositories(tenant);
    if (!(await repos.equipment().rig(input.rigId))) throw new ProblemError('resource.not_found');
    const memberId = tenant.memberId;
    if (!memberId) throw new ProblemError('permission.denied');
    const r = await enqueueJob(repos.job, svc.jobInvoker, {
      kind: 'multi_sim',
      input,
      // Je Mitglied und Optionen (TK 7.4, Spec-Ergänzung 28.09.2026).
      dedupeKey: dedupeKeys.multiSim(input, memberId),
      createdBy: memberId,
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
