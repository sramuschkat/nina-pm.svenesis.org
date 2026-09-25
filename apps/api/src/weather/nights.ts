/**
 * Nächte der Wetter-Stundenreihe (night.md §1–§3): Mittag bis Mittag nach der Zeitzonentabelle des Servers,
 * astronomische Dunkelheit aus den exakten −18°-Durchgänge der Engine (Polartag → keine, Polarnacht → die
 * ganze Nacht) und das Nachtfenster für die Anzeige.
 */
import {
  daysFromKey,
  EngineInputError,
  keyFromDays,
  nightTimes,
  type DarkWindow,
  type TimeZoneTransition,
} from '@nina-pm/engine';
import { noonNightKey, timeZoneTransitions } from '../lib/night-table';

export interface WeatherSiteGeo {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly timeZone: string;
}

export interface WeatherNightFrame {
  readonly night: string;
  readonly noonStartUtc: number;
  readonly noonEndUtc: number;
  readonly nightWindow: { readonly startUtc: number; readonly endUtc: number };
  /** `null` = Polartag (keine astronomische Dunkelheit). */
  readonly dark: DarkWindow | null;
}

const DAY_MS = 86_400_000;

export interface WeatherNightTable {
  readonly transitions: TimeZoneTransition[];
  readonly nights: WeatherNightFrame[];
}

/** Nächte ab der Mittagsnacht von `now`, bis die Nacht `untilUnix` enthält (höchstens 12). */
export function weatherNightTable(
  site: WeatherSiteGeo,
  now: Date,
  untilUnix: number,
): WeatherNightTable {
  const first = noonNightKey(site.timeZone, now.getTime());
  const startMs = now.getTime() - 3 * DAY_MS;
  const endMs = Math.max(untilUnix * 1000, now.getTime()) + 3 * DAY_MS;
  const transitions = timeZoneTransitions(site.timeZone, startMs, endMs);
  const geo = { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg };
  const nights: WeatherNightFrame[] = [];
  for (let i = 0; i < 12; i += 1) {
    const night = keyFromDays(daysFromKey(first) + i);
    let t;
    try {
      t = nightTimes({ site: geo, night, timeZoneTransitions: transitions });
    } catch (error) {
      if (error instanceof EngineInputError) continue; // Datumsgrenze (AST-N16): keine Nacht
      throw error;
    }
    const astro = t.twilight.astronomical;
    const dark =
      astro.kind === 'polarDay'
        ? null
        : astro.kind === 'polarNight'
          ? { night, fromUtc: t.noonStartUtc, toUtc: t.noonEndUtc }
          : {
              night,
              fromUtc: astro.startUtc ?? t.noonStartUtc,
              toUtc: astro.endUtc ?? t.noonEndUtc,
            };
    nights.push({
      night,
      noonStartUtc: t.noonStartUtc,
      noonEndUtc: t.noonEndUtc,
      nightWindow: { startUtc: t.nightWindow.startUtc, endUtc: t.nightWindow.endUtc },
      dark,
    });
    if (t.noonEndUtc > untilUnix) break;
  }
  return { transitions, nights };
}
