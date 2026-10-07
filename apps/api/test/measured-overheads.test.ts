/**
 * Gemessene Overheads je Rig (AP-65, FA-RIG-04b; PGlite): Messung nach `session_close` aus Ereignissen und Aufnahmen,
 * Mandantenbindung, Rig-Ansicht mit getippt/gemessen/wirksam, Schalter „fest“ und dieselben wirksamen Werte in
 * `POST /plan` und `GET /simulations/input`. Die Einstellungsversion zählt nur bei Admin-Änderungen.
 */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionCloseHandler } from '../src/worker/session-jobs';
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
  await eq.putFilterWheel(
    rig.id,
    { slots: [{ position: 1, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
    now,
  );
  const created = await web('/projects', {
    method: 'POST',
    body: {
      id: id(),
      name: 'NGC 281',
      rigId: rig.id,
      targetName: 'NGC 281',
      raDeg: 13.2,
      decDeg: 56.6,
    },
  });
  const pid = created.body.id as string;
  const panelId = (created.body.panels as { id: string }[])[0]?.id as string;
  const lineId = id();
  await web(`/projects/${pid}/lines`, {
    method: 'POST',
    body: {
      id: lineId,
      panelId,
      filterId: ha.id,
      exposureS: 300,
      plannedCount: 40,
      moonMode: 'none',
    },
  });
  await s.pg.admin.query(
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [pid],
  );
  const token = (
    await web('/nina-instances', { method: 'POST', body: { id: id(), rigId: rig.id, name: 'A' } })
  ).body.token as string;
  const call = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/nina/v1${path}`, {
      method: o.method ?? 'GET',
      headers: { authorization: `Bearer ${token}` },
      ...(o.body !== undefined ? { body: o.body } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as Body,
      etag: res.headers.get('etag'),
    };
  };
  return { tenantId, rigId: rig.id, pid, panelId, lineId, web, call };
}

interface OverheadValue {
  key: string;
  typedS: number;
  measured: { medianS: number; n: number; p25S: number; p75S: number } | null;
  effectiveS: number;
  source: string;
  fixed: boolean;
  deviates: boolean;
}
const values = (rig: Body) =>
  Object.fromEntries(
    ((rig.overheads as { values: OverheadValue[] }).values ?? []).map((v) => [v.key, v]),
  );

/** Eine Nacht am Rig: ein Block mit 12 Lights (Abstand 55 s = Download 5 + Dither 50) und 10 Autofokus-Läufen à 240 s. */
async function night(w: Awaited<ReturnType<typeof setup>>) {
  const sessionId = id();
  expect(
    (
      await w.call('/sessions', {
        method: 'POST',
        body: {
          id: sessionId,
          night: NIGHT,
          nightPlanId: null,
          startedAtUtc: '2026-09-19T00:30:00Z',
          offline: false,
        },
      })
    ).status,
  ).toBe(201);
  const plan = await w.call('/plan', {
    method: 'POST',
    body: { night: NIGHT, reason: 'initial', sessionId },
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
  const start = Date.parse('2026-09-19T01:00:00Z');
  const afs = Array.from({ length: 10 }, (_, i) =>
    ev('af', new Date(start + 3 * 3_600_000 + i * 600_000).toISOString(), {
      durationS: 240,
      data: { result: 'ok', filter: 'Ha' },
    }),
  );
  expect(
    (
      await w.call(`/sessions/${sessionId}/events`, {
        method: 'POST',
        body: {
          events: [
            ev('block_start', '2026-09-19T01:00:00Z', {
              data: { kind: 'regular', title: 'NGC 281', slewCenterS: 40 },
            }),
            ev('block_end', '2026-09-19T02:15:00Z', { code: 'completed', data: { exposures: 12 } }),
            ...afs,
          ],
        },
      })
    ).status,
  ).toBe(200);
  const light = (atMs: number) => {
    const at = new Date(atMs).toISOString().replace('.000Z', 'Z');
    return {
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
    };
  };
  // Erste Aufnahme 40 s nach dem Blockstart, dann alle 300 + 55 s.
  const lights = Array.from({ length: 12 }, (_, i) => light(start + 40_000 + i * 355_000));
  expect(
    (
      await w.call(`/sessions/${sessionId}/captures`, {
        method: 'POST',
        body: { captures: lights },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await w.call(`/sessions/${sessionId}`, {
        method: 'PATCH',
        body: { status: 'completed', endedAtUtc: '2026-09-19T11:00:00Z', outboxPending: 0 },
      })
    ).status,
  ).toBe(200);
  return sessionId;
}

async function close(tenantId: string, sessionId: string) {
  await sessionCloseHandler({
    db: () => Promise.resolve(s.pg.db),
    enqueue: () => Promise.resolve(undefined),
  })({
    job: { id: id(), tenantId, input: { sessionId } } as never,
    now: () => s.clock.now(),
  });
}

describe('Gemessene Overheads (AP-65)', () => {
  it('ohne Messung: getippt wirkt, Rig-Ansicht zeigt nur getippte Werte', async () => {
    const w = await setup();
    const rig = (await w.web(`/rigs/${w.rigId}`)).body;
    expect(rig.overheads).toMatchObject({ minSamples: 10, computedAtUtc: null, nights: 0 });
    const v = values(rig);
    expect(Object.keys(v)).toEqual([
      'slewCenterS',
      'filterChangeS',
      'ditherSettleS',
      'afDurationS',
      'downloadS',
      'flipDurationS',
    ]);
    expect(v.flipDurationS).toMatchObject({
      typedS: 240,
      measured: null,
      effectiveS: 240,
      source: 'typed',
      fixed: false,
    });
    expect((rig.scheduler as Body).overheadFixed).toEqual([]);
  });

  it('Messung nach session_close, wirksam in POST /plan und GET /simulations/input; „fest“ schaltet zurück', async () => {
    const w = await setup();
    const sessionId = await night(w);
    const before = (await w.web(`/rigs/${w.rigId}`)).body;
    s.clock.set(new Date('2026-09-19T12:00:00Z'));
    await close(w.tenantId, sessionId);
    s.clock.set(new Date('2026-09-18T14:00:00Z'));

    const rig = (await w.web(`/rigs/${w.rigId}`)).body;
    // Die Messung ist keine Einstellungsänderung.
    expect(rig.settingsVersion).toBe(before.settingsVersion);
    expect(rig.overheads).toMatchObject({
      computedAtUtc: '2026-09-19T12:00:00Z',
      toNight: NIGHT,
      fromNight: '2026-08-20',
      nights: 1,
    });
    const v = values(rig);
    expect(v.ditherSettleS).toMatchObject({
      typedS: 20,
      measured: { medianS: 50, n: 11, p25S: 50, p75S: 50 },
      effectiveS: 50,
      source: 'measured',
      deviates: true,
    });
    expect(v.afDurationS).toMatchObject({
      measured: { medianS: 240, n: 10 },
      effectiveS: 240,
      source: 'measured',
      deviates: false,
    });
    // Eine Messung reicht nicht: getippt (n < 10).
    expect(v.slewCenterS).toMatchObject({
      measured: { medianS: 40, n: 1 },
      effectiveS: 120,
      source: 'typed',
    });
    // Bündel zeigt dasselbe.
    const bundle = (await w.web('/equipment')).body;
    const inBundle = (bundle.rigs as Body[]).find((r) => r.id === w.rigId) as Body;
    expect(values(inBundle).ditherSettleS?.effectiveS).toBe(50);

    const input = await w.web(`/simulations/input?rigId=${w.rigId}&night=${NIGHT}`);
    const sched = (input.body.input as { scheduler: { overhead: Body; flip: Body } }).scheduler;
    expect(sched.overhead).toMatchObject({ ditherSettleS: 50, afDurationS: 240, slewCenterS: 120 });
    const plan = await w.call('/plan', {
      method: 'POST',
      body: { night: NIGHT, reason: 'initial' },
    });
    expect(plan.status).toBe(200);
    expect(plan.body.inputHash).toBe(input.body.inputHash);

    // Schalter „fest“ (Admin): wieder getippt, Einstellungsversion steigt.
    const put = await w.web(`/rigs/${w.rigId}/scheduler-settings`, {
      method: 'PUT',
      body: { ...SCHEDULER, overheadFixed: ['ditherSettleS'] },
    });
    expect(put.status).toBe(200);
    expect(put.body.settingsVersion).toBe((before.settingsVersion as number) + 1);
    expect((put.body.scheduler as Body).overheadFixed).toEqual(['ditherSettleS']);
    expect(values(put.body).ditherSettleS).toMatchObject({
      effectiveS: 20,
      source: 'typed',
      fixed: true,
      measured: { medianS: 50 },
    });
    const fixedInput = await w.web(`/simulations/input?rigId=${w.rigId}&night=${NIGHT}`);
    expect(
      (fixedInput.body.input as { scheduler: { overhead: Body } }).scheduler.overhead,
    ).toMatchObject({ ditherSettleS: 20, afDurationS: 240 });
    // Ohne Feld bleibt die Auswahl (z. B. Mosaik-Schalter in der Projektansicht).
    const keep = await w.web(`/rigs/${w.rigId}/scheduler-settings`, {
      method: 'PUT',
      body: SCHEDULER,
    });
    expect((keep.body.scheduler as Body).overheadFixed).toEqual(['ditherSettleS']);
  });

  it('mandantengebunden: ein anderer Mandant sieht die Messung nicht', async () => {
    const w = await setup();
    const sessionId = await night(w);
    // Fremder Mandant schließt die Session nicht ab und liest die Messung nicht.
    const other = await s.seed.tenant('beta');
    await close(other, sessionId);
    expect(
      (
        await s.services
          .repositories({ tenantId: w.tenantId })
          .equipment()
          .measuredOverheads([w.rigId])
      ).size,
    ).toBe(0);
    await close(w.tenantId, sessionId);
    expect(
      (
        await s.services
          .repositories({ tenantId: w.tenantId })
          .equipment()
          .measuredOverheads([w.rigId])
      ).size,
    ).toBe(1);
    expect(
      (await s.services.repositories({ tenantId: other }).equipment().measuredOverheads([w.rigId]))
        .size,
    ).toBe(0);
  });
});
