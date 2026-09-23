/** Protokoll des DSQL-Spikes (AP-S1): je Prüfpunkt Befehl, Ergebnis und Dauer. */

export interface SqlResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

/** Minimale Schnittstelle einer Verbindung (node-postgres `Client` bzw. `AuroraDSQLClient`). */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
  end(): Promise<void>;
}

export type Expect = 'ok' | 'error' | 'any';

export interface StepRecord {
  readonly conn: string;
  readonly command: string;
  readonly expect: Expect;
  readonly expectCodes?: readonly string[];
  readonly outcome: 'ok' | 'error';
  readonly sqlstate?: string;
  readonly message?: string;
  readonly rowCount?: number | null;
  readonly sample?: string;
  readonly durationMs: number;
  readonly matched: boolean;
  readonly note?: string;
}

export type Verdict = 'bestätigt' | 'abweichend' | 'Fehler';

export interface CheckRecord {
  readonly id: string;
  readonly title: string;
  readonly tk: string;
  readonly verdict: Verdict;
  readonly summary: string;
  readonly steps: readonly StepRecord[];
  readonly durationMs: number;
}

export interface Protocol {
  readonly tool: string;
  readonly startedAt: string;
  finishedAt?: string;
  cluster?: {
    identifier: string;
    region: string;
    endpoint: string;
    createMs: number;
    activeMs: number;
  };
  caller?: string;
  environment: Record<string, string>;
  checks: CheckRecord[];
  notes: string[];
}

export interface StepOptions {
  readonly params?: unknown[];
  /** Kurzbeschreibung großer Parameter statt ihres Inhalts, z. B. „1,5 MiB zufällig“. */
  readonly paramsLabel?: string;
  readonly expect?: Expect;
  /** Erwartete SQLSTATEs bei `expect: 'error'`; leer = jeder Fehler passt. */
  readonly codes?: readonly string[];
  readonly note?: string;
}

export interface StepOutcome {
  readonly ok: boolean;
  readonly rows: Record<string, unknown>[];
  readonly rowCount: number | null;
  readonly code?: string;
  readonly message?: string;
  readonly durationMs: number;
}

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)} …` : text;

function sampleOf(rows: Record<string, unknown>[]): string | undefined {
  if (rows.length === 0) return undefined;
  const json = JSON.stringify(rows.slice(0, 3), (_k, v: unknown) =>
    typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}…(${v.length})` : v,
  );
  return truncate(json, 300);
}

/** Sammelt die Schritte eines Prüfpunkts. */
export class Recorder {
  steps: StepRecord[] = [];

  constructor(private readonly now: () => number = () => performance.now()) {}

  reset(): StepRecord[] {
    const steps = this.steps;
    this.steps = [];
    return steps;
  }

  async step(
    client: SqlClient,
    conn: string,
    sql: string,
    opts: StepOptions = {},
  ): Promise<StepOutcome> {
    const expect = opts.expect ?? 'ok';
    const paramText =
      opts.params === undefined
        ? ''
        : ` -- Parameter: ${opts.paramsLabel ?? truncate(JSON.stringify(opts.params), 120)}`;
    const command = `${oneLine(sql)}${paramText}`;
    const t0 = this.now();
    try {
      const res = await client.query(sql, opts.params);
      const durationMs = Math.round(this.now() - t0);
      this.steps.push({
        conn,
        command,
        expect,
        ...(opts.codes ? { expectCodes: opts.codes } : {}),
        outcome: 'ok',
        rowCount: res.rowCount,
        ...(sampleOf(res.rows) ? { sample: sampleOf(res.rows) } : {}),
        durationMs,
        matched: expect !== 'error',
        ...(opts.note ? { note: opts.note } : {}),
      });
      return { ok: true, rows: res.rows, rowCount: res.rowCount, durationMs };
    } catch (error) {
      const durationMs = Math.round(this.now() - t0);
      const err = error as { code?: unknown; message?: unknown };
      const code = typeof err.code === 'string' ? err.code : undefined;
      const message = truncate(typeof err.message === 'string' ? err.message : String(error), 400);
      const matched =
        expect === 'any' ||
        (expect === 'error' && (!opts.codes || (!!code && opts.codes.includes(code))));
      this.steps.push({
        conn,
        command,
        expect,
        ...(opts.codes ? { expectCodes: opts.codes } : {}),
        outcome: 'error',
        ...(code ? { sqlstate: code } : {}),
        message,
        durationMs,
        matched,
        ...(opts.note ? { note: opts.note } : {}),
      });
      return {
        ok: false,
        rows: [],
        rowCount: null,
        ...(code ? { code } : {}),
        message,
        durationMs,
      };
    }
  }

  /** Nicht-SQL-Schritt (Messung, Verbindungsaufbau) mit eigenem Ergebnis. */
  info(conn: string, command: string, result: string, durationMs = 0, matched = true): void {
    this.steps.push({
      conn,
      command,
      expect: 'any',
      outcome: matched ? 'ok' : 'error',
      sample: result,
      durationMs,
      matched,
    });
  }
}

const esc = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function resultText(s: StepRecord): string {
  if (s.outcome === 'ok') {
    const rows = s.rowCount === undefined || s.rowCount === null ? '' : `${s.rowCount} Zeile(n)`;
    return ['ok', rows, s.sample ?? ''].filter(Boolean).join(' · ');
  }
  return `Fehler${s.sqlstate ? ` ${s.sqlstate}` : ''}: ${s.message ?? ''}`;
}

function expectText(s: StepRecord): string {
  if (s.expect === 'error') return `Fehler${s.expectCodes ? ` ${s.expectCodes.join('/')}` : ''}`;
  return s.expect === 'ok' ? 'ok' : '–';
}

export function renderMarkdown(p: Protocol): string {
  const lines: string[] = [];
  lines.push(`# DSQL-Spike AP-S1 – Protokoll`, '');
  lines.push(`| | |`, `|---|---|`);
  lines.push(
    `| Werkzeug | ${p.tool} |`,
    `| Beginn | ${p.startedAt} |`,
    `| Ende | ${p.finishedAt ?? '–'} |`,
  );
  if (p.cluster) {
    lines.push(
      `| Cluster | ${p.cluster.identifier} (${p.cluster.region}), angelegt ${p.cluster.createMs} ms, ACTIVE nach ${p.cluster.activeMs} ms |`,
    );
  }
  if (p.caller) lines.push(`| Aufrufer | ${p.caller} |`);
  for (const [k, v] of Object.entries(p.environment)) lines.push(`| ${k} | ${esc(v)} |`);
  lines.push(
    '',
    '## Übersicht',
    '',
    '| Nr. | Prüfpunkt | TK 6.0 | Ergebnis | Zusammenfassung |',
    '|---|---|---|---|---|',
  );
  for (const c of p.checks)
    lines.push(`| ${c.id} | ${c.title} | ${c.tk} | ${c.verdict} | ${esc(c.summary)} |`);
  for (const c of p.checks) {
    lines.push('', `## ${c.id} ${c.title} – ${c.verdict}`, '', esc(c.summary), '');
    lines.push(
      '| # | Verb. | Befehl | erwartet | Ergebnis | ms | passt |',
      '|---|---|---|---|---|---|---|',
    );
    c.steps.forEach((s, i) => {
      lines.push(
        `| ${i + 1} | ${s.conn} | \`${esc(s.command)}\` | ${expectText(s)} | ${esc(resultText(s))}${s.note ? ` (${esc(s.note)})` : ''} | ${s.durationMs} | ${s.matched ? '✔' : '✘'} |`,
      );
    });
  }
  if (p.notes.length > 0) lines.push('', '## Hinweise', '', ...p.notes.map((n) => `- ${n}`));
  return `${lines.join('\n')}\n`;
}
