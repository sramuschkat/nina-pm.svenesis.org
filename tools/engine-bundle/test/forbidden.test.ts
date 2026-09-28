/** Gegenprobe nach dem Bündeln (AP-08c, rules/engine.md Nr. 1 und 7). */
import { describe, expect, it } from 'vitest';
import { forbiddenInBundle } from '../src/forbidden';

describe('forbiddenInBundle', () => {
  it('meldet BigInt, Intl, Lookbehind, Math.random und Date', () => {
    expect(forbiddenInBundle('const a = 10n;')).toEqual(['BigInt']);
    expect(forbiddenInBundle('BigInt(3)')).toEqual(['BigInt']);
    expect(forbiddenInBundle('new Intl.DateTimeFormat()')).toEqual(['Intl']);
    expect(forbiddenInBundle('/(?<=a)b/.test(s)')).toEqual(['Regex-Lookbehind']);
    expect(forbiddenInBundle('Math.random()')).toEqual(['Math.random']);
    expect(forbiddenInBundle('Date.now()')).toEqual(['Date']);
  });

  it('ignoriert Kommentare und harmlose Bezeichner', () => {
    expect(
      forbiddenInBundle('/* BigInt, Intl. */ // Math.random\nconst an1n = 1; const x = 2 * n;'),
    ).toEqual([]);
    expect(forbiddenInBundle('const url = "https://x"; const d = 1;')).toEqual([]);
  });
});
