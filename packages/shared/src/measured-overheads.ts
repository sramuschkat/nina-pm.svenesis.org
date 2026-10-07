/**
 * Gemessene Overheads je Rig (AP-65, FA-RIG-04b): aus dem Ist der Nächte (Session-Ereignisse und Light-Aufnahmen,
 * Plugin ≥ 0.4.13 mit `block_start`) misst der Server, was das Rig zwischen den Belichtungen wirklich kostet. Die Engine
 * plant ab `MEASURED_MIN_SAMPLES` Messungen mit dem Median (ganze Sekunden), vorher und mit Schalter „fest“ mit dem
 * getippten Wert. Rein und deterministisch: Zeiten kommen als Millisekunden vom Aufrufer, keine Uhr, keine I/O.
 *
 * Messregeln (Brief AP-65, Teil A):
 * - **Anfahren + Zentrieren** (`slewCenterS`): `block_start.data.slewCenterS` (Plugin ≥ 0.4.19) = Beginn des Anfahrens
 *   bis Ende des Zentrieren; fehlt bei übersprungenem Slew (gleiches Ziel). Mit Autofokus, Flip oder Safety-Pause darin
 *   und über 30 min verworfen. **Abweichung vom Brief** („`block_start` → erste Belichtung“): Im zeitgeführten Playback
 *   wartet das Plugin nach dem Zentrieren auf den geplanten Beginn der ersten Belichtung, z. B. auf einen geplanten
 *   Autofokus, den NINA dann nicht ausführt – im kopflosen Lauf `real-rig-newmoon` ergab die Brief-Regel 300 s statt der
 *   simulierten 35 s. Ältere Plugins liefern deshalb keine Anfahr-Messung.
 * - **Meridian-Flip** (`flipDurationS`): `flip.durationS` abzüglich der Autofokus-Läufe im Flip (Autofokus nach dem Flip,
 *   seit Plugin 0.4.19 als `af` gemeldet).
 * - **Autofokus** (`afDurationS`): `af.durationS` erfolgreicher Läufe (Plugin ≥ 0.4.19).
 * - **Download** (`downloadS`), **Dither** (`ditherSettleS`), **Filterwechsel** (`filterChangeS`): Abstand zweier
 *   aufeinanderfolgender Lights im selben Block, Start(n+1) − Ende(n). Ob dazwischen gedithert wurde, folgt der Regel
 *   der Engine aus den Rig-Einstellungen (alle `ditherEvery` Belichtungen seit Blockbeginn, Filterwechsel bzw. Flip;
 *   Transitblöcke nie). Gleicher Filter ohne Dither → Download; mit Dither → Abstand − Download-Median; Filterwechsel →
 *   Abstand − Download-Median (− Dither-Median, wenn auch gedithert wurde). Abstände mit Ereignis dazwischen (Autofokus,
 *   Flip, Safety, Neuplanung, übersprungene Belichtung) und über 10 min verworfen.
 * - Je Wert die letzten `MEASURED_WINDOW` Messungen (rollierend, nach Zeit), Median sowie p25/p75 (lineare
 *   Interpolation), auf 0,1 s gerundet.
 */
import type {
  MeasuredOverheads,
  MeasuredOverheadStat,
  RigOverheadsView,
  RigOverheadValue,
  SchedulerSettings,
} from './contracts/equipment';
import { overheadValueKeys, type OverheadValueKey } from './generated/enums';

/** Ab so vielen Messungen wirkt der gemessene Wert (Entscheidung Sven 07.10.2026). */
export const MEASURED_MIN_SAMPLES = 10;
/** Rollierendes Fenster je Wert. */
export const MEASURED_WINDOW = 40;
/** Nächte je Rig, aus denen gemessen wird. */
export const MEASURED_NIGHTS = 30;
export const SLEW_CENTER_MAX_S = 1800;
export const LIGHT_GAP_MAX_S = 600;
/** Hinweis in S-10, wenn gemessen mehr als `DEVIATION_FACTOR` × getippt (bzw. weniger als getippt / Faktor). */
export const DEVIATION_FACTOR = 2;

/** Obergrenzen wie im Vertrag `Overhead`/`SchedulerSettings` – die Engine-Eingabe bleibt gültig. */
const MAX_S: Record<OverheadValueKey, number> = {
  slewCenterS: 3600,
  filterChangeS: 600,
  ditherSettleS: 600,
  afDurationS: 3600,
  downloadS: 600,
  flipDurationS: 3600,
};

export interface OverheadEvent {
  readonly atMs: number;
  readonly kind: string;
  readonly blockId: string | null;
  readonly projectId: string | null;
  readonly durationS: number | null;
  readonly data: Readonly<Record<string, unknown>> | null;
}

export interface OverheadLight {
  /** Belichtungsbeginn (`capture.captured_at`). */
  readonly startMs: number;
  readonly exposureS: number;
  readonly filter: string;
  readonly blockId: string | null;
  /** Transit-Aufnahme (`capture.transit_observation_id`): Serie ohne Dither. */
  readonly transit: boolean;
}

export interface OverheadNight {
  readonly night: string;
  readonly events: readonly OverheadEvent[];
  readonly lights: readonly OverheadLight[];
}

export interface MeasureOptions {
  readonly ditherEnabled: boolean;
  readonly ditherEvery: number;
  /** Rückfall, solange Download bzw. Dither keine eigene Messung haben (für Dither und Filterwechsel). */
  readonly typedDownloadS: number;
  readonly typedDitherSettleS: number;
}

export interface OverheadSample {
  readonly atMs: number;
  readonly valueS: number;
}

export type OverheadSamples = Record<OverheadValueKey, OverheadSample[]>;

/** Ereignisse, die einen Abstand zwischen zwei Lights unbrauchbar machen. */
const INTERRUPTING = new Set([
  'af',
  'flip',
  'flip_undetected',
  'safety_pause',
  'safety_resume',
  'plan_built',
  'plan_rebuilt',
  'skipped_timeaware',
  'block_start',
  'block_end',
  'block_skipped',
  'center_failed',
  'lease_lost',
  'offline_start',
  'offline_end',
]);

/** Ereignisse, die vor der ersten Belichtung eines Blocks die Anfahr-Messung unbrauchbar machen. */
const SLEW_BLOCKERS = new Set(['af', 'flip', 'flip_undetected', 'safety_pause', 'safety_resume']);

/** Zeitspanne eines Ereignisses: Autofokus und Flip enden mit dem Ereignis (Beginn = Ende − Dauer). */
function span(e: OverheadEvent): { from: number; to: number } {
  const d = e.durationS !== null && e.durationS > 0 ? e.durationS * 1000 : 0;
  return e.kind === 'af' || e.kind === 'flip'
    ? { from: e.atMs - d, to: e.atMs }
    : { from: e.atMs, to: e.atMs };
}

const overlaps = (s: { from: number; to: number }, from: number, to: number) =>
  s.to >= from && s.from <= to;

const afFailed = (e: OverheadEvent) =>
  e.data?.result === 'failed' || e.data?.code === 'failed' || e.data?.ok === false;

const round1 = (x: number) => Math.round(x * 10) / 10;

function quantile(sorted: readonly number[], p: number): number {
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

/** Median, Anzahl und p25/p75 der letzten `MEASURED_WINDOW` Messungen (nach Zeit, bei Gleichstand nach Wert). */
export function overheadStat(samples: readonly OverheadSample[]): MeasuredOverheadStat | null {
  if (samples.length === 0) return null;
  const recent = [...samples]
    .sort((a, b) => a.atMs - b.atMs || a.valueS - b.valueS)
    .slice(-MEASURED_WINDOW)
    .map((s) => s.valueS)
    .sort((a, b) => a - b);
  return {
    medianS: round1(quantile(recent, 0.5)),
    n: recent.length,
    p25S: round1(quantile(recent, 0.25)),
    p75S: round1(quantile(recent, 0.75)),
  };
}

const emptySamples = (): OverheadSamples => ({
  slewCenterS: [],
  filterChangeS: [],
  ditherSettleS: [],
  afDurationS: [],
  downloadS: [],
  flipDurationS: [],
});

interface RawGap {
  readonly atMs: number;
  readonly gapS: number;
  readonly kind: 'download' | 'dither' | 'filter';
  readonly dithered: boolean;
}

/** Messungen je Wert aus den Nächten (Reihenfolge der Nächte egal). */
export function overheadSamples(
  nights: readonly OverheadNight[],
  o: MeasureOptions,
): OverheadSamples {
  const out = emptySamples();
  const gaps: RawGap[] = [];
  for (const night of nights) {
    const events = [...night.events].sort((a, b) => a.atMs - b.atMs);
    const lights = [...night.lights].sort((a, b) => a.startMs - b.startMs);
    const afs = events.filter((e) => e.kind === 'af' && e.durationS !== null && e.durationS > 0);

    // ---- Autofokus ----
    for (const e of afs)
      if (!afFailed(e)) out.afDurationS.push({ atMs: e.atMs, valueS: e.durationS as number });

    // ---- Meridian-Flip (ohne Autofokus im Flip) ----
    for (const f of events) {
      if (f.kind !== 'flip' || f.durationS === null || f.durationS <= 0) continue;
      const fs = span(f);
      const inside = afs
        .map(span)
        .filter((a) => a.from >= fs.from - 1000 && a.to <= fs.to + 1000)
        .reduce((sum, a) => sum + (a.to - a.from) / 1000, 0);
      const v = f.durationS - inside;
      if (v > 0) out.flipDurationS.push({ atMs: f.atMs, valueS: v });
    }

    // ---- Anfahren + Zentrieren ----
    // Dauer aus `block_start.data.slewCenterS` (Plugin ≥ 0.4.19: Beginn des Anfahrens bis Ende des Zentrierens, ohne
    // Warten auf den Plan); fehlt sie, entfiel der Slew oder das Plugin ist älter – dann keine Messung (siehe Kopf).
    const transitBlocks = new Set(
      lights.filter((l) => l.transit && l.blockId).map((l) => l.blockId as string),
    );
    for (const bs of events) {
      if (bs.kind !== 'block_start') continue;
      const v = bs.data?.slewCenterS;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > SLEW_CENTER_MAX_S) continue;
      const to = bs.atMs + v * 1000;
      if (events.some((e) => SLEW_BLOCKERS.has(e.kind) && overlaps(span(e), bs.atMs, to))) continue;
      out.slewCenterS.push({ atMs: bs.atMs, valueS: v });
    }

    // ---- Abstände zwischen Lights im selben Block ----
    const byBlock = new Map<string, OverheadLight[]>();
    for (const l of lights) {
      if (!l.blockId) continue;
      const list = byBlock.get(l.blockId) ?? [];
      list.push(l);
      byBlock.set(l.blockId, list);
    }
    const blockIds = [...byBlock.keys()].sort();
    const flips = events.filter((e) => e.kind === 'flip' || e.kind === 'flip_undetected');
    for (const id of blockIds) {
      const list = byBlock.get(id) ?? [];
      const transit = transitBlocks.has(id);
      let count = 0;
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i] as OverheadLight;
        const b = list[i + 1] as OverheadLight;
        const aEnd = a.startMs + a.exposureS * 1000;
        count++;
        // Regel der Engine (walk.ts): Dither nach `ditherEvery` Belichtungen seit Blockbeginn/Filterwechsel/Flip.
        const dithered = !transit && o.ditherEnabled && o.ditherEvery > 0 && count >= o.ditherEvery;
        if (dithered) count = 0;
        const filterChange = a.filter !== b.filter;
        if (filterChange) count = 0;
        if (flips.some((f) => overlaps(span(f), aEnd, b.startMs))) count = 0;
        const gapS = (b.startMs - aEnd) / 1000;
        if (gapS < 0 || gapS > LIGHT_GAP_MAX_S) continue;
        if (events.some((e) => INTERRUPTING.has(e.kind) && overlaps(span(e), aEnd, b.startMs)))
          continue;
        gaps.push({
          atMs: b.startMs,
          gapS,
          kind: filterChange ? 'filter' : dithered ? 'dither' : 'download',
          dithered,
        });
      }
    }
  }

  // ---- Download zuerst, dann Dither, dann Filterwechsel (jeweils abzüglich der Mediane davor) ----
  for (const g of gaps)
    if (g.kind === 'download') out.downloadS.push({ atMs: g.atMs, valueS: g.gapS });
  const download = overheadStat(out.downloadS)?.medianS ?? o.typedDownloadS;
  for (const g of gaps)
    if (g.kind === 'dither')
      out.ditherSettleS.push({ atMs: g.atMs, valueS: Math.max(0, g.gapS - download) });
  const dither = overheadStat(out.ditherSettleS)?.medianS ?? o.typedDitherSettleS;
  for (const g of gaps)
    if (g.kind === 'filter')
      out.filterChangeS.push({
        atMs: g.atMs,
        valueS: Math.max(0, g.gapS - download - (g.dithered ? dither : 0)),
      });
  return out;
}

/** Messung je Wert (Median, n, p25/p75) aus den Nächten. */
export function measuredOverheads(
  nights: readonly OverheadNight[],
  o: MeasureOptions,
): MeasuredOverheads['values'] {
  const s = overheadSamples(nights, o);
  return {
    slewCenterS: overheadStat(s.slewCenterS),
    filterChangeS: overheadStat(s.filterChangeS),
    ditherSettleS: overheadStat(s.ditherSettleS),
    afDurationS: overheadStat(s.afDurationS),
    downloadS: overheadStat(s.downloadS),
    flipDurationS: overheadStat(s.flipDurationS),
  };
}

type Scheduler = Pick<SchedulerSettings, 'overhead' | 'flipDurationS' | 'overheadFixed'>;

const typedOf = (s: Scheduler, key: OverheadValueKey): number =>
  key === 'flipDurationS' ? s.flipDurationS : s.overhead[key];

/**
 * Getippt, gemessen und wirksam je Wert (S-10, Engine-Eingabe): gemessen wirkt ab `MEASURED_MIN_SAMPLES` Messungen und
 * ohne Schalter „fest“, als Median auf ganze Sekunden gerundet (höchstens die Vertragsgrenze).
 */
export function rigOverheads(
  scheduler: Scheduler,
  measured: MeasuredOverheads | null,
): RigOverheadsView {
  const fixed = new Set(scheduler.overheadFixed ?? []);
  const values: RigOverheadValue[] = overheadValueKeys.map((key) => {
    const typedS = typedOf(scheduler, key);
    const m = measured?.values[key] ?? null;
    const enough = m !== null && m.n >= MEASURED_MIN_SAMPLES;
    const isFixed = fixed.has(key);
    const useMeasured = enough && !isFixed;
    const effectiveS = useMeasured ? Math.min(MAX_S[key], Math.round(m.medianS)) : typedS;
    const deviates =
      enough &&
      (m.medianS > DEVIATION_FACTOR * typedS ||
        (typedS > 0 && m.medianS * DEVIATION_FACTOR < typedS));
    return {
      key,
      typedS,
      measured: m,
      effectiveS,
      source: useMeasured ? 'measured' : 'typed',
      fixed: isFixed,
      deviates,
    };
  });
  return {
    minSamples: MEASURED_MIN_SAMPLES,
    computedAtUtc: measured?.computedAtUtc ?? null,
    fromNight: measured?.fromNight ?? null,
    toNight: measured?.toNight ?? null,
    nights: measured?.nights ?? 0,
    values,
  };
}

/**
 * Scheduler-Einstellungen mit den wirksamen Overheads (Engine-Eingabe, AP-65 Teil B): `overhead.*` und `flipDurationS`
 * aus `overheads.values[].effectiveS`; ohne `overheads` unverändert. Alle übrigen Felder bleiben.
 */
export function effectiveScheduler<S extends Scheduler>(
  scheduler: S,
  overheads: RigOverheadsView | undefined,
): S {
  if (!overheads) return scheduler;
  const eff = new Map(overheads.values.map((v) => [v.key, v.effectiveS]));
  const get = (key: OverheadValueKey) => eff.get(key) ?? typedOf(scheduler, key);
  return {
    ...scheduler,
    flipDurationS: get('flipDurationS'),
    overhead: {
      ...scheduler.overhead,
      slewCenterS: get('slewCenterS'),
      filterChangeS: get('filterChangeS'),
      ditherSettleS: get('ditherSettleS'),
      afDurationS: get('afDurationS'),
      downloadS: get('downloadS'),
    },
  };
}

/** Rig-Ansicht mit wirksamen Overheads in `scheduler` (für Engine-Eingaben; `overheads` bleibt zur Anzeige). */
export function effectiveRig<R extends { scheduler: Scheduler; overheads?: RigOverheadsView }>(
  rig: R,
): R {
  return rig.overheads
    ? { ...rig, scheduler: effectiveScheduler(rig.scheduler, rig.overheads) }
    : rig;
}
