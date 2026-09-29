/**
 * Job `weather` und `GET /sites/{id}/weather` (AP-23; TK 13/14, weather.md §1.3/§3.4; PGlite) mit
 * nachgebildeten Open-Meteo-Abrufen: Ausfall des Hauptmodells schreibt **keine** Zeile (letzter Stand
 * bleibt), Ausfall der Air-Quality-API nur `aod = null`/`aerosolMissing`, Ausfall des Modellvergleichs nur
 * `pwvMm = null`, `cloudSrc = null`, `nest = false`; Modellsatz, Payload-Aufbau, Rundung erst bei der
 * Ausgabe, höchstens ein Lauf je Ort und Stunde, `tick-hourly` je Standort.
 */
import {
  JobQueue,
  latestWeather,
  saveWeather,
  siteNightRunDone,
  weatherSites,
  type EnqueueInput,
} from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  runWeather,
  weatherJobHandler,
  weatherSlot,
  weatherTick,
  type WeatherPayload,
} from '../src/weather/job';
import type { JobRunnerDeps } from '../src/worker/jobs';
import { SITE } from './support/equipment';
import {
  aerosolResponse,
  compareResponse,
  fakeOpenMeteo,
  hoursFrom,
  mainResponse,
} from './support/open-meteo';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

const id = () => crypto.randomUUID();
// Stundenreihe wie mit past_days=1&forecast_days=7: ab gestern 00:00 UTC, 8 Tage.
const START = Date.UTC(2026, 8, 23) / 1000;
const TIME = hoursFrom(START, 192);
const LAT = SITE.latitudeDeg;
const LON = SITE.longitudeDeg;

const responses = (o: { aerosolHorizon?: number; nestHours?: number } = {}) => ({
  main: mainResponse(TIME),
  aerosol: aerosolResponse(TIME, o.aerosolHorizon ?? TIME.length),
  compare: compareResponse(TIME, LAT, LON, { nestHours: o.nestHours ?? 0 }),
});

const deps = (http: ReturnType<typeof fakeOpenMeteo>) => ({
  http,
  latest: (lat: number, lon: number) => latestWeather(s.pg.db, lat, lon),
  save: (entry: Parameters<typeof saveWeather>[1]) => saveWeather(s.pg.db, entry),
});

const site = { latitudeDeg: LAT, longitudeDeg: LON, timeZone: SITE.timeZone };

async function rows() {
  const r = await s.pg.admin.query(
    'SELECT model_set, fetched_at FROM weather_cache ORDER BY fetched_at',
  );
  return r.rows as { model_set: string; fetched_at: Date }[];
}

async function payload(): Promise<WeatherPayload> {
  const e = await latestWeather(s.pg.db, LAT, LON);
  return e?.payload as WeatherPayload;
}

describe('runWeather', () => {
  it('schreibt eine Zeile mit Modellsatz, Kopf, Stunden und Nächten (ungerundet)', async () => {
    const http = fakeOpenMeteo(responses({ nestHours: 40 }));
    const r = await runWeather(deps(http), site, s.clock.now());
    expect(r).toEqual({ outcome: 'written', modelSet: 'hrrr+gem+gfs+ecmwf+nbm+cams' });
    expect(http.urls).toHaveLength(3);
    const p = await payload();
    expect(p).toMatchObject({ lat: 31.547, lon: -99.382, region: 'other', cmp3: 'nbm' });
    expect(p.fetchedAtUtc).toBe('2026-09-24T10:00:00Z');
    // Mittagsnacht 2026-09-23 beginnt 17:00Z (CDT) – frühere Stunden entfallen.
    expect(p.hours[0]?.tUnix).toBe(Date.UTC(2026, 8, 23, 17) / 1000);
    const h = p.hours[0];
    expect(h).toMatchObject({ nest: true, modelId: 'hrrr', aerosolMissing: false, pwvMm: 18 });
    expect(typeof h?.moonAltDeg).toBe('number');
    // 20 % Bedeckung, Kontrollwert-ähnliche Stunde: ungerundet gespeichert.
    expect(h?.overallScore).not.toBe(Math.round((h?.overallScore ?? 0) * 1000) / 1000);
    // HRRR höchstens 30 h nach „jetzt“, danach GEM.
    const late = p.hours.find((x) => x.tUnix > s.clock.now().getTime() / 1000 + 31 * 3600);
    expect(late).toMatchObject({ nest: false, cloudSrc: 'gem', modelId: 'gem', cloudTotalPct: 40 });
    expect(p.nights.length).toBeGreaterThanOrEqual(7);
    expect(p.nights[0]).toMatchObject({ night: '2026-09-23', aerosolMissing: false });
    expect(p.nights[0]?.darknessSec).toBeGreaterThan(8 * 3600);
  });

  it('Hauptmodell fällt aus → keine neue Zeile, der letzte Stand bleibt', async () => {
    await runWeather(deps(fakeOpenMeteo(responses())), site, s.clock.now());
    const before = await rows();
    s.clock.advance(60 * 60_000);
    for (const fail of [503, 429, 'network'] as const) {
      const r = await runWeather(
        deps(fakeOpenMeteo(responses(), { main: fail })),
        site,
        s.clock.now(),
      );
      expect(r.outcome).toBe('main_failed');
    }
    expect(await rows()).toEqual(before);
  });

  it('ohne jeden Stand und ohne Hauptmodell → gar keine Zeile', async () => {
    const r = await runWeather(
      deps(fakeOpenMeteo(responses(), { main: 503 })),
      site,
      s.clock.now(),
    );
    expect(r.outcome).toBe('main_failed');
    expect(await rows()).toEqual([]);
  });

  it('Air-Quality fällt aus → nur aod = null und aerosolMissing, ohne +cams', async () => {
    const r = await runWeather(
      deps(fakeOpenMeteo(responses(), { aerosol: true })),
      site,
      s.clock.now(),
    );
    expect(r.modelSet).toBe('hrrr+gem+gfs+ecmwf+nbm');
    const p = await payload();
    for (const h of p.hours) {
      expect(h.aod).toBeNull();
      expect(h.aerosolMissing).toBe(true);
      expect(h.transparencyScore).toBeNull();
      expect(h.pwvMm).toBe(18);
    }
    // Jede Nacht mit Stunden in der Dunkelheit trägt das Kennzeichen.
    const covered = p.nights.filter((n) => n.coveredSec > 0);
    expect(covered.length).toBeGreaterThanOrEqual(6);
    expect(covered.every((n) => n.aerosolMissing)).toBe(true);
  });

  it('CAMS-Horizont endet → nur die späteren Stunden ohne Aerosol', async () => {
    await runWeather(
      deps(fakeOpenMeteo(responses({ aerosolHorizon: 5 * 24 }))),
      site,
      s.clock.now(),
    );
    const p = await payload();
    const cut = START + 5 * 24 * 3600;
    expect(p.hours.filter((h) => h.tUnix < cut).every((h) => !h.aerosolMissing)).toBe(true);
    expect(p.hours.filter((h) => h.tUnix >= cut).every((h) => h.aerosolMissing)).toBe(true);
    expect(p.nights.some((n) => n.aerosolMissing)).toBe(true);
    expect(p.nights[0]?.aerosolMissing).toBe(false);
  });

  it('Modellvergleich fällt aus → pwv null, kein cloudSrc, kein Nest', async () => {
    const r = await runWeather(
      deps(fakeOpenMeteo(responses({ nestHours: 40 }), { compare: true })),
      site,
      s.clock.now(),
    );
    expect(r.modelSet).toBe('gfs+cams');
    const p = await payload();
    expect(p.cmp3).toBe('base');
    for (const h of p.hours) {
      expect(h.pwvMm).toBeNull();
      expect(h.cloudSrc).toBeNull();
      expect(h.nest).toBe(false);
      expect(h.modelId).toBe('gfs');
      expect(h.aod).toBe(0.14);
    }
  });

  it('höchstens ein Lauf je Ort und Viertelstunde (Entscheidung Sven 29.09.2026)', async () => {
    const http = fakeOpenMeteo(responses());
    await runWeather(deps(http), site, s.clock.now());
    s.clock.advance(10 * 60_000);
    expect((await runWeather(deps(http), site, s.clock.now())).outcome).toBe('fresh');
    expect(http.urls).toHaveLength(3);
    s.clock.advance(5 * 60_000);
    expect((await runWeather(deps(http), site, s.clock.now())).outcome).toBe('written');
    expect(http.urls).toHaveLength(6);
    expect(await rows()).toHaveLength(1); // gleicher Modellsatz → Upsert
  });
});

describe('weatherSlot', () => {
  it('Viertelstunde in UTC', () => {
    expect(weatherSlot(new Date('2026-09-29T14:00:00Z'))).toBe('2026-09-29T14:00');
    expect(weatherSlot(new Date('2026-09-29T14:14:59Z'))).toBe('2026-09-29T14:00');
    expect(weatherSlot(new Date('2026-09-29T14:15:00Z'))).toBe('2026-09-29T14:15');
    expect(weatherSlot(new Date('2026-09-29T14:59:59Z'))).toBe('2026-09-29T14:45');
  });
});

describe('tick-5min und Job-Handler', () => {
  async function tenantWithSite(key: string, over: Partial<typeof SITE> = {}) {
    const tenantId = await s.seed.tenant(key);
    const eq = s.services.repositories({ tenantId }).equipment();
    const st = await eq.createSite(id(), { ...SITE, ...over }, s.clock.now());
    return { tenantId, siteId: st.id };
  }

  it('je Ort ein Job, gleiche Orte zweier Mandanten teilen sich den Lauf; Ticks derselben Viertelstunde sind No-ops', async () => {
    const a = await tenantWithSite('alpha');
    const b = await tenantWithSite('beta');
    const c = await tenantWithSite('gamma', {
      latitudeDeg: 52.37,
      longitudeDeg: 9.73,
      timeZone: 'Europe/Berlin',
    });
    const http = fakeOpenMeteo(responses());
    const handler = weatherJobHandler({
      ...deps(http),
      site: (tenantId, siteId) => s.services.repositories({ tenantId }).equipment().site(siteId),
    });
    const jobs: JobRunnerDeps = {
      queue: () => Promise.resolve(new JobQueue(s.pg.db)),
      handlers: { weather: handler },
      now: () => s.clock.now(),
    };
    const tick = {
      sites: () => weatherSites(s.pg.db),
      enqueue: (tenantId: string, input: EnqueueInput) =>
        s.services.repositories({ tenantId }).job.enqueue(input),
      runDone: (tenantId: string, key: string) => siteNightRunDone(s.pg.db, tenantId, key),
    };
    expect(await weatherTick(tick, jobs, s.clock.now())).toBe(2);
    expect(http.urls.filter((u) => u.includes('/v1/gfs'))).toHaveLength(1);
    expect(http.urls.filter((u) => u.includes('/v1/dwd-icon'))).toHaveLength(1);
    expect((await rows()).map((r) => r.model_set).sort()).toEqual([
      'hrrr+gem+gfs+ecmwf+nbm+cams',
      'icon-d2+harmonie+icon+ecmwf+gem+cams',
    ]);
    const keys = {
      rows: (
        await s.pg.admin.query(
          "SELECT dedupe_key, status FROM job WHERE kind = 'weather' ORDER BY dedupe_key",
        )
      ).rows as { dedupe_key: string; status: string }[],
    };
    expect(keys.rows.map((r) => r.status)).toEqual(['done', 'done']);
    const slot = weatherSlot(s.clock.now());
    const first = [a, b].filter((t) =>
      keys.rows.some((r) => r.dedupe_key === `weather:${t.siteId}:${slot}`),
    );
    expect(first).toHaveLength(1);
    expect(keys.rows.map((r) => r.dedupe_key)).toContain(`weather:${c.siteId}:${slot}`);
    // Derselbe Tick in derselben Viertelstunde: keine neuen Jobs, keine Abrufe.
    expect(await weatherTick(tick, jobs, s.clock.now())).toBe(0);
    expect(http.urls).toHaveLength(6);
    // Nächste Viertelstunde (tick-5min, 15 min später): beide Orte werden neu geholt.
    s.clock.advance(15 * 60_000);
    expect(weatherSlot(s.clock.now())).not.toBe(slot);
    expect(await weatherTick(tick, jobs, s.clock.now())).toBe(2);
    expect(http.urls).toHaveLength(12);
  });
});

describe('GET /sites/{id}/weather', () => {
  async function setup() {
    const tenantId = await s.seed.tenant('alpha');
    const identity = await s.seed.identity({ mfaEnabled: true });
    const owner = await s.seed.member(identity.id, tenantId, 'user');
    const cookies = {
      [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant'),
    };
    const eq = s.services.repositories({ tenantId, memberId: owner }).equipment();
    const st = await eq.createSite(id(), SITE, s.clock.now());
    const get = async () => {
      const res = await s.request(`/api/web/v1/sites/${st.id}/weather`, { cookies });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    return { get };
  }

  it('ohne Abruf: pending, leere Stunden', async () => {
    const { get } = await setup();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'pending',
      fetchedAtUtc: null,
      hours: [],
      days: 7,
      cmp3: 'base',
    });
  });

  it('mit Stand: gerundete Scores, Nächte mit Dunkelheit, Mond und bestem Fenster', async () => {
    const { get } = await setup();
    await runWeather(deps(fakeOpenMeteo(responses())), site, s.clock.now());
    const raw = await payload();
    const res = await get();
    expect(res.status).toBe(200);
    const body = res.body as {
      status: string;
      modelSet: string;
      hours: { tUtc: string; overallScore: number; sunAltDeg: number; ratingIndex: number }[];
      nights: {
        night: string;
        nightMean: number;
        darkFromUtc: string;
        coverage: number;
        moonIllumPct: number;
        moonEvents: unknown[];
        bestWindow: { meanScore: number } | null;
      }[];
      darkWindows: unknown[];
      nightWindows: unknown[];
      timeZoneTransitions: unknown[];
    };
    expect(body.status).toBe('ready');
    expect(body.modelSet).toBe('hrrr+gem+gfs+ecmwf+nbm+cams');
    expect(body.hours[0]?.tUtc).toBe('2026-09-23T17:00:00Z');
    const rawScore = raw.hours[0]?.overallScore as number;
    expect(body.hours[0]?.overallScore).toBe(Math.round(rawScore * 1000) / 1000);
    expect(body.hours[0]?.sunAltDeg).toBeGreaterThan(0); // 17:30Z = 12:30 CDT
    const n0 = body.nights[0];
    expect(n0?.night).toBe('2026-09-23');
    expect(n0?.darkFromUtc).toMatch(/^2026-09-24T0\d:\d\d:\d\dZ$/);
    expect(n0?.coverage).toBe(1);
    expect(n0?.nightMean).toBe(Math.round((raw.nights[0]?.nightMean as number) * 1000) / 1000);
    expect(n0?.moonIllumPct).toBeGreaterThan(0);
    expect(body.darkWindows.length).toBe(body.nights.length);
    expect(body.nightWindows.length).toBe(body.nights.length);
    expect(body.timeZoneTransitions.length).toBeGreaterThan(0);
  });
});
