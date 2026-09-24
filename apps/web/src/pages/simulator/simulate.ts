/**
 * Nacht-Simulator S-40 (AP-13f, FA-SIM-01…08): reine Rechnung für den Web Worker. Eingabe über
 * `buildPlanInput` (A5-2, keine eigene Abbildung), Plan über `planNight` (dieselbe Engine wie der
 * Planaufbau, FA-SIM-05); daraus Diagramm, Zielkarten, nicht zugeteilte Projekte und Planprotokoll.
 * Keine Uhr: „jetzt“ ergänzt die Seite.
 */
import {
  moonAt,
  moonSafe,
  planNight,
  requiredSeparationDeg,
  separationDeg,
  sunAt,
  targetAt,
  TWILIGHT_DEG,
  unixFromIso,
  type NightPlan,
  type PlanBlock,
  type PlanInput,
  type PlanMoonProfile,
  type PlanProject,
} from '@nina-pm/engine';
import { buildPlanInput } from '@nina-pm/shared';
import { CHART_SERIES_COUNT } from '@nina-pm/ui-tokens';
import type { NightChartProps } from '../../components/night-chart';
import { nightChartFromEngine } from '../../lib/night-chart-data';

type BuildArgs = Parameters<typeof buildPlanInput>;

export interface SimulationRequest {
  readonly rig: BuildArgs[0];
  readonly projects: BuildArgs[1];
  readonly moonProfiles: BuildArgs[2];
  readonly nights: BuildArgs[3];
  readonly night: string;
  readonly site: {
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly elevationM: number;
    readonly timeZone: string;
  };
  /** `given`: auch eigene Entwürfe und Einreichungen (nur lokal, FK 6.14); sonst freigegeben und aktiv. */
  readonly selection: 'plannable' | 'given';
  /** Filterfarben je Kurzname (Filterbalken, Farbchips). */
  readonly filterColors: Readonly<Record<string, string>>;
  /** Anzeigenamen der Mondprofile (Protokoll). */
  readonly moonProfileNames: Readonly<Record<string, string>>;
}

export type Check = 'ok' | 'fail' | 'warn' | 'none';

export interface TargetCard {
  readonly projectId: string;
  readonly name: string;
  readonly color: string;
  readonly allocatedS: number;
  readonly fromUtc: string | null;
  readonly toUtc: string | null;
  readonly altMinDeg: number | null;
  readonly altMaxDeg: number | null;
  readonly moonSepMinDeg: number | null;
  readonly transit: boolean;
  readonly lines: readonly {
    readonly lineId: string;
    readonly filter: string;
    readonly color: string;
    readonly exposureS: number;
    readonly need: number;
    readonly tonight: number;
    readonly la: boolean;
    readonly enabled: boolean;
  }[];
  readonly checks: {
    readonly altitude: Check;
    readonly time: Check;
    readonly moon: Check;
    readonly darkness: Check;
    readonly rotation: Check;
  };
  readonly flips: readonly {
    readonly atUtc: string;
    readonly durationS: number;
    readonly inTransitWindow: boolean;
  }[];
}

export interface UnallocatedProject {
  readonly projectId: string;
  readonly name: string;
  readonly reasons: readonly {
    readonly reason: string;
    readonly lineId?: string;
    readonly message?: string;
  }[];
}

export interface ProtocolRow {
  readonly key: string;
  readonly cmd: string;
  readonly atUtc: string;
  readonly untilUtc: string | null;
  readonly durationS: number | null;
  readonly projectName: string;
  readonly panel: string;
  readonly no: number | null;
  readonly filter: string;
  readonly exposureS: number | null;
  readonly gain: number | null;
  readonly offset: number | null;
  readonly binning: number | null;
  readonly readoutMode: string | null;
  readonly rotationDeg: number | null;
  readonly raDeg: number | null;
  readonly decDeg: number | null;
  readonly altDeg: number | null;
  readonly moonSepDeg: number | null;
  readonly moonOk: boolean | null;
  readonly requiredSepDeg: number | null;
  readonly dark: boolean | null;
  readonly la: boolean | null;
  readonly moonProfile: string;
  readonly bonus: boolean;
}

export interface SimulationResult {
  readonly plan: NightPlan;
  readonly chart: Omit<NightChartProps, 'state'>;
  readonly cards: readonly TargetCard[];
  readonly unallocated: readonly UnallocatedProject[];
  readonly protocol: readonly ProtocolRow[];
  /** Filter-Kurzname je Zeile (Diagnose je Zeile). */
  readonly lineNames: Readonly<Record<string, string>>;
  readonly header: {
    readonly darkHours: number;
    readonly targets: number;
    readonly frames: number;
    readonly moonIllumPct: number;
  };
}

const colorOf = (i: number) => `var(--npm-chart-series-${String((i % CHART_SERIES_COUNT) + 1)})`;
const round1 = (x: number) => Math.round(x * 10) / 10;

function lineNeed(l: PlanProject['panels'][number]['lines'][number], overshootPct: number) {
  if (!l.enabled) return 0;
  const cap = overshootPct > 0 ? Math.ceil(l.planned * (overshootPct / 100)) : 0;
  return Math.max(0, l.planned + cap - l.accepted - l.pending);
}

export function simulate(req: SimulationRequest): SimulationResult {
  // Entwürfe ohne Panel kann die Engine nicht planen (engine.input_invalid) – sie fehlen im Plan.
  const candidates = req.projects.filter((p) => p.panels.length > 0);
  const input = buildPlanInput(req.rig, candidates, req.moonProfiles, req.nights, {
    night: req.night,
    site: {
      latitudeDeg: req.site.latitudeDeg,
      longitudeDeg: req.site.longitudeDeg,
      elevationM: req.site.elevationM,
    },
    selection: req.selection,
  }) as PlanInput;
  const plan = planNight(input);
  const site = { latDeg: req.site.latitudeDeg, lonDeg: req.site.longitudeDeg };
  const projects = input.projects;
  const names = new Map(req.projects.map((p) => [p.id, p.name]));
  const color = new Map(projects.map((p, i) => [p.id, colorOf(i)]));
  const profiles = new Map<string, PlanMoonProfile>(input.moonProfiles.map((p) => [p.id, p]));
  const lineOf = new Map(
    projects.flatMap((p) =>
      p.panels.flatMap((panel) =>
        panel.lines.map((l) => [l.id, { project: p, panel, line: l }] as const),
      ),
    ),
  );

  // Diagramm: Höhenkurven je Ziel, Blöcke, Filterbalken, Flip-Marken.
  const { props: base } = nightChartFromEngine({
    site,
    night: req.night,
    timeZoneTransitions: input.timeZoneTransitions.map((t) => ({
      atUtc: unixFromIso(t.atUtc),
      utcOffsetMinutes: t.utcOffsetMinutes,
    })),
    timeZone: req.site.timeZone,
    targets: projects.map((p) => ({
      id: p.id,
      label: names.get(p.id) ?? p.id,
      color: color.get(p.id) ?? colorOf(0),
      target: { raJ2000Deg: p.raDeg, decJ2000Deg: p.decDeg },
    })),
    minAltDeg: projects.length > 0 ? Math.min(...projects.map((p) => p.minAltitudeDeg)) : 30,
    twilight: 'astronomical',
    transitLabel: '',
  });
  const panelLabel = (b: PlanBlock) => {
    const p = projects.find((x) => x.id === b.projectId);
    if (!p || p.panels.length < 2 || b.panelId === null) return '';
    const panel = p.panels.find((x) => x.id === b.panelId);
    return panel ? String(panel.index + 1) : '';
  };
  const blocks = plan.blocks.map((b) => ({
    id: b.id,
    fromUtc: unixFromIso(b.startUtc),
    toUtc: unixFromIso(b.endUtc),
    label: `${names.get(b.projectId) ?? ''}${panelLabel(b) ? ` · ${panelLabel(b)}` : ''}`,
    kind: b.kind,
    color: color.get(b.projectId) ?? colorOf(0),
  }));
  const filterBars: { fromUtc: number; toUtc: number; color: string; label: string }[] = [];
  for (const b of plan.blocks)
    for (const e of b.entries) {
      if (e.cmd !== 'expose' && e.cmd !== 'expose_series') continue;
      const from = unixFromIso(e.atUtc);
      const to = e.cmd === 'expose_series' ? unixFromIso(e.untilUtc) : from + e.exposureS;
      const last = filterBars[filterBars.length - 1];
      const fc = req.filterColors[e.filter] ?? 'var(--npm-chart-marker)';
      if (last && last.label === e.filter && from - last.toUtc <= 120) last.toUtc = to;
      else filterBars.push({ fromUtc: from, toUtc: to, color: fc, label: e.filter });
    }
  const markers = plan.blocks
    .filter((b) => b.meridianFlip !== null)
    .map((b) => ({
      atUtc: unixFromIso((b.meridianFlip as NonNullable<PlanBlock['meridianFlip']>).plannedUtc),
      kind: 'flip' as const,
      label: 'Flip',
    }));
  const chart = { ...base, series: base.series ?? [], markers, blocks, filterBars };

  // Protokoll (FA-SIM-08) mit Höhe, Mondabstand, Dunkelheit und LA je Eintrag.
  const counter = new Map<string, number>();
  const protocol: ProtocolRow[] = [];
  const empty = {
    no: null,
    filter: '',
    exposureS: null,
    gain: null,
    offset: null,
    binning: null,
    readoutMode: null,
    moonOk: null,
    requiredSepDeg: null,
    la: null,
    moonProfile: '',
    bonus: false,
  };
  for (const b of plan.blocks) {
    const project = projects.find((p) => p.id === b.projectId);
    const target = { raJ2000Deg: b.raDeg, decJ2000Deg: b.decDeg };
    for (const e of b.entries) {
      const t = unixFromIso(e.atUtc);
      const place = targetAt(target, t, site);
      const moon = moonAt(t, site);
      const sep = separationDeg(moon.raDeg, moon.decDeg, place.raDeg, place.decDeg);
      const sunAlt = sunAt(t, site).altDeg;
      const dark = project ? sunAlt < TWILIGHT_DEG[project.twilight] : null;
      const common = {
        key: `${b.id}:${String(e.seq)}`,
        cmd: e.cmd,
        atUtc: e.atUtc,
        untilUtc: e.cmd === 'expose_series' ? e.untilUtc : null,
        durationS: 'durationS' in e ? e.durationS : null,
        projectName: names.get(b.projectId) ?? '',
        panel: panelLabel(b),
        rotationDeg: b.rotationDeg,
        raDeg: b.raDeg,
        decDeg: b.decDeg,
        altDeg: round1(place.altDeg),
        moonSepDeg: round1(sep),
        dark,
      };
      if (e.cmd !== 'expose' && e.cmd !== 'expose_series') {
        protocol.push({ ...common, ...empty });
        continue;
      }
      const info = lineOf.get(e.exposureLineId);
      const profile = info?.line.moonProfileId ? profiles.get(info.line.moonProfileId) : undefined;
      const state = {
        moonAltDeg: moon.altDeg,
        illumPct: moon.illumPct,
        phaseDays: moon.phaseDays,
        sepDeg: sep,
      };
      const n = (counter.get(e.exposureLineId) ?? 0) + 1;
      counter.set(e.exposureLineId, n);
      protocol.push({
        ...common,
        no: e.cmd === 'expose' ? n : null,
        filter: e.filter,
        exposureS: e.exposureS,
        gain: e.gain,
        offset: e.offset,
        binning: e.binning,
        readoutMode: e.readoutMode,
        moonOk: profile ? moonSafe(profile, state) : true,
        requiredSepDeg: profile
          ? round1(requiredSeparationDeg(profile, moon.altDeg, moon.phaseDays))
          : null,
        la: profile !== undefined,
        moonProfile: profile ? (req.moonProfileNames[profile.id] ?? profile.id) : '',
        bonus: e.cmd === 'expose' ? e.bonus : false,
      });
    }
  }

  // Zielkarten (FA-SIM-06) und nicht zugeteilte Projekte (FA-SIM-03).
  const cards: TargetCard[] = [];
  const unallocated: UnallocatedProject[] = [];
  const overshoot = input.scheduler.overshootPct;
  for (const p of projects) {
    const own = plan.blocks.filter((b) => b.projectId === p.id);
    const diag = plan.diagnostics.filter((d) => d.projectId === p.id);
    const ownIds = new Set(own.map((b) => b.id));
    const rows = protocol.filter((r) => ownIds.has(r.key.slice(0, r.key.lastIndexOf(':'))));
    const exposeRows = rows.filter((r) => r.cmd === 'expose' || r.cmd === 'expose_series');
    if (own.length === 0) {
      unallocated.push({
        projectId: p.id,
        name: names.get(p.id) ?? p.id,
        reasons: diag.map((d) => ({
          reason: d.reason,
          ...(d.lineId ? { lineId: d.lineId } : {}),
          ...(d.message ? { message: d.message } : {}),
        })),
      });
      continue;
    }
    const tonight = new Map<string, number>();
    for (const b of own)
      for (const e of b.entries)
        if (e.cmd === 'expose' && !e.bonus)
          tonight.set(e.exposureLineId, (tonight.get(e.exposureLineId) ?? 0) + 1);
    const alts = rows.map((r) => r.altDeg).filter((x): x is number => x !== null);
    const seps = exposeRows.map((r) => r.moonSepDeg).filter((x): x is number => x !== null);
    const allocatedS = own.reduce((s, b) => s + unixFromIso(b.endUtc) - unixFromIso(b.startUtc), 0);
    const rotationWarn =
      plan.warnings.some(
        (w) => w.code === 'panel_rotation_mismatch' && (w.unitId ?? '').startsWith(p.id),
      ) || diag.some((d) => d.reason === 'rotation_mismatch');
    const transit = own.some((b) => b.kind === 'transit');
    cards.push({
      projectId: p.id,
      name: names.get(p.id) ?? p.id,
      color: color.get(p.id) ?? colorOf(0),
      allocatedS,
      fromUtc: own[0]?.startUtc ?? null,
      toUtc: own[own.length - 1]?.endUtc ?? null,
      altMinDeg: alts.length > 0 ? Math.min(...alts) : null,
      altMaxDeg: alts.length > 0 ? Math.max(...alts) : null,
      moonSepMinDeg: seps.length > 0 ? Math.min(...seps) : null,
      transit,
      lines: p.panels.flatMap((panel) =>
        panel.lines.map((l) => ({
          lineId: l.id,
          filter: l.filter,
          color: req.filterColors[l.filter] ?? 'var(--npm-chart-marker)',
          exposureS: l.exposureS,
          need: lineNeed(l, overshoot),
          tonight: tonight.get(l.id) ?? 0,
          la: l.moonProfileId !== null,
          enabled: l.enabled,
        })),
      ),
      checks: {
        altitude: alts.length > 0 && Math.max(...alts) >= p.minAltitudeDeg ? 'ok' : 'fail',
        time: transit || allocatedS >= p.minTimeOnTargetH * 3600 ? 'ok' : 'warn',
        moon: exposeRows.every((r) => r.moonOk !== false) ? 'ok' : 'fail',
        darkness: exposeRows.every((r) => r.dark !== false) ? 'ok' : 'fail',
        rotation: input.rig.hasRotator ? 'ok' : rotationWarn ? 'warn' : 'ok',
      },
      flips: own
        .filter((b) => b.meridianFlip !== null)
        .map((b) => {
          const f = b.meridianFlip as NonNullable<PlanBlock['meridianFlip']>;
          return {
            atUtc: f.plannedUtc,
            durationS: f.durationS,
            inTransitWindow: f.inTransitWindow,
          };
        }),
    });
  }

  const dark = plan.darkness;
  const darkHours =
    dark.astronomicalStartUtc && dark.astronomicalEndUtc
      ? (unixFromIso(dark.astronomicalEndUtc) - unixFromIso(dark.astronomicalStartUtc)) / 3600
      : 0;
  const frames = Object.values(plan.summary.plannedFrames)
    .flatMap((byLine) => Object.values(byLine))
    .reduce((s, n) => s + n, 0);
  const mid = (unixFromIso(plan.nightWindow.startUtc) + unixFromIso(plan.nightWindow.endUtc)) / 2;
  return {
    plan,
    chart,
    cards,
    unallocated,
    protocol,
    lineNames: Object.fromEntries([...lineOf.entries()].map(([id, x]) => [id, x.line.filter])),
    header: {
      darkHours: round1(darkHours),
      targets: plan.summary.targets,
      frames,
      moonIllumPct: Math.round(moonAt(mid, site).illumPct),
    },
  };
}
