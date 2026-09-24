/**
 * PostgreSQL im Prozess (PGlite, WASM) für Tests ohne Docker: dieselben Migrationen und Repositories
 * wie gegen PostgreSQL 16 bzw. DSQL. Ersetzt die CI-Suites gegen den PostgreSQL-Dienst **nicht**
 * (Rollen, GRANTs, Nebenläufigkeit prüft weiterhin db.test.ts), erlaubt aber schnelle
 * Integrationstests der API mit echtem SQL – lokal und im CI.
 */
import { PGlite } from '@electric-sql/pglite';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { loadMigrations } from '../migrate/files';
import { runMigrations } from '../migrate/runner';
import type { SqlClient } from '../migrate/types';
import type { Database } from '../types';

const COMMAND = /^\s*(INSERT|UPDATE|DELETE|MERGE|SELECT)\b/i;

export interface PgliteDatabase {
  readonly pg: PGlite;
  readonly db: Kysely<Database>;
  readonly admin: SqlClient;
  close(): Promise<void>;
}

/** Legt eine frische In-Memory-Datenbank an und führt alle Migrationen (ohne 0000/Rollen) aus. */
export async function openPglite(): Promise<PgliteDatabase> {
  const pg = await PGlite.create();
  await pg.exec("SET default_transaction_isolation = 'repeatable read'");
  const admin: SqlClient = {
    query: async (text: string, params?: unknown[]) => {
      const r = await pg.query(text, params);
      return {
        rows: r.rows as Record<string, unknown>[],
        rowCount: r.affectedRows ?? r.rows.length,
      };
    },
  };
  // Rollen nur, damit die GRANTs der Migrationen laufen; Tests verbinden als Superuser.
  await pg.exec('CREATE ROLE app_rw; CREATE ROLE app_job;');
  await runMigrations(admin, loadMigrations(), { mode: 'postgres' });
  const connection = {
    query: async (text: string, params: unknown[]) => {
      const r = await pg.query(text, params);
      return {
        rows: r.rows,
        rowCount: r.affectedRows ?? r.rows.length,
        command: COMMAND.exec(text)?.[1]?.toUpperCase() ?? 'SELECT',
      };
    },
    release: () => undefined,
  };
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: { connect: () => Promise.resolve(connection), end: () => Promise.resolve() } as never,
    }),
    plugins: [new CamelCasePlugin()],
  });
  return { pg, db, admin, close: () => pg.close() };
}
