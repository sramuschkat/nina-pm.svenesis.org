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
}
