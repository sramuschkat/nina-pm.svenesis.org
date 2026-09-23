/**
 * Verbindung der Anwendung (TK 6.5). Nur aus src/repositories importierbar (ESLint, TK 3.2).
 * DSQL: offizieller Connector mit IAM-Token je Verbindungsaufbau; lokal/CI: PostgreSQL 16 mit
 * Repeatable Read wie DSQL (TK 6.9).
 */
import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types';

export type AppDbRole = 'app_rw' | 'app_job';

export type DbConfig =
  | { readonly kind: 'dsql'; readonly endpoint: string; readonly role: AppDbRole }
  | { readonly kind: 'postgres'; readonly connectionString: string };

/** Repeatable Read wie in DSQL (TK 6.9) – auch dort, wo der Server anders eingestellt ist (CI-Service). */
export const PG_OPTIONS = '-c default_transaction_isolation=repeatable\\ read';

export function createPool(
  config: DbConfig,
  onError: (error: Error) => void = () => undefined,
): pg.Pool {
  const pool =
    config.kind === 'dsql'
      ? (new AuroraDSQLPool({
          host: config.endpoint,
          user: config.role,
          database: 'postgres',
          max: 2,
          idleTimeoutMillis: 60_000,
          maxLifetimeSeconds: 50 * 60, // < 1 h Verbindungslimit von DSQL
        }) as unknown as pg.Pool)
      : new pg.Pool({ connectionString: config.connectionString, options: PG_OPTIONS, max: 4 });
  // Eingefrorene Lambda-Container finden geschlossene Verbindungen vor (TK 6.5).
  pool.on('error', onError);
  return pool;
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
}
