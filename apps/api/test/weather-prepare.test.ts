/**
 * Stundenaufbereitung und Abrufe (AP-23; specs/engine/weather.md §1, Pflicht-Tests §4 (a), (b), (i), (j),
 * (k)): Feld- und Herkunftstest, Intervallwerte vom Stempel `t + 1 h`, `weatherCode` neu ableiten,
 * Nest-Erkennung mit Latch und `NEST_MAX_H`, Suffix-Vorrang und feine Übernahme; Abrufparameter
 * (`timezone=UTC`, nie `auto`), Modellsatz, `httpClient`.
 */
import { describe, expect, it, vi } from 'vitest';
import { httpClient, HttpError } from '../src/lib/http-client';
import {
  hourlyOf,
  inEurope,
  MAIN_HOURLY,
  modelChain,
  modelSet,
  weatherUrls,
  type HourlyBlock,
} from '../src/weather/open-meteo';
import { prepareHours, type PreparedHour } from '../src/weather/prepare';
import { aerosolResponse, compareResponse, hoursFrom, mainResponse } from './support/open-meteo';

const T0 = Date.UTC(2026, 8, 25, 0) / 1000;
const HANNOVER = { lat: 52.37, lon: 9.73 };
const STARFRONT = { lat: 31.547, lon: -99.382 };

const block = (body: unknown) => hourlyOf(body) as HourlyBlock;

function run(o: {
  where?: { lat: number; lon: number };
  main: unknown;
  aerosol?: unknown;
  compare?: unknown;
  nowUnix?: number;
}) {
  const where = o.where ?? STARFRONT;
  return prepareHours({
    chain: modelChain(where.lat, where.lon),
    main: block(o.main),
    aerosol: o.aerosol ? block(o.aerosol) : null,
    compare: o.compare ? block(o.compare) : null,
    nowUnix: o.nowUnix ?? T0,
    moonAltDeg: (t) => (t - T0) / 3600 - 10,
  });
}

describe('(a) Einheiten- und Feldtest (§1.1)', () => {
  const time = hoursFrom(T0, 2);
  const main = mainResponse(time, {
    cloud_cover: [100, 0],
    cloud_cover_low: [0, 0],
    cloud_cover_mid: [100, 0],
    cloud_cover_high: [50, 0],
    temperature_2m: [-40, 0],
    dew_point_2m: [-45, 0],
    relative_humidity_2m: [100, 0],
    wind_speed_10m: [0, 0],
    wind_gusts_10m: [0, 120],
    wind_direction_10m: [360, 0],
    wind_speed_250hPa: [300, 0],
    wind_direction_250hPa: [0, 0],
    wind_speed_500hPa: [150, 0],
    wind_direction_500hPa: [90, 0],
    wind_speed_700hPa: [80, 0],
    wind_direction_700hPa: [180, 0],
    wind_speed_850hPa: [60, 0],
    wind_direction_850hPa: [270, 0],
    surface_pressure: [700, 0],
    visibility: [0, 0],
    precipitation: [0, 12.4],
    precipitation_probability: [0, 100],
    weather_code: [99, 0],
  });
  const aerosol = aerosolResponse(time, 2, { aerosol_optical_depth: [2.5, 0], dust: [900, 0] });
  // Vergleich nur mit ECMWF-Wolken und Wasserdampf (ohne feines Modell), damit die Wolken aus dem Hauptabruf bleiben.
  const compare = {
    hourly: {
      time,
      cloud_cover_ecmwf_ifs: [77, 0],
      total_column_integrated_water_vapour_ecmwf_ifs: [65, 0],
    },
  };
  it('jedes Feld mit Name, Einheit und Herkunft', () => {
    const [h] = run({ main, aerosol, compare }).hours as [PreparedHour];
    expect(h).toMatchObject({
      tUnix: T0,
      cloudTotalPct: 100, // cloud_cover, %, Hauptabruf
      cloudLowPct: 0,
      cloudMidPct: 100,
      cloudHighPct: 50,
      tempC: -40, // temperature_2m, °C
      dewPointC: -45,
      humidityPct: 100,
      wind10Kmh: 0, // km/h (wind_speed_unit=kmh)
      gust10Kmh: 120, // Intervallwert vom Stempel t + 1 h
      windDir10Deg: 360,
      wind250Kmh: 300,
      windDir250Deg: 0,
      wind500Kmh: 150,
      windDir500Deg: 90,
      wind700Kmh: 80,
      windDir700Deg: 180,
      wind850Kmh: 60,
      windDir850Deg: 270,
      surfacePressureHPa: 700,
      visibilityM: 0, // m; Hauptabruf, auch eine 0
      precipMm: 12.4, // Intervallwert
      precipProbPct: 100, // Intervallwert
      weatherCode: 99,
      aod: 2.5, // Air-Quality-Abruf, dimensionslos
      dustUgM3: 900, // Air-Quality-Abruf, µg/m³
      pwvMm: 65, // Vergleichsabruf, kg/m² ≙ mm
      cloudEcmwfPct: 77,
      moonAltDeg: -10,
      cloudSrc: null,
      nest: false,
    });
    for (const key of Object.keys(h)) {
      const v = h[key as keyof PreparedHour];
      expect(['number', 'boolean', 'string', 'object'].includes(typeof v)).toBe(true);
    }
  });
  it('jedes Feld darf null sein, ohne dass die Stunde verworfen wird', () => {
    const empty = {
      hourly: { time, ...Object.fromEntries(MAIN_HOURLY.map((k) => [k, [null, null]])) },
    };
    const res = run({ main: empty, aerosol: { hourly: { time } }, compare: { hourly: { time } } });
    expect(res.hours).toHaveLength(2);
    const [h] = res.hours as [PreparedHour];
    for (const key of [
      'cloudTotalPct',
      'tempC',
      'wind10Kmh',
      'gust10Kmh',
      'visibilityM',
      'weatherCode',
      'aod',
      'dustUgM3',
      'pwvMm',
    ] as const)
      expect(h[key]).toBeNull();
    // Fehlende Reihen gleichen fehlenden Werten.
    expect(run({ main: { hourly: { time } } }).hours).toHaveLength(2);
  });
});

describe('(b) Intervallwerte vom Stempel t + 1 h (WS-12)', () => {
  it.each(['wind_gusts_10m', 'precipitation', 'precipitation_probability'])('%s', (key) => {
    const time = hoursFrom(T0, 4);
    const { hours } = run({ main: mainResponse(time, { [key]: [10, 20, 30, 40] }) });
    const field = {
      wind_gusts_10m: 'gust10Kmh',
      precipitation: 'precipMm',
      precipitation_probability: 'precipProbPct',
    }[key] as 'gust10Kmh' | 'precipMm' | 'precipProbPct';
    expect(hours.map((h) => h[field])).toEqual([20, 30, 40, null]);
    // Die alte, falsche Richtung erwartete in Spalte t₁ die 10.
    expect(hours[1]?.[field]).not.toBe(10);
  });
  it('Momentanwerte bleiben beim Stempel t', () => {
    const time = hoursFrom(T0, 3);
    const { hours } = run({ main: mainResponse(time, { wind_speed_10m: [1, 2, 3] }) });
    expect(hours.map((h) => h.wind10Kmh)).toEqual([1, 2, 3]);
  });
});

describe('(i) weatherCode neu ableiten (WS-15)', () => {
  const time = hoursFrom(T0, 1);
  const withFine = (cloud: number, code: number) =>
    run({
      where: HANNOVER,
      main: mainResponse(time, { weather_code: [code] }),
      compare: { hourly: { time, cloud_cover_dmi_harmonie_arome_europe: [cloud] } },
    }).hours[0] as PreparedHour;
  it.each([
    [5, 0],
    [12.5, 1],
    [20, 1],
    [37.5, 2],
    [74.9, 2],
    [75, 3],
    [100, 3],
  ])('cloudSrc dini, Bedeckung %s %% → %s', (cloud, code) => {
    const h = withFine(cloud, 2);
    expect(h.cloudSrc).toBe('dini');
    expect(h.weatherCode).toBe(code);
  });
  it('Regen (61) bleibt 61', () => {
    expect(withFine(5, 61).weatherCode).toBe(61);
  });
  it('ohne cloudSrc bleibt der Basiscode', () => {
    const h = run({
      where: HANNOVER,
      main: mainResponse(time, { weather_code: [2], cloud_cover: [5] }),
    }).hours[0] as PreparedHour;
    expect(h.cloudSrc).toBeNull();
    expect(h.weatherCode).toBe(2);
  });
});

describe('(j) Nest-Erkennung (WS-14)', () => {
  const nestCompare = (
    time: number[],
    temps: (number | null)[],
    clouds: (number | null)[],
    europe = false,
  ) => ({
    hourly: {
      time,
      [europe ? 'temperature_2m_icon_d2' : 'temperature_2m_ncep_hrrr_conus']: temps,
      [europe ? 'cloud_cover_icon_d2' : 'cloud_cover_ncep_hrrr_conus']: clouds,
    },
  });
  it('|ΔT| 0,049 → Nest; 0,05 → nicht', () => {
    const time = hoursFrom(T0, 1);
    const main = mainResponse(time, { temperature_2m: [18], cloud_cover: [20] });
    expect(run({ main, compare: nestCompare(time, [18.049], [20]) }).hours[0]?.nest).toBe(true);
    expect(run({ main, compare: nestCompare(time, [18.05], [20]) }).hours[0]?.nest).toBe(false);
  });
  it('Bedeckung um 1 % verschieden → nicht (exakte Gleichheit)', () => {
    const time = hoursFrom(T0, 1);
    const main = mainResponse(time, { temperature_2m: [18], cloud_cover: [20] });
    expect(run({ main, compare: nestCompare(time, [18], [21]) }).hours[0]?.nest).toBe(false);
  });
  it('Latch: nach dem ersten Verlassen kein Wiedereinstieg', () => {
    const time = hoursFrom(T0, 9);
    const main = mainResponse(time);
    const temps = time.map((_, i) => (i === 6 ? 5 : 18));
    const clouds = time.map(() => 20);
    const { hours } = run({ main, compare: nestCompare(time, temps, clouds) });
    expect(hours.map((h) => h.nest)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(hours.map((h) => h.modelId)).toEqual([
      'hrrr',
      'hrrr',
      'hrrr',
      'hrrr',
      'hrrr',
      'hrrr',
      'gfs',
      'gfs',
      'gfs',
    ]);
  });
  it('NEST_MAX_H: Nordamerika nach 30 h nicht mehr, Europa unbegrenzt', () => {
    const time = [T0 + 31 * 3600];
    const main = mainResponse(time);
    expect(run({ main, compare: nestCompare(time, [18], [20]), nowUnix: T0 }).hours[0]?.nest).toBe(
      false,
    );
    const eu = run({
      where: HANNOVER,
      main,
      compare: nestCompare(time, [18], [20], true),
      nowUnix: T0,
    }).hours[0];
    expect(eu?.nest).toBe(true);
    expect(eu?.modelId).toBe('d2');
  });
  it('Vergleichsabruf ausgefallen → kein Nest, kein cloudSrc, kein pwv', () => {
    const time = hoursFrom(T0, 3);
    const { hours, cmp3 } = run({ main: mainResponse(time) });
    for (const h of hours) {
      expect(h.nest).toBe(false);
      expect(h.cloudSrc).toBeNull();
      expect(h.pwvMm).toBeNull();
      expect(h.cloudEcmwfPct).toBeNull();
    }
    expect(cmp3).toBe('base');
    expect(hours[0]?.cloudCmp3Pct).toBe(hours[0]?.cloudTotalPct);
  });
});

describe('(k) Suffix-Vorrang und feine Übernahme (WS-13/WS-14)', () => {
  const time = hoursFrom(T0, 2);
  it('nur cloud_cover ohne Suffix → wird gelesen; beide → das Suffix gewinnt', () => {
    const plain = run({
      main: mainResponse(time),
      compare: { hourly: { time, cloud_cover: [33, 33] } },
    });
    expect(plain.hours[0]?.cloudEcmwfPct).toBe(33);
    const both = run({
      main: mainResponse(time),
      compare: { hourly: { time, cloud_cover: [33, 33], cloud_cover_ecmwf_ifs: [44, 44] } },
    });
    expect(both.hours[0]?.cloudEcmwfPct).toBe(44);
  });
  it('feine Sicht 0 wird verworfen, 4000 übernommen', () => {
    const fine = (vis: number) =>
      run({
        where: HANNOVER,
        main: mainResponse(time, { visibility: [24000, 24000] }),
        compare: {
          hourly: {
            time,
            cloud_cover_dmi_harmonie_arome_europe: [50, 50],
            cloud_cover_low_dmi_harmonie_arome_europe: [1, 1],
            visibility_dmi_harmonie_arome_europe: [vis, vis],
          },
        },
      }).hours[0] as PreparedHour;
    expect(fine(0).visibilityM).toBe(24000);
    expect(fine(4000).visibilityM).toBe(4000);
    expect(fine(4000)).toMatchObject({
      cloudTotalPct: 50,
      cloudLowPct: 1,
      cloudSrc: 'dini',
      modelId: 'dini',
    });
  });
  it('Nordamerika: GEM trägt die Wolken, NBM Sicht und Regenwahrscheinlichkeit (Stempel t + 1 h)', () => {
    const t3 = hoursFrom(T0, 3);
    const compare = compareResponse(t3, STARFRONT.lat, STARFRONT.lon, {
      over: {
        cloud_cover_cmc_gem_seamless: [55, 55, 55],
        visibility_ncep_nbm_conus: [8000, 9000, 0],
        precipitation_probability_ncep_nbm_conus: [1, 2, 3],
      },
    });
    const { hours, cmp3 } = run({ main: mainResponse(t3), compare });
    expect(hours[0]).toMatchObject({
      cloudTotalPct: 55,
      cloudSrc: 'gem',
      modelId: 'gem',
      visibilityM: 8000,
      precipProbPct: 2,
    });
    expect(hours[2]?.visibilityM).toBe(30000); // NBM 0 = Füllwert → feine Sicht bleibt
    expect(cmp3).toBe('nbm');
  });
  it('Europa ohne Sicht → ICON global, mit Sicht → ICON-EU', () => {
    const t1 = hoursFrom(T0, 1);
    expect(
      run({ where: HANNOVER, main: mainResponse(t1, { visibility: [null] }) }).hours[0]?.modelId,
    ).toBe('global');
    expect(run({ where: HANNOVER, main: mainResponse(t1) }).hours[0]?.modelId).toBe('eu');
  });
});

describe('Abrufe (§1.3, TK 14)', () => {
  it('Parameter: timezone=UTC, unixtime, past_days=1, forecast_days=7, kmh; nie timezone=auto', () => {
    for (const where of [HANNOVER, STARFRONT]) {
      const urls = weatherUrls(where.lat.toFixed(3), where.lon.toFixed(3));
      expect(urls.main).toContain('timezone=UTC&');
      expect(urls.main).toContain('timeformat=unixtime');
      expect(urls.main).toContain('past_days=1');
      expect(urls.main).toContain('forecast_days=7');
      expect(urls.main).toContain('wind_speed_unit=kmh');
      for (const u of Object.values(urls)) {
        expect(u).not.toContain('timezone=auto');
        expect(u).toContain('timezone=UTC');
      }
      expect(
        urls.aerosol.startsWith('https://air-quality-api.open-meteo.com/v1/air-quality?'),
      ).toBe(true);
      expect(urls.aerosol).toContain('hourly=aerosol_optical_depth,dust');
      expect(urls.main).not.toContain('aerosol_optical_depth');
      expect(urls.main).not.toContain('total_column_integrated_water_vapour');
    }
  });
  it('Modellwahl nach Standort', () => {
    expect(inEurope(29.5, -23.5)).toBe(true);
    expect(inEurope(70.51, 10)).toBe(false);
    const eu = weatherUrls('52.370', '9.730');
    expect(eu.main.startsWith('https://api.open-meteo.com/v1/dwd-icon?')).toBe(true);
    expect(eu.compare).toContain(
      'models=ecmwf_ifs,dmi_harmonie_arome_europe,cmc_gem_seamless,icon_d2',
    );
    const us = weatherUrls('31.547', '-99.382');
    expect(us.main.startsWith('https://api.open-meteo.com/v1/gfs?')).toBe(true);
    expect(us.compare).toContain(
      'models=ecmwf_ifs,cmc_gem_seamless,ncep_nbm_conus,ncep_hrrr_conus',
    );
  });
  it('model_set (WS-16): ausgefallene optionale Abrufe fehlen mit ihren Kürzeln', () => {
    expect(modelSet(true, true, true)).toBe('icon-d2+harmonie+icon+ecmwf+gem+cams');
    expect(modelSet(false, true, true)).toBe('hrrr+gem+gfs+ecmwf+nbm+cams');
    expect(modelSet(true, true, false)).toBe('icon-d2+harmonie+icon+ecmwf+gem');
    expect(modelSet(false, false, true)).toBe('gfs+cams');
  });
});

describe('httpClient (TK 14)', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  it('User-Agent, Zeitlimit und zwei Wiederholungen bei Netzfehlern', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok({ a: 1 }));
    const client = httpClient({ fetchImpl, version: '1.2.3', sleep: () => Promise.resolve() });
    await expect(client.getJson('https://x.test')).resolves.toEqual({ a: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['user-agent']).toBe(
      'Svenesis-NINA-PM/1.2.3 (+https://nina-pm.svenesis.org)',
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('429/5xx ohne Wiederholung, wenn retryOnStatus = false (Hauptabruf)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 }));
    const client = httpClient({ fetchImpl, sleep: () => Promise.resolve() });
    await expect(client.getJson('https://x.test', { retryOnStatus: false })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('404 endet sofort, 503 wird wiederholt', async () => {
    const f404 = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(httpClient({ fetchImpl: f404 }).getJson('https://x.test')).rejects.toMatchObject({
      status: 404,
    });
    expect(f404).toHaveBeenCalledTimes(1);
    const f503 = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(ok({ b: 2 }));
    await expect(
      httpClient({ fetchImpl: f503, sleep: () => Promise.resolve() }).getJson('https://x.test'),
    ).resolves.toEqual({ b: 2 });
  });
});
