/**
 * Ist einer Nacht (AP-53c, FA-SIM-10) aus den Session-Ereignissen und Light-Aufnahmen aller Sessions eines Rigs –
 * dieselben Regeln wie das Nachtjournal des Plugins (`NightViewBuilder`, AP-53b, execution.md §10.1):
 * - Blöcke von `block_start` (Beginn des Anfahrens) bis `block_end`; Plugins vor 0.4.13 melden keine Blöcke – dann
 *   ergibt sich der Block aus seinen Aufnahmen (erste bis letzte, `capture.block_id`). Sein Beginn ist dann der Beginn
 *   des Blocks im gespeicherten Plan, sofern der höchstens `DERIVED_LEAD_MAX_S` vor der ersten Aufnahme liegt und nicht
 *   in den vorigen Block reicht – sonst stünden Anfahren, Zentrieren und Autofokus als roter „Leerlauf“ da (07.10.2026).
 * - Blöcke ohne Belichtung, die im Abstand ≤ 2 min mit demselben Grund aufeinander folgen (z. B. die
 *   `transit_interrupt`-Schleife der Rig-Nacht 06./07.10.2026), werden **eine** Lücke „n leere Blöcke“; ein einzelner
 *   kurzer leerer Block bleibt ein Block mit 0 Aufnahmen.
 * - Lücken zwischen erledigten Blöcken ab 2 min: Safety-Pause, übersprungene Blöcke (mit Grund), sonst Leerlauf; der
 *   Flip ist eine eigene Lücke (Ende = Zeitpunkt des Ereignisses, Beginn = Ende − Dauer).
 * - Filterabschnitte: aufeinanderfolgende Aufnahmen gleichen Blocks und Filters, Pause ≤ 15 min.
 * Rein: keine Uhr, keine I/O – `now` und `running` kommen vom Aufrufer.
 */
import type {
  ExecutedBlock,
  ExecutedEvent,
  ExecutedGap,
  ExecutedNight,
  ExecutedSegment,
} from './contracts/executed';
import { executedEventKinds } from './contracts/executed';

export interface ActualEventRow {
  readonly occurredAt: string;
  readonly kind: string;
  readonly blockId: string | null;
  readonly projectId: string | null;
  readonly nightPlanId: string | null;
  readonly durationS: number | null;
  readonly data: Readonly<Record<string, unknown>> | null;
}

export interface ActualLightRow {
  readonly capturedAt: string;
  readonly exposureS: number;
  readonly result: string;
  readonly filter: string;
  readonly blockId: string | null;
  readonly projectId: string | null;
  readonly panelId: string | null;
  readonly nightPlanId: string | null;
}

export interface ExecutedNightOptions {
  readonly night: string;
  readonly sessions: number;
  readonly events: readonly ActualEventRow[];
  readonly lights: readonly ActualLightRow[];
  /** Eine Session der Nacht läuft noch (offener letzter Block darf „läuft“ sein). */
  readonly running: boolean;
  readonly now: string;
  /** Projektnamen (Titel, wenn das Plugin keinen meldet). */
  readonly names: ReadonlyMap<string, string>;
  /** Art je Block-ID aus den gespeicherten Planrevisionen (für Blöcke ohne `block_start`). */
  readonly blockKinds?: ReadonlyMap<string, 'regular' | 'transit'>;
  /** Geplanter Beginn je Block-ID aus den gespeicherten Planrevisionen (Blöcke ohne `block_start`, Plugin vor 0.4.13). */
  readonly blockStarts?: ReadonlyMap<string, string>;
}

export const GAP_MIN_S = 120;
export const EMPTY_MERGE_MAX_S = 120;
export const BAR_SPLIT_S = 900;
/** Ein offener Block gilt nur so lange als laufend, wie es Aktivität gibt. */
export const RUNNING_STALE_S = 1800;
/** Höchstens so lange vor der ersten Aufnahme beginnt ein aus Aufnahmen abgeleiteter Block (Anfahren, Autofokus). */
export const DERIVED_LEAD_MAX_S = 1200;

const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Work {
  blockId: string | null;
  nightPlanId: string | null;
  projectId: string;
  panelId: string | null;
  title: string;
  kind: 'regular' | 'transit';
  start: number;
  end: number | null;
  endReason: string | null;
  exposures: number;
  running: boolean;
  lastActivity: number;
}

export function executedNight(o: ExecutedNightOptions): ExecutedNight {
  const now = ms(o.now);
  const events = [...o.events].sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt));
  const lights = [...o.lights].sort((a, b) => ms(a.capturedAt) - ms(b.capturedAt));
  const lightEnd = (l: ActualLightRow) => ms(l.capturedAt) + l.exposureS * 1000;

  // ---- Blöcke ----
  const blocks: Work[] = [];
  const open = new Map<string, Work>();
  const reported = new Set<string>();
  for (const e of events) {
    if (e.kind === 'block_start' && e.blockId && e.projectId) {
      const d = e.data ?? {};
      const panel = str(d.panelId);
      const b: Work = {
        blockId: e.blockId,
        nightPlanId: e.nightPlanId,
        projectId: e.projectId,
        panelId: panel && UUID.test(panel) ? panel : null,
        title: str(d.title) ?? o.names.get(e.projectId) ?? '',
        kind:
          d.kind === 'transit' || o.blockKinds?.get(e.blockId) === 'transit'
            ? 'transit'
            : 'regular',
        start: ms(e.occurredAt),
        end: null,
        endReason: null,
        exposures: 0,
        running: false,
        lastActivity: ms(e.occurredAt),
      };
      blocks.push(b);
      open.set(e.blockId, b);
      reported.add(e.blockId);
    } else if (e.kind === 'block_end' && e.blockId) {
      const b = open.get(e.blockId);
      if (!b) continue;
      open.delete(e.blockId);
      b.end = ms(e.occurredAt);
      b.endReason = str(e.data?.code);
      b.lastActivity = b.end;
    }
  }
  // Belichtungen je Block; Blöcke ohne block_start (Plugin vor 0.4.13) aus den Aufnahmen.
  const derived = new Map<string, Work>();
  for (const l of lights) {
    if (!l.blockId) continue;
    const work = reported.has(l.blockId) ? blocks.filter((b) => b.blockId === l.blockId) : [];
    const target =
      work.find(
        (b) =>
          ms(l.capturedAt) >= b.start - 60_000 && (b.end === null || ms(l.capturedAt) <= b.end),
      ) ?? work.at(-1);
    if (target) {
      if (l.result === 'saved') target.exposures++;
      target.lastActivity = Math.max(target.lastActivity, lightEnd(l));
      continue;
    }
    if (reported.has(l.blockId) || !l.projectId) continue;
    let d = derived.get(l.blockId);
    if (!d) {
      d = {
        blockId: l.blockId,
        nightPlanId: l.nightPlanId,
        projectId: l.projectId,
        panelId: l.panelId,
        title: o.names.get(l.projectId) ?? '',
        kind: o.blockKinds?.get(l.blockId) ?? 'regular',
        start: ms(l.capturedAt),
        end: lightEnd(l),
        endReason: null,
        exposures: 0,
        running: false,
        lastActivity: lightEnd(l),
      };
      derived.set(l.blockId, d);
      blocks.push(d);
    }
    d.end = Math.max(d.end ?? 0, lightEnd(l));
    d.lastActivity = d.end;
    if (l.result === 'saved') d.exposures++;
  }
  // Ereignisse im Block (Flip, übersprungene Belichtung, Autofokus) zählen als Aktivität.
  for (const e of events) {
    const b = e.blockId ? open.get(e.blockId) : undefined;
    if (b && ms(e.occurredAt) >= b.start)
      b.lastActivity = Math.max(b.lastActivity, ms(e.occurredAt));
  }
  blocks.sort((a, b) => a.start - b.start);
  // Abgeleitete Blöcke: Beginn laut gespeichertem Plan (Anfahren, Zentrieren, Autofokus vor der ersten Aufnahme), nie
  // früher als DERIVED_LEAD_MAX_S vor ihr und nie vor dem Ende des vorigen Blocks.
  for (const [k, b] of blocks.entries()) {
    const planned =
      b.blockId && derived.get(b.blockId) === b ? o.blockStarts?.get(b.blockId) : undefined;
    if (!planned) continue;
    const prev = blocks[k - 1];
    const from = Math.max(
      ms(planned),
      b.start - DERIVED_LEAD_MAX_S * 1000,
      prev?.end ?? prev?.start ?? 0,
    );
    if (from < b.start) b.start = from;
  }
  const lastStarted = blocks.at(-1);
  const live = (b: Work) =>
    o.running && b === lastStarted && now - b.lastActivity <= RUNNING_STALE_S * 1000;
  for (const b of open.values()) {
    if (live(b)) b.running = true;
    else b.end = Math.max(b.start, b.lastActivity);
  }
  // Plugin vor 0.4.13: der zuletzt begonnene Block aus den Aufnahmen läuft ebenso noch – sonst gilt er im Web als
  // erledigt, und der Rest des gespeicherten Plans (SII ×6 ab 05:00) fehlt (Rig-Nacht 06./07.10.2026, Plugin 0.4.10).
  for (const b of derived.values()) if (live(b)) b.running = true;

  // ---- leere Blöcke → Lücken ----
  const closed = blocks.filter((b) => !b.running);
  const full = closed.filter((b) => b.exposures > 0);
  const runs: {
    from: number;
    to: number;
    reason: string | null;
    count: number;
    blocks: Work[];
  }[] = [];
  for (const b of closed.filter((x) => x.exposures === 0)) {
    const to = b.end ?? b.start;
    const last = runs.at(-1);
    if (last && b.start - last.to <= EMPTY_MERGE_MAX_S * 1000 && last.reason === b.endReason) {
      last.to = to;
      last.count++;
      last.blocks.push(b);
    } else runs.push({ from: b.start, to, reason: b.endReason, count: 1, blocks: [b] });
  }
  const empty = runs.filter((r) => r.count > 1 || r.to - r.from >= GAP_MIN_S * 1000);
  // Ein einzelner kurzer Block ohne Aufnahme (Anfahren, Zentrieren, dann leer – Rig-Nacht 09./10.10.2026, 01:58) ist
  // keine Lücke, bleibt aber als Block sichtbar, statt ganz zu verschwinden.
  const lonelyEmpty = new Set(runs.filter((r) => !empty.includes(r)).flatMap((r) => r.blocks));

  const gaps: ExecutedGap[] = empty.map((g) => ({
    kind: 'empty_blocks',
    fromUtc: iso(g.from),
    toUtc: iso(g.to),
    reason: g.reason,
    count: g.count,
  }));
  const safety = events.filter((e) => e.kind === 'safety_pause').map((e) => ms(e.occurredAt));
  const skippedBlocks = events.filter((e) => e.kind === 'block_skipped');
  const spans = [
    ...full.map((b) => ({ from: b.start, to: b.end ?? b.start })),
    ...empty.map((g) => ({ from: g.from, to: g.to })),
    ...blocks.filter((b) => b.running).map((b) => ({ from: b.start, to: now })),
  ].sort((a, b) => a.from - b.from);
  for (const [k, span] of spans.entries()) {
    const prev = spans[k - 1];
    if (!prev) continue;
    const from = prev.to;
    const to = span.from;
    if (to - from < GAP_MIN_S * 1000) continue;
    const inGap = (t: number) => t >= from && t <= to;
    const skips = skippedBlocks.filter((e) => inGap(ms(e.occurredAt)));
    const kind = safety.some(inGap) ? 'safety' : skips.length > 0 ? 'skipped' : 'idle';
    gaps.push({
      kind,
      fromUtc: iso(from),
      toUtc: iso(to),
      reason: kind === 'skipped' ? str(skips.at(-1)?.data?.code) : null,
      count: kind === 'skipped' ? skips.length : 1,
    });
  }
  for (const f of events.filter((e) => e.kind === 'flip')) {
    const at = ms(f.occurredAt);
    gaps.push({
      kind: 'flip',
      fromUtc: iso(at - (f.durationS ?? 0) * 1000),
      toUtc: iso(at),
      reason: null,
      count: 1,
    });
  }
  gaps.sort((a, b) => ms(a.fromUtc) - ms(b.fromUtc));

  // ---- Filterabschnitte ----
  const segments: ExecutedSegment[] = [];
  let seg: { s: ExecutedSegment; key: string; end: number } | null = null;
  for (const l of lights) {
    const key = `${l.blockId ?? l.projectId ?? ''}|${l.filter}`;
    const start = ms(l.capturedAt);
    if (seg && seg.key === key && start - seg.end <= BAR_SPLIT_S * 1000) {
      seg.end = Math.max(seg.end, lightEnd(l));
      seg.s.endUtc = iso(seg.end);
    } else {
      seg = {
        key,
        end: lightEnd(l),
        s: {
          blockId: l.blockId,
          projectId: l.projectId,
          filter: l.filter,
          startUtc: iso(start),
          endUtc: iso(lightEnd(l)),
          saved: 0,
          failed: 0,
          exposureS: l.exposureS,
        },
      };
      segments.push(seg.s);
    }
    if (l.result === 'saved') seg.s.saved++;
    else seg.s.failed++;
  }

  // ---- Ereignisse und Zähler ----
  const kinds = new Set<string>(executedEventKinds);
  // Wiederholter Planabruf mit unveränderter Revision (der Server verwendet eine inhaltsgleiche wieder, Analyse
  // 07.10.2026): keine neue Markierung, nur die erste Meldung je `nightPlanId` und Revision in Folge.
  let lastPlan: string | null = null;
  const repeatedPlan = (e: ActualEventRow) => {
    if (e.kind !== 'plan_built' && e.kind !== 'plan_rebuilt') return false;
    const key = `${e.nightPlanId ?? ''}|${String(e.data?.revision ?? '')}`;
    const repeated = e.nightPlanId !== null && key === lastPlan;
    lastPlan = key;
    return repeated;
  };
  const outEvents: ExecutedEvent[] = events
    .filter((e) => kinds.has(e.kind) && !repeatedPlan(e))
    .map((e) => ({
      kind: e.kind as ExecutedEvent['kind'],
      atUtc: iso(ms(e.occurredAt)),
      blockId: e.blockId,
      projectId: e.projectId,
      code: str(e.data?.code) ?? str(e.data?.reason),
      // Filter des Autofokus (Plugin ≥ 0.4.21: Filter der Belichtung bzw. des Auslösers).
      filter: e.kind === 'af' ? str(e.data?.filter) : null,
      durationS: e.durationS,
      revision:
        typeof e.data?.revision === 'number' && e.data.revision >= 1
          ? Math.trunc(e.data.revision)
          : null,
    }));

  const outBlocks: ExecutedBlock[] = blocks
    .filter((b) => b.running || b.exposures > 0 || lonelyEmpty.has(b))
    .map((b) => ({
      blockId: b.blockId,
      nightPlanId: b.nightPlanId,
      projectId: b.projectId,
      panelId: b.panelId,
      title: b.title,
      kind: b.kind,
      startUtc: iso(b.start),
      endUtc: b.running ? null : iso(b.end ?? b.start),
      endReason: b.endReason,
      exposures: b.exposures,
      running: b.running,
    }));

  return {
    night: o.night,
    sessions: o.sessions,
    blocks: outBlocks,
    segments,
    events: outEvents,
    gaps,
    counters: {
      saved: lights.filter((l) => l.result === 'saved').length,
      skipped: events.filter((e) => e.kind === 'skipped_timeaware').length,
      failed: lights.filter((l) => l.result !== 'saved').length,
    },
  };
}
