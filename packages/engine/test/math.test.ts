/**
 * fdlibm-Port (AP-08a, rules/engine.md Nr. 2): je Funktion ≥ 10.000 Zufallswerte gegen `Math.*`
 * (nur im Test erlaubt). Toleranz |Δ| ≤ 1e-15 für |y| ≤ 1, darüber relativ (|Δ| ≤ 1e-15·|y|) – beide
 * Seiten sind auf < 1 ulp genau, eine absolute Grenze wäre für exp/pow mit großen Ergebnissen sinnlos.
 */
import { describe, expect, it } from 'vitest';
import { math } from '../src/index';

/** Deterministischer Zufall (mulberry32), damit ein Fehlschlag reproduzierbar ist. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 10_000;
const TOL = 1e-15;

function check(
  name: string,
  ours: (...a: number[]) => number,
  ref: (...a: number[]) => number,
  gen: () => number[],
) {
  let worst = 0;
  let worstArgs: number[] = [];
  for (let i = 0; i < N; i++) {
    const args = gen();
    const a = ours(...args);
    const b = ref(...args);
    if (Number.isNaN(b)) {
      expect(Number.isNaN(a), `${name}(${args.join(', ')})`).toBe(true);
      continue;
    }
    if (!Number.isFinite(b)) {
      expect(a, `${name}(${args.join(', ')})`).toBe(b);
      continue;
    }
    const err = Math.abs(a - b) / Math.max(1, Math.abs(b));
    if (err > worst) {
      worst = err;
      worstArgs = args;
    }
  }
  expect(worst, `${name}: größte Abweichung bei (${worstArgs.join(', ')})`).toBeLessThanOrEqual(
    TOL,
  );
}

const r = rng(0x5eed);
const uniform = (lo: number, hi: number) => lo + (hi - lo) * r();
/** Log-gleichverteilt über [10^a, 10^b]. */
const logUniform = (a: number, b: number) => 10 ** uniform(a, b);
const pick = <T>(...xs: T[]) => xs[Math.floor(r() * xs.length)] as T;
const signed = (x: number) => (r() < 0.5 ? -x : x);

/** Winkelargumente: klein, mittel (Cody-Waite) und groß (Payne-Hanek ab ~8,2e5). */
const angle = () => [
  pick(
    () => uniform(-7, 7),
    () => uniform(-1e3, 1e3),
    () => uniform(-1e6, 1e6),
    () => signed(logUniform(6, 22)),
    () => signed(logUniform(-12, 0)),
  )(),
];

describe('fdlibm-Port gegen Math.* (≥ 10.000 Zufallswerte je Funktion)', () => {
  it('sin', () => check('sin', math.sin, Math.sin, angle));
  it('cos', () => check('cos', math.cos, Math.cos, angle));
  it('tan', () => check('tan', math.tan, Math.tan, angle));
  it('asin', () => check('asin', math.asin, Math.asin, () => [uniform(-1, 1)]));
  it('acos', () => check('acos', math.acos, Math.acos, () => [uniform(-1, 1)]));
  it('atan', () =>
    check('atan', math.atan, Math.atan, () => [
      pick(
        () => uniform(-3, 3),
        () => signed(logUniform(-10, 30)),
      )(),
    ]));
  it('atan2', () =>
    check('atan2', math.atan2, Math.atan2, () => [
      pick(
        () => uniform(-10, 10),
        () => signed(logUniform(-20, 20)),
      )(),
      pick(
        () => uniform(-10, 10),
        () => signed(logUniform(-20, 20)),
      )(),
    ]));
  it('exp', () => check('exp', math.exp, Math.exp, () => [uniform(-745, 709.7)]));
  it('log', () =>
    check('log', math.log, Math.log, () => [
      pick(
        () => uniform(0, 10),
        () => logUniform(-310, 308),
      )(),
    ]));
  it('log10', () =>
    check('log10', math.log10, Math.log10, () => [
      pick(
        () => uniform(0, 10),
        () => logUniform(-310, 308),
      )(),
    ]));
  it('pow', () =>
    check('pow', math.pow, Math.pow, () =>
      pick(
        () => [uniform(0, 100), uniform(-20, 20)],
        () => [logUniform(-5, 5), uniform(-60, 60)],
        () => [-uniform(0, 20), Math.trunc(uniform(-30, 30))], // negative Basis, ganzer Exponent
        () => [uniform(0.999, 1.001), signed(logUniform(3, 12))],
      )(),
    ));
  it('fmod', () =>
    check(
      'fmod',
      math.fmod,
      (x, y) => x % y,
      () => [uniform(-1e6, 1e6), signed(uniform(0.1, 400))],
    ));
});

describe('Sonderwerte wie Math.* (Object.is, also auch ±0)', () => {
  const specials = [
    0,
    -0,
    1,
    -1,
    0.5,
    -0.5,
    2,
    Infinity,
    -Infinity,
    NaN,
    Math.PI,
    -Math.PI,
    5e-324,
    1e308,
  ];
  const one: [string, (x: number) => number, (x: number) => number][] = [
    ['sin', math.sin, Math.sin],
    ['cos', math.cos, Math.cos],
    ['tan', math.tan, Math.tan],
    ['asin', math.asin, Math.asin],
    ['acos', math.acos, Math.acos],
    ['atan', math.atan, Math.atan],
    ['exp', math.exp, Math.exp],
    ['log', math.log, Math.log],
    ['log10', math.log10, Math.log10],
  ];
  it.each(one)('%s', (name, ours, ref) => {
    for (const x of specials) {
      const a = ours(x);
      const b = ref(x);
      if (Number.isFinite(b) && b !== 0)
        expect(Math.abs(a - b) / Math.max(1, Math.abs(b)), `${name}(${x})`).toBeLessThanOrEqual(
          TOL,
        );
      else expect(Object.is(a, b), `${name}(${x}) = ${a}, erwartet ${b}`).toBe(true);
    }
  });

  it('atan2 und pow über alle Paare der Sonderwerte', () => {
    for (const y of specials)
      for (const x of specials) {
        for (const [name, ours, ref] of [
          ['atan2', math.atan2, Math.atan2],
          ['pow', math.pow, Math.pow],
        ] as const) {
          const a = ours(y, x);
          const b = ref(y, x);
          if (Number.isFinite(b) && b !== 0)
            expect(
              Math.abs(a - b) / Math.max(1, Math.abs(b)),
              `${name}(${y}, ${x})`,
            ).toBeLessThanOrEqual(TOL);
          else expect(Object.is(a, b), `${name}(${y}, ${x}) = ${a}, erwartet ${b}`).toBe(true);
        }
      }
  });

  it('bekannte Werte', () => {
    expect(math.sin(Math.PI / 6)).toBeCloseTo(0.5, 15);
    expect(math.cos(0)).toBe(1);
    expect(math.atan2(1, 1)).toBe(Math.PI / 4);
    // fdlibm rundet exp(1) auf 2.7182818284590455 – 1 ulp neben Math.E (bekanntes fdlibm-Verhalten).
    expect(Math.abs(math.exp(1) - Math.E)).toBeLessThanOrEqual(Number.EPSILON * Math.E);
    expect(math.log(Math.E)).toBe(1);
    expect(math.pow(2, 10)).toBe(1024);
    expect(math.pow(-2, 3)).toBe(-8);
    expect(math.log10(1000)).toBe(3);
    expect(math.fmod(7.5, 2)).toBe(1.5);
    expect(math.fmod(-7.5, 2)).toBe(-1.5);
  });
});
