/**
 * Eine Eingabe-Quelle und Ist der Nacht (AP-53c; FA-SIM-05, FA-SIM-10; PGlite): `GET /simulations/input` liefert
 * dieselbe Eingabe wie `POST /plan` (gleicher `inputHash`), das Ist aus Session-Ereignissen und Aufnahmen, die letzte und
 * die erste gespeicherte Planrevision und „Rig plant noch mit Rev. n“, sobald sich die Ziele seit dem Plan geändert
 * haben. Der Simulator im Plugin (`GET /nina/v1/simulation`) bekommt Ist und Planstand ebenso.
 */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const NIGHT = '2026-09-18';

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const identity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(identity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant') };
  const web = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/web/v1${path}`, { ...o, cookies });
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
  await eq.putFilterWheel(rig.id, { slots: [{ position: 1, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] }, now);
  const created = await web('/projects', {
    method: 'POST',
    body: { id: id(), name: 'NGC 281', rigId: rig.id, targetName: 'NGC 281', raDeg: 13.2, decDeg: 56.6 },
  });
  const pid = created.body.id as string;
  const panelId = (created.body.panels as { id: string }[])[0]!.id;
  const lineId = id();
  await web(`/projects/${pid}/lines`, {
    method: 'POST',
    body: { id: lineId, panelId, filterId: ha.id, exposureS: 300, plannedCount: 40, moonMode: 'none' },
  });
  await s.pg.admin.query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [pid],
  );
  const token = (await web('/nina-instances', { method: 'POST', body: { id: id(), rigId: rig.id, name: 'A' } })).body
    .token as string;
  const call = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/nina/v1${path}`, {
      method: o.method ?? 'GET',
      headers: { authorization: `Bearer ${token}` },
      ...(o.body !== undefined ? { body: o.body } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body, etag: res.headers.get('etag') };
  };
  return { rigId: rig.id, pid, panelId, lineId, web, call };
}

describe('GET /simulations/input', () => {
  it('liefert dieselbe Eingabe wie POST /plan, Namen und Filterfarben; ohne Session kein Ist', async () => {
    const w = await setup();
    const r = await w.web(`/simulations/input?rigId=${w.rigId}&night=${NIGHT}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      night: NIGHT,
      currentNight: NIGHT,
      projectNames: { [w.pid]: 'NGC 281' },
      filterColors: { Ha: expect.any(String) },
      executed: null,
      storedPlan: null,
      firstPlan: null,
    });
    expect((r.body.input as { projects: { id: string }[] }).projects.map((p) => p.id)).toEqual([w.pid]);
    const plan = await w.call('/plan', { method: 'POST', body: { night: NIGHT, reason: 'initial' } });
    expect(plan.status).toBe(200);
    expect(plan.body.startAtUtc ?? null).toBeNull();
    expect(r.body.inputHash).toBe(plan.body.inputHash);

    const missing = await w.web(`/simulations/input?rigId=${crypto.randomUUID()}&night=${NIGHT}`);
    expect(missing.status).toBe(404);
  });

  it('Ist aus Ereignissen und Aufnahmen, gespeicherter Plan, Hinweis bei neuen Zielen; auch im Plugin-Simulator', async () => {
    const w = await setup();
    const targets = await w.call('/targets');
    const sessionId = id();
    expect(
      (
        await w.call('/sessions', {
          method: 'POST',
          body: { id: sessionId, night: NIGHT, nightPlanId: null, startedAtUtc: '2026-09-19T00:30:00Z', offline: false },
        })
      ).status,
    ).toBe(201);
    const plan = await w.call('/plan', {
      method: 'POST',
      body: { night: NIGHT, reason: 'initial', sessionId, targetsEtag: targets.etag },
    });
    expect(plan.status).toBe(200);
    const nightPlanId = plan.body.nightPlanId as string;
    const blockId = id();
    const ev = (kind: string, at: string, extra: Body = {}) => ({
      id: id(),
      occurredAtUtc: at,
      kind,
      nightPlanId,
      blockId,
      projectId: w.pid,
      ...extra,
    });
    const events = await w.call(`/sessions/${sessionId}/events`, {
      method: 'POST',
      body: {
        events: [
          ev('plan_built', '2026-09-19T00:31:00Z', { blockId: null, projectId: null, data: { revision: 1, reason: 'initial' } }),
          ev('block_start', '2026-09-19T01:00:00Z', { data: { kind: 'regular', title: 'NGC 281' } }),
          ev('block_end', '2026-09-19T01:20:00Z', { code: 'completed', data: { exposures: 2 } }),
        ],
      },
    });
    expect(events.status).toBe(200);
    const light = (at: string) => ({
      id: id(),
      frameType: 'light',
      capturedAtUtc: at,
      exposureMidUtc: at,
      night: NIGHT,
      blockId,
      projectId: w.pid,
      panelId: w.panelId,
      exposureLineId: w.lineId,
      filterShortName: 'Ha',
      filterActual: 'Ha 3nm',
      exposureS: 300,
      gain: null,
      offset: null,
      binning: 1,
      readoutMode: 'Default',
      readoutModeIndex: 0,
      raDeg: 13.2,
      decDeg: 56.6,
      rotationDeg: 0,
      pierSide: 'west',
      rotatorMechDeg: 0,
      bonus: false,
      temperatureDeviation: false,
      result: 'saved',
      fileName: 'x.fits',
      nightPlanId,
    });
    const caps = await w.call(`/sessions/${sessionId}/captures`, {
      method: 'POST',
      body: { captures: [light('2026-09-19T01:02:00Z'), light('2026-09-19T01:08:00Z')] },
    });
    expect(caps.status).toBe(200);

    s.clock.set(new Date('2026-09-19T02:00:00Z'));
    const r = await w.web(`/simulations/input?rigId=${w.rigId}&night=${NIGHT}`);
    expect(r.status).toBe(200);
    expect(r.body.currentNight).toBe(NIGHT);
    expect(r.body.executed).toMatchObject({
      sessions: 1,
      blocks: [{ blockId, title: 'NGC 281', kind: 'regular', exposures: 2, endReason: 'completed', running: false }],
      segments: [{ filter: 'Ha', saved: 2, failed: 0, startUtc: '2026-09-19T01:02:00Z', endUtc: '2026-09-19T01:13:00Z' }],
      counters: { saved: 2, skipped: 0, failed: 0 },
    });
    expect(r.body.storedPlan).toMatchObject({ nightPlanId, revision: 1, reason: 'initial', stale: false, staleCause: null });
    expect((r.body.firstPlan as Body).nightPlanId).toBe(nightPlanId);
    expect(((r.body.storedPlan as Body).blocks as unknown[]).length).toBeGreaterThan(0);

    // Zeile abgeschaltet → neues Ziele-ETag: die Rig plant noch mit Revision 1.
    expect((await w.web(`/projects/${w.pid}/lines/${w.lineId}`, { method: 'PATCH', body: { enabled: false } })).status).toBe(200);
    const stale = await w.web(`/simulations/input?rigId=${w.rigId}&night=${NIGHT}`);
    expect(stale.body.storedPlan).toMatchObject({ revision: 1, stale: true, staleCause: 'targets' });

    const sim = await w.call(`/simulation?night=${NIGHT}`);
    expect(sim.status).toBe(200);
    expect(sim.body.storedPlan).toMatchObject({ nightPlanId, revision: 1, stale: true, staleCause: 'targets' });
    expect((sim.body.executed as Body).counters).toEqual({ saved: 2, skipped: 0, failed: 0 });
    expect((sim.body.storedPlan as Body).blocks).toBeUndefined();
  });
});
