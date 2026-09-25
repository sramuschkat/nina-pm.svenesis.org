/**
 * Nachtmittel und bestes Fenster (specs/engine/weather.md §3.2/§3.3, WS-09/WS-10) sowie `weatherScores`
 * (TK 8.2): mehrere Nächte in einem Aufruf, Dunkelheit aus `darkWindows` (exakte −18°-Durchgänge,
 * night.md §2 – hier nicht gerechnet). Bewusste Abweichungen der Anzeigeauswertung gegenüber
 * legacy/…/astro-weather.js `nightItems()`: `moonFreeSec` nur für das gemeldete Fenster, Rückfall auf
 * 0,45 auch bei einem zu kurzen 0,65-Fenster; Mondhöhe geometrisch mit Schwelle −0,833° wie die Vorlage.
 */
import { isoFromUnix } from '../plan/iso';
import { q } from '../round';
import {
  cloudScore,
  jetKmh,
  overallScore,
  ratingIndex,
  seeingIncomplete,
  seeingScore,
  shearKmh,
  transparencyScore,
} from './score';
import type {
  BestWindow,
  DarkWindow,
  WeatherHourly,
  WeatherNight,
  WeatherScoredHour,
  WeatherScoreInput,
  WeatherScores,
} from './types';

/** Mindestdauer eines Fensters (WS-10): eine halbe Stunde trägt keine Aufnahmeserie. */
export const MIN_WINDOW_SEC = 1800;
/** Schwellen des besten Fensters: Klassengrenze *Gut*, Rückfall *Mittel* (§3.1). */
export const WINDOW_GOOD = 0.65;
export const WINDOW_FAIR = 0.45;
/** Mondhöhe „unten“ für `moonFreeSec` – Zahlenwert der Vorlage (WS-E1), **nie** für die Planung. */
export const MOON_FREE_BELOW_DEG = -0.833;

const HOUR = 3600;

/** Überlappung des Stundenintervalls `[t, t + 1 h)` mit der Dunkelheit, Sekunden (kann ≤ 0 sein). */
const overlap = (tUnix: number, dark: DarkWindow) =>
  Math.min(tUnix + HOUR, dark.toUtc) - Math.max(tUnix, dark.fromUtc);

type ScoreHour = Pick<WeatherScoredHour, 'tUnix' | 'overallScore'> & {
  readonly moonAltDeg?: number | null;
};

export interface NightMean {
  readonly nightMean: number | null;
  readonly coveredSec: number;
  readonly darknessSec: number;
  readonly coverage: number | null;
}

/** WS-09: über die Dunkelheit gewichtetes Mittel; `dark == null` ist der Polartag. */
export function nightMean(hours: readonly ScoreHour[], dark: DarkWindow | null): NightMean {
  if (dark === null) return { nightMean: null, coveredSec: 0, darknessSec: 0, coverage: null };
  let sum = 0;
  let coveredSec = 0;
  for (const h of hours) {
    const part = overlap(h.tUnix, dark);
    if (part > 0 && h.overallScore !== null) {
      sum += part * h.overallScore;
      coveredSec += part;
    }
  }
  const darknessSec = dark.toUtc - dark.fromUtc;
  return {
    nightMean: coveredSec > 0 ? sum / coveredSec : null,
    coveredSec,
    darknessSec,
    coverage: darknessSec > 0 ? coveredSec / darknessSec : null,
  };
}

interface Run {
  fromUnix: number;
  toUnix: number;
  sec: number;
  sum: number;
  moonFreeSec: number;
}

/** Längster zusammenhängender Lauf mit `overallScore ≥ thr` innerhalb der Dunkelheit. */
function run(hours: readonly ScoreHour[], dark: DarkWindow, thr: number): Run | null {
  let win: Run | null = null;
  let cur: Run | null = null;
  for (const h of hours) {
    const part = overlap(h.tUnix, dark);
    if (!(part > 0) || h.overallScore === null || h.overallScore < thr) {
      cur = null; // eine Lücke bricht den Lauf
      continue;
    }
    cur ??= {
      fromUnix: Math.max(h.tUnix, dark.fromUtc),
      toUnix: 0,
      sec: 0,
      sum: 0,
      moonFreeSec: 0,
    };
    cur.toUnix = Math.min(h.tUnix + HOUR, dark.toUtc);
    cur.sec += part;
    cur.sum += part * h.overallScore;
    if (h.moonAltDeg !== undefined && h.moonAltDeg !== null && h.moonAltDeg < MOON_FREE_BELOW_DEG)
      cur.moonFreeSec += part;
    if (win === null || cur.sec > win.sec) win = cur;
  }
  return win;
}

/** WS-10: bestes Fenster ≥ 0,65, Rückfall ≥ 0,45 (auch bei zu kurzem 0,65-Fenster), mindestens 1800 s. */
export function bestWindow(
  hours: readonly ScoreHour[],
  dark: DarkWindow | null,
): BestWindow | null {
  if (dark === null) return null;
  const sorted = [...hours].sort((a, b) => a.tUnix - b.tUnix);
  let w = run(sorted, dark, WINDOW_GOOD);
  let fair = false;
  if (w === null || w.sec < MIN_WINDOW_SEC) {
    const w2 = run(sorted, dark, WINDOW_FAIR);
    if (w2 !== null && w2.sec >= MIN_WINDOW_SEC) {
      w = w2;
      fair = true;
    } else w = null;
  }
  if (w === null) return null;
  return {
    fromUtc: isoFromUnix(w.fromUnix),
    toUtc: isoFromUnix(w.toUnix),
    sec: w.sec,
    moonFreeSec: w.moonFreeSec,
    meanScore: w.sum / w.sec,
    fair,
  };
}

/** Teilbewertungen und Kennzeichen einer Stunde (§2, WS-04a, WS-E2); ungerundet. */
export function scoreHour<H extends WeatherHourly>(h: H): H & WeatherScoredHour {
  const jet = jetKmh(h.wind250Kmh, h.wind500Kmh);
  const shear = shearKmh(h);
  const cloud = cloudScore(h.cloudTotalPct);
  const seeing = seeingScore({ jetKmh: jet, shearKmh: shear, wind10Kmh: h.wind10Kmh });
  const transparency = transparencyScore(h.aod, h.humidityPct, h.pwvMm);
  const overall = overallScore(cloud, seeing, transparency);
  return {
    ...h,
    jetKmh: jet,
    shearKmh: shear,
    aerosolMissing: h.aod === null,
    seeingIncomplete: seeingIncomplete({
      jetKmh: jet,
      wind250Kmh: h.wind250Kmh,
      wind500Kmh: h.wind500Kmh,
      shearKmh: shear,
      wind10Kmh: h.wind10Kmh,
    }),
    cloudScore: cloud,
    seeingScore: seeing,
    transparencyScore: transparency,
    overallScore: overall,
    // Verglichen wird der gerundete Score (WS-08): 0,6495 → 0,65 → Klasse 3.
    ratingIndex: ratingIndex(overall === null ? null : q(overall, 1e3)),
  };
}

/**
 * `weatherScores` (TK 8.2, weather.md §3.2): Stunden bewerten und je Eintrag aus `darkWindows` eine Zeile
 * `WeatherNight`. Die Stunden einer Nacht sind die, deren Intervall die Dunkelheit schneidet; die
 * Nacht-Kennzeichen setzt schon **eine** betroffene Stunde der Dunkelheit.
 */
export function weatherScores<H extends WeatherHourly>(
  input: WeatherScoreInput<H>,
): WeatherScores<H & WeatherScoredHour> {
  const hours = [...input.hourly].sort((a, b) => a.tUnix - b.tUnix).map((h) => scoreHour(h));
  const nights: WeatherNight[] = input.darkWindows.map((dark) => {
    const inDark = hours.filter((h) => overlap(h.tUnix, dark) > 0);
    return {
      night: dark.night,
      ...nightMean(hours, dark),
      bestWindow: bestWindow(hours, dark),
      aerosolMissing: inDark.some((h) => h.aerosolMissing),
      seeingIncomplete: inDark.some((h) => h.seeingIncomplete),
    };
  });
  return { hours, nights };
}
