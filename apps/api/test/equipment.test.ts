/**
 * Ausrüstung (AP-09a): CRUD, Löschsperren mit Verwendern, Mondprofil-Validierung und Built-ins,
 * Scheduler-Einstellungen mit `settingsVersion`/`If-Match`, Filterradbelegung und Nacht-Tabelle.
 */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CAMERA,
  filterInput,
  MOON,
  rigInput,
  SCHEDULER,
  SITE,
  TELESCOPE,
} from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

const API = '/api/web/v1';
const id = () => crypto.randomUUID();

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const userIdentity = await s.seed.identity();
  await s.seed.member(userIdentity.id, tenantId, 'user');
  const admin = {
    [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant'),
  };
  const user = {
    [COOKIE_NAMES.session]: await s.seed.session(userIdentity.id, tenantId, 'tenant'),
  };
  const call = async (
    path: string,
    o: { method?: string; body?: unknown; as?: 'user'; headers?: Record<string, string> } = {},
  ) => {
    const res = await s.request(`${API}${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
      cookies: o.as === 'user' ? user : admin,
    });
    const text = await res.text();
    return {
      status: res.status,
      etag: res.headers.get('etag'),
      body: (text ? JSON.parse(text) : null) as Record<string, unknown> & {
        code?: string;
        errors?: { path: string; message: string }[];
      },
    };
  };
  const create = async (path: string, body: object) => {
    const res = await call(path, { method: 'POST', body: { id: id(), ...body } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string } & Record<string, unknown>;
  };
  return { tenantId, owner, call, create };
}

async function withRig(t: Awaited<ReturnType<typeof setup>>) {
  const site = await t.create('/sites', SITE);
  const telescope = await t.create('/telescopes', TELESCOPE);
  const camera = await t.create('/cameras', CAMERA);
  const rig = await t.create('/rigs', rigInput(site.id, telescope.id, camera.id));
  return { site, telescope, camera, rig };
}

describe('CRUD und Rechte (FA-STO, FA-TEL, FA-KAM, FA-RIG-01)', () => {
  it('Admin legt an, ändert und löscht; User liest nur', async () => {
    const t = await setup();
    const siteId = id();
    const created = await t.call('/sites', { method: 'POST', body: { id: siteId, ...SITE } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: siteId,
      name: 'Starfront',
      timeZone: 'America/Chicago',
    });
    expect(created.body).not.toHaveProperty('tenantId');
    // Wiederholung mit derselben Client-UUID liefert das Objekt erneut (Idempotenz).
    const again = await t.call('/sites', { method: 'POST', body: { id: siteId, ...SITE } });
    expect([again.status, again.body.id]).toEqual([201, siteId]);
    // Gleicher Name, neue ID → validation.failed am Feld name.
    const dup = await t.call('/sites', { method: 'POST', body: { id: id(), ...SITE } });
    expect([dup.status, dup.body.code, dup.body.errors?.[0]?.path]).toEqual([
      422,
      'validation.failed',
      'name',
    ]);

    expect((await t.call('/sites', { as: 'user' })).body.items).toHaveLength(1);
    const denied = await t.call(`/sites/${siteId}`, {
      method: 'PUT',
      body: SITE,
      as: 'user',
    });
    expect([denied.status, denied.body.code]).toEqual([403, 'permission.denied']);

    const renamed = await t.call(`/sites/${siteId}`, {
      method: 'PUT',
      body: { ...SITE, name: 'Starfront Observatories' },
    });
    expect([renamed.status, renamed.body.name]).toEqual([200, 'Starfront Observatories']);
    expect((await t.call(`/sites/${siteId}`, { method: 'DELETE' })).status).toBe(204);
    expect((await t.call(`/sites/${siteId}`)).status).toBe(404);
  });

  it('Kamera: Rauschmodell samt e⁻/ADU und Dunkelstrom überlebt den Rundlauf', async () => {
    const t = await setup();
    const camera = await t.create('/cameras', {
      ...CAMERA,
      gainEPerAdu: 0.8,
      darkCurrentES20c: 0.002,
      supportedBinning: [1, 2, 4],
      gainModes: [{ name: 'HCG', gain: 100, readNoiseE: 1.1, fullWellE: 20000, ePerAdu: 0.3 }],
      readoutModes: ['Default', 'Low Noise'],
      defaultReadoutMode: 'Low Noise',
    });
    const read = await t.call(`/cameras/${camera.id}`);
    expect(read.body).toMatchObject({
      gainEPerAdu: 0.8,
      darkCurrentES20c: 0.002,
      supportedBinning: [1, 2, 4],
      readoutModes: ['Default', 'Low Noise'],
      defaultReadoutMode: 'Low Noise',
      coolingSetpointC: -10,
      coolingToleranceC: 1,
      defaultGain: null,
    });
    const bad = await t.call('/cameras', {
      method: 'POST',
      body: { id: id(), ...CAMERA, name: 'X', defaultBinning: 3 },
    });
    expect([bad.status, bad.body.code]).toEqual([422, 'validation.failed']);
  });

  it('Rig liefert Abbildungsmaßstab und Bildfeld (geometry.md §1)', async () => {
    const t = await setup();
    const { rig } = await withRig(t);
    // 478 mm · 0,8 = 382,4 mm; 206,265 · 3,76 / 382,4 = 2,02812…″/px; 3008 px → 1,6946°
    expect(rig.derived).toEqual({
      effFocalMm: 382.4,
      scaleArcsecPx: 2.028,
      fovWidthDeg: 1.6946,
      fovHeightDeg: 1.6946,
    });
    expect(rig.settingsVersion).toBe(1);
    expect(rig.scheduler).toMatchObject({
      strategy: 'proportional',
      flatsSource: 'panel',
      sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
      overhead: { afEveryMin: 60 },
    });
  });
});

describe('Löschsperren (FA-RIG-13)', () => {
  it('Standort, Teleskop und Kamera eines Rigs → 409 resource.in_use mit Verwendern', async () => {
    const t = await setup();
    const { site, telescope, camera, rig } = await withRig(t);
    for (const path of [
      `/sites/${site.id}`,
      `/telescopes/${telescope.id}`,
      `/cameras/${camera.id}`,
    ]) {
      const res = await t.call(path, { method: 'DELETE' });
      expect([res.status, res.body.code], path).toEqual([409, 'resource.in_use']);
      expect(res.body.errors).toEqual([{ path: 'rig', message: rig.name }]);
    }
    expect((await t.call(`/rigs/${rig.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await t.call(`/cameras/${camera.id}`, { method: 'DELETE' })).status).toBe(204);
  });

  it('Filter in Vorlage und Filterrad, Mondprofil als Filter-Standard', async () => {
    const t = await setup();
    const { rig } = await withRig(t);
    const moon = await t.create('/moon-profiles', MOON);
    const ha = await t.create('/filters', { ...filterInput('Ha'), defaultMoonProfileId: moon.id });
    await t.create('/exposure-templates', {
      name: 'SHO 300 s',
      lines: [{ filterId: ha.id, exposureS: 300, plannedCount: 20, moonProfileId: moon.id }],
    });
    await t.call(`/rigs/${rig.id}/filter-wheel`, {
      method: 'PUT',
      body: { slots: [{ position: 1, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
    });
    const filter = await t.call(`/filters/${ha.id}`, { method: 'DELETE' });
    expect(filter.status).toBe(409);
    expect(filter.body.errors).toEqual([
      { path: 'rig', message: rig.name },
      { path: 'exposureTemplate', message: 'SHO 300 s' },
    ]);
    const profile = await t.call(`/moon-profiles/${moon.id}`, { method: 'DELETE' });
    expect(profile.status).toBe(409);
    expect(profile.body.errors).toEqual([
      { path: 'filter', message: 'Ha' },
      { path: 'exposureTemplate', message: 'SHO 300 s' },
    ]);
  });
});

describe('Mondprofile (FA-MON-01/02, moon.md §1)', () => {
  it('minAlt ≥ maxAlt, negative Werte und Beleuchtung > 100 → 422', async () => {
    const t = await setup();
    for (const bad of [
      { moonMinAltDeg: 5, moonMaxAltDeg: 5 },
      { widthDays: -1 },
      { separationDeg: -1 },
      { relaxScale: -0.5 },
      { maxIlluminationPct: 101 },
    ]) {
      const res = await t.call('/moon-profiles', {
        method: 'POST',
        body: { id: id(), ...MOON, ...bad },
      });
      expect([res.status, res.body.code], JSON.stringify(bad)).toEqual([422, 'validation.failed']);
    }
  });

  it('mitgelieferte Profile sind nicht änderbar und nicht löschbar', async () => {
    const t = await setup();
    const builtIn = id();
    await s.pg.admin.query(
      `INSERT INTO moon_profile (id, tenant_id, name, separation_deg, width_days, relax_scale,
        moon_min_alt_deg, moon_max_alt_deg, max_illumination_pct, moon_must_be_down, is_built_in)
       VALUES ($1, $2, 'moonProfile.none', 180, 14, 0, -90, -2, 0, true, true)`,
      [builtIn, t.tenantId],
    );
    const list = await t.call('/moon-profiles');
    expect(list.body.items).toEqual([expect.objectContaining({ id: builtIn, isBuiltIn: true })]);
    const put = await t.call(`/moon-profiles/${builtIn}`, { method: 'PUT', body: MOON });
    expect([put.status, put.body.code]).toEqual([409, 'resource.read_only']);
    const del = await t.call(`/moon-profiles/${builtIn}`, { method: 'DELETE' });
    expect([del.status, del.body.code]).toEqual([409, 'resource.read_only']);
  });
});

describe('Scheduler-Einstellungen (FA-RIG-04, sort-chain.md, flip-rotation.md §1)', () => {
  it('erhöht settingsVersion, prüft If-Match und validiert Sortierkette und Flip', async () => {
    const t = await setup();
    const { rig } = await withRig(t);
    const path = `/rigs/${rig.id}/scheduler-settings`;
    const ok = await t.call(path, {
      method: 'PUT',
      body: {
        ...SCHEDULER,
        flatsSource: 'sky',
        overhead: { ...SCHEDULER.overhead, afEveryMin: 0 },
      },
      headers: { 'if-match': '"1"' },
    });
    expect([ok.status, ok.etag, ok.body.settingsVersion]).toEqual([200, '"2"', 2]);
    expect(ok.body.scheduler).toMatchObject({ flatsSource: 'sky', overhead: { afEveryMin: 0 } });

    const stale = await t.call(path, {
      method: 'PUT',
      body: SCHEDULER,
      headers: { 'if-match': '"1"' },
    });
    expect([stale.status, stale.body.code]).toEqual([412, 'resource.version_conflict']);

    const chain = await t.call(path, {
      method: 'PUT',
      body: { ...SCHEDULER, sortChain: ['most_remaining', 'most_remaining'] },
    });
    expect([chain.status, chain.body.code]).toEqual([422, 'rig.sort_chain_invalid']);
    const unknown = await t.call(path, {
      method: 'PUT',
      body: { ...SCHEDULER, sortChain: ['gibt_es_nicht'] },
    });
    expect(unknown.body.code).toBe('rig.sort_chain_invalid');

    const flip = await t.call(path, {
      method: 'PUT',
      body: { ...SCHEDULER, flipAfterMeridianMin: 20, flipMaxAfterMeridianMin: 15 },
    });
    expect([flip.status, flip.body.code]).toEqual([422, 'rig.flip_settings_invalid']);

    const denied = await t.call(path, { method: 'PUT', body: SCHEDULER, as: 'user' });
    expect(denied.status).toBe(403);
  });

  it('Änderungen an der Kamera erhöhen settingsVersion des Rigs (FA-RIG-07)', async () => {
    const t = await setup();
    const { camera, rig } = await withRig(t);
    await t.call(`/cameras/${camera.id}`, {
      method: 'PUT',
      body: { ...CAMERA, coolingSetpointC: -15 },
    });
    expect((await t.call(`/rigs/${rig.id}`)).body.settingsVersion).toBe(2);
  });
});

describe('Filterradbelegung (FA-RIG-14, NT-E1)', () => {
  it('Vorschläge aus der NINA-Meldung, Bestätigung nur durch Admin, erhöht settingsVersion', async () => {
    const t = await setup();
    const { rig } = await withRig(t);
    const ha = await t.create('/filters', filterInput('Ha'));
    const l = await t.create('/filters', filterInput('L'));
    await s.pg.admin.query('UPDATE rig SET nina_filter_wheel = $1 WHERE id = $2', [
      JSON.stringify({
        slots: [
          { position: 1, name: 'LPro', focusOffset: 0 },
          { position: 2, name: 'Ha 3nm', focusOffset: 12 },
        ],
        reportedAt: '2026-09-24T09:00:00Z',
      }),
      rig.id,
    ]);
    const before = await t.call(`/rigs/${rig.id}/filter-wheel`);
    expect(before.body.slots).toEqual([
      expect.objectContaining({ position: 1, reportedName: 'LPro', suggestedFilterId: null }),
      expect.objectContaining({ position: 2, reportedName: 'Ha 3nm', suggestedFilterId: ha.id }),
    ]);

    const body = {
      slots: [
        { position: 1, filterId: l.id, ninaFilterName: 'LPro' },
        { position: 2, filterId: ha.id, ninaFilterName: 'Ha 3nm' },
      ],
    };
    const denied = await t.call(`/rigs/${rig.id}/filter-wheel`, {
      method: 'PUT',
      body,
      as: 'user',
    });
    expect([denied.status, denied.body.code]).toEqual([403, 'permission.denied']);

    const ok = await t.call(`/rigs/${rig.id}/filter-wheel`, { method: 'PUT', body });
    expect([ok.status, ok.body.settingsVersion]).toEqual([200, 2]);
    expect(ok.body.slots).toEqual([
      expect.objectContaining({
        position: 1,
        filterId: l.id,
        ninaFilterName: 'LPro',
        ninaConfirmedAt: '2026-09-24T10:00:00Z',
        ninaConfirmedBy: t.owner,
        // „LPro“ ist kein Vorschlag für „L“ (Präfix nur, wenn danach kein Buchstabe folgt).
        suggestion: null,
      }),
      expect.objectContaining({ position: 2, suggestion: 'Ha 3nm', changedByNina: false }),
    ]);
    expect((await t.call(`/rigs/${rig.id}`)).body.filterWheel).toHaveLength(2);
  });
});

describe('Nacht-Tabelle (NT-02, night.md §1/§1.1)', () => {
  it('Starfront ab 2026-09-17: Mittag bis Mittag, Nachtfensterende, Übergänge', async () => {
    const t = await setup();
    const site = await t.create('/sites', SITE);
    const res = await t.call(`/sites/${site.id}/nights?from=2026-09-17&count=5`);
    expect(res.status).toBe(200);
    const nights = res.body.nights as { night: string; nightWindowEndUtc: string }[];
    expect(nights[0]).toEqual({
      night: '2026-09-17',
      noonStartUtc: '2026-09-17T17:00:00Z',
      noonEndUtc: '2026-09-18T17:00:00Z',
      nightWindowEndUtc: '2026-09-18T13:00:00Z',
    });
    expect(nights[2]).toMatchObject({
      night: '2026-09-19',
      nightWindowEndUtc: '2026-09-20T13:05:00Z',
    });
    expect(res.body.timeZoneTransitions).toEqual([
      { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
    ]);
    expect(res.body.tzdataVersion).toMatch(/^\d{4}[a-z]$/);
  });

  it('ohne from: ab der Mittagsnacht, currentNight nach Nachtfensterende = Folgenacht (H1)', async () => {
    const t = await setup();
    const site = await t.create('/sites', SITE);
    s.clock.set(new Date('2026-09-18T14:00:00Z'));
    const res = await t.call(`/sites/${site.id}/nights?count=60`);
    const nights = res.body.nights as { night: string }[];
    expect([nights[0]?.night, res.body.currentNight, nights.length]).toEqual([
      '2026-09-17',
      '2026-09-18',
      60,
    ]);
    // Die Tabelle reicht über die Umstellung am 01.11.
    expect(res.body.timeZoneTransitions).toEqual([
      { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
      { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
    ]);
  });

  it('count = 401 → 422 validation.failed; fremder Standort → 404', async () => {
    const t = await setup();
    const site = await t.create('/sites', SITE);
    const res = await t.call(`/sites/${site.id}/nights?count=401`);
    expect([res.status, res.body.code]).toEqual([422, 'validation.failed']);
    expect((await t.call(`/sites/${id()}/nights`)).status).toBe(404);
  });
});
