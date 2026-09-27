/**
 * Die großen Meteorströme einer Nacht („Ereignisse der Nacht“): Aktivität und Maximum als Sonnenlängen
 * (J2000) nach dem Kalender der International Meteor Organization (Daten für 2026 aus der englischen
 * Wikipedia-Liste), Radiant zum Maximum (J2000, Drift ohne), Höhe des Radianten in der Dunkelheit und eine
 * grobe erwartete Rate am Standort. Portiert aus `legacy/astro-tools-2026-09-21/js/sky-events.js`
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
    const pc = precessFromJ2000(sh.raDeg, sh.decDeg, jdeFromUnix(mid));
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
  const dl = longitudeDiffDeg(solarLongitudeJ2000Deg(mid), shower.peakLonDeg);
  const edge = Math.max(
    dl < 0
      ? longitudeDiffDeg(shower.peakLonDeg, shower.startLonDeg)
      : longitudeDiffDeg(shower.endLonDeg, shower.peakLonDeg),
    0.1,
  );
  const zhr = shower.zhr * pow(10, -log10(shower.zhr / 1.5) * Math.min(1, Math.abs(dl) / edge));
  const pc = precessFromJ2000(shower.raDeg, shower.decDeg, jdeFromUnix(mid));
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
