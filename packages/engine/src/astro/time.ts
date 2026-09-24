/**
 * Zeit (TK 8.4/8.5, night.md): Unix-Sekunden (UTC) ↔ Julianisches Datum, ΔT, Sternzeit.
 * UT1 ≈ UTC (|DUT1| < 0,9 s vernachlässigt); **TT = UT + ΔT** mit ΔT = 69 s für Sonne, Mond,
 * Präzession und Nutation, **nicht** für die Sternzeit (WS-20, AST-G02).
 */
import { norm360 } from './angles';

/** ΔT = TT − UT1 in Sekunden, gültig 2026–2030 (Fehler < 0,2 s, TK 9.1). */
export const DELTA_T_S = 69;

export const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;

/** Julianisches Datum (UT) aus Unix-Sekunden. */
export function jdFromUnix(unixSec: number): number {
  return unixSec / 86400 + UNIX_EPOCH_JD;
}

export function unixFromJd(jd: number): number {
  return (jd - UNIX_EPOCH_JD) * 86400;
}

/** Julianisches Ephemeridendatum (TT) zu einem UT-Zeitpunkt. */
export function jdeFromUnix(unixSec: number): number {
  return jdFromUnix(unixSec + DELTA_T_S);
}

/** Julianische Jahrhunderte seit J2000. */
export function centuries(jd: number): number {
  return (jd - J2000) / 36525;
}

/** Mittlere Sternzeit Greenwich nach IAU 1982 (Meeus 12.4) in Grad, aus UT. */
export function gmstDeg(jdUt: number): number {
  const t = centuries(jdUt);
  return norm360(
    280.46061837 + 360.98564736629 * (jdUt - J2000) + 0.000387933 * t * t - (t * t * t) / 38710000,
  );
}

// ---- Kalender ohne Date (Howard Hinnant, „days_from_civil“) --------------------------------------

/** Tage seit 1970-01-01 für ein proleptisch-gregorianisches Datum. */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Datum zu Tagen seit 1970-01-01. */
export function civilFromDays(days: number): { y: number; m: number; d: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

const pad2 = (n: number) => (n < 10 ? `0${String(n)}` : String(n));

/** Nacht-Schlüssel `YYYY-MM-DD` ↔ Tage seit 1970-01-01. */
export function daysFromKey(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new EngineInputError('validation.failed', `Nacht-Schlüssel ${key}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const days = daysFromCivil(y, mo, d);
  const back = civilFromDays(days);
  if (back.y !== y || back.m !== mo || back.d !== d)
    throw new EngineInputError('validation.failed', `Nacht-Schlüssel ${key}`);
  return days;
}

export function keyFromDays(days: number): string {
  const { y, m, d } = civilFromDays(days);
  return `${String(y)}-${pad2(m)}-${pad2(d)}`;
}

/** Eingabefehler der Engine: `validation.failed` (API 422) bzw. `engine.input_invalid`. */
export class EngineInputError extends Error {
  constructor(
    readonly code: 'validation.failed' | 'engine.input_invalid',
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'EngineInputError';
  }
}
