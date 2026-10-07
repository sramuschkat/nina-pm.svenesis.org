/**
 * AP-64b (FA-AUS-16/17; PGlite): Vorhersage je Standort und Nacht (`site_night_forecast`, Migration 0014).
 * - Writer (`tick-5min` nach dem Wetter): Bewertung der kommenden Nacht aus dem Wetter-Cache mit derselben Rechnung
 *   wie der Schnappschuss zum Sessionbeginn (`weatherView`); idempotent (nur jüngere Cache-Zeilen schreiben), ab
 *   Beginn der Dunkelheit unverändert, mandantengebunden; Standort löschen nimmt die Zeilen mit.
 * - Reader (`GET /sites/{id}/clear-nights`): Nacht ohne Session mit gespeicherter Vorhersage liefert
 *   `forecastRatingIndex` („klar, aber nicht genutzt“), der Schnappschuss einer Session hat Vorrang, die laufende
 *   Nacht bleibt ohne; die Treffsicherheit zählt weiter nur Nächte mit Session.
 */
import {
  latestWeather,
  recordSiteNightForecast,
  saveWeather,
  weatherSites,
  type SiteNightForecastInput,
} from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWeather } from '../src/weather/job';
import { comingNightForecast, recordNightForecasts } from '../src/weather/night-forecast';
import { weatherView } from '../src/weather/view';
import { CAMERA, rigInput, SITE, TELESCOPE } from './support/equipment';
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
// Stundenreihe wie mit past_days=1&forecast_days=7: ab gestern 00:00 UTC, 8 Tage (Uhr 2026-09-24T10:00Z).
const START = Date.UTC(2026, 8, 23) / 1000;
const TIME = hoursFrom(START, 192);
const responses = () => ({
  main: mainResponse(TIME),
  aerosol: aerosolResponse(TIME),
  compare: compareResponse(TIME, SITE.latitudeDeg, SITE.longitudeDeg, { nestHours: 0 }),
});

async function fetchWeather() {
  await runWeather(
    {
      http: fakeOpenMeteo(responses()),
      latest: (lat, lon) => latestWeather(s.pg.db, lat, lon),
      save: (entry) => saveWeather(s.pg.db, entry),
    },
    { latitudeDeg: SITE.latitudeDeg, longitudeDeg: SITE.longitudeDeg, timeZone: SITE.timeZone },
    s.clock.now(),
  );
}

const deps = {
  sites: () => weatherSites(s.pg.db),
  latest: (lat: number, lon: number) => latestWeather(s.pg.db, lat, lon),
  record: (input: SiteNightForecastInput, now: Date) =>
    recordSiteNightForecast(s.pg.db, input, now),
};

async function tenantWithSite(key: string) {
  const tenantId = await s.seed.tenant(key);
  const eq = s.services.repositories({ tenantId }).equipment();
  const site = await eq.createSite(id(), SITE, s.clock.now());
  return { tenantId, siteId: site.id, eq };
}

interface Row {
  tenant_id: string;
  site_id: string;
  night: string;
  rating_index: number;
  overall_score: number | null;
  model_set: string | null;
  recorded_at: Date;
}
async function rows(): Promise<Row[]> {
  const r = await s.pg.admin.query(
    `SELECT tenant_id, site_id, night::text AS night, rating_index, overall_score::float AS overall_score,
            model_set, recorded_at FROM site_night_forecast ORDER BY night, site_id`,
  );
  return r.rows as unknown as Row[];
}

describe('Writer: Vorhersage der kommenden Nacht', () => {
  it('schreibt die Bewertung wie der Schnappschuss, idempotent, ab Dunkelheit unverändert', async () => {
    const a = await tenantWithSite('alpha');
    // Ohne Wetter-Cache: nichts.
    expect(await recordNightForecasts(deps, s.clock.now())).toBe(0);
    await fetchWeather();
    const entry = await latestWeather(s.pg.db, SITE.latitudeDeg, SITE.longitudeDeg);
    if (!entry) throw new Error('kein Wetter');

    // 2026-09-24T10:00Z = 05:00 CDT: die Dunkelheit der Nacht 23./24. hat begonnen, kommende Nacht = 24./25.
    expect(await recordNightForecasts(deps, s.clock.now())).toBe(1);
    const view = weatherView({ ...SITE, id: a.siteId }, entry, s.clock.now());
    const coming = view.nights.find((n) => n.night === '2026-09-24');
    expect(coming?.ratingIndex).not.toBeNull();
    const [first] = await rows();
    expect(first).toMatchObject({
      tenant_id: a.tenantId,
      site_id: a.siteId,
      night: '2026-09-24',
      rating_index: coming?.ratingIndex,
      model_set: entry.modelSet,
    });
    expect(first?.overall_score).toBeCloseTo(coming?.nightMean ?? -1, 5);
    expect(new Date(first?.recorded_at ?? 0).toISOString()).toBe('2026-09-24T10:00:00.000Z');

    // Derselbe Cache-Stand → nichts geschrieben (auch nicht im nächsten Tick).
    s.clock.advance(5 * 60_000);
    expect(await recordNightForecasts(deps, s.clock.now())).toBe(0);
    expect(await rows()).toEqual([first]);

    // Neuer Wetter-Stand eine Stunde später → ersetzt die Zeile (recorded_at).
    s.clock.advance(55 * 60_000);
    await fetchWeather();
    expect(await recordNightForecasts(deps, s.clock.now())).toBe(1);
    const [second] = await rows();
    expect(new Date(second?.recorded_at ?? 0).toISOString()).toBe('2026-09-24T11:00:00.000Z');

    // Nach Beginn der Dunkelheit der Nacht 24./25.: deren Zeile bleibt, die nächste Nacht kommt dazu.
    const darkFrom = Date.parse(coming?.darkFromUtc ?? '');
    s.clock.set(new Date(darkFrom + 60_000));
    await fetchWeather();
    expect(await recordNightForecasts(deps, s.clock.now())).toBe(1);
    const after = await rows();
    expect(after.map((r) => r.night)).toEqual(['2026-09-24', '2026-09-25']);
    expect(after[0]).toEqual(second);
  });

  it('Repository: nicht ab Nachtbeginn, ältere Vorhersage schreibt nicht, Standort nur des Mandanten', async () => {
    const a = await tenantWithSite('alpha');
    const b = await tenantWithSite('beta');
    const base: SiteNightForecastInput = {
      tenantId: a.tenantId,
      siteId: a.siteId,
      night: '2026-09-24',
      ratingIndex: 3,
      overallScore: 0.7,
      modelSet: 'gfs',
      recordedAt: new Date('2026-09-24T12:00:00Z'),
      nightStartsAt: new Date('2026-09-25T01:50:00Z'),
    };
    const now = new Date('2026-09-24T12:05:00Z');
    expect(await recordSiteNightForecast(s.pg.db, base, now)).toBe('written');
    expect(await recordSiteNightForecast(s.pg.db, base, now)).toBe('unchanged');
    expect(
      await recordSiteNightForecast(
        s.pg.db,
        { ...base, ratingIndex: 1, recordedAt: new Date('2026-09-24T11:00:00Z') },
        now,
      ),
    ).toBe('unchanged');
    // Ab Nachtbeginn – oder mit einem Abruf nach Nachtbeginn – bleibt die letzte Vorhersage davor.
    expect(
      await recordSiteNightForecast(
        s.pg.db,
        { ...base, ratingIndex: 0, recordedAt: new Date('2026-09-25T01:45:00Z') },
        new Date('2026-09-25T01:50:00Z'),
      ),
    ).toBe('started');
    expect(
      await recordSiteNightForecast(
        s.pg.db,
        { ...base, ratingIndex: 0, recordedAt: new Date('2026-09-25T02:00:00Z') },
        now,
      ),
    ).toBe('started');
    // Fremder Standort (Mandant alpha, Standort von beta) → kein Schreiben.
    expect(await recordSiteNightForecast(s.pg.db, { ...base, siteId: b.siteId }, now)).toBe(
      'no_site',
    );
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ site_id: a.siteId, rating_index: 3, model_set: 'gfs' });
    // Jüngere Vorhersage vor Nachtbeginn ersetzt.
    expect(
      await recordSiteNightForecast(
        s.pg.db,
        {
          ...base,
          ratingIndex: 4,
          overallScore: null,
          recordedAt: new Date('2026-09-24T18:00:00Z'),
        },
        new Date('2026-09-24T18:01:00Z'),
      ),
    ).toBe('written');
    expect((await rows())[0]).toMatchObject({ rating_index: 4, overall_score: null });
    await expect(
      recordSiteNightForecast(s.pg.db, { ...base, ratingIndex: 5 }, now),
    ).rejects.toThrow();
  });

  it('comingNightForecast: ohne Bewertung keine Vorhersage', async () => {
    const a = await tenantWithSite('alpha');
    await fetchWeather();
    const entry = await latestWeather(s.pg.db, SITE.latitudeDeg, SITE.longitudeDeg);
    if (!entry) throw new Error('kein Wetter');
    const site = (await weatherSites(s.pg.db))[0];
    if (!site) throw new Error('kein Standort');
    expect(comingNightForecast(site, entry, s.clock.now())).toMatchObject({
      tenantId: a.tenantId,
      night: '2026-09-24',
    });
    // Jenseits des Vorhersagehorizonts gibt es keine bewertete Nacht.
    expect(comingNightForecast(site, entry, new Date('2026-10-30T10:00:00Z'))).toBeNull();
  });

  it('Standort löschen nimmt die Vorhersagen mit', async () => {
    const a = await tenantWithSite('alpha');
    await fetchWeather();
    expect(await recordNightForecasts(deps, s.clock.now())).toBe(1);
    await a.eq.deleteSite(a.siteId, s.clock.now());
    expect(await rows()).toEqual([]);
  });
});

describe('Reader: Standort-Statistik mit gespeicherter Vorhersage', () => {
  async function setup() {
    const tenantId = await s.seed.tenant('alpha');
    const identity = await s.seed.identity({ mfaEnabled: true });
    const member = await s.seed.member(identity.id, tenantId, 'user');
    const cookies = {
      [COOKIE_NAMES.session]: await s.seed.session(identity.id, tenantId, 'tenant'),
    };
    const eq = s.services.repositories({ tenantId, memberId: member }).equipment();
    const now = s.clock.now();
    const site = await eq.createSite(id(), SITE, now);
    const telescope = await eq.createTelescope(id(), TELESCOPE, now);
    const camera = await eq.createCamera(id(), CAMERA, now);
    const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
    const get = async (from: string, to: string) => {
      const res = await s.request(
        `/api/web/v1/sites/${site.id}/clear-nights?from=${from}&to=${to}`,
        { cookies },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const forecast = (night: string, ratingIndex: number, overallScore: number | null) =>
      recordSiteNightForecast(
        s.pg.db,
        {
          tenantId,
          siteId: site.id,
          night,
          ratingIndex,
          overallScore,
          modelSet: 'gfs',
          recordedAt: new Date(`${night}T18:00:00Z`),
          nightStartsAt: new Date(`${night}T23:59:00Z`),
        },
        new Date(`${night}T18:01:00Z`),
      );
    return { tenantId, site, rig, get, forecast };
  }

  it('Nacht ohne Session mit guter Vorhersage, Vorrang des Schnappschusses, laufende Nacht ohne', async () => {
    const t = await setup();
    expect(await t.forecast('2026-09-20', 4, 0.81)).toBe('written');
    expect(await t.forecast('2026-09-21', 1, 0.2)).toBe('written');
    expect(await t.forecast('2026-09-22', 1, 0.25)).toBe('written');
    // Laufende Nacht (Uhr 2026-09-24T10:00Z = 05:00 CDT → Nacht 23./24.) bleibt ohne gespeicherte Vorhersage.
    expect(await t.forecast('2026-09-23', 4, 0.9)).toBe('written');
    // Session in der Nacht 22./23. mit Schnappschuss „Gut“ – nicht nutzbar (unter 1 h).
    const sid = id();
    await s.pg.admin.query(
      `INSERT INTO session (id, tenant_id, rig_id, night, started_at, forecast_snapshot)
       VALUES ($1, $2, $3, '2026-09-22', '2026-09-23T01:00:00Z', $4::jsonb)`,
      [
        sid,
        t.tenantId,
        t.rig.id,
        JSON.stringify({ night: '2026-09-22', ratingIndex: 3, nightMean: 0.66, hours: 5 }),
      ],
    );
    await s.pg.admin.query(
      `INSERT INTO site_night_stat (tenant_id, site_id, night, usable, usable_hours, source)
       VALUES ($1, $2, '2026-09-22', false, 0.4, 'session')`,
      [t.tenantId, t.site.id],
    );

    const res = await t.get('2026-09-19', '2026-09-23');
    expect(res.status).toBe(200);
    const nights = res.body.nights as Record<string, unknown>[];
    const by = (night: string) => nights.find((n) => n.night === night);
    expect(by('2026-09-20')).toMatchObject({
      source: null,
      usable: null,
      sessionIds: [],
      forecastRatingIndex: 4,
      forecastNightMean: 0.81,
    });
    expect(by('2026-09-21')).toMatchObject({ source: null, forecastRatingIndex: 1 });
    expect(by('2026-09-22')).toMatchObject({
      source: 'session',
      usable: false,
      sessionIds: [sid],
      forecastRatingIndex: 3,
      forecastNightMean: 0.66,
    });
    expect(by('2026-09-23')).toMatchObject({ forecastRatingIndex: null, forecastNightMean: null });
    expect(by('2026-09-19')).toMatchObject({ forecastRatingIndex: null });
    // Treffsicherheit: nur die Nacht mit Session (Gut vorhergesagt, nicht nutzbar → daneben).
    expect(res.body.accuracy).toEqual({ compared: 1, hits: 0, hitPct: 0 });
    // Erfasste Nächte (Monatszeile) unverändert: nur Session/manuell.
    expect(res.body.months).toEqual([
      { month: '2026-09', recorded: 1, usable: 0, usablePct: 0, meanUsableHours: null },
    ]);
  });

  it('ohne Schnappschuss der Session gilt die gespeicherte Vorhersage; fremder Mandant sieht nichts', async () => {
    const t = await setup();
    expect(await t.forecast('2026-09-21', 3, 0.7)).toBe('written');
    const sid = id();
    await s.pg.admin.query(
      `INSERT INTO session (id, tenant_id, rig_id, night, started_at)
       VALUES ($1, $2, $3, '2026-09-21', '2026-09-22T01:00:00Z')`,
      [sid, t.tenantId, t.rig.id],
    );
    const res = await t.get('2026-09-21', '2026-09-21');
    expect((res.body.nights as Record<string, unknown>[])[0]).toMatchObject({
      sessionIds: [sid],
      forecastRatingIndex: 3,
      forecastNightMean: 0.7,
    });
    // Zweiter Mandant mit eigenem Standort: keine fremden Vorhersagen.
    const other = await s.seed.tenant('beta');
    const eq = s.services.repositories({ tenantId: other }).equipment();
    const site = await eq.createSite(id(), SITE, s.clock.now());
    const data = await s.services
      .repositories({ tenantId: other })
      .sessionLog()
      .clearNightData(site.id, '2026-09-01', '2026-09-30');
    expect(data.forecasts).toEqual([]);
    await expect(
      s.services
        .repositories({ tenantId: other })
        .sessionLog()
        .clearNightData(t.site.id, '2026-09-01', '2026-09-30')
        .then((d) => d.forecasts),
    ).resolves.toEqual([]);
  });
});
