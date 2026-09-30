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
import m0007 from '../../migrations/0007_panel_aktiv.sql';
import m0008 from '../../migrations/0008_rig_sperre_worker.sql';
import m0009 from '../../migrations/0009_antragsrang_worker.sql';
import m0010 from '../../migrations/0010_exo_katalog.sql';
import m0011 from '../../migrations/0011_rollenansicht.sql';
import type { Migration } from './types';

export const bundledMigrations: readonly Migration[] = [
  { id: '0001_system', sql: m0001 },
  { id: '0002_mandant_benutzer', sql: m0002 },
  { id: '0003_ausruestung', sql: m0003 },
  { id: '0004_projekte_exoplaneten', sql: m0004 },
  { id: '0005_ausfuehrung', sql: m0005 },
  { id: '0006_speicherbedarf', sql: m0006 },
  { id: '0007_panel_aktiv', sql: m0007 },
  { id: '0008_rig_sperre_worker', sql: m0008 },
  { id: '0009_antragsrang_worker', sql: m0009 },
  { id: '0010_exo_katalog', sql: m0010 },
  { id: '0011_rollenansicht', sql: m0011 },
];
