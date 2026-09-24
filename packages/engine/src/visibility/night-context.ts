/**
 * Nachtkontext `buildNightContext` (allocation.md §1/§2, night.md §3): Nachtfenster und Zeitmarken aus
 * `nightTimes`, 5-min-Slots, Sonne und Mond an **jeder Slotgrenze** (S + 1 Stützstellen). Ein Slot ist
 * produktiv nur nutzbar, wenn eine Bedingung zu Beginn **und** am Ende gilt (A-26); deshalb werden die
 * Grenzen abgetastet und nicht die Slotmitte.
 */
import { moonAt, sunAt } from '../astro/bodies';
import type { Site } from '../astro/horizon';
import { q } from '../round';
import { jdeFromUnix } from '../astro/time';
import type { TimeZoneTransition } from '../astro/timezone';
import { nightTimes, type NightTimes } from '../astro/twilight';

export const SLOT_SECONDS = 300;

export interface NightContextInput {
  readonly site: Site;
  /** Nacht-Schlüssel `YYYY-MM-DD` (night.md §1). */
  readonly night: string;
  readonly timeZoneTransitions: readonly TimeZoneTransition[];
  readonly flatsSource?: 'panel' | 'sky';
  /** Mond je Slotgrenze rechnen (Standard `true`); die Saisonsuche braucht ihn nicht. */
  readonly includeMoon?: boolean;
}

export interface MoonSample {
  /** Scheinbare topozentrische Höhe des Mittelpunkts, Grad. */
  readonly altDeg: number;
  /** Topozentrisch, unrefraktiert, zum Datum (Grundlage für `sep`, AST-M4). */
  readonly raDeg: number;
  readonly decDeg: number;
  readonly illumPct: number;
  readonly phaseDays: number;
}

export interface NightContext {
  readonly site: Site;
  readonly night: string;
  readonly times: NightTimes;
  /** Slotzahl `S` im Nachtfenster. */
  readonly slotCount: number;
  /** Slotgrenzen `startUtc + k · 300`, `k = 0 … S` (Unix-Sekunden). */
  readonly boundaryUtc: readonly number[];
  /** Geometrische Höhe des Sonnenmittelpunkts je Grenze (Dämmerung, night.md §2). */
  readonly sunAltDeg: readonly number[];
  /** Mond je Slotgrenze; leer, wenn `includeMoon = false`. */
  readonly moon: readonly MoonSample[];
  /** `MoonDown[s]`: scheinbare Mondhöhe ≤ 0° zu Beginn **und** Ende des Slots (allocation.md §2). */
  readonly moonDown: readonly boolean[];
  /** JDE der Fenstermitte – dort wird der scheinbare Ort fester Ziele einmal je Nacht gerechnet. */
  readonly jdeMid: number;
}

export function buildNightContext(input: NightContextInput): NightContext {
  const times = nightTimes({
    site: input.site,
    night: input.night,
    timeZoneTransitions: input.timeZoneTransitions,
    ...(input.flatsSource ? { flatsSource: input.flatsSource } : {}),
  });
  const { startUtc, endUtc } = times.nightWindow;
  const slotCount = (endUtc - startUtc) / SLOT_SECONDS;
  const boundaryUtc: number[] = [];
  const sunAltDeg: number[] = [];
  const moon: MoonSample[] = [];
  for (let k = 0; k <= slotCount; k += 1) {
    const t = startUtc + k * SLOT_SECONDS;
    boundaryUtc.push(t);
    sunAltDeg.push(sunAt(t, input.site).altDeg);
    if (input.includeMoon === false) continue;
    const m = moonAt(t, input.site);
    moon.push({
      altDeg: m.altDeg,
      raDeg: m.raDeg,
      decDeg: m.decDeg,
      illumPct: m.illumPct,
      phaseDays: m.phaseDays,
    });
  }
  // Ohne Mondrechnung gilt kein Slot als „Mond unten“ (die Saisonsuche nutzt MoonDown nicht).
  const down = moon.map((m) => q(m.altDeg, 1e6) <= 0);
  const moonDown: boolean[] = [];
  for (let s = 0; s < slotCount; s += 1) moonDown.push(down[s] === true && down[s + 1] === true);
  return {
    site: input.site,
    night: input.night,
    times,
    slotCount,
    boundaryUtc,
    sunAltDeg,
    moon,
    moonDown,
    jdeMid: jdeFromUnix((startUtc + endUtc) / 2),
  };
}
