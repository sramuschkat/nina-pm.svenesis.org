/**
 * Überflüge von Raumstationen und Hubble („Ereignisse der Nacht“): Blickwinkel vom Standort, Erdschatten
 * (Zylinder), geschätzte Helligkeit und die sichtbaren Überflüge einer Nacht. Portiert aus
 * `legacy/astro-tools-2026-09-21/js/sky-events.js` (`satelliteLook`, `satellitePasses`) und
 * `observing-planner.js` (`renderEvents`: Bahndaten älter als 14 Tage gelten als veraltet). Abweichung: der
 * Beobachter steht in seiner Höhe über dem WGS-84-Ellipsoid (Vorlage: Meereshöhe). Nur Anzeige.
 */
import { acos, asin, atan2, cos, log10, sin } from '../../math';
import { DEG, norm360, RAD } from '../../astro/angles';
import { sunAt } from '../../astro/bodies';
import { type Site } from '../../astro/horizon';
import { sunApparent } from '../../astro/sun';
import { gmstDeg, jdeFromUnix, jdFromUnix } from '../../astro/time';
import { roundHalfAwayFromZero } from '../../round';
import { goldenMin } from './common';
import { parseTle, sgp4, sgp4init, WGS72_RADIUS_KM, type Sgp4Record } from './sgp4';

/** Satellit mit Bahnelementen, wie in `sky-events.json` (`satellites[]`). */
export interface SatelliteTle {
  /** NORAD-Katalognummer (25544 ISS, 48274 Tiangong, 20580 Hubble). */
  readonly id: number;
  /** Anzeigename aus den Daten („ISS“, „Tiangong“, „Hubble“). */
  readonly name: string;
  /** Eigenhelligkeit in 1000 km Abstand bei halb beleuchteter Scheibe (Phasenwinkel 90°), mag. */
  readonly std: number;
  readonly tle1: string;
  readonly tle2: string;
}

/** Standort mit Höhe über dem Ellipsoid (Meter, fehlt = 0). */
export interface SatelliteObserver extends Site {
  readonly elevationM?: number;
}

export interface SatelliteLook {
  /** Geometrische Höhe (ohne Refraktion), Grad. */
  readonly altDeg: number;
  /** Azimut von Nord über Ost, Grad in [0, 360). */
  readonly azDeg: number;
  /** Abstand Beobachter–Satellit, km. */
  readonly rangeKm: number;
  /** Satellit im Sonnenlicht (außerhalb des zylindrischen Erdschattens). */
  readonly lit: boolean;
  /** Geschätzte Helligkeit, mag (`null` ohne Eigenhelligkeit). */
  readonly mag: number | null;
}

/** Beobachter auf dem WGS-84-Ellipsoid, km, erdfest. */
function observerEcef(site: SatelliteObserver): [number, number, number] {
  const a = 6378.137;
  const e2 = 0.00669437999014;
  const h = (site.elevationM ?? 0) / 1000;
  const phi = site.latDeg * RAD;
  const lam = site.lonDeg * RAD;
  const sp = sin(phi);
  const n = a / Math.sqrt(1 - e2 * sp * sp);
  return [(n + h) * cos(phi) * cos(lam), (n + h) * cos(phi) * sin(lam), (n * (1 - e2) + h) * sp];
}

/** Diffuse Kugel: Helligkeit beim Phasenwinkel b relativ zur vollen Beleuchtung. */
function phaseFunction(b: number): number {
  return (sin(b) + (Math.PI - b) * cos(b)) / Math.PI;
}

/**
 * Höhe, Azimut, Abstand, Sonnenlicht und geschätzte Helligkeit eines Satelliten zu `unixSec`;
 * `null`, wenn die Bahn ungültig ist. `stdMag` = Eigenhelligkeit (1000 km, halb beleuchtet).
 */
export function satelliteLook(
  rec: Sgp4Record,
  unixSec: number,
  site: SatelliteObserver,
  stdMag: number | null,
): SatelliteLook | null {
  const pv = sgp4(rec, (unixSec - rec.epochUtc) / 60);
  if (!pv) return null;
  const th = gmstDeg(jdFromUnix(unixSec)) * RAD;
  const c = cos(th);
  const sn = sin(th);
  const r = pv.r;
  const obs = observerEcef(site);
  const phi = site.latDeg * RAD;
  const lam = site.lonDeg * RAD;
  // Satellit ins erdfeste System, dann Süd–Ost–Zenit am Beobachter
  const xe = c * r[0] + sn * r[1];
  const ye = -sn * r[0] + c * r[1];
  const ze = r[2];
  const dx = xe - obs[0];
  const dy = ye - obs[1];
  const dz = ze - obs[2];
  const south = sin(phi) * cos(lam) * dx + sin(phi) * sin(lam) * dy - cos(phi) * dz;
  const east = -sin(lam) * dx + cos(lam) * dy;
  const zen = cos(phi) * cos(lam) * dx + cos(phi) * sin(lam) * dy + sin(phi) * dz;
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // Sonne als Richtung im selben System (TEME ≈ wahres Äquinoktium des Datums); zylindrischer Erdschatten
  const sp = sunApparent(jdeFromUnix(unixSec));
  const sd = sp.decDeg * RAD;
  const sr = sp.raDeg * RAD;
  const sun = [cos(sd) * cos(sr), cos(sd) * sin(sr), sin(sd)] as const;
  const along = r[0] * sun[0] + r[1] * sun[1] + r[2] * sun[2];
  const px = r[0] - along * sun[0];
  const py = r[1] - along * sun[1];
  const pz = r[2] - along * sun[2];
  const lit = along > 0 || Math.sqrt(px * px + py * py + pz * pz) > WGS72_RADIUS_KM;
  let mag: number | null = null;
  if (stdMag !== null) {
    // Beobachter zurück nach TEME für den Phasenwinkel am Satelliten
    const ox = c * obs[0] - sn * obs[1];
    const oy = sn * obs[0] + c * obs[1];
    const oz = obs[2];
    const tx = ox - r[0];
    const ty = oy - r[1];
    const tz = oz - r[2];
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const beta = acos(Math.max(-1, Math.min(1, (tx * sun[0] + ty * sun[1] + tz * sun[2]) / tl)));
    mag =
      stdMag + 5 * log10(range / 1000) - 2.5 * log10(Math.max(phaseFunction(beta), 1e-4) * Math.PI);
  }
  return {
    altDeg: asin(zen / range) * DEG,
    azDeg: norm360(atan2(east, -south) * DEG),
    rangeKm: range,
    lit,
    mag,
  };
}

export interface PassPoint {
  /** Unix-Sekunden (UTC). */
  readonly t: number;
  readonly altDeg: number;
  /** Von Nord über Ost. */
  readonly azDeg: number;
  readonly mag: number | null;
}

export interface SatellitePass {
  readonly id: number;
  readonly name: string;
  /** Erste und letzte sichtbare Sekunde (Unix, UTC), auf ≈ 1 s verfeinert. */
  readonly startUtc: number;
  readonly endUtc: number;
  /** Höchster Punkt: um die höchste 20-s-Probe per Goldenem Schnitt auf eine Sekunde verfeinert (Prüfung
   *  28.09.2026 – die Probe allein lag bei hohen Überflügen bis 7,5° zu tief). */
  readonly max: PassPoint;
  /** Hellste geschätzte Helligkeit der Proben, mag (`null` ohne Schätzung). */
  readonly brightestMag: number | null;
  /** Verschwindet im Erdschatten (statt unter 10° zu sinken). */
  readonly faded: boolean;
  /** Sichtbare Proben alle 20 s (Weg für die Sternkarte; erster/letzter Punkt = Richtung „von → nach“). */
  readonly track: readonly PassPoint[];
}

/** Probenabstand der Überflugsuche, s. */
const PASS_STEP_S = 20;
/** Sichtbar: über 10° Höhe, im Sonnenlicht, Sonne mindestens 6° unter dem Horizont. */
const PASS_MIN_ALT_DEG = 10;
const PASS_SUN_MAX_DEG = -6;
/** Mindestdauer eines gelisteten Überflugs, s. */
const PASS_MIN_DURATION_S = 60;

/**
 * Höchster Punkt eines Überflugs zwischen den Nachbarproben der höchsten Probe (±20 s, innerhalb des sichtbaren
 * Abschnitts): Goldener Schnitt auf 1 s, dann auf die volle Sekunde gerundet. Nie tiefer als die Probe.
 */
function refineMax(
  rec: Sgp4Record,
  std: number,
  site: SatelliteObserver,
  sample: PassPoint,
  start: number,
  end: number,
): PassPoint {
  const a = Math.max(start, sample.t - PASS_STEP_S);
  const b = Math.min(end, sample.t + PASS_STEP_S);
  if (b - a < 2) return sample;
  const alt = (t: number) => satelliteLook(rec, t, site, std)?.altDeg ?? -90;
  const t = roundHalfAwayFromZero(goldenMin((x) => -alt(x), a, b, 1));
  const lk = satelliteLook(rec, t, site, std);
  if (!lk || lk.altDeg <= sample.altDeg) return sample;
  return { t, altDeg: lk.altDeg, azDeg: lk.azDeg, mag: lk.mag };
}

/**
 * Sichtbare Überflüge zwischen `startUtc` und `endUtc` (Vorlage `satellitePasses`): über 10°, im Sonnenlicht,
 * Sonne unter −6°, mindestens eine Minute lang. Proben alle 20 s; Anfang und Ende per 6-facher Halbierung
 * auf eine Sekunde gerundet. Leer für Tiefraum-Bahnen.
 */
export function satellitePasses(
  sat: SatelliteTle,
  startUtc: number,
  endUtc: number,
  site: SatelliteObserver,
): SatellitePass[] {
  const rec = sgp4init(parseTle(sat.tle1, sat.tle2));
  const passes: SatellitePass[] = [];
  if (!rec) return passes;
  const seen = (t: number): boolean => {
    if (sunAt(t, site).altDeg >= PASS_SUN_MAX_DEG) return false;
    const lk = satelliteLook(rec, t, site, sat.std);
    return !!lk && lk.altDeg > PASS_MIN_ALT_DEG && lk.lit;
  };
  // Die Proben liegen 20 s auseinander: die wahre erste bzw. letzte sichtbare Sekunde liegt dazwischen.
  const edge = (inside0: number, outside0: number): number => {
    let inside = inside0;
    let outside = outside0;
    for (let i = 0; i < 6; i++) {
      const m = (inside + outside) / 2;
      if (seen(m)) inside = m;
      else outside = m;
    }
    return roundHalfAwayFromZero(inside);
  };
  let cur: {
    start: number;
    track: PassPoint[];
    max: PassPoint | null;
    brightest: number | null;
  } | null = null;
  for (let t = startUtc; t <= endUtc + PASS_STEP_S; t += PASS_STEP_S) {
    const look =
      t <= endUtc && sunAt(t, site).altDeg < PASS_SUN_MAX_DEG
        ? satelliteLook(rec, t, site, sat.std)
        : null;
    const visible = !!look && look.altDeg > PASS_MIN_ALT_DEG && look.lit;
    if (visible) {
      if (!cur) cur = { start: t, track: [], max: null, brightest: null };
      const p: PassPoint = { t, altDeg: look.altDeg, azDeg: look.azDeg, mag: look.mag };
      cur.track.push(p);
      if (!cur.max || p.altDeg > cur.max.altDeg) cur.max = p;
      if (p.mag !== null && (cur.brightest === null || p.mag < cur.brightest))
        cur.brightest = p.mag;
    } else if (cur) {
      const last = cur.track[cur.track.length - 1]?.t ?? cur.start;
      const start =
        cur.start - PASS_STEP_S >= startUtc ? edge(cur.start, cur.start - PASS_STEP_S) : cur.start;
      const stop = Math.min(t, endUtc);
      const end = stop > last ? edge(last, stop) : last;
      const faded = !!look && look.altDeg > PASS_MIN_ALT_DEG && !look.lit;
      const max = cur.max ? refineMax(rec, sat.std, site, cur.max, start, end) : null;
      const brightest =
        max?.mag != null && (cur.brightest === null || max.mag < cur.brightest)
          ? max.mag
          : cur.brightest;
      if (end - start >= PASS_MIN_DURATION_S && max)
        passes.push({
          id: sat.id,
          name: sat.name,
          startUtc: start,
          endUtc: end,
          max,
          brightestMag: brightest,
          faded,
          track: cur.track,
        });
      cur = null;
    }
  }
  return passes;
}

/** Bahndaten gelten etwa zwei Wochen (Vorlage: älter als 14 Tage zur Nachtmitte → keine Überflüge). */
export const TLE_MAX_AGE_S = 14 * 86400;

export interface StaleSatellite {
  readonly id: number;
  readonly name: string;
  /** Epoche der Bahnelemente, Unix-Sekunden (UTC). */
  readonly epochUtc: number;
}

export interface NightPasses {
  /** Alle Überflüge, nach Beginn sortiert (Gleichstand: Katalognummer). */
  readonly passes: readonly SatellitePass[];
  /** Satelliten ohne verlässliche Bahndaten für diese Nacht (keine Überflüge berechnet). */
  readonly stale: readonly StaleSatellite[];
  /** Jüngste TLE-Epoche aller Satelliten, Unix-Sekunden (für „Satellitenbahnen Stand …“); `null` ohne Satelliten. */
  readonly newestEpochUtc: number | null;
  /** Alle Satelliten veraltet (Vorlage: Warnung statt Leertext). */
  readonly allStale: boolean;
}

/**
 * Überflüge aller Satelliten einer Nacht wie der Beobachtungsplaner (`renderEvents`): Satelliten, deren
 * Epoche mehr als 14 Tage von der Fenstermitte entfernt liegt, werden übersprungen und in `stale` genannt.
 */
export function satellitePassesForNight(
  sats: readonly SatelliteTle[],
  startUtc: number,
  endUtc: number,
  site: SatelliteObserver,
): NightPasses {
  const mid = (startUtc + endUtc) / 2;
  const stale: StaleSatellite[] = [];
  let passes: SatellitePass[] = [];
  let newest: number | null = null;
  for (const sat of sats) {
    const epochUtc = parseTle(sat.tle1, sat.tle2).epochUtc;
    newest = newest === null ? epochUtc : Math.max(newest, epochUtc);
    if (Math.abs(mid - epochUtc) > TLE_MAX_AGE_S) {
      stale.push({ id: sat.id, name: sat.name, epochUtc });
      continue;
    }
    passes = passes.concat(satellitePasses(sat, startUtc, endUtc, site));
  }
  passes.sort((a, b) => a.startUtc - b.startUtc || a.id - b.id);
  return {
    passes,
    stale,
    newestEpochUtc: newest,
    allStale: stale.length > 0 && stale.length === sats.length,
  };
}
