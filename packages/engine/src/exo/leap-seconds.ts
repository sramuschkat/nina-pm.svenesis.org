/**
 * TAI − UTC zur Epoche (transit.md §1, AST-T7): Stufenfunktion über das **Datum**, nicht über das Jahr.
 * Quelle: IANA `leap-seconds.list` (https://data.iana.org/time-zones/data/leap-seconds.list), gültig bis
 * 2027-06-28. Danach gilt der letzte Wert weiter und das Ergebnis trägt `expired` (Fehler ≤ 1 s,
 * Diagnose `leap_table_expired`). Vor 1972-01-01 gab es keine ganzzahlige Stufe; dort gilt der erste Wert
 * (10 s) – Katalogepochen liegen ohnehin ab 1995.
 */

/** [JD (UTC, 0 h) ab dem der Wert gilt, TAI − UTC in s] – aufsteigend. */
const LEAP_TABLE: readonly (readonly [number, number])[] = [
  [2441317.5, 10], // 1972-01-01
  [2441499.5, 11], // 1972-07-01
  [2441683.5, 12], // 1973-01-01
  [2442048.5, 13], // 1974-01-01
  [2442413.5, 14], // 1975-01-01
  [2442778.5, 15], // 1976-01-01
  [2443144.5, 16], // 1977-01-01
  [2443509.5, 17], // 1978-01-01
  [2443874.5, 18], // 1979-01-01
  [2444239.5, 19], // 1980-01-01
  [2444786.5, 20], // 1981-07-01
  [2445151.5, 21], // 1982-07-01
  [2445516.5, 22], // 1983-07-01
  [2446247.5, 23], // 1985-07-01
  [2447161.5, 24], // 1988-01-01
  [2447892.5, 25], // 1990-01-01
  [2448257.5, 26], // 1991-01-01
  [2448804.5, 27], // 1992-07-01
  [2449169.5, 28], // 1993-07-01
  [2449534.5, 29], // 1994-07-01
  [2450083.5, 30], // 1996-01-01
  [2450630.5, 31], // 1997-07-01
  [2451179.5, 32], // 1999-01-01
  [2453736.5, 33], // 2006-01-01
  [2454832.5, 34], // 2009-01-01
  [2456109.5, 35], // 2012-07-01
  [2457204.5, 36], // 2015-07-01
  [2457754.5, 37], // 2017-01-01
];

/** Ende der Gültigkeit der Tabelle (IANA „expires“): 2027-06-28 0 h UTC. */
export const LEAP_TABLE_VALID_UNTIL_JD = 2461584.5;

/** TT − TAI in Sekunden (fest). */
export const TT_MINUS_TAI_S = 32.184;

export interface TaiMinusUtc {
  readonly seconds: number;
  /** `true`, wenn `jdUtc` nach `LEAP_TABLE_VALID_UNTIL_JD` liegt (Diagnose `leap_table_expired`). */
  readonly expired: boolean;
}

/** TAI − UTC in Sekunden zum Zeitpunkt `jdUtc` (Julianisches Datum, UTC). */
export function taiMinusUtc(jdUtc: number): TaiMinusUtc {
  let seconds = LEAP_TABLE[0]?.[1] ?? 10;
  for (const [from, value] of LEAP_TABLE) {
    if (jdUtc < from) break;
    seconds = value;
  }
  return { seconds, expired: jdUtc > LEAP_TABLE_VALID_UNTIL_JD };
}
