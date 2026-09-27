/**
 * Mondphasen (Anzeige „Mond und Dunkelheit“, Mondkalender): Phasenwinkel als Differenz der scheinbaren
 * ekliptikalen Längen von Mond und Sonne (geozentrisch, Meeus Kap. 49: Neumond 0°, Erstes Viertel 90°,
 * Vollmond 180°, Letztes Viertel 270°). Zeitpunkte per Suche im 6-h-Raster und Bisektion auf 1 s – der
 * Phasenwinkel wächst stetig um ≈ 12,2°/Tag. Rein, ohne Uhr; Eingaben und Ausgaben in Unix-Sekunden.
 */
import { norm180, norm360 } from './angles';
import { moonApparent } from './moon';
import { sunApparent } from './sun';
import { jdeFromUnix } from './time';

export type MoonQuarter = 'new' | 'first' | 'full' | 'last';

export interface MoonPhaseEvent {
  readonly kind: MoonQuarter;
  readonly atUtc: number;
}

const QUARTERS: readonly (readonly [MoonQuarter, number])[] = [
  ['new', 0],
  ['first', 90],
  ['full', 180],
  ['last', 270],
];
const SEARCH_STEP_S = 6 * 3600;
const DAY_S = 86400;
/** Längste synodische Periode mit Reserve, für die Suche nach dem letzten Neumond. */
const SYNODIC_SEARCH_S = 30.2 * DAY_S;

/** Phasenwinkel λ☾ − λ☉ in [0, 360): 0 Neumond, 90 Erstes Viertel, 180 Vollmond, 270 Letztes Viertel. */
export function moonPhaseAngleDeg(unixSec: number): number {
  const jde = jdeFromUnix(unixSec);
  return norm360(moonApparent(jde).lambdaDeg - sunApparent(jde).lambdaDeg);
}

/** Vorzeichenbehafteter Abstand zum Zielwinkel in (−180, 180]; wird beim Durchgang negativ → positiv. */
const offset = (unixSec: number, targetDeg: number) =>
  norm180(moonPhaseAngleDeg(unixSec) - targetDeg);

/** Alle Viertel im Intervall `[fromUtc, toUtc)`, zeitlich sortiert. */
export function moonPhaseEvents(fromUtc: number, toUtc: number): MoonPhaseEvent[] {
  const out: MoonPhaseEvent[] = [];
  for (const [kind, target] of QUARTERS) {
    let a = fromUtc;
    let fa = offset(a, target);
    while (a < toUtc) {
      const b = Math.min(a + SEARCH_STEP_S, toUtc);
      const fb = offset(b, target);
      // Durchgang von − nach + (nicht der Sprung bei ±180°, der liegt 15 Tage entfernt).
      if (fa < 0 && fb >= 0 && fb - fa < 90) {
        let lo = a;
        let hi = b;
        while (hi - lo > 1) {
          const mid = (lo + hi) / 2;
          if (offset(mid, target) < 0) lo = mid;
          else hi = mid;
        }
        if (hi < toUtc) out.push({ kind, atUtc: Math.ceil(hi) });
      }
      a = b;
      fa = fb;
    }
  }
  return out.sort((x, y) => x.atUtc - y.atUtc);
}

/** Mondalter: Tage seit dem letzten Neumond (≥ 0). */
export function moonAgeDays(unixSec: number): number {
  const news = moonPhaseEvents(unixSec - SYNODIC_SEARCH_S, unixSec + 1).filter(
    (e) => e.kind === 'new',
  );
  const last = news[news.length - 1];
  return last ? (unixSec - last.atUtc) / DAY_S : NaN;
}
