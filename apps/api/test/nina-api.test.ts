/**
 * NINA-API AP-14a (TK 5.6, 7.3, 7.6; PGlite): Token einmalig und nur als Hash, Widerruf wirkt sofort,
 * Token sieht nur sein Rig, Engine-Major → 409, Bootstrap-Testvektor Starfront, `targets`-ETag ohne
 * Zähler aus Meldungen (NT-19), `POST /plan` = Engine-Ergebnis gleicher Eingabe, Nacht nur aktuelle oder
 * folgende (NT-01), `afEveryMin` nur mit Trigger (M7), offene Meldungen ohne Doppelabzug (NT-20).
 */
import { ENGINE_VERSION, planNight, type PlanInput } from '@nina-pm/engine';
import { buildPlanInput, COOKIE_NAMES, currentNight, nina } from '@nina-pm/shared';
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

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const userIdentity = await s.seed.identity();
  await s.seed.member(userIdentity.id, tenantId, 'user');
  const cookies = {
    admin: { [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant') },
    user: { [COOKIE_NAMES.session]: await s.seed.session(userIdentity.id, tenantId, 'tenant') },
  };
  const web = async (
    path: string,
    o: { method?: string; body?: unknown; as?: 'admin' | 'user' } = {},
  ) => {
    const res = await s.request(`/api/web/v1${path}`, { ...o, cookies: cookies[o.as ?? 'admin'] });
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
    { slots: [{ position: 1, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
    now,
  );
  const project = async (rigId: string, name: string) => {
    const created = await web('/projects', {
      method: 'POST',
      body: { id: id(), name, rigId, targetName: name, raDeg: 13.2046, decDeg: 56.6297 },
    });
    const pid = created.body.id as string;
    const panelId = (created.body.panels as { id: string }[])[0]?.id;
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
    return { pid, lineId };
  };
  const a = await project(rig.id, 'NGC 281');
  const b = await project(rigB.id, 'M 31');
  const created = await web('/nina-instances', {
    method: 'POST',
    body: { id: id(), rigId: rig.id, name: 'Starfront-PC' },
  });
  const token = created.body.token as string;
  const ninaCall = async (
    path: string,
    o: { method?: string; body?: unknown; headers?: Record<string, string>; token?: string } = {},
  ) => {
    const res = await s.request(`/api/nina/v1${path}`, {
      method: o.method ?? 'GET',
      headers: { authorization: `Bearer ${o.token ?? token}`, ...o.headers },
      ...(o.body !== undefined ? { body: o.body } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      etag: res.headers.get('etag'),
      body: (text ? JSON.parse(text) : null) as Body,
    };
  };
  return { tenantId, web, ninaCall, created, token, rig, rigB, site, ha, eq, a, b };
}

describe('NINA-Instanzen (FA-SYN-01, SV-08)', () => {
  it('Token einmalig in der Antwort, gespeichert nur Hash und Präfix; User darf nicht koppeln', async () => {
    const t = await setup();
    expect(t.created.status).toBe(201);
    expect(t.token).toMatch(/^npm_[0-9A-Za-z]{43}$/);
    const list = await t.web('/nina-instances');
    const item = (list.body.items as Body[])[0];
    expect(item?.token).toBeUndefined();
    expect(item?.tokenPrefix).toBe(t.token.slice(0, 8));
    const stored = await s.pg.admin.query('SELECT token_hash FROM nina_instance');
    expect(JSON.stringify(stored.rows)).not.toContain(t.token);
    const denied = await t.web('/nina-instances', {
      method: 'POST',
      as: 'user',
      body: { id: id(), rigId: t.rig.id, name: 'X' },
    });
    expect(denied.status).toBe(403);
  });

  it('Widerruf wirkt sofort: schon die nächste Anfrage → 401 nina.token_invalid', async () => {
    const t = await setup();
    expect((await t.ninaCall('/bootstrap')).status).toBe(200);
    const instanceId = t.created.body.id as string;
    expect((await t.web(`/nina-instances/${instanceId}/revoke`, { method: 'POST' })).status).toBe(
      200,
    );
    const after = await t.ninaCall('/bootstrap');
    expect([after.status, after.body.code]).toEqual([401, 'nina.token_invalid']);
  });
});

describe('NINA-API: Zugriff (TK 5.6)', () => {
  it('ohne bzw. mit falschem Token 401; Web-Sitzung reicht nicht', async () => {
    const t = await setup();
    const none = await s.request('/api/nina/v1/bootstrap');
    expect(none.status).toBe(401);
    expect((await t.ninaCall('/bootstrap', { token: `npm_${'0'.repeat(43)}` })).status).toBe(401);
  });

  it('Token eines Rigs sieht nur das eigene Rig', async () => {
    const t = await setup();
    const targets = await t.ninaCall('/targets');
    expect(targets.status).toBe(200);
    expect(targets.body.rigId).toBe(t.rig.id);
    const ids = (targets.body.projects as Body[]).map((p) => p.id);
    expect(ids).toEqual([t.a.pid]);
    expect(ids).not.toContain(t.b.pid);
    // Zentrum und Raster für „In Framing-Assistent laden“ (FA-NIN-02, AP-16h).
    expect(nina.NinaTargets.safeParse(targets.body).error?.issues ?? []).toEqual([]);
    const project = (targets.body.projects as Body[])[0] as Body;
    expect(project.center).toEqual({
      raDeg: expect.any(Number),
      decDeg: expect.any(Number),
      rotationDeg: expect.any(Number),
    });
    expect(project.mosaic).toEqual({
      rows: expect.any(Number),
      columns: expect.any(Number),
      overlapPct: expect.any(Number),
    });
  });

  it('X-NPM-Engine-Version mit anderer Major-Version → 409 engine.incompatible', async () => {
    const t = await setup();
    const [maj] = ENGINE_VERSION.split('.');
    const other = `${String(Number(maj) + 1)}.0.0`;
    const r = await t.ninaCall('/bootstrap', { headers: { 'x-npm-engine-version': other } });
    expect([r.status, r.body.code]).toEqual([409, 'engine.incompatible']);
    const same = await t.ninaCall('/bootstrap', {
      headers: { 'x-npm-engine-version': `${String(maj)}.99.0` },
    });
    expect(same.status).toBe(200);
  });

  it('gesperrter Mandant → 403 tenant.locked', async () => {
    const t = await setup();
    await s.pg.admin.query("UPDATE tenant SET status = 'locked' WHERE id = $1", [t.tenantId]);
    const r = await t.ninaCall('/bootstrap');
    expect([r.status, r.body.code]).toEqual([403, 'tenant.locked']);
  });
});

describe('GET /bootstrap (NT-02, NT-05, NT-E1)', () => {
  it('Starfront um 2026-09-18T14:00Z: nights[0] = 2026-09-17 (Mittagsnacht), currentNight = 2026-09-18', async () => {
    const t = await setup();
    const r = await t.ninaCall('/bootstrap');
    expect(r.status).toBe(200);
    const nights = r.body.nights as { night: string; nightWindowEndUtc: string }[];
    expect(nights).toHaveLength(60);
    expect(nights[0]).toMatchObject({
      night: '2026-09-17',
      nightWindowEndUtc: '2026-09-18T13:00:00Z',
    });
    expect(r.body.serverTimeUtc).toBe('2026-09-18T14:00:00Z');
    expect(nina.NinaBootstrap.safeParse(r.body).error?.issues ?? []).toEqual([]);
    expect(currentNight(r.body as never, r.body.serverTimeUtc as string)).toBe('2026-09-18');
    const rig = r.body.rig as { filters: Body[]; settingsVersion: number; leaseMinutes: number };
    expect(rig.filters).toEqual([
      expect.objectContaining({ shortName: 'Ha', position: 1, ninaFilterName: 'Ha 3nm' }),
    ]);
    expect(rig.leaseMinutes).toBe(3);
    // Übernahmestatus (FA-SIM-09).
    const list = await t.web('/nina-instances');
    expect((list.body.items as Body[])[0]).toMatchObject({
      settingsVersionFetched: rig.settingsVersion,
      settingsFetchedAt: '2026-09-18T14:00:00Z',
    });
  });
});

describe('GET /targets (NT-19, NT-E1)', () => {
  it('ETag bleibt nach einer Aufnahmemeldung, ändert sich nach neuer Filterzuordnung; 304 bei If-None-Match', async () => {
    const t = await setup();
    const first = await t.ninaCall('/targets');
    expect(first.etag).toBeTruthy();
    expect(nina.NinaTargets.safeParse(first.body).error?.issues ?? []).toEqual([]);
    const line = ((first.body.projects as Body[])[0]?.panels as { lines: Body[] }[])[0]?.lines[0];
    expect(line).toMatchObject({ ninaFilterName: 'Ha 3nm', readoutModeIndex: expect.any(Number) });
    const cached = await t.ninaCall('/targets', { headers: { 'if-none-match': first.etag ?? '' } });
    expect(cached.status).toBe(304);
    // Aufnahmemeldung: Zähler steigt, ETag bleibt.
    await s.pg.admin.query(
      'UPDATE exposure_line SET acquired_count = acquired_count + 1 WHERE id = $1',
      [t.a.lineId],
    );
    expect((await t.ninaCall('/targets')).etag).toBe(first.etag);
    // Neue Filterzuordnung: ETag und ninaFilterName ändern sich.
    await t.eq.putFilterWheel(
      t.rig.id,
      { slots: [{ position: 1, filterId: t.ha.id, ninaFilterName: 'H-alpha' }] },
      s.clock.now(),
    );
    const changed = await t.ninaCall('/targets');
    expect(changed.etag).not.toBe(first.etag);
    const l2 = ((changed.body.projects as Body[])[0]?.panels as { lines: Body[] }[])[0]?.lines[0];
    expect(l2?.ninaFilterName).toBe('H-alpha');
  });

  it('If-None-Match schwach verglichen (RFC 9110): W/-Präfix von CloudFront, Liste, *; fremder ETag → 200', async () => {
    const t = await setup();
    const etag = (await t.ninaCall('/targets')).etag ?? '';
    for (const header of [`W/${etag}`, `"t-0000", W/${etag}`, '*'])
      expect((await t.ninaCall('/targets', { headers: { 'if-none-match': header } })).status).toBe(
        304,
      );
    expect(
      (await t.ninaCall('/targets', { headers: { 'if-none-match': 'W/"t-0000"' } })).status,
    ).toBe(200);
  });
});

describe('POST /plan (FA-SIM-05, NT-01, NT-20, M7)', () => {
  const post = (t: Awaited<ReturnType<typeof setup>>, body: unknown) =>
    t.ninaCall('/plan', { method: 'POST', body });

  it('Nacht außerhalb {aktuelle, folgende} → 422 nina.night_invalid', async () => {
    const t = await setup();
    for (const night of ['2026-09-17', '2026-09-20', '2025-09-18']) {
      const r = await post(t, { night, reason: 'initial', pendingCaptures: [] });
      expect([night, r.status, r.body.code]).toEqual([night, 422, 'nina.night_invalid']);
    }
    expect((await post(t, { night: '2026-09-19', reason: 'initial' })).status).toBe(200);
  });

  it('Ergebnis = Engine mit derselben Eingabe (inkl. tonight); Revision je Session', async () => {
    const t = await setup();
    const tonight = { lastAutofocusUtc: '2026-09-19T01:10:00Z' };
    const r = await post(t, { night: '2026-09-18', reason: 'initial', tonight });
    expect(r.status).toBe(200);
    const rigs = await t.web('/rigs');
    const rigView = (rigs.body.items as Body[]).find((x) => x.id === t.rig.id);
    const project = await t.web(`/projects/${t.a.pid}`);
    const moon = await t.web('/moon-profiles');
    const nights = await t.web(`/sites/${t.site.id}/nights?from=2026-09-18&count=2`);
    const input = buildPlanInput(
      rigView as never,
      [project.body] as never,
      moon.body.items as never,
      nights.body as never,
      {
        night: '2026-09-18',
        site: {
          latitudeDeg: SITE.latitudeDeg,
          longitudeDeg: SITE.longitudeDeg,
          elevationM: SITE.elevationM,
        },
        tonight: {
          pastBlocks: [],
          exposedSecByUnit: {},
          lastAutofocusUtc: tonight.lastAutofocusUtc,
          filterCycle: [],
          flipDoneByPanel: {},
          currentUnitId: null,
        },
      },
    );
    expect(nina.NinaPlanResponse.safeParse(r.body).error?.issues ?? []).toEqual([]);
    const engine = planNight(input as PlanInput);
    expect(r.body.outputHash).toBe(engine.outputHash);
    expect(r.body.revision).toBe(1);
    const rows = await s.pg.admin.query(
      'SELECT origin, reason, revision FROM night_plan WHERE id = $1',
      [r.body.nightPlanId],
    );
    expect(rows.rows[0]).toEqual({ origin: 'server_plan', reason: 'initial', revision: 1 });
    const blocks = r.body.blocks as { entries: Body[]; twilightEndUtc: unknown }[];
    expect(blocks.length).toBeGreaterThan(0);
    const expose = blocks[0]?.entries.find((e) => e.cmd === 'expose');
    expect(expose?.readoutModeIndex).toBe(0);
  });

  it('ohne gemeldeten Trigger Autofokus nach Zeit → kein autofocus_hint; mit Trigger schon (M7)', async () => {
    const t = await setup();
    const cmds = (b: Body) =>
      (b.blocks as { entries: { cmd: string }[] }[]).flatMap((x) => x.entries.map((e) => e.cmd));
    const without = await post(t, { night: '2026-09-18', reason: 'initial' });
    expect(cmds(without.body)).not.toContain('autofocus_hint');
    await s.pg.admin.query(
      `UPDATE nina_instance SET last_state = '{"sequenceTriggers":{"autofocus":["AutofocusAfterTimeTrigger"],"autofocusAfterTimeMin":60,"dither":[]}}'`,
    );
    const withTrigger = await post(t, { night: '2026-09-18', reason: 'initial' });
    expect(cmds(withTrigger.body)).toContain('autofocus_hint');
  });

  it('pendingCaptures: schon gespeicherte IDs werden nicht doppelt abgezogen (NT-20)', async () => {
    const t = await setup();
    const sessionId = id();
    await s.pg.admin.query(
      `INSERT INTO session (id, tenant_id, rig_id, night, started_at) VALUES ($1, $2, $3, '2026-09-18', now())`,
      [sessionId, t.tenantId, t.rig.id],
    );
    const stored = id();
    await s.pg.admin.query(
      `INSERT INTO capture (id, tenant_id, session_id, project_id, panel_id, exposure_line_id, night, captured_at,
         filter_short_name, exposure_s, result, file_name)
       SELECT $1, $2, $3, l.project_id, l.panel_id, l.id, '2026-09-18', now(), 'Ha', 300, 'saved', 'x.fits'
       FROM exposure_line l WHERE l.id = $4`,
      [stored, t.tenantId, sessionId, t.a.lineId],
    );
    const fresh = id();
    const pending = (ids: string[]) => [{ exposureLineId: t.a.lineId, captureIds: ids }];
    const both = await post(t, {
      night: '2026-09-18',
      reason: 'initial',
      pendingCaptures: pending([stored, fresh]),
    });
    const onlyNew = await post(t, {
      night: '2026-09-18',
      reason: 'initial',
      pendingCaptures: pending([fresh]),
    });
    const none = await post(t, { night: '2026-09-18', reason: 'initial', pendingCaptures: [] });
    expect(both.body.inputHash).toBe(onlyNew.body.inputHash);
    expect(none.body.inputHash).not.toBe(onlyNew.body.inputHash);
  });
});
