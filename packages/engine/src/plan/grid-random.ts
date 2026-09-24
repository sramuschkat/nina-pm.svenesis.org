/**
 * Zufallsgrids mit festem Seed (AP-13a, allocation.md §11.2: „≥ 500 Zufallsgrids, feste Seeds“).
 * Rein und deterministisch: eigener xorshift32-Generator statt `Math.random`, nur ganzzahlige Werte.
 * Die Grids decken die Pfade des Originals ab: Mondverläufe (unten, oben, auf-/untergehend), Stufen
 * mit und ohne „Kein Mond“, Mosaike als Panel-Einheiten oder Projekt-Einheit, Transitfenster,
 * manuelle Priorität, Bonus, Dither, Filterwechsel mit Toleranz und Overshoot.
 */
import {
  DEFAULT_SORT_CHAIN,
  GRID_SLOT_SECONDS,
  SORT_CHAIN_KEYS,
  maskToRanges,
  type GridInput,
  type GridLine,
  type GridMode,
  type GridMoonProfile,
  type GridPanel,
  type GridSettings,
  type GridUnit,
  type SlotRange,
  type SortChainKey,
} from './grid';

/** xorshift32; Seed 0 wird auf einen festen Startwert abgebildet. */
export function seededRandom(seed: number): () => number {
  let x = (seed ^ 0x9e3779b9) >>> 0 || 0x2545f491;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

interface Rng {
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(list: readonly T[]): T;
}

function rngFor(seed: number): Rng {
  const next = seededRandom(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    int,
    chance: (p) => next() < p,
    pick: <T>(list: readonly T[]) => list[int(0, list.length - 1)] as T,
  };
}

const PROFILE_TEMPLATES: readonly GridMoonProfile[] = [
  { id: 'strict', distanceDeg: 90, maxIllumPct: 30, mustBeDown: false },
  { id: 'moderate', distanceDeg: 60, maxIllumPct: 60, mustBeDown: false },
  { id: 'relaxed', distanceDeg: 25, maxIllumPct: 80, mustBeDown: false },
  { id: 'nomoon', distanceDeg: 180, maxIllumPct: 0, mustBeDown: true },
];
const FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'] as const;
const EXPOSURES = [30, 60, 120, 180, 300, 600] as const;
const MIN_TIMES_H = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

function moonCurve(rng: Rng, slots: number): number[] {
  const k = rng.int(1, 2);
  const rise = rng.int(-10, slots + 10);
  const set = rng.int(-10, slots + 10);
  const clamp = (a: number) => Math.max(-45, Math.min(70, a));
  switch (rng.int(0, 4)) {
    case 0:
      return Array.from({ length: slots }, (_, s) => -5 - ((s * k) % 20));
    case 1:
      return Array.from({ length: slots }, (_, s) => clamp(10 + s * k));
    case 2:
      return Array.from({ length: slots }, (_, s) => clamp((s - rise) * k));
    case 3:
      return Array.from({ length: slots }, (_, s) => clamp((set - s) * k));
    default:
      return Array.from({ length: slots }, (_, s) =>
        clamp(Math.min((s - Math.min(rise, set)) * k, (Math.max(rise, set) - s) * k)),
      );
  }
}

function randomRanges(rng: Rng, slots: number, maxRanges: number): SlotRange[] {
  const mask = new Array<boolean>(slots).fill(false);
  const n = rng.int(0, maxRanges);
  for (let i = 0; i < n; i++) {
    const a = rng.int(0, slots - 1);
    const b = rng.chance(0.3) ? slots - 1 : rng.int(a, Math.min(slots - 1, a + rng.int(6, 90)));
    for (let s = a; s <= b; s++) mask[s] = true;
  }
  return maskToRanges(mask);
}

function shuffled<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

function randomSettings(rng: Rng, mode: GridMode): GridSettings {
  const keys = SORT_CHAIN_KEYS.filter((k) => mode === 'productive' || k !== 'due_soonest');
  const sortChain: readonly SortChainKey[] = rng.chance(0.5)
    ? DEFAULT_SORT_CHAIN
    : shuffled(rng, keys).slice(0, rng.int(0, keys.length));
  return {
    strategy: rng.chance(0.2) ? 'manual_priority' : 'proportional',
    sortChain,
    bonusEnabled: rng.chance(0.4),
    overshootPct: rng.pick([0, 0, 0, 10, 25]),
    mosaicPanelsIndependent: rng.chance(0.6),
    dither: { enabled: rng.chance(0.5), every: rng.int(1, 5) },
    filterSwitch: {
      enabled: rng.chance(0.6),
      every: rng.int(1, 12),
      tolerancePct: rng.pick([0, 25, 50, 75, 100]),
    },
    overhead: {
      slewCenterS: 0,
      filterChangeS: 0,
      ditherSettleS: 0,
      afEveryMin: 0,
      afDurationS: 0,
      downloadS: 0,
    },
    flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
  };
}

function randomLines(
  rng: Rng,
  prefix: string,
  slots: number,
  profiles: readonly GridMoonProfile[],
): GridLine[] {
  return Array.from({ length: rng.int(1, 5) }, (_, k) => {
    const planned = rng.int(0, 80);
    return {
      id: `${prefix}-L${String(k)}`,
      filter: rng.pick(FILTERS),
      exposureS: rng.pick(EXPOSURES),
      planned,
      accepted: rng.chance(0.2) ? rng.int(0, planned + 5) : rng.int(0, Math.floor(planned / 2)),
      enabled: rng.chance(0.9),
      moonProfile: profiles.length > 0 && rng.chance(0.6) ? rng.pick(profiles).id : null,
      safe: randomRanges(rng, slots, 2),
    };
  });
}

export interface RandomGridOptions {
  /** Standard `compat` (Vergleich mit dem Orakel). */
  readonly mode?: GridMode;
}

/** Zufallsgrid zum Seed; gleicher Seed → gleiches Grid. */
export function randomGrid(seed: number, options: RandomGridOptions = {}): GridInput {
  const mode = options.mode ?? 'compat';
  const rng = rngFor(seed);
  const slots = rng.int(60, 144);
  const moonAltDeg = moonCurve(rng, slots);
  const moonProfiles = PROFILE_TEMPLATES.filter(() => rng.chance(0.5));
  const settings = randomSettings(rng, mode);
  const units: GridUnit[] = [];
  const projectCount = rng.int(1, 6);
  for (let i = 0; i < projectCount; i++) {
    const projectId = `P${String(i)}`;
    const panelCount = rng.chance(0.25) ? rng.int(2, 4) : 1;
    const priority = rng.int(0, 4);
    const minTimeOnTargetH = rng.pick(MIN_TIMES_H);
    const peakAltDeg = rng.int(15, 85);
    const canImage: SlotRange[] = rng.chance(0.08) ? [] : randomRanges(rng, slots, 2);
    const dueDate =
      mode === 'productive' && rng.chance(0.3) ? `2026-1${String(rng.int(0, 2))}-15` : null;
    const panels: GridPanel[] = Array.from({ length: panelCount }, (_, index) => {
      const lines = randomLines(rng, `${projectId}-p${String(index)}`, slots, moonProfiles);
      if (mode !== 'productive') return { index, lines };
      return {
        index,
        peakAltDeg: Math.max(10, peakAltDeg - rng.int(0, 5)),
        canImage,
        meridianAtS: null,
        lines,
      };
    });
    const firstLine = panels[0]?.lines[0];
    const transitFrom = rng.int(0, Math.max(0, slots * GRID_SLOT_SECONDS - 3600));
    const transit =
      panelCount === 1 && firstLine && rng.chance(0.1)
        ? {
            windowS: [transitFrom, transitFrom + rng.int(3600, 4 * 3600)] as const,
            lineId: firstLine.id,
            lockedAtS: rng.int(0, 10000),
          }
        : null;
    const base = {
      projectId,
      priority,
      minTimeOnTargetH,
      dueDate,
      peakAltDeg,
      canImage,
      meridianAtS: null,
      transit,
    };
    if (panelCount > 1 && settings.mosaicPanelsIndependent)
      for (const panel of panels)
        units.push({ ...base, unitId: `${projectId}/p${String(panel.index)}`, panels: [panel] });
    else units.push({ ...base, unitId: projectId, panels });
  }
  return {
    mode,
    slotS: GRID_SLOT_SECONDS,
    slots,
    startAtS: null,
    moonAltDeg,
    settings,
    moonProfiles,
    units,
    tonight: null,
  };
}
