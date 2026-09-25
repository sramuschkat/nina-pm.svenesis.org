/**
 * AP-15 (FA-AUS-01…03, 06, 07, 22; TK 13, 16.2; NT-08, NT-09; PGlite): Fake-Plugin-Nacht vollständig in
 * S-61 mit den Kennzeichen Temperatur/Einstellungen, Korrektur (Regel max, eine Zeile je Nacht, Rückkehr
 * nach *Aktiv*, Rechte), *Als geprüft*, `reconcile` einmal je Standortnacht und ohne Rig mit laufender
 * Session, `tick-5min` (verwaist, Metrik `StaleRunningSessions`, Alarm, fällige Session-Jobs),
 * Betriebsalarme aus Heartbeat und `rig_busy`.
 */
import { runFakeNight } from '@nina-pm/fake-plugin';
import { JobQueue, reconcileSite } from '@nina-pm/db';
import { APP_METRICS, COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { effortDbDeps } from '../src/worker/effort-db';
import { reconcileJobHandler, reconcileSiteTick, sessionTick } from '../src/worker/session-ops';
import { createNotificationService } from '../src/notifications/service';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, ORIGIN_SECRET, type Stack } from './support/stack';

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
  const userIdentity = await s.seed.identity({ mfaEnabled: true });
  const user = await s.seed.member(userIdentity.id, tenantId, 'user');
  const cookie = async (identityId: string) => ({
    [COOKIE_NAMES.session]: await s.seed.session(identityId, tenantId, 'tenant'),
  });
  const ownerCookies = await cookie(ownerIdentity.id);
  const userCookies = await cookie(userIdentity.id);
  const web = async (
    path: string,
    o: { method?: string; body?: unknown; as?: 'owner' | 'user' } = {},
  ) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      cookies: o.as === 'user' ? userCookies : ownerCookies,
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
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id, created_by = $2 WHERE id = $1",
    [pid, user],
  );
  const token = (
    await web('/nina-instances', { method: 'POST', body: { id: id(), rigId: rig.id, name: 'PC' } })
  ).body.token as string;
  const nina = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const res = await s.request(`/api/nina/v1${path}`, {
      method: o.method ?? 'GET',
      headers: { authorization: `Bearer ${token}` },
      ...(o.body !== undefined ? { body: o.body } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const fakeNight = () =>
    runFakeNight({
      baseUrl: 'http://localhost',
      token,
      fetch: (url, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set('x-origin-verify', ORIGIN_SECRET);
        return Promise.resolve(s.app.request(url, { ...init, headers }));
      },
      hooks: {
        releaseLease: async (rigId) => {
          await web(`/rigs/${rigId}/lease/release`, { method: 'POST' });
        },
      },
    });
  const q = async <T>(text: string, params: unknown[] = []) =>
    (await s.pg.admin.query(text, params)).rows as T[];
  return { tenantId, owner, user, web, nina, rig, site, pid, lineId, token, fakeNight, q };
}

describe('S-60/S-61 nach einer Fake-Plugin-Nacht', () => {
  it('Liste und Detail vollständig; eine Aufnahme mit Temperatur- und Einstellungs-Kennzeichen', async () => {
    const t = await setup();
    const night = await t.fakeNight();
    expect(night.steps.filter((x) => x.status === 'failed')).toEqual([]);
    const list = await t.web('/sessions');
    expect(list.status).toBe(200);
    const items = list.body.items as Body[];
    expect(items).toHaveLength(2);
    const online = items.find((x) => x.createdOffline === false) as Body;
    expect(online).toMatchObject({
      night: NIGHT,
      status: 'completed',
      rigName: 'Starfront – GT81 – Ares-M Pro',
      siteTimeZone: 'America/Chicago',
      ninaInstanceName: 'PC',
      frames: 4,
      unassigned: 1,
      reviewed: false,
    });
    // 2 × 300 s + 330 s (abweichend gemeldet) + 300 s nach dem Lease-Verlust.
    expect(online.integrationS).toBe(1230);

    const detail = await t.web(`/sessions/${online.id as string}`);
    expect(detail.status).toBe(200);
    const d = detail.body;
    expect((d.session as Body).planRevision).toBe(2);
    const captures = d.captures as Body[];
    expect(captures.filter((c) => c.frameType === 'light')).toHaveLength(5);
    const flagged = captures.filter((c) => c.temperatureDeviation && c.settingsDeviation);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ exposureS: 330, filterShortName: 'Ha' });
    expect(captures.filter((c) => c.assignment === 'unassigned')).toHaveLength(1);
    // Soll/Ist je Zeile: Ist über alle Sessions der Nacht (3 + 1 nach Lease-Verlust + 1 offline).
    expect(d.rows).toEqual([
      expect.objectContaining({
        exposureLineId: t.lineId,
        filterShortName: 'Ha',
        acquired: 5,
        rejected: 0,
        accepted: 5,
        planned: expect.any(Number),
      }),
    ]);
    expect((d.events as Body[]).map((e) => e.kind)).toEqual(
      expect.arrayContaining(['plan_built', 'af', 'lease_conflict']),
    );
    expect(d.capturesTruncated).toBe(false);
  });

  it('fremde und unbekannte Session → 404; Filter „ungeprüft“ und *Als geprüft markieren*', async () => {
    const t = await setup();
    await t.fakeNight();
    const items = (await t.web('/sessions')).body.items as Body[];
    const first = items[0] as Body;
    expect((await t.web(`/sessions/${id()}`)).status).toBe(404);
    expect(
      (
        await t.web(`/sessions/${first.id as string}/review`, {
          method: 'PUT',
          body: { reviewed: true },
        })
      ).status,
    ).toBe(204);
    const unreviewed = (await t.web('/sessions?unreviewed=true')).body.items as Body[];
    expect(unreviewed.map((x) => x.id)).not.toContain(first.id);
    expect(unreviewed).toHaveLength(1);
    const [row] = await t.q<{ reviewed: boolean; reviewed_by: string }>(
      'SELECT reviewed, reviewed_by FROM session WHERE id = $1',
      [first.id],
    );
    expect(row).toEqual({ reviewed: true, reviewed_by: t.owner });
    // User darf nicht als geprüft markieren (Admin, FA-AUS-07).
    expect(
      (
        await t.web(`/sessions/${first.id as string}/review`, {
          method: 'PUT',
          body: { reviewed: false },
          as: 'user',
        })
      ).status,
    ).toBe(403);
  });
});

describe('Korrektur (FA-AUS-06, DAT-1)', () => {
  it('Verbleibend steigt, Projekt zurück nach Aktiv, eine capture_night-Zeile je Nacht', async () => {
    const t = await setup();
    await t.fakeNight();
    const sessionId = ((await t.web('/sessions')).body.items as Body[])[0]?.id as string;
    // Soll 4 bei 5 akzeptierten → fertig; der Admin setzt das Projekt auf „Bereit zur Bearbeitung“.
    await t.q('UPDATE exposure_line SET planned_count = 4 WHERE id = $1', [t.lineId]);
    await t.q("UPDATE project SET status = 'ready_to_process' WHERE id = $1", [t.pid]);
    const r = await t.web(`/sessions/${sessionId}/corrections`, {
      method: 'POST',
      body: { exposureLineId: t.lineId, rejected: 2, reason: 'clouds' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ rejectedCount: 2, projectStatus: 'active' });
    const [p] = await t.q<{ status: string }>('SELECT status FROM project WHERE id = $1', [t.pid]);
    expect(p?.status).toBe('active');
    const [line] = await t.q<{ acquired_count: number; rejected_count: number }>(
      'SELECT acquired_count, rejected_count FROM exposure_line WHERE id = $1',
      [t.lineId],
    );
    expect(line).toEqual({ acquired_count: 5, rejected_count: 2 });
    // Zweite Korrektur derselben Nacht ersetzt die erste (Regel max, keine zweite Zeile).
    await t.web(`/sessions/${sessionId}/corrections`, {
      method: 'POST',
      body: { exposureLineId: t.lineId, rejected: 1 },
    });
    const nights = await t.q<{ rejected_count: number }>(
      'SELECT rejected_count FROM capture_night WHERE exposure_line_id = $1 AND night = $2',
      [t.lineId, NIGHT],
    );
    expect(nights).toEqual([{ rejected_count: 1 }]);
    const detail = await t.web(`/sessions/${sessionId}`);
    expect((detail.body.rows as Body[])[0]).toMatchObject({
      rejected: 1,
      accepted: 4,
      rejectedCorrection: 1,
    });
  });

  it('User nur für eigene Projekte mit Mandanteneinstellung; fremde Zeile → 422', async () => {
    const t = await setup();
    await t.fakeNight();
    const sessionId = ((await t.web('/sessions')).body.items as Body[])[0]?.id as string;
    const asUser = () =>
      t.web(`/sessions/${sessionId}/corrections`, {
        method: 'POST',
        body: { exposureLineId: t.lineId, rejected: 1 },
        as: 'user',
      });
    expect((await asUser()).status).toBe(403);
    await t.web('/tenant/settings', {
      method: 'PATCH',
      body: { settings: { userCorrections: true } },
    });
    expect((await asUser()).status).toBe(200);
    const foreign = await t.web(`/sessions/${sessionId}/corrections`, {
      method: 'POST',
      body: { exposureLineId: id(), rejected: 1 },
    });
    expect([foreign.status, foreign.body.code]).toEqual([422, 'validation.failed']);
  });
});

describe('reconcile (NT-08)', () => {
  const jobs = () => ({
    queue: () => Promise.resolve(new JobQueue(s.pg.db)),
    handlers: { reconcile: reconcileJobHandler({ db: () => Promise.resolve(s.pg.db) }) },
  });

  it('korrigiert Zähler und verwaiste Zeilen; Daten ohne Abweichung bleiben unverändert', async () => {
    const t = await setup();
    await t.fakeNight();
    const clean = await reconcileSite(s.pg.db, t.tenantId, t.site.id, new Date());
    expect(clean).toMatchObject({ rigsSkipped: 0, linesFixed: 0 });
    await t.q('UPDATE exposure_line SET acquired_count = 99 WHERE id = $1', [t.lineId]);
    await t.q(
      'UPDATE capture_night SET acquired_count = 1, integration_s = 0 WHERE exposure_line_id = $1',
      [t.lineId],
    );
    await t.q(
      "INSERT INTO capture_night (tenant_id, exposure_line_id, night, project_id, acquired_count, sources, updated_at) VALUES ($1, $2, '2026-09-01', $3, 7, '[\"nina\"]', now())",
      [t.tenantId, t.lineId, t.pid],
    );
    const fixed = await reconcileSite(s.pg.db, t.tenantId, t.site.id, new Date());
    expect(fixed).toMatchObject({ linesFixed: 1, rowsFixed: 1, rowsDeleted: 1 });
    const [line] = await t.q<{ acquired_count: number }>(
      'SELECT acquired_count FROM exposure_line WHERE id = $1',
      [t.lineId],
    );
    expect(line?.acquired_count).toBe(5);
    const [n] = await t.q<{ acquired_count: number; integration_s: number }>(
      'SELECT acquired_count, integration_s FROM capture_night WHERE exposure_line_id = $1',
      [t.lineId],
    );
    expect(n).toEqual({ acquired_count: 5, integration_s: 1530 });
  });

  it('läuft je Standortnacht einmal nach dem lokalen Mittag und überspringt ein Rig mit laufender Session', async () => {
    const t = await setup();
    await t.fakeNight();
    await t.q('UPDATE exposure_line SET acquired_count = 99 WHERE id = $1', [t.lineId]);
    await t.q(
      "INSERT INTO session (id, tenant_id, rig_id, night, started_at, status) VALUES ($1, $2, $3, '2026-09-19', '2026-09-19T18:00:00Z', 'running')",
      [id(), t.tenantId, t.rig.id],
    );
    const deps = effortDbDeps(() => Promise.resolve(s.pg.db));
    // 09:00 CDT: vor dem lokalen Mittag der Nacht 19./20.09. läuft nichts.
    expect(await reconcileSiteTick(deps, jobs(), new Date('2026-09-19T14:00:00Z'))).toBe(0);
    // 13:00 CDT: einmal; ein zweiter Tick derselben Nacht legt keinen Job mehr an.
    expect(await reconcileSiteTick(deps, jobs(), new Date('2026-09-19T18:00:00Z'))).toBe(1);
    expect(await reconcileSiteTick(deps, jobs(), new Date('2026-09-19T19:00:00Z'))).toBe(0);
    const jobsRows = await t.q<{ dedupe_key: string; status: string }>(
      "SELECT dedupe_key, status FROM job WHERE kind = 'reconcile'",
    );
    expect(jobsRows).toEqual([{ dedupe_key: `reconcile:${t.site.id}:2026-09-19`, status: 'done' }]);
    // Rig mit laufender Session übersprungen: der verfälschte Zähler bleibt.
    const [line] = await t.q<{ acquired_count: number }>(
      'SELECT acquired_count FROM exposure_line WHERE id = $1',
      [t.lineId],
    );
    expect(line?.acquired_count).toBe(99);
  });
});

describe('tick-5min: verwaiste Sessions, Metrik, Alarm, Session-Jobs (TK 13, 16.2)', () => {
  it('10 min ohne Heartbeat → verwaist, StaleRunningSessions = 1, Alarm an die Admins; offline nicht', async () => {
    const t = await setup();
    let started = 0;
    const insert = (sid: string, over: string) =>
      t.q(
        `INSERT INTO session (id, tenant_id, rig_id, night, started_at, status, last_heartbeat_at, offline_since, session_end_utc, outbox_pending, ended_at) VALUES ($1, $2, $3, '2026-09-18', $4, ${over})`,
        [sid, t.tenantId, t.rig.id, `2026-09-18T13:0${String((started += 1))}:00Z`],
      );
    const [silent, offline, pastEnd, done] = [id(), id(), id(), id()];
    await insert(silent, "'running', '2026-09-18T13:49:00Z', NULL, NULL, NULL, NULL");
    await insert(
      offline,
      "'running', '2026-09-18T12:00:00Z', '2026-09-18T12:00:00Z', NULL, NULL, NULL",
    );
    await insert(
      pastEnd,
      "'running', '2026-09-18T13:59:00Z', NULL, '2026-09-18T11:59:00Z', NULL, NULL",
    );
    await insert(
      done,
      "'completed', '2026-09-18T13:00:00Z', NULL, NULL, 0, '2026-09-18T13:30:00Z'",
    );
    const lines: string[] = [];
    const r = await sessionTick(
      {
        db: () => Promise.resolve(s.pg.db),
        enqueue: (tenantId, input) => s.services.repositories({ tenantId }).job.enqueue(input),
        notify: (tenantId, kind, recipients, payload, now) =>
          createNotificationService(s.pg.db).notify(tenantId, kind, recipients, payload, { now }),
        emit: (line) => lines.push(line),
        service: 'nina-pm-worker',
      },
      new Date('2026-09-18T14:00:00Z'),
    );
    expect(r).toEqual({ stale: 2, noHeartbeat: 1, closing: 3 });
    const status = Object.fromEntries(
      (await t.q<{ id: string; status: string }>('SELECT id, status FROM session')).map((x) => [
        x.id,
        x.status,
      ]),
    );
    expect(status).toEqual({
      [silent]: 'stale',
      [offline]: 'running',
      [pastEnd]: 'stale',
      [done]: 'completed',
    });
    const emf = JSON.parse(lines[0] as string) as Body;
    expect(emf).toMatchObject({ service: 'nina-pm-worker', [APP_METRICS.staleRunningSessions]: 1 });
    const alerts = await t.q<{ recipient_id: string; kind: string }>(
      "SELECT recipient_id, kind FROM notification WHERE kind = 'alert.session_no_heartbeat'",
    );
    expect(alerts).toEqual([{ recipient_id: t.owner, kind: 'alert.session_no_heartbeat' }]);
    const keys = (
      await t.q<{ dedupe_key: string }>(
        "SELECT dedupe_key FROM job WHERE kind IN ('session_close', 'session_report') ORDER BY dedupe_key",
      )
    ).map((x) => x.dedupe_key);
    expect(keys).toEqual(
      [silent, pastEnd, done].flatMap((x) => [`session_close:${x}`, `session_report:${x}`]).sort(),
    );
  });
});

describe('Betriebsalarme in der App (TK 16.2)', () => {
  it('Einstellungsabweichung mit Code-Liste, entprellt; zweite Instanz am belegten Rig → rig_busy', async () => {
    const t = await setup();
    const hb = () =>
      t.nina('/heartbeat', {
        method: 'POST',
        body: {
          state: 'idle',
          pluginVersion: '1.0.0',
          engineVersion: '0.6.1',
          rotator: {
            connected: true,
            rangeType: 'QUARTER',
            rangeStartMechanicalDeg: 0,
            reverse: false,
          },
        },
      });
    await hb();
    await hb();
    const alerts = await t.q<{ payload: { subject: string; codes: string } }>(
      "SELECT payload FROM notification WHERE kind = 'alert.nina_settings_mismatch'",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.payload.codes).toContain('rotator_range_quarter');
    expect(alerts[0]?.payload.subject).toContain('rotator_range_quarter');

    const other = (
      await t.web('/nina-instances', {
        method: 'POST',
        body: { id: id(), rigId: t.rig.id, name: 'Zweit-PC' },
      })
    ).body.token as string;
    const start = (tk: string) =>
      s.request('/api/nina/v1/sessions', {
        method: 'POST',
        headers: { authorization: `Bearer ${tk}` },
        body: {
          id: id(),
          night: NIGHT,
          nightPlanId: null,
          startedAtUtc: '2026-09-18T14:00:00Z',
          offline: false,
        },
      });
    expect((await start(t.token)).status).toBe(201);
    expect((await start(other)).status).toBe(409);
    expect((await start(other)).status).toBe(409);
    const busy = await t.q<{ payload: { subject: string } }>(
      "SELECT payload FROM notification WHERE kind = 'alert.rig_busy'",
    );
    expect(busy).toHaveLength(1);
    expect(busy[0]?.payload.subject).toContain('Zweit-PC');
  });
});
