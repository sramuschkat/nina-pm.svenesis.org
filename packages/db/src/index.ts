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
  changedWheelPositions,
  DEFAULT_OVERHEAD,
  EquipmentRepository,
  type CameraRow,
  type FilterRow,
  type FilterWheelEntry,
  type MoonProfileRow,
  type ReportedWheel,
  type RigRow,
  type SiteLinkRow,
  type SiteRow,
  type TelescopeRow,
  type TemplateLineRow,
  type TemplateRow,
} from './repositories/equipment';
export {
  ApprovalRepository,
  expireSubmissions,
  type QueueEntry,
  type VoteSummary,
} from './repositories/approval';
export {
  ProjectRepository,
  type LineDetail,
  type NoteRecord,
  type ProjectDetail,
  type ProjectMeta,
  type RigConflict,
} from './repositories/project';
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
  observeTxRetries,
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
export {
  EFFORT_MAX_AGE_DAYS,
  EFFORT_SITE_BATCH,
  EffortRepository,
  effortSites,
  siteNightRunDone,
  type EffortRow,
  type EffortSaveOutcome,
  type EffortSite,
} from './repositories/effort';
export { SimulationRepository, type SimulationSave } from './repositories/simulation';
export {
  NINA_CALL_LOG_SIZE,
  NINA_SEEN_INTERVAL_MS,
  NinaInstanceRepository,
  NinaRigRepository,
  ninaRecordCall,
  ninaTokenLookup,
  ninaTouch,
  parseCallLog,
  type NinaCallLog,
  type NinaCallRecord,
  type NinaInstanceOverview,
  type NinaInstanceRow,
  type NinaPrincipal,
} from './repositories/nina';
export {
  CLOSE_AFTER_END_MS,
  STALE_AFTER_SESSION_END_MS,
  STALE_NO_HEARTBEAT_MS,
  activeAdminIds,
  alertSentSince,
  markStaleSessions,
  reconcileSite,
  sessionsDueForClose,
  type ReconcileResult,
  type SessionToClose,
  type StaleSession,
} from './repositories/session-ops';
export {
  SessionReviewRepository,
  type NightSessionFilter,
  type NightSessionRow,
} from './repositories/session-review';
export {
  SessionLogRepository,
  saveForecastSnapshot,
  sessionLogVersion,
  upsertSiteNightStatForSession,
  type ClearNightRawSession,
  type SessionLogContext,
} from './repositories/session-log';
export {
  LATE_REPORT_MS,
  LEASE_MS,
  NinaSessionRepository,
  OFFLINE_MAX_MS,
  closeSessionFlats,
  releaseRigLease,
  setReportStatus,
  type LeaseView,
  type OfflinePlanInput,
  type SessionRow as NinaSessionRow,
} from './repositories/nina-session';
export {
  applyCorrection,
  assignCapture,
  rejectCapture,
  NinaIngestRepository,
  tenthDegrees,
  type CaptureInput,
  type EventInput,
  type IngestStatus,
} from './repositories/nina-ingest';
export {
  DSO_BATCH_SIZE,
  dsoCatalogStatus,
  enqueueSystemJob,
  readDsoCatalog,
  upsertDsoCatalog,
  type DsoCatalogRow,
  type DsoCatalogStatus,
} from './repositories/dso';
export {
  EXO_BATCH_SIZE,
  EXO_CATALOGS,
  exoCatalogCount,
  exoCatalogDedupeKey,
  exoCatalogStatus,
  exoPrefilterSetting,
  myExoProjectCounts,
  readExoCatalog,
  replaceExoCatalog,
  type ExoCatalog,
  type ExoCatalogRow,
  type ExoCatalogStatus,
  type ExoReplaceResult,
} from './repositories/exo-catalog';
export {
  latestWeather,
  saveWeather,
  weatherCoord,
  weatherSites,
  type WeatherCacheEntry,
  type WeatherSite,
} from './repositories/weather';
export {
  projectsWithoutThumbnail,
  setProjectThumbnail,
  thumbnailKeyInUse,
  type ThumbnailCandidate,
} from './repositories/thumbnail';
export {
  settleTransits,
  TransitRepository,
  transitLine,
  type LockInput,
  type ObservationInsert,
  type ObservationRow,
  type PendingConfirmation,
  type SettleResult,
} from './repositories/transit';
export {
  ExoProjectRepository,
  type EphemerisRow,
  type ExoProjectOther,
  type ExoProjectRow,
} from './repositories/exo-project';
export { type EphemerisInsert, type ExoProjectInsert } from './repositories/project';
export {
  ChangeRequestRepository,
  type ChangeRequestRecord,
  type ChangeRequestRow,
} from './repositories/change-request';
export {
  clearNightCounts,
  forecastNights,
  replaceForecast,
  type ForecastNightRow,
} from './repositories/forecast';
export { projectReportRows, type ReportRows } from './repositories/report';
export { evaluationCounts, type EvaluationCounts } from './repositories/setup-export';
export {
  DEMO_BATCH,
  DEMO_CLEAR_ORDER,
  DemoEvaluationRepository,
  type DemoClearProgress,
} from './repositories/demo-evaluation';
