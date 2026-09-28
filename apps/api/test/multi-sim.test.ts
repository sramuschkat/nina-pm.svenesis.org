/**
 * AP-32a (FA-SIM-04, FA-FRG-05; TK 7.4; PGlite): Mehrnacht-Simulation und Auswirkungsvorschau als Jobs –
 * `202 {jobId}`, Deduplizierung je Rig, Startnacht, Mitglied und Optionen, Lauf im Worker mit Ergebnis im Speicher statt S3,
 * Abruf über `GET /jobs/{id}/result`; eigene Einreichungen nur mit `includeOwnDrafts`; Vorschau nur für
 * eingereichte Objekte.
 */
import { JobQueue } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runJob } from '../src/worker/jobs';
import { impactJobHandler, multiSimJobHandler } from '../src/worker/multi-sim';
import { multiSimDbDeps } from '../src/worker/multi-sim-db';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(async () => {
  await s.reset();
  s.clock.set(new Date('2026-09-18T14:00:00Z'));
});
afterAll(() => s.close());

type Body = Record<string, unknown>;
const id = () => crypto.randomUUID();

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const userIdentity = await s.seed.identity({ mfaEnabled: true });
  const user = await s.seed.member(userIdentity.id, tenantId, 'user');
  const cookie = async (identityId: string) => ({
    [COOKIE_NAMES.session]: await s.seed.session(identityId, tenantId, 'tenant'),
  });
  const cookies = { owner: await cookie(ownerIdentity.id), user: await cookie(userIdentity.id) };
  const web = async (
    path: string,
    o: { method?: string; body?: unknown; as?: 'owner' | 'user' } = {},
  ) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      cookies: cookies[o.as ?? 'owner'],
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const eq = s.services.repositories({ tenantId, memberId: owner }).equipment();
  const now = s.clock.now();
  const site = await eq.createSite(id(), SITE, now);
  const telescope = await eq.createTelescope(id(), TELESCOPE, now);
  const camera = await eq.createCamera(id(), CAMERA, now);
  const ha = await eq.createFilter(id(), filterInput('Ha'), now);
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  await eq.updateScheduler(rig.id, SCHEDULER, now);
  await eq.putFilterWheel(
    rig.id,
    { slots: [{ position: 0, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
    now,
  );
  const project = async (name: string, ra: number, dec: number, as: 'owner' | 'user') => {
    const created = await web('/projects', {
      method: 'POST',
      body: { id: id(), name, rigId: rig.id, targetName: name, raDeg: ra, decDeg: dec },
      as,
    });
    const pid = created.body.id as string;
    const panelId = (created.body.panels as { id: string }[])[0]?.id as string;
    await web(`/projects/${pid}/lines`, {
      method: 'POST',
      body: {
        id: id(),
        panelId,
        filterId: ha.id,
        exposureS: 300,
        plannedCount: 30,
        moonMode: 'none',
      },
      as,
    });
    return pid;
  };
  // Freigegeben und aktiv am Rig; eingereicht vom User mit Wunsch-Rig.
  const approved = await project('NGC 281', 13.2, 56.6, 'owner');
  await s.pg.admin.query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = $2 WHERE id = $1",
    [approved, rig.id],
  );
  const submitted = await project('IC 1805', 38.2, 61.45, 'user');
  const sub = await web(`/projects/${submitted}/submit`, {
    method: 'POST',
    body: { requestedRigId: rig.id },
    as: 'user',
  });
  expect(sub.status).toBe(200);
  const deps = multiSimDbDeps(() => Promise.resolve(s.pg.db), s.jobResults.put);
  const run = (jobId: string) =>
    runJob(
      {
        queue: () => Promise.resolve(new JobQueue(s.pg.db)),
        handlers: { multi_sim: multiSimJobHandler(deps), impact: impactJobHandler(deps) },
        now: () => s.clock.now(),
      },
      jobId,
    );
  return { tenantId, owner, user, web, rig, approved, submitted, run };
}

describe('Mehrnacht-Simulation (FA-SIM-04)', () => {
  it('202 mit Deduplizierung, Lauf im Worker, Ergebnis über /jobs/{id}/result', async () => {
    const t = await setup();
    const body = { rigId: t.rig.id, nightFrom: '2026-09-18', nights: 3 };
    const a = await t.web('/simulations/multi', { method: 'POST', body });
    expect(a.status).toBe(202);
    const b = await t.web('/simulations/multi', { method: 'POST', body });
    expect(b.body.jobId).toBe(a.body.jobId);
    const jobId = a.body.jobId as string;
    expect((await t.web(`/jobs/${jobId}/result`)).status).toBe(404);
    expect(await t.run(jobId)).toBe('done');
    const job = await t.web(`/jobs/${jobId}`);
    expect(job.body).toMatchObject({ status: 'done', hasResult: true, kind: 'multi_sim' });
    const r = await t.web(`/jobs/${jobId}/result`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      kind: 'multi_sim',
      rigId: t.rig.id,
      nightCount: 3,
      weather: false,
    });
    expect((r.body.nights as Body[]).map((n) => n.night)).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
    // Ohne `includeOwnDrafts` nur freigegebene, aktive Projekte.
    const projects = r.body.projects as Body[];
    expect(projects.map((p) => p.projectId)).toEqual([t.approved]);
    expect(projects[0]).toMatchObject({ needFrames: 30 });
    // Andere dürfen fremde Jobs nicht lesen (job.read mit Ersteller).
    expect((await t.web(`/jobs/${jobId}/result`, { as: 'user' })).status).toBe(403);
  });

  it('Deduplizierung je Mitglied und Optionen (TK 7.4, Spec-Ergänzung 28.09.2026)', async () => {
    const t = await setup();
    const body = { rigId: t.rig.id, nightFrom: '2026-09-18', nights: 3 };
    const post = async (b: Body, as: 'owner' | 'user' = 'owner') => {
      const r = await t.web('/simulations/multi', { method: 'POST', body: b, as });
      expect(r.status).toBe(202);
      return r.body.jobId as string;
    };
    const base = await post(body);
    // Gleiche Eingabe (auch mit ausdrücklichen Standardwerten) → derselbe offene Job.
    expect(await post({ ...body, includeOwnDrafts: false, weather: false })).toBe(base);
    // Anderes Mitglied, andere Nächte, Wetter oder eigene Entwürfe → eigener Job.
    const other = [
      await post(body, 'user'),
      await post({ ...body, nights: 14 }),
      await post({ ...body, weather: true }),
    ];
    expect(new Set([base, ...other]).size).toBe(4);
    // Höchstens 3 offene Jobs je Mitglied gelten weiter (hier: owner hat 3 offen).
    const limited = await t.web('/simulations/multi', {
      method: 'POST',
      body: { ...body, includeOwnDrafts: true },
    });
    expect(limited.status).toBe(429);
    // Der Job des Users rechnet mit dessen Entwürfen, nicht mit denen des Owners.
    const own = await post({ ...body, includeOwnDrafts: true }, 'user');
    expect(own).not.toBe(other[0]);
    expect(await t.run(own)).toBe('done');
    const r = await t.web(`/jobs/${own}/result`, { as: 'user' });
    expect((r.body.projects as Body[]).map((p) => p.projectId).sort()).toEqual(
      [t.approved, t.submitted].sort(),
    );
  });

  it('eigene Einreichungen nur mit includeOwnDrafts; unbekanntes Rig 404; >14 Nächte 422', async () => {
    const t = await setup();
    const res = await t.web('/simulations/multi', {
      method: 'POST',
      body: { rigId: t.rig.id, nightFrom: '2026-09-18', nights: 2, includeOwnDrafts: true },
      as: 'user',
    });
    expect(res.status).toBe(202);
    expect(await t.run(res.body.jobId as string)).toBe('done');
    const r = await t.web(`/jobs/${res.body.jobId as string}/result`, { as: 'user' });
    expect((r.body.projects as Body[]).map((p) => p.projectId).sort()).toEqual(
      [t.approved, t.submitted].sort(),
    );
    expect(
      (
        await t.web('/simulations/multi', {
          method: 'POST',
          body: { rigId: id(), nightFrom: '2026-09-18', nights: 2 },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.web('/simulations/multi', {
          method: 'POST',
          body: { rigId: t.rig.id, nightFrom: '2026-09-18', nights: 15 },
        })
      ).status,
    ).toBe(422);
  });
});

describe('Auswirkungsvorschau (FA-FRG-05)', () => {
  it('mit und ohne das eingereichte Objekt; nur für Eingereichte; nur Admin', async () => {
    const t = await setup();
    expect(
      (await t.web(`/queue/project/${t.submitted}/impact`, { method: 'POST', as: 'user' })).status,
    ).toBe(403);
    const res = await t.web(`/queue/project/${t.submitted}/impact`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await t.run(res.body.jobId as string)).toBe('done');
    const r = await t.web(`/jobs/${res.body.jobId as string}/result`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      kind: 'impact',
      queueItemId: t.submitted,
      projectId: t.submitted,
      projectName: 'IC 1805',
      rigId: t.rig.id,
      nightCount: 14,
    });
    expect((r.body.shifts as Body[]).map((x) => x.projectId)).toEqual([t.approved]);
    // Frames begrenzt der Bedarf; Stunden können durch mehr Blöcke (Overhead) sogar steigen.
    const shift = (r.body.shifts as Body[])[0] as { framesWith: number; framesWithout: number };
    expect(shift.framesWith).toBeLessThanOrEqual(30);
    expect(shift.framesWithout).toBeLessThanOrEqual(30);
    expect(r.body.target).toMatchObject({ projectId: t.submitted, needFrames: 30 });
    const approved = await t.web(`/queue/project/${t.approved}/impact`, { method: 'POST' });
    expect([approved.status, approved.body.code]).toEqual([409, 'approval.not_allowed']);
  });
});
