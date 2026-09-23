/**
 * Datenbank-Prüfungen für AP-03 – dieselben Suites laufen im CI gegen PostgreSQL 16 (Vitest) und in
 * `pnpm test:dsql` gegen einen kurzlebigen DSQL-Cluster (H-22). Jede Suite wirft bei einem Fehler
 * und liefert sonst eine kurze Zusammenfassung fürs Protokoll.
 */
import { strict as assert } from 'node:assert';
import type { Selectable, Transaction } from 'kysely';
import { DB_ROLES, TABLE_GRANTS, type Privilege } from '../grants';
import { migration0000, type AppRole, type Migration0000Options } from '../migrate/migration-0000';
import { runMigrations } from '../migrate/runner';
import type { Migration, MigrationMode, SqlClient } from '../migrate/types';
import { TenantRepo } from '../repositories/base';
import type { OpenDatabase } from '../repositories/database';
import { isOccConflict, RowLimitExceededError, withTx } from '../tx';
import type { Database, TenantTable } from '../types';
import { assertIsolated, IsolationLeakError } from './isolation';

export interface ClosableClient extends SqlClient {
  end(): Promise<void>;
}

export interface SuiteEnv {
  readonly mode: MigrationMode;
  /** Admin- bzw. Superuser-Verbindung (Runner, Aufbau der Testdaten). */
  readonly admin: SqlClient;
  readonly migrations: readonly Migration[];
  readonly migration0000: Migration0000Options;
  connectAs(role: AppRole): Promise<ClosableClient>;
  openDatabase(role: AppRole): OpenDatabase;
}

export interface Suite {
  readonly id: string;
  readonly title: string;
  run(env: SuiteEnv): Promise<string>;
}

const PRIVS: readonly Privilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const uuid = () => crypto.randomUUID();

async function expectDenied(client: SqlClient, sql: string, what: string) {
  try {
    await client.query(sql);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    assert.equal(
      code,
      '42501',
      `${what}: erwartet 42501, bekam ${String(code)} (${String(error)})`,
    );
    return;
  }
  assert.fail(`${what}: wurde nicht abgelehnt`);
}

async function insertTenant(admin: SqlClient, key: string): Promise<string> {
  const id = uuid();
  await admin.query('INSERT INTO tenant (id, tenant_key, display_name) VALUES ($1, $2, $3)', [
    id,
    key,
    key,
  ]);
  return id;
}

/** Absichtlich fehlerhaft (ohne Mandantenfilter) – die Isolationsprüfung muss sie erkennen. */
class LeakyTenantRepository extends TenantRepo {
  byId(id: string): Promise<Selectable<TenantTable> | undefined> {
    return this.db.selectFrom('tenant').selectAll().where('id', '=', id).executeTakeFirst();
  }
}

export const suites: readonly Suite[] = [
  {
    id: 'D-01',
    title: 'Migration 0000 und Migrationen, idempotent',
    async run(env) {
      const first0000 = await migration0000(env.admin, env.migration0000);
      const first = await runMigrations(env.admin, env.migrations, { mode: env.mode });
      const second0000 = await migration0000(env.admin, env.migration0000);
      const second = await runMigrations(env.admin, env.migrations, { mode: env.mode });
      assert.deepEqual(second0000, [], 'Migration 0000 ändert beim zweiten Lauf etwas');
      assert.deepEqual(second.applied, [], 'Runner wendet beim zweiten Lauf etwas an');
      const tables = await env.admin.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migration'",
      );
      assert.equal(tables.rows[0]?.n, Object.keys(TABLE_GRANTS).length, 'Anzahl Tabellen');
      return `0000: ${first0000.length} Änderungen, danach 0; Migrationen: ${first.applied.length} Anweisungen angewandt, zweiter Lauf 0; ${String(tables.rows[0]?.n)} Tabellen`;
    },
  },
  {
    id: 'D-02',
    title: 'Rechte-Matrix je DB-Rolle nach TK 6.2',
    async run(env) {
      const mismatches: string[] = [];
      let checked = 0;
      for (const [table, grant] of Object.entries(TABLE_GRANTS)) {
        for (const role of DB_ROLES) {
          const cols = role === 'app_job' ? grant.app_job_update_columns : undefined;
          for (const priv of PRIVS) {
            const res = await env.admin.query('SELECT has_table_privilege($1, $2, $3) AS ok', [
              role,
              table,
              priv,
            ]);
            const expected = grant[role].includes(priv) && !(cols && priv === 'UPDATE');
            checked += 1;
            if (res.rows[0]?.ok !== expected)
              mismatches.push(
                `${role} ${priv} ${table}: ist ${String(res.rows[0]?.ok)}, soll ${String(expected)}`,
              );
          }
          for (const col of cols ?? []) {
            const res = await env.admin.query(
              "SELECT has_column_privilege($1, $2, $3, 'UPDATE') AS ok",
              [role, table, col],
            );
            checked += 1;
            if (res.rows[0]?.ok !== true) mismatches.push(`${role} UPDATE(${col}) ${table} fehlt`);
          }
        }
      }
      assert.deepEqual(mismatches, []);
      return `${checked} Rechte geprüft, alle wie TK 6.2`;
    },
  },
  {
    id: 'D-03',
    title: 'SEC-4: app_job schreibt keine Sitzungen/Tokens, app_rw keine Kataloge',
    async run(env) {
      const job = await env.connectAs('app_job');
      const rw = await env.connectAs('app_rw');
      try {
        await expectDenied(
          job,
          'SELECT 1 FROM auth_session LIMIT 1',
          'app_job SELECT auth_session',
        );
        await expectDenied(
          job,
          'INSERT INTO auth_session DEFAULT VALUES',
          'app_job INSERT auth_session',
        );
        await expectDenied(
          job,
          'UPDATE auth_session SET last_seen_at = now() WHERE false',
          'app_job UPDATE auth_session',
        );
        await expectDenied(
          job,
          'UPDATE nina_instance SET name = name WHERE false',
          'app_job UPDATE nina_instance',
        );
        for (const t of ['identity', 'super_user', 'app_user', 'invitation', 'nina_instance']) {
          await expectDenied(job, `INSERT INTO ${t} DEFAULT VALUES`, `app_job INSERT ${t}`);
        }
        await expectDenied(rw, 'INSERT INTO dso_object DEFAULT VALUES', 'app_rw INSERT dso_object');
        await expectDenied(
          rw,
          'UPDATE dso_object SET name = name WHERE false',
          'app_rw UPDATE dso_object',
        );
        await rw.query('SELECT 1 FROM dso_object LIMIT 1');
        await job.query('SELECT 1 FROM app_user LIMIT 1');
      } finally {
        await job.end();
        await rw.end();
      }
      return '10 verbotene Zugriffe mit 42501 abgelehnt, erlaubte Lesezugriffe ok';
    },
  },
  {
    id: 'D-04',
    title: 'withTx: OCC-Konflikt über Wächterzeile wird wiederholt',
    async run(env) {
      const guardId = await insertTenant(env.admin, `occ-${Date.now().toString(36)}`);
      const a = env.openDatabase('app_rw');
      const b = env.openDatabase('app_rw');
      let retries = 0;
      let bStarted: () => void = () => undefined;
      const bReady = new Promise<void>((resolve) => (bStarted = resolve));
      const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      try {
        // Zählerpfade schreiben die Wächterzeile immer (TK 6.6, DAT-2) – so entsteht der Konflikt in DSQL und PostgreSQL.
        const touch = (label: string) => async (trx: Transaction<Database>) => {
          await trx
            .updateTable('tenant')
            .set({ updatedAt: new Date(), contact: label })
            .where('id', '=', guardId)
            .execute();
        };
        const txA = withTx(
          a.db,
          async (trx) => {
            // A hält die Wächterzeile, bis B seine Transaktion begonnen hat (DSQL) bzw. höchstens 500 ms (PostgreSQL sperrt B).
            await Promise.race([bReady, timeout(500)]);
            await touch('A')(trx);
          },
          { guard: [{ table: 'tenant', id: guardId }] },
        );
        const txB = withTx(
          b.db,
          async (trx) => {
            bStarted();
            await touch('B')(trx);
          },
          { guard: [{ table: 'tenant', id: guardId }], onRetry: () => (retries += 1) },
        );
        const results = await Promise.allSettled([txA, txB]);
        for (const r of results) if (r.status === 'rejected') throw r.reason;
      } finally {
        await a.close();
        await b.close();
      }
      assert.ok(retries >= 1, 'erwartet mindestens eine Wiederholung wegen Konflikt');
      return `beide Transaktionen erfolgreich, ${retries} Wiederholung(en) nach 40001`;
    },
  },
  {
    id: 'D-05',
    title: 'Grenze 3.000 geänderte Zeilen je Transaktion',
    async run(env) {
      const db = env.openDatabase('app_rw');
      const prefix = `lim-${Date.now().toString(36)}`;
      let outcome = '';
      try {
        await withTx(db.db, async (trx) => {
          const rows = Array.from({ length: 3001 }, (_, i) => ({
            tenantKey: `${prefix}-${i}`,
            displayName: 'x',
          }));
          await trx.insertInto('tenant').values(rows).execute();
        });
        assert.fail('3.001 Zeilen wurden nicht abgelehnt');
      } catch (error) {
        if (error instanceof RowLimitExceededError) outcome = 'Zeilenzähler';
        else if ((error as { code?: unknown }).code === '54000') outcome = 'DSQL 54000';
        else throw error;
      } finally {
        await db.close();
      }
      const left = await env.admin.query(
        'SELECT count(*)::int AS n FROM tenant WHERE tenant_key LIKE $1',
        [`${prefix}-%`],
      );
      assert.equal(left.rows[0]?.n, 0, 'abgelehnte Transaktion hat Zeilen hinterlassen');
      return `3.001 Zeilen abgelehnt (${outcome}), nichts übernommen`;
    },
  },
  {
    id: 'D-06',
    title: 'Mandantenisolation (TenantRepository) und Gegenprobe',
    async run(env) {
      const tenantA = await insertTenant(env.admin, `iso-a-${Date.now().toString(36)}`);
      const tenantB = await insertTenant(env.admin, `iso-b-${Date.now().toString(36)}`);
      const open = env.openDatabase('app_rw');
      try {
        const repoA = open.repositories({ tenantId: tenantA }).tenant;
        assert.equal((await repoA.current())?.id, tenantA, 'eigener Mandant nicht lesbar');
        await assertIsolated([
          { name: 'TenantRepository.byId(B)', call: () => repoA.byId(tenantB) },
          { name: 'TenantRepository.rename(B)', call: () => repoA.rename(tenantB, 'übernommen') },
        ]);
        const leaky = new LeakyTenantRepository(open.db, { tenantId: tenantA });
        await assert.rejects(
          assertIsolated([
            { name: 'LeakyTenantRepository.byId(B)', call: () => leaky.byId(tenantB) },
          ]),
          IsolationLeakError,
          'Gegenprobe: fehlender tenant_id-Filter wurde nicht erkannt',
        );
      } finally {
        await open.close();
      }
      return 'fremder Mandant unsichtbar; fehlender Filter wird erkannt';
    },
  },
];

export { isOccConflict };
