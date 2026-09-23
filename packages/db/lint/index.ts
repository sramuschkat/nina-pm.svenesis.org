/**
 * DSQL-Lint für Migrationen (TK 6.8, rules/dsql.md, ADR-S1). Prüft jede Anweisung einer Migration
 * und dass jede neue Tabelle genau die GRANTs aus TK 6.2 (src/grants.ts) für beide Rollen trägt.
 */
import { DB_ROLES, TABLE_GRANTS, type DbRole, type Privilege } from '../src/grants';
import { splitStatements } from '../src/migrate/statements';

export interface LintFinding {
  readonly file: string;
  readonly statement: number;
  readonly rule: string;
  readonly message: string;
}

/** Entfernt Zeichenketten und Kommentare, damit Regeln nicht auf Kommentartext anschlagen. */
export function stripSql(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i];
    if (c === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i += 1;
          break;
        } else i += 1;
      }
      out += "''";
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

const RULES: { rule: string; test: RegExp; message: string }[] = [
  {
    rule: 'trigger',
    test: /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
    message: 'Trigger sind in DSQL nicht unterstützt',
  },
  {
    rule: 'plpgsql',
    test: /\bLANGUAGE\s+plpgsql\b/i,
    message: 'PL/pgSQL ist in DSQL nicht unterstützt',
  },
  {
    rule: 'serial',
    test: /\b(SMALL|BIG)?SERIAL\b/i,
    message: 'SERIAL verboten, UUID v7 verwenden',
  },
  { rule: 'truncate', test: /\bTRUNCATE\b/i, message: 'TRUNCATE ist in DSQL nicht unterstützt' },
  {
    rule: 'temp-table',
    test: /\bCREATE\s+(TEMP|TEMPORARY)\s+TABLE\b/i,
    message: 'TEMP TABLE ist in DSQL nicht unterstützt',
  },
  {
    rule: 'index-async',
    test: /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!ASYNC\b)/i,
    message: 'Index nur mit CREATE INDEX ASYNC',
  },
  {
    rule: 'fk-action',
    test: /\bON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)\b/i,
    message: 'ON DELETE/ON UPDATE-Aktionen werden nicht genutzt (Löschen in Stapeln)',
  },
  {
    rule: 'alter-type',
    test: /\bALTER\s+COLUMN\s+\w+\s+(SET\s+DATA\s+)?TYPE\b/i,
    message: 'ALTER COLUMN TYPE ist nicht unterstützt',
  },
  {
    rule: 'set-not-null',
    test: /\bALTER\s+COLUMN\s+\w+\s+SET\s+NOT\s+NULL\b/i,
    message: 'SET NOT NULL ist nicht unterstützt (ADR-S1)',
  },
  {
    rule: 'add-column-constraint',
    test: /\bADD\s+COLUMN\b[^;]*?\b(DEFAULT|NOT\s+NULL|CHECK|REFERENCES|UNIQUE|PRIMARY\s+KEY)\b/i,
    message: 'ADD COLUMN nur ohne DEFAULT/Constraint; Default danach per SET DEFAULT (ADR-S1)',
  },
  {
    rule: 'grant-schema',
    test: /\bGRANT\b[^;]*\bON\s+SCHEMA\b/i,
    message: 'GRANT … ON SCHEMA ist nicht unterstützt und nicht nötig (ADR-S1)',
  },
  {
    rule: 'constraint-not-valid',
    test: /\bADD\s+CONSTRAINT\b(?![^;]*\bNOT\s+VALID\b)/i,
    message: 'Nachträgliche Constraints nur mit NOT VALID + ALTER TABLE ASYNC … VALIDATE',
  },
];

interface ParsedGrant {
  privileges: Set<Privilege>;
  updateColumns?: string[];
}

function parseGrants(stripped: string): Map<string, Map<DbRole, ParsedGrant>> {
  const result = new Map<string, Map<DbRole, ParsedGrant>>();
  for (const m of stripped.matchAll(
    /\bGRANT\s+([\s\S]+?)\s+ON\s+(?:TABLE\s+)?(\w+)\s+TO\s+(\w+)/gi,
  )) {
    const [, privText = '', table = '', role = ''] = m;
    if (!(DB_ROLES as readonly string[]).includes(role)) continue;
    const perTable = result.get(table) ?? new Map<DbRole, ParsedGrant>();
    const entry = perTable.get(role as DbRole) ?? { privileges: new Set<Privilege>() };
    const cols = /^UPDATE\s*\(([^)]*)\)$/i.exec(privText.trim());
    if (cols?.[1]) {
      entry.updateColumns = cols[1].split(',').map((c) => c.trim());
    } else {
      for (const p of privText.split(','))
        entry.privileges.add(p.trim().toUpperCase() as Privilege);
    }
    perTable.set(role as DbRole, entry);
    result.set(table, perTable);
  }
  return result;
}

const sameSet = (a: Iterable<string>, b: Iterable<string>) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function lintMigration(file: string, sql: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const statements = splitStatements(sql);
  const createdTables: { table: string; statement: number }[] = [];
  statements.forEach((statement, index) => {
    const n = index + 1;
    const stripped = stripSql(statement);
    const semicolons = (stripped.match(/;/g) ?? []).length;
    if (semicolons > 1 || (semicolons === 1 && !/;\s*$/.test(stripped))) {
      findings.push({
        file,
        statement: n,
        rule: 'one-statement',
        message: 'genau eine Anweisung je `-- statement`',
      });
    }
    for (const r of RULES)
      if (r.test.test(stripped))
        findings.push({ file, statement: n, rule: r.rule, message: r.message });
    const table = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(stripped)?.[1];
    if (table) createdTables.push({ table, statement: n });
  });

  const grants = parseGrants(stripSql(statements.join('\n')));
  for (const { table, statement } of createdTables) {
    const expected = TABLE_GRANTS[table];
    if (!expected) {
      findings.push({
        file,
        statement,
        rule: 'grant-mapping',
        message: `Tabelle ${table} ohne Zuordnung in TK 6.2 (src/grants.ts)`,
      });
      continue;
    }
    for (const role of DB_ROLES) {
      const actual = grants.get(table)?.get(role);
      const cols = role === 'app_job' ? expected.app_job_update_columns : undefined;
      const want = expected[role].filter((p) => !(cols && p === 'UPDATE'));
      const have = actual ? [...actual.privileges] : [];
      if (!sameSet(have, want) || !sameSet(actual?.updateColumns ?? [], cols ?? [])) {
        findings.push({
          file,
          statement,
          rule: 'grants',
          message: `GRANTs für ${table} an ${role}: erwartet ${want.join(',') || '–'}${cols ? ` + UPDATE(${cols.join(',')})` : ''}, vorhanden ${have.join(',') || '–'}${actual?.updateColumns ? ` + UPDATE(${actual.updateColumns.join(',')})` : ''}`,
        });
      }
    }
  }
  return findings;
}
