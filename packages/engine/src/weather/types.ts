/**
 * Wetter-Verträge der Engine (TK 8.2, specs/engine/weather.md §1.1/§3.2/§3.4, WS-11). Alle Zahlen sind
 * `number | null`; `null` heißt „keine Aussage“ und wird nie durch 0 oder einen Mittelwert ersetzt
 * (Ausnahme `jetKmh`, §2.2).
 */

/** Modell je Stunde (`enums.json` → `weatherModels`, §1.5). */
export type WeatherModelId = 'd2' | 'eu' | 'global' | 'dini' | 'hrrr' | 'gem' | 'gfs';
/** Feines Modell, das nach dem Nest die Wolkenzeilen trägt (`enums.json` → `cloudSources`). */
export type CloudSource = 'dini' | 'gem';

/** Eine Stunde nach der Aufbereitung (§1.1–§1.6): Rohwerte, Mondhöhe und Herkunft. */
export interface WeatherHourly {
  /** Stundenanfang, Unix-Sekunden (UTC). */
  readonly tUnix: number;
  readonly cloudTotalPct: number | null;
  readonly cloudLowPct: number | null;
  readonly cloudMidPct: number | null;
  readonly cloudHighPct: number | null;
  readonly tempC: number | null;
  readonly dewPointC: number | null;
  readonly humidityPct: number | null;
  readonly wind10Kmh: number | null;
  /** Intervallwert (Stempel `t + 1 h`, §1.2). */
  readonly gust10Kmh: number | null;
  readonly windDir10Deg: number | null;
  readonly wind250Kmh: number | null;
  readonly windDir250Deg: number | null;
  readonly wind500Kmh: number | null;
  readonly windDir500Deg: number | null;
  readonly wind700Kmh: number | null;
  readonly windDir700Deg: number | null;
  readonly wind850Kmh: number | null;
  readonly windDir850Deg: number | null;
  readonly surfacePressureHPa: number | null;
  readonly visibilityM: number | null;
  /** Intervallwert, ohne Wirkung auf die Bewertung (WS-E1). */
  readonly precipMm: number | null;
  /** Intervallwert, ohne Wirkung auf die Bewertung (WS-E1). */
  readonly precipProbPct: number | null;
  readonly weatherCode: number | null;
  /** CAMS, dimensionslos (550 nm); fehlt ab Tag 5 (WS-E2). */
  readonly aod: number | null;
  readonly dustUgM3: number | null;
  readonly pwvMm: number | null;
  /**
   * Geometrische topozentrische Mondhöhe zum Stundenmittelpunkt `tUnix + 1800` (§3.3) – nur Grundlage von
   * `moonFreeSec`, **nie** die Planungs-Mondhöhe aus moon.md.
   */
  readonly moonAltDeg: number | null;
  readonly modelId: WeatherModelId;
  readonly cloudSrc: CloudSource | null;
  readonly nest: boolean;
}

/** Eine bewertete Stunde (§3.4 `payload.hours[]`); Scores ungerundet. */
export interface WeatherScoredHour extends WeatherHourly {
  readonly jetKmh: number | null;
  readonly shearKmh: number | null;
  readonly aerosolMissing: boolean;
  readonly seeingIncomplete: boolean;
  readonly cloudScore: number | null;
  readonly seeingScore: number | null;
  readonly transparencyScore: number | null;
  readonly overallScore: number | null;
  readonly ratingIndex: 0 | 1 | 2 | 3 | 4 | null;
}

/** Astronomische Dunkelheit einer Nacht (exakte −18°-Durchgänge, night.md §2), Unix-Sekunden. */
export interface DarkWindow {
  readonly night: string;
  readonly fromUtc: number;
  readonly toUtc: number;
}

export interface WeatherScoreInput<H extends WeatherHourly = WeatherHourly> {
  /** Durchgehende Stundenreihe des Abrufs (zusätzliche Anzeigefelder werden durchgereicht). */
  readonly hourly: readonly H[];
  /** Je Nacht mit Dunkelheit ein Fenster; Polartag-Nächte fehlen. */
  readonly darkWindows: readonly DarkWindow[];
}

/** Bestes Fenster (§3.3, WS-10). */
export interface BestWindow {
  readonly fromUtc: string;
  readonly toUtc: string;
  readonly sec: number;
  readonly moonFreeSec: number;
  readonly meanScore: number;
  /** Nur die Stufe ≥ 0,45 erreicht („bestenfalls mittel“). */
  readonly fair: boolean;
}

/** Zeile je Nacht (§3.4 `payload.nights[]`). */
export interface WeatherNight {
  readonly night: string;
  readonly nightMean: number | null;
  readonly coveredSec: number;
  readonly darknessSec: number;
  readonly coverage: number | null;
  readonly bestWindow: BestWindow | null;
  readonly aerosolMissing: boolean;
  readonly seeingIncomplete: boolean;
}

export interface WeatherScores<S extends WeatherScoredHour = WeatherScoredHour> {
  readonly hours: S[];
  readonly nights: WeatherNight[];
}
