/**
 * Profile je Einheit aus einem Grid (`specs/engine/allocation.md` §3; Kompatibilität wie der
 * Orakel-Adapter `tools/astropm-oracle/cs/GridAdapter.cs`, der `SessionScheduler.BuildTargetProfiles`
 * ohne Astronomie nachbaut). Die Astronomie-Variante aus `PlanInput` folgt mit `planNight` (AP-13c) und
 * liefert dieselbe Struktur.
 */
import { atan } from '../math';
import { compatSwitches, type CompatSwitches } from './compat';
import {
  gridMasks,
  panelUnitIndex,
  rangesToMask,
  type GridInput,
  type GridLine,
  type GridMoonProfile,
  type GridPanel,
  type GridUnit,
} from './grid';
import {
  SLOT_S,
  type ExcludedUnit,
  type NightSetup,
  type PastSlots,
  type Tier,
  type UnitLine,
  type UnitProfile,
  type UnitTransit,
} from './model';

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Restriktivität im Original: `A × (1 + 100/(maxIllum + 1))` (SE 49, A-31 aus). */
function compatRestrictiveness(p: GridMoonProfile): number {
  return p.distanceDeg * (1.0 + 100.0 / (p.maxIllumPct + 1.0));
}

/** Produktiv: `A · W · arctan(14,77/W)` (moon.md §Restriktivität, A-31). */
function productiveRestrictiveness(p: GridMoonProfile): number {
  if (p.mustBeDown) return Number.POSITIVE_INFINITY;
  const w = p.widthDays ?? 0;
  if (w === 0) return 0;
  return p.distanceDeg * w * atan(14.77 / w);
}

/** Planungsbedarf je Zeile (§2): `max(0, planned + ⌈planned·overshoot⌉ − accepted)`; deaktiviert 0. */
export function effectiveRemaining(line: GridLine, overshootPct: number): number {
  if (!line.enabled) return 0;
  const cap = overshootPct > 0 ? Math.ceil(Math.max(0, line.planned) * (overshootPct / 100.0)) : 0;
  return Math.max(0, line.planned + cap - line.accepted);
}

interface ProjectInfo {
  readonly ordinal: number;
  readonly units: GridUnit[];
  /** Panels des Projekts (Vereinigung der Einheiten), nach Index sortiert. */
  panels: GridPanel[];
}

interface TierPlan {
  readonly tiers: Tier[];
  /** Stufe je Zeilen-ID (nur aktive Zeilen). */
  readonly tierOf: ReadonlyMap<string, number>;
}

/**
 * Stufen je Projekt über alle aktiven Zeilen aller Panels (§3.4). Kompatibilität: Gruppen nach
 * Profilname in Einfügeordnung, stabil nach Restriktivität (SE 60–134). Produktiv: nach Profil-ID,
 * Restriktivität ↑, `maxIllum` ↑, Profil-ID.
 */
function classifyTiers(
  lines: readonly GridLine[],
  profiles: ReadonlyMap<string, GridMoonProfile>,
  sw: CompatSwitches,
): TierPlan {
  const tierOf = new Map<string, number>();
  const groups: { key: string; profile: GridMoonProfile; lines: string[] }[] = [];
  for (const l of lines) {
    if (!l.enabled) continue;
    const p = l.moonProfile === null ? undefined : profiles.get(l.moonProfile);
    if (!p) {
      tierOf.set(l.id, 0);
      continue;
    }
    const key = sw.restrictivenessWidth ? p.id : p.mustBeDown ? 'No Moon' : p.id;
    const g = groups.find((x) => x.key === key);
    if (g) g.lines.push(l.id);
    else groups.push({ key, profile: p, lines: [l.id] });
  }
  const rOf = (p: GridMoonProfile) =>
    p.mustBeDown
      ? sw.restrictivenessWidth
        ? Number.POSITIVE_INFINITY
        : Number.MAX_VALUE
      : sw.restrictivenessWidth
        ? productiveRestrictiveness(p)
        : compatRestrictiveness(p);
  const sorted = groups
    .map((g, i) => ({ ...g, r: rOf(g.profile), i }))
    .sort((a, b) => {
      if (a.r !== b.r) return a.r < b.r ? -1 : 1;
      if (!sw.restrictivenessWidth) return a.i - b.i;
      if (a.profile.maxIllumPct !== b.profile.maxIllumPct)
        return a.profile.maxIllumPct - b.profile.maxIllumPct;
      return ordinal(a.key, b.key);
    });
  const tiers: Tier[] = [
    { key: '', restrictiveness: 0, maxIllumPct: 100, requiresMoonDown: false },
  ];
  sorted.forEach((g, k) => {
    tiers.push({
      key: g.key,
      restrictiveness: g.r,
      maxIllumPct: g.profile.maxIllumPct,
      requiresMoonDown: g.profile.mustBeDown,
    });
    for (const id of g.lines) tierOf.set(id, k + 1);
  });
  return { tiers, tierOf };
}

/** Overhead je Belichtung `ov` (§2, A-4); Kompatibilität 0. */
function overheadPerExposure(grid: GridInput, exposureS: number, sw: CompatSwitches): number {
  if (!sw.overheads) return 0;
  const s = grid.settings;
  const o = s.overhead;
  const dither = s.dither.enabled && s.dither.every > 0 ? o.ditherSettleS / s.dither.every : 0;
  const filter =
    s.filterSwitch.enabled && s.filterSwitch.every > 0 ? o.filterChangeS / s.filterSwitch.every : 0;
  const af =
    o.afEveryMin > 0 ? (o.afDurationS * (exposureS + o.downloadS)) / (o.afEveryMin * 60) : 0;
  return o.downloadS + dither + filter + af;
}

function longestRun(mask: readonly boolean[]): number {
  let longest = 0;
  let cur = 0;
  for (const ok of mask) {
    cur = ok ? cur + 1 : 0;
    if (cur > longest) longest = cur;
  }
  return longest;
}

/** Vergangene Slots bei Neuplanung (§5.3): Slotmitte im Block → Einheit; nur produktiv (A-11). */
function pastSlots(grid: GridInput, sw: CompatSwitches): PastSlots | null {
  if (!sw.replanTonight || grid.startAtS === null) return null;
  const startSlot = Math.min(grid.slots, Math.floor(grid.startAtS / SLOT_S));
  const byUnit: (string | null)[] = new Array<string | null>(startSlot).fill(null);
  for (let s = 0; s < startSlot; s++) {
    const mid = s * SLOT_S + SLOT_S / 2;
    const block = grid.tonight?.pastBlocks.find((b) => mid >= b.fromS && mid < b.toS);
    byUnit[s] = block ? block.unitId : null;
  }
  return { byUnit, startSlot };
}

/** Grid → Profile, Ausschlüsse und Einstellungen für `paint`. */
export function setupFromGrid(grid: GridInput): NightSetup {
  const sw = compatSwitches(grid.mode);
  const n = grid.slots;
  const masks = gridMasks(grid);
  const profiles = new Map(grid.moonProfiles.map((p) => [p.id, p]));
  const projects = new Map<string, ProjectInfo>();
  for (const u of grid.units) {
    let p = projects.get(u.projectId);
    if (!p) {
      p = { ordinal: projects.size, units: [], panels: [] };
      projects.set(u.projectId, p);
    }
    p.units.push(u);
  }
  for (const p of projects.values())
    p.panels = p.units.flatMap((u) => u.panels).sort((a, b) => a.index - b.index);

  // Matrix-Reihenfolge: Kompatibilität Grid, produktiv Projekt-ID und Panel-Index (A-9).
  const units = grid.units.map((u, i) => ({ u, i, mask: masks.units[i] }));
  if (sw.fullTieBreaks)
    units.sort(
      (a, b) =>
        ordinal(a.u.projectId, b.u.projectId) ||
        (panelUnitIndex(a.u.unitId) ?? -1) - (panelUnitIndex(b.u.unitId) ?? -1) ||
        a.i - b.i,
    );

  const excluded: ExcludedUnit[] = [];
  const out: UnitProfile[] = [];
  // Das Original rechnet mit ganzzahligem Prozentwert (`int overshootPercent`).
  const overshoot =
    grid.mode === 'compat' ? Math.trunc(grid.settings.overshootPct) : grid.settings.overshootPct;
  for (const { u, mask } of units) {
    if (!mask) continue;
    const project = projects.get(u.projectId);
    if (!project) continue;
    const panelIdx = panelUnitIndex(u.unitId);
    const panelMask = panelIdx === null ? undefined : mask.panels[0];
    const canImage = sw.panelCoordinates && panelMask ? panelMask.canImage : mask.canImage;
    const peakAltDeg = sw.panelCoordinates && panelMask ? panelMask.peakAltDeg : u.peakAltDeg;
    const minTimeSec = u.minTimeOnTargetH * 3600;
    const allLines = project.panels.flatMap((p) => p.lines);
    const { tiers, tierOf } = classifyTiers(allLines, profiles, sw);

    // Zeilen dieser Einheit (Panel-Einheit: nur ihr Panel) mit Sicherheit je Slot.
    const unitPanels =
      panelIdx === null ? project.panels : project.panels.filter((p) => p.index === panelIdx);
    const moonDown = masks.moonDown;
    const lineSafe = (l: GridLine): boolean[] => {
      const p = l.moonProfile === null ? undefined : profiles.get(l.moonProfile);
      if (!p) return new Array<boolean>(n).fill(true);
      const up = rangesToMask(l.safe, n);
      return moonDown.map((down, s) => down || (!p.mustBeDown && up[s] === true));
    };
    const toLine = (panel: GridPanel, l: GridLine): UnitLine => {
      const ov = overheadPerExposure(grid, l.exposureS, sw);
      return {
        id: l.id,
        panelIndex: panel.index,
        filter: l.filter,
        exposureS: l.exposureS,
        planned: l.planned,
        accepted: l.accepted,
        enabled: l.enabled,
        tier: tierOf.get(l.id) ?? -1,
        effRemaining: effectiveRemaining(l, overshoot),
        secPerExposure: l.exposureS + ov,
        safe: lineSafe(l),
      };
    };
    const projectLines = project.panels.flatMap((p) => p.lines.map((l) => toLine(p, l)));
    const lines = unitPanels.flatMap((p) => p.lines.map((l) => toLine(p, l)));
    const workOf = (ls: readonly UnitLine[]) => {
      let sum = 0;
      for (const l of ls) sum += l.effRemaining * l.secPerExposure;
      return sum;
    };
    const tierWorkSec = tiers.map(() => 0);
    for (const l of lines)
      if (l.tier >= 0)
        tierWorkSec[l.tier] = (tierWorkSec[l.tier] ?? 0) + l.effRemaining * l.secPerExposure;
    const unitWork = workOf(lines);
    const meridianAtS =
      (panelIdx !== null && sw.panelCoordinates ? unitPanels[0]?.meridianAtS : undefined) ??
      u.meridianAtS;
    const fixSec = sw.blockFixCost
      ? grid.settings.overhead.slewCenterS +
        (grid.settings.flip.enabled && meridianAtS !== null ? grid.settings.flip.durationS : 0)
      : 0;

    // Aussortieren (§3.2, SS 296–304; produktiv mit Restposten und fix, A-16).
    const longest = longestRun(canImage);
    const tooShort = sw.blockFixCost
      ? longest * SLOT_S < Math.min(minTimeSec, unitWork + fixSec)
      : (longest > 0 ? (longest * 5.0) / 60.0 : 0) < u.minTimeOnTargetH;
    if (tooShort) {
      excluded.push({ unitId: u.unitId, reason: 'below_min_time' });
      continue;
    }

    // Stufen-Sicherheit (§3.4): Kompatibilität über die erste Zeile der Stufe (SS), produktiv A-28.
    const tierSafe = tiers.map((tier, t): boolean[] => {
      if (t === 0) return new Array<boolean>(n).fill(true);
      if (tier.requiresMoonDown) return [...moonDown];
      if (!sw.tierSafeAnyLine) {
        const rep = projectLines.find((l) => l.tier === t);
        return moonDown.map((down, s) => down || (rep?.safe[s] ?? false));
      }
      const withWork = lines.filter((l) => l.tier === t && l.effRemaining > 0);
      return moonDown.map((down, s) => down || withWork.some((l) => l.safe[s] === true));
    });

    // Transitfenster: Kompatibilität nur mit Projektarbeit (SS 334–343), beide Modi nur mit Überlappung.
    let transit: UnitTransit | null = null;
    if (u.transit) {
      const [from, to] = u.transit.windowS;
      const overlaps = !(to <= 0 || from >= n * SLOT_S);
      const hasWork = sw.transitUntilWindowEnd || workOf(projectLines) > 0;
      if (!overlaps || !hasWork) {
        excluded.push({ unitId: u.unitId, reason: 'no_transit_window' });
        continue;
      }
      transit = {
        startS: from,
        endS: to,
        lockedAtS: u.transit.lockedAtS,
        lineId: u.transit.lineId,
      };
    }

    // Panel-Einheit ohne Arbeit entfällt (SS 369); produktiv jede Einheit ohne Arbeit (§3.5).
    // Transit-Einheiten belichten produktiv bis Fensterende unabhängig vom Bedarf (A-21).
    const keepTransit = sw.transitUntilWindowEnd && transit !== null;
    if (unitWork <= 0 && !keepTransit && (panelIdx !== null || sw.nightBoundsWithWork)) {
      excluded.push({ unitId: u.unitId, reason: sw.nightBoundsWithWork ? 'no_need' : 'no_work' });
      continue;
    }

    out.push({
      unitId: u.unitId,
      projectId: u.projectId,
      projectOrdinal: project.ordinal,
      panelIndex: panelIdx,
      panelPos: panelIdx === null ? null : project.panels.findIndex((p) => p.index === panelIdx),
      priority: u.priority,
      dueDate: u.dueDate,
      minTimeSec,
      canImage,
      peakAltDeg,
      tiers,
      tierWorkSec,
      tierSafe,
      lines,
      transit,
      fixSec,
      meridianAtS,
    });
  }
  return {
    mode: grid.mode,
    switches: sw,
    slots: n,
    moonAltDeg: grid.moonAltDeg,
    moonDown: masks.moonDown,
    strategy: grid.settings.strategy,
    sortChain: grid.settings.sortChain,
    bonusEnabled: grid.settings.bonusEnabled,
    slewCenterS: grid.settings.overhead.slewCenterS,
    profiles: out,
    excluded,
    past: pastSlots(grid, sw),
  };
}
