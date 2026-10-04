/**
 * Simulator-Auswertung S-40 / FA-NIN-18 (AP-13f, AP-53; FA-SIM-03/06/07/08): aus Engine-Eingabe und Nachtplan
 * Planprotokoll je Eintrag (Höhe, Mondabstand, Dunkelheit, LA), Zielkarten mit Prüfliste, nicht zugeteilte Projekte,
 * Blöcke und Filterleiste der Plangrafik sowie die Kopfzahlen. Eine Rechnung für beide Oberflächen: der Web-Simulator
 * (Web Worker) und der Plugin-Simulator (Server, `GET /api/nina/v1/simulation`) nutzen dieselbe Funktion – Farben und
 * Texte ergänzt die jeweilige Oberfläche. Rein und deterministisch (keine Uhr).
 */
import {
  moonAt,
  moonSafe,
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

export type SimCheck = 'ok' | 'fail' | 'warn' | 'none';

export interface SimProtocolRow {
  readonly key: string;
  readonly blockId: string;
  readonly projectId: string;
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
  /** Roher Profilname (mitgelieferte als `moonProfile.<key>`, übersetzt die Oberfläche). */
  readonly moonProfile: string;
  readonly bonus: boolean;
}

export interface SimCardLine {
  readonly lineId: string;
  readonly filter: string;
  readonly exposureS: number;
  readonly need: number;
  readonly tonight: number;
  readonly moon: {
    readonly name: string;
    readonly separationDeg: number;
    readonly widthDays: number;
    readonly mustBeDown: boolean;
  } | null;
  readonly enabled: boolean;
}

export interface SimCard {
  readonly projectId: string;
  /** Stelle des Projekts in `input.projects` – Farbe der Zielreihe (`chart-series-n`). */
  readonly projectIndex: number;
  readonly name: string;
  readonly allocatedS: number;
  readonly fromUtc: string | null;
  readonly toUtc: string | null;
  readonly altMinDeg: number | null;
  readonly altMaxDeg: number | null;
  readonly moonSepMinDeg: number | null;
  readonly transit: boolean;
  readonly lines: readonly SimCardLine[];
  readonly checks: {
    readonly altitude: SimCheck;
    readonly time: SimCheck;
    readonly moon: SimCheck;
    readonly darkness: SimCheck;
    readonly rotation: SimCheck;
  };
  readonly flips: readonly {
    readonly atUtc: string;
    readonly durationS: number;
    readonly inTransitWindow: boolean;
  }[];
}

export interface SimUnallocated {
  readonly projectId: string;
  readonly name: string;
  readonly reasons: readonly {
    readonly reason: string;
    readonly lineId?: string;
    readonly message?: string;
  }[];
}

export interface SimBlock {
  readonly id: string;
  readonly projectId: string;
  readonly projectIndex: number;
  readonly kind: PlanBlock['kind'];
  /** „Projekt“ bzw. „Projekt · 2“ (Panel-Nummer ab 1) bei Mosaiken. */
  readonly label: string;
  readonly fromUtc: number;
  readonly toUtc: number;
}

export interface SimFilterBar {
  readonly fromUtc: number;
  readonly toUtc: number;
  readonly filter: string;
  /** Anzahl Belichtungen („R ×10“, AP-26e); eine Serie zählt ihre vollen Belichtungen. */
  readonly count: number;
}

export interface SimulationView {
  readonly blocks: readonly SimBlock[];
  readonly filterBars: readonly SimFilterBar[];
  readonly flips: readonly { readonly atUtc: number }[];
  readonly protocol: readonly SimProtocolRow[];
  readonly cards: readonly SimCard[];
  readonly unallocated: readonly SimUnallocated[];
  /** Filter-Kurzname je Zeile (Diagnose je Zeile). */
  readonly lineNames: Readonly<Record<string, string>>;
  readonly header: {
    readonly darkHours: number;
    readonly targets: number;
    readonly frames: number;
    readonly moonIllumPct: number;
  };
}

export interface SimulationViewOptions {
  readonly site: { readonly latitudeDeg: number; readonly longitudeDeg: number };
  /** Projektname je ID (Protokoll, Karten, Blöcke). */
  readonly names: ReadonlyMap<string, string>;
  /** Namen der Mondprofile je ID; ohne Eintrag die ID. */
  readonly moonProfileNames: Readonly<Record<string, string>>;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function lineNeed(l: PlanProject['panels'][number]['lines'][number], overshootPct: number) {
  if (!l.enabled) return 0;
  const cap = overshootPct > 0 ? Math.ceil(l.planned * (overshootPct / 100)) : 0;
  return Math.max(0, l.planned + cap - l.accepted - l.pending);
}

export function simulationView(
  input: PlanInput,
  plan: NightPlan,
  opts: SimulationViewOptions,
): SimulationView {
  const site = { latDeg: opts.site.latitudeDeg, lonDeg: opts.site.longitudeDeg };
  const projects = input.projects;
  const nameOf = (id: string) => opts.names.get(id) ?? id;
  const indexOf = new Map(projects.map((p, i) => [p.id, i]));
  const profiles = new Map<string, PlanMoonProfile>(input.moonProfiles.map((p) => [p.id, p]));
  const moonOf = (id: string | null) => {
    const p = id ? profiles.get(id) : undefined;
    return p
      ? {
          name: opts.moonProfileNames[p.id] ?? p.id,
          separationDeg: p.separationDeg,
          widthDays: p.widthDays,
          mustBeDown: p.moonMustBeDown,
        }
      : null;
  };
  const lineOf = new Map(
    projects.flatMap((p) =>
      p.panels.flatMap((panel) =>
        panel.lines.map((l) => [l.id, { project: p, panel, line: l }] as const),
      ),
    ),
  );

  const panelLabel = (b: PlanBlock) => {
    const p = projects.find((x) => x.id === b.projectId);
    if (!p || p.panels.length < 2 || b.panelId === null) return '';
    const panel = p.panels.find((x) => x.id === b.panelId);
    return panel ? String(panel.index + 1) : '';
  };
  const blocks: SimBlock[] = plan.blocks.map((b) => ({
    id: b.id,
    projectId: b.projectId,
    projectIndex: indexOf.get(b.projectId) ?? 0,
    kind: b.kind,
    label: `${opts.names.get(b.projectId) ?? ''}${panelLabel(b) ? ` · ${panelLabel(b)}` : ''}`,
    fromUtc: unixFromIso(b.startUtc),
    toUtc: unixFromIso(b.endUtc),
  }));
  // Filterleiste der Plangrafik mit Anzahl (AP-26e); eine Serie zählt ihre vollen Belichtungen.
  const filterBars: { fromUtc: number; toUtc: number; filter: string; count: number }[] = [];
  for (const b of plan.blocks)
    for (const e of b.entries) {
      if (e.cmd !== 'expose' && e.cmd !== 'expose_series') continue;
      const from = unixFromIso(e.atUtc);
      const to = e.cmd === 'expose_series' ? unixFromIso(e.untilUtc) : from + e.exposureS;
      const n =
        e.cmd === 'expose_series'
          ? Math.max(1, Math.floor((to - from) / Math.max(1, e.exposureS)))
          : 1;
      const last = filterBars[filterBars.length - 1];
      if (last && last.filter === e.filter && from - last.toUtc <= 120) {
        last.toUtc = to;
        last.count += n;
      } else filterBars.push({ fromUtc: from, toUtc: to, filter: e.filter, count: n });
    }
  const flips = plan.blocks
    .filter((b) => b.meridianFlip !== null)
    .map((b) => ({
      atUtc: unixFromIso((b.meridianFlip as NonNullable<PlanBlock['meridianFlip']>).plannedUtc),
    }));

  // Protokoll (FA-SIM-08) mit Höhe, Mondabstand, Dunkelheit und LA je Eintrag.
  const counter = new Map<string, number>();
  const protocol: SimProtocolRow[] = [];
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
        blockId: b.id,
        projectId: b.projectId,
        cmd: e.cmd,
        atUtc: e.atUtc,
        untilUtc: e.cmd === 'expose_series' ? e.untilUtc : null,
        durationS: 'durationS' in e ? e.durationS : null,
        projectName: opts.names.get(b.projectId) ?? '',
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
        moonProfile: profile ? (opts.moonProfileNames[profile.id] ?? profile.id) : '',
        bonus: e.cmd === 'expose' ? e.bonus : false,
      });
    }
  }

  // Zielkarten (FA-SIM-06) und nicht zugeteilte Projekte (FA-SIM-03).
  const cards: SimCard[] = [];
  const unallocated: SimUnallocated[] = [];
  const overshoot = input.scheduler.overshootPct;
  projects.forEach((p, projectIndex) => {
    const own = plan.blocks.filter((b) => b.projectId === p.id);
    const diag = plan.diagnostics.filter((d) => d.projectId === p.id);
    const ownIds = new Set(own.map((b) => b.id));
    const rows = protocol.filter((r) => ownIds.has(r.blockId));
    const exposeRows = rows.filter((r) => r.cmd === 'expose' || r.cmd === 'expose_series');
    if (own.length === 0) {
      unallocated.push({
        projectId: p.id,
        name: nameOf(p.id),
        reasons: diag.map((d) => ({
          reason: d.reason,
          ...(d.lineId ? { lineId: d.lineId } : {}),
          ...(d.message ? { message: d.message } : {}),
        })),
      });
      return;
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
      projectIndex,
      name: nameOf(p.id),
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
          exposureS: l.exposureS,
          need: lineNeed(l, overshoot),
          tonight: tonight.get(l.id) ?? 0,
          moon: moonOf(l.moonProfileId),
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
  });

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
    blocks,
    filterBars,
    flips,
    protocol,
    cards,
    unallocated,
    lineNames: Object.fromEntries([...lineOf.entries()].map(([id, x]) => [id, x.line.filter])),
    header: {
      darkHours: round1(darkHours),
      targets: plan.summary.targets,
      frames,
      moonIllumPct: Math.round(moonAt(mid, site).illumPct),
    },
  };
}
