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
  AuthRepository,
  sessionAlive,
  type AuthSession,
  type ClaimableInvitation,
  type DiscordProfile,
  type Identity,
  type Membership,
  type NewSession,
  type SessionRow,
} from './repositories/auth';
export {
  insertInvitation,
  type CreatedInvitation,
  type NewInvitation,
} from './repositories/invitations';
export { PreferenceRepository } from './repositories/preference';
export {
  encodeCursor,
  insertNotifications,
  NotificationRepository,
  type NewNotifications,
  type NotificationRow,
} from './repositories/notification';
export {
  MemberRepository,
  type Member,
  type MemberWithIdentity,
  type TargetCheck,
} from './repositories/member';
export {
  deleteExpiredInvitations,
  TenantAdminRepository,
  type SystemActor,
} from './repositories/tenant-admin';
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
export {
  AuditRepository,
  listSystemAudit,
  readMaintenanceBanner,
  type AuditPage,
  type SystemAuditRow,
} from './repositories/audit';
export {
  deleteTenantData,
  TENANT_DELETE_BATCH,
  TENANT_DELETE_ORDER,
} from './repositories/tenant-delete';
export { recordTenantStorage, tenantIdsForStorage } from './repositories/tenant-storage';
