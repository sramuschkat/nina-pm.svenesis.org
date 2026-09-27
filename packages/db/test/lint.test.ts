import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintMigration, stripSql } from '../lint/index';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const rules = (sql: string) => lintMigration('probe.sql', sql).map((f) => f.rule);
const ok = (sql: string) => `-- statement\n${sql}\n`;

const GOOD_SITE =
  ok(`CREATE TABLE site (id uuid PRIMARY KEY);`) +
  ok('GRANT SELECT, INSERT, UPDATE, DELETE ON site TO app_rw;') +
  ok('GRANT SELECT, INSERT ON site TO app_job;');

describe('DSQL-Lint (TK 6.8, ADR-S1)', () => {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const read = (f: string) => readFileSync(`${dir}${f}`, 'utf8');
  it.each(files)('%s ist sauber', (file) => {
    const later = files
      .slice(files.indexOf(file) + 1)
      .map(read)
      .join('\n');
    expect(lintMigration(file, read(file), later)).toEqual([]);
  });

  it('ein GRANT aus einer späteren Migration zählt für die Tabelle (0008: UPDATE (updated_at) ON rig)', () => {
    const table =
      ok('CREATE TABLE discord_channel (id uuid PRIMARY KEY);') +
      ok('GRANT SELECT, INSERT, UPDATE, DELETE ON discord_channel TO app_rw;') +
      ok('GRANT SELECT, INSERT ON discord_channel TO app_job;');
    expect(lintMigration('a.sql', table).map((f) => f.rule)).toEqual(['grants']);
    expect(
      lintMigration(
        'a.sql',
        table,
        ok(
          'GRANT UPDATE (enabled, last_delivery_at, last_error, last_error_at) ON discord_channel TO app_job;',
        ),
      ),
    ).toEqual([]);
  });

  it('eine Tabelle mit genau den GRANTs aus TK 6.2 ist sauber', () => {
    expect(rules(GOOD_SITE)).toEqual([]);
  });

  it.each([
    ['index-async', 'CREATE INDEX ix_a ON site (id);'],
    ['index-async', 'CREATE UNIQUE INDEX ix_a ON site (id);'],
    ['trigger', 'CREATE TRIGGER t BEFORE INSERT ON site FOR EACH ROW EXECUTE FUNCTION f();'],
    ['plpgsql', "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS 'BEGIN RETURN 1; END';"],
    ['truncate', 'TRUNCATE site;'],
    ['serial', 'ALTER TABLE site ADD COLUMN n serial;'],
    ['temp-table', 'CREATE TEMP TABLE t (id int);'],
    [
      'fk-action',
      'ALTER TABLE site ADD CONSTRAINT fk FOREIGN KEY (id) REFERENCES tenant(id) ON DELETE CASCADE NOT VALID;',
    ],
    ['alter-type', 'ALTER TABLE site ALTER COLUMN name TYPE varchar(10);'],
    ['set-not-null', 'ALTER TABLE site ALTER COLUMN name SET NOT NULL;'],
    ['add-column-constraint', "ALTER TABLE site ADD COLUMN note text DEFAULT 'x';"],
    ['add-column-constraint', 'ALTER TABLE site ADD COLUMN n int NOT NULL;'],
    ['grant-schema', 'GRANT USAGE ON SCHEMA public TO app_rw;'],
    [
      'constraint-not-valid',
      'ALTER TABLE site ADD CONSTRAINT fk FOREIGN KEY (id) REFERENCES tenant(id);',
    ],
    ['one-statement', 'SELECT 1; SELECT 2;'],
  ])('lehnt %s ab: %s', (rule, sql) => {
    expect(rules(ok(sql))).toContain(rule);
  });

  it('erlaubt die Ersatzwege aus ADR-S1', () => {
    expect(
      rules(
        ok('ALTER TABLE site ADD COLUMN note text;') +
          ok("ALTER TABLE site ALTER COLUMN note SET DEFAULT 'x';"),
      ),
    ).toEqual([]);
    expect(
      rules(
        ok('CREATE INDEX ASYNC ix_a ON site (id);') +
          ok('ALTER TABLE ASYNC site VALIDATE CONSTRAINT fk;'),
      ),
    ).toEqual([]);
    expect(
      rules(
        ok('ALTER TABLE site ADD CONSTRAINT fk FOREIGN KEY (id) REFERENCES tenant(id) NOT VALID;'),
      ),
    ).toEqual([]);
  });

  it('lehnt CREATE TABLE ohne GRANT für app_job ab', () => {
    const sql =
      ok('CREATE TABLE site (id uuid PRIMARY KEY);') +
      ok('GRANT SELECT, INSERT, UPDATE, DELETE ON site TO app_rw;');
    expect(
      lintMigration('x.sql', sql)
        .map((f) => f.message)
        .join(),
    ).toContain('site an app_job');
  });

  it('lehnt zu weite GRANTs ab (app_job darf auth_session nicht sehen)', () => {
    const sql =
      ok('CREATE TABLE auth_session (id uuid PRIMARY KEY);') +
      ok('GRANT SELECT, INSERT, UPDATE, DELETE ON auth_session TO app_rw;') +
      ok('GRANT SELECT ON auth_session TO app_job;');
    expect(rules(sql)).toContain('grants');
  });

  it('lehnt eine neue Tabelle ohne Zuordnung in TK 6.2 ab', () => {
    expect(rules(ok('CREATE TABLE unbekannt (id uuid PRIMARY KEY);'))).toContain('grant-mapping');
  });

  it('prüft Spaltenrechte (discord_channel für app_job)', () => {
    const base =
      ok('CREATE TABLE discord_channel (id uuid PRIMARY KEY);') +
      ok('GRANT SELECT, INSERT, UPDATE, DELETE ON discord_channel TO app_rw;') +
      ok('GRANT SELECT, INSERT ON discord_channel TO app_job;');
    expect(rules(base)).toContain('grants');
    expect(
      rules(
        base +
          ok(
            'GRANT UPDATE (enabled, last_delivery_at, last_error, last_error_at) ON discord_channel TO app_job;',
          ),
      ),
    ).toEqual([]);
  });

  it('ignoriert Kommentare und Zeichenketten', () => {
    expect(stripSql("SELECT 'TRUNCATE; -- x' -- TRUNCATE\n/* CREATE TRIGGER */")).toBe(
      "SELECT '' \n",
    );
    expect(rules(ok("-- TRUNCATE nie\nCOMMENT ON TABLE site IS 'kein TRUNCATE';"))).toEqual([]);
  });
});
