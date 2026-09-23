// @nina-pm/db/migrate – Migrationen (TK 6.8). Ohne Verbindung: der Aufrufer liefert den Client.
export { connectDsql, type DsqlClient } from './dsql-client';
export { loadMigrations, MIGRATIONS_DIR } from './files';
export { migrationsHash } from './hash';
export {
  APP_ROLES,
  migration0000,
  MIGRATION_0000_VERSION,
  prodIamGrants,
  type AppRole,
  type IamGrant,
} from './migration-0000';
export { checksum, forMode, runMigrations, SCHEMA_MIGRATION_DDL, type RunResult } from './runner';
export { splitStatements, STATEMENT_MARKER } from './statements';
export type { Migration, MigrationLog, MigrationMode, SqlClient } from './types';
