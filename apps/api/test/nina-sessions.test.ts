/**
 * NINA-API AP-14b (TK 5.6, 6.6, 7.3, 7.6; PGlite): Sessions mit Lease, Offline-Modus, Admin-Freigabe,
 * Aufnahmen und Ereignisse (idempotent, Grenzen, Zugehörigkeit), Zähler und Abweichungen, Heartbeat mit
 * Lease-Rückholung (M5/M6) und NINA-Einstellungen (NT-22, NT-E1), Isolation je Session (SEC-53).
 */
import { applyCorrection } from '@nina-pm/db';
import { COOKIE_NAMES, nina } from '@nina-pm/shared';
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
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = {
    [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant'),
  };
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
  const rigB = await eq.createRig(
    id(),
    { ...rigInput(site.id, telescope.id, camera.id), name: 'B' },
    now,
  );
  await eq.updateScheduler(rig.id, SCHEDULER, now);
  await eq.putFilterWheel(
    rig.id,
    { slots: [{ position: 0, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
    now,
  );
  const project = async (rigId: string) => {
    const created = await web('/projects', {
      method: 'POST',
      body: {
        id: id(),
        name: `P ${rigId.slice(0, 4)}`,
        rigId,
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
    return { pid, panelId, lineId };
  };
  const a = await project(rig.id);
  const b = await project(rigB.id);
  const token = async (rigId: string, name: string) =>
    (await web('/nina-instances', { method: 'POST', body: { id: id(), rigId, name } })).body
      .token as string;
  const tokens = {
    a1: await token(rig.id, 'A1'),
    a2: await token(rig.id, 'A2'),
    b: await token(rigB.id, 'B'),
  };
  const call = async (tk: string, path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/nina/v1${path}`, {
      method: o.method ?? 'GET',
      headers: { authorization: `Bearer ${tk}` },
      ...(o.body !== undefined ? { body: o.body } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const plan = async (tk: string, sessionId?: string) =>
    (
      await call(tk, '/plan', {
        method: 'POST',
        body: { night: NIGHT, reason: 'initial', ...(sessionId ? { sessionId } : {}) },
      })
    ).body;
  let started = 0;
  const session = (tk: string, over: Record<string, unknown> = {}) => {
    started += 1;
    return call(tk, '/sessions', {
      method: 'POST',
      body: {
        id: id(),
        night: NIGHT,
        nightPlanId: null,
        startedAtUtc: `2026-09-18T13:${String(10 + started)}:00Z`,
        offline: false,
        ...over,
      },
    });
  };
  const light = (over: Record<string, unknown> = {}) => ({
    id: id(),
    frameType: 'light',
    capturedAtUtc: '2026-09-19T03:00:00Z',
    exposureMidUtc: '2026-09-19T03:02:30Z',
    night: NIGHT,
    blockId: id(),
    projectId: a.pid,
    panelId: a.panelId,
    exposureLineId: a.lineId,
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
    nightPlanId: id(),
    ...over,
  });
  const captures = (tk: string, sessionId: string, list: unknown[]) =>
    call(tk, `/sessions/${sessionId}/captures`, { method: 'POST', body: { captures: list } });
  const hb = (tk: string, over: Record<string, unknown> = {}) =>
    call(tk, '/heartbeat', {
      method: 'POST',
      body: { state: 'running', pluginVersion: '1.0.0', engineVersion: '0.6.0', ...over },
    });
  const lineCounts = async () =>
    (
      await s.pg.admin.query(
        'SELECT acquired_count, bonus_count FROM exposure_line WHERE id = $1',
        [a.lineId],
      )
    ).rows[0] as { acquired_count: number; bonus_count: number };
  return {
    tenantId,
    owner,
    web,
    rig,
    rigB,
    ha,
    a,
    b,
    tokens,
    call,
    plan,
    session,
    light,
    captures,
    hb,
    lineCounts,
    eq,
  };
}

describe('Sessions und Lease (TK 5.6)', () => {
  it('POST zweimal mit gleicher id → 200; zweite Instanz → 409 session.rig_busy; vergangene Nacht → 422', async () => {
    const t = await setup();
    const sid = id();
    const first = await t.session(t.tokens.a1, { id: sid });
    expect(first.status).toBe(201);
    expect(nina.NinaSessionCreated.safeParse(first.body).success).toBe(true);
    expect((first.body.lease as Body).untilUtc).toBe('2026-09-18T14:03:00Z');
    expect((await t.session(t.tokens.a1, { id: sid })).status).toBe(200);
    const busy = await t.session(t.tokens.a2);
    expect([busy.status, busy.body.code]).toEqual([409, 'session.rig_busy']);
    const past = await t.session(t.tokens.a1, { night: '2026-09-16' });
    expect([past.status, past.body.code]).toEqual([422, 'nina.night_invalid']);
  });

  it('eigene abgelaufene Lease → PATCH running setzt fort; completed ist endgültig (409 session.closed)', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    s.clock.advance(10 * 60_000);
    const resumed = await t.call(t.tokens.a1, `/sessions/${sid}`, {
      method: 'PATCH',
      body: { status: 'running', resumedAtUtc: '2026-09-18T14:10:00Z' },
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.lease).toEqual({ untilUtc: '2026-09-18T14:13:00Z', leaseLost: false });
    const done = await t.call(t.tokens.a1, `/sessions/${sid}`, {
      method: 'PATCH',
      body: { status: 'completed', endedAtUtc: '2026-09-18T14:11:00Z', outboxPending: 0 },
    });
    expect(done.body.status).toBe('completed');
    const again = await t.call(t.tokens.a1, `/sessions/${sid}`, {
      method: 'PATCH',
      body: { status: 'running', resumedAtUtc: '2026-09-18T14:12:00Z' },
    });
    expect([again.status, again.body.code]).toEqual([409, 'session.closed']);
    const jobs = await s.pg.admin.query('SELECT kind FROM job ORDER BY kind');
    expect(jobs.rows.map((r) => (r as { kind: string }).kind)).toEqual(
      expect.arrayContaining(['session_close', 'session_report']),
    );
  });

  it('Offline-Session ohne Lease angenommen; Offline-Modus friert die Lease ein; Admin-Freigabe beendet das', async () => {
    const t = await setup();
    const held = id();
    await t.session(t.tokens.a1, { id: held });
    await t.hb(t.tokens.a1, { state: 'offline', sessionId: held });
    s.clock.advance(30 * 60_000);
    // Eingefroren: auch nach 30 min hält die Offline-Session die Lease.
    expect((await t.session(t.tokens.a2)).status).toBe(409);
    // Eine offline angelegte Session wird ohne Lease angenommen.
    const offline = await t.session(t.tokens.a2, { offline: true });
    expect([offline.status, offline.body.code]).toEqual([201, undefined]);
    expect((offline.body.lease as Body).untilUtc).toBeNull();
    // Admin-Freigabe → Ersatzrechner kann starten; die alte Session erfährt leaseLost.
    const release = await t.web(`/rigs/${t.rig.id}/lease/release`, { method: 'POST' });
    expect(release.body.releasedSessionId).toBe(held);
    expect((await t.session(t.tokens.a2)).status).toBe(201);
    const lost = await t.hb(t.tokens.a1, { sessionId: held });
    expect((lost.body.lease as Body).leaseLost).toBe(true);
  });

  it('Lease verfallen, niemand übernahm → Heartbeat holt sie zurück (M5), stale → running (M6)', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    s.clock.advance(20 * 60_000);
    await s.pg.admin.query("UPDATE session SET status = 'stale' WHERE id = $1", [sid]);
    const r = await t.hb(t.tokens.a1, { sessionId: sid });
    expect(nina.NinaHeartbeatResponse.safeParse(r.body).error?.issues ?? []).toEqual([]);
    expect(r.body.lease).toEqual({ untilUtc: '2026-09-18T14:23:00Z', leaseLost: false });
    const row = await s.pg.admin.query('SELECT status FROM session WHERE id = $1', [sid]);
    expect((row.rows[0] as { status: string }).status).toBe('running');
    expect(r.body.serverTimeUtc).toBe('2026-09-18T14:20:00Z');
  });

  it('Planrevision 2 → session_end_utc aus Revision 2 (NT-09)', async () => {
    const t = await setup();
    const p1 = await t.plan(t.tokens.a1);
    const sid = id();
    await t.session(t.tokens.a1, { id: sid, nightPlanId: p1.nightPlanId });
    await t.eq.updateScheduler(t.rig.id, { ...SCHEDULER, ditherEvery: 2 }, s.clock.now());
    const p2 = await t.plan(t.tokens.a1, sid);
    expect(p2.revision).toBe(2);
    const row = await s.pg.admin.query(
      'SELECT to_char(session_end_utc AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS"Z"\') AS e FROM session WHERE id = $1',
      [sid],
    );
    expect((row.rows[0] as { e: string }).e).toBe(p2.sessionEndUtc);
  });
});

describe('Isolation je Session (SEC-53)', () => {
  it('Token von Rig B auf eine Session von Rig A → 404 für PATCH, captures, events', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    const patch = await t.call(t.tokens.b, `/sessions/${sid}`, {
      method: 'PATCH',
      body: { status: 'completed', endedAtUtc: '2026-09-18T14:00:00Z' },
    });
    expect(patch.status).toBe(404);
    expect((await t.captures(t.tokens.b, sid, [t.light()])).status).toBe(404);
    const ev = await t.call(t.tokens.b, `/sessions/${sid}/events`, {
      method: 'POST',
      body: { events: [{ id: id(), occurredAtUtc: '2026-09-18T14:00:00Z', kind: 'warning' }] },
    });
    expect(ev.status).toBe(404);
    // Idempotenz gilt nur je Rig: dieselbe id von Rig B → 404, nicht 200.
    expect((await t.session(t.tokens.b, { id: sid })).status).toBe(404);
  });
});

describe('Aufnahmen (TK 6.6)', () => {
  it('Doppel-Upload zählt einmal; Batch 501 → 413; fremde Zeile → rejected_invalid; aborted ohne fileName ok', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    const one = t.light();
    const r1 = await t.captures(t.tokens.a1, sid, [one]);
    expect(r1.body.results).toEqual([{ id: one.id, status: 'accepted' }]);
    const r2 = await t.captures(t.tokens.a1, sid, [one]);
    expect(r2.body.results).toEqual([{ id: one.id, status: 'duplicate' }]);
    expect((await t.lineCounts()).acquired_count).toBe(1);
    const big = Array.from({ length: 501 }, () => t.light());
    const r3 = await t.captures(t.tokens.a1, sid, big);
    expect([r3.status, r3.body.code]).toEqual([413, 'capture.batch_too_large']);
    const foreign = t.light({
      projectId: t.b.pid,
      panelId: t.b.panelId,
      exposureLineId: t.b.lineId,
    });
    const aborted = t.light({ result: 'aborted', fileName: undefined });
    const r4 = await t.captures(t.tokens.a1, sid, [foreign, aborted]);
    expect(r4.body.results).toEqual([
      { id: foreign.id, status: 'rejected_invalid' },
      { id: aborted.id, status: 'accepted' },
    ]);
    expect((await t.lineCounts()).acquired_count).toBe(1);
  });

  it('abweichende Belichtungszeit → gespeichert, gezählt, settings_deviation, integration_s mit gemeldeter Zeit', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    const c = t.light({ exposureS: 240 });
    await t.captures(t.tokens.a1, sid, [c]);
    const row = await s.pg.admin.query('SELECT settings_deviation FROM capture WHERE id = $1', [
      c.id,
    ]);
    expect((row.rows[0] as { settings_deviation: boolean }).settings_deviation).toBe(true);
    const cn = await s.pg.admin.query(
      'SELECT acquired_count, integration_s FROM capture_night WHERE exposure_line_id = $1',
      [t.a.lineId],
    );
    expect(cn.rows[0]).toEqual({ acquired_count: 1, integration_s: 240 });
  });

  it('nach Lease-Verlust gespeichert und markiert; späte Meldung zu completed → gezählt', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    await t.web(`/rigs/${t.rig.id}/lease/release`, { method: 'POST' });
    const r = await t.captures(t.tokens.a1, sid, [t.light()]);
    expect(r.body.results).toEqual([expect.objectContaining({ status: 'accepted' })]);
    const ev = await s.pg.admin.query('SELECT kind FROM session_event WHERE session_id = $1', [
      sid,
    ]);
    expect(ev.rows.map((x) => (x as { kind: string }).kind)).toContain('lease_conflict');
    await t.call(t.tokens.a1, `/sessions/${sid}`, {
      method: 'PATCH',
      body: { status: 'completed', endedAtUtc: '2026-09-18T14:00:00Z', outboxPending: 1 },
    });
    await t.captures(t.tokens.a1, sid, [t.light()]);
    expect((await t.lineCounts()).acquired_count).toBe(2);
  });

  it('Flats und Dark-Flats in flat_combination (Zehntelgrad-Schlüssel, erste Meldung gewinnt)', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    const calib = (frameType: string, over: Record<string, unknown> = {}) => {
      const light = t.light({ frameType, exposureS: 2.4, rotatorMechDeg: 270.44, ...over });
      const lightOnly = new Set([
        'blockId',
        'projectId',
        'panelId',
        'exposureLineId',
        'raDeg',
        'decDeg',
        'rotationDeg',
        'pierSide',
        'bonus',
      ]);
      const rest = Object.fromEntries(Object.entries(light).filter(([k]) => !lightOnly.has(k)));
      return { ...rest, projectIds: [t.a.pid], flatsPlanned: 2, darkFlatsPlanned: 1 };
    };
    await t.captures(t.tokens.a1, sid, [calib('flat'), calib('flat', { flatsPlanned: 9 })]);
    await t.captures(t.tokens.a1, sid, [calib('dark_flat')]);
    const row = await s.pg.admin.query(
      'SELECT rotator_mech_deg_dg, flats_planned, flats_taken, dark_flats_taken, status FROM flat_combination WHERE session_id = $1',
      [sid],
    );
    expect(row.rows).toEqual([
      {
        rotator_mech_deg_dg: 2704,
        flats_planned: 2,
        flats_taken: 2,
        dark_flats_taken: 1,
        status: 'done',
      },
    ]);
  });

  it('nachträgliche Zuordnung legt capture_night an und zählt (DAT5-12)', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    const c = t.light({
      projectId: null,
      panelId: null,
      exposureLineId: null,
      assignment: 'unassigned',
    });
    const r = await t.captures(t.tokens.a1, sid, [c]);
    expect(r.body.results).toEqual([{ id: c.id, status: 'unassigned' }]);
    expect((await t.lineCounts()).acquired_count).toBe(0);
    const a = await t.web(`/captures/${c.id}/assign`, {
      method: 'PATCH',
      body: { exposureLineId: t.a.lineId },
    });
    expect(a.status).toBe(204);
    expect((await t.lineCounts()).acquired_count).toBe(1);
    const wrong = await t.web(`/captures/${c.id}/assign`, {
      method: 'PATCH',
      body: { exposureLineId: t.b.lineId },
    });
    expect([wrong.status, wrong.body.code]).toEqual([409, 'capture.assign_mismatch']);
  });

  it('Korrektur unter der Anzahl einzeln verworfener → 409 correction.conflict; Zähler bleibt max', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    await t.captures(t.tokens.a1, sid, [t.light(), t.light(), t.light()]);
    await s.pg.admin.query(
      'UPDATE capture_night SET rejected_individual = 2, rejected_count = 2 WHERE exposure_line_id = $1',
      [t.a.lineId],
    );
    await s.pg.admin.query('UPDATE exposure_line SET rejected_count = 2 WHERE id = $1', [
      t.a.lineId,
    ]);
    const base = {
      tenantId: t.tenantId,
      userId: t.owner,
      exposureLineId: t.a.lineId,
      night: NIGHT,
      reason: 'clouds',
      comment: null,
    };
    await expect(
      applyCorrection(s.pg.db, { ...base, rejected: 1 }, s.clock.now()),
    ).rejects.toMatchObject({
      code: 'correction.conflict',
    });
    const ok = await applyCorrection(s.pg.db, { ...base, rejected: 3 }, s.clock.now());
    expect(ok.rejectedCount).toBe(3);
    const line = await s.pg.admin.query('SELECT rejected_count FROM exposure_line WHERE id = $1', [
      t.a.lineId,
    ]);
    expect((line.rows[0] as { rejected_count: number }).rejected_count).toBe(3);
  });
});

describe('Ereignisse (SEC-52)', () => {
  it('201 Ereignisse → 413, übergroßes data → 422, idempotent', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    const ev = () => ({
      id: id(),
      occurredAtUtc: '2026-09-18T14:00:00Z',
      kind: 'warning',
      code: 'camera_temperature',
    });
    const big = await t.call(t.tokens.a1, `/sessions/${sid}/events`, {
      method: 'POST',
      body: { events: Array.from({ length: 201 }, ev) },
    });
    expect([big.status, big.body.code]).toEqual([413, 'event.batch_too_large']);
    const huge = await t.call(t.tokens.a1, `/sessions/${sid}/events`, {
      method: 'POST',
      body: { events: [{ ...ev(), data: { x: 'y'.repeat(9000) } }] },
    });
    expect(huge.status).toBe(422);
    const e = ev();
    const r1 = await t.call(t.tokens.a1, `/sessions/${sid}/events`, {
      method: 'POST',
      body: { events: [e] },
    });
    const r2 = await t.call(t.tokens.a1, `/sessions/${sid}/events`, {
      method: 'POST',
      body: { events: [e] },
    });
    expect([r1.body, r2.body]).toEqual([
      { accepted: 1, duplicate: 0 },
      { accepted: 0, duplicate: 1 },
    ]);
  });
});

describe('Heartbeat: NINA-Einstellungen (NT-22, NT-E1, M2, M7)', () => {
  it('umbenannter Filter an bestätigtem Platz → unbestätigt, filter_wheel_changed, targets mit null', async () => {
    const t = await setup();
    const beat = await t.hb(t.tokens.a1, {
      filterWheel: [{ position: 0, name: 'H-alpha 7nm', focusOffset: 0 }],
      rotator: {
        connected: true,
        rangeType: 'QUARTER',
        rangeStartMechanicalDeg: 0,
        reverse: false,
      },
      sequenceTriggers: { autofocus: [], autofocusAfterTimeMin: null, dither: [] },
    });
    expect([beat.status, beat.body.code]).toEqual([200, undefined]);
    const state = await s.pg.admin.query("SELECT last_state FROM nina_instance WHERE name = 'A1'");
    const codes = (state.rows[0] as { last_state: { mismatchCodes: string[] } }).last_state
      .mismatchCodes;
    expect(codes).toEqual(
      expect.arrayContaining([
        'filter_wheel_changed',
        'rotator_range_quarter',
        'af_time_trigger_missing',
      ]),
    );
    const targets = await t.call(t.tokens.a1, '/targets');
    const line = ((targets.body.projects as Body[])[0]?.panels as { lines: Body[] }[])[0]?.lines[0];
    expect(line?.ninaFilterName).toBeNull();
  });
});
