/**
 * Kysely-Typen (CamelCasePlugin: Spalten in TS camelCase, in der DB snake_case, TK 3.2).
 * Stand AP-03: nur die Tabellen, die Beispiel-Repository und Tests brauchen. Die übrigen Tabellen
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

export interface Database {
  tenant: TenantTable;
  identity: IdentityTable;
  superUser: SuperUserTable;
  appUser: AppUserTable;
  schemaMigration: SchemaMigrationTable;
}
