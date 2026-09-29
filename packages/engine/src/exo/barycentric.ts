/**
 * BJD_TDB ↔ JD_UTC (transit.md §1 „Umrechnung BJD_TDB → JD_UTC am Standort“, AST-T1/T6/T15; AP-41).
 * `BJD_TDB = JD_TDB + Δ_Rømer`, `Δ_Rømer = (r⃗_Erde,bary · n̂)/c` mit der Richtung `n̂` aus ICRS/J2000 – im selben
 * Rahmen wie die Erdposition, **nicht** der auf das Datum präzessierte Ort (AST-T6).
 * Erdposition: Kepler-Bahn des Erde-Mond-Schwerpunkts (JPL Tabelle 1, `sky/planets.ts`) plus Sonnenversatz durch
 * Jupiter bis Neptun (`epoch.ts`). Ohne topozentrischen Term (≤ 21 ms) und ohne EMB → Erdmittelpunkt (≤ 16 ms).
 * Gegen astropy `light_travel_time(kind='barycentric')` geprüft (`tools/reference/gen_transits.py`).
 */
import { J2000 } from '../astro/time';
import { EQ_TO_ECLIPTIC } from '../sky/frames';
import { heliocentricEarthAu } from '../sky/planets';
import { matVec, transpose, type Vec3 } from '../sky/vec';
import { sunBarycentricAu, tdbMinusTtS, tdbMinusUtc, unitVector } from './epoch';
import { taiMinusUtc, TT_MINUS_TAI_S } from './leap-seconds';

const AU_LIGHT_S = 499.004783836;
const DAY_S = 86400;

/** Ort des Erde-Mond-Schwerpunkts relativ zum Baryzentrum, äquatorial J2000 (≈ ICRS) in AE, zu `jdTdb`. */
export function earthBarycentricAu(jdTdb: number): Vec3 {
  const helio = matVec(transpose(EQ_TO_ECLIPTIC), heliocentricEarthAu((jdTdb - J2000) / 36525));
  const sun = sunBarycentricAu(jdTdb);
  return [helio[0] + sun[0], helio[1] + sun[1], helio[2] + sun[2]];
}

/** Rømer-Verzögerung `(r⃗_Erde,bary · n̂)/c` in Sekunden: positiv, wenn die Erde auf der Zielseite steht. */
export function romerDelayS(jdTdb: number, raDeg: number, decDeg: number): number {
  const e = earthBarycentricAu(jdTdb);
  const n = unitVector(raDeg, decDeg);
  return (e[0] * n[0] + e[1] * n[1] + e[2] * n[2]) * AU_LIGHT_S;
}

export interface JdUtc {
  readonly jdUtc: number;
  /** Zeitpunkt hinter dem Ende der Schaltsekunden-Tabelle (Diagnose `leap_table_expired`, Fehler ≤ 1 s). */
  readonly leapTableExpired: boolean;
}

/** JD_UTC einer Beobachtung → BJD_TDB (für Aufnahmezeiten, FA-EXO-29, und die Nachtmitte in §2). */
export function jdUtcToBjdTdb(jdUtc: number, raDeg: number, decDeg: number): number {
  const jdTdb = jdUtc + tdbMinusUtc(jdUtc).seconds / DAY_S;
  return jdTdb + romerDelayS(jdTdb, raDeg, decDeg) / DAY_S;
}

/**
 * BJD_TDB → JD_UTC am Beobachter: `JD_TDB = BJD_TDB − Δ_Rømer(JD_TDB)` mit zwei Iterationen (die Zielrichtung ist
 * fest, nur die Erdposition wird nachgeführt; Rest ≤ 10 µs), dann TDB → TT → TAI → UTC.
 */
export function bjdTdbToJdUtc(bjdTdb: number, raDeg: number, decDeg: number): JdUtc {
  let jdTdb = bjdTdb;
  for (let k = 0; k < 2; k += 1) jdTdb = bjdTdb - romerDelayS(jdTdb, raDeg, decDeg) / DAY_S;
  const jdTai = jdTdb - (tdbMinusTtS(jdTdb) + TT_MINUS_TAI_S) / DAY_S;
  // TAI − UTC zum UTC-Datum: erst mit dem TAI-Datum nachschlagen, dann einmal am Ergebnis prüfen (Sprungtag).
  let leap = taiMinusUtc(jdTai);
  let jdUtc = jdTai - leap.seconds / DAY_S;
  const again = taiMinusUtc(jdUtc);
  if (again.seconds !== leap.seconds) {
    leap = again;
    jdUtc = jdTai - leap.seconds / DAY_S;
  }
  return { jdUtc, leapTableExpired: leap.expired };
}
