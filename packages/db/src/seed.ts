/**
 * Demo-Seed (docs/seed/seed-demo.json, TK 6.9). Stand AP-03: Mandanten, Identitäten, Super User und
 * Mitgliedschaften – das, was Anmeldung und Mandanten (AP-04a/b) brauchen. Ausrüstung, Rigs, Projekte,
 * NINA-Instanzen und Discord-Kanäle seeden die Pakete, die diese Tabellen fachlich validieren
 * (AP-09a, AP-11a, AP-14c, AP-60). Idempotent über ON CONFLICT.
 */
import type { SqlClient } from './migrate/types';

interface SeedIdentity {
  fixture: string;
  id: string;
  discordUserId: string;
  discordName: string;
  displayName: string;
  mfa: boolean;
  role?: 'admin' | 'user';
  isOwner?: boolean;
  superUser?: boolean;
  tenantKey?: string;
  roleExpiresInHours?: number;
}

export interface SeedDemo {
  tenant: { id: string; key: string; name: string; settings?: Record<string, unknown> };
  otherTenant: { id: string; key: string; name: string };
  identities: SeedIdentity[];
}

/** Stabile UUID für die Mitgliedschaft einer Identität in einem Mandanten (reproduzierbarer Seed). */
export function memberId(identityId: string, tenantId: string): string {
  return `${identityId.slice(0, 24)}${tenantId.slice(-12)}`;
}

export interface SeedResult {
  readonly tenants: number;
  readonly identities: number;
  readonly members: number;
  readonly superUsers: number;
  readonly notes: string[];
}

export async function seedCore(client: SqlClient, seed: SeedDemo): Promise<SeedResult> {
  const notes: string[] = [];
  const tenants = [
    {
      id: seed.tenant.id,
      key: seed.tenant.key,
      name: seed.tenant.name,
      settings: seed.tenant.settings ?? {},
    },
    {
      id: seed.otherTenant.id,
      key: seed.otherTenant.key,
      name: seed.otherTenant.name,
      settings: {},
    },
  ];
  for (const t of tenants) {
    await client.query(
      'INSERT INTO tenant (id, tenant_key, display_name, settings) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [t.id, t.key, t.name, JSON.stringify(t.settings)],
    );
  }
  const tenantByKey = new Map(tenants.map((t) => [t.key, t.id]));

  let members = 0;
  let superUsers = 0;
  for (const i of seed.identities) {
    await client.query(
      `INSERT INTO identity (id, discord_user_id, discord_username, discord_global_name, mfa_enabled)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [i.id, i.discordUserId, i.discordName, i.displayName, i.mfa],
    );
    if (i.superUser) {
      await client.query(
        'INSERT INTO super_user (identity_id) VALUES ($1) ON CONFLICT (identity_id) DO NOTHING',
        [i.id],
      );
      superUsers += 1;
      continue;
    }
    if (i.roleExpiresInHours !== undefined) {
      notes.push(`${i.fixture}: roleExpiresInHours ignoriert – befristete Admins entfallen (E2)`);
    }
    const tenantId = tenantByKey.get(i.tenantKey ?? seed.tenant.key);
    if (!tenantId) throw new Error(`Seed: Mandant ${i.tenantKey ?? '?'} für ${i.fixture} fehlt`);
    const id = memberId(i.id, tenantId);
    await client.query(
      `INSERT INTO app_user (id, tenant_id, identity_id, display_name, role)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, identity_id) DO NOTHING`,
      [id, tenantId, i.id, i.displayName, i.isOwner ? 'admin' : (i.role ?? 'user')],
    );
    members += 1;
    if (i.isOwner) {
      await client.query(
        'UPDATE tenant SET owner_member_id = $1 WHERE id = $2 AND owner_member_id IS NULL',
        [id, tenantId],
      );
    }
  }
  return {
    tenants: tenants.length,
    identities: seed.identities.length,
    members,
    superUsers,
    notes,
  };
}
