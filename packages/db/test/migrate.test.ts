import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/migrate/files';
import { migrationsHash } from '../src/migrate/hash';
import { migration0000, prodIamGrants } from '../src/migrate/migration-0000';
import { checksum, forMode, runMigrations } from '../src/migrate/runner';
import type { SqlClient } from '../src/migrate/types';

/** Gefälschte Datenbank: merkt sich schema_migration, Rollen und IAM-Zuordnungen. */
function fakeDb(opts: { failOn?: RegExp; existsOn?: RegExp; jobStatus?: string } = {}) {
  const log: string[] = [];
  const migrations = new Map<string, string>();
  const roles = new Set<string>();
  const iam = new Set<string>();
  const client: SqlClient = {
    query(text: string, params: unknown[] = []) {
      log.push(text);
      const rows = (r: Record<string, unknown>[]) =>
        Promise.resolve({ rows: r, rowCount: r.length });
      if (/^SELECT id, checksum FROM schema_migration/.test(text))
        return rows([...migrations].map(([id, checksum]) => ({ id, checksum })));
      if (/^INSERT INTO schema_migration/.test(text)) {
        migrations.set(String(params[0]), String(params[1]));
        return rows([]);
      }
      if (/FROM pg_roles/.test(text)) return rows(roles.has(String(params[0])) ? [{ one: 1 }] : []);
      if (/^CREATE ROLE (\w+)/.test(text)) {
        roles.add(/^CREATE ROLE (\w+)/.exec(text)?.[1] ?? '');
        return rows([]);
      }
      if (/FROM sys\.iam_pg_role_mappings/.test(text))
        return rows(iam.has(`${String(params[0])}|${String(params[1])}`) ? [{ one: 1 }] : []);
      if (/^AWS IAM GRANT (\w+) TO '([^']+)'/.test(text)) {
        const m = /^AWS IAM GRANT (\w+) TO '([^']+)'/.exec(text);
        iam.add(`${m?.[1] ?? ''}|${m?.[2] ?? ''}`);
        return rows([]);
      }
      if (/FROM sys\.jobs/.test(text)) return rows([{ status: opts.jobStatus ?? 'completed' }]);
      if (/CREATE INDEX ASYNC/.test(text)) return rows([{ job_id: 'abc123' }]);
      if (opts.existsOn?.test(text))
        return Promise.reject(Object.assign(new Error('exists'), { code: '42P07' }));
      if (opts.failOn?.test(text))
        return Promise.reject(Object.assign(new Error('kaputt'), { code: 'XX000' }));
      return rows([]);
    },
  };
  return { client, log, migrations, roles, iam };
}

const M1 = {
  id: '0001_a',
  sql: '-- statement\nCREATE TABLE a (id int);\n-- statement\nCREATE INDEX ASYNC ix_a ON a (id);\n',
};
const M2 = { id: '0002_b', sql: '-- statement\nCREATE TABLE b (id int);\n' };

describe('Migrations-Runner', () => {
  it('führt jede Anweisung einzeln aus und bucht je Anweisung', async () => {
    const db = fakeDb();
    const res = await runMigrations(db.client, [M2, M1], { mode: 'dsql' });
    expect(res.applied).toEqual(['0001_a#001', '0001_a#002', '0002_b#001']);
    expect(db.log).toContain("CALL sys.wait_for_job('abc123')");
  });

  it('ist beim zweiten Lauf ein No-op', async () => {
    const db = fakeDb();
    await runMigrations(db.client, [M1, M2], { mode: 'dsql' });
    expect(await runMigrations(db.client, [M1, M2], { mode: 'dsql' })).toEqual({
      applied: [],
      skipped: 3,
    });
  });

  it('setzt nach Abbruch an der richtigen Stelle fort', async () => {
    const db = fakeDb({ failOn: /CREATE TABLE b/ });
    await expect(runMigrations(db.client, [M1, M2], { mode: 'dsql' })).rejects.toThrow(
      '0002_b#001',
    );
    const retry = fakeDb();
    for (const [k, v] of db.migrations) retry.migrations.set(k, v);
    expect((await runMigrations(retry.client, [M1, M2], { mode: 'dsql' })).applied).toEqual([
      '0002_b#001',
    ]);
  });

  it('bucht eine bereits ausgeführte CREATE-Anweisung nach (Abbruch zwischen DDL und Buchung)', async () => {
    const db = fakeDb({ existsOn: /CREATE TABLE b/ });
    expect((await runMigrations(db.client, [M2], { mode: 'dsql' })).applied).toEqual([
      '0002_b#001',
    ]);
  });

  it('lehnt geänderte, bereits angewandte Migrationen ab', async () => {
    const db = fakeDb();
    await runMigrations(db.client, [M2], { mode: 'dsql' });
    await expect(
      runMigrations(db.client, [{ ...M2, sql: '-- statement\nCREATE TABLE b (id bigint);' }], {
        mode: 'dsql',
      }),
    ).rejects.toThrow('Prüfsumme');
  });

  it('bricht ab, wenn ein DSQL-Job scheitert', async () => {
    const db = fakeDb({ jobStatus: 'failed' });
    await expect(runMigrations(db.client, [M1], { mode: 'dsql' })).rejects.toThrow('failed');
  });

  it('schreibt lokal ASYNC-Anweisungen um und überspringt AWS IAM GRANT', () => {
    expect(forMode('CREATE UNIQUE INDEX ASYNC ux ON t (a);', 'postgres')).toBe(
      'CREATE UNIQUE INDEX ux ON t (a);',
    );
    expect(forMode('CREATE INDEX ASYNC ix ON t (a);', 'postgres')).toBe(
      'CREATE INDEX ix ON t (a);',
    );
    expect(forMode('ALTER TABLE ASYNC t VALIDATE CONSTRAINT fk;', 'postgres')).toBe(
      'ALTER TABLE t VALIDATE CONSTRAINT fk;',
    );
    expect(forMode("AWS IAM GRANT app_rw TO 'arn';", 'postgres')).toBeUndefined();
    expect(forMode('CREATE INDEX ASYNC ix ON t (a);', 'dsql')).toBe(
      'CREATE INDEX ASYNC ix ON t (a);',
    );
  });

  it('Prüfsumme ignoriert Zeilenenden und Rand-Leerraum', () => {
    expect(checksum('CREATE TABLE a (id int);\r\n')).toBe(checksum('  CREATE TABLE a (id int);'));
  });
});

describe('Migration 0000', () => {
  const grants = prodIamGrants('509219055019');

  it('legt Rollen und IAM-Zuordnungen an und ist danach idempotent (DSQL)', async () => {
    const db = fakeDb();
    const first = await migration0000(db.client, { mode: 'dsql', iamGrants: grants });
    expect(first).toEqual([
      'CREATE ROLE app_rw',
      'CREATE ROLE app_job',
      'AWS IAM GRANT app_rw TO arn:aws:iam::509219055019:role/NinaPmApi',
      'AWS IAM GRANT app_rw TO arn:aws:iam::509219055019:role/NinaPmOpsCli',
      'AWS IAM GRANT app_job TO arn:aws:iam::509219055019:role/NinaPmWorker',
    ]);
    expect(await migration0000(db.client, { mode: 'dsql', iamGrants: grants })).toEqual([]);
    expect(db.log.some((l) => /GRANT USAGE ON SCHEMA/i.test(l))).toBe(false);
  });

  it('legt lokal Rollen mit Passwort an und überspringt IAM', async () => {
    const db = fakeDb();
    await migration0000(db.client, {
      mode: 'postgres',
      iamGrants: grants,
      localPasswords: { app_rw: "p'w", app_job: 'x' },
    });
    expect(db.log).toContain("CREATE ROLE app_rw WITH LOGIN PASSWORD 'p''w'");
    expect(db.log.some((l) => l.startsWith('AWS IAM'))).toBe(false);
  });

  it('lehnt ungültige IAM-ARNs ab', async () => {
    await expect(
      migration0000(fakeDb().client, {
        mode: 'dsql',
        iamGrants: [{ role: 'app_rw', arn: "arn'; DROP TABLE x; --" }],
      }),
    ).rejects.toThrow('Ungültige IAM-ARN');
  });
});

describe('Migrationsdateien', () => {
  const migrations = loadMigrations();

  it('liegen nummeriert vor und sind in bundled.ts eingetragen', () => {
    expect(migrations.map((m) => m.id)).toEqual([
      '0001_system',
      '0002_mandant_benutzer',
      '0003_ausruestung',
      '0004_projekte_exoplaneten',
      '0005_ausfuehrung',
      '0006_speicherbedarf',
      '0007_panel_aktiv',
      '0008_rig_sperre_worker',
      '0009_antragsrang_worker',
      '0010_exo_katalog',
      '0011_rollenansicht',
      '0012_kommentare',
      '0013_auto_flats',
      '0014_site_night_forecast',
      '0015_rig_telemetry',
      '0016_hot_path_indexes',
    ]);
    const bundled = readFileSync(
      fileURLToPath(new URL('../src/migrate/bundled.ts', import.meta.url)),
      'utf8',
    );
    for (const m of migrations) expect(bundled).toContain(`id: '${m.id}'`);
    const files = readdirSync(fileURLToPath(new URL('../migrations/', import.meta.url))).filter(
      (f) => f.endsWith('.sql'),
    );
    expect(files).toHaveLength(migrations.length);
  });

  it('Hash ändert sich mit jeder Migration', () => {
    const h = migrationsHash(migrations);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(migrationsHash([...migrations, M2])).not.toBe(h);
  });
});
