/**
 * Job `weather` (TK 13, WS-13/WS-16; FA-WET-07): je Standort und Lauf drei Abrufe in einem `Promise.all`,
 * Stundenaufbereitung, Bewertung nach specs/engine/weather.md und eine Zeile `weather_cache`. Nur der
 * Hauptabruf ist Pflicht – fällt er aus, endet der Lauf **ohne** Schreiben und der letzte Stand bleibt
 * gültig. Höchstens ein Lauf je Ort und Viertelstunde (Prüfung gegen `fetched_at`, gleiche Orte mehrerer
 * Mandanten teilen sich die Zeile); `tick-5min` legt je Standort `weather:<siteId>:<Viertelstunde>` an
 * (alle 15 min statt stündlich seit 29.09.2026, Entscheidung Sven: HRRR rechnet stündlich neu).
 */
import { moonAt, weatherScores, type WeatherNight, type WeatherScoredHour } from '@nina-pm/engine';
import {
  weatherCoord,
  type EnqueueInput,
  type EnqueueResult,
  type WeatherCacheEntry,
  type WeatherSite,
} from '@nina-pm/db';
import { dedupeKeys } from '@nina-pm/shared';
import { z } from 'zod';
import { isoUtc } from '../lib/format';
import type { HttpClient } from '../lib/http-client';
import { logger } from '../lib/logger';
import { tzdataVersion } from '../lib/night-table';
import {
  budgetExhausted,
  runJob,
  type JobHandler,
  type JobRunnerDeps,
  type TickBudget,
} from '../worker/jobs';
import { weatherNightTable, type WeatherSiteGeo } from './nights';
import { hourlyOf, modelChain, modelSet, weatherUrls } from './open-meteo';
import { prepareHours, type Cmp3Source, type PreparedHour } from './prepare';

/** Takt der Abrufe je Standort (TK 13/14, Entscheidung Sven 29.09.2026). */
export const WEATHER_INTERVAL_MS = 15 * 60_000;
/** Mindestabstand zweier Läufe je Ort; knapp unter dem Takt, damit er nicht an Sekunden scheitert. */
export const WEATHER_MIN_INTERVAL_MS = 14 * 60_000;
/** Gültigkeit einer Zeile = ein Takt. */
export const WEATHER_TTL_MS = WEATHER_INTERVAL_MS;
/**
 * Zeitbudget je `tick-5min`-Lauf für das Wetter: danach startet kein neuer Abruf, damit der Lauf vor dem
 * nächsten Tick endet; die übrigen Orte holt der nächste Lauf (Muster wie `HOURLY_FETCH_BUDGET_MS`).
 */
export const WEATHER_TICK_BUDGET_MS = 3 * 60_000;

/** Viertelstunde eines Zeitpunkts als `YYYY-MM-DDTHH:MM` (UTC), Minute 00/15/30/45. */
export function weatherSlot(now: Date): string {
  const iso = isoUtc(now);
  const quarter = Math.floor(Number(iso.slice(14, 16)) / 15) * 15;
  return `${iso.slice(0, 13)}:${String(quarter).padStart(2, '0')}`;
}

export type WeatherPayloadHour = PreparedHour & WeatherScoredHour;

/** `weather_cache.payload` (weather.md §3.4); Scores ungerundet. */
export interface WeatherPayload {
  readonly fetchedAtUtc: string;
  readonly lat: number;
  readonly lon: number;
  readonly tzdataVersion: string;
  readonly region: 'europe' | 'other';
  readonly cmp3: Cmp3Source;
  readonly hours: WeatherPayloadHour[];
  readonly nights: WeatherNight[];
}

export interface WeatherDeps {
  readonly http: HttpClient;
  readonly latest: (
    latitudeDeg: number,
    longitudeDeg: number,
  ) => Promise<WeatherCacheEntry | undefined>;
  readonly save: (entry: {
    latitudeDeg: number;
    longitudeDeg: number;
    modelSet: string;
    payload: WeatherPayload;
    fetchedAt: Date;
    expiresAt: Date;
  }) => Promise<void>;
}

export type WeatherRunOutcome = 'written' | 'fresh' | 'main_failed';

/** Ein Lauf für einen Standort. */
export async function runWeather(
  deps: WeatherDeps,
  site: WeatherSiteGeo,
  now: Date,
): Promise<{ outcome: WeatherRunOutcome; modelSet?: string }> {
  const last = await deps.latest(site.latitudeDeg, site.longitudeDeg);
  if (last && now.getTime() - last.fetchedAt.getTime() < WEATHER_MIN_INTERVAL_MS)
    return { outcome: 'fresh' };

  const lat = weatherCoord(site.latitudeDeg);
  const lon = weatherCoord(site.longitudeDeg);
  const chain = modelChain(Number(lat), Number(lon));
  const urls = weatherUrls(lat, lon);
  const [main, aerosol, compare] = await Promise.all([
    // Hauptabruf: 429/5xx beenden den Lauf ohne Wiederholung in derselben Viertelstunde (TK 13).
    deps.http.getJson(urls.main, { retryOnStatus: false }).catch((error: unknown) => {
      logger.warn('weather_main_failed', {
        lat,
        lon,
        error: error instanceof Error ? error.message : 'unbekannt',
      });
      return null;
    }),
    deps.http.getJson(urls.aerosol).catch(() => null),
    deps.http.getJson(urls.compare).catch(() => null),
  ]);
  const mainHourly = hourlyOf(main);
  if (!mainHourly || mainHourly.time.length === 0) return { outcome: 'main_failed' };
  const aerosolHourly = hourlyOf(aerosol);
  const compareHourly = hourlyOf(compare);

  const nowUnix = Math.floor(now.getTime() / 1000);
  const geo = { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg };
  const { hours, cmp3 } = prepareHours({
    chain,
    main: mainHourly,
    aerosol: aerosolHourly,
    compare: compareHourly,
    nowUnix,
    moonAltDeg: (t) => moonAt(t + 1800, geo).altGeometricDeg,
  });

  // Die laufende Nacht bleibt ganz, frühere Stunden entfallen (past_days=1, §1.3).
  const lastHour = hours[hours.length - 1]?.tUnix ?? nowUnix;
  const table = weatherNightTable(site, now, lastHour);
  const keepFrom = table.nights[0]?.noonStartUtc ?? nowUnix;
  const kept = hours.filter((h) => h.tUnix >= keepFrom);
  const darkWindows = table.nights.flatMap((n) => (n.dark ? [n.dark] : []));
  const scores = weatherScores({ hourly: kept, darkWindows });

  const set = modelSet(chain.europe, compareHourly !== null, aerosolHourly !== null);
  await deps.save({
    latitudeDeg: site.latitudeDeg,
    longitudeDeg: site.longitudeDeg,
    modelSet: set,
    payload: {
      fetchedAtUtc: isoUtc(now),
      lat: Number(lat),
      lon: Number(lon),
      tzdataVersion: tzdataVersion(),
      region: chain.europe ? 'europe' : 'other',
      cmp3,
      hours: scores.hours,
      nights: scores.nights,
    },
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + WEATHER_TTL_MS),
  });
  return { outcome: 'written', modelSet: set };
}

export interface WeatherJobDeps extends WeatherDeps {
  /** Standort mandantengebunden laden (Koordinaten und Zeitzone). */
  readonly site: (tenantId: string, siteId: string) => Promise<WeatherSiteGeo | undefined>;
}

const WeatherJobInput = z.object({ siteId: z.uuid() });

export function weatherJobHandler(deps: WeatherJobDeps): JobHandler {
  return async ({ job, now }) => {
    if (!job.tenantId) throw new Error('weather ohne Mandant');
    const { siteId } = WeatherJobInput.parse(job.input);
    const site = await deps.site(job.tenantId, siteId);
    if (!site) {
      logger.info('weather_site_gone', { siteId });
      return undefined;
    }
    const r = await runWeather(deps, site, now());
    logger.info('weather', { siteId, ...r });
    return undefined;
  };
}

export interface WeatherTickDeps {
  readonly sites: () => Promise<WeatherSite[]>;
  readonly enqueue: (tenantId: string, input: EnqueueInput) => Promise<EnqueueResult>;
  readonly runDone: (tenantId: string, key: string) => Promise<boolean>;
}

/**
 * `tick-5min`: je Standort aktiver Mandanten `weather:<siteId>:<Viertelstunde>` anlegen und sofort ausführen –
 * der Reihe nach, damit nicht alle Aufrufe gleichzeitig starten; derselbe Ort nur einmal je Lauf. Die übrigen
 * Ticks derselben Viertelstunde sind No-ops (`runDone`). Nach dem Zeitbudget (`WEATHER_TICK_BUDGET_MS`) kein
 * neuer Abruf; der nächste Lauf holt die übrigen Orte.
 */
export async function weatherTick(
  deps: WeatherTickDeps,
  jobs: JobRunnerDeps,
  now: Date,
  budget?: TickBudget,
): Promise<number> {
  const exhausted = budgetExhausted(budget, WEATHER_TICK_BUDGET_MS);
  const slot = weatherSlot(now);
  const seen = new Set<string>();
  const sites = await deps.sites();
  let runs = 0;
  for (const [i, site] of sites.entries()) {
    if (exhausted()) {
      logger.warn('weather_tick_budget', { runs, skipped: sites.length - i });
      break;
    }
    const place = `${weatherCoord(site.latitudeDeg)},${weatherCoord(site.longitudeDeg)}`;
    if (seen.has(place)) continue;
    seen.add(place);
    try {
      const key = dedupeKeys.weatherSiteSlot(site.siteId, slot);
      if (await deps.runDone(site.tenantId, key)) continue;
      const job = await deps.enqueue(site.tenantId, {
        kind: 'weather',
        input: { siteId: site.siteId },
        dedupeKey: key,
      });
      if (!job.created) continue;
      await runJob(jobs, job.jobId);
      runs += 1;
    } catch (error) {
      logger.warn('weather_tick_failed', {
        siteId: site.siteId,
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    }
  }
  return runs;
}
