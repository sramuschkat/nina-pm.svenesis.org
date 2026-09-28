/**
 * Die großen Meteorströme einer Nacht („Ereignisse der Nacht“): Aktivität und Maximum als Sonnenlängen
 * (J2000) nach dem Kalender der International Meteor Organization (Daten für 2026 aus der englischen
 * Wikipedia-Liste), Radiant zum Maximum (J2000) mit der täglichen Drift aus Tabelle 6 des IMO-Kalenders 2026
 * (seit der Astronomie-Prüfung 28.09.2026; vorher ohne Drift – bei langen Strömen fern vom Maximum lag die
 * „beste Zeit“ um Stunden daneben), Höhe des Radianten in der Dunkelheit und eine grobe erwartete Rate am
 * Standort. Portiert aus `legacy/astro-tools-2026-09-21/js/sky-events.js`
 * (`SHOWERS`, `showersTonight`, `meteorRate`). Nur Anzeige.
 */
import { log10, pow, sin } from '../../math';
import { norm180, RAD } from '../../astro/angles';
import { altAz, localApparentSiderealDeg, type Site } from '../../astro/horizon';
import { precessFromJ2000 } from '../../astro/precession';
import { jdeFromUnix } from '../../astro/time';
import { longitudeDiffDeg, solarLongitudeJ2000Deg, type EventSample } from './common';

export type MeteorShowerKey =
  | 'QUA'
  | 'LYR'
  | 'ETA'
  | 'SDA'
  | 'CAP'
  | 'PER'
  | 'DRA'
  | 'ORI'
  | 'STA'
  | 'NTA'
  | 'LEO'
  | 'PUP'
  | 'GEM'
  | 'URS'
  | 'ACE';

export interface MeteorShower {
  /** IMO-Kürzel, Schlüssel für die Übersetzung. */
  readonly key: MeteorShowerKey;
  /** Namen aus der Vorlage (EN/DE). */
  readonly nameEn: string;
  readonly nameDe: string;
  /** Beginn, Maximum und Ende der Aktivität als Sonnenlänge J2000, Grad. */
  readonly startLonDeg: number;
  readonly peakLonDeg: number;
  readonly endLonDeg: number;
  /** Radiant zum Maximum, J2000, Grad. */
  readonly raDeg: number;
  readonly decDeg: number;
  /** Eintrittsgeschwindigkeit, km/s. */
  readonly speedKmS: number;
  /** Zenitale stündliche Rate am Maximum. */
  readonly zhr: number;
  /** Populationsindex r. */
  readonly popIndex: number;
}

const S = (
  key: MeteorShowerKey,
  nameEn: string,
  nameDe: string,
  startLonDeg: number,
  peakLonDeg: number,
  endLonDeg: number,
  raDeg: number,
  decDeg: number,
  speedKmS: number,
  zhr: number,
  popIndex: number,
): MeteorShower => ({
  key,
  nameEn,
  nameDe,
  startLonDeg,
  peakLonDeg,
  endLonDeg,
  raDeg,
  decDeg,
  speedKmS,
  zhr,
  popIndex,
});

/** Die 15 großen Ströme in der Reihenfolge der Vorlage. */
export const METEOR_SHOWERS: readonly MeteorShower[] = [
  S('QUA', 'Quadrantids', 'Quadrantiden', 276.5, 283.15, 291.8, 229.5, 49, 41, 80, 2.1),
  S('LYR', 'Lyrids', 'Lyriden', 24.1, 32.32, 39.7, 271.5, 34, 49, 18, 2.1),
  S('ETA', 'Eta Aquariids', 'Eta-Aquariiden', 29, 45.5, 66.7, 337.5, -1, 66, 50, 2.4),
  S(
    'SDA',
    'Southern Delta Aquariids',
    'Südliche Delta-Aquariiden',
    109.7,
    128,
    149.9,
    340.5,
    -16,
    41,
    25,
    2.5,
  ),
  S('CAP', 'Alpha Capricornids', 'Alpha-Capricorniden', 101.1, 128, 142.2, 307.5, -10, 23, 5, 2.5),
  S('PER', 'Perseids', 'Perseiden', 114.5, 140, 150.9, 48, 58, 59, 100, 2.2),
  S('DRA', 'October Draconids', 'Oktober-Draconiden', 192.8, 195.4, 196.7, 262.5, 54, 20, 5, 2.6),
  S('ORI', 'Orionids', 'Orioniden', 188.8, 208, 224.6, 94.5, 16, 66, 20, 2.5),
  S('STA', 'Southern Taurids', 'Südliche Tauriden', 177.1, 223, 237.7, 52.5, 15, 27, 7, 2.3),
  S('NTA', 'Northern Taurids', 'Nördliche Tauriden', 206.6, 230, 257.9, 58.5, 22, 29, 5, 2.3),
  S('LEO', 'Leonids', 'Leoniden', 223.6, 235.27, 247.8, 151.5, 22, 71, 15, 2.5),
  S('PUP', 'Puppid-Velids', 'Puppid-Veliden', 248.8, 255, 263, 123, -45, 44, 10, 2.9),
  S('GEM', 'Geminids', 'Geminiden', 251.8, 262.2, 268.1, 112.5, 33, 35, 150, 2.6),
  S('URS', 'Ursids', 'Ursiden', 265, 270.7, 274.2, 217.5, 76, 33, 10, 3.0),
  S('ACE', 'Alpha Centaurids', 'Alpha-Centauriden', 311.1, 319.4, 331.4, 211.5, -58, 58, 6, 2.0),
];

/**
 * Radiantenpositionen im Lauf der Aktivität: IMO Meteor Shower Calendar 2026 (IMO INFO(3-25)), Tabelle 6
 * „Radiant positions during the year“ (J2000, alle 5 Tage), Daten 0 h UT in Sonnenlänge J2000 umgerechnet:
 * `[λ☉, α, δ]`. Die Oktober-Draconiden haben dort nur einen Punkt (keine Drift).
 */
const DRIFT: Partial<Record<MeteorShowerKey, readonly (readonly [number, number, number])[]>> = {
  QUA: [
    [278.17, 226, 50],
    [279.19, 228, 50],
    [284.28, 231, 49],
    [289.38, 234, 48],
  ],
  LYR: [
    [24.68, 263, 34],
    [29.57, 269, 34],
    [34.45, 274, 34],
    [39.31, 279, 34],
  ],
  ETA: [
    [29.57, 323, -7],
    [34.45, 328, -5],
    [39.31, 332, -3],
    [44.16, 337, -1],
    [49.0, 341, 1],
    [53.83, 345, 3],
    [58.65, 349, 5],
    [63.46, 353, 7],
  ],
  SDA: [
    [107.42, 325, -19],
    [112.19, 329, -19],
    [116.96, 333, -18],
    [121.73, 337, -17],
    [126.51, 340, -16],
    [132.25, 345, -14],
    [137.04, 349, -13],
    [141.84, 352, -12],
    [146.64, 356, -11],
  ],
  CAP: [
    [102.65, 285, -16],
    [107.42, 289, -15],
    [112.19, 294, -14],
    [116.96, 299, -12],
    [121.73, 303, -11],
    [126.51, 307, -10],
    [132.25, 313, -8],
    [137.04, 318, -6],
  ],
  PER: [
    [112.19, 6, 50],
    [116.96, 11, 52],
    [121.73, 22, 53],
    [126.51, 29, 54],
    [132.25, 37, 56],
    [137.04, 45, 57],
    [141.84, 51, 58],
    [146.64, 57, 58],
    [151.46, 63, 58],
  ],
  ORI: [
    [191.4, 85, 14],
    [196.33, 88, 15],
    [201.28, 91, 15],
    [206.24, 94, 16],
    [211.22, 98, 16],
    [216.2, 101, 16],
    [222.21, 105, 17],
  ],
  STA: [
    [176.69, 18, 5],
    [181.58, 21, 6],
    [186.48, 25, 7],
    [191.4, 28, 8],
    [196.33, 32, 9],
    [201.28, 36, 11],
    [206.24, 40, 12],
    [211.22, 43, 13],
    [216.2, 47, 14],
    [222.21, 52, 15],
    [227.23, 56, 15],
    [232.25, 60, 16],
    [237.29, 64, 16],
  ],
  NTA: [
    [206.24, 38, 18],
    [211.22, 43, 19],
    [216.2, 47, 20],
    [222.21, 52, 21],
    [227.23, 56, 22],
    [232.25, 61, 23],
    [237.29, 65, 24],
    [242.35, 70, 24],
    [247.41, 74, 24],
  ],
  LEO: [
    [227.23, 147, 24],
    [232.25, 150, 23],
    [237.29, 153, 21],
    [242.35, 156, 20],
    [247.41, 159, 19],
  ],
  PUP: [
    [247.41, 119, -45],
    [252.48, 122, -45],
    [257.55, 125, -45],
    [262.63, 128, -45],
  ],
  GEM: [
    [252.48, 103, 33],
    [257.55, 108, 33],
    [262.63, 113, 33],
    [267.72, 118, 32],
  ],
  URS: [
    [267.72, 217, 76],
    [272.81, 217, 74],
  ],
  ACE: [
    [309.73, 199, -56],
    [315.82, 206, -58],
    [320.89, 213, -59],
    [325.94, 219, -61],
    [330.99, 224, -62],
  ],
};

/** Stückweise lineare Position der Tabelle bei `lam` (außerhalb mit der Steigung des Randstücks). */
function driftAt(pts: readonly (readonly [number, number, number])[], lam: number) {
  const first = pts[0] as readonly [number, number, number];
  const x = longitudeDiffDeg(lam, first[0]);
  let i = 0;
  while (
    i < pts.length - 2 &&
    longitudeDiffDeg((pts[i + 1] as readonly number[])[0] as number, first[0]) < x
  )
    i += 1;
  const a = pts[i] as readonly [number, number, number];
  const b = pts[i + 1] ?? a;
  const xa = longitudeDiffDeg(a[0], first[0]);
  const xb = longitudeDiffDeg(b[0], first[0]);
  const f = xb === xa ? 0 : (x - xa) / (xb - xa);
  return {
    raDeg: a[1] + longitudeDiffDeg(b[1], a[1]) * f,
    decDeg: a[2] + (b[2] - a[2]) * f,
  };
}

/**
 * Radiant (J2000, Grad) bei der Sonnenlänge `lamDeg`: Maximumsposition plus die Drift aus der IMO-Tabelle
 * zwischen Maximum und `lamDeg` – am Maximum genau die Position der Stromliste.
 */
export function radiantAt(shower: MeteorShower, lamDeg: number): { raDeg: number; decDeg: number } {
  const pts = DRIFT[shower.key];
  if (!pts || pts.length < 2) return { raDeg: shower.raDeg, decDeg: shower.decDeg };
  const now = driftAt(pts, lamDeg);
  const peak = driftAt(pts, shower.peakLonDeg);
  const dec = Math.max(-90, Math.min(90, shower.decDeg + now.decDeg - peak.decDeg));
  const ra = shower.raDeg + longitudeDiffDeg(now.raDeg, peak.raDeg);
  return { raDeg: ((ra % 360) + 360) % 360, decDeg: dec };
}

/** Mittlere Bewegung der Sonne in Länge, Grad je Tag (Tage bis zum Maximum). */
const SUN_DEG_PER_DAY = 0.9856;

/** Höhe und Azimut eines mittleren Orts zum Datum (Grad) am Standort. */
function horizontal(raDeg: number, decDeg: number, unixSec: number, site: Site) {
  return altAz(
    norm180(localApparentSiderealDeg(unixSec, site.lonDeg) - raDeg),
    decDeg,
    site.latDeg,
  );
}

/** Die dunklen Proben: Sonne unter −12°, sonst unter −6° (Vorlage). */
function darkRows(samples: readonly EventSample[]): readonly EventSample[] {
  const dark = samples.filter((r) => r.sunAltDeg < -12);
  return dark.length ? dark : samples.filter((r) => r.sunAltDeg < -6);
}

export interface ShowerTonight {
  readonly shower: MeteorShower;
  /** Tage bis zum Maximum (negativ: seit dem Maximum), aus der Sonnenlänge; Anzeige gerundet |d|. */
  readonly daysToPeak: number;
  /** Höchster Stand des Radianten in der Dunkelheit (`null`, wenn es nicht nautisch dunkel wird). */
  readonly best: { readonly t: number; readonly altDeg: number; readonly azDeg: number } | null;
  /** Erste dunkle Probe mit dem Radianten ≥ 30° hoch, Unix-Sekunden; `null` wenn nie. */
  readonly from30Utc: number | null;
}

/**
 * Aktive Ströme der Nacht (Vorlage `showersTonight`) aus den Proben der Nacht: Sonnenlänge zur Mitte der
 * dunklen Proben (Sonne < −12°, sonst < −6°, sonst aller Proben); aktiv, wenn sie zwischen Beginn und Ende
 * liegt. Radiant zum Datum präzediert, Höhe in den dunklen Proben. Sortiert nach |Tage bis Maximum|
 * (Gleichstand: Kürzel).
 */
export function showersTonight(samples: readonly EventSample[], site: Site): ShowerTonight[] {
  const dark = darkRows(samples);
  const ref = dark.length ? dark : samples;
  const midRow = ref[Math.floor(ref.length / 2)];
  if (!midRow) return [];
  const mid = midRow.t;
  const lam = solarLongitudeJ2000Deg(mid);
  const out: ShowerTonight[] = [];
  for (const sh of METEOR_SHOWERS) {
    if (!(longitudeDiffDeg(lam, sh.startLonDeg) >= 0 && longitudeDiffDeg(sh.endLonDeg, lam) >= 0))
      continue;
    const rad = radiantAt(sh, lam);
    const pc = precessFromJ2000(rad.raDeg, rad.decDeg, jdeFromUnix(mid));
    let best: ShowerTonight['best'] = null;
    let from30: number | null = null;
    for (const row of dark) {
      const h = horizontal(pc.raDeg, pc.decDeg, row.t, site);
      if (!best || h.altDeg > best.altDeg) best = { t: row.t, altDeg: h.altDeg, azDeg: h.azDeg };
      if (from30 === null && h.altDeg >= 30) from30 = row.t;
    }
    out.push({
      shower: sh,
      daysToPeak: longitudeDiffDeg(sh.peakLonDeg, lam) / SUN_DEG_PER_DAY,
      best,
      from30Utc: from30,
    });
  }
  return out.sort(
    (a, b) =>
      Math.abs(a.daysToPeak) - Math.abs(b.daysToPeak) ||
      (a.shower.key < b.shower.key ? -1 : a.shower.key > b.shower.key ? 1 : 0),
  );
}

export interface MeteorRate {
  /** Höchste erwartete Rate der Nacht, Meteore je Stunde (0, wenn der Radiant nie über dem Horizont steht). */
  readonly perHour: number;
  /** Zeitpunkt dieser Rate, Unix-Sekunden; `null` bei Rate 0. */
  readonly t: number | null;
  /** Radiantenhöhe dann, Grad; `null` bei Rate 0. */
  readonly altDeg: number | null;
  /** ZHR dieser Nacht (vom Maximum zu den Rändern der Aktivität log-linear bis 1,5 abfallend). */
  readonly zhr: number;
}

/**
 * Grobe stündliche Rate am Standort (Vorlage `meteorRate`): ZHR fällt vom Maximum log-linear auf 1,5 an den
 * Aktivitätsrändern, mal sin(Radiantenhöhe), mal r^(Grenzgröße − Mondverlust − Dämmerungsverlust − 6,5); die
 * höchste solche Rate bei Sonne unter −12°. `limitingMag`: Vorlage 4,5 Stadt, 6,0 Land (Standard), 6,5 dunkel.
 * `null`, wenn es nicht nautisch dunkel wird.
 */
export function meteorRate(
  shower: MeteorShower,
  samples: readonly EventSample[],
  site: Site,
  limitingMag: number,
): MeteorRate | null {
  const rows = samples.filter((r) => r.sunAltDeg < -12);
  const midRow = rows[Math.floor(rows.length / 2)];
  if (!midRow) return null;
  const mid = midRow.t;
  const lam = solarLongitudeJ2000Deg(mid);
  const dl = longitudeDiffDeg(lam, shower.peakLonDeg);
  const edge = Math.max(
    dl < 0
      ? longitudeDiffDeg(shower.peakLonDeg, shower.startLonDeg)
      : longitudeDiffDeg(shower.endLonDeg, shower.peakLonDeg),
    0.1,
  );
  const zhr = shower.zhr * pow(10, -log10(shower.zhr / 1.5) * Math.min(1, Math.abs(dl) / edge));
  const rad = radiantAt(shower, lam);
  const pc = precessFromJ2000(rad.raDeg, rad.decDeg, jdeFromUnix(mid));
  let perHour = 0;
  let t: number | null = null;
  let altDeg: number | null = null;
  for (const row of rows) {
    const h = horizontal(pc.raDeg, pc.decDeg, row.t, site).altDeg;
    if (h <= 0) continue;
    const moonLoss =
      row.moonAltDeg > 0
        ? 2.5 * (row.moonIllumPct / 100) * Math.min(1, 1.5 * sin(row.moonAltDeg * RAD))
        : 0;
    const twiLoss = row.sunAltDeg > -18 ? ((row.sunAltDeg + 18) / 6) * 1.5 : 0;
    const hr = zhr * sin(h * RAD) * pow(shower.popIndex, limitingMag - moonLoss - twiLoss - 6.5);
    if (hr > perHour) {
      perHour = hr;
      t = row.t;
      altDeg = h;
    }
  }
  return { perHour, t, altDeg, zhr };
}
