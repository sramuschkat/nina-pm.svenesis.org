/**
 * Transaktionen mit OCC-Wiederholung und Wächterzeilen (TK 6.6, rules/dsql.md).
 * DSQL erkennt Konflikte erst beim Commit (SQLSTATE 40001/OC000/OC001); `fn` muss daher
 * wiederholbar formuliert sein. Wächter (`guard`) nehmen gelesene Zeilen per `SELECT … FOR UPDATE`
 * in die Konfliktprüfung auf und werden stets in derselben Reihenfolge gesperrt (DAT5-20).
 */
import {
  sql,
  type Kysely,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type QueryResult,
  type RootOperationNode,
  type Transaction,
  type UnknownRow,
} from 'kysely';

export const OCC_CODES: readonly string[] = ['40001', 'OC000', 'OC001'];
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [50, 150, 400];
/** DSQL: max. 3.000 geänderte Zeilen je Transaktion (ADR-S1). */
export const TX_ROW_LIMIT = 3000;

export function isOccConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && OCC_CODES.includes(code);
}

export class RowLimitExceededError extends Error {
  constructor(
    readonly limit: number,
    readonly count: number,
  ) {
    super(`Transaktion ändert ${count} Zeilen, erlaubt sind ${limit} (DSQL, ADR-S1)`);
  }
}

/** Zählt geänderte Zeilen einer Transaktion und bricht über dem Limit ab (TK 6.1, 6.6). */
export class RowCounterPlugin implements KyselyPlugin {
  count = 0;
  constructor(private readonly limit: number) {}
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node;
  }
  transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const n = args.result.numAffectedRows;
    if (n !== undefined) {
      this.count += Number(n);
      if (this.count > this.limit)
        return Promise.reject(new RowLimitExceededError(this.limit, this.count));
    }
    return Promise.resolve(args.result);
  }
}

export interface GuardRow {
  readonly table: string;
  readonly id: string;
  /** Mandantenbindung der Wächterzeile, wenn die Tabelle `tenant_id` hat. */
  readonly tenantId?: string;
}

export interface WithTxOptions {
  readonly guard?: readonly GuardRow[];
  readonly delaysMs?: readonly number[];
  readonly rowLimit?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly jitter?: () => number;
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Prozessweiter Beobachter für OCC-Wiederholungen (TK 16.1/16.2): `api` und `worker` schreiben daraus
 * die Metrik `DsqlRetries` (Alarm > 20 in 5 min). Ein Fehler im Beobachter bricht nie die Transaktion.
 */
let retryObserver: ((attempt: number, error: unknown) => void) | undefined;
export function observeTxRetries(
  fn: ((attempt: number, error: unknown) => void) | undefined,
): void {
  retryObserver = fn;
}

/** Wächter in fester Reihenfolge: Tabelle, dann ID (ordinal), damit parallele Läufe nicht verklemmen. */
export function orderGuards(guard: readonly GuardRow[]): GuardRow[] {
  return [...guard].sort((a, b) =>
    a.table === b.table ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.table < b.table ? -1 : 1,
  );
}

export async function withTx<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options: WithTxOptions = {},
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? (() => Math.floor(Math.random() * 25));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.transaction().execute(async (trx) => {
        const counted = trx.withPlugin(
          new RowCounterPlugin(options.rowLimit ?? TX_ROW_LIMIT),
        ) as Transaction<DB>;
        for (const g of orderGuards(options.guard ?? [])) {
          if (!/^[a-z_]+$/.test(g.table)) throw new Error(`Ungültiger Tabellenname ${g.table}`);
          const tenant = g.tenantId === undefined ? sql`` : sql` AND tenant_id = ${g.tenantId}`;
          await sql`SELECT 1 FROM ${sql.table(g.table)} WHERE id = ${g.id}${tenant} FOR UPDATE`.execute(
            counted,
          );
        }
        return fn(counted);
      });
    } catch (error) {
      if (!isOccConflict(error) || attempt >= delays.length) throw error;
      options.onRetry?.(attempt + 1, error);
      try {
        retryObserver?.(attempt + 1, error);
      } catch {
        // Beobachtung ist best effort.
      }
      await sleep((delays[attempt] ?? 0) + jitter());
    }
  }
}
