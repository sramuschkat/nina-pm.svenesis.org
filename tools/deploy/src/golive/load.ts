/**
 * Lasttest gegen die Drosselung (AP-17, iam.md §9, statt WAF): Auswertung eines kurzen Bursts
 * (≈ 10 s, 100 Aufrufe/s) – reine Funktionen; der Lauf (`pnpm loadtest:prod`) läuft nur bei Sven.
 */
export interface Hit {
  readonly status: number;
  readonly ms: number;
}

export interface LoadSummary {
  readonly target: string;
  readonly requests: number;
  readonly byStatus: Record<string, number>;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

const pct = (sorted: readonly number[], p: number) =>
  sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);

export function summarize(target: string, hits: readonly Hit[]): LoadSummary {
  const byStatus: Record<string, number> = {};
  for (const h of hits) byStatus[String(h.status)] = (byStatus[String(h.status)] ?? 0) + 1;
  const ms = hits.map((h) => h.ms).sort((a, b) => a - b);
  return { target, requests: hits.length, byStatus, p50Ms: pct(ms, 0.5), p95Ms: pct(ms, 0.95) };
}

export interface LoadVerdict {
  readonly ok: boolean;
  readonly findings: string[];
}

/**
 * Erwartung: Anmeldestart gedrosselt (`429` vorhanden, sonst nur `302`), Direktaufruf der
 * `execute-api`-Adresse nur `403`/`429`, keine `5xx`, reservierte Parallelität der `api` nicht überschritten.
 */
export function evaluate(
  start: LoadSummary,
  direct: LoadSummary,
  maxConcurrency: number | null,
  reserved: number,
): LoadVerdict {
  const findings: string[] = [];
  const only = (s: LoadSummary, allowed: readonly string[]) =>
    Object.keys(s.byStatus).filter((k) => !allowed.includes(k));
  if ((start.byStatus['429'] ?? 0) === 0)
    findings.push('Anmeldestart: keine 429 – Drosselung greift nicht');
  const startOther = only(start, ['302', '429']);
  if (startOther.length > 0)
    findings.push(`Anmeldestart: unerwartete Status ${startOther.join(', ')}`);
  const directOther = only(direct, ['403', '429']);
  if (directOther.length > 0)
    findings.push(`execute-api: unerwartete Status ${directOther.join(', ')}`);
  if (maxConcurrency === null) findings.push('Parallelität der api nicht gemessen');
  else if (maxConcurrency > reserved)
    findings.push(`Parallelität ${String(maxConcurrency)} > reserviert ${String(reserved)}`);
  return { ok: findings.length === 0, findings };
}
