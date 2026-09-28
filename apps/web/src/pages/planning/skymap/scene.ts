/**
 * Zeit und Himmel zu einem Zeitpunkt (S-20 Zeitsteuerung, FA-FRM-08/11): Standortzeit über Temporal
 * (rules/ui.md NT-04, nie `new Date('YYYY-MM-DD')`), Sonne/Mond/Planeten und die Drehung J2000 → Horizont
 * aus der Engine. Nur Anzeige – die Planung rechnet mit dem Nachtkontext der Engine.
 */
import { Temporal } from '@js-temporal/polyfill';
import {
  daysFromKey,
  jdeFromUnix,
  keyFromDays,
  localApparentSiderealDeg,
  moonAt,
  precessToJ2000,
  separationDeg,
  sky,
  sunAt,
} from '@nina-pm/engine';
import type { Bodies, Observer } from './render';

export interface SiteLike {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly timeZone: string;
}

/** Datum und Uhrzeit in der Zone (`YYYY-MM-DD`, `HH:MM`). */
export function zonedParts(unixSec: number, timeZone: string): { date: string; time: string } {
  const z = Temporal.Instant.fromEpochMilliseconds(Math.round(unixSec * 1000)).toZonedDateTimeISO(
    timeZone,
  );
  return {
    date: z.toPlainDate().toString(),
    time: `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`,
  };
}

/** Datum und Uhrzeit der Zone → Unix-Sekunden (bei Zeitumstellung die frühere Möglichkeit). */
export function fromZoned(date: string, time: string, timeZone: string): number | null {
  try {
    const dt = Temporal.PlainDateTime.from(`${date}T${time}`);
    return dt.toZonedDateTime(timeZone, { disambiguation: 'earlier' }).epochMilliseconds / 1000;
  } catch {
    return null;
  }
}

/**
 * Nacht-Schlüssel (Mittag bis Mittag in Standortzeit, NT-01) eines Zeitpunkts: vor 12:00 Standortzeit die Nacht
 * des Vortags. Über die Ortszeit statt „−12 h“ gerechnet – sonst lag an Umstellungstagen eine Stunde lang die
 * falsche Nacht vor (Astronomie-Prüfung 28.09.2026).
 */
export function nightKeyAt(unixSec: number, timeZone: string): string {
  const z = Temporal.Instant.fromEpochMilliseconds(Math.round(unixSec * 1000)).toZonedDateTimeISO(
    timeZone,
  );
  const date = z.toPlainDate();
  return (z.hour < 12 ? date.subtract({ days: 1 }) : date).toString();
}

/**
 * Uhrzeit innerhalb der Nacht `night` (Mittag bis Mittag, NT-01) → Unix-Sekunden: vor 12:00 der Morgen nach dem
 * Abend `night`, sonst der Abend selbst. Die Uhrzeit-Eingabe der Sternkarte nahm vorher das Kalenderdatum des
 * angezeigten Zeitpunkts – 01:30 in der Nacht 17./18. sprang so in die Nacht 16./17. (28.09.2026, P1-13).
 */
export function atNightClock(night: string, time: string, timeZone: string): number | null {
  const m = /^(\d{2}):\d{2}/.exec(time);
  if (!m) return null;
  const date = Number(m[1]) < 12 ? keyFromDays(daysFromKey(night) + 1) : night;
  return fromZoned(date, time, timeZone);
}

const toJ2000Vec = (raDeg: number, decDeg: number, jde: number) => {
  const p = precessToJ2000(raDeg, decDeg, jde);
  return sky.radecToVec(p.raDeg, p.decDeg);
};

export interface Scene {
  readonly observer: Observer;
  readonly bodies: Bodies;
  /** Mondhöhe (Grad), Beleuchtung (%) und Abstand zum Bildfeld (Grad) – Mondinfo der Zeitleiste. */
  readonly moonAltDeg: number;
  readonly moonIllumPct: number;
  readonly moonSepDeg: number;
  readonly sunAltDeg: number;
}

export function sceneAt(
  unixSec: number,
  site: SiteLike,
  frame: { raDeg: number; decDeg: number },
  minAltDeg: number,
  heatAltDeg: number,
): Scene {
  const engineSite = { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg };
  const jde = jdeFromUnix(unixSec);
  const lst = localApparentSiderealDeg(unixSec, site.longitudeDeg);
  const toHorizon = sky.j2000ToHorizonMatrix(jde, lst, site.latitudeDeg);
  const sun = sunAt(unixSec, engineSite);
  const moon = moonAt(unixSec, engineSite);
  const moonJ2000 = precessToJ2000(moon.raDeg, moon.decDeg, jde);
  return {
    observer: { toHorizon, minAltDeg, heatAltDeg, sunAltDeg: sun.altDeg },
    bodies: {
      sun: toJ2000Vec(sun.raDeg, sun.decDeg, jde),
      moon: { vec: sky.radecToVec(moonJ2000.raDeg, moonJ2000.decDeg), illumPct: moon.illumPct },
      planets: sky.PLANET_IDS.map((id) => {
        const p = sky.planetAt(id, jde);
        return { id, vec: p.j2000, mag: p.mag };
      }),
    },
    moonAltDeg: moon.altDeg,
    moonIllumPct: moon.illumPct,
    moonSepDeg: separationDeg(moonJ2000.raDeg, moonJ2000.decDeg, frame.raDeg, frame.decDeg),
    sunAltDeg: sun.altDeg,
  };
}
