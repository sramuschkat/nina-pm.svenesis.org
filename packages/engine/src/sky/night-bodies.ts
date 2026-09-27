/**
 * Mond und Planeten einer Nacht am Standort („Mond & Planeten“ auf *Heute Nacht*, Wunsch Sven 27.09.2026):
 * Höhe, Azimut, Helligkeit bzw. beleuchteter Anteil in festen Schritten und der beste Moment je Körper.
 * Portiert aus `legacy/astro-tools-2026-09-21/js/observing-planner.js` (`renderPlanets`, `bestSample`) und
 * `astro-core.js` (`bodyAt`): Mond topozentrisch und scheinbar (`moonAt`), Planeten geometrisch aus `planetAt`.
 * Nur Anzeige – die Planung nutzt keine Planeten.
 */
import { norm180 } from '../astro/angles';
import { moonAt, sunAt } from '../astro/bodies';
import { altAz, localApparentSiderealDeg, type Site } from '../astro/horizon';
import { jdeFromUnix } from '../astro/time';
import { PLANET_IDS, planetAt, type PlanetId } from './planets';

export const NIGHT_BODIES = ['moon', ...PLANET_IDS] as const;
export type NightBodyId = 'moon' | PlanetId;

export interface BodySample {
  readonly altDeg: number;
  /** Azimut von Nord über Ost, Grad. */
  readonly azDeg: number;
  /** Helligkeit (Planeten), sonst `null`. */
  readonly mag: number | null;
  /** Beleuchteter Anteil in % (Mond), sonst `null`. */
  readonly illumPct: number | null;
}

export interface NightBodiesRow {
  /** Unix-Sekunden (UTC). */
  readonly t: number;
  readonly sunAltDeg: number;
  readonly bodies: Readonly<Record<NightBodyId, BodySample>>;
}

/** Mond oder Planet am Standort zu `unixSec`. */
export function bodyAtSite(id: NightBodyId, unixSec: number, site: Site): BodySample {
  if (id === 'moon') {
    const m = moonAt(unixSec, site);
    return { altDeg: m.altDeg, azDeg: m.azDeg, mag: null, illumPct: m.illumPct };
  }
  const p = planetAt(id, jdeFromUnix(unixSec));
  const ha = norm180(localApparentSiderealDeg(unixSec, site.lonDeg) - p.raDeg);
  const { altDeg, azDeg } = altAz(ha, p.decDeg, site.latDeg);
  return { altDeg, azDeg, mag: p.mag, illumPct: null };
}

/** Proben von `fromUtc` bis `toUtc` (einschließlich) im Abstand `stepSec` (Vorlage: 10 min). */
export function nightBodySamples(
  site: Site,
  fromUtc: number,
  toUtc: number,
  stepSec = 600,
): NightBodiesRow[] {
  const rows: NightBodiesRow[] = [];
  for (let t = fromUtc; t <= toUtc; t += stepSec) {
    const bodies = {} as Record<NightBodyId, BodySample>;
    for (const id of NIGHT_BODIES) bodies[id] = bodyAtSite(id, t, site);
    rows.push({ t, sunAltDeg: sunAt(t, site).altDeg, bodies });
  }
  return rows;
}

/**
 * Bester Moment zum Beobachten (Vorlage `bestSample`): am höchsten, solange die Sonne mindestens nautisch
 * tief steht (< −6°), sonst nach Sonnenuntergang (< −0,833°); `null`, wenn der Körper nur am Tag über dem
 * Horizont steht.
 */
export function bestBodySample(
  rows: readonly NightBodiesRow[],
  id: NightBodyId,
): { t: number; sample: BodySample } | null {
  const pick = (limit: number) => {
    let best: { t: number; sample: BodySample } | null = null;
    for (const row of rows) {
      const b = row.bodies[id];
      if (row.sunAltDeg < limit && b.altDeg > 0 && (!best || b.altDeg > best.sample.altDeg))
        best = { t: row.t, sample: b };
    }
    return best;
  };
  return pick(-6) ?? pick(-0.833);
}
