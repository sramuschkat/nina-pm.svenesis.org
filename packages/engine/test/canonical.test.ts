/** specs/engine/canonical-json.md (AP-08a): Pflicht-Testvektoren, Rundung, SHA-256 über UTF-8. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalHash,
  canonicalInputJson,
  CanonicalError,
  ENGINE_VERSION,
  q,
  roundHalfAwayFromZero,
  sha256hex,
} from '../src/index';

describe('canonicalInputJson – Testvektoren', () => {
  it.each([
    [{ b: 1, a: 2 }, '{"a":2,"b":1}'],
    [{ a: -0 }, '{"a":0}'],
    [{ a: 0.1 + 0.2 }, '{"a":0.3}'],
    [{ a: 1e21 }, '{"a":1e+21}'],
    [{ a: [3, 1, 2] }, '{"a":[3,1,2]}'],
    // Sortierung nach UTF-16-Codeeinheiten (Z < a < É); Nicht-ASCII als \uXXXX (Hash-Regel, AST-D10).
    [{ Z: 1, a: 2, É: 3 }, '{"Z":1,"a":2,"\\u00c9":3}'],
    [{ a: undefined, b: null }, '{"b":null}'],
  ])('%j → %s', (input, expected) => {
    expect(canonicalInputJson(input)).toBe(expected);
  });

  it('NaN, ±Infinity → canonical.non_finite; undefined im Array → Fehler', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => canonicalInputJson({ a: bad })).toThrow(CanonicalError);
      try {
        canonicalInputJson({ a: { b: [1, bad] } });
      } catch (e) {
        expect(e).toMatchObject({ code: 'canonical.non_finite', path: '.a.b[1]' });
      }
    }
    expect(() => canonicalInputJson([1, undefined])).toThrow(/canonical.undefined_in_array/);
  });

  it('Zahlen: q(x, 1e9) unter 1e6, darüber unverändert; ECMAScript-Darstellung', () => {
    expect(
      canonicalInputJson([1.23456789012, 1234567.123456789, 1e-10, -2.5e-9, 123456.1234567891]),
    ).toBe('[1.23456789,1234567.123456789,0,-3e-9,123456.123456789]');
  });

  it('Strings wie JSON.stringify, alle Codeeinheiten > U+007F escaped (ASCII-rein)', () => {
    const s = canonicalInputJson({ name: 'Nördlicher Ring "M57"\n', emoji: '🔭' });
    expect(s).toBe('{"emoji":"\\ud83d\\udd2d","name":"N\\u00f6rdlicher Ring \\"M57\\"\\n"}');
    expect(Array.from(s).every((c) => c.charCodeAt(0) <= 0x7f)).toBe(true);
    expect(JSON.parse(s)).toEqual({ name: 'Nördlicher Ring "M57"\n', emoji: '🔭' });
  });

  it('verschachtelt, Schlüssel rekursiv sortiert; Rundlauf über JSON.parse', () => {
    const input = { z: { y: [{ b: true, a: false }], x: 'x' }, a: [null, 0.5] };
    const out = canonicalInputJson(input);
    expect(out).toBe('{"a":[null,0.5],"z":{"x":"x","y":[{"a":false,"b":true}]}}');
    expect(JSON.parse(out)).toEqual(input);
  });
});

describe('Rundung q(x, inv)', () => {
  it.each([
    [0.5, 1, 1],
    [1.5, 1, 2],
    [2.5, 1, 3],
    [-0.5, 1, -1],
    [-1.5, 1, -2],
    [2.0000005, 1e6, 2.000001],
    [0.1 + 0.2, 1e9, 0.3],
    [-2.0000005, 1e6, -2.000001],
  ] as const)('q(%d, %d) = %d exakt', (x, inv, expected) => {
    expect(q(x, inv)).toBe(expected);
  });

  it('roundHalfAwayFromZero ist nicht Bankers Rounding', () => {
    expect([0.5, 1.5, 2.5, -0.5, -2.5].map(roundHalfAwayFromZero)).toEqual([1, 2, 3, -1, -3]);
  });
});

describe('sha256hex', () => {
  it('FIPS-Vektoren', () => {
    expect(sha256hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('UTF-8-Bytes: Umlaut, Emoji und Blockgrenzen wie node:crypto (500 Zufallsfälle)', () => {
    const alphabet = 'aZ0 äöüß€🔭\n"\\';
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 500; i++) {
      const chars = Array.from(alphabet);
      let text = '';
      const len = Math.floor(next() * 150);
      for (let j = 0; j < len; j++) text += chars[Math.floor(next() * chars.length)] ?? '';
      expect(sha256hex(text), JSON.stringify(text)).toBe(
        createHash('sha256').update(text, 'utf8').digest('hex'),
      );
    }
  });

  it('canonicalHash = sha256 der kanonischen Zeichenkette (Pflichtfall mit Umlaut)', () => {
    const input = { projectName: 'Herz-Nebel (Überblick)', id: 'p1' };
    expect(canonicalHash(input)).toBe(
      createHash('sha256').update(canonicalInputJson(input), 'utf8').digest('hex'),
    );
    expect(canonicalInputJson(input)).toBe(
      '{"id":"p1","projectName":"Herz-Nebel (\\u00dcberblick)"}',
    );
  });
});

it('ENGINE_VERSION ist SemVer', () => {
  expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
