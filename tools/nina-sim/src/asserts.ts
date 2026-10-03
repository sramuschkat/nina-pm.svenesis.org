/**
 * Prüfungen je Protokollschritt für den kopflosen Nachtlauf: auf den Logzeilen (`NINA-PM | …`) und dem Report des
 * Test-Servers (`GET /test/report`). Ein Schritt ist erfüllt, wenn alle seine Prüfungen erfüllt sind.
 */
import type { LogEvent } from '../../test-run-check/src/log';

export interface Sel {
  readonly event: string;
  readonly where?: Readonly<Record<string, string>>;
}

/** Gemeinsam: `part` = nur dieser Teil des Laufs (ab 1; Log ohne Angabe alle Teile, Report ohne Angabe Teil 1). */
interface Part {
  readonly part?: number;
  /** Nur gegen echtes NINA prüfen (VM-Kurzlauf); im kopflosen Lauf übersprungen. */
  readonly vmOnly?: boolean;
}

export type Assert = Part &
  /** Anzahl passender Logzeilen in [min, max] (Standard min 1). */
  (
    | { readonly log: Sel; readonly min?: number; readonly max?: number }
    /** Die Zeilen kommen in dieser Reihenfolge vor (jede nach der vorigen). */
    | { readonly order: readonly Sel[] }
    /** Keine Zeile `none` nach (bzw. vor) dem `nth`-ten Auftreten (Standard 1) von `after` (bzw. `before`). */
    | { readonly none: Sel; readonly after?: Sel; readonly before?: Sel; readonly nth?: number }
    /** Je Block (BLOCK_START … BLOCK_END) passende Zeilen in [min, max] (Standard min 0). */
    | { readonly perBlock: Sel; readonly min?: number; readonly max?: number }
    /** Report: Liste unter `path` (gefiltert mit `where`) hat [min, max] Einträge, bzw. der Wert ist `equals`. */
    | {
        readonly report: string;
        readonly where?: Readonly<Record<string, unknown>>;
        /** Nur Einträge, bei denen diese Punktpfade einen Wert haben. */
        readonly whereExists?: readonly string[];
        readonly min?: number;
        readonly max?: number;
        readonly equals?: unknown;
        /** Wert unter `report` vorhanden (nicht `undefined`/`null`). */
        readonly exists?: boolean;
        /** Alle Einträge der Liste (gefiltert mit `where`) haben unter diesem Punktpfad denselben Wert. */
        readonly sameValue?: string;
      }
  );

export interface AssertOutcome {
  readonly ok: boolean;
  readonly text: string;
}

const sel = (s: Sel) =>
  [s.event, ...Object.entries(s.where ?? {}).map(([k, v]) => `${k}=${v}`)].join(' ');

const hit = (e: LogEvent, s: Sel) =>
  e.event === s.event && Object.entries(s.where ?? {}).every(([k, v]) => e.fields[k] === v);

/** Wert unter einem Punktpfad (`sessions.0.status`, `heartbeats.last.camera`). */
export function at(value: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>(
      (v, key) =>
        v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined,
      value,
    );
}

const range = (n: number, min = 1, max?: number) => n >= min && (max === undefined || n <= max);

const rangeText = (min = 1, max?: number) =>
  max === undefined
    ? `≥ ${String(min)}`
    : min === max
      ? `= ${String(min)}`
      : `${String(min)}…${String(max)}`;

export function evaluate(a: Assert, events: readonly LogEvent[], report: unknown): AssertOutcome {
  if ('log' in a) {
    const n = events.filter((e) => hit(e, a.log)).length;
    return {
      ok: range(n, a.min, a.max),
      text: `${sel(a.log)}: ${String(n)}× (erwartet ${rangeText(a.min, a.max)})`,
    };
  }
  if ('order' in a) {
    let line = 0;
    for (const s of a.order) {
      const e = events.find((x) => x.line > line && hit(x, s));
      if (!e)
        return {
          ok: false,
          text: `Reihenfolge ${a.order.map(sel).join(' → ')}: „${sel(s)}“ fehlt`,
        };
      line = e.line;
    }
    return { ok: true, text: `Reihenfolge ${a.order.map(sel).join(' → ')}` };
  }
  if ('none' in a) {
    const anchorSel = a.after ?? a.before;
    if (!anchorSel) return { ok: false, text: 'none ohne after/before' };
    const anchor = events.filter((e) => hit(e, anchorSel))[(a.nth ?? 1) - 1];
    const where = a.after ? 'nach' : 'vor';
    const label = `${sel(anchorSel)}${a.nth && a.nth > 1 ? ` (${String(a.nth)}.)` : ''}`;
    if (!anchor) return { ok: false, text: `${label} fehlt` };
    const bad = events.filter(
      (e) => hit(e, a.none) && (a.after ? e.line > anchor.line : e.line < anchor.line),
    );
    return {
      ok: bad.length === 0,
      text: `kein ${sel(a.none)} ${where} ${label}${bad.length ? ` – ${String(bad.length)}× gefunden` : ''}`,
    };
  }
  if ('perBlock' in a) {
    const counts: number[] = [];
    let current: number | null = null;
    for (const e of events) {
      if (e.event === 'BLOCK_START') current = 0;
      else if (hit(e, a.perBlock) && current !== null) current += 1;
      if (e.event === 'BLOCK_END' && current !== null) {
        counts.push(current);
        current = null;
      }
    }
    const bad = counts.filter((n) => !range(n, a.min ?? 0, a.max));
    return {
      ok: counts.length > 0 && bad.length === 0,
      text: `${sel(a.perBlock)} je Block ${rangeText(a.min ?? 0, a.max)}: [${counts.join(', ')}]`,
    };
  }
  const value = at(report, a.report);
  if (a.exists !== undefined) {
    const present = value !== undefined && value !== null;
    return {
      ok: present === a.exists,
      text: `Report ${a.report} ${present ? `= ${JSON.stringify(value)}` : 'fehlt'} (erwartet ${a.exists ? 'vorhanden' : 'fehlend'})`,
    };
  }
  if (a.equals !== undefined)
    return {
      ok: JSON.stringify(value) === JSON.stringify(a.equals),
      text: `Report ${a.report} = ${JSON.stringify(value)} (erwartet ${JSON.stringify(a.equals)})`,
    };
  const list = Array.isArray(value) ? value : [];
  if (a.sameValue !== undefined) {
    const values = new Set(
      list
        .filter((x) =>
          Object.entries(a.where ?? {}).every(
            ([k, v]) => JSON.stringify(at(x, k)) === JSON.stringify(v),
          ),
        )
        .map((x) => JSON.stringify(at(x, a.sameValue ?? ''))),
    );
    return {
      ok: list.length > 0 && values.size === 1,
      text: `Report ${a.report}: ${a.sameValue} ${values.size === 1 ? `überall ${[...values][0] ?? ''}` : `uneinheitlich (${[...values].join(', ')})`}`,
    };
  }
  const n = list.filter(
    (x) =>
      Object.entries(a.where ?? {}).every(
        ([k, v]) => JSON.stringify(at(x, k)) === JSON.stringify(v),
      ) && (a.whereExists ?? []).every((k) => at(x, k) !== undefined && at(x, k) !== null),
  ).length;
  const where = [
    ...Object.entries(a.where ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`),
    ...(a.whereExists ?? []).map((k) => `${k}≠null`),
  ].join(' ');
  return {
    ok: range(n, a.min, a.max),
    text: `Report ${a.report}${where ? ` [${where}]` : ''}: ${String(n)} (erwartet ${rangeText(a.min, a.max)})`,
  };
}
