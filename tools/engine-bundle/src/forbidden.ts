/**
 * Konstrukte, die im Jint-Bundle nicht vorkommen dürfen (rules/engine.md Nr. 1 und 7): `BigInt`, `Intl`,
 * Regex-Lookbehind sowie nicht deterministische Quellen (`Math.random`, `Date`). Grobe Textsuche über das
 * fertige Bundle; ESLint verhindert dieselben Dinge schon in `packages/engine/src`, das hier ist die
 * Gegenprobe nach dem Bündeln (auch für Hilfsfunktionen, die esbuild einfügt).
 */
const PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['BigInt', /\bBigInt\b|\b\d+n\b/],
  ['Intl', /\bIntl\./],
  ['Regex-Lookbehind', /\(\?<[=!]/],
  ['Math.random', /\bMath\.random\b/],
  ['Date', /\bnew Date\b|\bDate\.now\b/],
];

export function forbiddenInBundle(code: string): string[] {
  // Kommentare (auch die Kopfzeile) nicht mitprüfen.
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return PATTERNS.filter(([, re]) => re.test(stripped)).map(([name]) => name);
}
