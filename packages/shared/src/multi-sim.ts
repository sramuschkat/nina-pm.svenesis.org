/**
 * Mehrnacht-Simulation und Auswirkungsvorschau (AP-32a; FA-SIM-04, FA-FRG-05). Rein: dieselbe Engine und
 * derselbe Eingabeweg wie der Planaufbau für NINA (`buildPlanInput` → `planNight`, FA-SIM-05). Je Nacht
 * werden **alle** übergebenen Projekte gemeinsam geplant (Konkurrenz am Rig); die simulierten Frames gehen
 * als `pending` in die nächste Nacht (fortgeschriebener Restbedarf). Mit Wettergewichtung zählen Frames
 * und Stunden einer Nacht mit der Klar-Wahrscheinlichkeit aus der Nachtbewertung (FK 8.5).
 */
import {
  daysFromKey,
  keyFromDays,
  lineNeed,
  planNight,
  type NightPlan,
  type PlanInput,
} from '@nina-pm/engine';
import type { z } from 'zod';
import type { ProjectView, RigView, SiteNightsView } from './contracts';
import type { ImpactResult, MultiSimResult } from './contracts/multi-sim';
import { buildPlanInput, type PlanMoonProfileSource, type PlanTransitSource } from './plan-input';

type Project = z.infer<typeof ProjectView>;
type Rig = z.infer<typeof RigView>;
type Nights = z.infer<typeof SiteNightsView>;
type SimNight = MultiSimResult['nights'][number];
type SimProject = MultiSimResult['projects'][number];

/** Nachtbewertung der Vorhersage (0…1 Mittel, 0…4 Klasse) je Nacht. */
export interface NightWeather {
  readonly nightMean: number | null;
  readonly ratingIndex: number | null;
}

/**
 * Klar-Wahrscheinlichkeit aus der Nachtbewertung (FK 8.5, Klassengrenzen *Gut* 65 % und *Mittel* 45 %,
 * FA-WET-03): ≥ 65 % → 1,0 · 45–65 % → 0,5 · < 45 % → 0,1. Ohne Bewertung 1 (ungewichtet).
 */
export function weatherWeight(nightMean: number | null): number {
  if (nightMean === null) return 1;
  if (nightMean >= 0.65) return 1;
  if (nightMean >= 0.45) return 0.5;
  return 0.1;
}

export interface SimulateNightsInput {
  readonly rig: Rig;
  /** Zu planende Projekte (Auswahl durch den Aufrufer, ohne weitere Filterung nach Freigabe). */
  readonly projects: readonly Project[];
  readonly moonProfiles: readonly PlanMoonProfileSource[];
  /** Nacht-Tabelle des Standorts über den Zeitraum (Zeitzonenwechsel, tzdata). */
  readonly nightsTable: Nights;
  readonly site: {
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly elevationM: number;
  };
  readonly nightFrom: string;
  readonly count: number;
  /** Mit Wettergewichtung: Bewertung je Nacht (fehlende Nächte ungewichtet). */
  readonly weather?: ReadonlyMap<string, NightWeather> | null;
  /** Nur für Tests: Engine austauschen. */
  readonly planNight?: (input: PlanInput) => NightPlan;
  /**
   * Festgelegte Transits je Nacht (wie `POST /plan`, 07.10.2026): Exoplaneten-Projekte plant die Rechnung nur in der
   * Nacht ihres Transits als Transitblock; ohne Transit gar nicht (vorher wie Deep-Sky-Ziele über die ganze Nacht).
   */
  readonly transits?: readonly NightTransit[];
}

/** Festgelegter Transit einer Nacht (`lockedTransits`, transit.md §9). */
export interface NightTransit extends PlanTransitSource {
  readonly night: string;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const EPS = 1e-9;

interface LineState {
  readonly projectId: string;
  readonly filter: string;
  readonly need: number;
  done: number;
}

/** Frames je Zeile und belegte Stunden je Projekt in einem Plan (ohne Bonus-Frames im Bedarf). */
function planUsage(plan: NightPlan) {
  const frames = new Map<string, number>();
  const hours = new Map<string, number>();
  let exposureS = 0;
  for (const b of plan.blocks) {
    const h = Math.max(0, Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 3_600_000;
    hours.set(b.projectId, (hours.get(b.projectId) ?? 0) + h);
    for (const e of b.entries) {
      if (e.cmd === 'expose') {
        exposureS += e.exposureS;
        if (!e.bonus) frames.set(e.exposureLineId, (frames.get(e.exposureLineId) ?? 0) + 1);
      } else if (e.cmd === 'expose_series') {
        const span = Math.max(0, Date.parse(e.untilUtc) - Date.parse(e.atUtc)) / 1000;
        const n = Math.floor(span / e.exposureS);
        exposureS += n * e.exposureS;
        frames.set(e.exposureLineId, (frames.get(e.exposureLineId) ?? 0) + n);
      }
    }
  }
  return { frames, hours, exposureS };
}

/**
 * Erwartete Frames je Zeile und belegte Stunden je Projekt aus einem Nachtplan – dieselbe Zählung wie die Prognose
 * (Transitserien als Anzahl ganzer Belichtungen im Fenster). „Heute Nacht“ nutzt sie für die laufende Nacht mit dem
 * live gerechneten Plan (07.10.2026).
 */
export function nightUsage(plan: NightPlan): {
  lineFrames: Record<string, number>;
  projectHours: Record<string, number>;
} {
  const u = planUsage(plan);
  return {
    lineFrames: Object.fromEntries(u.frames),
    projectHours: Object.fromEntries([...u.hours].map(([id, h]) => [id, round2(h)])),
  };
}

/** Frames je Zeile und belegte Stunden je Projekt einer simulierten Nacht (ungewichtet, Job `forecast`). */
export interface SimNightDetail {
  readonly night: string;
  readonly darkHours: number | null;
  readonly lineFrames: Readonly<Record<string, number>>;
  readonly projectHours: Readonly<Record<string, number>>;
  readonly engineVersion: string;
  readonly inputHash: string;
}

export function simulateNights(input: SimulateNightsInput): {
  nights: SimNight[];
  projects: SimProject[];
  detail: SimNightDetail[];
} {
  const run = input.planNight ?? planNight;
  const candidates = input.projects.filter(
    (p) => p.panels.length > 0 && p.raDeg !== null && p.decDeg !== null,
  );
  const names = new Map(candidates.map((p) => [p.id, p.name]));
  const status = new Map(candidates.map((p) => [p.id, p.approvalStatus]));
  const lines = new Map<string, LineState>();
  const perProject = new Map<
    string,
    { hours: number; frames: number; nightsUsed: number; completesNight: string | null }
  >();
  for (const p of candidates)
    perProject.set(p.id, { hours: 0, frames: 0, nightsUsed: 0, completesNight: null });

  const nights: SimNight[] = [];
  const detail: SimNightDetail[] = [];
  const start = daysFromKey(input.nightFrom);
  for (let i = 0; i < input.count; i += 1) {
    const night = keyFromDays(start + i);
    const pendingByLine: Record<string, number> = {};
    for (const [id, l] of lines) pendingByLine[id] = Math.floor(l.done + EPS);
    const ofNight = (input.transits ?? []).filter((t) => t.night === night);
    const nightCandidates = candidates.filter(
      (p) => p.projectType !== 'exoplanet' || ofNight.some((t) => t.projectId === p.id),
    );
    const planInput = buildPlanInput(
      input.rig,
      nightCandidates,
      input.moonProfiles,
      input.nightsTable,
      {
        night,
        site: input.site,
        selection: 'given',
        pendingByLine,
        transits: ofNight,
      },
    ) as PlanInput;
    // Zeilen beim ersten Auftreten erfassen – Exoplaneten erst in der Nacht ihres Transits.
    for (const p of planInput.projects)
      for (const panel of p.panels)
        for (const l of panel.lines)
          if (!lines.has(l.id))
            lines.set(l.id, {
              projectId: p.id,
              filter: l.filter,
              need: lineNeed({ ...l, pending: 0 }, planInput.scheduler.overshootPct),
              done: 0,
            });
    const plan = run(planInput);
    const w = input.weather?.get(night);
    const weight = input.weather ? weatherWeight(w?.nightMean ?? null) : 1;
    const usage = planUsage(plan);
    for (const [lineId, n] of usage.frames) {
      const l = lines.get(lineId);
      if (!l) continue;
      const add = Math.min(n * weight, Math.max(0, l.need - l.done));
      l.done += add;
      const pp = perProject.get(l.projectId);
      if (pp) pp.frames += add;
    }
    const nightProjects = [...usage.hours.entries()]
      .filter(([id]) => perProject.has(id))
      .map(([projectId, h]) => {
        let frames = 0;
        for (const [lineId, n] of usage.frames)
          if (lines.get(lineId)?.projectId === projectId) frames += n * weight;
        return { projectId, frames: round1(frames), hours: round2(h * weight) };
      })
      .sort((a, b) => b.hours - a.hours || (a.projectId < b.projectId ? -1 : 1));
    for (const np of nightProjects) {
      const pp = perProject.get(np.projectId);
      if (!pp) continue;
      pp.hours += np.hours;
      if (np.hours > 0) pp.nightsUsed += 1;
    }
    for (const [projectId, pp] of perProject) {
      if (pp.completesNight !== null) continue;
      const own = [...lines.values()].filter((l) => l.projectId === projectId);
      const need = own.reduce((s, l) => s + l.need, 0);
      if (need > 0 && own.every((l) => l.done + EPS >= l.need)) pp.completesNight = night;
    }
    const darkFrom = plan.darkness.astronomicalStartUtc;
    const darkTo = plan.darkness.astronomicalEndUtc;
    const exposureHours = round2((usage.exposureS * weight) / 3600);
    const darkHours =
      darkFrom && darkTo
        ? round2(Math.max(0, Date.parse(darkTo) - Date.parse(darkFrom)) / 3_600_000)
        : null;
    detail.push({
      night,
      darkHours,
      lineFrames: Object.fromEntries(usage.frames),
      projectHours: Object.fromEntries([...usage.hours].map(([id, h]) => [id, round2(h)])),
      engineVersion: plan.engineVersion,
      inputHash: plan.inputHash,
    });
    nights.push({
      night,
      darkHours,
      weight,
      ratingIndex: w?.ratingIndex ?? null,
      hasForecast: w !== undefined && w.nightMean !== null,
      exposureHours,
      projects: nightProjects,
    });
  }

  const allHours = [...perProject.values()].reduce((s, p) => s + p.hours, 0);
  const projects: SimProject[] = candidates
    .map((p) => {
      const pp = perProject.get(p.id) ?? {
        hours: 0,
        frames: 0,
        nightsUsed: 0,
        completesNight: null,
      };
      const own = [...lines.values()].filter((l) => l.projectId === p.id);
      const byFilter = new Map<string, { need: number; simulated: number }>();
      for (const l of own) {
        const f = byFilter.get(l.filter) ?? { need: 0, simulated: 0 };
        f.need += l.need;
        f.simulated += l.done;
        byFilter.set(l.filter, f);
      }
      return {
        projectId: p.id,
        name: names.get(p.id) ?? p.id,
        approvalStatus: status.get(p.id) ?? 'approved',
        needFrames: own.reduce((s, l) => s + l.need, 0),
        simulatedFrames: round1(pp.frames),
        hours: round2(pp.hours),
        nightsUsed: pp.nightsUsed,
        completesNight: pp.completesNight,
        sharePct: allHours > 0 ? round1((pp.hours / allHours) * 100) : 0,
        filters: [...byFilter.entries()].map(([filter, f]) => ({
          filter,
          need: f.need,
          simulated: round1(f.simulated),
        })),
      };
    })
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  return { nights, projects, detail };
}

/**
 * Auswirkungsvorschau (FA-FRG-05): Vergleich der Simulation ohne und mit dem Objekt – Anteil des Objekts
 * und Verschiebung von Stunden, Frames und Fertigstellung der übrigen Projekte.
 */
export function impactComparison(
  without: ReturnType<typeof simulateNights>,
  withTarget: ReturnType<typeof simulateNights>,
  targetId: string,
): Pick<ImpactResult, 'target' | 'shifts' | 'hoursWithout' | 'hoursWith'> {
  const before = new Map(without.projects.map((p) => [p.projectId, p]));
  const shifts = withTarget.projects
    .filter((p) => p.projectId !== targetId)
    .map((p) => {
      const b = before.get(p.projectId);
      return {
        projectId: p.projectId,
        name: p.name,
        hoursWithout: b?.hours ?? 0,
        hoursWith: p.hours,
        framesWithout: b?.simulatedFrames ?? 0,
        framesWith: p.simulatedFrames,
        completesWithout: b?.completesNight ?? null,
        completesWith: p.completesNight,
      };
    })
    .sort((a, b) => b.hoursWithout - b.hoursWith - (a.hoursWithout - a.hoursWith));
  // Belegte Blockzeit aller Projekte (wie `hours` je Projekt, inkl. Overhead).
  const sum = (r: ReturnType<typeof simulateNights>) =>
    round2(r.projects.reduce((s, p) => s + p.hours, 0));
  return {
    target: withTarget.projects.find((p) => p.projectId === targetId) ?? null,
    shifts,
    hoursWithout: sum(without),
    hoursWith: sum(withTarget),
  };
}
