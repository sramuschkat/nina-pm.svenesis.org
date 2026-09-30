/**
 * Transitvorhersage für eine Nacht (transit.md §2, FK 8.7, FA-EXO-10…12; AP-41). Alle Größen bis zum Fenster in
 * BJD_TDB und Tagen, danach **ausschließlich UTC** (AST-T1): `Tc_utc = bjdTdbToJdUtc(Tc_bjd)` ist Pflicht.
 *
 * - Kandidaten `n` um `n0 = q((BJD(Nachtmitte) − T0)/P, 1)` nach beiden Seiten, solange `Tc_utc` im Suchintervall
 *   `[nachtBeginn − halbeBreite, nachtEnde + halbeBreite]` liegt – bei Ultrakurzperioden mehrere je Nacht.
 * - `σ = |n|·σP + σT0 + ocSigmaMin/1440`, Puffer `max(k·σ, 5 min)`; `ocMin` verschiebt die Mitte nur bei
 *   `|ocMin| > 3·ocSigmaMin` (AST-T4).
 * - Baseline je Seite `clamp(round(30·T14[h]), 30, 120)` min (AST-T13), bei unsicherer Ephemeride mindestens `k·σ`.
 * - Ephemeridenalter (AST-T9): `ok` / `uncertain` (Warnung) / `stale` (`409 transit.ephemeris_stale`).
 * - Zeitsystem `unknown`: Fenster je Seite 10 min breiter.
 * - Beobachtbar (AST-T19): Sonne (geometrisch) unter der Dämmerungsgrenze und scheinbare Höhe ≥ Mindesthöhe an
 *   `Tc − k·σ`, `Tc`, `Tc + k·σ`; vollständig, wenn jeder 5-min-Slot des Fensters an Beginn **und** Ende besteht
 *   (A-26), sonst Anteil. Slots auf dem festen 300-s-Raster, damit die Suche Sonne und Sternzeit über alle Planeten
 *   einer Nacht teilen kann (`TransitSkyCache`).
 */
import { norm180 } from '../astro/angles';
import { altAz, apparentAltitudeDeg, type Site } from '../astro/horizon';
import { jdFromUnix, jdeFromUnix, unixFromJd } from '../astro/time';
import { meridianTransitUtc, targetApparent } from '../astro/target';
import { q, roundHalfAwayFromZero } from '../round';
import { bjdTdbToJdUtc, jdUtcToBjdTdb } from './barycentric';
import { UNKNOWN_TIME_SYSTEM_BUFFER_MIN, type ExoTimeSystem } from './epoch';
import { createTransitSkyCache, type TransitSkyCache } from './sky-cache';

export { createTransitSkyCache, type TransitSkyCache } from './sky-cache';

const DAY_S = 86400;
const SLOT_S = 300;
/** Untergrenze des Puffers (AST-T4). */
export const MIN_BUFFER_MIN = 5;
/** Schwelle „Baseline in der Dämmerung“: Exoplaneten-Projekte planen mit astronomischer Dämmerung (transit.md §2). */
export const TRANSIT_DARK_DEG = -18;

export interface TransitEphemeris {
  /** Epoche BJD_TDB (nach `normalizeEpoch`). */
  readonly t0BjdTdb: number;
  readonly periodD: number;
  readonly t0SigmaD: number | null;
  readonly periodSigmaD: number | null;
  /** T14 in Stunden. */
  readonly durationH: number;
  readonly ocMin: number | null;
  readonly ocSigmaMin: number | null;
  readonly timeSystem: ExoTimeSystem;
  /** ICRS/J2000 – für Rømer **und** Höhe (die Höhe präzessiert selbst). */
  readonly raDeg: number;
  readonly decDeg: number;
}

export interface TransitSearchInput {
  readonly ephemeris: TransitEphemeris;
  readonly site: Site;
  /** Nachtfenster (FK 8.1), Unix-Sekunden UTC. */
  readonly nightStartUtc: number;
  readonly nightEndUtc: number;
  /** Geometrische Sonnenhöhe der Dämmerungsgrenze, z. B. −12 (Suche) oder −18 (Projekt). */
  readonly twilightDeg: number;
  readonly minAltDeg: number;
  /** Puffer in σ (FA-EXO-12), Standard 1. */
  readonly k?: 1 | 2 | 3;
  /** Baseline je Seite in Minuten; ohne Angabe dauerabhängig (AST-T13). */
  readonly baselineBeforeMin?: number;
  readonly baselineAfterMin?: number;
}

export type EphemerisAge = 'ok' | 'uncertain' | 'stale';

export interface TransitEvent {
  /** Epochennummer seit `T0`. */
  readonly n: number;
  readonly tcBjdTdb: number;
  /** Transitmitte, Kontakte und Fenster in Unix-Sekunden UTC (ganze Sekunden; Fenster nach außen gerundet). */
  readonly tcUtc: number;
  readonly ingressUtc: number;
  readonly egressUtc: number;
  readonly windowStartUtc: number;
  readonly windowEndUtc: number;
  /** 1σ der Mitte in Sekunden (FA-EXO-12) und Puffer je Seite. */
  readonly sigmaS: number;
  readonly bufferS: number;
  readonly baselineBeforeMin: number;
  readonly baselineAfterMin: number;
  /** Angewandte O−C (Minuten) oder `null`. */
  readonly ocAppliedMin: number | null;
  readonly timeSystemUncertain: boolean;
  readonly ephemerisAge: EphemerisAge;
  /** Beobachtbar an `Tc − k·σ`, `Tc`, `Tc + k·σ` (AST-T19). */
  readonly observable: boolean;
  /** Anteil der 5-min-Slots des Fensters, in denen das Ziel nutzbar ist (0…1, 3 Stellen). */
  readonly usableFraction: number;
  readonly fullyObservable: boolean;
  /** Fensterbeginn bzw. -ende nutzbar (Filter „Start/Ende in Dunkelheit und über Mindesthöhe“, FA-EXO-05). */
  readonly startUsable: boolean;
  readonly endUsable: boolean;
  /**
   * Für die Filter „Start/Ende dunkel“ und „Start/Ende über Mindesthöhe“ (FA-EXO-05, S-22): geprüft an **Ingress
   * und Egress**, nicht an den Fenstergrenzen (Spec-Ergänzung 30.09.2026, Entscheidung Sven, wie Astro PM).
   */
  readonly startDark: boolean;
  readonly endDark: boolean;
  readonly startAboveMinAlt: boolean;
  readonly endAboveMinAlt: boolean;
  /** Ein nutzbarer Slot hat die Sonne zwischen −18° und der Dämmerungsgrenze („Baseline in der Dämmerung“). */
  readonly baselineInTwilight: boolean;
  /** Obere Kulmination in der Nacht (FA-EXO-11) und ob sie im Fenster (inkl. Baseline) liegt – Markierung rot. */
  readonly meridianUtc: number | null;
  readonly meridianInWindow: boolean;
  /** Kulmination zwischen Ingress und Egress – Filter „Transits mit Flip ausblenden“ (Entscheidung Sven 30.09.2026). */
  readonly meridianInTransit: boolean;
  /** Scheinbare Höhe zur Mitte, Grad (6 Stellen). */
  readonly altAtCenterDeg: number;
  /** Scheinbare Höhe bei Ingress und Egress, Grad (FA-EXO-13 „Kontaktzeiten mit Höhen“). */
  readonly altAtIngressDeg: number;
  readonly altAtEgressDeg: number;
  readonly leapTableExpired: boolean;
}

/** Baseline je Seite in Minuten: T14/2, mindestens 30, höchstens 120 (AST-T13). */
export function defaultBaselineMin(durationH: number): number {
  return Math.min(120, Math.max(30, roundHalfAwayFromZero(30 * durationH)));
}

/** 1σ der Mitte in Tagen bei Epoche `n` (transit.md §2); fehlende Fehler zählen 0. */
export function transitSigmaD(e: TransitEphemeris, n: number): number {
  return Math.abs(n) * (e.periodSigmaD ?? 0) + (e.t0SigmaD ?? 0) + (e.ocSigmaMin ?? 0) / 1440;
}

/** O−C in Minuten, wenn sie signifikant ist (`|ocMin| > 3·ocSigmaMin`), sonst `null`. */
export function appliedOcMin(e: TransitEphemeris): number | null {
  if (e.ocMin === null || e.ocSigmaMin === null) return null;
  return Math.abs(e.ocMin) > 3 * e.ocSigmaMin ? e.ocMin : null;
}

/** Ephemeridenalter aus `k·σ` und T14 (AST-T9). */
export function ephemerisAge(kSigmaMin: number, durationH: number): EphemerisAge {
  const t14Min = durationH * 60;
  if (kSigmaMin > t14Min) return 'stale';
  if (kSigmaMin <= 0.5 * t14Min && kSigmaMin <= 30) return 'ok';
  return 'uncertain';
}

interface Geometry {
  readonly n: number;
  readonly tcBjd: number;
  readonly tcUtcJd: number;
  readonly sigmaD: number;
  readonly bufferD: number;
  readonly halfD: number;
  readonly leapTableExpired: boolean;
}

function geometry(e: TransitEphemeris, n: number, k: number, extraD: number): Geometry {
  const oc = appliedOcMin(e) ?? 0;
  const tcBjd = e.t0BjdTdb + n * e.periodD + oc / 1440;
  const utc = bjdTdbToJdUtc(tcBjd, e.raDeg, e.decDeg);
  const sigmaD = transitSigmaD(e, n);
  const bufferD = Math.max(k * sigmaD, MIN_BUFFER_MIN / 1440);
  return {
    n,
    tcBjd,
    tcUtcJd: utc.jdUtc,
    sigmaD,
    bufferD,
    // Suchbereich der Kandidaten: Puffer höchstens T14 – darüber ist die Ephemeride ohnehin „stale“, und ein
    // Puffer von Tagen machte aus jedem Umlauf der Umgebung einen Kandidaten (Fehler prod 30.09.2026).
    halfD: e.durationH / 48 + Math.min(bufferD, e.durationH / 24) + extraD,
    leapTableExpired: utc.leapTableExpired,
  };
}

export function predictTransits(
  input: TransitSearchInput,
  cache: TransitSkyCache = createTransitSkyCache(input.site),
): TransitEvent[] {
  const e = input.ephemeris;
  if (!(e.periodD > 0) || !(e.durationH > 0)) return [];
  const k = input.k ?? 1;
  const unknown = e.timeSystem === 'unknown' || e.timeSystem === 'jd_utc';
  const unknownD = unknown ? UNKNOWN_TIME_SYSTEM_BUFFER_MIN / 1440 : 0;
  const baseBefore = input.baselineBeforeMin ?? defaultBaselineMin(e.durationH);
  const baseAfter = input.baselineAfterMin ?? defaultBaselineMin(e.durationH);
  const extraD = Math.max(baseBefore, baseAfter) / 1440 + unknownD;

  const fromJd = jdFromUnix(input.nightStartUtc);
  const toJd = jdFromUnix(input.nightEndUtc);
  const midBjd = jdUtcToBjdTdb((fromJd + toJd) / 2, e.raDeg, e.decDeg);
  const n0 = q((midBjd - e.t0BjdTdb) / e.periodD, 1);
  const inRange = (g: Geometry) => g.tcUtcJd >= fromJd - g.halfD && g.tcUtcJd <= toJd + g.halfD;

  const found: Geometry[] = [];
  // Rückwärts bis vor das Suchintervall, dann vorwärts; `n0` selbst liegt ggf. außerhalb (lange Perioden).
  for (let n = n0; ; n -= 1) {
    const g = geometry(e, n, k, extraD);
    if (g.tcUtcJd < fromJd - g.halfD) break;
    if (inRange(g)) found.unshift(g);
  }
  for (let n = n0 + 1; ; n += 1) {
    const g = geometry(e, n, k, extraD);
    if (g.tcUtcJd > toJd + g.halfD) break;
    if (inRange(g)) found.push(g);
  }
  return found.map((g) => event(input, cache, g, k, baseBefore, baseAfter, unknownD));
}

function event(
  input: TransitSearchInput,
  cache: TransitSkyCache,
  g: Geometry,
  k: number,
  baseBefore: number,
  baseAfter: number,
  unknownD: number,
): TransitEvent {
  const e = input.ephemeris;
  const t14D = e.durationH / 24;
  const kSigmaMin = k * g.sigmaD * 1440;
  const age = ephemerisAge(kSigmaMin, e.durationH);
  // Unsichere Ephemeride: Baseline auf k·σ erhöhen (AST-T9).
  const before = age === 'uncertain' ? Math.max(baseBefore, kSigmaMin) : baseBefore;
  const after = age === 'uncertain' ? Math.max(baseAfter, kSigmaMin) : baseAfter;
  const ingressJd = g.tcUtcJd - t14D / 2;
  const egressJd = g.tcUtcJd + t14D / 2;
  const startJd = ingressJd - g.bufferD - before / 1440 - unknownD;
  const endJd = egressJd + g.bufferD + after / 1440 + unknownD;
  const startUtc = Math.floor(unixFromJd(startJd));
  const endUtc = Math.ceil(unixFromJd(endJd));
  const tcUtc = unixFromJd(g.tcUtcJd);
  const ingressUtc = unixFromJd(ingressJd);
  const egressUtc = unixFromJd(egressJd);

  // Scheinbarer Ort einmal zur Mitte (ändert sich über ein Fenster um < 0,01″).
  const place = targetApparent({ raJ2000Deg: e.raDeg, decJ2000Deg: e.decDeg }, jdeFromUnix(tcUtc));
  const alt = (t: number) =>
    apparentAltitudeDeg(
      altAz(norm180(cache.lstDeg(t) - place.raDeg), place.decDeg, input.site.latDeg).altDeg,
    );
  const sunLimit = q(input.twilightDeg, 1e6);
  const minAlt = q(input.minAltDeg, 1e6);
  const dark = (t: number) => q(cache.sunAltDeg(t), 1e6) < sunLimit;
  const high = (t: number) => q(alt(t), 1e6) >= minAlt;
  const ok = (t: number) => dark(t) && high(t);

  const kSigmaS = k * g.sigmaD * DAY_S;
  const observable = ok(tcUtc - kSigmaS) && ok(tcUtc) && ok(tcUtc + kSigmaS);

  // Slots auf dem 300-s-Raster, die das Fenster schneiden; Test an Beginn und Ende (A-26). Geprüft wird nur
  // innerhalb des Nachtfensters (FK 8.1): davor und danach steht die Sonne über der bürgerlichen Dämmerung, die
  // Slots zählen dort als nicht nutzbar. Sonst prüfte ein Fenster mit großer Unsicherheit (Tage bis Jahre)
  // Millionen Slots (Fehler prod 30.09.2026).
  const first = Math.floor(startUtc / SLOT_S) * SLOT_S;
  const slots = Math.ceil((endUtc - first) / SLOT_S);
  const from = Math.max(first, Math.floor(input.nightStartUtc / SLOT_S) * SLOT_S);
  const to = Math.min(endUtc, input.nightEndUtc);
  let usable = 0;
  let twilight = false;
  let prevOk = ok(from);
  for (let s = from; s < to; s += SLOT_S) {
    const nextOk = ok(s + SLOT_S);
    if (prevOk && nextOk) {
      usable += 1;
      if (cache.sunAltDeg(s) >= TRANSIT_DARK_DEG || cache.sunAltDeg(s + SLOT_S) >= TRANSIT_DARK_DEG)
        twilight = true;
    }
    prevOk = nextOk;
  }
  const meridian = meridianTransitUtc(
    { raJ2000Deg: e.raDeg, decJ2000Deg: e.decDeg },
    input.site,
    input.nightStartUtc,
    input.nightEndUtc,
  );
  return {
    n: g.n,
    tcBjdTdb: g.tcBjd,
    tcUtc: q(tcUtc, 1),
    ingressUtc: q(unixFromJd(ingressJd), 1),
    egressUtc: q(unixFromJd(egressJd), 1),
    windowStartUtc: startUtc,
    windowEndUtc: endUtc,
    sigmaS: q(g.sigmaD * DAY_S, 1),
    bufferS: q(g.bufferD * DAY_S, 1),
    baselineBeforeMin: q(before, 1),
    baselineAfterMin: q(after, 1),
    ocAppliedMin: appliedOcMin(e),
    timeSystemUncertain: unknownD > 0,
    ephemerisAge: age,
    observable,
    usableFraction: slots === 0 ? 0 : q(usable / slots, 1e3),
    fullyObservable: slots > 0 && usable === slots,
    startUsable: ok(startUtc),
    endUsable: ok(endUtc),
    startDark: dark(ingressUtc),
    endDark: dark(egressUtc),
    startAboveMinAlt: high(ingressUtc),
    endAboveMinAlt: high(egressUtc),
    baselineInTwilight: twilight,
    meridianUtc: meridian,
    meridianInWindow: meridian !== null && meridian >= startUtc && meridian <= endUtc,
    meridianInTransit: meridian !== null && meridian >= ingressUtc && meridian <= egressUtc,
    altAtCenterDeg: q(alt(tcUtc), 1e6),
    altAtIngressDeg: q(alt(unixFromJd(ingressJd)), 1e6),
    altAtEgressDeg: q(alt(unixFromJd(egressJd)), 1e6),
    leapTableExpired: g.leapTableExpired,
  };
}
