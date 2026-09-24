/**
 * Ein- und Ausgabe von `planNight` (TK 7.6, 8.2; `specs/engine/allocation.md` §1). Der zod-Vertrag steht
 * in `packages/shared/src/contracts/plan.ts` und muss zu diesen Typen passen; gebaut wird `PlanInput`
 * ausschließlich von `buildPlanInput` (packages/shared). Zeitpunkte als ISO-8601 mit `Z`, ganze Sekunden
 * (canonical-json.md Regel 8); Winkel in Grad.
 */
import type { GridMode, SortChainKey } from './grid';

export type TwilightName = 'civil' | 'nautical' | 'astronomical';

export interface PlanMoonProfile {
  readonly id: string;
  readonly separationDeg: number;
  readonly widthDays: number;
  readonly relaxScale: number;
  readonly moonMinAltDeg: number;
  readonly moonMaxAltDeg: number;
  readonly maxIlluminationPct: number;
  readonly moonMustBeDown: boolean;
}

export interface PlanLine {
  readonly id: string;
  /** Kurzname des Filters (Anzeige, Filterzyklus). */
  readonly filter: string;
  /** Bestätigter NINA-Filtername; `null` = nicht zugeordnet (NT-E1). */
  readonly ninaFilterName: string | null;
  readonly exposureS: number;
  readonly planned: number;
  readonly accepted: number;
  /** Noch nicht quittierte Aufnahmen (NT-20), mindern den Planungsbedarf. */
  readonly pending: number;
  readonly enabled: boolean;
  /** Mondprofil (auch das synthetische Projektprofil); `null` = ohne Mondvermeidung. */
  readonly moonProfileId: string | null;
  readonly gain: number | null;
  readonly offset: number | null;
  readonly binning: number;
  readonly readoutMode: string | null;
}

export interface PlanPanel {
  readonly id: string;
  readonly index: number;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly lines: readonly PlanLine[];
}

export interface PlanTransit {
  readonly observationId: string;
  readonly lineId: string;
  readonly windowStartUtc: string;
  readonly windowEndUtc: string;
  readonly lockedAtUtc: string;
}

export interface PlanProject {
  readonly id: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  /** 1 = höchste, 0 = ohne. */
  readonly priority: number;
  readonly minAltitudeDeg: number;
  readonly minTimeOnTargetH: number;
  readonly twilight: TwilightName;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly panels: readonly PlanPanel[];
  readonly transit: PlanTransit | null;
}

export interface PlanScheduler {
  readonly strategy: 'proportional' | 'manual_priority';
  readonly sortChain: readonly SortChainKey[];
  readonly bonusEnabled: boolean;
  readonly overshootPct: number;
  readonly mosaicPanelsIndependent: boolean;
  readonly ditherEnabled: boolean;
  readonly ditherEvery: number;
  readonly filterSwitchEnabled: boolean;
  readonly filterSwitchEvery: number;
  readonly filterSwitchTolerancePct: number;
  readonly flatsSource: 'panel' | 'sky';
  readonly flip: {
    readonly enabled: boolean;
    readonly afterMin: number;
    readonly maxAfterMin: number;
    readonly pauseBeforeMin: number;
    readonly durationS: number;
  };
  readonly overhead: {
    readonly slewCenterS: number;
    readonly filterChangeS: number;
    readonly ditherSettleS: number;
    /** `0` = aus; nur gesetzt, wenn NINA einen Trigger „Autofokus nach Zeit“ hat (M7). */
    readonly afEveryMin: number;
    readonly afDurationS: number;
    readonly downloadS: number;
  };
}

export interface PlanTonight {
  readonly pastBlocks: readonly {
    readonly unitId: string;
    readonly fromUtc: string;
    readonly toUtc: string;
  }[];
  readonly exposedSecByUnit: Readonly<Record<string, number>>;
  readonly lastAutofocusUtc: string | null;
  readonly filterCycle: readonly {
    readonly unitId: string;
    readonly lineId: string;
    readonly subsOnLine: number;
  }[];
  readonly flipDoneByPanel: Readonly<Record<string, boolean>>;
  readonly currentUnitId: string | null;
}

export interface PlanInput {
  /** Einziges Modusfeld (allocation.md §11.1). */
  readonly mode: GridMode;
  readonly night: string;
  readonly site: {
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly elevationM: number;
  };
  readonly tzdataVersion: string;
  readonly timeZoneTransitions: readonly {
    readonly atUtc: string;
    readonly utcOffsetMinutes: number;
  }[];
  readonly rig: {
    readonly id: string;
    readonly hasRotator: boolean;
    /** Kamerawinkel ohne Rotator (NT-30). */
    readonly defaultRotationDeg: number | null;
    readonly rotationToleranceDeg: number;
    /** Rig mit Filterrad: Zeilen ohne `ninaFilterName` nehmen nicht teil (NT-E1). */
    readonly hasFilterWheel: boolean;
  };
  readonly scheduler: PlanScheduler;
  readonly moonProfiles: readonly PlanMoonProfile[];
  readonly projects: readonly PlanProject[];
  /** Neuplanung: Uhrstart; `null` = Erstplan. */
  readonly startAtUtc: string | null;
  readonly tonight: PlanTonight | null;
}

export type PlanEntry =
  | {
      readonly seq: number;
      readonly cmd: 'slew_center' | 'slew_center_rotate';
      readonly atUtc: string;
      readonly durationS: number;
    }
  | {
      readonly seq: number;
      readonly cmd: 'filter';
      readonly atUtc: string;
      readonly durationS: number;
      readonly filter: string;
    }
  | {
      readonly seq: number;
      readonly cmd: 'expose';
      readonly atUtc: string;
      readonly exposureLineId: string;
      readonly filter: string;
      readonly exposureS: number;
      readonly gain: number | null;
      readonly offset: number | null;
      readonly binning: number;
      readonly readoutMode: string | null;
      readonly bonus: boolean;
      readonly lastOfNight: boolean;
    }
  | {
      readonly seq: number;
      readonly cmd: 'expose_series';
      readonly atUtc: string;
      readonly untilUtc: string;
      readonly exposureLineId: string;
      readonly filter: string;
      readonly exposureS: number;
      readonly gain: number | null;
      readonly offset: number | null;
      readonly binning: number;
      readonly readoutMode: string | null;
    }
  | {
      readonly seq: number;
      readonly cmd: 'dither' | 'autofocus_hint' | 'wait' | 'meridian_flip';
      readonly atUtc: string;
      readonly durationS: number;
    }
  | { readonly seq: number; readonly cmd: 'end'; readonly atUtc: string };

export interface PlanBlock {
  readonly id: string;
  readonly kind: 'regular' | 'transit';
  readonly projectId: string;
  readonly panelId: string | null;
  readonly transitObservationId: string | null;
  readonly startUtc: string;
  readonly endUtc: string;
  /** Aufwärtsdurchgang der eigenen Dämmerungsgrenze (M4); durchgehend dunkel → Nachtfensterende. */
  readonly twilightEndUtc: string | null;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly rotationMode: 'rotator' | 'fixed_camera';
  /** Meridian-Flip am Block (AP-13d); bis dahin `null`. */
  readonly meridianFlip: null | {
    readonly waitStartUtc: string | null;
    readonly plannedUtc: string;
    readonly durationS: number;
    readonly inTransitWindow: boolean;
    readonly planned: boolean;
    readonly gapStartUtc: string | null;
    readonly gapDurationS: number | null;
  };
  readonly entries: readonly PlanEntry[];
}

export interface PlanDiagnostic {
  readonly projectId: string;
  readonly panelId?: string;
  readonly lineId?: string;
  readonly reason: string;
  readonly message?: string;
}

export interface PlanWarning {
  readonly code: string;
  readonly level: 'warn' | 'error';
  readonly unitId?: string;
  readonly atUtc?: string;
  readonly durationS?: number;
  readonly message?: string;
}

export interface NightPlan {
  readonly nightPlanId: string;
  readonly engineVersion: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly night: string;
  readonly startAtUtc: string | null;
  readonly nightWindow: { readonly startUtc: string; readonly endUtc: string };
  readonly darkness: {
    readonly civilStartUtc: string | null;
    readonly civilEndUtc: string | null;
    readonly nauticalStartUtc: string | null;
    readonly nauticalEndUtc: string | null;
    readonly astronomicalStartUtc: string | null;
    readonly astronomicalEndUtc: string | null;
  };
  readonly darknessEndUtc: string | null;
  readonly flatsNotBeforeUtc: string;
  readonly flatsNotAfterUtc: string | null;
  readonly sessionEndUtc: string;
  readonly blocks: readonly PlanBlock[];
  readonly summary: {
    readonly targets: number;
    readonly plannedFrames: Readonly<Record<string, Readonly<Record<string, number>>>>;
  };
  readonly diagnostics: readonly PlanDiagnostic[];
  readonly warnings: readonly PlanWarning[];
}
