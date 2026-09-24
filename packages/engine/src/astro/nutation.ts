/**
 * Nutation und Schiefe der Ekliptik (Meeus Kap. 22, Kurzreihe: Δψ auf 0,5″, Δε auf 0,1″ – die
 * Toleranzen des Referenztests Meeus 22.a). Mittlere Schiefe ε₀ nach Meeus 22.2. Der tote
 * Vorgabewert `OBL = 23.4397°` der Vorlage (`astro-core.js:14`, 13,9″ falsch) wird nie verwendet.
 */
import { cosD, sinD } from './angles';
import { centuries } from './time';

export interface Nutation {
  /** Nutation in Länge, Grad. */
  readonly dpsiDeg: number;
  /** Nutation in Schiefe, Grad. */
  readonly depsDeg: number;
  /** Mittlere Schiefe ε₀, Grad. */
  readonly eps0Deg: number;
  /** Wahre Schiefe ε = ε₀ + Δε, Grad. */
  readonly epsDeg: number;
}

/** Mittlere Schiefe der Ekliptik (Meeus 22.2), Grad; `jde` in TT. */
export function meanObliquityDeg(jde: number): number {
  const t = centuries(jde);
  return 23.4392911 - 0.0130042 * t - 1.64e-7 * t * t + 5.04e-7 * t * t * t;
}

export function nutation(jde: number): Nutation {
  const t = centuries(jde);
  const om = 125.04452 - 1934.136261 * t;
  const l = 280.4665 + 36000.7698 * t;
  const lp = 218.3165 + 481267.8813 * t;
  const dpsi =
    (-17.2 * sinD(om) - 1.32 * sinD(2 * l) - 0.23 * sinD(2 * lp) + 0.21 * sinD(2 * om)) / 3600;
  const deps =
    (9.2 * cosD(om) + 0.57 * cosD(2 * l) + 0.1 * cosD(2 * lp) - 0.09 * cosD(2 * om)) / 3600;
  const eps0 = meanObliquityDeg(jde);
  return { dpsiDeg: dpsi, depsDeg: deps, eps0Deg: eps0, epsDeg: eps0 + deps };
}
