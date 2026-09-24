/**
 * Mandant löschen (FA-MAN-03): Die feste Löschreihenfolge deckt jede Tabelle mit `tenant_id` ab,
 * löscht Kinder vor Eltern, nutzt den Primärschlüssel und kennt jeden Selbstbezug – geprüft gegen das
 * migrierte Schema, damit eine neue Tabelle nicht still übersehen wird.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SELF_REFERENCES, TENANT_DELETE_ORDER } from '../src/repositories/tenant-delete';
import { openPglite, type PgliteDatabase } from '../src/testing/pglite';

let pg: PgliteDatabase;
beforeAll(async () => {
  pg = await openPglite();
});
afterAll(() => pg.close());

const rows = async <T>(query: string) => (await pg.admin.query(query)).rows as T[];

describe('TENANT_DELETE_ORDER', () => {
  it('enthält genau die Tabellen mit tenant_id (außer system_audit)', async () => {
    const tables = await rows<{ table_name: string }>(`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> 'system_audit'`);
    expect(TENANT_DELETE_ORDER.map((t) => t.table).sort()).toEqual(
      tables.map((t) => t.table_name).sort(),
    );
  });

  it('Kinder vor Eltern; Selbstbezüge werden vorher geleert', async () => {
    const fks = await rows<{ child: string; parent: string; column: string }>(`
      SELECT tc.table_name AS child, ccu.table_name AS parent, kcu.column_name AS column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);
    const index = new Map(TENANT_DELETE_ORDER.map((t, i) => [t.table, i]));
    const violations: string[] = [];
    for (const fk of fks) {
      const c = index.get(fk.child);
      const p = index.get(fk.parent);
      if (c === undefined || p === undefined) continue;
      if (fk.child === fk.parent) {
        if (!SELF_REFERENCES.some((s) => s.table === fk.child && s.column === fk.column))
          violations.push(`Selbstbezug ${fk.child}.${fk.column} fehlt`);
      } else if (c > p) violations.push(`${fk.child} → ${fk.parent}`);
    }
    expect(violations).toEqual([]);
  });

  it('Schlüssel = Primärschlüssel der Tabelle', async () => {
    const pks = await rows<{ table_name: string; column_name: string; ordinal_position: number }>(`
      SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.ordinal_position`);
    for (const { table, key } of TENANT_DELETE_ORDER) {
      expect([...key].sort(), table).toEqual(
        pks
          .filter((p) => p.table_name === table)
          .map((p) => p.column_name)
          .sort(),
      );
    }
  });
});
