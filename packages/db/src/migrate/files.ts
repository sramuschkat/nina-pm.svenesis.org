/** Migrationen aus dem Verzeichnis lesen (lokal, CI, test:dsql). Die Lambda nutzt bundled.ts. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Migration } from './types';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
export const MIGRATION_FILE = /^(\d{4}_[a-z0-9_]+)\.sql$/;

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .map((f) => MIGRATION_FILE.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ id: m[1] ?? '', sql: readFileSync(`${dir}${m[0]}`, 'utf8') }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}
