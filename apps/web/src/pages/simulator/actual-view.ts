/**
 * Ist + Plan im Web (AP-53c, FA-SIM-10): Erledigtes aus dem Ist der Nacht (`ExecutedNight`, blass), das Kommende aus der
 * letzten gespeicherten Planrevision (kräftig, Entscheidung 1 vom 07.10.2026) – bei Was-wäre-wenn bzw. ohne
 * gespeicherten Plan aus der Rechnung ab jetzt. Dazu Lücken mit Grund, der Ursprungsplan als Umriss und Protokollzeilen
 * mit Spalte „Ist“. Rein (keine Uhr): `nowMs` kommt von der Seite. Dieselben Regeln wie die Fenster im Plugin (AP-53b).
 */
import type { ExecutedNight, SimProtocolRow, StoredPlan } from '@nina-pm/shared';
import type {
  ChartGap,
  FilterBar,
  OutlineBlock,
  TimelineBlock,
} from '../../components/night-chart';

export type ActualState = 'done' | 'saved' | 'skipped' | 'failed' | 'running' | 'planned' | 'gap';

/** Spalte „Ist“: Zustand, Grund (Code), Anzahl (Abschnitt bzw. zusammengefasste Blöcke). */
export interface ActualCell {
  readonly state: ActualState;
  readonly reason: string | null;
  readonly count: number | null;
  readonly past: boolean;
}

export type ActualProtocolRow = SimProtocolRow & { readonly actual?: ActualCell };

export interface ActualView {
  readonly blocks: readonly TimelineBlock[];
  readonly filterBars: readonly FilterBar[];
  readonly gaps: readonly ChartGap[];
  readonly outline: readonly OutlineBlock[];
  readonly protocol: readonly ActualProtocolRow[];
  readonly counters: { readonly saved: number; readonly skipped: number; readonly failed: number };
  /** Kommendes aus der gespeicherten Revision (sonst aus der Rechnung ab jetzt). */
  readonly fromStored: boolean;
}

export interface ActualViewInput {
  readonly executed: ExecutedNight | null;
  /** Letzte Revision; `null` bei Was-wäre-wenn (dann gilt `computed`). */
  readonly stored: StoredPlan | null;
  readonly first: StoredPlan | null;
  readonly nowMs: number;
  /** Die Nacht läuft (sonst ist sie vorbei: kein Kommendes). */
  readonly running: boolean;
  /** Rechnung ab jetzt (Blöcke, Filterbalken, Protokoll) für Was-wäre-wenn bzw. ohne gespeicherten Plan. */
  readonly computed: {
    readonly blocks: readonly TimelineBlock[];
    readonly filterBars: readonly FilterBar[];
    readonly protocol: readonly SimProtocolRow[];
  };
  readonly colorOfProject: (projectId: string) => string;
  readonly filterColor: (filter: string) => string;
  readonly names: ReadonlyMap<string, string>;
  /** Beschriftung einer Lücke (übersetzt). */
  readonly gapLabel: (kind: ChartGap['kind'], reason: string | null, count: number) => string;
}

const sec = (iso: string) => Date.parse(iso) / 1000;

interface StoredEntry {
  readonly seq: number;
  readonly cmd: string;
  readonly atUtc: string;
  readonly durationS?: number | null;
  readonly untilUtc?: string | null;
  readonly filter?: string | null;
  readonly exposureS?: number | null;
  readonly gain?: number | null;
  readonly offset?: number | null;
  readonly binning?: number | null;
  readonly readoutMode?: string | null;
  readonly bonus?: boolean | null;
}

interface StoredBlock {
  readonly id: string;
  readonly kind: string;
  readonly projectId: string;
  readonly startUtc: string;
  readonly endUtc: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly entries: readonly StoredEntry[];
}

const isExpose = (cmd: string) => cmd === 'expose' || cmd === 'expose_series';

function row(
  over: Partial<SimProtocolRow> & Pick<SimProtocolRow, 'key' | 'cmd' | 'atUtc'>,
): SimProtocolRow {
  return {
    blockId: '',
    projectId: '',
    untilUtc: null,
    durationS: null,
    projectName: '',
    panel: '',
    no: null,
    filter: '',
    exposureS: null,
    gain: null,
    offset: null,
    binning: null,
    readoutMode: null,
    rotationDeg: null,
    raDeg: null,
    decDeg: null,
    altDeg: null,
    moonSepDeg: null,
    moonOk: null,
    requiredSepDeg: null,
    dark: null,
    la: null,
    moonProfile: '',
    bonus: false,
    ...over,
  };
}

/** Geplante Filterabschnitte eines gespeicherten Blocks ab jetzt: aufeinanderfolgende Belichtungen gleichen Filters. */
export function storedFilterBars(
  b: StoredBlock,
  nowS: number,
  filterColor: (f: string) => string,
): FilterBar[] {
  const bars: FilterBar[] = [];
  let cur: { from: number; to: number; filter: string; count: number } | null = null;
  const flush = () => {
    if (cur)
      bars.push({
        fromUtc: cur.from,
        toUtc: cur.to,
        color: filterColor(cur.filter),
        label: cur.filter,
        count: cur.count,
        tense: 'planned',
      });
    cur = null;
  };
  for (const e of b.entries) {
    if (!isExpose(e.cmd)) continue;
    const exp = e.exposureS ?? 0;
    const to =
      e.cmd === 'expose_series'
        ? sec(e.untilUtc ?? b.endUtc)
        : sec(e.atUtc) + Math.max(exp, e.durationS ?? 0);
    if (to <= nowS) continue;
    const from = Math.max(sec(e.atUtc), nowS);
    const filter = e.filter ?? '';
    const count =
      e.cmd === 'expose_series' && exp > 0 ? Math.max(1, Math.floor((to - from) / exp)) : 1;
    if (cur && cur.filter === filter) {
      cur.to = to;
      cur.count += count;
    } else {
      flush();
      cur = { from, to, filter, count };
    }
  }
  flush();
  return bars;
}

export function actualView(i: ActualViewInput): ActualView | null {
  const ex = i.executed;
  if (!ex && !(i.running && i.stored)) return null;
  const nowS = i.nowMs / 1000;
  const name = (projectId: string | null, title?: string) =>
    title || (projectId ? (i.names.get(projectId) ?? '') : '');

  // ---- Erledigtes ----
  const blocks: TimelineBlock[] = [];
  const bars: FilterBar[] = [];
  const gaps: ChartGap[] = [];
  const rows: ActualProtocolRow[] = [];
  for (const b of ex?.blocks ?? []) {
    const to = b.endUtc ? sec(b.endUtc) : nowS;
    blocks.push({
      id: `ist:${b.blockId ?? b.startUtc}`,
      fromUtc: sec(b.startUtc),
      toUtc: Math.min(to, nowS),
      label: name(b.projectId, b.title),
      kind: b.kind,
      color: i.colorOfProject(b.projectId),
      tense: 'past',
    });
    rows.push({
      ...row({
        key: `ist:${b.blockId ?? b.startUtc}:start`,
        blockId: b.blockId ?? '',
        projectId: b.projectId,
        cmd: 'slew_center',
        atUtc: b.startUtc,
        projectName: name(b.projectId, b.title),
      }),
      actual: { state: b.running ? 'running' : 'done', reason: null, count: null, past: true },
    });
  }
  for (const [k, s] of (ex?.segments ?? []).entries()) {
    bars.push({
      fromUtc: sec(s.startUtc),
      toUtc: sec(s.endUtc),
      color: i.filterColor(s.filter),
      label: s.filter,
      count: s.saved,
      tense: 'past',
    });
    const block = ex?.blocks.find((b) => b.blockId !== null && b.blockId === s.blockId);
    rows.push({
      ...row({
        key: `ist:seg:${String(k)}`,
        blockId: s.blockId ?? '',
        projectId: s.projectId ?? '',
        cmd: block?.kind === 'transit' ? 'expose_series' : 'expose',
        atUtc: s.startUtc,
        untilUtc: s.endUtc,
        projectName: name(s.projectId, block?.title),
        filter: s.filter,
        exposureS: s.exposureS,
      }),
      actual: {
        state: s.saved === 0 && s.failed > 0 ? 'failed' : 'saved',
        reason: s.failed > 0 && s.saved > 0 ? 'failed' : null,
        count: s.saved + s.failed,
        past: true,
      },
    });
  }
  for (const g of ex?.gaps ?? []) {
    gaps.push({
      fromUtc: sec(g.fromUtc),
      toUtc: sec(g.toUtc),
      kind: g.kind,
      label: i.gapLabel(g.kind, g.reason, g.count),
      reason: g.reason,
      count: g.count,
    });
    if (g.kind === 'flip') continue; // Flip steht als eigene Zeile aus dem Ereignis.
    rows.push({
      ...row({
        key: `ist:gap:${g.fromUtc}`,
        cmd: 'gap',
        atUtc: g.fromUtc,
        untilUtc: g.toUtc,
        durationS: sec(g.toUtc) - sec(g.fromUtc),
      }),
      actual: {
        state: 'gap',
        reason: g.kind === 'empty_blocks' || g.kind === 'skipped' ? g.reason : g.kind,
        count: g.count,
        past: true,
      },
    });
  }
  for (const [k, e] of (ex?.events ?? []).entries()) {
    const base = {
      key: `ist:ev:${String(k)}`,
      blockId: e.blockId ?? '',
      projectId: e.projectId ?? '',
      atUtc: e.atUtc,
      projectName: name(e.projectId),
    };
    if (e.kind === 'flip')
      rows.push({
        ...row({
          ...base,
          cmd: 'meridian_flip',
          atUtc: new Date(Date.parse(e.atUtc) - (e.durationS ?? 0) * 1000)
            .toISOString()
            .replace('.000Z', 'Z'),
          durationS: e.durationS,
        }),
        actual: { state: 'done', reason: null, count: null, past: true },
      });
    else if (e.kind === 'skipped_timeaware')
      rows.push({
        ...row({ ...base, cmd: 'expose' }),
        actual: { state: 'skipped', reason: e.code ?? 'late', count: null, past: true },
      });
    else if (e.kind === 'block_skipped')
      rows.push({
        ...row({ ...base, cmd: 'block_skipped' }),
        actual: { state: 'skipped', reason: e.code, count: null, past: true },
      });
  }

  // ---- Kommendes ----
  const fromStored = i.stored !== null;
  if (i.running) {
    if (i.stored) {
      const done = new Set(
        (ex?.blocks ?? []).filter((b) => !b.running && b.blockId).map((b) => b.blockId),
      );
      for (const b of i.stored.blocks as unknown as StoredBlock[]) {
        if (sec(b.endUtc) <= nowS || done.has(b.id)) continue;
        const from = Math.max(sec(b.startUtc), nowS);
        blocks.push({
          id: b.id,
          fromUtc: from,
          toUtc: sec(b.endUtc),
          label: name(b.projectId),
          kind: b.kind === 'transit' ? 'transit' : 'regular',
          color: i.colorOfProject(b.projectId),
          tense: 'planned',
        });
        bars.push(...storedFilterBars(b, nowS, i.filterColor));
        for (const e of b.entries) {
          if (sec(e.atUtc) < nowS && !(e.untilUtc && sec(e.untilUtc) > nowS)) continue;
          rows.push({
            ...row({
              key: `${b.id}:${String(e.seq)}`,
              blockId: b.id,
              projectId: b.projectId,
              cmd: e.cmd,
              atUtc: e.atUtc,
              untilUtc: e.untilUtc ?? null,
              durationS: e.durationS ?? null,
              projectName: name(b.projectId),
              no: isExpose(e.cmd) ? e.seq : null,
              filter: e.filter ?? '',
              exposureS: e.exposureS ?? null,
              gain: e.gain ?? null,
              offset: e.offset ?? null,
              binning: e.binning ?? null,
              readoutMode: e.readoutMode ?? null,
              rotationDeg: b.rotationDeg,
              raDeg: b.raDeg,
              decDeg: b.decDeg,
              bonus: e.bonus ?? false,
            }),
            actual: { state: 'planned', reason: null, count: null, past: false },
          });
        }
      }
    } else {
      for (const b of i.computed.blocks)
        if (b.toUtc > nowS)
          blocks.push({ ...b, fromUtc: Math.max(b.fromUtc, nowS), tense: 'planned' });
      for (const f of i.computed.filterBars)
        if (f.toUtc > nowS)
          bars.push({ ...f, fromUtc: Math.max(f.fromUtc, nowS), tense: 'planned' });
      for (const r of i.computed.protocol)
        if (sec(r.atUtc) >= nowS)
          rows.push({ ...r, actual: { state: 'planned', reason: null, count: null, past: false } });
    }
  }

  const outline: OutlineBlock[] = ((i.first?.blocks ?? []) as unknown as StoredBlock[]).map(
    (b) => ({
      fromUtc: sec(b.startUtc),
      toUtc: sec(b.endUtc),
      color: i.colorOfProject(b.projectId),
    }),
  );
  const ordered = rows
    .map((r, n) => ({ r, n }))
    .sort((a, b) => Date.parse(a.r.atUtc) - Date.parse(b.r.atUtc) || a.n - b.n)
    .map((x) => x.r);
  return {
    blocks,
    filterBars: bars,
    gaps,
    outline,
    protocol: ordered,
    counters: ex?.counters ?? { saved: 0, skipped: 0, failed: 0 },
    fromStored,
  };
}
