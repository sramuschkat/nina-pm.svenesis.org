/**
 * Bildqualität (AP-72a; PGlite): Session-Detail mit Messwerten je Aufnahme, Autofokus-Daten und Bezugswerten; Filter-
 * Offsets aus den `af`-Ereignissen (gemeinsame Temperatursteigung) mit Platz, Web-Filter und NINA-Offset; mandantengebunden.
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
  const lum = await eq.createFilter(id(), filterInput('L'), now);
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  await eq.updateScheduler(rig.id, SCHEDULER, now);
  await eq.putFilterWheel(
    rig.id,
    {
      slots: [
        { position: 1, filterId: lum.id, ninaFilterName: 'LUMINOS' },
        { position: 2, filterId: ha.id, ninaFilterName: 'Ha 3nm' },
      ],
    },
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
  return { tenantId, siteId: site.id, rigId: rig.id, pid, panelId, lineId, web, call };
}

/** Eine Nacht: 8 Lights mit Messwerten (2 mit wenigen Sternen) und Autofokus L/Ha bei fallender Temperatur. */
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
  const start = Date.parse('2026-09-19T01:00:00Z');
  // Wahr: L 2020, Ha 2065 bei 10 °C, −5 Schritte/°C.
  const afs = [14, 12, 10, 8, 6].flatMap((t, i) =>
    (
      [
        ['LUMINOS', 2020],
        ['Ha 3nm', 2065],
      ] as const
    ).map(([filter, p], k) => ({
      id: id(),
      occurredAtUtc: new Date(start + (i * 2 + k) * 600_000).toISOString(),
      kind: 'af',
      nightPlanId,
      blockId,
      projectId: w.pid,
      durationS: 180,
      data: { result: 'ok', filter, position: p - 5 * (t - 10), temperatureC: t },
    })),
  );
  afs.push({
    ...afs[0],
    id: id(),
    data: { result: 'failed', filter: 'LUMINOS', position: 1, temperatureC: 10 },
  } as never);
  expect(
    (await w.call(`/sessions/${sessionId}/events`, { method: 'POST', body: { events: afs } }))
      .status,
  ).toBe(200);
  const lights = Array.from({ length: 8 }, (_, i) => {
    const at = new Date(start + i * 600_000).toISOString().replace('.000Z', 'Z');
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
      fileName: `x${String(i)}.fits`,
      nightPlanId,
      metrics: {
        hfr: 1.6,
        stars: i >= 6 ? 90 : 800,
        guidingRmsArcsec: 0.6,
        cloudCoverPct: 0,
        medianAdu: 1000,
        saturatedPct: 0.01,
      },
    };
  });
  expect(
    (
      await w.call(`/sessions/${sessionId}/captures`, {
        method: 'POST',
        body: { captures: lights },
      })
    ).status,
  ).toBe(200);
  return sessionId;
}

describe('Bildqualität (AP-72a)', () => {
  it('Session-Detail: Messwerte je Aufnahme, af-Daten, Bezugswerte und Pixelmaßstab', async () => {
    const w = await setup();
    const sessionId = await night(w);
    const d = (await w.web(`/sessions/${sessionId}`)).body as {
      captures: { quality: Body | null }[];
      events: { kind: string; af?: Body | null }[];
      quality: { scaleArcsecPx: number | null; refs: Body[] };
    };
    expect(d.captures[0]?.quality).toMatchObject({
      rmsArcsec: 0.6,
      cloudCoverPct: 0,
      medianAdu: 1000,
      saturatedPct: 0.01,
    });
    const af = d.events.filter((e) => e.kind === 'af');
    expect(af.find((e) => e.af?.ok === true)?.af).toMatchObject({
      ok: true,
      filter: 'LUMINOS',
      temperatureC: 14,
    });
    expect(af.some((e) => e.af?.ok === false)).toBe(true);
    expect(d.quality.scaleArcsecPx).toBeGreaterThan(0);
    expect(d.quality.refs).toEqual([
      { projectId: w.pid, filter: 'Ha', stars: 800, hfr: 1.6, medianAdu: 1000, n: 8 },
    ]);
  });

  it('Filter-Offsets: L als Bezug, Ha +45, Drift −5/°C; fehlgeschlagene Läufe zählen nicht; fremder Mandant 404', async () => {
    const w = await setup();
    await night(w);
    const r = await w.web(`/rigs/${w.rigId}/focus-offsets`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      reference: 'LUMINOS',
      slopePerC: -5,
      totalRuns: 10,
      minRuns: 3,
    });
    expect(r.body.filters).toEqual([
      expect.objectContaining({
        filter: 'LUMINOS',
        shortName: 'L',
        position: 1,
        runs: 5,
        offset: 0,
      }),
      expect.objectContaining({
        filter: 'Ha 3nm',
        shortName: 'Ha',
        position: 2,
        runs: 5,
        offset: 45,
      }),
    ]);
    const other = await s.seed.tenant('beta');
    const otherIdentity = await s.seed.identity({ mfaEnabled: true });
    const otherAdmin = await s.seed.member(otherIdentity.id, other, 'admin');
    await s.seed.owner(other, otherAdmin);
    const cookies = {
      [COOKIE_NAMES.session]: await s.seed.session(otherIdentity.id, other, 'tenant'),
    };
    const res = await s.request(`/api/web/v1/rigs/${w.rigId}/focus-offsets`, { cookies });
    expect(res.status).toBe(404);
  });

  it('Standort-Statistik: klar laut Bildern je Nacht und Treffsicherheit', async () => {
    const w = await setup();
    await night(w);
    const r = await w.web(`/sites/${w.siteId}/clear-nights?from=2026-09-10&to=2026-09-18`);
    expect(r.status).toBe(200);
    const n = (r.body.nights as Body[]).find((x) => x.night === NIGHT);
    // 01:00–01:50 klar, 02:00–02:10 kaum Sterne → die Hälfte der Stunden klar.
    expect(n).toMatchObject({ imagesClarity: 'thin', imagesClearPct: 50 });
    expect(r.body.imagesAccuracy).toMatchObject({ compared: expect.any(Number) });
    // AP-77: Qualität und Bewölkung aus den Lights (8 Lights, Bezug < 10 → nur Guiding und Wolken geprüft, alle gut).
    expect(n).toMatchObject({
      qualityPct: 100,
      cloudPct: 0,
      cloudSource: 'images',
      sqmMeasured: null,
    });
  });

  it('Standort-Statistik (AP-77): Nacht ohne Session mit Wettergerät, Mond je vergangener Nacht', async () => {
    const w = await setup();
    // Wettergerät in der Nacht 15./16.09. (01:00–01:10 CDT, astronomisch dunkel): 80, 90, 100 % Wolken.
    const samples = [80, 90, 100].map((cloud, i) => ({
      atUtc: new Date(Date.parse('2026-09-16T06:00:00Z') + i * 300_000)
        .toISOString()
        .replace('.000Z', 'Z'),
      values: { cloudCoverPct: cloud, skyQualityMag: 18.5 + i * 0.1 },
    }));
    expect(
      (await w.call('/telemetry', { method: 'POST', body: { source: 'weather', samples } })).status,
    ).toBe(200);
    const r = await w.web(`/sites/${w.siteId}/clear-nights?from=2026-09-10&to=2026-09-18`);
    const n15 = (r.body.nights as Body[]).find((x) => x.night === '2026-09-15');
    expect(n15).toMatchObject({
      sessionIds: [],
      qualityPct: null,
      cloudPct: 90,
      cloudSource: 'device',
      sqmMeasured: 18.6,
    });
    // Mond: gerechnet für vergangene Nächte (Vollmond 26.09.2026, am 10.09. abnehmend ≈ 2 %, am 15.09. zunehmend).
    expect(typeof n15?.moonIllumPct).toBe('number');
    const n10 = (r.body.nights as Body[]).find((x) => x.night === '2026-09-10');
    expect(n10).toMatchObject({ cloudPct: null, cloudSource: null, qualityPct: null });
  });
});
