// @nina-pm/db – Datenbankzugriff (TK 6). Verbindung nur über repositories/database.ts.
export {
  DB_ROLES,
  TABLE_GRANTS,
  grantStatements,
  type DbRole,
  type Privilege,
  type TableGrant,
} from './grants';
export { TenantRepo, type TenantContext } from './repositories/base';
export {
  openDatabase,
  type AppDbRole,
  type DbConfig,
  type OpenDatabase,
} from './repositories/database';
export {
  JobQueue,
  JobRepository,
  parseJobError,
  type EnqueueInput,
  type EnqueueResult,
  type Job,
  type JobError,
  type StaleJob,
} from './repositories/job';
export { TenantRepository, type Tenant } from './repositories/tenant';
export {
  isOccConflict,
  orderGuards,
  RowCounterPlugin,
  RowLimitExceededError,
  TX_ROW_LIMIT,
  withTx,
  type GuardRow,
  type WithTxOptions,
} from './tx';
export type { Database, JobTable } from './types';
