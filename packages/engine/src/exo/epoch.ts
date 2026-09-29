/**
 * Katalog-Epochen → BJD_TDB (transit.md §1, AST-T2/T3/T7; AP-40). Das Quellsystem bestimmt der Import je Quelle,
 * hier wird **nicht** nach der Größe geraten – mit einer Ausnahme, die die Quelle selbst festlegt: BTJD/BKJD
 * tragen einen festen Offset.
 *
 * - `bjd_tdb` → unverändert.
 * - `bjd_utc` → `+ (TT−TAI + TAI−UTC(T0) + TDB−TT)/86400`.
 * - `hjd_utc` → zusätzlich Heliozentrum → Baryzentrum: `+ (r⃗_Sonne,bary · n̂)/c` (0,15 … 4,6 s).
 * - `btjd` → `+ 2 457 000`, `bkjd` → `+ 2 454 833`, danach BJD_TDB.
 * - `jd_utc` und `unknown` → Epoche unverändert, Zeitsystem `unknown` (Fensterpuffer + 10 min in AP-41). Eine
 *   volle Rømer-Korrektur für JD_UTC (bis ±8,5 min) liefert kein Katalog verlässlich: NASA `pl_tranmid_systemref
 *   = 'JD'` liegt gegen ExoClock im Median bei +0,05 min, ist also in Wahrheit BJD (Spec-Ergänzung 29.09.2026).
 *
 * Der Sonnenversatz nutzt Kepler-Bahnen von Jupiter, Saturn, Uranus und Neptun (`sky/planets.ts`, JPL Tabelle 1);
 * vernachlässigt sind die inneren Planeten (≤ 3 ms). Die Zielrichtung `n̂` kommt aus ICRS/J2000-Koordinaten,
 * im selben Rahmen wie der Sonnenvektor (AST-T6).
 */
import { cos, sin } from '../math';
import { RAD } from '../astro/angles';
import { J2000 } from '../astro/time';
import { EQ_TO_ECLIPTIC } from '../sky/frames';
import { heliocentricAu, type PlanetId } from '../sky/planets';
import { matVec, transpose, type Vec3 } from '../sky/vec';
import { taiMinusUtc, TT_MINUS_TAI_S } from './leap-seconds';

export const EXO_TIME_SYSTEMS = [
  'bjd_tdb',
  'bjd_utc',
  'hjd_utc',
  'jd_utc',
  'btjd',
  'bkjd',
  'unknown',
] as const;
export type ExoTimeSystem = (typeof EXO_TIME_SYSTEMS)[number];

/** Plausibilitätsgrenzen nach dem Offset (transit.md §1): außerhalb → `422 exo.epoch_out_of_range`. */
export const EPOCH_MIN_JD = 2_400_000;
export const EPOCH_MAX_JD = 2_500_000;
export const BTJD_OFFSET = 2_457_000;
export const BKJD_OFFSET = 2_454_833;
/** Fensterpuffer je Seite bei unsicherem Zeitsystem (transit.md §1/§2). */
export const UNKNOWN_TIME_SYSTEM_BUFFER_MIN = 10;

/** Lichtlaufzeit für 1 AE in Sekunden (IAU 2012: 149 597 870 700 m / c). */
const AU_LIGHT_S = 499.004783836;

/** Massenverhältnis Sonne / Planet (inkl. Monde), IAU 2009/2015. */
const GIANTS: readonly (readonly [PlanetId, number])[] = [
  ['jupiter', 1047.348644],
  ['saturn', 3497.9018],
  ['uranus', 22902.98],
  ['neptune', 19412.26],
];

/**
 * Ort der Sonne relativ zum Baryzentrum des Sonnensystems, äquatorial J2000 (≈ ICRS) in AE, zu `jdTdb`.
 * `r⃗_Sonne,bary = −Σ mᵢ·r⃗ᵢ / (M☉ + Σ mᵢ)` mit den heliozentrischen Orten der vier Riesenplaneten.
 */
export function sunBarycentricAu(jdTdb: number): Vec3 {
  const t = (jdTdb - J2000) / 36525;
  let x = 0;
  let y = 0;
  let z = 0;
  let mass = 1;
  for (const [id, ratio] of GIANTS) {
    const r = heliocentricAu(id, t);
    const f = 1 / ratio;
    x += f * r[0];
    y += f * r[1];
    z += f * r[2];
    mass += f;
  }
  return matVec(transpose(EQ_TO_ECLIPTIC), [-x / mass, -y / mass, -z / mass]);
}

/** Einheitsvektor zur Richtung (RA, Dec) in Grad, äquatorial. */
export function unitVector(raDeg: number, decDeg: number): Vec3 {
  const ra = RAD * raDeg;
  const dec = RAD * decDeg;
  return [cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec)];
}

/** `BJD − HJD` in Sekunden: `(r⃗_Sonne,bary · n̂)/c` zur Zeit `jdTdb` für ein Ziel bei (RA, Dec) ICRS. */
export function sunBarycentricDelayS(jdTdb: number, raDeg: number, decDeg: number): number {
  const s = sunBarycentricAu(jdTdb);
  const n = unitVector(raDeg, decDeg);
  return (s[0] * n[0] + s[1] * n[1] + s[2] * n[2]) * AU_LIGHT_S;
}

/** TDB − TT in Sekunden (Näherung, Amplitude 1,657 ms; transit.md §1 Schritt 2). */
export function tdbMinusTtS(jd: number): number {
  const g = RAD * (357.53 + 0.98560028 * (jd - J2000));
  return 0.001657 * sin(g);
}

export interface UtcToTdb {
  /** TDB − UTC in Sekunden zur Zeit `jdUtc`. */
  readonly seconds: number;
  readonly leapTableExpired: boolean;
}

/** TDB − UTC = (TT − TAI) + (TAI − UTC zum Datum) + (TDB − TT). */
export function tdbMinusUtc(jdUtc: number): UtcToTdb {
  const leap = taiMinusUtc(jdUtc);
  return {
    seconds: TT_MINUS_TAI_S + leap.seconds + tdbMinusTtS(jdUtc),
    leapTableExpired: leap.expired,
  };
}

export type NormalizedEpoch =
  | {
      readonly ok: true;
      readonly t0BjdTdb: number;
      /** Quellsystem nach der Zuordnung; `jd_utc` wird zu `unknown` (s. o.). */
      readonly system: ExoTimeSystem;
      readonly leapTableExpired: boolean;
    }
  | { readonly ok: false; readonly code: 'exo.epoch_out_of_range'; readonly value: number };

/**
 * Epoche `value` im Quellsystem `system` nach BJD_TDB. Die Koordinaten (ICRS, Grad) braucht nur `hjd_utc`.
 * Plausibilität nach dem Offset: `2 400 000 < T0 < 2 500 000`, sonst `exo.epoch_out_of_range`.
 */
export function normalizeEpoch(
  value: number,
  system: ExoTimeSystem,
  raDeg: number,
  decDeg: number,
): NormalizedEpoch {
  const offset = system === 'btjd' ? BTJD_OFFSET : system === 'bkjd' ? BKJD_OFFSET : 0;
  const jd = value + offset;
  if (!Number.isFinite(jd) || !(jd > EPOCH_MIN_JD && jd < EPOCH_MAX_JD))
    return { ok: false, code: 'exo.epoch_out_of_range', value };
  switch (system) {
    case 'bjd_utc': {
      const d = tdbMinusUtc(jd);
      return {
        ok: true,
        t0BjdTdb: jd + d.seconds / 86400,
        system,
        leapTableExpired: d.leapTableExpired,
      };
    }
    case 'hjd_utc': {
      const d = tdbMinusUtc(jd);
      const hjdTdb = jd + d.seconds / 86400;
      return {
        ok: true,
        t0BjdTdb: hjdTdb + sunBarycentricDelayS(hjdTdb, raDeg, decDeg) / 86400,
        system,
        leapTableExpired: d.leapTableExpired,
      };
    }
    case 'jd_utc':
    case 'unknown':
      return { ok: true, t0BjdTdb: jd, system: 'unknown', leapTableExpired: false };
    default:
      return { ok: true, t0BjdTdb: jd, system, leapTableExpired: false };
  }
}
