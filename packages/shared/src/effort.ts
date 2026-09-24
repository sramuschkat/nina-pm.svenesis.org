/**
 * Aufwand-Kennzeichen eines Projekts (AP-13e, `specs/engine/effort.md`, FK 8.9): ein Weg für Server-Job
 * (`stride` 3) und Browser-Worker (`stride` 5). Zeitraum ab `currentNight` der Nacht-Tabelle des
 * Standorts (NT-01) bis Wunschzeitraum- bzw. Saisonende; Saisonsuche über die Tabelle (≤ 210 Nächte,
 * reicht für 180 Nächte plus die Pause von 30 Nächten).
 */
import {
  EFFORT_MAX_NIGHTS,
  effortInputHash,
  effortPeriod,
  ENGINE_VERSION,
  estimateEffort,
  SEASON_PAUSE_NIGHTS,
  seasonWindow,
  unixFromIso,
  type EffortOptions,
  type EffortResult,
  type EffortTransitWindow,
  type PlanInput,
} from '@nina-pm/engine';
import type { z } from 'zod';
import type { EffortView, ProjectView, RigView, SiteNightsView } from './contracts';
import { buildPlanInput, type PlanMoonProfileSource } from './plan-input';

type Project = z.infer<typeof ProjectView>;
type Rig = z.infer<typeof RigView>;
type Nights = z.infer<typeof SiteNightsView>;

export interface ProjectEffortOptions extends EffortOptions {
  readonly site: {
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly elevationM: number;
  };
  /** Nacht-Tabelle ab `currentNight` (≥ 210 Nächte für die Saisonsuche, sonst kürzer gerechnet). */
  readonly nights: Nights;
  readonly stride: number;
  /** Zeitpunkt der Berechnung (ISO mit `Z`) – die Engine selbst kennt keine Uhr. */
  readonly computedAt: string;
  /** Festgelegtes Transitfenster eines Exoplaneten-Projekts (ab R4); fehlt es, bleibt die Abdeckung offen. */
  readonly transitWindow?: EffortTransitWindow | null;
}

export interface ProjectEffort {
  readonly view: EffortView;
  readonly inputHash: string;
  readonly planRuns: number;
}

const SEASON_SEARCH_NIGHTS = EFFORT_MAX_NIGHTS + SEASON_PAUSE_NIGHTS;

/** Eingabe für `estimateEffort`; `null` ohne Koordinaten. Exportiert für Tests und den Hash-Vergleich. */
export function projectEffortInput(
  project: Project,
  rig: Rig,
  moonProfiles: readonly PlanMoonProfileSource[],
  options: Pick<ProjectEffortOptions, 'site' | 'nights'>,
): { plan: PlanInput; fromNight: string; toNight: string } | null {
  if (project.raDeg === null || project.decDeg === null) return null;
  const today = options.nights.currentNight;
  const dto = buildPlanInput(rig, [project], moonProfiles, options.nights, {
    night: today,
    site: options.site,
    selection: 'given',
  });
  const c = project.conditions;
  const keys = options.nights.nights
    .map((n) => n.night)
    .filter((n) => n >= today)
    .slice(0, SEASON_SEARCH_NIGHTS);
  const season = seasonWindow({
    site: { latDeg: options.site.latitudeDeg, lonDeg: options.site.longitudeDeg },
    nights: keys,
    timeZoneTransitions: options.nights.timeZoneTransitions.map((t) => ({
      atUtc: unixFromIso(t.atUtc),
      utcOffsetMinutes: t.utcOffsetMinutes,
    })),
    target: { raJ2000Deg: project.raDeg, decJ2000Deg: project.decDeg },
    twilight: c.twilight,
    minAltDeg: c.minAltitudeDeg,
    minTimeSec: c.minTimeOnTargetH * 3600,
    startDate: project.startDate,
  });
  const period = effortPeriod({
    currentNight: today,
    requestFrom: project.requestPeriodFrom,
    requestTo: project.requestPeriodTo,
    seasonEnd: season.seasonEnd,
  });
  return { plan: dto as PlanInput, ...period };
}

export function projectEffort(
  project: Project,
  rig: Rig,
  moonProfiles: readonly PlanMoonProfileSource[],
  options: ProjectEffortOptions,
): ProjectEffort | null {
  const input = projectEffortInput(project, rig, moonProfiles, options);
  if (!input) return null;
  const exoplanet =
    project.projectType === 'exoplanet' ? { window: options.transitWindow ?? null } : null;
  const effortInput = { ...input, stride: options.stride, exoplanet };
  const result = estimateEffort(effortInput, {
    ...(options.planNight ? { planNight: options.planNight } : {}),
    ...(options.shouldAbort ? { shouldAbort: options.shouldAbort } : {}),
  });
  const base = {
    fromNight: input.fromNight,
    toNight: input.toNight,
    stride: options.stride,
    computedAt: options.computedAt,
  };
  if (result === null)
    return {
      view: {
        ...base,
        tag: null,
        nights: null,
        earliestCompletion: null,
        achievablePct: null,
        requiredHours: null,
        bestNight: null,
        bestNightHoursByStage: [],
        limitingFactor: null,
        fullyObservable: null,
        coveragePct: null,
        engineVersion: ENGINE_VERSION,
      },
      inputHash: effortInputHash(effortInput),
      planRuns: 0,
    };
  return { view: toView(result, base), inputHash: result.inputHash, planRuns: result.planRuns };
}

function toView(
  r: EffortResult,
  base: Pick<EffortView, 'fromNight' | 'toNight' | 'stride' | 'computedAt'>,
): EffortView {
  return {
    ...base,
    tag: r.tag,
    nights: r.nights,
    earliestCompletion: r.earliestCompletion,
    achievablePct: r.achievablePct,
    requiredHours: r.requiredHours,
    bestNight: r.bestNight,
    bestNightHoursByStage: r.bestNightHoursByStage.map((s) => ({ ...s, filters: [...s.filters] })),
    limitingFactor: r.limitingFactor
      ? {
          lineId: r.limitingFactor.lineId,
          filterShortName: r.limitingFactor.filterShortName,
          reason: r.limitingFactor.reason as NonNullable<EffortView['limitingFactor']>['reason'],
        }
      : null,
    fullyObservable: r.fullyObservable,
    coveragePct: r.coveragePct,
    engineVersion: r.engineVersion,
  };
}
