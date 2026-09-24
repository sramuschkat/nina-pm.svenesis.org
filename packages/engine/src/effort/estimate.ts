/**
 * Aufwand-Kennzeichen `estimateEffort` (`specs/engine/effort.md`, FK 8.9, FA-PRJ-23; AP-13e): Schätzung
 * unter Idealannahmen (jede Nacht klar, keine Konkurrenz) über `planNight` mit genau einem Projekt für
 * Stichproben-Nächte. Schritt 1 sucht die beste Nacht mit dem **vollen** Bedarf, Schritt 2 schreibt den
 * Bedarf chronologisch fort und rechnet jede Stichprobe mit dem **aktuellen** Rest (ENG-8).
 *
 * Neubau ohne Vorlage (WS-21). Rein und deterministisch: `computedAt` setzt der Aufrufer.
 */
import { daysFromKey, EngineInputError, keyFromDays } from '../astro/time';
import { canonicalInputJson } from '../canonical';
import { sha256hex } from '../hash/sha256';
import { unixFromIso } from '../plan/iso';
import type { NightPlan, PlanInput, PlanLine, PlanScheduler } from '../plan/plan-input';
import { planNight } from '../plan/plan-night';
import { q } from '../round';
import { ENGINE_VERSION } from '../version';
import { buildEligibility } from '../visibility/eligibility';
import { buildNightContext, SLOT_SECONDS } from '../visibility/night-context';

export type EffortTag = 'single_night' | 'multi_night' | 'not_feasible' | 'transit';

/** Höchstzahl Nächte im Zeitraum (FK 8.9). */
export const EFFORT_MAX_NIGHTS = 180;
/** Stichprobenabstand: Server-Job 3, Browser live 5 (nicht 7, ENG-8). */
export const EFFORT_STRIDE_SERVER = 3;
export const EFFORT_STRIDE_BROWSER = 5;

/** Diagnosegründe, die eine Zeile begrenzen können (allocation.md §12, je Zeile). */
const LIMITING_REASONS = new Set([
  'moon_blocked',
  'filter_not_found',
  'below_min_time',
  'not_visible',
  'prefiltered',
  'start_date',
]);

export interface EffortTransitWindow {
  /** Nacht des Transits (Nacht-Schlüssel). */
  readonly night: string;
  readonly windowStartUtc: string;
  readonly windowEndUtc: string;
}

export interface EffortInput {
  /**
   * Genau ein Projekt, Produktivmodus. `night`, `startAtUtc` und `tonight` werden je Stichprobe ersetzt;
   * `timeZoneTransitions` muss den ganzen Zeitraum abdecken.
   */
  readonly plan: PlanInput;
  readonly fromNight: string;
  readonly toNight: string;
  readonly stride: number;
  /** Exoplaneten-Projekt: immer `transit`; `window = null`, solange kein Transit festgelegt ist. */
  readonly exoplanet?: { readonly window: EffortTransitWindow | null } | null;
}

export interface EffortStageHours {
  /** Mondprofil der Stufe (`null` = ohne Mondvermeidung). */
  readonly moonProfileId: string | null;
  readonly filters: readonly string[];
  readonly hours: number;
}

export interface EffortLimitingFactor {
  readonly lineId: string;
  readonly filterShortName: string;
  readonly reason: string | null;
}

export interface EffortResult {
  readonly tag: EffortTag;
  readonly nights: number | null;
  readonly earliestCompletion: string | null;
  readonly achievablePct: number | null;
  readonly requiredHours: number;
  readonly bestNight: string | null;
  readonly bestNightHoursByStage: readonly EffortStageHours[];
  readonly limitingFactor: EffortLimitingFactor | null;
  readonly fullyObservable: boolean | null;
  readonly coveragePct: number | null;
  readonly stride: number;
  /** Gerechnete `planNight`-Läufe (Leistung, effort.md „Leistung“). */
  readonly planRuns: number;
  readonly engineVersion: string;
  readonly inputHash: string;
}

export interface EffortOptions {
  /** Ersatz für `planNight` (Tests mit gleichbleibenden Nächten). */
  readonly planNight?: (input: PlanInput) => NightPlan;
  /** Zwischen zwei Läufen gefragt; `true` bricht mit `EffortAbortedError` ab (Server: > 5 s). */
  readonly shouldAbort?: () => boolean;
}

export class EffortAbortedError extends Error {
  constructor() {
    super('estimateEffort abgebrochen');
    this.name = 'EffortAbortedError';
  }
}

interface LineInfo {
  readonly line: PlanLine;
  readonly need: number;
  readonly ovS: number;
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Planungsbedarf je Zeile (FK 8.4, allocation.md §2). */
export function lineNeed(line: PlanLine, overshootPct: number): number {
  if (!line.enabled) return 0;
  const planned = Math.max(0, line.planned);
  const cap = overshootPct > 0 ? Math.ceil(planned * (overshootPct / 100)) : 0;
  return Math.max(0, planned + cap - line.accepted - line.pending);
}

/** Overhead je Belichtung (allocation.md §2, produktiv, A-4). */
export function overheadPerExposureS(s: PlanScheduler, exposureS: number): number {
  const o = s.overhead;
  const dither = s.ditherEnabled && s.ditherEvery > 0 ? o.ditherSettleS / s.ditherEvery : 0;
  const filter =
    s.filterSwitchEnabled && s.filterSwitchEvery > 0 ? o.filterChangeS / s.filterSwitchEvery : 0;
  const af =
    o.afEveryMin > 0 ? (o.afDurationS * (exposureS + o.downloadS)) / (o.afEveryMin * 60) : 0;
  return o.downloadS + dither + filter + af;
}

/** Stichproben-Nächte `from, from+stride, … ≤ to`. */
export function sampleNights(fromNight: string, toNight: string, stride: number): string[] {
  const a = daysFromKey(fromNight);
  const b = daysFromKey(toNight);
  const out: string[] = [];
  for (let d = a; d <= b; d += stride) out.push(keyFromDays(d));
  return out;
}

function checkInput(input: EffortInput): void {
  if (input.plan.projects.length !== 1)
    throw new EngineInputError('engine.input_invalid', 'estimateEffort braucht genau ein Projekt');
  if (!Number.isInteger(input.stride) || input.stride < 1)
    throw new EngineInputError('engine.input_invalid', 'stride ≥ 1');
  const span = daysFromKey(input.toNight) - daysFromKey(input.fromNight) + 1;
  if (span < 1 || span > EFFORT_MAX_NIGHTS)
    throw new EngineInputError(
      'engine.input_invalid',
      `Zeitraum 1…${String(EFFORT_MAX_NIGHTS)} Nächte`,
    );
}

/** Abgedeckter Anteil des Transitfensters: Slots (Slotmitte im Fenster) mit `CanImage` (FK 8.9). */
function transitCoverage(
  input: EffortInput,
  window: EffortTransitWindow,
): { fullyObservable: boolean; coveragePct: number } {
  const p = input.plan;
  const project = p.projects[0];
  if (!project) return { fullyObservable: false, coveragePct: 0 };
  const ctx = buildNightContext({
    site: { latDeg: p.site.latitudeDeg, lonDeg: p.site.longitudeDeg },
    night: window.night,
    timeZoneTransitions: p.timeZoneTransitions.map((t) => ({
      atUtc: unixFromIso(t.atUtc),
      utcOffsetMinutes: t.utcOffsetMinutes,
    })),
    includeMoon: false,
  });
  const e = buildEligibility(ctx, {
    target: { raJ2000Deg: project.raDeg, decJ2000Deg: project.decDeg },
    twilight: project.twilight,
    minAltDeg: project.minAltitudeDeg,
    startDate: project.startDate,
  });
  const w0 = ctx.times.nightWindow.startUtc;
  const start = unixFromIso(window.windowStartUtc);
  const end = unixFromIso(window.windowEndUtc);
  let total = 0;
  let covered = 0;
  // Fensterteile außerhalb des Nachtfensters zählen als nicht abgedeckt.
  const first = Math.floor((start - w0) / SLOT_SECONDS);
  const last = Math.ceil((end - w0) / SLOT_SECONDS);
  for (let s = first; s < last; s++) {
    const mid = w0 + s * SLOT_SECONDS + SLOT_SECONDS / 2;
    if (mid < start || mid >= end) continue;
    total++;
    if (e.canImage[s] === true) covered++;
  }
  if (total === 0) return { fullyObservable: false, coveragePct: 0 };
  return { fullyObservable: covered === total, coveragePct: Math.floor((100 * covered) / total) };
}

/** Hash der Eingabe (`project.effort_input_hash`): Neuberechnung nur bei Änderung (effort.md). */
export function effortInputHash(input: EffortInput): string {
  return `sha256:${sha256hex(
    canonicalInputJson({
      kind: 'effort',
      engineVersion: ENGINE_VERSION,
      plan: { ...input.plan, night: input.fromNight, startAtUtc: null, tonight: null },
      fromNight: input.fromNight,
      toNight: input.toNight,
      stride: input.stride,
      exoplanet: input.exoplanet ?? null,
    }),
  )}`;
}

export function estimateEffort(
  input: EffortInput,
  options: EffortOptions = {},
): EffortResult | null {
  checkInput(input);
  const run = options.planNight ?? planNight;
  const plan = input.plan;
  const project = plan.projects[0];
  if (!project) return null;
  const sched = plan.scheduler;
  const inputHash = effortInputHash(input);

  const lines: LineInfo[] = [];
  for (const panel of [...project.panels].sort((a, b) => a.index - b.index))
    for (const line of panel.lines)
      lines.push({
        line,
        need: lineNeed(line, sched.overshootPct),
        ovS: overheadPerExposureS(sched, line.exposureS),
      });
  const needTotal = lines.reduce((s, l) => s + l.need, 0);
  const fixS = sched.overhead.slewCenterS + (sched.flip.enabled ? sched.flip.durationS : 0);
  const workS = lines.reduce((s, l) => s + l.need * (l.line.exposureS + l.ovS), 0);

  if (input.exoplanet) {
    const cov = input.exoplanet.window ? transitCoverage(input, input.exoplanet.window) : null;
    return {
      tag: 'transit',
      nights: null,
      earliestCompletion: null,
      achievablePct: null,
      requiredHours: input.exoplanet.window
        ? q(
            (unixFromIso(input.exoplanet.window.windowEndUtc) -
              unixFromIso(input.exoplanet.window.windowStartUtc)) /
              3600,
            10,
          )
        : q(workS / 3600, 10),
      bestNight: input.exoplanet.window?.night ?? null,
      bestNightHoursByStage: [],
      limitingFactor: null,
      fullyObservable: cov?.fullyObservable ?? null,
      coveragePct: cov?.coveragePct ?? null,
      stride: input.stride,
      planRuns: 0,
      engineVersion: ENGINE_VERSION,
      inputHash,
    };
  }
  // Planungsbedarf 0: kein Kennzeichen, die UI zeigt „fertig“ (FA-PRJ-12).
  if (needTotal === 0) return null;

  const samples = sampleNights(input.fromNight, input.toNight, input.stride);
  const lastDay = daysFromKey(input.toNight);
  const reasonCount = new Map<string, Map<string, number>>();
  const projectReasons = new Map<string, number>();
  const cache = new Map<string, NightPlan>();
  let planRuns = 0;

  /** `planNight` nur für dieses Projekt mit Bedarf `rest` (Geplant = Rest, kein Überschuss). */
  const nightPlan = (night: string, rest: readonly number[]): NightPlan => {
    const key = `${night}|${rest.join(',')}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (options.shouldAbort?.() === true) throw new EffortAbortedError();
    let k = 0;
    const restOf = new Map<string, number>();
    for (const l of lines) restOf.set(l.line.id, rest[k++] ?? 0);
    const result = run({
      ...plan,
      night,
      startAtUtc: null,
      tonight: null,
      scheduler: { ...sched, overshootPct: 0 },
      projects: [
        {
          ...project,
          panels: project.panels.map((panel) => ({
            ...panel,
            lines: panel.lines.map((line) => ({
              ...line,
              planned: restOf.get(line.id) ?? 0,
              accepted: 0,
              pending: 0,
            })),
          })),
        },
      ],
    });
    planRuns++;
    cache.set(key, result);
    return result;
  };
  /** Diagnosegründe je Zeile – nur aus der chronologischen Fortschreibung (Schritt 2), die das Ergebnis trägt. */
  const countReasons = (result: NightPlan) => {
    for (const d of result.diagnostics) {
      if (!LIMITING_REASONS.has(d.reason)) continue;
      if (d.lineId === undefined) {
        projectReasons.set(d.reason, (projectReasons.get(d.reason) ?? 0) + 1);
        continue;
      }
      const m = reasonCount.get(d.lineId) ?? new Map<string, number>();
      m.set(d.reason, (m.get(d.reason) ?? 0) + 1);
      reasonCount.set(d.lineId, m);
    }
  };
  /** Belichtungen je Zeile (ohne Bonus) in Zeilenreihenfolge. */
  const capacity = (p: NightPlan): number[] => {
    const byId = new Map<string, number>();
    for (const b of p.blocks)
      for (const e of b.entries)
        if (e.cmd === 'expose' && !e.bonus)
          byId.set(e.exposureLineId, (byId.get(e.exposureLineId) ?? 0) + 1);
    return lines.map((l) => byId.get(l.line.id) ?? 0);
  };
  const needs = lines.map((l) => l.need);
  const covered = (cap: readonly number[], rest: readonly number[]) =>
    cap.reduce((s, c, i) => s + Math.min(c, rest[i] ?? 0), 0);

  // 1) Bestnacht mit dem vollen Bedarf (Gleichstand → frühere Nacht).
  let bestIdx = -1;
  let bestCovered = 0;
  let firstFull: string | null = null;
  for (const [i, night] of samples.entries()) {
    const cap = capacity(nightPlan(night, needs));
    const c = covered(cap, needs);
    if (c > bestCovered) {
      bestCovered = c;
      bestIdx = i;
    }
    if (c >= needTotal && firstFull === null) firstFull = night;
  }
  const bestNight = bestIdx >= 0 ? (samples[bestIdx] ?? null) : null;
  const bestPlan = bestNight !== null ? nightPlan(bestNight, needs) : null;
  const stageHours = bestPlan ? hoursByStage(bestPlan, lines) : [];
  const nBlocks = bestPlan
    ? Math.max(1, bestPlan.blocks.filter((b) => b.projectId === project.id).length)
    : 1;
  const requiredHours = (nights: number) => q((workS + nights * nBlocks * fixS) / 3600, 10);

  /** Begrenzende Zeile `idx` mit dem häufigsten Diagnosegrund aus allen Läufen; ohne Grund `null`. */
  const limiting = (idx: number): EffortLimitingFactor | null => {
    const l = idx >= 0 ? lines[idx] : undefined;
    if (!l) return null;
    const reason = mostFrequent(reasonCount.get(l.line.id)) ?? mostFrequent(projectReasons);
    if (reason === null) return null;
    return { lineId: l.line.id, filterShortName: l.line.filter, reason };
  };
  /** Größter ungedeckter Anteil (Gleichstand → erste Zeile in Zeilenreihenfolge). */
  const largestShare = (uncovered: readonly number[]): number => {
    let idx = -1;
    let share = 0;
    for (const [i, l] of lines.entries()) {
      if (l.need <= 0) continue;
      const s = (uncovered[i] ?? 0) / l.need;
      if (s > share) {
        share = s;
        idx = i;
      }
    }
    return idx;
  };
  const base = {
    bestNight,
    bestNightHoursByStage: stageHours,
    fullyObservable: null,
    coveragePct: null,
    stride: input.stride,
    engineVersion: ENGINE_VERSION,
    inputHash,
  };

  if (bestCovered >= needTotal && firstFull !== null)
    return {
      ...base,
      tag: 'single_night',
      nights: 1,
      earliestCompletion: firstFull,
      achievablePct: null,
      requiredHours: requiredHours(1),
      limitingFactor: null,
      planRuns,
    };

  // 2) Fortschreibung chronologisch mit dem aktuellen Rest.
  const rest = [...needs];
  const restSum = () => rest.reduce((s, r) => s + r, 0);
  /** Nacht (Zählung `nights`), in der der Bedarf einer Zeile gedeckt wurde. */
  const doneAt: number[] = needs.map((n) => (n > 0 ? -1 : 0));
  let nights = 0;
  const take = (cap: readonly number[]): number => {
    let gained = 0;
    for (let i = 0; i < rest.length; i++) {
      const g = Math.min(cap[i] ?? 0, rest[i] ?? 0);
      rest[i] = (rest[i] ?? 0) - g;
      gained += g;
      if (g > 0 && rest[i] === 0) doneAt[i] = nights + 1;
    }
    return gained;
  };
  let earliest: string | null = null;
  outer: for (const night of samples) {
    const sample = nightPlan(night, rest);
    countReasons(sample);
    const c = capacity(sample);
    if (take(c) > 0) nights++;
    if (restSum() === 0) {
      earliest = night;
      break;
    }
    // Nächte zwischen zwei Stichproben mit der Kapazität dieser Stichprobe (höchstens stride − 1).
    const day = daysFromKey(night);
    for (let k = 1; k < input.stride; k++) {
      if (day + k > lastDay) break;
      if (take(c) === 0) break;
      nights++;
      if (restSum() === 0) {
        earliest = keyFromDays(day + k);
        break outer;
      }
    }
  }
  if (restSum() === 0)
    return {
      ...base,
      tag: 'multi_night',
      nights,
      earliestCompletion: earliest,
      achievablePct: null,
      requiredHours: requiredHours(nights),
      // Mehrere Nächte: begrenzend ist die Zeile, deren Bedarf zuletzt gedeckt wurde (Gleichstand → erste).
      limitingFactor: limiting(
        doneAt.reduce((best, d, i) => (d > (doneAt[best] ?? 0) ? i : best), 0),
      ),
      planRuns,
    };
  const needSec = lines.reduce((s, l) => s + l.need * (l.line.exposureS + l.ovS), 0);
  const restSec = lines.reduce((s, l, i) => s + (rest[i] ?? 0) * (l.line.exposureS + l.ovS), 0);
  return {
    ...base,
    tag: 'not_feasible',
    nights,
    earliestCompletion: null,
    achievablePct: needSec > 0 ? Math.floor((100 * (needSec - restSec)) / needSec) : 0,
    requiredHours: requiredHours(Math.max(1, nights)),
    limitingFactor: limiting(largestShare(rest)),
    planRuns,
  };
}

/** Häufigster Grund; Gleichstand → ordinal kleinerer Grund (deterministisch). */
function mostFrequent(m: ReadonlyMap<string, number> | undefined): string | null {
  if (!m) return null;
  let best: string | null = null;
  let n = 0;
  for (const [reason, count] of [...m.entries()].sort(([a], [b]) => ordinal(a, b)))
    if (count > n) {
      best = reason;
      n = count;
    }
  return best;
}

/** Belichtungsstunden der besten Nacht je Mondstufe (Mondprofil der Zeile), Reihenfolge der Zeilen. */
function hoursByStage(plan: NightPlan, lines: readonly LineInfo[]): EffortStageHours[] {
  const lineById = new Map(lines.map((l) => [l.line.id, l.line]));
  const stages = new Map<string, { moonProfileId: string | null; filters: string[]; s: number }>();
  for (const l of lines) {
    const key = l.line.moonProfileId ?? '';
    const st = stages.get(key) ?? { moonProfileId: l.line.moonProfileId, filters: [], s: 0 };
    if (!st.filters.includes(l.line.filter)) st.filters.push(l.line.filter);
    stages.set(key, st);
  }
  for (const b of plan.blocks)
    for (const e of b.entries) {
      if (e.cmd !== 'expose' || e.bonus) continue;
      const line = lineById.get(e.exposureLineId);
      const st = line ? stages.get(line.moonProfileId ?? '') : undefined;
      if (st) st.s += e.exposureS;
    }
  return [...stages.values()].map((st) => ({
    moonProfileId: st.moonProfileId,
    filters: st.filters,
    hours: q(st.s / 3600, 10),
  }));
}
