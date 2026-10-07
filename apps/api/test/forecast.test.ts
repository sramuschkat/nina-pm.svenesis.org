/**
 * AP-33 (FA-FOL-01…04, FA-FOL-07; TK 13; PGlite): Job `forecast` schreibt je Rig 14 Prognosenächte
 * (`night_plan(origin = 'forecast_job')`, idempotent), `tick-hourly` legt ihn einmal je Standortnacht an,
 * `GET /forecast?rigId=` liefert Restbedarf, Spanne, Kandidatennächte und Klarnacht-Quote,
 * `POST /forecast/run` stößt neu an.
 */
import { effortSites, JobQueue, JobRepository, siteNightRunDone } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { siteNights } from '../src/lib/night-table';
import { forecastJobHandler, forecastSiteTick } from '../src/worker/forecast';
import { runJob, type JobRunnerDeps } from '../src/worker/jobs';
import { forecastDbDeps } from '../src/worker/multi-sim-db';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(async () => {
  await s.reset();
  s.clock.set(new Date('2026-09-18T20:00:00Z'));
});
afterAll(() => s.close());

type Body = Record<string, unknown>;
const id = () => crypto.randomUUID();

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = {
    [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant'),
  };
  const web = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      cookies,
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
    { slots: [{ position: 1, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
    now,
  );
  const project = async (name: string, ra: number, dec: number, status: string) => {
    const created = await web('/projects', {
      method: 'POST',
      body: { id: id(), name, rigId: rig.id, targetName: name, raDeg: ra, decDeg: dec },
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
    });
    await s.pg.admin.query(
      "UPDATE project SET approval_status = 'approved', status = $2, rig_id = requested_rig_id WHERE id = $1",
      [pid, status],
    );
    return pid;
  };
  const active = await project('NGC 281', 13.2, 56.6, 'active');
  const paused = await project('IC 1805', 38.2, 61.45, 'on_hold');
  const deps = forecastDbDeps(() => Promise.resolve(s.pg.db));
  const jobs: JobRunnerDeps = {
    queue: () => Promise.resolve(new JobQueue(s.pg.db)),
    handlers: { forecast: forecastJobHandler(deps) },
    now: () => s.clock.now(),
  };
  return { tenantId, web, rig, site, active, paused, jobs };
}

describe('Job forecast und S-62 (AP-33)', () => {
  it('Statuswechsel eines freigegebenen Projekts stößt die Folgeplanung des Standorts an (07.10.2026)', async () => {
    // Vorher rechnete der Server nur einmal je Standortnacht nach dem Mittag: später freigegebene bzw. aktivierte
    // Projekte standen in „Plan für diese Nacht“ mit 0 Frames.
    const t = await setup();
    const open = async () =>
      (
        await s.pg.admin.query(
          "SELECT count(*)::int AS n FROM job WHERE kind = 'forecast' AND tenant_id = $1",
          [t.tenantId],
        )
      ).rows[0] as { n: number };
    expect((await open()).n).toBe(0);
    const r = await t.web(`/projects/${t.paused}/status`, {
      method: 'PUT',
      body: { status: 'active' },
    });
    expect(r.status).toBe(200);
    expect((await open()).n).toBe(1);
    // Ein zweiter Wechsel bei offenem Lauf legt keinen weiteren an (dedupliziert je Standort).
    await t.web(`/projects/${t.active}/status`, { method: 'PUT', body: { status: 'on_hold' } });
    expect((await open()).n).toBe(1);
  });

  it('schreibt 14 Nächte je Rig idempotent; Ansicht mit Restbedarf, Spanne, Kandidaten, Quote', async () => {
    const t = await setup();
    const before = await t.web(`/forecast?rigId=${t.rig.id}`);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ computedAt: null, nights: [] });

    // Anstoßen über S-62 und ausführen.
    const run = await t.web('/forecast/run', { method: 'POST', body: { rigId: t.rig.id } });
    expect(run.status).toBe(202);
    expect(await runJob(t.jobs, run.body.jobId as string)).toBe('done');
    const rows = async () =>
      (
        await s.pg.admin.query(
          "SELECT count(*)::int AS n FROM night_plan WHERE origin = 'forecast_job' AND rig_id = $1",
          [t.rig.id],
        )
      ).rows[0] as { n: number };
    expect((await rows()).n).toBe(14);
    // Zweiter Lauf ersetzt statt zu verdoppeln.
    const again = await t.web('/forecast/run', { method: 'POST', body: { rigId: t.rig.id } });
    expect(await runJob(t.jobs, again.body.jobId as string)).toBe('done');
    expect((await rows()).n).toBe(14);

    const v = (await t.web(`/forecast?rigId=${t.rig.id}`)).body;
    expect(v.computedAt).toEqual(expect.any(String));
    const nights = v.nights as Body[];
    expect(nights).toHaveLength(14);
    // Ohne Wetter-Cache und ohne Klarnacht-Statistik: Startquote 0,5 für alle Nächte.
    expect(v.clearQuota).toEqual({ rate: 0.5, source: 'default', recordedNights: 0 });
    expect(nights.every((n) => n.weightSource === 'quota' && n.weight === 0.5)).toBe(true);
    const projects = v.projects as Body[];
    expect(projects.map((p) => p.projectId)).toEqual([t.active]);
    const p = projects[0] as Body;
    expect(p.need).toEqual([{ filter: 'Ha', frames: 30, hours: expect.any(Number) }]);
    expect(p.candidates as Body[]).toHaveLength(7);
    expect(p.optimistic).toMatchObject({ nights: expect.any(Number) });
    // Pausiertes Projekt mit Restbedarf zur Wiederaufnahme.
    expect((v.resume as Body[]).map((r) => r.projectId)).toEqual([t.paused]);
  });

  it('tick-hourly: einmal je Standortnacht nach dem lokalen Mittag', async () => {
    const t = await setup();
    const tick = {
      sites: () => effortSites(s.pg.db),
      nights: (site: Parameters<typeof siteNights>[0], now: Date, count: number) =>
        siteNights(site, now, undefined, count),
      enqueue: (tenantId: string, input: Parameters<JobRepository['enqueue']>[0]) =>
        new JobRepository(s.pg.db, { tenantId }).enqueue(input),
      runDone: (tenantId: string, key: string) => siteNightRunDone(s.pg.db, tenantId, key),
    };
    const first = await forecastSiteTick(tick as never, t.jobs, s.clock.now());
    expect(first).toBe(1);
    const second = await forecastSiteTick(tick as never, t.jobs, s.clock.now());
    expect(second).toBe(0);
  });

  it('unbekanntes Rig 404', async () => {
    const t = await setup();
    expect((await t.web(`/forecast?rigId=${id()}`)).status).toBe(404);
    expect((await t.web('/forecast/run', { method: 'POST', body: { rigId: id() } })).status).toBe(
      404,
    );
  });
});
