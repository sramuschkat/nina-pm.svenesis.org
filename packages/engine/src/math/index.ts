/**
 * Eigene Mathematik der Engine (TK 8.1, rules/engine.md Nr. 2): Port von fdlibm 5.3, damit Browser,
 * Node und Jint bitgleich rechnen. Aus `Math` sind nur abs/floor/ceil/trunc/min/max/sign/sqrt/PI
 * erlaubt (IEEE 754 legt sqrt exakt fest).
 */
export { acos, asin, atan, atan2 } from './inverse';
export { exp, log, log10, pow } from './explog';
export { cos, sin, tan } from './trig';

/**
 * `fmod(x, y)` = x − n·y mit n = trunc(x/y). Der ECMAScript-Operator `%` ist genau so festgelegt
 * (exakt, ohne Rundung; ECMA-262 §6.1.6.1.6) und entspricht C `fmod` bzw. .NET `%` – kein Port nötig.
 */
export function fmod(x: number, y: number): number {
  return x % y;
}
