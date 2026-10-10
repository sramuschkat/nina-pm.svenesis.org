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
    // Optionale NINA-Metriken (AP-62) aus `capture.metrics`.
    expect(captures.find((c) => c.frameType === 'light')).toMatchObject({ hfr: 2.1, stars: 380 });
    // Soll/Ist je Zeile (Entscheidung Sven 07.10.2026): Ist nur dieser Session (3 + 1 nach Lease-Verlust),
    // die Nacht hat zusätzlich 1 offline.
    expect(d.rows).toEqual([
      expect.objectContaining({
        exposureLineId: t.lineId,
        filterShortName: 'Ha',
        acquired: 4,
        rejected: 0,
        accepted: 4,
        planned: expect.any(Number),
        plannedSeries: null,
        plannedLater: false,
        night: { acquired: 5, rejected: 0, rejectedIndividual: 0, rejectedCorrection: 0 },
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
    // Eine Session der Nacht noch ungeprüft → die Nacht bleibt ungeprüft; beide geprüft → 0.
    expect((await t.web('/sessions/unreviewed')).body).toMatchObject({ unreviewed: 1 });
    await t.web(`/sessions/${(unreviewed[0] as Body).id as string}/review`, {
      method: 'PUT',
      body: { reviewed: true },
    });
    expect((await t.web('/sessions/unreviewed')).body).toEqual({
      unreviewed: 0,
      firstUnreviewed: null,
    });
    await t.web(`/sessions/${(unreviewed[0] as Body).id as string}/review`, {
      method: 'PUT',
      body: { reviewed: false },
    });
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

describe('AP-64: Nächte-Liste und Kennzahlen (S-60)', () => {
  it('Einträge mit Effizienz, Wetter und Projekt-Chips; seitenweise mit Cursor', async () => {
    const t = await setup();
    await t.fakeNight();
    await t.q(
      `UPDATE session SET forecast_snapshot = '{"ratingIndex": 3, "nightMean": 0.81}'::jsonb WHERE created_offline = false`,
    );
    const list = await t.web('/sessions');
    expect(list.status).toBe(200);
    expect(list.body.nextCursor).toBeNull();
    const items = list.body.items as Body[];
    const online = items.find((x) => x.createdOffline === false) as Body;
    expect(online.weather).toEqual({ ratingIndex: 3, nightMean: 0.81 });
    // Chips: nicht verworfene, zugeordnete Lights dieser Session je Filter, Ersteller des Projekts.
    expect(online.projects).toEqual([
      {
        projectId: t.pid,
        projectName: 'NGC 281',
        createdBy: t.user,
        transit: false,
        frames: 4,
        filters: [{ filter: 'Ha', frames: 4 }],
      },
    ]);
    // Effizienz wie die Kennzahlen des Details (dieselbe Rechnung, AP-31).
    const kpis = (await t.web(`/sessions/${online.id as string}`)).body.kpis as Body;
    expect(online.efficiency).toEqual({
      exposureS: kpis.exposureS,
      usableDarkS: kpis.usableDarkS,
      pct: kpis.efficiencyPct,
    });

    // Eine Seite schneidet keine Nacht an (eine Karte je Nacht und Rig, 07.10.2026): limit=1 liefert beide Sessions.
    const whole = await t.web('/sessions?limit=1');
    expect((whole.body.items as Body[]).map((x) => x.id)).toEqual(items.map((x) => x.id));
    expect(whole.body.nextCursor).toBeNull();
    // Eine weitere Nacht davor: die erste Seite endet nach der Nacht, die zweite bringt die ältere.
    await t.q(
      `INSERT INTO session SELECT (json_populate_record(null::session, (to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'night', '2026-09-17', 'status', 'completed'))::json)).* FROM session s WHERE id = $1`,
      [online.id],
    );
    const first = await t.web('/sessions?limit=1');
    expect((first.body.items as Body[]).map((x) => x.night)).toEqual([NIGHT, NIGHT]);
    const cursor = first.body.nextCursor as string;
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = await t.web(`/sessions?limit=1&cursor=${cursor}`);
    expect(second.status).toBe(200);
    expect((second.body.items as Body[]).map((x) => x.night)).toEqual(['2026-09-17']);
    expect(second.body.nextCursor).toBeNull();
    expect((await t.web('/sessions?cursor=bm9wZQ')).status).toBe(422);
  });

  it('Kennzahlen je Rig und Zeitraum, mandantengebunden', async () => {
    const t = await setup();
    await t.fakeNight();
    const summary = await t.web(`/sessions/summary?rigId=${t.rig.id}&from=${NIGHT}&to=${NIGHT}`);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      nights: 1,
      // 5 Lights der Nacht (1 offline + 4), 1530 s Belichtung < 1 h → nicht nutzbar.
      usableNights: 0,
      lights: 5,
      projects: 1,
      // Ungeprüft zählt Nächte: zwei ungeprüfte Sessions in einer Nacht = 1.
      unreviewed: 1,
      firstUnreviewed: { rigId: t.rig.id, night: NIGHT },
    });
    expect(summary.body.integrationS).toBeGreaterThan(1230);
    // Startseite (Performance 10.10.2026): dieselbe Zählung „ungeprüft“ ohne Kennzahlen über alle Aufnahmen.
    expect((await t.web('/sessions/unreviewed')).body).toEqual({
      unreviewed: 1,
      firstUnreviewed: { rigId: t.rig.id, night: NIGHT },
    });
    // 1 h Belichtung in der Nacht → nutzbar.
    await t.q('UPDATE capture SET exposure_s = 900 WHERE frame_type = $1', ['light']);
    expect((await t.web('/sessions/summary')).body.usableNights).toBe(1);
    // Anderes Rig bzw. anderer Zeitraum: nichts.
    const empty = {
      nights: 0,
      usableNights: 0,
      integrationS: 0,
      lights: 0,
      projects: 0,
      efficiencyPct: null,
      unreviewed: 0,
      firstUnreviewed: null,
    };
    expect((await t.web(`/sessions/summary?rigId=${id()}`)).body).toEqual(empty);
    expect((await t.web('/sessions/summary?from=2026-09-19')).body).toEqual(empty);
    expect(((await t.web(`/sessions?rigId=${id()}`)).body.items as Body[]).length).toBe(0);
    expect(((await t.web('/sessions?to=2026-09-17')).body.items as Body[]).length).toBe(0);
    // Fremder Mandant sieht weder Sessions noch Kennzahlen.
    const other = await s.seed.tenant('beta');
    const identity = await s.seed.identity({ mfaEnabled: true });
    await s.seed.member(identity.id, other, 'admin');
    const cookies = { [COOKIE_NAMES.session]: await s.seed.session(identity.id, other, 'tenant') };
    const foreign = await s.request('/api/web/v1/sessions/summary', { cookies });
    expect(await foreign.json()).toEqual(empty);
    const foreignUnreviewed = await s.request('/api/web/v1/sessions/unreviewed', { cookies });
    expect(await foreignUnreviewed.json()).toEqual({ unreviewed: 0, firstUnreviewed: null });
    const foreignList = await s.request('/api/web/v1/sessions', { cookies });
    expect(((await foreignList.json()) as { items: unknown[] }).items).toEqual([]);
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
    // Je Session: die Korrektur gilt für die Nacht; ihr Überhang liegt bei genau einer Session der Nacht.
    const rowsOf = async (sid: string) =>
      (await t.web(`/sessions/${sid}`)).body.rows as {
        rejected: number;
        accepted: number;
        night: Body;
      }[];
    const all = (
      await Promise.all(
        ((await t.web('/sessions')).body.items as Body[]).map((x) => rowsOf(x.id as string)),
      )
    ).flat();
    expect(all.reduce((n, r) => n + r.rejected, 0)).toBe(1);
    expect(all.reduce((n, r) => n + r.accepted, 0)).toBe(4);
    for (const r of all)
      expect(r.night).toEqual({
        acquired: 5,
        rejected: 1,
        rejectedIndividual: 0,
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

describe('Detail: canCorrect je Zeile (Entscheidung Sven 28.09.2026)', () => {
  it('Admin immer; User für das eigene Projekt nur mit Mandanteneinstellung userCorrections', async () => {
    const t = await setup();
    await t.fakeNight();
    const sessionId = ((await t.web('/sessions')).body.items as Body[])[0]?.id as string;
    const canCorrect = async (as?: 'user') =>
      ((await t.web(`/sessions/${sessionId}`, as ? { as } : {})).body.rows as Body[]).map(
        (r) => r.canCorrect,
      );
    expect(await canCorrect()).toEqual([true]);
    expect(await canCorrect('user')).toEqual([false]);
    await t.web('/tenant/settings', {
      method: 'PATCH',
      body: { settings: { userCorrections: true } },
    });
    expect(await canCorrect('user')).toEqual([true]);
  });
});

describe('Aufnahmen verwerfen (AP-31, FA-AUS-20)', () => {
  interface Counts {
    acquired_count: number;
    rejected_count: number;
    rejected_individual: number;
    rejected_correction: number;
    bonus_count: number;
    bonus_rejected_count: number;
    integration_s: number;
  }
  it('Regel max ohne Doppelabzug, Bonus verworfen, gemeldete Belichtung; Abgleich findet nichts', async () => {
    const t = await setup();
    await t.fakeNight();
    // Eine gespeicherte Aufnahme als Bonus kennzeichnen, Zähler per Abgleich nachziehen.
    const lights = await t.q<{ id: string; exposure_s: number; night: string }>(
      `SELECT id, exposure_s, night::text AS night FROM capture WHERE exposure_line_id = $1
         AND frame_type = 'light' AND result = 'saved' ORDER BY captured_at`,
      [t.lineId],
    );
    expect(lights.length).toBeGreaterThanOrEqual(4);
    const bonus = lights.at(-1) as { id: string };
    await t.q('UPDATE capture SET is_bonus = true WHERE id = $1', [bonus.id]);
    await reconcileSite(s.pg.db, t.tenantId, t.site.id, new Date());
    const night = lights[0]?.night as string;
    const counts = async () =>
      (
        await t.q<Counts>(
          `SELECT acquired_count, rejected_count, rejected_individual, rejected_correction, bonus_count,
                  bonus_rejected_count, integration_s::float AS integration_s
             FROM capture_night WHERE exposure_line_id = $1 AND night = $2`,
          [t.lineId, night],
        )
      )[0] as Counts;
    const line = async () =>
      (
        await t.q<{ rejected_count: number; bonus_rejected_count: number }>(
          'SELECT rejected_count, bonus_rejected_count FROM exposure_line WHERE id = $1',
          [t.lineId],
        )
      )[0];
    const reject = (id: string, rejected: boolean, reason: string | null = 'clouds') =>
      t.web(`/captures/${id}`, { method: 'PATCH', body: { rejected, reason } });
    const base = await counts();
    const deviating = lights.find((l) => Number(l.exposure_s) === 330) as { id: string };
    const plain = lights.filter((l) => Number(l.exposure_s) === 300 && l.id !== bonus.id);
    const [p1, p2] = plain as unknown as [{ id: string }, { id: string }];

    // 1) Einzeln verwerfen: gemeldete 330 s.
    const r1 = await reject(deviating.id, true);
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ rejected: true, rejectedCount: 1, bonusRejectedCount: 0 });
    let c = await counts();
    expect(c.rejected_individual).toBe(1);
    expect(c.integration_s).toBeCloseTo(base.integration_s - 330, 3);
    // Idempotent.
    expect((await reject(deviating.id, true)).body).toMatchObject({ rejectedCount: 1 });
    expect((await counts()).integration_s).toBeCloseTo(c.integration_s, 3);

    // 2) Korrektur 2 über der Untergrenze 1: Rest mit Zeilenbelichtung 300 s.
    const sessionId = (
      await t.q<{ session_id: string }>('SELECT session_id FROM capture WHERE id = $1', [p1.id])
    )[0]?.session_id as string;
    const corr = await t.web(`/sessions/${sessionId}/corrections`, {
      method: 'POST',
      body: { exposureLineId: t.lineId, rejected: 2 },
    });
    expect(corr.body.rejectedCount).toBe(2);
    c = await counts();
    expect(c.integration_s).toBeCloseTo(base.integration_s - 330 - 300, 3);

    // 3) Zweite Aufnahme einzeln: von der Korrektur schon abgedeckt – kein Doppelabzug.
    expect((await reject(p1.id, true)).body).toMatchObject({ rejectedCount: 2 });
    c = await counts();
    expect([c.rejected_individual, c.rejected_count]).toEqual([2, 2]);
    expect(c.integration_s).toBeCloseTo(base.integration_s - 330 - 300, 3);
    // Korrektur unter der Untergrenze → 409.
    const low = await t.web(`/sessions/${sessionId}/corrections`, {
      method: 'POST',
      body: { exposureLineId: t.lineId, rejected: 1 },
    });
    expect([low.status, low.body.code]).toEqual([409, 'correction.conflict']);

    // 4) Dritte einzeln: jetzt 3 > Korrektur.
    expect((await reject(p2.id, true)).body).toMatchObject({ rejectedCount: 3 });
    // 5) Erste zurücknehmen: max(2, 2) = 2; Integration +330, Korrektur-Rest bleibt 0.
    expect((await reject(deviating.id, false)).body).toMatchObject({ rejectedCount: 2 });
    c = await counts();
    expect(c.integration_s).toBeCloseTo(base.integration_s - 600, 3);

    // 6) Bonus verwerfen: zählt nur in *Bonus verworfen*.
    const rb = await reject(bonus.id, true, 'satellite');
    expect(rb.body).toMatchObject({ rejectedCount: 2, bonusRejectedCount: 1 });
    c = await counts();
    expect(c.bonus_rejected_count).toBe(1);
    expect(await line()).toMatchObject({ rejected_count: 2, bonus_rejected_count: 1 });
    const [cap] = await t.q<{ rejected: boolean; reject_reason: string }>(
      'SELECT rejected, reject_reason FROM capture WHERE id = $1',
      [bonus.id],
    );
    expect(cap).toEqual({ rejected: true, reject_reason: 'satellite' });
    const [proj] = await t.q<{ effort_stale: boolean }>(
      'SELECT effort_stale FROM project WHERE id = $1',
      [t.pid],
    );
    expect(proj?.effort_stale).toBe(true);

    // Der Abgleich aus den Aufnahmen kommt zu denselben Zählern.
    const check = await reconcileSite(s.pg.db, t.tenantId, t.site.id, new Date());
    expect(check).toMatchObject({ linesFixed: 0, rowsFixed: 0 });

    // Detail: Kennzeichen und Grund je Aufnahme, Bonus verworfen je Zeile.
    const bonusSession = (
      await t.q<{ session_id: string }>('SELECT session_id FROM capture WHERE id = $1', [bonus.id])
    )[0]?.session_id as string;
    const detail = await t.web(`/sessions/${bonusSession}`);
    const shown = (detail.body.captures as Body[]).find((x) => x.id === bonus.id);
    expect(shown).toMatchObject({ rejected: true, rejectReason: 'satellite', isBonus: true });
    expect((detail.body.rows as Body[])[0]).toMatchObject({ bonusRejected: 1 });
  });

  it('nicht verwerfbar: nicht zugeordnet; Rechte wie Korrektur (User nur mit Mandanteneinstellung)', async () => {
    const t = await setup();
    await t.fakeNight();
    const [unassigned] = await t.q<{ id: string }>(
      "SELECT id FROM capture WHERE assignment = 'unassigned' LIMIT 1",
    );
    const bad = await t.web(`/captures/${unassigned?.id as string}`, {
      method: 'PATCH',
      body: { rejected: true },
    });
    expect([bad.status, bad.body.code]).toEqual([409, 'capture.not_rejectable']);
    expect(
      (await t.web(`/captures/${id()}`, { method: 'PATCH', body: { rejected: true } })).status,
    ).toBe(404);
    const [own] = await t.q<{ id: string }>(
      "SELECT id FROM capture WHERE exposure_line_id = $1 AND result = 'saved' LIMIT 1",
      [t.lineId],
    );
    const asUser = () =>
      t.web(`/captures/${own?.id as string}`, {
        method: 'PATCH',
        body: { rejected: true, reason: 'focus' },
        as: 'user',
      });
    expect((await asUser()).status).toBe(403);
    await t.web('/tenant/settings', {
      method: 'PATCH',
      body: { settings: { userCorrections: true } },
    });
    expect((await asUser()).status).toBe(200);
  });
});

describe('Soll/Ist je Session (Entscheidung Sven 07.10.2026)', () => {
  it('zwei Sessions einer Nacht: Soll = erster Plan ohne Bonus, Ist = diese Session, Serie, später eingeplant, Kennzahlen gleich', async () => {
    const t = await setup();
    const [{ filter_id: filterId } = { filter_id: '' }] = await t.q<{ filter_id: string }>(
      'SELECT filter_id FROM exposure_line WHERE id = $1',
      [t.lineId],
    );
    const project = async (name: string) => {
      const created = await t.web('/projects', {
        method: 'POST',
        body: { id: id(), name, rigId: t.rig.id, targetName: name, raDeg: 10.7, decDeg: 41.3 },
      });
      const pid = created.body.id as string;
      const panelId = (created.body.panels as { id: string }[])[0]?.id as string;
      const lineId = id();
      await t.web(`/projects/${pid}/lines`, {
        method: 'POST',
        body: { id: lineId, panelId, filterId, exposureS: 300, plannedCount: 40, moonMode: 'none' },
      });
      await t.q(
        "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
        [pid],
      );
      return lineId;
    };
    const later = await project('M 31');
    const transit = await project('HAT-P-32 b');
    const [a, b] = [id(), id()];
    for (const [sid, start, end] of [
      [a, '2026-09-19T01:00:00Z', '2026-09-19T04:30:00Z'],
      [b, '2026-09-19T05:00:00Z', '2026-09-19T08:00:00Z'],
    ] as const)
      await t.q(
        "INSERT INTO session (id, tenant_id, rig_id, night, started_at, ended_at, status) VALUES ($1, $2, $3, $4, $5, $6, 'completed')",
        [sid, t.tenantId, t.rig.id, NIGHT, start, end],
      );
    const expose = (lineId: string, at: string, bonus = false) => ({
      cmd: 'expose',
      atUtc: `2026-09-19T${at}:00Z`,
      exposureLineId: lineId,
      filter: 'Ha',
      exposureS: 300,
      bonus,
    });
    const plan = (sid: string, revision: number, entries: unknown[]) =>
      t.q(
        `INSERT INTO night_plan (tenant_id, rig_id, night, origin, session_id, revision, reason, engine_version, input_hash, summary, blocks)
         VALUES ($1, $2, $3, 'server_plan', $4, $5, 'initial', '1.0.0', 'h', '{}'::jsonb, $6::jsonb)`,
        [t.tenantId, t.rig.id, NIGHT, sid, revision, JSON.stringify([{ entries }])],
      );
    // Session A: erster Plan 3 Frames + 2 Bonus für NGC 281 und eine Transit-Serie; M 31 erst in Revision 2.
    await plan(a, 1, [
      expose(t.lineId, '01:05'),
      expose(t.lineId, '01:10'),
      expose(t.lineId, '01:15'),
      expose(t.lineId, '01:20', true),
      expose(t.lineId, '01:25', true),
      {
        cmd: 'expose_series',
        atUtc: '2026-09-19T03:00:00Z',
        untilUtc: '2026-09-19T04:00:00Z',
        exposureLineId: transit,
        filter: 'Ha',
        exposureS: 60,
      },
    ]);
    await plan(a, 2, [expose(later, '02:00'), expose(later, '02:05')]);
    // Session B: eigener erster Plan mit 2 Frames.
    await plan(b, 1, [expose(t.lineId, '05:05'), expose(t.lineId, '05:10')]);
    let minute = 0;
    const capture = async (
      sid: string,
      lineId: string,
      o: { bonus?: boolean; rejected?: boolean; exposureS?: number } = {},
    ) => {
      minute += 1;
      await t.q(
        `INSERT INTO capture (id, tenant_id, session_id, project_id, panel_id, exposure_line_id, night, captured_at,
           filter_short_name, exposure_s, result, file_name, is_bonus, rejected)
         SELECT $1, $2, $3, l.project_id, l.panel_id, l.id, $4, $5, 'Ha', $6, 'saved', 'x.fits', $7, $8
         FROM exposure_line l WHERE l.id = $9`,
        [
          id(),
          t.tenantId,
          sid,
          NIGHT,
          new Date(Date.parse('2026-09-19T01:00:00Z') + minute * 60_000).toISOString(),
          o.exposureS ?? 300,
          o.bonus ?? false,
          o.rejected ?? false,
          lineId,
        ],
      );
    };
    await capture(a, t.lineId);
    await capture(a, t.lineId);
    await capture(a, t.lineId, { rejected: true });
    await capture(a, t.lineId, { bonus: true });
    await capture(a, t.lineId, { bonus: true, rejected: true });
    for (let i = 0; i < 5; i += 1) await capture(a, transit, { exposureS: 60 });
    await capture(a, later);
    await capture(a, later);
    await capture(b, t.lineId);
    await capture(b, t.lineId);
    await capture(b, t.lineId, { bonus: true });
    await reconcileSite(s.pg.db, t.tenantId, t.site.id, new Date());

    type Row = Body & { projectName: string; night: Body };
    const detail = async (sid: string) => {
      const res = await t.web(`/sessions/${sid}`);
      expect(res.status).toBe(200);
      return res.body as Body & { rows: Row[]; kpis: { plan: Body } };
    };
    let da = await detail(a);
    expect(da.rows.map((r) => r.projectName)).toEqual(['HAT-P-32 b', 'M 31', 'NGC 281']);
    const [series, laterRow, ngc] = da.rows as [Row, Row, Row];
    expect(series).toMatchObject({
      planned: 0,
      plannedSeries: { fromUtc: '2026-09-19T03:00:00Z', untilUtc: '2026-09-19T04:00:00Z' },
      plannedLater: false,
      acquired: 5,
      accepted: 5,
    });
    expect(laterRow).toMatchObject({
      planned: 0,
      plannedSeries: null,
      plannedLater: true,
      acquired: 2,
    });
    // Soll 3 (ohne die 2 Bonus-Einträge); Ist 3 nur dieser Session, Bonus getrennt.
    expect(ngc).toMatchObject({
      planned: 3,
      plannedLater: false,
      acquired: 3,
      rejected: 1,
      accepted: 2,
      bonus: 2,
      bonusRejected: 1,
      integrationS: 900,
      night: { acquired: 5, rejected: 1, rejectedIndividual: 1, rejectedCorrection: 0 },
    });
    // Kennzahlen mit denselben Begriffen: Soll = Summe der Soll-Spalte, Ist = Summe Ist ohne Serie.
    expect(da.kpis.plan).toMatchObject({ plannedFrames: 3, acquiredFrames: 5 });

    const db = await detail(b);
    expect(db.rows).toEqual([
      expect.objectContaining({
        projectName: 'NGC 281',
        planned: 2,
        acquired: 2,
        rejected: 0,
        accepted: 2,
        bonus: 1,
        bonusRejected: 0,
      }),
    ]);
    expect(db.kpis.plan).toMatchObject({ plannedFrames: 2, acquiredFrames: 2, framesPct: 100 });

    // Korrektur der Nacht 4 (einzeln verworfen 1): Überhang 3 – Session A trägt 2, Session B 1.
    const corr = await t.web(`/sessions/${a}/corrections`, {
      method: 'POST',
      body: { exposureLineId: t.lineId, rejected: 4 },
    });
    expect(corr.status).toBe(200);
    da = await detail(a);
    expect(da.rows[2]).toMatchObject({ rejected: 3, accepted: 0, integrationS: 300 });
    expect(da.rows[2]?.night).toMatchObject({ rejected: 4, rejectedCorrection: 4 });
    expect((await detail(b)).rows[0]).toMatchObject({
      rejected: 1,
      accepted: 1,
      integrationS: 600,
    });
  });
});

describe('Kennzahlen und Abweichungsgründe (AP-31, FA-AUS-04/05/09)', () => {
  it('Detail trägt KPIs aus Plan, Aufnahmen und Ereignissen', async () => {
    const t = await setup();
    await t.fakeNight();
    const items = (await t.web('/sessions')).body.items as Body[];
    const online = items.find((x) => x.createdOffline === false) as Body;
    const d = (await t.web(`/sessions/${online.id as string}`)).body;
    const kpis = d.kpis as Body;
    const [sum] = await t.q<{ s: number }>(
      "SELECT COALESCE(sum(exposure_s), 0)::float AS s FROM capture WHERE session_id = $1 AND frame_type = 'light' AND result = 'saved'",
      [online.id],
    );
    expect(kpis.exposureS).toBeCloseTo(Number(sum?.s), 3);
    expect(kpis.plan).toMatchObject({ plannedFrames: expect.any(Number) });
    expect(typeof kpis.filterChanges).toBe('number');
    expect(Array.isArray(d.reasons)).toBe(true);
  });
});

describe('Automatisch Bereit zur Bearbeitung (FA-PRJ-11/12, autoReadyToProcess)', () => {
  const statusOf = async (t: Awaited<ReturnType<typeof setup>>) =>
    (await t.q<{ status: string }>('SELECT status FROM project WHERE id = $1', [t.pid]))[0]?.status;
  const autoLog = (t: Awaited<ReturnType<typeof setup>>) =>
    t.q<{ diff: unknown }>(
      "SELECT diff FROM change_log WHERE entity = 'project' AND entity_id = $1 AND action = 'status'",
      [t.pid],
    );
  const enable = (t: Awaited<ReturnType<typeof setup>>, on = true) =>
    t.web('/tenant/settings', { method: 'PATCH', body: { settings: { autoReadyToProcess: on } } });

  it('Ingest macht das Projekt fertig → Bereit zur Bearbeitung; ohne Einstellung bleibt es Aktiv', async () => {
    const t = await setup();
    // Soll 3: die Fake-Nacht liefert 5 gespeicherte Lights → Planungsbedarf 0 („fertig“).
    await t.q('UPDATE exposure_line SET planned_count = 3 WHERE id = $1', [t.lineId]);
    expect((await enable(t)).status).toBe(200);
    await t.fakeNight();
    expect(await statusOf(t)).toBe('ready_to_process');
    const logs = await autoLog(t);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.diff).toMatchObject({
      from: 'active',
      to: 'ready_to_process',
      automatic: true,
    });
    // Frames verworfen → Planungsbedarf > 0 → zurück nach Aktiv (autoReactivateOnRemaining).
    const sessionId = ((await t.web('/sessions')).body.items as Body[])[0]?.id as string;
    const r = await t.web(`/sessions/${sessionId}/corrections`, {
      method: 'POST',
      body: { exposureLineId: t.lineId, rejected: 3, reason: 'clouds' },
    });
    expect(r.body).toMatchObject({ projectStatus: 'active' });
    // Korrektur zurückgenommen → wieder fertig → wieder Bereit zur Bearbeitung.
    const back = await t.web(`/sessions/${sessionId}/corrections`, {
      method: 'POST',
      body: { exposureLineId: t.lineId, rejected: 0 },
    });
    expect(back.body).toMatchObject({ projectStatus: 'ready_to_process' });
  });

  it('Standard aus, Bonus am Rig oder Exoplanet: kein automatischer Wechsel', async () => {
    const t = await setup();
    await t.q('UPDATE exposure_line SET planned_count = 3 WHERE id = $1', [t.lineId]);
    await t.fakeNight();
    expect(await statusOf(t)).toBe('active');
    // Mit Einstellung, aber Bonus aktiv: Bonus-Aufnahmen laufen, solange das Projekt Aktiv ist.
    await enable(t);
    await t.q('UPDATE rig SET bonus_enabled = true WHERE id = $1', [t.rig.id]);
    await t.q('UPDATE exposure_line SET acquired_count = 99 WHERE id = $1', [t.lineId]);
    await reconcileSite(s.pg.db, t.tenantId, t.site.id, new Date());
    expect(await statusOf(t)).toBe('active');
    await t.q('UPDATE rig SET bonus_enabled = false WHERE id = $1', [t.rig.id]);
    await t.q("UPDATE project SET project_type = 'exoplanet' WHERE id = $1", [t.pid]);
    await t.q('UPDATE exposure_line SET acquired_count = 99 WHERE id = $1', [t.lineId]);
    await reconcileSite(s.pg.db, t.tenantId, t.site.id, new Date());
    expect(await statusOf(t)).toBe('active');
    expect(await autoLog(t)).toEqual([]);
  });

  it('Zähler-Abgleich und Zeilenänderung lösen den Wechsel ebenfalls aus', async () => {
    const t = await setup();
    await t.fakeNight();
    expect(await statusOf(t)).toBe('active');
    await enable(t);
    // Abgleich: Soll 3 bei 5 Aufnahmen, Zähler auf 0 verfälscht → Abgleich stellt 5 her → fertig.
    await t.q('UPDATE exposure_line SET planned_count = 3, acquired_count = 0 WHERE id = $1', [
      t.lineId,
    ]);
    await reconcileSite(s.pg.db, t.tenantId, t.site.id, new Date());
    expect(await statusOf(t)).toBe('ready_to_process');
    // Zeile im Editor aufgestockt → Planungsbedarf > 0 → Aktiv; wieder gesenkt → Bereit.
    const up = await t.web(`/projects/${t.pid}/lines/${t.lineId}`, {
      method: 'PATCH',
      body: { plannedCount: 10 },
    });
    expect(up.status).toBe(200);
    expect(await statusOf(t)).toBe('active');
    const down = await t.web(`/projects/${t.pid}/lines/${t.lineId}`, {
      method: 'PATCH',
      body: { plannedCount: 5 },
    });
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ status: 'ready_to_process' });
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
