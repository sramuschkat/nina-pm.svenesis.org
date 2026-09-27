/**
 * Gemeinsame Hilfen der „Ereignisse der Nacht“: Proben der Nacht mit Sonne und Mond (wie die `samples` des
 * Beobachtungsplaners der Vorlage, `renderPlanets`), Bisektion, Goldener Schnitt, Winkelabstand aus Höhe und
 * Azimut und die Sonnenlänge für das Äquinoktium J2000. Portiert aus
 * `legacy/astro-tools-2026-09-21/js/sky-events.js`. Nur Anzeige.
 */
import { asin, cos, sin } from '../../math';
import { norm360, RAD } from '../../astro/angles';
import { moonAt, sunAt } from '../../astro/bodies';
import { type Site } from '../../astro/horizon';
import { sunApparent } from '../../astro/sun';
import { centuries, jdeFromUnix, jdFromUnix } from '../../astro/time';

/** Eine Probe der Nacht: Sonne und Mond am Standort. */
export interface EventSample {
  /** Unix-Sekunden (UTC). */
  readonly t: number;
  /** Geometrische Höhe des Sonnenmittelpunkts, Grad. */
  readonly sunAltDeg: number;
  /** Geometrische topozentrische Höhe des Mondmittelpunkts (ohne Refraktion), Grad. */
  readonly moonAltDeg: number;
  /** Azimut des Mondes von Nord über Ost, Grad. */
  readonly moonAzDeg: number;
  /** Beleuchteter Anteil des Mondes, % (0–100). */
  readonly moonIllumPct: number;
}

/**
 * Proben von `fromUtc` bis `toUtc` (einschließlich) im Abstand `stepSec`. Die Vorlage nimmt 10 min vom
 * vollen Ortsstunde vor Sonnenuntergang − 1 h bis zur vollen Ortsstunde nach Sonnenaufgang + 1 h.
 */
export function eventSamples(
  site: Site,
  fromUtc: number,
  toUtc: number,
  stepSec = 600,
): EventSample[] {
  const rows: EventSample[] = [];
  for (let t = fromUtc; t <= toUtc; t += stepSec) {
    const m = moonAt(t, site);
    rows.push({
      t,
      sunAltDeg: sunAt(t, site).altDeg,
      moonAltDeg: m.altGeometricDeg,
      moonAzDeg: m.azDeg,
      moonIllumPct: m.illumPct,
    });
  }
  return rows;
}

/** Vorzeichenwechsel von `f` zwischen `a` und `b`, `n`-mal halbiert; Mitte des letzten Intervalls. */
export function bisect(f: (x: number) => number, a0: number, b0: number, n: number): number {
  let a = a0;
  let b = b0;
  let fa = f(a);
  for (let i = 0; i < n; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm < 0 === fa < 0) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
}

/** Minimum einer unimodalen Funktion zwischen `a` und `b` auf `tol` genau (Goldener Schnitt). */
export function goldenMin(f: (x: number) => number, a0: number, b0: number, tol: number): number {
  const g = 0.3819660112501051;
  let a = a0;
  let b = b0;
  let c = a + g * (b - a);
  let d = b - g * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tol) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = a + g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = b - g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/** Winkelabstand zweier Punkte aus Höhe und Azimut (Grad), Haversine-Form. */
export function separationAltAzDeg(alt1: number, az1: number, alt2: number, az2: number): number {
  const s1 = sin(((alt2 - alt1) * RAD) / 2);
  const s2 = sin(((az2 - az1) * RAD) / 2);
  const h = s1 * s1 + cos(alt1 * RAD) * cos(alt2 * RAD) * s2 * s2;
  return (2 * asin(Math.min(1, Math.sqrt(h)))) / RAD;
}

/**
 * Sonnenlänge für das Äquinoktium J2000 (Bezug der IMO-Sonnenlängen), Grad in [0, 360): scheinbare Länge
 * zum Datum minus die Präzession seit 2000 (Vorlage `solarLongitude2000`).
 */
export function solarLongitudeJ2000Deg(unixSec: number): number {
  const lam = sunApparent(jdeFromUnix(unixSec)).lambdaDeg;
  return norm360(lam - 1.396971 * centuries(jdFromUnix(unixSec)));
}

/** Differenz zweier Längen in [−180, 180) (Vorlage `lamDiff`). */
export function longitudeDiffDeg(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}
