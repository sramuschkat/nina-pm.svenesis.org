/**
 * Integrationstest gegen PostgreSQL 16 (TK 17): legt eine frische Datenbank an, führt die Suites aus
 * src/testing aus und löscht sie wieder. Läuft im CI (Service-Container) und lokal mit `pnpm db:up`;
 * ohne DATABASE_URL wird er übersprungen (CLAUDE.md, Umgebung).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/migrate/files';
import { openDatabase } from '../src/repositories/database';
import { seedCore, type SeedDemo } from '../src/seed';
import { suites, type SuiteEnv } from '../src/testing/suites';

const url = process.env.DATABASE_URL;
const PASSWORDS = {
  app_rw: process.env.APP_RW_PASSWORD ?? 'app_rw_local',
  app_job: process.env.APP_JOB_PASSWORD ?? 'app_job_local',
};
const OPTIONS = '-c default_transaction_isolation=repeatable\\ read';

describe.skipIf(!url)('PostgreSQL 16: Migrationen, Rechte, withTx, Isolation', () => {
  const dbName = `ninapm_t_${Date.now().toString(36)}`;
  let root: pg.Client;
  let admin: pg.Client;
  let env: SuiteEnv;

  const urlFor = (user?: { name: string; password: string }) => {
    const u = new URL(url ?? '');
    u.pathname = `/${dbName}`;
    if (user) {
      u.username = user.name;
      u.password = user.password;
    }
    return u.toString();
  };

  beforeAll(async () => {
    root = new pg.Client({ connectionString: url, options: OPTIONS });
    await root.connect();
    await root.query(`CREATE DATABASE ${dbName}`);
    admin = new pg.Client({ connectionString: urlFor(), options: OPTIONS });
    await admin.connect();
    env = {
      mode: 'postgres',
      admin,
      migrations: loadMigrations(),
      migration0000: { mode: 'postgres', localPasswords: PASSWORDS },
      async connectAs(role) {
        const c = new pg.Client({
          connectionString: urlFor({ name: role, password: PASSWORDS[role] }),
          options: OPTIONS,
        });
        await c.connect();
        return c;
      },
      openDatabase: (role) =>
        openDatabase({
          kind: 'postgres',
          connectionString: urlFor({ name: role, password: PASSWORDS[role] }),
        }),
    };
  });

  afterAll(async () => {
    await admin?.end();
    await root?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await root?.end();
  });

  for (const suite of suites) {
    it(`${suite.id} ${suite.title}`, async () => {
      await suite.run(env);
    }, 60_000);
  }

  it('Seed: Mandanten, Identitäten, Super User, Mitgliedschaften; idempotent; Owner gesetzt', async () => {
    const seed = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../docs/seed/seed-demo.json', import.meta.url)),
        'utf8',
      ),
    ) as SeedDemo;
    const first = await seedCore(admin, seed);
    await seedCore(admin, seed);
    const count = async (sql: string) => Number((await admin.query(sql)).rows[0]?.n);
    expect(first).toMatchObject({ tenants: 2, identities: 6, members: 5, superUsers: 1 });
    expect(first.notes.join()).toContain('befristete Admins entfallen');
    expect(
      await count("SELECT count(*)::int AS n FROM tenant WHERE tenant_key IN ('demo','other')"),
    ).toBe(2);
    expect(await count('SELECT count(*)::int AS n FROM app_user')).toBe(5);
    expect(await count('SELECT count(*)::int AS n FROM super_user')).toBe(1);
    const owner = await admin.query(
      "SELECT i.discord_username FROM tenant t JOIN app_user a ON a.id = t.owner_member_id JOIN identity i ON i.id = a.identity_id WHERE t.tenant_key = 'demo'",
    );
    expect(owner.rows[0]?.discord_username).toBe('demo_owner');
  });
});
