/**
 * Sonne und Sternzeit je Zeitpunkt für die Transitsuche (AP-41): Eine Nacht prüft hunderte Planeten auf demselben
 * 300-s-Raster; die zielunabhängigen Größen werden einmal je Zeitpunkt gerechnet. Nur Nachschlagen über den
 * Schlüssel, keine Iteration über die Map (rules/engine.md Nr. 3).
 */
import { norm180 } from '../astro/angles';
import { altAz, localApparentSiderealDeg, type Site } from '../astro/horizon';
import { sunApparent } from '../astro/sun';
import { jdeFromUnix } from '../astro/time';

export interface TransitSkyCache {
  readonly site: Site;
  /** Geometrische Sonnenhöhe, Grad. */
  sunAltDeg(unixSec: number): number;
  /** Scheinbare Ortssternzeit, Grad. */
  lstDeg(unixSec: number): number;
}

export function bodies(site: Site): TransitSkyCache {
  const lst = new Map<number, number>();
  const sun = new Map<number, number>();
  const lstDeg = (t: number): number => {
    const hit = lst.get(t);
    if (hit !== undefined) return hit;
    const v = localApparentSiderealDeg(t, site.lonDeg);
    lst.set(t, v);
    return v;
  };
  return {
    site,
    lstDeg,
    sunAltDeg: (t: number): number => {
      const hit = sun.get(t);
      if (hit !== undefined) return hit;
      const s = sunApparent(jdeFromUnix(t));
      const v = altAz(norm180(lstDeg(t) - s.raDeg), s.decDeg, site.latDeg).altDeg;
      sun.set(t, v);
      return v;
    },
  };
}

/** Gemeinsamer Zwischenspeicher für alle Planeten einer Suche an einem Standort. */
export function createTransitSkyCache(site: Site): TransitSkyCache {
  return bodies(site);
}
