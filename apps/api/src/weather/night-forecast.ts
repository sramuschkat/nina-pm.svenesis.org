/**
 * Vorhersage je Standort und Nacht festhalten (AP-64b, FA-AUS-16/17; Entscheidung Sven 07.10.2026): Die
 * Standort-Statistik markiert eine Nacht als „klar, aber nicht genutzt“, wenn die Vorhersage gut oder besser war,
 * aber unter 1 h belichtet wurde – auch ohne Session. Dafür schreibt der worker im `tick-5min` (nach dem Wetter) je
 * Standort aktiver Mandanten die Bewertung der **kommenden Nacht** aus der jüngsten `weather_cache`-Zeile nach
 * `site_night_forecast`.
 *
 * - **Gleiche Rechnung wie der Schnappschuss zum Sessionbeginn** (`captureForecastSnapshot`): `weatherView` des
 *   Standorts, Nacht-Bewertung `ratingIndex` (FA-WET-03) und `nightMean` der Nacht.
 * - **Kommende Nacht** = erste Nacht der Sicht, deren astronomische Dunkelheit noch nicht begonnen hat. Ohne
 *   Dunkelheit (Polartag) oder ohne Bewertung wird nichts geschrieben.
 * - Die Zeile ändert sich nur mit einer jüngeren Cache-Zeile (höchstens einmal je Wetter-Takt) und nicht mehr ab
 *   Beginn der Dunkelheit: Es gilt die letzte Vorhersage davor (Repository `recordSiteNightForecast`).
 */
import type {
  SiteNightForecastInput,
  SiteNightForecastOutcome,
  WeatherCacheEntry,
  WeatherSite,
} from '@nina-pm/db';
import { logger } from '../lib/logger';
import { weatherView } from './view';

export interface NightForecastDeps {
  readonly sites: () => Promise<WeatherSite[]>;
  readonly latest: (
    latitudeDeg: number,
    longitudeDeg: number,
  ) => Promise<WeatherCacheEntry | undefined>;
  readonly record: (input: SiteNightForecastInput, now: Date) => Promise<SiteNightForecastOutcome>;
}

/** Vorhersage der kommenden Nacht eines Standorts aus der Cache-Zeile; `null` ohne Dunkelheit oder Bewertung. */
export function comingNightForecast(
  site: WeatherSite,
  entry: WeatherCacheEntry,
  now: Date,
): SiteNightForecastInput | null {
  const view = weatherView(
    {
      id: site.siteId,
      latitudeDeg: site.latitudeDeg,
      longitudeDeg: site.longitudeDeg,
      timeZone: site.timeZone,
    },
    entry,
    now,
  );
  const night = view.nights.find(
    (n) => n.darkFromUtc !== null && Date.parse(n.darkFromUtc) > now.getTime(),
  );
  if (!night?.darkFromUtc || night.ratingIndex === null) return null;
  return {
    tenantId: site.tenantId,
    siteId: site.siteId,
    night: night.night,
    ratingIndex: night.ratingIndex,
    overallScore: night.nightMean,
    modelSet: entry.modelSet,
    recordedAt: entry.fetchedAt,
    nightStartsAt: new Date(night.darkFromUtc),
  };
}

/**
 * `tick-5min`: je Standort aktiver Mandanten die Vorhersage der kommenden Nacht festhalten; liefert die Zahl der
 * geschriebenen Zeilen. Fehler eines Standorts brechen den Lauf nicht ab.
 */
export async function recordNightForecasts(deps: NightForecastDeps, now: Date): Promise<number> {
  let written = 0;
  for (const site of await deps.sites()) {
    try {
      const entry = await deps.latest(site.latitudeDeg, site.longitudeDeg);
      if (!entry) continue;
      const input = comingNightForecast(site, entry, now);
      if (!input) continue;
      if ((await deps.record(input, now)) === 'written') written += 1;
    } catch (error) {
      logger.warn('night_forecast_failed', {
        siteId: site.siteId,
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    }
  }
  return written;
}
