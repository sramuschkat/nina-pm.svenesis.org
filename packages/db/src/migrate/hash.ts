import { createHash } from 'node:crypto';
import { MIGRATION_0000_VERSION } from './migration-0000';
import type { Migration } from './types';

/** Kennung des Migrationsstands: Grundlage für „test:dsql grün für genau diesen Stand“ im Deploy (TK 18). */
export function migrationsHash(migrations: readonly Migration[]): string {
  const h = createHash('sha256').update(`0000:${MIGRATION_0000_VERSION}\n`);
  for (const m of [...migrations].sort((a, b) => (a.id < b.id ? -1 : 1)))
    h.update(`${m.id}\n${m.sql}\n`);
  return h.digest('hex').slice(0, 16);
}
