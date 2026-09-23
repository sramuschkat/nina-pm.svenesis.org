/** Trenner zwischen Anweisungen einer Migration; jede Anweisung läuft in eigener Transaktion (TK 6.8). */
export const STATEMENT_MARKER = '-- statement';

export function splitStatements(sql: string): string[] {
  return sql
    .split(/^-- statement[ \t]*$/m)
    .slice(1)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
