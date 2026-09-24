/**
 * Migrationen als Text im Lambda-Bundle (esbuild-Loader `.sql: text`, infra/lib/app-function.ts).
 * Neue Migration: Datei anlegen **und** hier eintragen; der Test `migrate.test.ts` prüft den Abgleich.
 */
import m0001 from '../../migrations/0001_system.sql';
import m0002 from '../../migrations/0002_mandant_benutzer.sql';
import m0003 from '../../migrations/0003_ausruestung.sql';
import m0004 from '../../migrations/0004_projekte_exoplaneten.sql';
import m0005 from '../../migrations/0005_ausfuehrung.sql';
import m0006 from '../../migrations/0006_speicherbedarf.sql';
import type { Migration } from './types';

export const bundledMigrations: readonly Migration[] = [
  { id: '0001_system', sql: m0001 },
  { id: '0002_mandant_benutzer', sql: m0002 },
  { id: '0003_ausruestung', sql: m0003 },
  { id: '0004_projekte_exoplaneten', sql: m0004 },
  { id: '0005_ausfuehrung', sql: m0005 },
  { id: '0006_speicherbedarf', sql: m0006 },
];
