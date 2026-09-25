/**
 * `planNight(PlanInput) → NightPlan` (TK 7.6, 8.2; `specs/engine/allocation.md` §1): Nachtkontext und
 * Nutzbarkeit aus der Astronomie (AP-10) → Grid mit Masken → Zuteilung (`paint`) und Ablauf (`walk`) →
 * Blöcke mit Zeitmarken (`night.md` §3). Flip, Transit-Lücke und die vollständige Diagnose folgen mit
 * AP-13d.
 */
import { canonicalInputJson } from '../canonical';
import { EngineInputError } from '../astro/time';
import { sha256hex } from '../hash/sha256';
import { ENGINE_VERSION } from '../version';
import { buildEligibility, type EligibilityLine } from '../visibility/eligibility';
import type { MoonProfile } from '../visibility/moon-safe';
import { buildNightContext } from '../visibility/night-context';
import { rotationWithinTolerance } from '../geometry/rotation';
import type { Crossings } from '../astro/twilight';
import { meridianTransitUtc, targetAt, type Target } from '../astro/target';
import {
  DEFAULT_SORT_CHAIN,
  maskToRanges,
  type GridInput,
  type GridLine,
  type GridMoonProfile,
  type GridUnit,
} from './grid';
import { isoFromUnix, unixFromIso, uuidv7FromHash } from './iso';
import { SLOT_S } from './model';
import type {
  NightPlan,
  PlanBlock,
  PlanDiagnostic,
  PlanEntry,
  PlanInput,
  PlanLine,
  PlanPanel,
  PlanProject,
  PlanWarning,
  TwilightName,
} from './plan-input';
import { planGrid } from './run';
import type { WalkBlock } from './walk';

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface UnitMeta {
  readonly unitId: string;
  readonly project: PlanProject;
  readonly panel: PlanPanel | null;
  readonly twilightEndUtc: number | null;
  readonly visibility: 'never' | 'circumpolar' | 'normal';
}

/** Aufwärtsdurchgang einer Grenze: durchgehend dunkel → Nachtfensterende, nie erreicht → `null`. */
function limitEnd(c: Crossings, windowEnd: number): number | null {
  if (c.kind === 'polarNight') return windowEnd;
  if (c.kind === 'polarDay') return null;
  return c.endUtc;
}

function validate(input: PlanInput): void {
  const profiles = new Set(input.moonProfiles.map((p) => p.id));
  const ids = new Set<string>();
  const unique = (id: string, what: string) => {
    if (ids.has(id)) throw new EngineInputError('engine.input_invalid', `${what} ${id} doppelt`);
    ids.add(id);
  };
  for (const p of input.projects) {
    unique(p.id, 'Projekt');
    if (p.panels.length === 0)
      throw new EngineInputError('engine.input_invalid', `Projekt ${p.id} ohne Panel`);
    for (const panel of p.panels) {
      unique(panel.id, 'Panel');
      for (const l of panel.lines) {
        unique(l.id, 'Zeile');
        if (l.moonProfileId !== null && !profiles.has(l.moonProfileId))
          throw new EngineInputError('engine.input_invalid', `Mondprofil ${l.moonProfileId} fehlt`);
      }
    }
  }
}

export function planNight(input: PlanInput): NightPlan {
  // Der Kompatibilitätsmodus vergleicht Grids mit dem Orakel; einen Nachtplan gibt es nur produktiv.
  if (input.mode !== 'productive')
    throw new EngineInputError('engine.input_invalid', 'planNight nur mit mode = productive');
  validate(input);
  const inputHash = `sha256:${sha256hex(canonicalInputJson(input))}`;
  const transitions = input.timeZoneTransitions.map((t) => ({
    atUtc: unixFromIso(t.atUtc),
    utcOffsetMinutes: t.utcOffsetMinutes,
  }));
  const site = { latDeg: input.site.latitudeDeg, lonDeg: input.site.longitudeDeg };
  const sched = input.scheduler;
  const ctx = buildNightContext({
    site,
    night: input.night,
    timeZoneTransitions: transitions,
    flatsSource: sched.flatsSource,
  });
  const times = ctx.times;
  const w0 = times.nightWindow.startUtc;
  const wEnd = times.nightWindow.endUtc;
  const n = ctx.slotCount;
  const rel = (unix: number) => unix - w0;

  const moonProfiles = new Map(input.moonProfiles.map((p) => [p.id, p]));
  const engineProfile = (id: string | null): MoonProfile | null => {
    const p = id === null ? undefined : moonProfiles.get(id);
    return p
      ? {
          separationDeg: p.separationDeg,
          widthDays: p.widthDays,
          relaxScale: p.relaxScale,
          moonMinAltDeg: p.moonMinAltDeg,
          moonMaxAltDeg: p.moonMaxAltDeg,
          maxIlluminationPct: p.maxIlluminationPct,
          moonMustBeDown: p.moonMustBeDown,
        }
      : null;
  };

  // Filterzuordnung (NT-E1): mit Filterrad nehmen Zeilen ohne bestätigten NINA-Namen nicht teil.
  const diagnostics: PlanDiagnostic[] = [];
  const participates = (project: PlanProject, panel: PlanPanel, line: PlanLine) => {
    if (!input.rig.hasFilterWheel || line.ninaFilterName !== null || !line.enabled) return true;
    diagnostics.push({
      projectId: project.id,
      panelId: panel.id,
      lineId: line.id,
      reason: 'filter_not_found',
    });
    return false;
  };

  const twilightEnds: Record<TwilightName, number | null> = {
    civil: limitEnd(times.twilight.civil, wEnd),
    nautical: limitEnd(times.twilight.nautical, wEnd),
    astronomical: limitEnd(times.twilight.astronomical, wEnd),
  };

  const units: GridUnit[] = [];
  const meta = new Map<string, UnitMeta>();
  /** Ziel je Einheit und Panel (Panel-Koordinaten, A-19; `null` = Projektzentrum bzw. Einheitsziel). */
  const targets = new Map<string, { target: Target; minAltDeg: number }>();
  const targetKey = (unitId: string, panelIndex: number | null) =>
    `${unitId}|${String(panelIndex)}`;
  const projects = [...input.projects].sort((a, b) => ordinal(a.id, b.id));
  for (const project of projects) {
    const panels = [...project.panels].sort((a, b) => a.index - b.index);
    const split = sched.mosaicPanelsIndependent && panels.length > 1;
    const groups: { unitId: string; panels: PlanPanel[]; target: PlanPanel | null }[] = split
      ? panels.map((p) => ({ unitId: `${project.id}/p${String(p.index)}`, panels: [p], target: p }))
      : [{ unitId: project.id, panels, target: panels.length === 1 ? (panels[0] ?? null) : null }];
    for (const g of groups) {
      const lines = g.panels.flatMap((panel) =>
        panel.lines.filter((l) => participates(project, panel, l)).map((l) => ({ panel, line: l })),
      );
      const coords = g.target && split ? g.target : project;
      const asTarget = (c: { raDeg: number; decDeg: number }): Target => ({
        raJ2000Deg: c.raDeg,
        decJ2000Deg: c.decDeg,
      });
      targets.set(targetKey(g.unitId, null), {
        target: asTarget(g.target ?? project),
        minAltDeg: project.minAltitudeDeg,
      });
      for (const panel of g.panels)
        targets.set(targetKey(g.unitId, panel.index), {
          target: asTarget(panel),
          minAltDeg: project.minAltitudeDeg,
        });
      const eligibilityLines: EligibilityLine[] = lines.map(({ line }) => ({
        id: line.id,
        moonProfile: engineProfile(line.moonProfileId),
      }));
      const elig = buildEligibility(ctx, {
        target: { raJ2000Deg: coords.raDeg, decJ2000Deg: coords.decDeg },
        twilight: project.twilight,
        minAltDeg: project.minAltitudeDeg,
        startDate: project.startDate,
        lines: eligibilityLines,
      });
      const safeOf = new Map(elig.lines.map((l) => [l.id, l.safe]));
      const gridPanels = g.panels.map((panel) => ({
        index: panel.index,
        lines: lines
          .filter((x) => x.panel === panel)
          .map(({ line }): GridLine => ({
            id: line.id,
            filter: line.filter,
            exposureS: line.exposureS,
            planned: line.planned,
            accepted: line.accepted + line.pending,
            enabled: line.enabled,
            moonProfile: line.moonProfileId,
            safe: maskToRanges(
              (safeOf.get(line.id) ?? []).map((ok, s) => ok && ctx.moonDown[s] !== true),
            ),
          })),
      }));
      const transit = project.transit
        ? {
            windowS: [
              rel(unixFromIso(project.transit.windowStartUtc)),
              rel(unixFromIso(project.transit.windowEndUtc)),
            ] as const,
            lineId: project.transit.lineId,
            lockedAtS: rel(unixFromIso(project.transit.lockedAtUtc)),
          }
        : null;
      const twilightEnd = twilightEnds[project.twilight];
      units.push({
        unitId: g.unitId,
        projectId: project.id,
        priority: project.priority,
        minTimeOnTargetH: project.minTimeOnTargetH,
        dueDate: project.dueDate,
        peakAltDeg: elig.peakAltDeg ?? 0,
        canImage: maskToRanges(elig.canImage),
        meridianAtS: (() => {
          const tm = meridianTransitUtc(
            { raJ2000Deg: (g.target ?? project).raDeg, decJ2000Deg: (g.target ?? project).decDeg },
            site,
            w0,
            wEnd,
            'upper',
          );
          return tm === null ? null : rel(tm);
        })(),
        transit,
        panels: gridPanels,
        twilightEndS: twilightEnd === null ? null : rel(twilightEnd),
      });
      meta.set(g.unitId, {
        unitId: g.unitId,
        project,
        panel: g.target,
        twilightEndUtc: twilightEnd,
        visibility: elig.visibility,
      });
    }
  }

  // Nachtweite Zeitmarken (night.md §3, NT-12).
  const used = new Set(projects.map((p) => p.twilight));
  const ends = (['civil', 'nautical', 'astronomical'] as const)
    .filter((l) => used.has(l))
    .map((l) => twilightEnds[l])
    .filter((x): x is number => x !== null);
  const darknessEnd = ends.length > 0 ? Math.max(...ends) : null;
  const sky = sched.flatsSource === 'sky' && times.skyFlats.notBeforeUtc !== null;
  const flatsNotBefore = sky
    ? (times.skyFlats.notBeforeUtc as number)
    : (darknessEnd ?? wEnd - 3600);
  const flatsNotAfter = sky ? times.skyFlats.notAfterUtc : null;

  const moonAltDeg = Array.from({ length: n }, (_, s) =>
    Math.max(ctx.moon[s]?.altDeg ?? -90, ctx.moon[s + 1]?.altDeg ?? -90),
  );
  const tonight = input.tonight;
  const grid: GridInput = {
    mode: input.mode,
    slotS: SLOT_S,
    slots: n,
    // §5.3: nur Slots mit Beginn < startAtUtc sind vergangen; ein Start vor dem Nachtfenster (Neuplanung
    // am Nachmittag) lässt keinen vergangenen Slot übrig und ist gleichbedeutend mit dem Fensterbeginn.
    startAtS: input.startAtUtc === null ? null : Math.max(0, rel(unixFromIso(input.startAtUtc))),
    moonAltDeg,
    settings: {
      strategy: sched.strategy,
      sortChain: sched.sortChain.length > 0 ? sched.sortChain : DEFAULT_SORT_CHAIN,
      bonusEnabled: sched.bonusEnabled,
      overshootPct: sched.overshootPct,
      mosaicPanelsIndependent: sched.mosaicPanelsIndependent,
      dither: { enabled: sched.ditherEnabled, every: sched.ditherEvery },
      filterSwitch: {
        enabled: sched.filterSwitchEnabled,
        every: sched.filterSwitchEvery,
        tolerancePct: sched.filterSwitchTolerancePct,
      },
      overhead: sched.overhead,
      flip: sched.flip,
    },
    moonProfiles: input.moonProfiles.map((p): GridMoonProfile => ({
      id: p.id,
      distanceDeg: p.separationDeg,
      maxIllumPct: p.maxIlluminationPct,
      mustBeDown: p.moonMustBeDown,
      widthDays: p.widthDays,
    })),
    units,
    tonight: tonight
      ? {
          pastBlocks: tonight.pastBlocks.map((b) => ({
            unitId: b.unitId,
            fromS: Math.max(0, rel(unixFromIso(b.fromUtc))),
            toS: Math.max(0, rel(unixFromIso(b.toUtc))),
          })),
          exposedSecByUnit: tonight.exposedSecByUnit,
          lastAutofocusS:
            tonight.lastAutofocusUtc === null ? null : rel(unixFromIso(tonight.lastAutofocusUtc)),
          filterCycle: tonight.filterCycle,
          flipDoneByPanel: tonight.flipDoneByPanel,
          currentUnitId: tonight.currentUnitId,
        }
      : null,
    darknessEndS: darknessEnd === null ? null : rel(darknessEnd),
  };
  // Meridian je Panel mit scheinbarer RA (flip-rotation.md §1.1, geschlossene Form WS-24); untere
  // Kulmination als zweiter Kandidat, wenn die Höhe dort ≥ Mindesthöhe ist (NT-26).
  const meridianCache = new Map<string, { upper: number | null; candidates: number[] }>();
  const meridianInfo = (unitId: string, panelIndex: number | null) => {
    const key = targetKey(unitId, panelIndex);
    const cached = meridianCache.get(key);
    if (cached) return cached;
    const t = targets.get(key) ?? targets.get(targetKey(unitId, null));
    let info: { upper: number | null; candidates: number[] } = { upper: null, candidates: [] };
    if (t) {
      const upper = meridianTransitUtc(t.target, site, w0, wEnd, 'upper');
      const lower = meridianTransitUtc(t.target, site, w0, wEnd, 'lower');
      const candidates = [
        upper,
        lower !== null && targetAt(t.target, lower, site).altDeg >= t.minAltDeg ? lower : null,
      ]
        .filter((x): x is number => x !== null)
        .map(rel)
        .sort((a, b) => a - b);
      info = { upper: upper === null ? null : rel(upper), candidates };
    }
    meridianCache.set(key, info);
    return info;
  };
  const result = planGrid(grid, {
    rotator: input.rig.hasRotator,
    meridian: (unitId, panelIndex) => meridianInfo(unitId, panelIndex).candidates,
    upperMeridian: (unitId, panelIndex) => meridianInfo(unitId, panelIndex).upper,
    pierSide: (unitId, panelIndex, t) => {
      const target =
        targets.get(targetKey(unitId, panelIndex)) ?? targets.get(targetKey(unitId, null));
      if (!target) return null;
      // Ziel östlich des Meridians (LHA < 0) → `west`, sonst `east` (allocation.md §2, NT-34).
      return targetAt(target.target, w0 + t, site).hourAngleDeg < 0 ? 'west' : 'east';
    },
  });

  // Blöcke in Planformat.
  const lineById = new Map(
    projects.flatMap((p) =>
      p.panels.flatMap((panel) => panel.lines.map((l) => [l.id, l] as const)),
    ),
  );
  const iso = (s: number) => isoFromUnix(w0 + s);
  const blocks: PlanBlock[] = result.blocks.map((b: WalkBlock, i: number): PlanBlock => {
    const m = meta.get(b.unitId);
    if (!m) throw new EngineInputError('engine.input_invalid', `Einheit ${b.unitId}`);
    const byIndex =
      b.panelIndex === null ? undefined : m.project.panels.find((p) => p.index === b.panelIndex);
    const only = m.project.panels.length === 1 ? m.project.panels[0] : undefined;
    const panel = m.panel ?? byIndex ?? only ?? null;
    const coords = panel ?? m.project;
    let seq = 0;
    const entries = b.entries.map((e): PlanEntry => {
      seq += 1;
      switch (e.cmd) {
        case 'slew_center':
        case 'slew_center_rotate':
          return { seq, cmd: e.cmd, atUtc: iso(e.atS), durationS: e.durationS };
        case 'filter':
          return {
            seq,
            cmd: 'filter',
            atUtc: iso(e.atS),
            durationS: e.durationS,
            filter: e.filter,
          };
        case 'expose':
        case 'expose_series': {
          const l = lineById.get(e.lineId);
          const params = {
            exposureLineId: e.lineId,
            filter: e.filter,
            exposureS: e.exposureS,
            gain: l?.gain ?? null,
            offset: l?.offset ?? null,
            binning: l?.binning ?? 1,
            readoutMode: l?.readoutMode ?? null,
          };
          return e.cmd === 'expose'
            ? {
                seq,
                cmd: 'expose',
                atUtc: iso(e.atS),
                ...params,
                bonus: e.bonus,
                lastOfNight: e.lastOfNight,
              }
            : { seq, cmd: 'expose_series', atUtc: iso(e.atS), untilUtc: iso(e.untilS), ...params };
        }
        case 'end':
          return { seq, cmd: 'end', atUtc: iso(e.atS) };
        default:
          return { seq, cmd: e.cmd, atUtc: iso(e.atS), durationS: e.durationS };
      }
    });
    const rotator = input.rig.hasRotator;
    return {
      id: uuidv7FromHash(inputHash, i + 1, w0 + b.startS),
      kind: b.kind,
      projectId: m.project.id,
      panelId: panel?.id ?? null,
      transitObservationId:
        b.kind === 'transit' ? (m.project.transit?.observationId ?? null) : null,
      startUtc: iso(b.startS),
      endUtc: iso(b.endS),
      twilightEndUtc: m.twilightEndUtc === null ? null : isoFromUnix(m.twilightEndUtc),
      raDeg: coords.raDeg,
      decDeg: coords.decDeg,
      rotationDeg: rotator
        ? (panel?.rotationDeg ?? m.project.rotationDeg)
        : (input.rig.defaultRotationDeg ?? 0),
      rotationMode: rotator ? 'rotator' : 'fixed_camera',
      meridianFlip: b.meridianFlip
        ? {
            waitStartUtc:
              b.meridianFlip.waitStartS === null ? null : iso(b.meridianFlip.waitStartS),
            plannedUtc: iso(b.meridianFlip.plannedS),
            durationS: b.meridianFlip.durationS,
            inTransitWindow: b.meridianFlip.inTransitWindow,
            planned: b.meridianFlip.planned,
            gapStartUtc: b.meridianFlip.gapStartS === null ? null : iso(b.meridianFlip.gapStartS),
            gapDurationS: b.meridianFlip.gapDurationS,
          }
        : null,
      entries,
    };
  });

  // Diagnose und Warnungen (allocation.md §12): Einheiten → Projekt/Panel.
  const panelOf = (m: UnitMeta) =>
    m.panel && m.project.panels.length > 1 ? { panelId: m.panel.id } : {};
  for (const d of result.diagnostics) {
    const m = meta.get(d.unitId);
    if (!m) continue;
    const reason =
      (d.reason === 'below_min_time' || d.reason === 'not_visible') &&
      m.project.startDate !== null &&
      input.night < m.project.startDate
        ? 'start_date'
        : d.reason === 'below_min_time' && m.visibility === 'never'
          ? 'not_visible'
          : d.reason;
    diagnostics.push({
      projectId: m.project.id,
      ...panelOf(m),
      ...(d.lineId !== undefined ? { lineId: d.lineId } : {}),
      reason,
      ...(d.message !== undefined ? { message: d.message } : {}),
    });
  }
  const warnings: PlanWarning[] = result.warnings.map((w) => ({
    code: w.code,
    level: w.level,
    ...(w.unitId !== undefined ? { unitId: w.unitId } : {}),
    ...(w.atS !== undefined ? { atUtc: iso(w.atS) } : {}),
    ...(w.durationS !== undefined ? { durationS: w.durationS } : {}),
    ...(w.message !== undefined ? { message: w.message } : {}),
  }));
  // Ohne Rotator: Panel-PA gegen den Kamerawinkel modulo 180° (geometry.md §2.2, NT-E4).
  if (!input.rig.hasRotator && input.rig.defaultRotationDeg !== null) {
    const planned = new Set(blocks.map((b) => `${b.projectId}|${String(b.panelId)}`));
    for (const [unitId, m] of [...meta].sort(([a], [b]) => ordinal(a, b)))
      for (const panel of m.project.panels) {
        if (!planned.has(`${m.project.id}|${panel.id}`)) continue;
        if (m.panel && m.panel.id !== panel.id) continue;
        if (
          !rotationWithinTolerance(
            panel.rotationDeg,
            input.rig.defaultRotationDeg,
            input.rig.rotationToleranceDeg,
          )
        )
          warnings.push({ code: 'panel_rotation_mismatch', level: 'warn', unitId });
      }
  }
  // Streifende Dämmerungsgrenze einer genutzten Grenze (night.md §2).
  for (const limit of ['civil', 'nautical', 'astronomical'] as const)
    if (used.has(limit) && times.twilight[limit].grazing)
      warnings.push({ code: 'twilight_grazing', level: 'warn', message: limit });

  const plannedFrames: Record<string, Record<string, number>> = {};
  for (const b of blocks)
    for (const e of b.entries) {
      if (e.cmd !== 'expose') continue;
      const perProject = (plannedFrames[b.projectId] ??= {});
      perProject[e.filter] = (perProject[e.filter] ?? 0) + 1;
    }
  const sortedDiagnostics = [...diagnostics].sort(
    (a, b) =>
      ordinal(a.projectId, b.projectId) ||
      ordinal(a.panelId ?? '', b.panelId ?? '') ||
      ordinal(a.lineId ?? '', b.lineId ?? '') ||
      ordinal(a.reason, b.reason),
  );
  const tw = times.twilight;
  const opt = (x: number | null) => (x === null ? null : isoFromUnix(x));
  const plan: Omit<NightPlan, 'outputHash'> = {
    nightPlanId: uuidv7FromHash(inputHash, 0, w0),
    engineVersion: ENGINE_VERSION,
    inputHash,
    night: input.night,
    startAtUtc: input.startAtUtc,
    nightWindow: { startUtc: isoFromUnix(w0), endUtc: isoFromUnix(wEnd) },
    darkness: {
      civilStartUtc: opt(tw.civil.startUtc),
      civilEndUtc: opt(tw.civil.endUtc),
      nauticalStartUtc: opt(tw.nautical.startUtc),
      nauticalEndUtc: opt(tw.nautical.endUtc),
      astronomicalStartUtc: opt(tw.astronomical.startUtc),
      astronomicalEndUtc: opt(tw.astronomical.endUtc),
    },
    darknessEndUtc: opt(darknessEnd),
    flatsNotBeforeUtc: isoFromUnix(flatsNotBefore),
    flatsNotAfterUtc: opt(flatsNotAfter),
    sessionEndUtc: isoFromUnix(wEnd),
    blocks,
    summary: { targets: Object.keys(plannedFrames).length, plannedFrames },
    diagnostics: sortedDiagnostics,
    warnings,
  };
  const { inputHash: _ih, ...hashed } = plan;
  void _ih;
  return { ...plan, outputHash: `sha256:${sha256hex(canonicalInputJson(hashed))}` };
}
