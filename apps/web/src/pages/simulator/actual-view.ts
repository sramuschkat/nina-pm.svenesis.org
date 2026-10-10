/**
 * Ist + Plan im Web (AP-53c, FA-SIM-10): Erledigtes aus dem Ist der Nacht (`ExecutedNight`, blass), das Kommende aus der
 * letzten gespeicherten Planrevision (kräftig, Entscheidung 1 vom 07.10.2026) – bei Was-wäre-wenn bzw. ohne
 * gespeicherten Plan aus der Rechnung ab jetzt. Dazu Lücken mit Grund, der Ursprungsplan als Umriss und Protokollzeilen
 * mit Spalte „Ist“. Rein (keine Uhr): `nowMs` kommt von der Seite. Dieselben Regeln wie die Fenster im Plugin (AP-53b).
 * Rig-Nacht 09./10.10.2026: Liegt das Rig zurück, entfallen verschobene Belichtungen, die nicht mehr bis Blockende + 60 s
 * fertig werden (wie `Playback.LateGraceMax` im Plugin), statt im Folgeblock zu landen; ein geplanter Autofokus kurz nach
 * einem Autofokus entfällt wie im Plugin (`AF_SKIPPED reason=recent`) und verschiebt nichts; die Flats stehen als Zeile.
 */
import type { ExecutedNight, SimProtocolRow, SimSkyFields, StoredPlan } from '@nina-pm/shared';
import type {
  ChartGap,
  FilterBar,
  OutlineBlock,
  TimelineBlock,
} from '../../components/night-chart';
import { openStoredBlocks } from './rig-night';

export type ActualState = 'done' | 'saved' | 'skipped' | 'failed' | 'running' | 'planned' | 'gap';

/** Verzug, den das Plugin am Blockende noch mitnimmt (`Playback.LateGraceMax`, AP-71). */
export const LATE_GRACE_S = 60;

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
  /** Vom Plugin beendete bzw. übersprungene Blöcke (`GET /simulations/input`): nicht mehr „geplant“. */
  readonly endedBlockIds?: readonly string[] | undefined;
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
  /** Höhe, Mondabstand, Dunkelheit und LA je Zeile des gespeicherten Plans (`protocolSky`); ohne leer. */
  readonly sky?: (block: StoredBlock, entry: StoredEntry) => SimSkyFields;
  /** Autofokus-Takt des Rigs in Minuten (`scheduler.overhead.afEveryMin`); `null`/0 = kein Takt. */
  readonly afEveryMin?: number | null | undefined;
  /** Frühester Beginn der Flats der Nacht (`flatsNotBeforeUtc` der Rechnung); ohne keine Zeile. */
  readonly flatsAtUtc?: string | null | undefined;
}

const sec = (iso: string) => Date.parse(iso) / 1000;

export interface StoredEntry {
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
  readonly exposureLineId?: string | null;
}

export interface StoredBlock {
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

/**
 * Rig liegt im laufenden Block hinter dem Plan: Die nächste Belichtung nach den gespeicherten und fehlgeschlagenen
 * Aufnahmen dieses Blocks (Ist) hätte vor dem Ende der letzten Aufnahme beginnen sollen. Liefert ihren Eintrag
 * (`seq`) und den Verzug in s; pünktlich, ohne Aufnahme im Block oder im Transit `null` (dann gilt die Planzeit).
 */
export function rigBehind(
  block: StoredBlock,
  ex: ExecutedNight | null,
  nowS: number,
): { readonly seq: number; readonly delayS: number } | null {
  if (block.kind === 'transit' || !ex) return null;
  if (!ex.blocks.some((x) => x.blockId === block.id && x.running)) return null;
  const segs = ex.segments.filter((s) => s.blockId === block.id);
  if (segs.length === 0) return null;
  const done = segs.reduce((n, s) => n + s.saved + s.failed, 0);
  const lastEnd = Math.max(...segs.map((s) => sec(s.endUtc)));
  const next = block.entries.filter((e) => e.cmd === 'expose')[done];
  if (!next || lastEnd > nowS) return null;
  const delayS = lastEnd - sec(next.atUtc);
  return delayS > 0 ? { seq: next.seq, delayS } : null;
}

/** Ende des letzten Autofokus der Nacht (Ereignis `af`, Zeit = Ende); ohne `null`. */
export function lastAutofocus(ex: ExecutedNight | null): number | null {
  const af = (ex?.events ?? []).filter((e) => e.kind === 'af').map((e) => sec(e.atUtc));
  return af.length > 0 ? Math.max(...af) : null;
}

/** Kommender Eintrag eines gespeicherten Blocks mit Zeit nach dem Verzug und Zustand der Spalte „Ist“. */
export interface UpcomingEntry {
  readonly entry: StoredEntry;
  readonly at: number;
  readonly to: number;
  /** Zeit gegenüber dem Plan verschoben (Rig liegt zurück). */
  readonly shifted: boolean;
  readonly state: 'planned' | 'skipped';
  readonly reason: string | null;
  readonly count: number | null;
}

/**
 * Kommende Einträge eines Blocks nach den Regeln des Plugins (AP-71, `Playback`):
 * - Liegt das Rig zurück (`behind`), rückt alles ab der laufenden Belichtung um den Verzug nach hinten; das Blockende
 *   bleibt fest.
 * - Ein `autofocus_hint` innerhalb von `afEveryMin / 2` nach dem letzten Autofokus entfällt (`af_recent`); seine Dauer
 *   geht vom Verzug ab (nie unter 0) – wie die Gutschrift im Plugin.
 * - Eine verschobene Belichtung, die nicht mehr bis Blockende + `LATE_GRACE_S` fertig wird, entfällt mit allen
 *   späteren Einträgen außer „Ende“; stattdessen je Filter eine Zeile „passt nicht mehr in den Block“ am Blockende.
 */
export function upcomingEntries(
  block: StoredBlock,
  behind: { readonly seq: number; readonly delayS: number } | null,
  lastAfS: number | null,
  afEveryMin: number,
): UpcomingEntry[] {
  const endS = sec(block.endUtc);
  let shift = behind ? behind.delayS : 0;
  const items: UpcomingEntry[] = [];
  const dropped = new Map<string, { entry: StoredEntry; n: number }>();
  let overflow = false;
  for (const e of block.entries) {
    if (behind && e.seq < behind.seq) continue;
    if (e.cmd === 'end') {
      items.push({
        entry: e,
        at: sec(e.atUtc),
        to: sec(e.atUtc),
        shifted: false,
        state: 'planned',
        reason: null,
        count: null,
      });
      continue;
    }
    const at = sec(e.atUtc) + shift;
    const len = isExpose(e.cmd) ? Math.max(e.exposureS ?? 0, e.durationS ?? 0) : (e.durationS ?? 0);
    const to = e.cmd === 'expose_series' ? sec(e.untilUtc ?? block.endUtc) : at + len;
    if (overflow) {
      if (e.cmd === 'expose') {
        const k = e.filter ?? '';
        dropped.set(k, { entry: dropped.get(k)?.entry ?? e, n: (dropped.get(k)?.n ?? 0) + 1 });
      }
      continue;
    }
    if (
      e.cmd === 'autofocus_hint' &&
      afEveryMin > 0 &&
      lastAfS !== null &&
      at - lastAfS < (afEveryMin * 60) / 2
    ) {
      items.push({
        entry: e,
        at,
        to: at,
        shifted: shift > 0,
        state: 'skipped',
        reason: 'af_recent',
        count: null,
      });
      shift = Math.max(0, shift - (e.durationS ?? 0));
      continue;
    }
    if (shift > 0 && e.cmd === 'expose' && to > endS + LATE_GRACE_S && e.seq !== behind?.seq) {
      overflow = true;
      dropped.set(e.filter ?? '', { entry: e, n: 1 });
      continue;
    }
    items.push({
      entry: e,
      at,
      to,
      shifted: shift > 0,
      state: 'planned',
      reason: null,
      count: null,
    });
  }
  if (!overflow) return items;
  // Nach der letzten noch passenden Belichtung entfallen auch Dither, Autofokus und Warten.
  const lastExpose = items.reduce((n, it, k) => (isExpose(it.entry.cmd) ? k : n), -1);
  const kept = items.filter((it, k) => k <= lastExpose || it.entry.cmd === 'end');
  const notes: UpcomingEntry[] = [...dropped.values()].map(({ entry, n }) => ({
    entry,
    at: endS,
    to: endS,
    shifted: true,
    state: 'skipped',
    reason: 'block_end',
    count: n,
  }));
  // Vor „Ende“ einsortieren: gleiche Zeit, Reihenfolge der Liste.
  const end = kept.findIndex((it) => it.entry.cmd === 'end');
  return end < 0 ? [...kept, ...notes] : [...kept.slice(0, end), ...notes, ...kept.slice(end)];
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
  // Nr. je Belichtungszeile (Projekt und Filter) über die ganze Nacht (07.10.2026): Ist-Abschnitte zählen ihre
  // gespeicherten Aufnahmen (Nr. = letzte des Abschnitts), Geplantes zählt weiter – vorher Ist ohne Nr., Plan ab 1.
  const numbers = new Map<string, number>();
  const lineKey = (projectId: string | null | undefined, filter: string | null | undefined) =>
    `${projectId ?? ''}|${filter ?? ''}`;
  const count = (key: string, n: number) => {
    const v = (numbers.get(key) ?? 0) + n;
    numbers.set(key, v);
    return v;
  };
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
      // Mit gespeicherter Aufnahme ist das Anfahren erledigt; „läuft“ zeigt dann die laufende Planzeile.
      actual: {
        state: b.running && b.exposures === 0 ? 'running' : 'done',
        reason: null,
        count: null,
        past: true,
      },
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
    const no =
      s.saved > 0 && block?.kind !== 'transit'
        ? count(lineKey(s.projectId, s.filter), s.saved)
        : null;
    rows.push({
      ...row({
        key: `ist:seg:${String(k)}`,
        blockId: s.blockId ?? '',
        projectId: s.projectId ?? '',
        cmd: block?.kind === 'transit' ? 'expose_series' : 'expose',
        atUtc: s.startUtc,
        untilUtc: s.endUtc,
        projectName: name(s.projectId, block?.title),
        no,
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
  // Transit-Serien ohne Nummer (wie simulation-view.ts).
  if (i.running) {
    if (i.stored) {
      // Offen: nicht beendet, nicht übersprungen, nicht vor dem zuletzt begonnenen Ist-Block (rig-night.ts).
      const open = openStoredBlocks(i.stored, ex, i.endedBlockIds, i.nowMs);
      const rawById = new Map(
        (i.stored.blocks as unknown as StoredBlock[]).map((b) => [b.id, b] as const),
      );
      let runningSeen = false;
      const lastAutofocusS = lastAutofocus(ex);
      for (const b of open as unknown as StoredBlock[]) {
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
        // Ungekürzte Einträge: die gerade laufende Zeile (Belichtung, Warten, Flip …) begann vor jetzt und fehlt im
        // gekürzten Block – sie steht als „läuft“ mit ihrer Planzeit; die Nr. zählt sie mit (wie das Plugin-Fenster).
        const raw = rawById.get(b.id) ?? b;
        const behind = rigBehind(raw, ex, nowS);
        for (const it of upcomingEntries(raw, behind, lastAutofocusS, i.afEveryMin ?? 0)) {
          const e = it.entry;
          const isRunning = behind
            ? e.seq === behind.seq
            : !runningSeen && e.cmd !== 'end' && it.at < nowS && it.to > nowS;
          if (!behind && it.at < nowS && e.cmd !== 'end' && !isRunning) continue;
          if (isRunning) runningSeen = true;
          const counted = e.cmd === 'expose' && it.state === 'planned';
          rows.push({
            ...row({
              key: `${b.id}:${String(e.seq)}`,
              blockId: b.id,
              projectId: b.projectId,
              cmd: e.cmd,
              atUtc: it.shifted ? new Date(it.at * 1000).toISOString() : e.atUtc,
              untilUtc: e.untilUtc ?? null,
              durationS: e.durationS ?? null,
              projectName: name(b.projectId),
              no: counted ? count(lineKey(b.projectId, e.filter), 1) : null,
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
              ...(i.sky ? i.sky(b, e) : {}),
            }),
            actual: {
              state: isRunning ? 'running' : it.state,
              reason: it.reason,
              count: it.count,
              past: false,
            },
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
          rows.push({
            ...r,
            no: r.cmd === 'expose' ? count(lineKey(r.projectId, r.filter), 1) : r.no,
            actual: { state: 'planned', reason: null, count: null, past: false },
          });
    }
  }

  // Flats als Zeile wie im Plugin-Fenster (Rig-Nacht 09./10.10.2026: das Web endete mit dem letzten Blockende).
  if (i.running && i.flatsAtUtc && sec(i.flatsAtUtc) >= nowS)
    rows.push({
      ...row({ key: 'flats', cmd: 'flats', atUtc: i.flatsAtUtc }),
      actual: { state: 'planned', reason: null, count: null, past: false },
    });

  const outline: OutlineBlock[] = ((i.first?.blocks ?? []) as unknown as StoredBlock[]).map(
    (b) => ({
      fromUtc: sec(b.startUtc),
      toUtc: sec(b.endUtc),
      color: i.colorOfProject(b.projectId),
    }),
  );
  // Eine laufende Planzeile trägt den Laufzeiger – der Blockstart im Ist ist dann erledigt.
  if (rows.some((r) => !r.actual?.past && r.actual?.state === 'running'))
    for (const [n, r] of rows.entries())
      if (r.actual?.past && r.actual.state === 'running')
        rows[n] = { ...r, actual: { ...r.actual, state: 'done' } };
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
