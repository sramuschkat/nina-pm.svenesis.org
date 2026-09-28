/**
 * Feste Fälle des Paritätstests (canonical-json.md, Testvektoren): Ausdrücke als JavaScript-Quelltext,
 * damit Node und Jint dieselben Werte erzeugen – auch `undefined`, `NaN`, `-0` und Unicode, die in JSON
 * nicht darstellbar sind.
 */
export const CANONICAL_CASES: readonly string[] = [
  '({ b: 1, a: 2 })',
  '({ a: -0 })',
  '({ a: 0.1 + 0.2 })',
  '({ a: 1e21 })',
  '({ a: [3, 1, 2] })',
  "({ Z: 1, a: 2, 'É': 3 })",
  '({ a: undefined, b: null })',
  '({ a: NaN })',
  '({ a: Infinity })',
  "({ s: 'Teleskop \\ud83d\\udd2d', t: 'Zeile\\nzwei', u: '\"quote\" \\\\ back' })",
  '({ n: [1e-7, 123456.123456789, -2.0000005, 1e6 + 0.5, 5e-324] })',
  '({ deep: { z: [{ b: true, a: false }], a: { c: null } } })',
];

export const SHA_CASES: readonly string[] = ['', 'abc', 'Zeile\n', 'a'.repeat(1000)];

export const Q_CASES: readonly (readonly [number, number])[] = [
  [0.5, 1],
  [1.5, 1],
  [2.5, 1],
  [-0.5, 1],
  [-1.5, 1],
  [2.0000005, 1e6],
  [0.1 + 0.2, 1e9],
  [-2.0000005, 1e6],
  [359.99999949, 1e6],
  [0.0005, 1e3],
];
