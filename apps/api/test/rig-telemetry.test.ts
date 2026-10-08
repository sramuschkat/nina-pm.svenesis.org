/**
 * Rig-Telemetrie (AP-67, FA-RIG-15 … 18; PGlite): Ingest mit dem Token einer NINA-Instanz (Mandant und Rig aus dem
 * Token, idempotent, Grenzen, Zeitfenster), Lesen im Web (roh, verdichtet, stündlich mit jüngstem Rest), Verdichtung
 * im worker (auch spät eingetroffene Werte), Löschen nach 90 Tagen und mit dem Rig, Mandantenbindung.
 */
import { purgeRigTelemetry, rollupRigTelemetry } from '@nina-pm/db';
import { COOKIE_NAMES, nina } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMERA, rigInput, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(async () => {
  await s.reset();
  s.clock.set(new Date('2026-10-08T06:00:00Z'));
});
afterAll(() => s.close());

type Body = Record<string, unknown>;
const id = () => crypto.randomUUID();
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function setup(tenantKey = 'alpha') {
  const tenantId = await s.seed.tenant(tenantKey);
  const identity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(identity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const cookies = {
    [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant'),
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
  const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
  const instance = (
    await web('/nina-instances', {
      method: 'POST',
      body: { id: id(), rigId: rig.id, name: 'Telemetrie' },
    })
  ).body;
  const token = instance.token as string;
  const send = async (body: unknown, tk = token) => {
    const res = await s.request('/api/nina/v1/telemetry', {
      method: 'POST',
      headers: { authorization: `Bearer ${tk}` },
      body,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Body };
  };
  const view = async (from: number, to: number) =>
    web(`/rigs/${rig.id}/telemetry?from=${iso(from)}&to=${iso(to)}`);
  return { tenantId, owner, rig, eq, web, send, view, instanceId: instance.id as string, token };
}

const pcSample = (ms: number, cpu = 58.5) => ({
  atUtc: iso(ms),
  values: { cpuMaxC: cpu, cpuAvgC: cpu - 2, loadPct: 43, diskC: 35 },
});
const boxSample = (ms: number, air = 18.2, dew = 13.5) => ({
  atUtc: iso(ms),
  values: { airC: air, dewPointC: dew, humidityPct: 74, voltageV: 12.8, currentA: 1.34 },
});

interface Series {
  source: string;
  resolution: string;
  stepS: number;
  t: string[];
  series: Record<
    string,
    { avg: (number | null)[]; min: (number | null)[]; max: (number | null)[] }
  >;
  latest: { atUtc: string; values: Record<string, number> } | null;
}
const sourceOf = (body: Body, source: string) =>
  (body.sources as Series[]).find((x) => x.source === source) as Series;

describe('POST /nina/v1/telemetry', () => {
  it('nimmt Messpunkte an – Rig aus dem Token, doppelte zählen als duplicate', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    const samples = [pcSample(now - 2 * MIN), pcSample(now - MIN)];
    const first = await t.send({ source: 'pc', samples });
    expect(first).toMatchObject({ status: 200, body: { accepted: 2, duplicate: 0, skipped: 0 } });
    const again = await t.send({ source: 'pc', samples: [...samples, pcSample(now)] });
    expect(again.body).toEqual({ accepted: 1, duplicate: 2, skipped: 0 });
    // Gleicher Zeitpunkt zweimal im Stapel: der erste zählt.
    const twice = await t.send({
      source: 'pc',
      samples: [pcSample(now + MIN), pcSample(now + MIN, 70)],
    });
    expect(twice.body).toEqual({ accepted: 1, duplicate: 1, skipped: 0 });
    const rows = await s.pg.db.selectFrom('rigTelemetrySample').selectAll().execute();
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.rigId === t.rig.id && r.tenantId === t.tenantId)).toBe(true);
  });

  it('freier Speicherplatz als eigene Quelle storage, im Web als dritte Reihe', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    const r = await t.send({
      source: 'storage',
      samples: [
        { atUtc: iso(now - MIN), values: { freeGb: 312.5, totalGb: 476.9, freePct: 65.5 } },
      ],
    });
    expect(r.body).toEqual({ accepted: 1, duplicate: 0, skipped: 0 });
    // Messgröße einer anderen Quelle bei storage → 422
    expect(
      (await t.send({ source: 'storage', samples: [{ atUtc: iso(now), values: { cpuMaxC: 50 } }] }))
        .status,
    ).toBe(422);
    const storage = sourceOf((await t.view(now - HOUR, now + MIN)).body, 'storage');
    expect(storage.series.freeGb?.avg).toEqual([312.5]);
    expect(storage.latest?.values).toEqual({ freeGb: 312.5, totalGb: 476.9, freePct: 65.5 });
  });

  it('zu alte und künftige Messpunkte zählen als skipped, der Rest kommt an', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    const r = await t.send({
      source: 'power_box',
      samples: [
        boxSample(now - nina.TELEMETRY_MAX_AGE_MS - MIN),
        boxSample(now + nina.TELEMETRY_MAX_FUTURE_MS + MIN),
        boxSample(now),
      ],
    });
    expect(r.body).toEqual({ accepted: 1, duplicate: 0, skipped: 2 });
  });

  it('unbekannte Messgröße, Wert außerhalb und leere Werte → 422', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    for (const values of [{ cpuMaxC: 50, fanRpm: 1200 }, { loadPct: 140 }, {}])
      expect((await t.send({ source: 'pc', samples: [{ atUtc: iso(now), values }] })).status).toBe(
        422,
      );
    // Messgröße der anderen Quelle
    expect(
      (await t.send({ source: 'pc', samples: [{ atUtc: iso(now), values: { airC: 18 } }] })).status,
    ).toBe(422);
  });

  it('mehr als 1.000 Messpunkte → 413 telemetry.batch_too_large', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    const samples = Array.from({ length: nina.TELEMETRY_BATCH_MAX + 1 }, (_, i) =>
      pcSample(now - i * 30_000),
    );
    const r = await t.send({ source: 'pc', samples });
    expect(r).toMatchObject({ status: 413, body: { code: 'telemetry.batch_too_large' } });
  });

  it('widerrufenes Token → 401, nichts gespeichert', async () => {
    const t = await setup();
    await t.web(`/nina-instances/${t.instanceId}/revoke`, { method: 'POST' });
    const r = await t.send({ source: 'pc', samples: [pcSample(s.clock.now().getTime())] });
    expect(r).toMatchObject({ status: 401, body: { code: 'nina.token_invalid' } });
    expect(await s.pg.db.selectFrom('rigTelemetrySample').selectAll().execute()).toHaveLength(0);
  });
});

describe('GET /web/v1/rigs/{id}/telemetry', () => {
  it('bis 3 Tage aus den Rohwerten, jüngster Messpunkt je Quelle, ohne Daten leer', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    await t.send({ source: 'pc', samples: [pcSample(now - 2 * MIN, 55), pcSample(now - MIN, 60)] });
    const r = await t.view(now - DAY, now + MIN);
    expect(r.status).toBe(200);
    const pc = sourceOf(r.body, 'pc');
    expect(pc).toMatchObject({ resolution: 'raw', stepS: 0 });
    expect(pc.t).toEqual([iso(now - 2 * MIN), iso(now - MIN)]);
    expect(pc.series.cpuMaxC?.avg).toEqual([55, 60]);
    expect(Object.keys(pc.series)).toEqual(['cpuMaxC', 'cpuAvgC', 'loadPct', 'diskC']);
    expect(pc.latest).toEqual({
      atUtc: iso(now - MIN),
      values: { cpuMaxC: 60, cpuAvgC: 58, loadPct: 43, diskC: 35 },
    });
    const box = sourceOf(r.body, 'power_box');
    expect(box).toMatchObject({ t: [], series: {}, latest: null });
  });

  it('mehr als 1.500 Rohwerte → Minutenfenster mit Mittel, Minimum und Maximum', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    // 2 Tage alle 30 s = 5.760 Messpunkte in Stapeln von 1.000
    const all = Array.from({ length: 5760 }, (_, i) =>
      pcSample(now - 2 * DAY + i * 30_000, 50 + (i % 2) * 10),
    );
    for (let i = 0; i < all.length; i += 1000)
      expect((await t.send({ source: 'pc', samples: all.slice(i, i + 1000) })).status).toBe(200);
    const pc = sourceOf((await t.view(now - 2 * DAY, now)).body, 'pc');
    expect(pc.resolution).toBe('raw');
    expect(pc.stepS).toBe(120); // 2 Tage / 1.500 Punkte → auf ganze Minuten aufgerundet
    expect(pc.t.length).toBeLessThanOrEqual(1500);
    expect(pc.series.cpuMaxC?.min[0]).toBe(50);
    expect(pc.series.cpuMaxC?.max[0]).toBe(60);
    expect(pc.series.cpuMaxC?.avg[0]).toBe(55);
  });

  it('über 3 Tage aus den Stundenwerten, die jüngsten Stunden aus den Rohwerten', async () => {
    const t = await setup();
    const now = s.clock.now().getTime(); // 06:00Z
    await t.send({
      source: 'power_box',
      samples: [
        boxSample(now - 3 * HOUR + 10 * MIN, 20, 12), // 03:xx → verdichtet
        boxSample(now - 3 * HOUR + 40 * MIN, 22, 12),
        boxSample(now - 2 * HOUR + 5 * MIN, 19, 13), // 04:xx → verdichtet
        boxSample(now + 5 * MIN, 18, 13.5), // laufende Stunde → aus den Rohwerten
      ],
    });
    s.clock.set(new Date(now + 10 * MIN));
    expect(await rollupRigTelemetry(s.pg.db, s.clock.now())).toBe(2);
    const box = sourceOf((await t.view(now - 7 * DAY, now + HOUR)).body, 'power_box');
    expect(box).toMatchObject({ resolution: 'hourly', stepS: 3600 });
    expect(box.t).toEqual([iso(now - 3 * HOUR), iso(now - 2 * HOUR), iso(now)]);
    expect(box.series.airC).toEqual({ avg: [21, 19, 18], min: [20, 19, 18], max: [22, 19, 18] });
  });

  it('Zeitraum ungültig → 422; fremdes Rig → 404', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    expect((await t.view(now, now - HOUR)).status).toBe(422);
    expect((await t.view(now - 401 * DAY, now)).status).toBe(422);
    const other = await setup('beta');
    const r = await t.web(`/rigs/${other.rig.id}/telemetry?from=${iso(now - HOUR)}&to=${iso(now)}`);
    expect(r.status).toBe(404);
  });
});

describe('worker: Verdichtung und Aufbewahrung', () => {
  it('verdichtet abgeschlossene Stunden, spät eingetroffene Werte neu, unveränderte nicht', async () => {
    const t = await setup();
    const now = s.clock.now().getTime(); // 06:00Z
    await t.send({
      source: 'pc',
      samples: [pcSample(now - HOUR + MIN, 50), pcSample(now - HOUR + 2 * MIN, 60)],
    });
    expect(await rollupRigTelemetry(s.pg.db, s.clock.now())).toBe(1);
    expect(await rollupRigTelemetry(s.pg.db, s.clock.now())).toBe(0);
    // Spät eingetroffen (Puffer der Skripte): dieselbe Stunde wird neu verdichtet.
    await t.send({ source: 'pc', samples: [pcSample(now - HOUR + 3 * MIN, 70)] });
    expect(await rollupRigTelemetry(s.pg.db, s.clock.now())).toBe(1);
    const hour = await s.pg.db
      .selectFrom('rigTelemetryHourly')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(hour.samples).toBe(3);
    const stats = (typeof hour.stats === 'string' ? JSON.parse(hour.stats) : hour.stats) as Record<
      string,
      { min: number; avg: number; max: number; n: number }
    >;
    expect(stats.cpuMaxC).toEqual({ min: 50, avg: 60, max: 70, n: 3 });
  });

  it('löscht Rohwerte älter als 90 Tage in Stapeln, Stundenwerte bleiben', async () => {
    const t = await setup();
    const start = s.clock.now().getTime();
    await t.send({
      source: 'pc',
      samples: Array.from({ length: 5 }, (_, i) => pcSample(start - 30 * MIN + i * MIN)),
    });
    await rollupRigTelemetry(s.pg.db, new Date(start + HOUR));
    const later = new Date(start + 91 * DAY);
    expect(await purgeRigTelemetry(s.pg.db, later, 2)).toBe(5);
    expect(await s.pg.db.selectFrom('rigTelemetrySample').selectAll().execute()).toHaveLength(0);
    expect(await s.pg.db.selectFrom('rigTelemetryHourly').selectAll().execute()).toHaveLength(1);
  });
});

describe('Löschen', () => {
  it('Rig löschen nimmt Roh- und Stundenwerte mit', async () => {
    const t = await setup();
    const now = s.clock.now().getTime();
    await t.send({ source: 'pc', samples: [pcSample(now - HOUR + MIN)] });
    await rollupRigTelemetry(s.pg.db, s.clock.now());
    await t.web(`/nina-instances/${t.instanceId}/revoke`, { method: 'POST' });
    await s.pg.db.deleteFrom('ninaInstance').execute();
    await t.eq.deleteRig(t.rig.id, s.clock.now());
    expect(await s.pg.db.selectFrom('rigTelemetrySample').selectAll().execute()).toHaveLength(0);
    expect(await s.pg.db.selectFrom('rigTelemetryHourly').selectAll().execute()).toHaveLength(0);
  });
});
