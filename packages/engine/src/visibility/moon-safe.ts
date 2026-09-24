/**
 * Mondvermeidung `moonSafe` (specs/engine/moon.md §Algorithmus, FK 8.2, FA-MON-01…05) und
 * Restriktivität für die Mond-Stufen (moon.md §Restriktivität, allocation.md §3.4).
 * Gerundet wird mit `q(x, 1e6)` unmittelbar vor jedem Vergleich; „≤“/„≥“ inklusive.
 */
import { atan } from '../math';
import { q } from '../round';

export interface MoonProfile {
  /** `A`: geforderter Abstand bei Vollmond, Grad. */
  readonly separationDeg: number;
  /** `W`: Tage, bis der Abstand auf die Hälfte fällt. */
  readonly widthDays: number;
  /** `relax`: Grad geforderter Abstand je Grad Mondhöhe unter `maxAlt` – **kein** Multiplikator (AST-M2). */
  readonly relaxScale: number;
  /** Höhe, unter der die Forderung entfällt (Stufe 2). */
  readonly moonMinAltDeg: number;
  /** Höhe, **ab der** der volle Abstand gilt (gegenüber Astro PM invertiert, AST-M8). */
  readonly moonMaxAltDeg: number;
  readonly maxIlluminationPct: number;
  /** Nur Stufe 1: Mond unter dem Horizont (scheinbare Mitte ≤ 0°, „Kein Mond“). */
  readonly moonMustBeDown: boolean;
}

export interface MoonSlotState {
  /** Scheinbare topozentrische Höhe des Mondmittelpunkts, Grad. */
  readonly moonAltDeg: number;
  /** Beleuchteter Anteil in %. */
  readonly illumPct: number;
  /** Phasenmaß `d` in Tag-Äquivalenten bis/seit Vollmond. */
  readonly phaseDays: number;
  /** Abstand Mond–Ziel (topozentrisch, unrefraktiert, atan2), Grad. */
  readonly sepDeg: number;
}

/** Mindestabstand, der auch bei erfüllter Beleuchtungsschwelle gilt (Stufe 3, AST-M1). */
export const MOON_A_FLOOR_DEG = 15;

/** Geforderter Abstand in Stufe 4 bei Mondhöhe `moonAltDeg` und Phasenmaß `d` (ungerundet). */
export function requiredSeparationDeg(
  p: MoonProfile,
  moonAltDeg: number,
  phaseDays: number,
): number {
  let ae = p.separationDeg;
  let we = p.widthDays;
  if (moonAltDeg < p.moonMaxAltDeg) {
    const f = (moonAltDeg - p.moonMinAltDeg) / (p.moonMaxAltDeg - p.moonMinAltDeg);
    ae = Math.max(0, p.separationDeg - p.relaxScale * (p.moonMaxAltDeg - moonAltDeg));
    we = p.widthDays * f;
  }
  if (we === 0) return 0;
  const r = phaseDays / we;
  return ae / (1 + r * r);
}

/**
 * `true` = der Slot ist für eine Zeile mit diesem Profil mondsicher.
 * Stufe 1 gilt für „Mond muss unter dem Horizont sein“ allein (Entscheidung 24.09.2026: ≤ 0°, wie
 * `MoonDown` in allocation.md §2; `maxAlt` spielt dann keine Rolle).
 */
export function moonSafe(p: MoonProfile, s: MoonSlotState): boolean {
  const alt = q(s.moonAltDeg, 1e6);
  if (alt <= 0) return true;
  if (p.moonMustBeDown) return false;
  if (alt <= q(p.moonMinAltDeg, 1e6)) return true;
  const sep = q(s.sepDeg, 1e6);
  if (q(s.illumPct, 1e6) <= q(p.maxIlluminationPct, 1e6) && sep >= MOON_A_FLOOR_DEG) return true;
  return sep >= q(requiredSeparationDeg(p, s.moonAltDeg, s.phaseDays), 1e6);
}

/** Halber synodischer Monat in Tagen (Integrationsgrenze der Restriktivität). */
const HALF_CYCLE_DAYS = 14.77;

/**
 * `restrictiveness = A · W · arctan(14,77 / W)` (Bogenmaß, Integral des geforderten Abstands über den
 * halben Mondzyklus); `mustBeDown` → ∞; `W = 0` → 0 (moon.md §Restriktivität, AST-M3).
 */
export function restrictiveness(p: MoonProfile): number {
  if (p.moonMustBeDown) return Number.POSITIVE_INFINITY;
  if (p.widthDays === 0) return 0;
  return p.separationDeg * p.widthDays * atan(HALF_CYCLE_DAYS / p.widthDays);
}
