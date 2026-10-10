/**
 * Schnelle Reihen für den Objektbrowser (Performance 10.10.2026): `apparentAltitudes` und `targetApparentAt` liefern
 * **dieselben Bits** wie der Einzelweg über `altAz`/`apparentAltitudeDeg` bzw. `targetApparent`.
 */
import { describe, expect, it } from 'vitest';
import {
  altAz,
  apparentAltitudeDeg,
  apparentAltitudes,
  norm180,
  targetApparent,
  targetApparentAt,
} from '../src';

// Deterministische Pseudo-Zufallsfolge (kein Math.random in der Engine-Testumgebung nötig).
function* lcg(seed: number) {
  let x = seed;
  for (;;) {
    x = (x * 1103515245 + 12345) % 2147483648;
    yield x / 2147483648;
  }
}

describe('apparentAltitudes', () => {
  it('bitgleich mit altAz + Refraktion für Breiten, Deklinationen und Sternzeiten', () => {
    const r = lcg(7);
    const next = () => r.next().value as number;
    for (let k = 0; k < 400; k += 1) {
      const lat = next() * 179.8 - 89.9;
      const ra = next() * 360;
      const dec = next() * 180 - 90;
      const lst = Array.from({ length: 40 }, () => next() * 360);
      const fast = apparentAltitudes(lst, ra, dec, lat);
      const slow = lst.map((l) => apparentAltitudeDeg(altAz(norm180(l - ra), dec, lat).altDeg));
      expect(fast).toEqual(slow);
      fast.forEach((a, i) => expect(Object.is(a, slow[i])).toBe(true));
    }
  });
});

describe('targetApparentAt', () => {
  it('bitgleich mit targetApparent zu einem Zeitpunkt', () => {
    const r = lcg(11);
    const next = () => r.next().value as number;
    for (const jde of [2461323.5, 2461688.25, 2470000.75]) {
      const at = targetApparentAt(jde);
      for (let k = 0; k < 300; k += 1) {
        const t = { raJ2000Deg: next() * 360, decJ2000Deg: next() * 179.9 - 89.95 };
        const a = at(t);
        const b = targetApparent(t, jde);
        expect(Object.is(a.raDeg, b.raDeg) && Object.is(a.decDeg, b.decDeg)).toBe(true);
      }
    }
  });
});
