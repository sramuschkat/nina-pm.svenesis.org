/**
 * `buildPlanInput` (AP-13c, CC-15/A5-2): der **einzige** Weg von Rig, Projekten, Mondprofilen und
 * Nacht-Tabelle zum `PlanInput` von `planNight`. Reine Funktion ohne Datenbankzugriff – Laden ist Sache der
 * Aufrufer (AP-14a `POST /plan`, AP-13f Simulator). Mengen werden nach ID sortiert
 * (canonical-json.md Regel 3), damit gleiche Daten denselben `inputHash` ergeben.
 */
import type { z } from 'zod';
import type {
  PlanInputDto,
  PlanTonightSchema,
  ProjectView,
  RigView,
  SiteNightsView,
} from './contracts';
import { sortChainKeys, type SortChainKey } from './generated/enums';

type Project = z.infer<typeof ProjectView>;
type Rig = z.infer<typeof RigView>;
type Nights = z.infer<typeof SiteNightsView>;
type Tonight = z.infer<typeof PlanTonightSchema>;

export interface PlanMoonProfileSource {
  readonly id: string;
  readonly separationDeg: number;
  readonly widthDays: number;
  readonly relaxScale: number;
  readonly moonMinAltDeg: number;
  readonly moonMaxAltDeg: number;
  readonly maxIlluminationPct: number;
  readonly moonMustBeDown: boolean;
}

export interface PlanTransitSource {
  readonly projectId: string;
  readonly observationId: string;
  readonly lineId: string;
  readonly windowStartUtc: string;
  readonly windowEndUtc: string;
  readonly lockedAtUtc: string;
}

export interface BuildPlanInputOptions {
  readonly night: string;
  readonly site: {
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly elevationM: number;
  };
  readonly mode?: 'productive' | 'compat';
  readonly startAtUtc?: string | null;
  readonly tonight?: Tonight | null;
  /** Noch nicht quittierte Aufnahmen je Zeile (NT-20, vom Server gezählt). */
  readonly pendingByLine?: Readonly<Record<string, number>>;
  /** Festgelegte Transits dieser Nacht und dieses Rigs (`transit_observation.status = locked`). */
  readonly transits?: readonly PlanTransitSource[];
  /**
   * Trigger „Autofokus nach Zeit“ laut letztem Heartbeat (M7): `null`/fehlt → `afEveryMin = 0`,
   * der Plan enthält dann keine `autofocus_hint`-Einträge.
   */
  readonly autofocusAfterTimeMin?: number | null;
  /**
   * `given`: die übergebenen Projekte unabhängig von Freigabe, Status und Rig planen (Aufwand-Kennzeichen
   * für Entwürfe und Einreichungen, AP-13e); nur Projekte ohne Koordinaten entfallen. Standard `plannable`.
   */
  readonly selection?: 'plannable' | 'given';
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const projectProfileId = (projectId: string) => `project:${projectId}`;

/** Projekte, die in dieser Nacht an diesem Rig geplant werden. */
export function plannableProjects(rigId: string, projects: readonly Project[]): Project[] {
  return projects.filter(
    (p) =>
      p.rigId === rigId &&
      p.deletedAt === null &&
      p.approvalStatus === 'approved' &&
      p.status === 'active' &&
      p.raDeg !== null &&
      p.decDeg !== null,
  );
}

export function buildPlanInput(
  rig: Rig,
  projects: readonly Project[],
  moonProfiles: readonly PlanMoonProfileSource[],
  nights: Nights,
  options: BuildPlanInputOptions,
): PlanInputDto {
  const s = rig.scheduler;
  const confirmed = new Map(
    rig.filterWheel
      .filter(
        (slot) =>
          slot.filterId !== null && slot.ninaFilterName !== null && slot.ninaConfirmedAt !== null,
      )
      .map((slot) => [slot.filterId as string, slot.ninaFilterName as string]),
  );
  const hasFilterWheel = rig.filterWheel.length > 0;
  const transits = new Map((options.transits ?? []).map((t) => [t.projectId, t]));
  const planned = (
    options.selection === 'given'
      ? projects.filter((p) => p.raDeg !== null && p.decDeg !== null)
      : plannableProjects(rig.id, projects)
  ).sort((a, b) => ordinal(a.id, b.id));

  const profiles = new Map<string, PlanMoonProfileSource>();
  const usedProfiles = new Set<string>();
  const byId = new Map(moonProfiles.map((p) => [p.id, p]));

  const planProjects = planned.map((p) => {
    const c = p.conditions;
    const projectProfile: PlanMoonProfileSource | null = c.moonAvoidanceEnabled
      ? {
          id: projectProfileId(p.id),
          separationDeg: c.moonSeparationDeg,
          widthDays: c.moonWidthDays,
          relaxScale: c.moonRelaxScale,
          moonMinAltDeg: c.moonMinAltDeg,
          moonMaxAltDeg: c.moonMaxAltDeg,
          maxIlluminationPct: c.moonMaxIlluminationPct,
          moonMustBeDown: c.moonMustBeDown,
        }
      : null;
    const lineProfile = (mode: string, id: string | null): string | null => {
      if (mode === 'profile' && id !== null && byId.has(id)) {
        usedProfiles.add(id);
        return id;
      }
      if (mode === 'project_default' && projectProfile) {
        profiles.set(projectProfile.id, projectProfile);
        return projectProfile.id;
      }
      return null;
    };
    const transit = transits.get(p.id);
    return {
      id: p.id,
      raDeg: p.raDeg as number,
      decDeg: p.decDeg as number,
      rotationDeg: p.rotationDeg,
      priority: p.priority,
      minAltitudeDeg: c.minAltitudeDeg,
      minTimeOnTargetH: c.minTimeOnTargetH,
      twilight: c.twilight,
      startDate: p.startDate,
      dueDate: p.dueDate,
      panels: [...p.panels]
        .sort((a, b) => a.panelIndex - b.panelIndex)
        .map((panel) => ({
          id: panel.id,
          index: panel.panelIndex,
          raDeg: panel.raDeg,
          decDeg: panel.decDeg,
          rotationDeg: panel.rotationDeg,
          lines: [...panel.lines]
            .sort((a, b) => a.orderIndex - b.orderIndex || ordinal(a.id, b.id))
            .map((l) => ({
              id: l.id,
              filter: l.filterShortName,
              ninaFilterName: l.filterId === null ? null : (confirmed.get(l.filterId) ?? null),
              exposureS: l.exposureS,
              planned: l.plannedCount,
              accepted: l.counters.accepted,
              pending: options.pendingByLine?.[l.id] ?? 0,
              enabled: l.enabled,
              moonProfileId: lineProfile(l.moonMode, l.moonProfileId),
              gain: l.gain,
              offset: l.offsetAdu,
              binning: l.binning,
              readoutMode: l.readoutMode,
            })),
        })),
      transit: transit
        ? {
            observationId: transit.observationId,
            lineId: transit.lineId,
            windowStartUtc: transit.windowStartUtc,
            windowEndUtc: transit.windowEndUtc,
            lockedAtUtc: transit.lockedAtUtc,
          }
        : null,
    };
  });
  for (const id of usedProfiles) {
    const p = byId.get(id);
    if (p) profiles.set(id, p);
  }
  const known = new Set<string>(sortChainKeys);
  const afTrigger = options.autofocusAfterTimeMin ?? null;
  return {
    mode: options.mode ?? 'productive',
    night: options.night,
    site: options.site,
    tzdataVersion: nights.tzdataVersion,
    timeZoneTransitions: nights.timeZoneTransitions.map((t) => ({
      atUtc: t.atUtc,
      utcOffsetMinutes: t.utcOffsetMinutes,
    })),
    rig: {
      id: rig.id,
      hasRotator: rig.hasRotator,
      defaultRotationDeg: rig.defaultRotationDeg,
      rotationToleranceDeg: rig.rotationToleranceDeg,
      hasFilterWheel,
    },
    scheduler: {
      strategy: s.strategy,
      sortChain: s.sortChain.filter((k): k is SortChainKey => known.has(k)),
      bonusEnabled: s.bonusEnabled,
      overshootPct: s.overshootPct,
      mosaicPanelsIndependent: s.mosaicPanelsIndependent,
      ditherEnabled: s.ditherEnabled,
      ditherEvery: s.ditherEvery,
      filterSwitchEnabled: s.filterSwitchEnabled,
      filterSwitchEvery: s.filterSwitchEvery,
      filterSwitchTolerancePct: s.filterSwitchTolerancePct,
      flatsSource: s.flatsSource,
      flip: {
        enabled: s.flipEnabled,
        afterMin: s.flipAfterMeridianMin,
        maxAfterMin: s.flipMaxAfterMeridianMin,
        pauseBeforeMin: s.flipPauseBeforeMeridianMin,
        durationS: s.flipDurationS,
      },
      overhead: { ...s.overhead, afEveryMin: afTrigger === null ? 0 : s.overhead.afEveryMin },
    },
    moonProfiles: [...profiles.values()]
      .sort((a, b) => ordinal(a.id, b.id))
      .map((p) => ({
        id: p.id,
        separationDeg: p.separationDeg,
        widthDays: p.widthDays,
        relaxScale: p.relaxScale,
        moonMinAltDeg: p.moonMinAltDeg,
        moonMaxAltDeg: p.moonMaxAltDeg,
        maxIlluminationPct: p.maxIlluminationPct,
        moonMustBeDown: p.moonMustBeDown,
      })),
    projects: planProjects,
    startAtUtc: options.startAtUtc ?? null,
    tonight: options.tonight ?? null,
  };
}
