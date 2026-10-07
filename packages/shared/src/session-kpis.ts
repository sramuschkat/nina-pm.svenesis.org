/**
 * Kennzahlen und Abweichungsgründe einer Session (AP-31; FA-AUS-04, FA-AUS-05, FA-AUS-09). Rein: Eingabe
 * sind Session-Zeiten, der erste Plan der Session (Dunkelheit, Belichtungseinträge), alle Lights **dieser**
 * Session und ihre Ereignisse – ohne Datenbank und ohne Uhr.
 */
import type { NightSessionKpis, NightSessionReason } from './contracts/sessions';
import type { DeviationReason } from './generated/enums';

export interface KpiLight {
  readonly capturedAt: string;
  readonly exposureS: number;
  readonly result: string;
  readonly isBonus: boolean;
  readonly assigned: boolean;
  readonly filter: string;
  readonly blockId: string | null;
  /** Aufnahme einer Zeile, die im ersten Plan als Transit-Serie steht: zählt in der Zeit, nicht in den Frames. */
  readonly series?: boolean | undefined;
}

export interface KpiEvent {
  readonly kind: string;
  readonly occurredAt: string;
  readonly durationS: number | null;
}

/**
 * Belichtungseintrag des ersten Plans: `expose` (ein Frame, `bonus` = Bonus-Frame) oder `expose_series`
 * (Transit, Zeitraum).
 */
export interface KpiPlanEntry {
  readonly cmd: 'expose' | 'expose_series';
  readonly atUtc: string;
  readonly untilUtc?: string | undefined;
  readonly exposureS: number;
  readonly bonus?: boolean | undefined;
}

export interface KpiInput {
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** Astronomische Dunkelheit laut erstem Plan; `null` ohne Plan oder ohne astronomische Nacht. */
  readonly darkness: { readonly fromUtc: string | null; readonly toUtc: string | null } | null;
  /** Belichtungseinträge des ersten Plans; `null` ohne Plan. */
  readonly planEntries: readonly KpiPlanEntry[] | null;
  readonly lights: readonly KpiLight[];
  readonly events: readonly KpiEvent[];
}

const ms = (iso: string) => Date.parse(iso);
const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null);

/**
 * Effizienz einer Session ohne Ereignisse und Aufnahmenliste (AP-64, Liste der Nächte): dieselbe Rechnung wie
 * `sessionKpis` – nutzbare Dunkelzeit = Laufzeit ∩ astronomische Dunkelheit des ersten Plans, Belichtung gespeicherter
 * Lights. `null`, solange die Session läuft oder ohne Dunkelheit im Plan.
 */
export function sessionEfficiency(input: {
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly darkness: { readonly fromUtc: string | null; readonly toUtc: string | null } | null;
  readonly exposureS: number;
}): { exposureS: number; usableDarkS: number; pct: number | null } | null {
  const from = input.darkness?.fromUtc ?? null;
  const to = input.darkness?.toUtc ?? null;
  if (input.endedAt === null || from === null || to === null) return null;
  const usableDarkS =
    Math.max(0, Math.min(ms(input.endedAt), ms(to)) - Math.max(ms(input.startedAt), ms(from))) /
    1000;
  return { exposureS: input.exposureS, usableDarkS, pct: pct(input.exposureS, usableDarkS) };
}

/**
 * Dauer gepaarter Ereignisse (Beginn → Ende), in zeitlicher Reihenfolge; ein offenes Paar endet am
 * Sessionende, ohne Sessionende zählt es nicht.
 */
function paired(
  events: readonly KpiEvent[],
  start: string,
  end: string,
  sessionEnd: number | null,
): { count: number; seconds: number } {
  let count = 0;
  let seconds = 0;
  let open: number | null = null;
  for (const e of events) {
    if (e.kind === start) {
      if (open === null) {
        open = ms(e.occurredAt);
        count += 1;
      }
    } else if (e.kind === end && open !== null) {
      seconds += Math.max(0, ms(e.occurredAt) - open) / 1000;
      open = null;
    }
  }
  if (open !== null && sessionEnd !== null) seconds += Math.max(0, sessionEnd - open) / 1000;
  return { count, seconds };
}

const sumDuration = (events: readonly KpiEvent[], kind: string) => {
  const list = events.filter((e) => e.kind === kind);
  const known = list.filter((e) => e.durationS !== null);
  return {
    count: list.length,
    seconds: known.reduce((s, e) => s + (e.durationS ?? 0), 0),
    measured: known.length > 0,
  };
};

/** Anzahl Wechsel in einer Folge (A A B A → 2). */
const changes = (xs: readonly (string | null)[]) => {
  let n = 0;
  let prev: string | null | undefined;
  for (const x of xs) {
    if (x === null) continue;
    if (prev !== undefined && prev !== null && x !== prev) n += 1;
    prev = x;
  }
  return n;
};

export function sessionKpis(input: KpiInput): {
  kpis: NightSessionKpis;
  reasons: NightSessionReason[];
} {
  const events = [...input.events].sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt));
  const lights = [...input.lights].sort((a, b) => ms(a.capturedAt) - ms(b.capturedAt));
  const start = ms(input.startedAt);
  const end = input.endedAt === null ? null : ms(input.endedAt);
  const runtimeS = end === null ? null : Math.max(0, end - start) / 1000;

  const darkFrom = input.darkness?.fromUtc ?? null;
  const darkTo = input.darkness?.toUtc ?? null;
  const usableDarkS =
    end === null || darkFrom === null || darkTo === null
      ? null
      : Math.max(0, Math.min(end, ms(darkTo)) - Math.max(start, ms(darkFrom))) / 1000;

  const saved = lights.filter((l) => l.result === 'saved');
  const exposureS = saved.reduce((s, l) => s + l.exposureS, 0);

  const safety = paired(events, 'safety_pause', 'safety_resume', end);
  const transit = paired(events, 'transit_start', 'transit_end', end);
  const af = sumDuration(events, 'af');
  const flip = sumDuration(events, 'flip');

  let overhead: NightSessionKpis['overhead'] = null;
  if (runtimeS !== null) {
    const base = Math.max(0, runtimeS - safety.seconds);
    const idle = Math.max(0, base - exposureS);
    overhead = {
      autofocusS: af.seconds,
      flipS: flip.seconds,
      otherS: Math.max(0, idle - af.seconds - flip.seconds),
      pct: base > 0 ? Math.min(100, round1((idle / base) * 100)) : 0,
    };
  }

  const blockStarts = events.filter((e) => e.kind === 'block_start').length;
  const blockChanges =
    blockStarts > 0 ? Math.max(0, blockStarts - 1) : changes(lights.map((l) => l.blockId));

  // Plan-Treue mit denselben Begriffen wie Soll/Ist (Entscheidung Sven 07.10.2026): Soll ohne Bonus-Frames;
  // eine Transit-Serie hat kein Frame-Soll, nur ein Zeitfenster – sie und ihre Aufnahmen zählen nur in der Zeit.
  let plan: NightSessionKpis['plan'] = null;
  if (input.planEntries !== null) {
    let plannedFrames = 0;
    let plannedExposureS = 0;
    for (const e of input.planEntries) {
      if (e.cmd === 'expose') {
        if (e.bonus === true) continue;
        plannedFrames += 1;
        plannedExposureS += e.exposureS;
      } else if (e.untilUtc) {
        const span = Math.max(0, ms(e.untilUtc) - ms(e.atUtc)) / 1000;
        plannedExposureS += Math.floor(span / e.exposureS) * e.exposureS;
      }
    }
    const done = saved.filter((l) => l.assigned && !l.isBonus);
    const doneFrames = done.filter((l) => l.series !== true).length;
    const acquiredExposureS = done.reduce((s, l) => s + l.exposureS, 0);
    plan = {
      plannedFrames,
      plannedExposureS,
      acquiredFrames: doneFrames,
      acquiredExposureS,
      framesPct: pct(doneFrames, plannedFrames),
      timePct: pct(acquiredExposureS, plannedExposureS),
    };
  }

  const kpis: NightSessionKpis = {
    darkFromUtc: darkFrom,
    darkToUtc: darkTo,
    runtimeS,
    usableDarkS,
    exposureS,
    efficiencyPct: usableDarkS === null ? null : pct(exposureS, usableDarkS),
    overhead,
    safetyPauseS: safety.seconds,
    blockChanges,
    filterChanges: changes(lights.map((l) => l.filter)),
    plan,
  };

  const lost = (result: string) => {
    const list = lights.filter((l) => l.result === result);
    return { count: list.length, seconds: list.reduce((s, l) => s + l.exposureS, 0) };
  };
  const aborted = lost('aborted');
  const failed = lost('failed');
  const skipped = sumDuration(events, 'skipped_timeaware');
  const count = (kind: string) => events.filter((e) => e.kind === kind).length;
  const all: [DeviationReason, number, number | null][] = [
    ['safety_pause', safety.count, safety.seconds],
    ['transit', transit.count, transit.seconds],
    ['autofocus', af.count, af.measured ? af.seconds : null],
    ['meridian_flip', flip.count, flip.measured ? flip.seconds : null],
    ['exposure_aborted', aborted.count, aborted.seconds],
    ['exposure_failed', failed.count, failed.seconds],
    ['skipped_timeaware', skipped.count, skipped.measured ? skipped.seconds : null],
    ['center_failed', count('center_failed'), null],
    ['block_skipped', count('block_skipped'), null],
    ['device_error', count('error'), null],
    ['lease_lost', count('lease_lost'), null],
  ];
  const reasons = all
    .filter(([, n]) => n > 0)
    .map(([reason, n, d]) => ({ reason, count: n, durationS: d === null ? null : round1(d) }))
    .sort((a, b) => (b.durationS ?? -1) - (a.durationS ?? -1) || b.count - a.count);
  return { kpis, reasons };
}
