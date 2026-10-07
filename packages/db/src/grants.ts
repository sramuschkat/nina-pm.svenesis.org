/**
 * Rechte je Tabelle und DB-Rolle, verbindlich nach TK 6.2 „Rechte je Gruppe“ (SEC-4, SV-14).
 * Quelle für die GRANTs in den Migrationen, für den DSQL-Lint und für die Rechte-Tests.
 * `app_rw` = Lambda api und ops-cli, `app_job` = Lambda worker.
 */
export type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
export type DbRole = 'app_rw' | 'app_job';

export interface TableGrant {
  readonly group: string;
  readonly app_rw: readonly Privilege[];
  readonly app_job: readonly Privilege[];
  /** UPDATE für `app_job` nur auf diese Spalten (Spaltenrecht, TK 6.2). */
  readonly app_job_update_columns?: readonly string[];
}

const ALL: readonly Privilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const S: readonly Privilege[] = ['SELECT'];
const SI: readonly Privilege[] = ['SELECT', 'INSERT'];
const SIU: readonly Privilege[] = ['SELECT', 'INSERT', 'UPDATE'];
const NONE: readonly Privilege[] = [];

const g = (
  group: string,
  app_rw: readonly Privilege[],
  app_job: readonly Privilege[],
  cols?: readonly string[],
): TableGrant => ({
  group,
  app_rw,
  app_job,
  ...(cols ? { app_job_update_columns: cols } : {}),
});

const SYSTEM = 'System (global)';
const MEMBER = 'Mandant, Anmeldung, Benutzer';
const EQUIP = 'Ausrüstung';
const PROJ = 'Projekte & Freigabe';
const EXO = 'Exoplaneten';
const EXEC = 'Ausführung & Auswertung';

export const TABLE_GRANTS: Readonly<Record<string, TableGrant>> = {
  // System (global): app_rw SELECT auf Kataloge/Wetter, sonst alles; app_job pflegt Kataloge, Jobs, Zustellung, Audit.
  identity: g(SYSTEM, ALL, S),
  super_user: g(SYSTEM, ALL, S),
  tenant: g(SYSTEM, ALL, S),
  system_audit: g(SYSTEM, ALL, ALL),
  system_setting: g(SYSTEM, ALL, S),
  // Speicherbedarf je Mandant (AP-07d): worker misst täglich, api liest und löscht mit dem Mandanten.
  tenant_storage: g(SYSTEM, ALL, SIU),
  dso_object: g(SYSTEM, S, ALL),
  exo_catalog_entry: g(SYSTEM, S, ALL),
  weather_cache: g(SYSTEM, S, ALL),
  job: g(SYSTEM, ALL, ALL),
  discord_delivery: g(SYSTEM, ALL, ALL),
  // Kanal: SELECT, INSERT (Import ohne URL), UPDATE nur der Zustellfelder (7.7).
  discord_channel: g(SYSTEM, ALL, SIU, [
    'enabled',
    'last_delivery_at',
    'last_error',
    'last_error_at',
  ]),

  // Mandant, Anmeldung, Benutzer: worker sieht weder Sitzungen noch Präferenzen/Favoriten.
  app_user: g(MEMBER, ALL, S),
  invitation: g(MEMBER, ALL, ['SELECT', 'DELETE']),
  auth_session: g(MEMBER, ALL, NONE),
  user_preference: g(MEMBER, ALL, NONE),
  identity_preference: g(MEMBER, ALL, NONE),
  favorite: g(MEMBER, ALL, NONE),
  notification: g(MEMBER, ALL, ['INSERT']),
  change_log: g(MEMBER, ALL, ['INSERT']),

  // Ausrüstung: worker liest alles, legt beim Import an (nie nina_instance), ändert nur rig_lease.
  site: g(EQUIP, ALL, SI),
  site_link: g(EQUIP, ALL, SI),
  telescope: g(EQUIP, ALL, SI),
  camera: g(EQUIP, ALL, SI),
  filter: g(EQUIP, ALL, SI),
  moon_profile: g(EQUIP, ALL, SI),
  exposure_template: g(EQUIP, ALL, SI),
  exposure_template_line: g(EQUIP, ALL, SI),
  // UPDATE nur auf `updated_at`: Wächter `FOR UPDATE` der Prognose (Migration 0008), keine Änderung an Rigs.
  rig: g(EQUIP, ALL, SIU, ['updated_at']),
  rig_lease: g(EQUIP, ALL, SIU),
  nina_instance: g(EQUIP, ALL, S),

  // Projekte & Freigabe: worker liest, importiert, ändert Status/Zähler an project und exposure_line
  // sowie den Rang offener Änderungsanträge.
  project: g(PROJ, ALL, SIU),
  project_panel: g(PROJ, ALL, SI),
  exposure_line: g(PROJ, ALL, SIU),
  project_note: g(PROJ, ALL, SI),
  // Reaktionen auf Kommentare (Migration 0012, FA-PRJ-17): wie project_note.
  project_note_reaction: g(PROJ, ALL, SI),
  approval_event: g(PROJ, ALL, SI),
  // UPDATE nur auf `submitter_rank`: Rangfolge beim Verfall einer Einreichung (Migration 0009), Anträge sonst unverändert.
  change_request: g(PROJ, ALL, SIU, ['submitter_rank']),
  queue_vote: g(PROJ, ALL, SI),

  // Exoplaneten.
  exo_project: g(EXO, ALL, SI),
  ephemeris: g(EXO, ALL, SIU),
  transit_observation: g(EXO, ALL, SIU),
  transit_result: g(EXO, ALL, SIU),

  // Ausführung & Auswertung: beide alles.
  night_plan: g(EXEC, ALL, ALL),
  session: g(EXEC, ALL, ALL),
  session_event: g(EXEC, ALL, ALL),
  capture: g(EXEC, ALL, ALL),
  capture_night: g(EXEC, ALL, ALL),
  correction: g(EXEC, ALL, ALL),
  flat_combination: g(EXEC, ALL, ALL),
  session_log: g(EXEC, ALL, ALL),
  site_night_stat: g(EXEC, ALL, ALL),
  // Vorhersage je Standort und Nacht (Migration 0014, AP-64b): worker schreibt, api liest und löscht mit Standort/Mandant.
  site_night_forecast: g(EXEC, ALL, ALL),
  command: g(EXEC, ALL, ALL),
};

export const DB_ROLES: readonly DbRole[] = ['app_rw', 'app_job'];

/** GRANT-Sätze einer Tabelle, je Rolle getrennt (Vorlage am Ende von schema_aurora_dsql.sql). */
export function grantStatements(table: string): string[] {
  const grant = TABLE_GRANTS[table];
  if (!grant) throw new Error(`Tabelle ${table} hat keine Zuordnung in TABLE_GRANTS (TK 6.2)`);
  const out: string[] = [];
  for (const role of DB_ROLES) {
    const cols = role === 'app_job' ? grant.app_job_update_columns : undefined;
    const privs = grant[role].filter((p) => !(cols && p === 'UPDATE'));
    if (privs.length > 0) out.push(`GRANT ${privs.join(', ')} ON ${table} TO ${role};`);
    if (cols) out.push(`GRANT UPDATE (${cols.join(', ')}) ON ${table} TO ${role};`);
    if (grant[role].length === 0) out.push(`-- kein GRANT auf ${table} an ${role} (TK 6.2)`);
  }
  return out;
}
