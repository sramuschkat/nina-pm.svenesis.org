/**
 * Migrations-Runner (TK 6.8, ADR-S1). Jede Anweisung (`-- statement`) läuft in eigener Transaktion
 * (DSQL: eine DDL je Transaktion, DDL und DML getrennt). `schema_migration` führt Buch **je Anweisung**
 * (`<migration>#<nr>`), damit ein abgebrochener Lauf an der richtigen Stelle weitermacht.
 * Asynchrone Jobs (CREATE INDEX ASYNC, ALTER TABLE ASYNC … VALIDATE) wartet der Runner mit
 * `CALL sys.wait_for_job('<job_id>')` ab; lokal werden sie zu synchronen Anweisungen umgeschrieben.
 */
import { createHash } from 'node:crypto';
import { splitStatements } from './statements';
import type { Migration, MigrationLog, MigrationMode, SqlClient } from './types';

export const SCHEMA_MIGRATION_DDL = `CREATE TABLE IF NOT EXISTS schema_migration (
    id          text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
)`;

const ALREADY_EXISTS = ['42P07', '42710'];

export function checksum(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n').trim()).digest('hex');
}

/** Lokal (PostgreSQL) gibt es keine ASYNC-Varianten und kein AWS IAM GRANT (TK 6.9). */
export function forMode(statement: string, mode: MigrationMode): string | undefined {
  if (mode === 'dsql') return statement;
  if (/^\s*AWS\s+IAM\s+(GRANT|REVOKE)\b/i.test(statement)) return undefined;
  return statement
    .replace(
      /\bCREATE\s+(UNIQUE\s+)?INDEX\s+ASYNC\b/gi,
      (_m, u?: string) => `CREATE ${u ?? ''}INDEX`,
    )
    .replace(/\bALTER\s+TABLE\s+ASYNC\b/gi, 'ALTER TABLE');
}

export interface RunResult {
  readonly applied: string[];
  readonly skipped: number;
}

async function waitForJob(client: SqlClient, jobId: string, log: MigrationLog) {
  if (!/^[a-z0-9]+$/.test(jobId)) throw new Error(`Unerwartete Job-ID ${jobId}`);
  await client.query(`CALL sys.wait_for_job('${jobId}')`);
  const res = await client.query('SELECT status FROM sys.jobs WHERE job_id = $1', [jobId]);
  const status = String(res.rows[0]?.status ?? 'unbekannt');
  if (/fail|cancel/i.test(status)) throw new Error(`DSQL-Job ${jobId} endete mit Status ${status}`);
  log(`  Job ${jobId}: ${status}`);
}

export async function runMigrations(
  client: SqlClient,
  migrations: readonly Migration[],
  options: { mode: MigrationMode; log?: MigrationLog },
): Promise<RunResult> {
  const log = options.log ?? (() => undefined);
  await client.query(SCHEMA_MIGRATION_DDL);
  const done = new Map(
    (await client.query('SELECT id, checksum FROM schema_migration')).rows.map((r) => [
      String(r.id),
      String(r.checksum),
    ]),
  );

  const applied: string[] = [];
  let skipped = 0;
  const sorted = [...migrations].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const migration of sorted) {
    const statements = splitStatements(migration.sql);
    if (statements.length === 0)
      throw new Error(`Migration ${migration.id} enthält keine Anweisung`);
    for (const [index, statement] of statements.entries()) {
      const id = `${migration.id}#${String(index + 1).padStart(3, '0')}`;
      const sum = checksum(statement);
      const previous = done.get(id);
      if (previous !== undefined) {
        if (previous !== sum)
          throw new Error(`Migration ${id} wurde nach dem Anwenden geändert (Prüfsumme weicht ab)`);
        skipped += 1;
        continue;
      }
      const sql = forMode(statement, options.mode);
      if (sql !== undefined) {
        try {
          const res = await client.query(sql);
          const job = res.rows[0]?.job_id;
          if (options.mode === 'dsql' && typeof job === 'string')
            await waitForJob(client, job, log);
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          // Abbruch zwischen DDL und Buchung: die Anweisung lief bereits; beim nächsten Lauf nur nachbuchen.
          if (!(
            typeof code === 'string' &&
            ALREADY_EXISTS.includes(code) &&
            /^\s*CREATE\b/i.test(sql)
          )) {
            throw new Error(
              `Migration ${id} fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
              {
                cause: error,
              },
            );
          }
          log(`  ${id}: existiert bereits, wird nachgebucht`);
        }
      }
      await client.query('INSERT INTO schema_migration (id, checksum) VALUES ($1, $2)', [id, sum]);
      applied.push(id);
    }
    log(`${migration.id}: ${statements.length} Anweisungen`);
  }
  return { applied, skipped };
}
