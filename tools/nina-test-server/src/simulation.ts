/**
 * `GET /simulation?night=` des Test-Servers (AP-53, FA-NIN-18): Simulator im Plugin gegen den Test-Server prüfen
 * (Sichtprüfung H-15). Aus dem Plan des Szenarios (ohne Planrevision) und den Zielen entsteht eine vertragsgemäße
 * `NinaSimulation` – ohne Astronomie: Höhen und Mondabstände bleiben leer, die Prüfliste steht auf `none`.
 */
import { formatTzAbbr } from '@nina-pm/shared';

type Json = Record<string, unknown>;

const iso = (sec: number) => new Date(Math.round(sec) * 1000).toISOString().replace('.000Z', 'Z');
const sec = (text: string) => Date.parse(text) / 1000;

export interface SimulationInput {
  readonly plan: Json;
  readonly targets: Json;
  readonly filterColor: (filter: string) => string | null;
  readonly timeZone: string;
  readonly transitions: readonly { atUtc: string; utcOffsetMinutes: number }[];
  readonly nowS: number;
  readonly settingsVersion: number;
}

export function simulationFromPlan(i: SimulationInput): Json {
  const plan = i.plan;
  const blocks = plan.blocks as Json[];
  const projects = (i.targets.projects as Json[]) ?? [];
  const indexOf = new Map(projects.map((p, n) => [p.id as string, n]));
  const nameOf = (id: string) =>
    (projects.find((p) => p.id === id)?.name as string | undefined) ?? 'NINA-PM';
  const window = plan.nightWindow as { startUtc: string; endUtc: string };
  const start = sec(window.startUtc);
  const end = sec(window.endUtc);
  const ordered = [...i.transitions].sort((a, b) => sec(a.atUtc) - sec(b.atUtc));
  const first = [...ordered].reverse().find((t) => sec(t.atUtc) <= start) ?? ordered[0];
  const segments = [
    ...(first ? [{ at: start, offset: first.utcOffsetMinutes }] : []),
    ...ordered
      .filter((t) => sec(t.atUtc) > start && sec(t.atUtc) < end)
      .map((t) => ({ at: sec(t.atUtc), offset: t.utcOffsetMinutes })),
  ].map((s) => ({
    fromUtc: iso(s.at),
    utcOffsetMinutes: s.offset,
    abbr: formatTzAbbr(iso(s.at), i.timeZone),
  }));

  const protocol: Json[] = [];
  const counter = new Map<string, number>();
  for (const b of blocks)
    for (const e of b.entries as Json[]) {
      const expose = e.cmd === 'expose' || e.cmd === 'expose_series';
      const line = e.exposureLineId as string | undefined;
      const n = expose && line ? (counter.get(line) ?? 0) + 1 : 0;
      if (expose && line) counter.set(line, n);
      protocol.push({
        blockId: b.id,
        projectId: b.projectId,
        cmd: e.cmd,
        atUtc: e.atUtc,
        untilUtc: e.cmd === 'expose_series' ? e.untilUtc : null,
        durationS: typeof e.durationS === 'number' ? e.durationS : null,
        projectName: nameOf(b.projectId as string),
        panel: '',
        no: e.cmd === 'expose' ? n : null,
        filter: expose ? e.filter : '',
        exposureS: expose ? e.exposureS : null,
        gain: expose ? e.gain : null,
        offset: expose ? e.offset : null,
        binning: expose ? e.binning : null,
        readoutMode: expose ? e.readoutMode : null,
        rotationDeg: b.rotationDeg,
        raDeg: b.raDeg,
        decDeg: b.decDeg,
        altDeg: null,
        moonSepDeg: null,
        moonOk: null,
        requiredSepDeg: null,
        dark: null,
        la: null,
        moonProfile: '',
        bonus: e.cmd === 'expose' ? Boolean(e.bonus) : false,
      });
    }

  const filterBars: Json[] = [];
  for (const b of blocks)
    for (const e of b.entries as Json[]) {
      if (e.cmd !== 'expose' && e.cmd !== 'expose_series') continue;
      const from = sec(e.atUtc as string);
      const exp = e.exposureS as number;
      const to = e.cmd === 'expose_series' ? sec(e.untilUtc as string) : from + exp;
      const count =
        e.cmd === 'expose_series' ? Math.max(1, Math.floor((to - from) / Math.max(1, exp))) : 1;
      const last = filterBars[filterBars.length - 1];
      if (last && last.filter === e.filter && from - sec(last.toUtc as string) <= 120) {
        last.toUtc = iso(to);
        last.count = (last.count as number) + count;
      } else
        filterBars.push({
          fromUtc: iso(from),
          toUtc: iso(to),
          filter: e.filter,
          color: i.filterColor(e.filter as string),
          count,
        });
    }

  const cards: Json[] = [];
  const unallocated: Json[] = [];
  for (const p of projects) {
    const own = blocks.filter((b) => b.projectId === p.id);
    if (own.length === 0) {
      unallocated.push({ projectId: p.id, name: p.name, reasons: [] });
      continue;
    }
    const tonight = new Map<string, number>();
    for (const b of own)
      for (const e of b.entries as Json[])
        if (e.cmd === 'expose' && !e.bonus) {
          const id = e.exposureLineId as string;
          tonight.set(id, (tonight.get(id) ?? 0) + 1);
        }
    const lines = (p.panels as Json[]).flatMap((panel) => panel.lines as Json[]);
    cards.push({
      projectId: p.id,
      name: p.name,
      seriesIndex: indexOf.get(p.id as string) ?? 0,
      allocatedS: own.reduce((s, b) => s + sec(b.endUtc as string) - sec(b.startUtc as string), 0),
      fromUtc: own[0]?.startUtc ?? null,
      toUtc: own[own.length - 1]?.endUtc ?? null,
      altMinDeg: null,
      altMaxDeg: null,
      moonSepMinDeg: null,
      transit: own.some((b) => b.kind === 'transit'),
      lines: lines.map((l) => ({
        lineId: l.id,
        filter: l.filter,
        color: i.filterColor(l.filter as string),
        exposureS: l.exposureS,
        need: ((l.counts as Json | undefined)?.planningNeed as number | undefined) ?? 0,
        tonight: tonight.get(l.id as string) ?? 0,
        moon: null,
        enabled: l.enabled !== false,
      })),
      checks: { altitude: 'none', time: 'none', moon: 'none', darkness: 'none', rotation: 'none' },
      flips: own
        .filter((b) => b.meridianFlip)
        .map((b) => {
          const f = b.meridianFlip as Json;
          return {
            atUtc: f.plannedUtc,
            durationS: f.durationS,
            inTransitWindow: f.inTransitWindow,
          };
        }),
    });
  }

  const frames = Object.values(
    (plan.summary as { plannedFrames: Record<string, Record<string, number>> }).plannedFrames,
  )
    .flatMap((x) => Object.values(x))
    .reduce((s, n) => s + n, 0);
  const darkness = plan.darkness as Record<string, string | null>;
  const astro =
    darkness.astronomicalStartUtc && darkness.astronomicalEndUtc
      ? (sec(darkness.astronomicalEndUtc) - sec(darkness.astronomicalStartUtc)) / 3600
      : 0;
  return {
    night: plan.night,
    generatedAtUtc: iso(i.nowS),
    engineVersion: plan.engineVersion,
    inputHash: plan.inputHash,
    settingsVersion: i.settingsVersion,
    timeZone: i.timeZone,
    timeZoneSegments: segments,
    nightWindow: window,
    darkness: plan.darkness,
    header: {
      darkHours: Math.round(astro * 10) / 10,
      targets: cards.length,
      frames,
      moonIllumPct: 0,
    },
    targets: [],
    moon: { illuminationPct: 0, altitude: [] },
    blocks: blocks.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      kind: b.kind,
      label: nameOf(b.projectId as string),
      seriesIndex: indexOf.get(b.projectId as string) ?? 0,
      startUtc: b.startUtc,
      endUtc: b.endUtc,
    })),
    filterBars,
    flips: blocks
      .filter((b) => b.meridianFlip)
      .map((b) => ({ atUtc: (b.meridianFlip as Json).plannedUtc })),
    cards,
    unallocated,
    protocol,
    warnings: plan.warnings,
  };
}
