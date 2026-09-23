/**
 * Prüfpunkte des DSQL-Spikes in der Reihenfolge aus TK 6.0 und dem Brief AP-S1.
 * Jeder Schritt hält fest, was laut Konzept erwartet wird; Abweichungen landen im Protokoll und
 * werden zu Änderungsvorschlägen für TK 6.0 und rules/dsql.md. Wegwerfcode, kein Produktivcode.
 */
import { randomBytes } from 'node:crypto';
import type { Recorder, SqlClient } from './protocol';

export interface CheckContext {
  readonly rec: Recorder;
  /** Erste Verbindung als `admin` über den offiziellen Connector. */
  readonly admin: SqlClient;
  /** Weitere Verbindung über den offiziellen Connector als DB-Rolle `user`. */
  connect(user: string): Promise<SqlClient>;
  /** Verbindung ohne Connector: node-postgres + DsqlSigner (Rückfall aus TK 6.5). */
  connectPlain(user: string): Promise<SqlClient>;
  /** IAM-Principal des Aufrufers für AWS IAM GRANT (Rolle bzw. Benutzer). */
  readonly iamPrincipalArn: string;
  readonly skipLong: boolean;
  readonly now: () => number;
}

export interface Check {
  readonly id: string;
  readonly title: string;
  readonly tk: string;
  run(ctx: CheckContext): Promise<string>;
}

export const OCC_CODES = ['40001', 'OC000', 'OC001'] as const;

/** Zufällige, kaum komprimierbare Zeichenkette mit genau `bytes` Zeichen. */
export function randomText(bytes: number): string {
  return randomBytes(Math.ceil((bytes * 3) / 4) + 3)
    .toString('base64')
    .slice(0, bytes);
}

const MiB = 1024 * 1024;
const P1 = '00000000-0000-4000-8000-000000000001';
const DEAD = '00000000-0000-4000-8000-00000000dead';

/** Liest eine Job-ID aus der Antwort von CREATE INDEX ASYNC bzw. ALTER TABLE ASYNC. */
function jobIdOf(rows: Record<string, unknown>[]): string | undefined {
  const first = rows[0];
  if (!first) return undefined;
  const value = first.job_id ?? Object.values(first)[0];
  return typeof value === 'string' ? value : undefined;
}

async function closeQuietly(client: SqlClient | undefined) {
  try {
    await client?.end();
  } catch {
    /* Verbindung ist bereits zu */
  }
}

export const checks: readonly Check[] = [
  {
    id: 'S1-01',
    title: 'Fremdschlüssel, auch nachträglich mit NOT VALID',
    tk: '(1)',
    async run({ rec, admin }) {
      const a = 'admin';
      await rec.step(
        admin,
        a,
        'CREATE TABLE spike_parent (id uuid PRIMARY KEY, name text NOT NULL)',
      );
      await rec.step(
        admin,
        a,
        'CREATE TABLE spike_child (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid NOT NULL REFERENCES spike_parent(id))',
      );
      await rec.step(admin, a, 'INSERT INTO spike_parent (id, name) VALUES ($1, $2)', {
        params: [P1, 'p1'],
      });
      await rec.step(admin, a, 'INSERT INTO spike_child (parent_id) VALUES ($1)', { params: [P1] });
      const bad = await rec.step(admin, a, 'INSERT INTO spike_child (parent_id) VALUES ($1)', {
        params: [DEAD],
        expect: 'error',
        codes: ['23503'],
        note: 'FK-Verletzung muss abgelehnt werden',
      });
      await rec.step(
        admin,
        a,
        'CREATE TABLE spike_child2 (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid)',
      );
      await rec.step(admin, a, 'INSERT INTO spike_child2 (parent_id) VALUES ($1)', {
        params: [P1],
      });
      await rec.step(
        admin,
        a,
        'ALTER TABLE spike_child2 ADD CONSTRAINT fk_child2_parent_direct FOREIGN KEY (parent_id) REFERENCES spike_parent(id)',
        { expect: 'error', note: 'laut TK 6.0 nachträglich nur mit NOT VALID' },
      );
      const nv = await rec.step(
        admin,
        a,
        'ALTER TABLE spike_child2 ADD CONSTRAINT fk_child2_parent FOREIGN KEY (parent_id) REFERENCES spike_parent(id) NOT VALID',
      );
      const val = await rec.step(
        admin,
        a,
        'ALTER TABLE ASYNC spike_child2 VALIDATE CONSTRAINT fk_child2_parent',
        {
          note: 'asynchrone Validierung laut TK 6.0',
        },
      );
      const job = jobIdOf(val.rows);
      if (job)
        await rec.step(admin, a, 'SELECT sys.wait_for_job($1)', { params: [job], expect: 'any' });
      await rec.step(admin, a, 'INSERT INTO spike_child2 (parent_id) VALUES ($1)', {
        params: [DEAD],
        expect: 'error',
        codes: ['23503'],
        note: 'nach NOT VALID gilt der FK für neue Zeilen',
      });
      return `FK-Verletzung ${bad.ok ? 'NICHT abgelehnt' : `abgelehnt (${bad.code ?? '?'})`}; NOT VALID ${nv.ok ? 'ok' : `Fehler ${nv.code ?? ''}`}; ASYNC VALIDATE ${val.ok ? `ok${job ? ` (Job ${job})` : ''}` : `Fehler ${val.code ?? ''}`}`;
    },
  },
  {
    id: 'S1-02',
    title: 'jsonb als Spaltentyp, Grenze 1 MiB komprimiert',
    tk: '(2)',
    async run({ rec, admin }) {
      const a = 'admin';
      const create = await rec.step(
        admin,
        a,
        'CREATE TABLE spike_doc (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doc jsonb NOT NULL)',
      );
      await rec.step(
        admin,
        a,
        `INSERT INTO spike_doc (doc) VALUES ('{"a": 1, "b": [1, 2], "c": {"d": "x"}}'::jsonb)`,
      );
      const read = await rec.step(
        admin,
        a,
        `SELECT doc->>'a' AS a, doc->'c'->>'d' AS d, doc @> '{"a": 1}' AS contains, jsonb_typeof(doc->'b') AS b FROM spike_doc`,
      );
      await rec.step(
        admin,
        a,
        `INSERT INTO spike_doc (doc) VALUES (jsonb_build_object('blob', repeat('x', $1::int)))`,
        {
          params: [2 * MiB],
          paramsLabel: '2 MiB gut komprimierbar',
          note: 'unkomprimiert > 1 MiB, komprimiert klein',
        },
      );
      await rec.step(
        admin,
        a,
        `INSERT INTO spike_doc (doc) VALUES (jsonb_build_object('blob', $1::text))`,
        {
          params: [randomText(Math.round(0.8 * MiB))],
          paramsLabel: '0,8 MiB zufällig',
        },
      );
      const big = await rec.step(
        admin,
        a,
        `INSERT INTO spike_doc (doc) VALUES (jsonb_build_object('blob', $1::text))`,
        {
          params: [randomText(Math.round(1.6 * MiB))],
          paramsLabel: '1,6 MiB zufällig',
          expect: 'error',
          note: 'über 1 MiB komprimiert',
        },
      );
      await rec.step(admin, a, 'CREATE INDEX ASYNC ix_spike_doc_doc ON spike_doc (doc)', {
        expect: 'error',
        note: 'jsonb laut TK 6.0 nicht indexierbar',
      });
      return `Spalte ${create.ok ? 'ok' : 'Fehler'}; Operatoren ${read.ok ? JSON.stringify(read.rows[0]) : 'Fehler'}; 1,6 MiB zufällig ${big.ok ? 'angenommen' : `abgelehnt (${big.code ?? '?'})`}`;
    },
  },
  {
    id: 'S1-03',
    title: 'ALTER TABLE ADD COLUMN mit DEFAULT',
    tk: 'ALTER TABLE',
    async run({ rec, admin }) {
      const a = 'admin';
      await rec.step(admin, a, 'CREATE TABLE spike_add (id int PRIMARY KEY)');
      await rec.step(admin, a, 'INSERT INTO spike_add (id) VALUES (1), (2), (3)');
      const add = await rec.step(admin, a, "ALTER TABLE spike_add ADD COLUMN c text DEFAULT 'x'");
      const filled = await rec.step(
        admin,
        a,
        "SELECT count(*)::int AS n FROM spike_add WHERE c = 'x'",
      );
      const notNull = await rec.step(
        admin,
        a,
        'ALTER TABLE spike_add ADD COLUMN n int NOT NULL DEFAULT 0',
      );
      await rec.step(admin, a, 'ALTER TABLE spike_add ALTER COLUMN c TYPE varchar(10)', {
        expect: 'error',
        note: 'laut TK 6.0 nicht unterstützt',
      });
      await rec.step(admin, a, 'ALTER TABLE spike_add DROP COLUMN n', { expect: 'any' });
      return `ADD COLUMN DEFAULT ${add.ok ? 'ok' : 'Fehler'}, Bestandszeilen mit Default: ${String(filled.rows[0]?.n ?? '?')} von 3; NOT NULL DEFAULT ${notNull.ok ? 'ok' : `Fehler ${notNull.code ?? ''}`}`;
    },
  },
  {
    id: 'S1-04',
    title: 'SELECT … FOR UPDATE verhindert Schreib-Schiefe (OCC)',
    tk: 'Nebenläufigkeit',
    async run({ rec, admin, connect }) {
      await rec.step(
        admin,
        'admin',
        'CREATE TABLE spike_guard (id int PRIMARY KEY, v int NOT NULL)',
      );
      await rec.step(
        admin,
        'admin',
        'CREATE TABLE spike_ws (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), who text NOT NULL)',
      );
      await rec.step(admin, 'admin', 'INSERT INTO spike_guard (id, v) VALUES (1, 0)');
      await rec.step(admin, 'admin', 'SHOW transaction_isolation', {
        note: 'erwartet repeatable read',
      });
      const a = await connect('admin');
      const b = await connect('admin');
      try {
        const run = async (label: string, lock: string, expectSecond: 'ok' | 'error') => {
          const sel = `SELECT v FROM spike_guard WHERE id = 1${lock}`;
          await rec.step(a, 'A', 'BEGIN', { note: label });
          await rec.step(a, 'A', sel);
          await rec.step(b, 'B', 'BEGIN');
          await rec.step(b, 'B', sel);
          await rec.step(a, 'A', 'INSERT INTO spike_ws (who) VALUES ($1)', {
            params: [`${label}-A`],
          });
          await rec.step(a, 'A', 'COMMIT');
          await rec.step(b, 'B', 'INSERT INTO spike_ws (who) VALUES ($1)', {
            params: [`${label}-B`],
          });
          const commit = await rec.step(b, 'B', 'COMMIT', {
            expect: expectSecond,
            ...(expectSecond === 'error' ? { codes: [...OCC_CODES] } : {}),
          });
          if (!commit.ok) await rec.step(b, 'B', 'ROLLBACK', { expect: 'any' });
          return commit;
        };
        const plain = await run('ohne FOR UPDATE', '', 'ok');
        const locked = await run('mit FOR UPDATE', ' FOR UPDATE', 'error');
        // Grundfall: beide schreiben dieselbe Zeile.
        await rec.step(a, 'A', 'BEGIN', { note: 'gleiche Zeile schreiben' });
        await rec.step(a, 'A', 'UPDATE spike_guard SET v = v + 1 WHERE id = 1');
        await rec.step(b, 'B', 'BEGIN');
        await rec.step(b, 'B', 'UPDATE spike_guard SET v = v + 1 WHERE id = 1');
        await rec.step(a, 'A', 'COMMIT');
        const same = await rec.step(b, 'B', 'COMMIT', { expect: 'error', codes: [...OCC_CODES] });
        if (!same.ok) await rec.step(b, 'B', 'ROLLBACK', { expect: 'any' });
        return `ohne FOR UPDATE: zweiter Commit ${plain.ok ? 'ok (Schreib-Schiefe möglich)' : `Fehler ${plain.code ?? ''}`}; mit FOR UPDATE: ${locked.ok ? 'ok – KEIN Schutz' : `Konflikt ${locked.code ?? ''}`}; gleiche Zeile: ${same.ok ? 'ok – KEIN Konflikt' : `Konflikt ${same.code ?? ''}`}`;
      } finally {
        await closeQuietly(a);
        await closeQuietly(b);
      }
    },
  },
  {
    id: 'S1-05',
    title: 'INSERT … ON CONFLICT',
    tk: '(3)',
    async run({ rec, admin }) {
      const a = 'admin';
      const id = '00000000-0000-4000-8000-0000000000aa';
      await rec.step(admin, a, 'CREATE TABLE spike_upsert (id uuid PRIMARY KEY, n int NOT NULL)');
      const first = await rec.step(
        admin,
        a,
        'INSERT INTO spike_upsert (id, n) VALUES ($1, 1) ON CONFLICT (id) DO NOTHING RETURNING id',
        {
          params: [id],
        },
      );
      const dup = await rec.step(
        admin,
        a,
        'INSERT INTO spike_upsert (id, n) VALUES ($1, 1) ON CONFLICT (id) DO NOTHING RETURNING id',
        {
          params: [id],
          note: 'Duplikat: keine Zeile zurück',
        },
      );
      const upd = await rec.step(
        admin,
        a,
        'INSERT INTO spike_upsert (id, n) VALUES ($1, 1) ON CONFLICT (id) DO UPDATE SET n = spike_upsert.n + EXCLUDED.n RETURNING n',
        { params: [id] },
      );
      await rec.step(
        admin,
        a,
        'INSERT INTO spike_upsert (id, n) VALUES ($1, 5) ON CONFLICT DO NOTHING',
        {
          params: [id],
          expect: 'any',
          note: 'ohne Konfliktziel',
        },
      );
      return `DO NOTHING: neu ${String(first.rowCount)} / Duplikat ${String(dup.rowCount)} Zeile(n); DO UPDATE: ${upd.ok ? `n = ${String(upd.rows[0]?.n)}` : `Fehler ${upd.code ?? ''}`}`;
    },
  },
  {
    id: 'S1-06',
    title: 'CREATE INDEX ASYNC und Wartefunktion',
    tk: '(4)',
    async run({ rec, admin }) {
      const a = 'admin';
      const fns = await rec.step(
        admin,
        a,
        "SELECT p.proname AS name, pg_get_function_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'sys' ORDER BY 1",
        { expect: 'any', note: 'Funktionen im Schema sys' },
      );
      await rec.step(
        admin,
        a,
        'CREATE TABLE spike_idx (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, k text)',
      );
      await rec.step(
        admin,
        a,
        'INSERT INTO spike_idx (tenant_id, k) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)',
        {
          params: ['a', 'b'],
        },
      );
      const created = await rec.step(
        admin,
        a,
        'CREATE INDEX ASYNC ix_spike_idx_tenant_k ON spike_idx (tenant_id, k)',
      );
      const job = jobIdOf(created.rows);
      let waitResult = 'keine Job-ID';
      if (job) {
        const wait = await rec.step(admin, a, 'SELECT sys.wait_for_job($1) AS done', {
          params: [job],
          note: 'Kandidat laut Doku',
        });
        waitResult = wait.ok
          ? `sys.wait_for_job ok (${JSON.stringify(wait.rows[0])})`
          : `sys.wait_for_job Fehler ${wait.code ?? ''}`;
        await rec.step(admin, a, 'SELECT * FROM sys.jobs WHERE job_id = $1', {
          params: [job],
          expect: 'any',
        });
      }
      await rec.step(
        admin,
        a,
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'spike_idx' ORDER BY 1",
        { expect: 'any' },
      );
      await rec.step(admin, a, 'CREATE INDEX ix_spike_idx_k ON spike_idx (k)', {
        expect: 'error',
        note: 'ohne ASYNC laut rules/dsql.md verboten',
      });
      const names = fns.rows.map((r) => String(r.name)).join(', ');
      return `Job-ID ${job ?? 'fehlt'}; ${waitResult}; sys-Funktionen: ${names || '–'}`;
    },
  },
  {
    id: 'S1-07',
    title: 'Rollen, GRANT und AWS IAM GRANT',
    tk: '(5)',
    async run({ rec, admin, connect, iamPrincipalArn }) {
      const a = 'admin';
      const role = 'spike_app';
      await rec.step(admin, a, `CREATE ROLE ${role} WITH LOGIN`);
      const iam = await rec.step(admin, a, `AWS IAM GRANT ${role} TO '${iamPrincipalArn}'`, {
        note: 'Aufrufer als Principal; in prod Lambda-Rollen',
      });
      await rec.step(admin, a, 'SELECT * FROM sys.iam_pg_role_mappings', { expect: 'any' });
      await rec.step(admin, a, 'CREATE TABLE spike_granted (id int PRIMARY KEY, v text NOT NULL)');
      await rec.step(admin, a, "INSERT INTO spike_granted (id, v) VALUES (1, 'a')");
      await rec.step(admin, a, `GRANT USAGE ON SCHEMA public TO ${role}`);
      const grant = await rec.step(admin, a, `GRANT SELECT ON spike_granted TO ${role}`);
      let asRole: SqlClient | undefined;
      let summary = `AWS IAM GRANT ${iam.ok ? 'ok' : `Fehler ${iam.code ?? ''}`}; GRANT ${grant.ok ? 'ok' : 'Fehler'}`;
      try {
        const t0 = performance.now();
        asRole = await connect(role);
        rec.info(
          role,
          `Verbindung als ${role} (IAM-Token dsql:DbConnect)`,
          'ok',
          Math.round(performance.now() - t0),
        );
        const sel = await rec.step(asRole, role, 'SELECT v FROM spike_granted WHERE id = 1');
        const ins = await rec.step(
          asRole,
          role,
          "INSERT INTO spike_granted (id, v) VALUES (2, 'b')",
          {
            expect: 'error',
            codes: ['42501'],
            note: 'ohne INSERT-Recht',
          },
        );
        summary += `; als ${role}: SELECT ${sel.ok ? 'ok' : 'Fehler'}, INSERT ${ins.ok ? 'NICHT abgelehnt' : `abgelehnt (${ins.code ?? '?'})`}`;
      } catch (error) {
        rec.info(role, `Verbindung als ${role}`, `Fehler: ${String(error)}`, 0, false);
        summary += `; Verbindung als ${role} gescheitert`;
      } finally {
        await closeQuietly(asRole);
      }
      await rec.step(admin, a, `CREATE ROLE ${role} WITH LOGIN`, {
        expect: 'error',
        codes: ['42710'],
        note: 'zweites Anlegen: Migration 0000 muss vorher prüfen',
      });
      await rec.step(admin, a, 'SELECT rolname FROM pg_roles WHERE rolname = $1', {
        params: [role],
      });
      await rec.step(admin, a, `AWS IAM REVOKE ${role} FROM '${iamPrincipalArn}'`, {
        expect: 'any',
      });
      return summary;
    },
  },
  {
    id: 'S1-08',
    title: 'Node-Connector, Rückfall ohne Connector und Latenz vom Rechner',
    tk: '6.5',
    async run({ rec, admin, connect, connectPlain, now }) {
      const version = await rec.step(admin, 'admin', 'SELECT version() AS version');
      const times: number[] = [];
      for (let i = 0; i < 30; i += 1) {
        const t0 = now();
        await admin.query('SELECT 1');
        times.push(now() - t0);
      }
      times.sort((x, y) => x - y);
      const pick = (q: number) =>
        Math.round(times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0);
      const latency = `p50 ${pick(0.5)} ms, p95 ${pick(0.95)} ms, max ${pick(1)} ms`;
      rec.info('admin', '30 × SELECT 1 über bestehende Verbindung', latency);

      let plainMs = -1;
      const t1 = now();
      const viaConnector = await connect('admin');
      const connectorMs = Math.round(now() - t1);
      rec.info(
        'neu',
        'Verbindungsaufbau AuroraDSQLClient (Token + TLS + Anmeldung)',
        'ok',
        connectorMs,
      );
      await closeQuietly(viaConnector);
      try {
        const t2 = now();
        const plain = await connectPlain('admin');
        plainMs = Math.round(now() - t2);
        await rec.step(plain, 'pg+Signer', 'SELECT 1 AS ok');
        rec.info('pg+Signer', 'Verbindungsaufbau node-postgres + DsqlSigner', 'ok', plainMs);
        await closeQuietly(plain);
      } catch (error) {
        rec.info(
          'pg+Signer',
          'Verbindungsaufbau node-postgres + DsqlSigner',
          `Fehler: ${String(error)}`,
          0,
          false,
        );
      }
      const v = typeof version.rows[0]?.version === 'string' ? version.rows[0].version : '?';
      return `Abfrage-Latenz ${latency}; Verbindungsaufbau Connector ${connectorMs} ms, pg+Signer ${plainMs < 0 ? 'Fehler' : `${plainMs} ms`}; ${v}`;
    },
  },
  {
    id: 'S1-09',
    title: 'Grenzen je Transaktion: Zeilen, Datenvolumen, Laufzeit, DDL',
    tk: '(6) Grenzen',
    async run({ rec, admin, connect, skipLong }) {
      const a = 'admin';
      await rec.step(admin, a, 'CREATE TABLE spike_rows (id int PRIMARY KEY, pad text)');
      await rec.step(admin, a, 'CREATE TABLE spike_vol (id int PRIMARY KEY, pad text NOT NULL)');
      const c = await connect('admin');
      try {
        // Zeilen: 3.000 erlaubt, 3.001 nicht.
        await rec.step(c, 'C', 'BEGIN');
        await rec.step(
          c,
          'C',
          "INSERT INTO spike_rows (id, pad) SELECT g, 'x' FROM generate_series(1, 3000) g",
        );
        const ok3000 = await rec.step(c, 'C', 'COMMIT');
        if (!ok3000.ok) await rec.step(c, 'C', 'ROLLBACK', { expect: 'any' });
        await rec.step(c, 'C', 'BEGIN');
        const ins3001 = await rec.step(
          c,
          'C',
          "INSERT INTO spike_rows (id, pad) SELECT g, 'x' FROM generate_series(3001, 6001) g",
          {
            expect: 'any',
            note: '3.001 Zeilen',
          },
        );
        const commit3001 = ins3001.ok
          ? await rec.step(c, 'C', 'COMMIT', {
              expect: 'error',
              note: '3.001 Zeilen in einer Transaktion',
            })
          : ins3001;
        if (!commit3001.ok) await rec.step(c, 'C', 'ROLLBACK', { expect: 'any' });

        // Datenvolumen: steigende Mengen zufälliger Daten in einer Transaktion.
        const chunk = 256 * 1024;
        let lastOk = 0;
        let firstFail: string | undefined;
        let nextId = 1;
        for (const mib of [1, 2, 4, 8, 16, 32]) {
          await rec.step(c, 'C', 'BEGIN', { note: `${mib} MiB` });
          let failed = false;
          for (let i = 0; i < (mib * MiB) / chunk; i += 1) {
            const r = await rec.step(c, 'C', 'INSERT INTO spike_vol (id, pad) VALUES ($1, $2)', {
              params: [nextId++, randomText(chunk)],
              paramsLabel: `id, 256 KiB zufällig (${mib} MiB gesamt)`,
              expect: 'any',
            });
            if (!r.ok) {
              failed = true;
              firstFail = `${mib} MiB: ${r.code ?? ''} ${r.message ?? ''}`;
              break;
            }
          }
          const commit = failed ? undefined : await rec.step(c, 'C', 'COMMIT', { expect: 'any' });
          if (failed || !commit?.ok) {
            firstFail ??= `${mib} MiB: ${commit?.code ?? ''} ${commit?.message ?? ''}`;
            await rec.step(c, 'C', 'ROLLBACK', { expect: 'any' });
            break;
          }
          lastOk = mib;
        }
        // Protokoll nicht mit hunderten Einfügeschritten füllen: nur die ersten und letzten behalten.
        const volSteps = rec.steps.filter((s) => s.command.startsWith('INSERT INTO spike_vol'));
        if (volSteps.length > 12) {
          const keep = new Set([...volSteps.slice(0, 3), ...volSteps.slice(-3)]);
          const dropped = volSteps.length - keep.size;
          rec.steps = rec.steps.filter(
            (s) => !s.command.startsWith('INSERT INTO spike_vol') || keep.has(s),
          );
          rec.info(
            'C',
            `… ${dropped} weitere Einfügeschritte zu 256 KiB (alle ohne Fehler, sofern unten nicht anders)`,
            'gekürzt',
          );
        }

        // DDL-Regeln: eine DDL je Transaktion, DDL und DML getrennt.
        await rec.step(c, 'C', 'BEGIN', { note: 'zwei DDL' });
        await rec.step(c, 'C', 'CREATE TABLE spike_ddl1 (id int PRIMARY KEY)', { expect: 'any' });
        const twoDdl = await rec.step(c, 'C', 'CREATE TABLE spike_ddl2 (id int PRIMARY KEY)', {
          expect: 'error',
        });
        await rec.step(c, 'C', 'ROLLBACK', { expect: 'any' });
        await rec.step(c, 'C', 'BEGIN', { note: 'DDL + DML' });
        await rec.step(c, 'C', 'CREATE TABLE spike_ddl3 (id int PRIMARY KEY)', { expect: 'any' });
        const mixed = await rec.step(
          c,
          'C',
          "INSERT INTO spike_parent (id, name) VALUES (gen_random_uuid(), 'mix')",
          {
            expect: 'error',
          },
        );
        await rec.step(c, 'C', 'ROLLBACK', { expect: 'any' });

        // Laufzeit zuletzt: DSQL kann die Verbindung dabei schließen.
        let duration = 'übersprungen (--skip-long)';
        if (skipLong) {
          rec.info('C', 'Transaktion > 5 min', 'übersprungen (--skip-long)');
        } else {
          await rec.step(c, 'C', 'BEGIN', { note: 'Laufzeit' });
          await rec.step(c, 'C', 'INSERT INTO spike_rows (id, pad) VALUES (900001, $1)', {
            params: ['lang'],
          });
          const sleep = await rec.step(c, 'C', 'SELECT pg_sleep(310)', {
            expect: 'any',
            note: '310 s',
          });
          const commit = await rec.step(c, 'C', 'COMMIT', {
            expect: 'error',
            note: 'nach > 5 min',
          });
          if (!commit.ok) await rec.step(c, 'C', 'ROLLBACK', { expect: 'any' });
          duration = `pg_sleep ${sleep.ok ? 'ok' : `Fehler ${sleep.code ?? ''}`}, Commit nach 310 s ${commit.ok ? 'angenommen' : `abgelehnt (${commit.code ?? ''})`}`;
        }

        return `3.000 Zeilen ${ok3000.ok ? 'ok' : 'Fehler'}, 3.001 ${commit3001.ok ? 'angenommen' : `abgelehnt (${commit3001.code ?? ''})`}; Volumen zuletzt ok ${lastOk} MiB${firstFail ? `, Grenze bei ${firstFail}` : ''}; Laufzeit: ${duration}; zwei DDL ${twoDdl.ok ? 'erlaubt' : 'abgelehnt'}, DDL+DML ${mixed.ok ? 'erlaubt' : 'abgelehnt'}`;
      } finally {
        await closeQuietly(c);
      }
    },
  },
  {
    id: 'S1-10',
    title: 'Nicht unterstützte Funktionen (rules/dsql.md)',
    tk: 'Nicht unterstützt',
    async run({ rec, admin }) {
      const a = 'admin';
      const results: string[] = [];
      const probe = async (label: string, sql: string) => {
        const r = await rec.step(admin, a, sql, { expect: 'error', note: label });
        results.push(`${label} ${r.ok ? 'MÖGLICH' : 'abgelehnt'}`);
      };
      await probe('TRUNCATE', 'TRUNCATE spike_rows');
      await probe('TEMP TABLE', 'CREATE TEMP TABLE spike_tmp (id int)');
      await probe(
        'PL/pgSQL',
        "CREATE FUNCTION spike_fn() RETURNS int LANGUAGE plpgsql AS 'BEGIN RETURN 1; END'",
      );
      await probe(
        'Trigger',
        'CREATE TRIGGER spike_trg BEFORE INSERT ON spike_rows FOR EACH ROW EXECUTE FUNCTION spike_fn()',
      );
      await probe('Extension', 'CREATE EXTENSION IF NOT EXISTS pgcrypto');
      const seq = await rec.step(admin, a, 'CREATE SEQUENCE spike_seq', {
        expect: 'any',
        note: 'Sequenz (bei uns ohnehin nicht genutzt)',
      });
      results.push(`Sequenz ${seq.ok ? 'möglich' : 'abgelehnt'}`);
      const del = await rec.step(
        admin,
        a,
        'CREATE TABLE spike_cascade (id uuid PRIMARY KEY, p uuid REFERENCES spike_parent(id) ON DELETE CASCADE)',
        {
          expect: 'any',
          note: 'ON DELETE: laut TK unterstützt, bei uns nicht genutzt',
        },
      );
      results.push(`ON DELETE CASCADE ${del.ok ? 'möglich' : 'abgelehnt'}`);
      return results.join('; ');
    },
  },
];
