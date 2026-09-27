/**
 * Zentrum der Milchstraße (Sgr A*, „Ereignisse der Nacht“): der Abschnitt der Nacht mit Sgr A* mindestens 10°
 * hoch in astronomischer Dunkelheit (nautischer, wo es keine gibt), sein höchster Punkt mit dem Mond dort und
 * für die Saison die Stunden solcher Dunkelheit mit dem Zentrum oben am 15. jedes Monats des Jahres. Portiert
 * aus `legacy/astro-tools-2026-09-21/js/sky-events.js` (`galacticCentre`) und `observing-planner.js`
 * (`seasonText`). Nur Anzeige.
 */
import { norm180 } from '../../astro/angles';
import { sunAt } from '../../astro/bodies';
import { altAz, localApparentSiderealDeg, type Site } from '../../astro/horizon';
import { precessFromJ2000 } from '../../astro/precession';
import { civilFromDays, daysFromCivil, jdeFromUnix } from '../../astro/time';
import { separationAltAzDeg, type EventSample } from './common';

/** Sgr A*, J2000, Grad. */
export const GALACTIC_CENTRE_J2000 = { raDeg: 266.41683, decDeg: -29.00781 } as const;
const MIN_ALT_DEG = 10;

export interface GalacticCentreTonight {
  /** Erste und letzte Probe mit Sgr A* ≥ 10° in der Dunkelheit, Unix-Sekunden (dazwischen evtl. Lücken). */
  readonly fromUtc: number;
  readonly toUtc: number;
  /** Höchster Punkt unter diesen Proben (geometrische Höhe; Azimut von Nord über Ost). */
  readonly best: { readonly t: number; readonly altDeg: number; readonly azDeg: number };
  /** Dunkelheitsstufe: −18 astronomisch, −12 nautisch (keine astronomische Dunkelheit in dieser Nacht). */
  readonly level: -18 | -12;
  /** Beleuchteter Anteil des Mondes zum besten Zeitpunkt, %. */
  readonly moonIllumPct: number;
  /** Abstand zum Mond zum besten Zeitpunkt, Grad; `null`, wenn der Mond unter dem Horizont steht. */
  readonly moonSepDeg: number | null;
}

export interface GalacticCentre {
  /** Diese Nacht; `null`, wenn Sgr A* in der Dunkelheit nicht 10° hoch steht. */
  readonly tonight: GalacticCentreTonight | null;
  /**
   * Saison: Stunden astronomischer Dunkelheit mit Sgr A* ≥ 10° am 15. jedes Monats (Index 0 = Januar) des
   * UTC-Jahres der ersten Probe, im 20-min-Raster von 12:00 UTC bis 12:00 UTC des Folgetags.
   */
  readonly monthsHours: readonly number[];
}

function gcAltAz(pc: { raDeg: number; decDeg: number }, unixSec: number, site: Site) {
  return altAz(
    norm180(localApparentSiderealDeg(unixSec, site.lonDeg) - pc.raDeg),
    pc.decDeg,
    site.latDeg,
  );
}

/** Sgr A* in der Nacht der Proben (Vorlage `galacticCentre`); `null` ohne Proben. */
export function galacticCentre(samples: readonly EventSample[], site: Site): GalacticCentre | null {
  const first = samples[0];
  if (!first) return null;
  const pc = precessFromJ2000(
    GALACTIC_CENTRE_J2000.raDeg,
    GALACTIC_CENTRE_J2000.decDeg,
    jdeFromUnix(first.t),
  );
  let level: -18 | -12 = -18;
  let rows = samples.filter((r) => r.sunAltDeg < -18);
  if (!rows.length) {
    rows = samples.filter((r) => r.sunAltDeg < -12);
    level = -12;
  }
  const up: { t: number; altDeg: number; azDeg: number; row: EventSample }[] = [];
  for (const r of rows) {
    const h = gcAltAz(pc, r.t, site);
    if (h.altDeg >= MIN_ALT_DEG) up.push({ t: r.t, altDeg: h.altDeg, azDeg: h.azDeg, row: r });
  }
  let best: (typeof up)[number] | null = null;
  for (const x of up) if (!best || x.altDeg > best.altDeg) best = x;

  const year = civilFromDays(Math.floor(first.t / 86400)).y;
  const monthsHours: number[] = [];
  for (let mo = 1; mo <= 12; mo++) {
    const t0 = daysFromCivil(year, mo, 15) * 86400 + 43200;
    const pm = precessFromJ2000(
      GALACTIC_CENTRE_J2000.raDeg,
      GALACTIC_CENTRE_J2000.decDeg,
      jdeFromUnix(t0),
    );
    let hrs = 0;
    for (let tt = t0; tt < t0 + 86400; tt += 1200)
      if (sunAt(tt, site).altDeg < -18 && gcAltAz(pm, tt, site).altDeg >= MIN_ALT_DEG) hrs += 1 / 3;
    monthsHours.push(hrs);
  }

  const firstUp = up[0];
  const lastUp = up[up.length - 1];
  const tonight: GalacticCentreTonight | null =
    best && firstUp && lastUp
      ? {
          fromUtc: firstUp.t,
          toUtc: lastUp.t,
          best: { t: best.t, altDeg: best.altDeg, azDeg: best.azDeg },
          level,
          moonIllumPct: best.row.moonIllumPct,
          moonSepDeg:
            best.row.moonAltDeg > 0
              ? separationAltAzDeg(best.altDeg, best.azDeg, best.row.moonAltDeg, best.row.moonAzDeg)
              : null,
        }
      : null;
  return { tonight, monthsHours };
}

/** Saison als Monatsläufe (Vorlage `seasonText`): Monate mit mindestens einer Stunde. */
export interface GalacticSeason {
  /** Kein Monat erreicht eine Stunde („hier nie 10° hoch bei Dunkelheit“). */
  readonly none: boolean;
  /** Alle zwölf Monate („ganzjährig“). */
  readonly allYear: boolean;
  /** Zusammenhängende Läufe über den Jahreswechsel hinweg, Monate 0–11, in der Reihenfolge ihres Beginns. */
  readonly runs: readonly { readonly fromMonth: number; readonly toMonth: number }[];
}

export function galacticSeason(monthsHours: readonly number[]): GalacticSeason {
  const on = monthsHours.map((h) => h >= 1);
  const any = on.some(Boolean);
  const all = on.length === 12 && on.every(Boolean);
  const runs: { fromMonth: number; toMonth: number }[] = [];
  if (any && !all)
    for (let i = 0; i < 12; i++) {
      if (!on[i] || on[(i + 11) % 12]) continue;
      let j = i;
      while (on[(j + 1) % 12]) j = (j + 1) % 12;
      runs.push({ fromMonth: i, toMonth: j });
    }
  return { none: !any, allYear: all, runs };
}
