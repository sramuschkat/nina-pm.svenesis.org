/**
 * Rotationsvergleich (flip-rotation.md §3, NT-E4): überall **modulo 180°** – PA und PA + 180° ergeben
 * dasselbe Bildfeld. `r = |ist − soll| mod 180; Δ = min(r, 180 − r)`; Winkel vorher auf 1e-6° gerundet.
 */
import { q } from '../round';

export function rotationDeltaDeg(actualDeg: number, targetDeg: number): number {
  const r = Math.abs(q(actualDeg, 1e6) - q(targetDeg, 1e6)) % 180;
  return q(Math.min(r, 180 - r), 1e6);
}

/** `Δ ≤ Toleranz` (inklusive). */
export function rotationWithinTolerance(
  actualDeg: number,
  targetDeg: number,
  toleranceDeg: number,
): boolean {
  return rotationDeltaDeg(actualDeg, targetDeg) <= q(toleranceDeg, 1e6);
}
