/**
 * Isolations-Prüfung (TK 6.7, NFA-16): jede Repository-Methode wird mit Mandant A auf Datensätze von
 * Mandant B aufgerufen und muss leer/NotFound liefern.
 */
export interface IsolationCall {
  readonly name: string;
  readonly call: () => Promise<unknown>;
}

export class IsolationLeakError extends Error {
  constructor(readonly leaks: readonly string[]) {
    super(`Mandantenisolation verletzt: ${leaks.join('; ')}`);
  }
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === 0 || v === 0n || (Array.isArray(v) && v.length === 0);

export async function assertIsolated(calls: readonly IsolationCall[]): Promise<void> {
  const leaks: string[] = [];
  for (const { name, call } of calls) {
    const value = await call();
    if (!isEmpty(value))
      leaks.push(
        `${name} → ${JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)).slice(0, 120)}`,
      );
  }
  if (leaks.length > 0) throw new IsolationLeakError(leaks);
}
