/**
 * NINA-API AP-14b (TK 5.6, 6.6, 7.3, 7.6; PGlite): Sessions mit Lease, Offline-Modus, Admin-Freigabe,
 * Aufnahmen und Ereignisse (idempotent, Grenzen, Zugehörigkeit), Zähler und Abweichungen, Heartbeat mit
 * Lease-Rückholung (M5/M6) und NINA-Einstellungen (NT-22, NT-E1), Isolation je Session (SEC-53).
 */
import { applyCorrection, closeSessionFlats, type EnqueueInput } from '@nina-pm/db';
import { COOKIE_NAMES, nina } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';
import { sessionTick } from '../src/worker/session-ops';

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

const tickDeps = () => ({
  db: () => Promise.resolve(s.pg.db),
  enqueue: (tenantId: string, input: EnqueueInput) =>
    s.services.repositories({ tenantId }).job.enqueue(input),
  notify: () => Promise.resolve(0),
  emit: () => undefined,
  service: 'nina-pm-worker',
});
const closeJobs = async (sid: string) =>
  (
    await s.pg.admin.query(
      "SELECT dedupe_key, status FROM job WHERE kind = 'session_close' AND input->>'sessionId' = $1 ORDER BY created_at, dedupe_key",
      [sid],
    )
  ).rows as { dedupe_key: string; status: string }[];
const finishJobs = () =>
  s.pg.admin.query("UPDATE job SET status = 'done', dedupe_active = NULL, finished_at = now()");
const leaseRow = async (rigId: string) =>
  (
    await s.pg.admin.query(
      'SELECT active_session_id, offline_until FROM rig_lease WHERE rig_id = $1',
      [rigId],
    )
  ).rows[0] as { active_session_id: string | null; offline_until: Date | null };

describe('Offline-Session für eine vergangene Nacht (P0-2, FA-NIN-04, night.md §1.1)', () => {
  it('offline: gerade beendete Nacht und Nacht vor 20 Tagen → 201; online → 422; zu alt bzw. übermorgen → 422', async () => {
    const t = await setup();
    // 14:00Z = 09:00 CDT: Nacht 2026-09-17 ist vorbei, currentNight = 2026-09-18.
    const justEnded = await t.session(t.tokens.a2, { night: '2026-09-17', offline: true });
    expect([justEnded.status, justEnded.body.code]).toEqual([201, undefined]);
    const older = await t.session(t.tokens.a2, { night: '2026-08-29', offline: true });
    expect([older.status, older.body.code]).toEqual([201, undefined]);
    const online = await t.session(t.tokens.a1, { night: '2026-09-17' });
    expect([online.status, online.body.code]).toEqual([422, 'nina.night_invalid']);
    const tooOld = await t.session(t.tokens.a2, { night: '2026-08-20', offline: true });
    expect([tooOld.status, tooOld.body.code]).toEqual([422, 'nina.night_invalid']);
    const future = await t.session(t.tokens.a2, { night: '2026-09-20', offline: true });
    expect([future.status, future.body.code]).toEqual([422, 'nina.night_invalid']);
  });

  it('bekannte id → 200 vor der Nachtprüfung, auch wenn die Nacht inzwischen vorbei ist', async () => {
    const t = await setup();
    const sid = id();
    const body = { id: sid, startedAtUtc: '2026-09-18T13:30:00Z' };
    expect((await t.session(t.tokens.a1, body)).status).toBe(201);
    s.clock.advance(2 * 86_400_000);
    const again = await t.session(t.tokens.a1, body);
    expect([again.status, again.body.sessionId]).toEqual([200, sid]);
    const offline = { id: id(), night: '2026-09-17', offline: true };
    expect((await t.session(t.tokens.a2, offline)).status).toBe(201);
    s.clock.advance(30 * 86_400_000);
    expect((await t.session(t.tokens.a2, offline)).status).toBe(200);
  });
});

describe('Admin-Freigabe bleibt an der Session (P1-3, M5)', () => {
  it('nach Übernahme und Ende der Ersatz-Session holt die freigegebene Session die Lease auf keinem Weg zurück', async () => {
    const t = await setup();
    const old = id();
    await t.session(t.tokens.a1, { id: old });
    expect((await t.web(`/rigs/${t.rig.id}/lease/release`, { method: 'POST' })).status).toBe(200);
    const next = id();
    expect((await t.session(t.tokens.a2, { id: next })).status).toBe(201);
    await t.call(t.tokens.a2, `/sessions/${next}`, {
      method: 'PATCH',
      body: { status: 'completed', endedAtUtc: '2026-09-18T14:05:00Z', outboxPending: 0 },
    });
    expect((await leaseRow(t.rig.id)).active_session_id).toBeNull();
    // Heartbeat, Offline-Plan-Nachmeldung und Fortsetzen: jeweils leaseLost, Lease bleibt frei.
    const beat = await t.hb(t.tokens.a1, { sessionId: old });
    expect(beat.body.lease).toEqual({ untilUtc: null, leaseLost: true });
    const offlinePlan = await t.call(t.tokens.a1, `/sessions/${old}`, {
      method: 'PATCH',
      body: {
        offline: true,
        offlinePlan: {
          nightPlanId: id(),
          inputHash: `sha256:${'a'.repeat(64)}`,
          engineVersion: '0.6.0',
          blocks: [],
        },
      },
    });
    expect([offlinePlan.status, offlinePlan.body.lease]).toEqual([
      200,
      { untilUtc: null, leaseLost: true },
    ]);
    const resume = await t.call(t.tokens.a1, `/sessions/${old}`, {
      method: 'PATCH',
      body: { status: 'running', resumedAtUtc: '2026-09-18T14:06:00Z' },
    });
    expect([resume.status, resume.body.lease]).toEqual([200, { untilUtc: null, leaseLost: true }]);
    expect((await leaseRow(t.rig.id)).active_session_id).toBeNull();
  });

  it('zweite Freigabe (andere Session) hebt den Ausschluss der ersten nicht auf', async () => {
    const t = await setup();
    const first = id();
    await t.session(t.tokens.a1, { id: first });
    await t.web(`/rigs/${t.rig.id}/lease/release`, { method: 'POST' });
    const second = id();
    await t.session(t.tokens.a2, { id: second });
    const release = await t.web(`/rigs/${t.rig.id}/lease/release`, { method: 'POST' });
    expect(release.body.releasedSessionId).toBe(second);
    const beatFirst = await t.hb(t.tokens.a1, { sessionId: first });
    expect((beatFirst.body.lease as Body).leaseLost).toBe(true);
    const beatSecond = await t.hb(t.tokens.a2, { sessionId: second });
    expect((beatSecond.body.lease as Body).leaseLost).toBe(true);
    // Eine neue Session startet normal.
    expect((await t.session(t.tokens.a1)).status).toBe(201);
  });
});

describe('offline_until gehört dem Halter (P2, FA-NIN-04)', () => {
  it('Heartbeat einer Session ohne Lease friert nicht ein', async () => {
    const t = await setup();
    const holder = id();
    await t.session(t.tokens.a1, { id: holder });
    const other = id();
    await t.session(t.tokens.a2, { id: other, offline: true });
    await t.hb(t.tokens.a2, { state: 'offline', sessionId: other });
    expect((await leaseRow(t.rig.id)).offline_until).toBeNull();
    // Die Lease des Halters verfällt normal (nicht eingefroren).
    s.clock.advance(4 * 60_000);
    expect((await t.session(t.tokens.a2)).status).toBe(201);
  });

  it('Online-Heartbeats einer anderen Instanz tauen das Einfrieren des Halters nicht auf', async () => {
    const t = await setup();
    const frozen = id();
    await t.session(t.tokens.a1, { id: frozen });
    await t.hb(t.tokens.a1, { state: 'offline', sessionId: frozen });
    const until = (await leaseRow(t.rig.id)).offline_until;
    expect(until).not.toBeNull();
    const side = id();
    await t.session(t.tokens.a2, { id: side, offline: true });
    await t.hb(t.tokens.a2, { sessionId: side });
    await t.hb(t.tokens.a2);
    expect((await leaseRow(t.rig.id)).offline_until).toEqual(until);
    s.clock.advance(30 * 60_000);
    expect((await t.session(t.tokens.a2)).status).toBe(409);
    // Der Halter kommt zurück: Einfrieren endet, die Lease läuft normal weiter.
    const back = await t.hb(t.tokens.a1, { sessionId: frozen });
    expect((back.body.lease as Body).leaseLost).toBe(false);
    expect((await leaseRow(t.rig.id)).offline_until).toBeNull();
  });
});

describe('Filterrad aus dem Heartbeat (P1-4, NT-E1)', () => {
  it('Meldung wird gespeichert, fehlender Platz bleibt bestätigt, unveränderte Meldung höchstens stündlich', async () => {
    const t = await setup();
    const wheel = [
      { position: 1, name: 'L', focusOffset: 0 },
      { position: 2, name: 'R', focusOffset: 12 },
    ];
    await t.hb(t.tokens.a1, { filterWheel: wheel });
    const view = async () => (await t.web(`/rigs/${t.rig.id}/filter-wheel`)).body;
    const first = await view();
    expect(first.reported).toEqual({ reportedAt: '2026-09-18T14:00:00Z', slots: wheel });
    // Platz 0 fehlt in der Meldung: weder Alarmcode noch Entbestätigung (wie settingsMismatch).
    const slot0 = (first.slots as Body[]).find((x) => x.position === 0);
    expect(slot0?.ninaConfirmedAt).not.toBeNull();
    const state = await s.pg.admin.query("SELECT last_state FROM nina_instance WHERE name = 'A1'");
    expect(
      (state.rows[0] as { last_state: { mismatchCodes: string[] } }).last_state.mismatchCodes,
    ).not.toContain('filter_wheel_changed');
    s.clock.advance(10 * 60_000);
    await t.hb(t.tokens.a1, { filterWheel: wheel });
    expect(((await view()).reported as Body).reportedAt).toBe('2026-09-18T14:00:00Z');
    s.clock.advance(60 * 60_000);
    await t.hb(t.tokens.a1, { filterWheel: wheel });
    expect(((await view()).reported as Body).reportedAt).toBe('2026-09-18T15:10:00Z');
    // Geänderte Meldung sofort.
    s.clock.advance(60_000);
    await t.hb(t.tokens.a1, { filterWheel: [{ position: 1, name: 'L', focusOffset: 0 }] });
    expect(((await view()).reported as Body).reportedAt).toBe('2026-09-18T15:11:00Z');
  });

  it('umbenannter bestätigter Platz → unbestätigt, settings_version steigt genau einmal', async () => {
    const t = await setup();
    const before = (await t.web(`/rigs/${t.rig.id}/filter-wheel`)).body.settingsVersion as number;
    const renamed = [{ position: 0, name: 'H-alpha 7nm', focusOffset: 0 }];
    await t.hb(t.tokens.a1, { filterWheel: renamed });
    await t.hb(t.tokens.a1, { filterWheel: renamed });
    const view = (await t.web(`/rigs/${t.rig.id}/filter-wheel`)).body;
    expect(view.settingsVersion).toBe(before + 1);
    const slot0 = (view.slots as Body[]).find((x) => x.position === 0);
    expect(slot0).toMatchObject({
      ninaConfirmedAt: null,
      ninaConfirmedBy: null,
      reportedName: 'H-alpha 7nm',
    });
  });
});

describe('session_close nach Rückkehr aus stale (P1-5, TK 13, NIN5-7)', () => {
  it('verwaist geschlossen, per Heartbeat zurück, später beendet → wird erneut geschlossen', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    s.clock.advance(11 * 60_000);
    await sessionTick(tickDeps(), s.clock.now());
    expect(await closeJobs(sid)).toEqual([
      { dedupe_key: `session_close:${sid}`, status: 'pending' },
    ]);
    await finishJobs();
    // Kurze Lücke: der Heartbeat holt die Session zurück (stale → running) und schaltet neu scharf.
    const beat = await t.hb(t.tokens.a1, { sessionId: sid });
    expect((beat.body.lease as Body).leaseLost).toBe(false);
    expect((await closeJobs(sid)).map((j) => j.dedupe_key)).toEqual([
      `session_close:${sid}:rearmed:2026-09-18T14:11:00Z`,
    ]);
    // Ein Close-Job für eine inzwischen wieder laufende Session schließt nichts.
    expect((await closeSessionFlats(s.pg.db, t.tenantId, sid)).skipped).toBe(true);
    // Echtes Ende mit ausstehender Outbox: der Tick schließt nach 6 h (vorher blockierte der alte Job).
    await t.call(t.tokens.a1, `/sessions/${sid}`, {
      method: 'PATCH',
      body: { status: 'completed', endedAtUtc: '2026-09-18T14:20:00Z', outboxPending: 3 },
    });
    s.clock.set(new Date('2026-09-18T20:30:00Z'));
    expect((await sessionTick(tickDeps(), s.clock.now())).closing).toBe(1);
    expect((await closeJobs(sid)).map((j) => j.dedupe_key)).toEqual([
      `session_close:${sid}:rearmed:2026-09-18T14:11:00Z`,
      `session_close:${sid}`,
    ]);
    expect((await sessionTick(tickDeps(), s.clock.now())).closing).toBe(0);
  });

  it('nach Rückkehr erneut verwaist → zweiter Close; Ende direkt aus stale schaltet ebenfalls neu scharf', async () => {
    const t = await setup();
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    s.clock.advance(11 * 60_000);
    await sessionTick(tickDeps(), s.clock.now());
    await finishJobs();
    await t.hb(t.tokens.a1, { sessionId: sid });
    s.clock.advance(11 * 60_000);
    expect((await sessionTick(tickDeps(), s.clock.now())).closing).toBe(1);
    await finishJobs();
    const done = await t.call(t.tokens.a1, `/sessions/${sid}`, {
      method: 'PATCH',
      body: { status: 'aborted', endedAtUtc: '2026-09-18T14:25:00Z', outboxPending: 0 },
    });
    expect(done.body.status).toBe('aborted');
    const keys = (await closeJobs(sid)).map((j) => j.dedupe_key);
    expect(keys).toHaveLength(3);
    expect(keys.filter((k) => k === `session_close:${sid}`)).toHaveLength(1);
  });

  it('PATCH einer abgeschlossenen Session legt Jobs nur beim Ende bzw. beim Leeren der Outbox an', async () => {
    const t = await setup();
    const count = async () =>
      (
        (
          await s.pg.admin.query(
            "SELECT count(*)::int AS n FROM job WHERE kind IN ('session_close', 'session_report')",
          )
        ).rows[0] as { n: number }
      ).n;
    const sid = id();
    await t.session(t.tokens.a1, { id: sid });
    const patch = (body: Body) =>
      t.call(t.tokens.a1, `/sessions/${sid}`, { method: 'PATCH', body });
    await patch({ status: 'completed', endedAtUtc: '2026-09-18T14:05:00Z', outboxPending: 2 });
    expect(await count()).toBe(0);
    await patch({ status: 'completed', outboxPending: 0 });
    expect(await count()).toBe(2);
    await finishJobs();
    await patch({ status: 'completed', outboxPending: 0 });
    await patch({ ninaConditions: {} });
    expect(await count()).toBe(2);

    const direct = id();
    await t.session(t.tokens.a1, { id: direct });
    const end = { status: 'completed', endedAtUtc: '2026-09-18T14:06:00Z', outboxPending: 0 };
    await t.call(t.tokens.a1, `/sessions/${direct}`, { method: 'PATCH', body: end });
    expect(await count()).toBe(4);
    await finishJobs();
    await t.call(t.tokens.a1, `/sessions/${direct}`, { method: 'PATCH', body: end });
    expect(await count()).toBe(4);
  });
});
