/**
 * AP-14c (TK 5.6, 7.2, 17; FA-ADM-02/06, FA-NIN-22, FA-SIM-09; PGlite): Fake-Plugin-Nacht gegen den
 * Test-Stack mit Zählerprüfung, Widerruf wirkt ab der nächsten Anfrage, Token nur in der Antwort der
 * Anlage, Diagnose aus dem Aufruf-Ringpuffer, Instanz-Sicht (Profil-Standort, Zustand, Lease,
 * Übernahmestatus) und „An NINA ausgeliefert“.
 */
import { runFakeNight } from '@nina-pm/fake-plugin';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body, text };
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
    "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
    [pid],
  );
  const createInstance = async (name: string) => {
    const r = await web('/nina-instances', {
      method: 'POST',
      body: { id: id(), rigId: rig.id, name },
    });
    return { id: r.body.id as string, token: r.body.token as string, body: r.body, text: r.text };
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
  const lineAcquired = async () =>
    Number(
      (
        (await s.pg.admin.query('SELECT acquired_count FROM exposure_line WHERE id = $1', [lineId]))
          .rows[0] as { acquired_count: number }
      ).acquired_count,
    );
  return { tenantId, web, eq, rig, pid, lineId, createInstance, call, lineAcquired };
}

/** `fetch` des Fake-Plugins gegen den Test-Stack; CloudFront setzt in prod `x-origin-verify`. */
const fetchVia =
  (): ((url: string, init?: RequestInit) => Promise<Response>) =>
  (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('x-origin-verify', ORIGIN_SECRET);
    return Promise.resolve(s.app.request(url, { ...init, headers }));
  };

describe('Fake-Plugin-Nacht (TK 17)', () => {
  it('komplette Nacht grün: Duplikate, unzugeordnet, Neuplanung, Lease verloren, offline, Zähler', async () => {
    const t = await setup();
    const inst = await t.createInstance('Fake');
    const before = await t.lineAcquired();
    const report = await runFakeNight({
      baseUrl: 'http://localhost',
      token: inst.token,
      fetch: fetchVia(),
      hooks: {
        releaseLease: async (rigId) => {
          const r = await t.web(`/rigs/${rigId}/lease/release`, { method: 'POST' });
          expect(r.status).toBe(200);
        },
      },
    });
    expect(
      report.steps.filter((x) => x.status !== 'ok'),
      JSON.stringify(report.steps, null, 1),
    ).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.night).toBe('2026-09-18');
    // 3 Lights + 1 nach Lease-Verlust + 1 offline; Duplikate und die unzugeordnete zählen nicht.
    expect(report.counters).toEqual({ expected: 5, actual: 5 });
    expect(await t.lineAcquired()).toBe(before + 5);
    const unassigned = await s.pg.admin.query(
      "SELECT count(*)::int AS n FROM capture WHERE tenant_id = $1 AND assignment = 'unassigned'",
      [t.tenantId],
    );
    expect(unassigned.rows[0]).toEqual({ n: 1 });
    const conflict = await s.pg.admin.query(
      "SELECT count(*)::int AS n FROM session_event WHERE tenant_id = $1 AND kind = 'lease_conflict'",
      [t.tenantId],
    );
    expect((conflict.rows[0] as { n: number }).n).toBeGreaterThan(0);
    // Das Token erscheint nirgends im Bericht.
    expect(JSON.stringify(report)).not.toContain(inst.token);
  });

  it('ohne ausgelieferte Ziele und ohne Hook: Zähler und Lease-Verlust übersprungen, Rest grün', async () => {
    const t = await setup();
    await s.pg.admin.query("UPDATE project SET status = 'on_hold' WHERE id = $1", [t.pid]);
    const inst = await t.createInstance('Fake');
    const report = await runFakeNight({
      baseUrl: 'http://localhost',
      token: inst.token,
      fetch: fetchVia(),
    });
    expect(report.ok).toBe(true);
    expect(report.steps.filter((x) => x.status === 'skipped').map((x) => x.name)).toEqual([
      'Lease verloren',
      'Zähler',
    ]);
  });

  it('falsches Token → Bootstrap rot, keine weiteren Schritte', async () => {
    await setup();
    const report = await runFakeNight({
      baseUrl: 'http://localhost',
      token: `npm_${'x'.repeat(43)}`,
      fetch: fetchVia(),
    });
    expect(report.ok).toBe(false);
    expect(report.steps).toEqual([
      { name: 'Bootstrap', status: 'failed', detail: 'Status 401 (nina.token_invalid)' },
    ]);
  });
});

describe('NINA-Instanzen im Web (S-42, FA-ADM-02/06)', () => {
  it('Token nur in der Antwort der Anlage; Liste und Diagnose zeigen Präfix und last_seen_at', async () => {
    const t = await setup();
    const inst = await t.createInstance('Beobachtungs-PC');
    expect(inst.token).toMatch(/^npm_[0-9A-Za-z]{43}$/);
    expect(inst.body.tokenPrefix).toBe(inst.token.slice(0, 8));
    await t.call(inst.token, '/bootstrap');
    const list = await t.web('/nina-instances');
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(inst.token);
    expect(list.text).not.toContain(inst.token.slice(8));
    const item = (list.body.items as Body[])[0] as Body;
    expect(item).toMatchObject({
      tokenPrefix: inst.token.slice(0, 8),
      lastSeenAt: '2026-09-18T14:00:00Z',
      rigName: 'Starfront – GT81 – Ares-M Pro',
      siteTimeZone: 'America/Chicago',
    });
    expect(item).not.toHaveProperty('token');
    const diag = await t.web(`/nina-instances/${inst.id}/diagnostics`);
    expect(diag.status).toBe(200);
    expect(diag.text).not.toContain(inst.token.slice(8));
  });

  it('Widerruf wirkt ab der nächsten Anfrage: 401 nina.token_invalid, Fehler in der Diagnose', async () => {
    const t = await setup();
    const inst = await t.createInstance('A');
    expect((await t.call(inst.token, '/bootstrap')).status).toBe(200);
    const revoked = await t.web(`/nina-instances/${inst.id}/revoke`, { method: 'POST' });
    expect(revoked.body.status).toBe('revoked');
    const next = await t.call(inst.token, '/targets');
    expect([next.status, next.body.code]).toEqual([401, 'nina.token_invalid']);
    const diag = (await t.web(`/nina-instances/${inst.id}/diagnostics`)).body;
    expect((diag.errors as Body[])[0]).toMatchObject({
      method: 'GET',
      route: '/targets',
      status: 401,
      code: 'nina.token_invalid',
    });
  });

  it('Diagnose: letzte Aufrufe ohne erfolgreiche Heartbeats, Fehler mit Code, voller Heartbeat', async () => {
    const t = await setup();
    const inst = await t.createInstance('A');
    await t.call(inst.token, '/bootstrap');
    await t.call(inst.token, '/targets');
    await t.call(inst.token, '/heartbeat', {
      method: 'POST',
      body: { state: 'idle', pluginVersion: '1.2.0', engineVersion: '0.6.0' },
    });
    const missing = id();
    await t.call(inst.token, `/sessions/${missing}`, {
      method: 'PATCH',
      body: { status: 'running' },
    });
    const diag = (await t.web(`/nina-instances/${inst.id}/diagnostics`)).body;
    const calls = diag.calls as Body[];
    expect(calls.map((c) => `${String(c.method)} ${String(c.route)} ${String(c.status)}`)).toEqual([
      'PATCH /sessions/:sessionId 404',
      'GET /targets 200',
      'GET /bootstrap 200',
    ]);
    expect((diag.errors as Body[]).map((c) => c.code)).toEqual(['resource.not_found']);
    expect(diag.heartbeat).toMatchObject({ state: 'idle', pluginVersion: '1.2.0' });
    expect((diag.instance as Body).pluginVersion).toBe('1.2.0');
  });

  it('Profil-Standort mit Abweichungswarnung, letzter Zustand, Lease und Übernahmestatus', async () => {
    const t = await setup();
    const inst = await t.createInstance('A');
    await t.call(inst.token, '/bootstrap');
    const sid = id();
    await t.call(inst.token, '/sessions', {
      method: 'POST',
      body: {
        id: sid,
        night: '2026-09-18',
        nightPlanId: null,
        startedAtUtc: '2026-09-18T14:00:00Z',
        offline: false,
      },
    });
    await t.call(inst.token, '/heartbeat', {
      method: 'POST',
      body: {
        state: 'running',
        sessionId: sid,
        pluginVersion: '1.0.0',
        engineVersion: '0.6.0',
        profileLocation: { latDeg: 48.1, lonDeg: 11.6 },
      },
    });
    let view = ((await t.web(`/nina-instances?rigId=${t.rig.id}`)).body.items as Body[])[0] as Body;
    expect(view).toMatchObject({
      profileLocation: { latDeg: 48.1, lonDeg: 11.6 },
      profileSiteMismatch: true,
      lastState: { state: 'running', sessionId: sid, blockedReason: null },
      lease: { activeSessionId: sid, untilUtc: '2026-09-18T14:03:00Z', offlineUntilUtc: null },
    });
    expect(view.settingsVersionFetched).toBe(view.rigSettingsVersion);
    // Rig-Einstellung ändern → Übernahmestatus „noch nicht abgerufen“ (FA-SIM-09).
    await t.eq.updateScheduler(t.rig.id, SCHEDULER, s.clock.now());
    view = ((await t.web('/nina-instances')).body.items as Body[])[0] as Body;
    expect(view.rigSettingsVersion as number).toBeGreaterThan(
      view.settingsVersionFetched as number,
    );
    await t.call(inst.token, '/heartbeat', {
      method: 'POST',
      body: {
        state: 'running',
        sessionId: sid,
        pluginVersion: '1.0.0',
        engineVersion: '0.6.0',
        profileLocation: { latDeg: SITE.latitudeDeg + 0.005, lonDeg: SITE.longitudeDeg },
      },
    });
    view = ((await t.web('/nina-instances')).body.items as Body[])[0] as Body;
    expect(view.profileSiteMismatch).toBe(false);
  });
});

describe('An NINA ausgeliefert (S-41, FA-NIN-22)', () => {
  it('dieselben Ziele wie targets, mit Fortschritt je Filter und bestätigtem NINA-Filter', async () => {
    const t = await setup();
    const inst = await t.createInstance('A');
    const r = await t.web(`/rigs/${t.rig.id}/delivery`);
    expect(r.status).toBe(200);
    const targets = await s.request('/api/nina/v1/targets', {
      headers: { authorization: `Bearer ${inst.token}` },
    });
    expect(r.body).toMatchObject({
      rigId: t.rig.id,
      rigName: 'Starfront – GT81 – Ares-M Pro',
      deliveryEnabled: true,
      night: '2026-09-18',
      targetsEtag: targets.headers.get('etag'),
    });
    expect(r.body.items).toEqual([
      expect.objectContaining({
        id: t.pid,
        name: 'NGC 281',
        status: 'active',
        panelCount: 1,
        raDeg: 13.2,
        decDeg: 56.6,
        filters: [
          expect.objectContaining({
            filterShortName: 'Ha',
            ninaFilterName: 'Ha 3nm',
            planned: 40,
            accepted: 0,
          }),
        ],
      }),
    ]);
  });

  it('pausiertes Projekt verschwindet aus der Auslieferung; unbekanntes Rig → 404', async () => {
    const t = await setup();
    await s.pg.admin.query("UPDATE project SET status = 'on_hold' WHERE id = $1", [t.pid]);
    expect((await t.web(`/rigs/${t.rig.id}/delivery`)).body.items).toEqual([]);
    expect((await t.web(`/rigs/${id()}/delivery`)).status).toBe(404);
  });
});
