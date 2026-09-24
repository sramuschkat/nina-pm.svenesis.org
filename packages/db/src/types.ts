/**
 * Kysely-Typen (CamelCasePlugin: Spalten in TS camelCase, in der DB snake_case, TK 3.2).
 * Stand AP-05: nur die Tabellen, die die bisherigen Repositories und Tests brauchen. Die übrigen Tabellen
 * kommen mit ihren fachlichen Repositories (ab AP-04a); Quelle sind die Migrationen.
 */
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface TenantTable {
  id: Generated<string>;
  tenantKey: string;
  displayName: string;
  contact: string | null;
  status: Generated<'active' | 'locked'>;
  settings: Generated<Record<string, unknown>>;
  ownerMemberId: string | null;
  discordGuildName: string | null;
  discordGuildId: string | null;
  discordInviteUrl: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface IdentityTable {
  id: Generated<string>;
  discordUserId: string;
  discordUsername: string;
  discordGlobalName: string | null;
  avatarHash: string | null;
  email: string | null;
  mfaEnabled: Generated<boolean>;
  status: Generated<'active' | 'blocked'>;
  lastLoginAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SuperUserTable {
  identityId: string;
  status: Generated<'active' | 'disabled'>;
  createdBy: string | null;
  createdAt: Timestamp;
}

export interface AppUserTable {
  id: Generated<string>;
  tenantId: string;
  identityId: string;
  displayName: string;
  role: 'admin' | 'user';
  status: Generated<'active' | 'disabled' | 'removed'>;
  invitedBy: string | null;
  lastLoginAt: Timestamp | null;
  allowedRigIds: unknown;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SchemaMigrationTable {
  id: string;
  checksum: string;
  appliedAt: Timestamp;
}

export interface AuthSessionTable {
  id: Generated<string>;
  sessionHash: string;
  identityId: string;
  tenantId: string | null;
  context: 'tenant' | 'system' | 'select';
  userAgent: string | null;
  ipTruncated: string | null;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  expiresAt: Timestamp;
}

export interface InvitationTable {
  id: Generated<string>;
  tenantId: string;
  tokenHash: string;
  role: 'owner' | 'admin' | 'user';
  discordUserId: string | null;
  note: string | null;
  maxUses: Generated<number>;
  usedCount: Generated<number>;
  expiresAt: Timestamp;
  createdByMember: string | null;
  createdBySuper: string | null;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface SystemAuditTable {
  id: Generated<string>;
  actor: 'super_user' | 'ops_cli';
  superUserId: string | null;
  tenantId: string | null;
  action: string;
  details: ColumnType<unknown, string | undefined, string>;
  createdAt: Timestamp;
}

export interface SystemSettingTable {
  key: string;
  value: ColumnType<unknown, string, string>;
  updatedBy: string | null;
  updatedAt: Timestamp;
}

export interface TenantStorageTable {
  tenantId: string;
  fileBytes: ColumnType<string, number | bigint | string, number | bigint | string>;
  fileCount: number;
  measuredAt: Timestamp;
}

export interface NotificationTable {
  id: Generated<string>;
  tenantId: string | null;
  recipientId: string | null;
  recipientIdentityId: string | null;
  kind: string;
  projectId: string | null;
  payload: ColumnType<unknown, string | undefined, string>;
  readAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface ChangeLogTable {
  id: Generated<string>;
  tenantId: string;
  entity: string;
  entityId: string;
  userId: string | null;
  action: string;
  diff: ColumnType<unknown, string | undefined, string>;
  createdAt: Timestamp;
}

export interface MoonProfileTable {
  id: Generated<string>;
  tenantId: string;
  name: string;
  description: Generated<string>;
  separationDeg: number;
  widthDays: number;
  relaxScale: number;
  moonMinAltDeg: number;
  moonMaxAltDeg: number;
  maxIlluminationPct: number;
  moonMustBeDown: Generated<boolean>;
  isBuiltIn: Generated<boolean>;
  createdAt: Timestamp;
}

export interface UserPreferenceTable {
  tenantId: string;
  userId: string;
  prefKey: string;
  value: ColumnType<unknown, string, string>;
  updatedAt: Timestamp;
}

export type JobStatusValue = 'pending' | 'running' | 'done' | 'failed';

/** Tabelle `job` (Migration 0005, TK 7.4). `input` ist jsonb und wird als JSON-Text geschrieben. */
export interface JobTable {
  id: Generated<string>;
  tenantId: string | null;
  kind: string;
  status: Generated<JobStatusValue>;
  dedupeKey: string | null;
  dedupeActive: string | null;
  input: ColumnType<unknown, string | undefined, string>;
  resultS3Key: string | null;
  error: string | null;
  attempts: Generated<number>;
  runAfter: Timestamp;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  createdBy: string | null;
  createdAt: Timestamp;
}

export interface Database {
  tenant: TenantTable;
  identity: IdentityTable;
  superUser: SuperUserTable;
  appUser: AppUserTable;
  schemaMigration: SchemaMigrationTable;
  job: JobTable;
  authSession: AuthSessionTable;
  invitation: InvitationTable;
  systemAudit: SystemAuditTable;
  systemSetting: SystemSettingTable;
  tenantStorage: TenantStorageTable;
  notification: NotificationTable;
  changeLog: ChangeLogTable;
  moonProfile: MoonProfileTable;
  userPreference: UserPreferenceTable;
}
