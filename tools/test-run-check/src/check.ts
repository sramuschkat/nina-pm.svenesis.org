/**
 * `pnpm test-run:check <ordner>` (AP-S2b, CC5-11): prüft `result.json` gegen das Schema und `nina.log` gegen
 * die Erwartungen des Protokolls, schreibt das Ergebnis als `logCheck` in `result.json` zurück
 * (ops/plugin-test-protocol.md). `logCheck.status`: `pass`, `fail` oder `not_run` (kein `nina.log`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import expectationsJson from './expectations.json' with { type: 'json' };
import { parseLog, type LogEvent } from './log';
import { validateResult, type LogCheck, type RunResult } from './result';

interface Match {
  readonly event: string;
  readonly where?: Readonly<Record<string, string>>;
  readonly has?: readonly string[];
  readonly min?: number;
}

interface ProtocolExpectation {
  readonly package: string;
  readonly steps: readonly string[];
  readonly require?: readonly Match[];
  readonly forbid?: readonly Match[];
  /** Ausnahmen von `global.forbid` für dieses Protokoll (z. B. P-37: `ERROR code=clock_skew` ist erwartet). */
  readonly allow?: readonly Match[];
  readonly checks?: readonly string[];
}

interface Expectations {
  readonly global: { readonly forbid: readonly Match[] };
  readonly protocols: Readonly<Record<string, ProtocolExpectation>>;
}

export const EXPECTATIONS = expectationsJson as unknown as Expectations;

const matches = (e: LogEvent, m: Match) =>
  e.event === m.event &&
  Object.entries(m.where ?? {}).every(([k, v]) => e.fields[k] === v) &&
  (m.has ?? []).every((k) => k in e.fields);

const describe = (m: Match) =>
  [m.event, ...Object.entries(m.where ?? {}).map(([k, v]) => `${k}=${v}`)].join(' ') +
  (m.min && m.min > 1 ? ` (mindestens ${String(m.min)}×)` : '');

const unix = (iso: string | undefined) => (iso ? Date.parse(iso) / 1000 : Number.NaN);

/** Sonderprüfungen; liefern fehlende bzw. unerwartete Befunde. */
const CHECKS: Record<string, (events: LogEvent[]) => { missing: string[]; unexpected: string[] }> =
  {
    /** Jede Aufnahme-ID endet genau einmal, jeder gespeicherte Dateiname kommt einmal vor (P-02). */
    uniqueCaptures(events) {
      const unexpected: string[] = [];
      const ids = new Map<string, number>();
      const files = new Map<string, number>();
      for (const e of events.filter((x) => x.event === 'CAPTURE')) {
        const id = e.fields.id;
        if (id) {
          if (ids.has(id))
            unexpected.push(
              `CAPTURE id=${id} mehrfach (Zeilen ${String(ids.get(id))}, ${String(e.line)})`,
            );
          ids.set(id, e.line);
        }
        const file = e.fields.result === 'saved' ? e.fields.file : undefined;
        if (file) {
          if (files.has(file))
            unexpected.push(
              `CAPTURE file="${file}" mehrfach zugeordnet (Zeilen ${String(files.get(file))}, ${String(e.line)})`,
            );
          files.set(file, e.line);
        }
      }
      return { missing: [], unexpected };
    },
    /** Zwischen zwei gespeicherten Aufnahmen läuft mindestens einmal ein Trigger (P-01, Trigger-Walk). */
    triggerBetweenCaptures(events) {
      let seenCapture = false;
      let triggerAfterCapture = false;
      for (const e of events) {
        if (e.event === 'TRIGGER' && seenCapture) triggerAfterCapture = true;
        if (e.event === 'CAPTURE' && e.fields.result === 'saved') {
          if (triggerAfterCapture) return { missing: [], unexpected: [] };
          seenCapture = true;
        }
      }
      return { missing: ['TRIGGER zwischen zwei gespeicherten Aufnahmen'], unexpected: [] };
    },
    /** Abbruch wirkt binnen 5 s: `WARNING code=probe_abort atUtc=…` → `CAPTURE result=aborted atUtc=…` (P-03). */
    abortWithin5s(events) {
      const missing: string[] = [];
      const unexpected: string[] = [];
      const requests = events.filter(
        (e) => e.event === 'WARNING' && e.fields.code === 'probe_abort',
      );
      for (const a of events.filter(
        (e) => e.event === 'CAPTURE' && e.fields.result === 'aborted',
      )) {
        const req = requests.filter((r) => r.line < a.line).at(-1);
        const dt = unix(a.fields.atUtc) - unix(req?.fields.atUtc);
        if (!req || Number.isNaN(dt))
          missing.push(`Zeitpunkte zu CAPTURE result=aborted (Zeile ${String(a.line)})`);
        else if (dt > 5)
          unexpected.push(`Abbruch nach ${String(dt)} s (Zeile ${String(a.line)}, erlaubt < 5 s)`);
      }
      return { missing, unexpected };
    },
    /** Nach jedem Abbruch startet die nächste Belichtung und wird gespeichert (P-03). */
    savedAfterAbort(events) {
      const missing: string[] = [];
      for (const a of events.filter((e) => e.event === 'CAPTURE' && e.fields.result === 'aborted'))
        if (
          !events.some(
            (e) => e.line > a.line && e.event === 'CAPTURE' && e.fields.result === 'saved',
          )
        )
          missing.push(`CAPTURE result=saved nach dem Abbruch in Zeile ${String(a.line)}`);
      return { missing, unexpected: [] };
    },
  };

export interface CheckOutcome {
  /** Schemafehler in `result.json`; nicht leer → Prüfung gescheitert. */
  readonly schemaErrors: string[];
  readonly logCheck: LogCheck;
  /** Protokoll bestanden: `result = go`, alle Schritte `ok`, `logCheck.status = pass`. */
  readonly passed: boolean;
}

/** Prüft einen Ordner `docs/test-runs/<datum>/<P-xx>/` und schreibt `logCheck` zurück. */
export function checkRun(dir: string, write = true): CheckOutcome {
  const resultPath = join(dir, 'result.json');
  const raw = JSON.parse(readFileSync(resultPath, 'utf8')) as RunResult;
  const exp = EXPECTATIONS.protocols[raw.protocol];
  const schemaErrors = validateResult(raw, exp ? exp.steps.length : null);
  if (!exp)
    schemaErrors.push(
      `keine Erwartungen für ${String(raw.protocol)} in expectations.json (ergänzt das Paket, das das Protokoll braucht)`,
    );

  const logPath = join(dir, 'nina.log');
  let logCheck: LogCheck;
  if (!existsSync(logPath)) {
    logCheck = { status: 'not_run', missing: ['nina.log fehlt'], unexpected: [] };
  } else {
    const { events, violations } = parseLog(readFileSync(logPath, 'utf8'));
    const missing: string[] = [];
    const unexpected: string[] = [...violations];
    for (const m of exp?.require ?? []) {
      const n = events.filter((e) => matches(e, m)).length;
      if (n < (m.min ?? 1))
        missing.push(`${describe(m)}${n > 0 ? `, gefunden ${String(n)}×` : ''}`);
    }
    const allowed = (e: LogEvent) => (exp?.allow ?? []).some((a) => matches(e, a));
    for (const m of [...EXPECTATIONS.global.forbid, ...(exp?.forbid ?? [])])
      for (const e of events.filter((x) => matches(x, m) && !allowed(x)))
        unexpected.push(`${describe(m)} in Zeile ${String(e.line)}`);
    for (const name of exp?.checks ?? []) {
      const check = CHECKS[name];
      if (!check) throw new Error(`Unbekannte Prüfung ${name} in expectations.json`);
      const r = check(events);
      missing.push(...r.missing);
      unexpected.push(...r.unexpected);
    }
    logCheck = {
      status: missing.length === 0 && unexpected.length === 0 ? 'pass' : 'fail',
      missing,
      unexpected,
    };
  }

  if (write) {
    raw.logCheck = logCheck;
    writeFileSync(resultPath, `${JSON.stringify(raw, null, 2)}\n`);
  }
  const passed =
    schemaErrors.length === 0 &&
    raw.result === 'go' &&
    Array.isArray(raw.steps) &&
    raw.steps.every((s) => s.ok) &&
    logCheck.status === 'pass';
  return { schemaErrors, logCheck, passed };
}
