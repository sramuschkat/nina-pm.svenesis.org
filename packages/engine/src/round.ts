/**
 * Rundung (specs/engine/canonical-json.md, rules/engine.md Nr. 4, 9): halbe Werte vom Nullpunkt weg,
 * Quantisierung immer mit ganzzahligem **Kehrwert** `inv` – nie `x/step·step`, nie `Math.round`.
 */

/** 0,5 → 1 · −0,5 → −1 · 2,5 → 3 (kein Bankers Rounding). */
export function roundHalfAwayFromZero(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
}

/** Erlaubte Kehrwerte: 1e9 (kanonisches JSON), 1e6 (Winkel), 1e3 (Wetter-Scores), 10 (Rotator), 1 (Sekunden). */
export type QuantizeInv = 1e9 | 1e6 | 1e4 | 1e3 | 10 | 1;

/** `q(x, inv)` = roundHalfAwayFromZero(x · inv) / inv. */
export function q(x: number, inv: QuantizeInv): number {
  return roundHalfAwayFromZero(x * inv) / inv;
}
