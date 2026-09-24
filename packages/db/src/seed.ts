/**
 * Demo-Seed (docs/seed/seed-demo.json, TK 6.9): Mandanten mit Built-in-Mondprofilen, Identitäten, Super
 * User und Mitgliedschaften. Die Ausrüstung spielt `seedEquipment` über das Repository ein (AP-09a,
 * seed-equipment.ts); Projekte, NINA-Instanzen und Discord-Kanäle seeden die Pakete, die diese Tabellen
 * fachlich validieren (AP-11a, AP-14c, AP-60). Idempotent über ON CONFLICT.
 */
import { createHash } from 'node:crypto';
import { BUILT_IN_MOON_PROFILES } from '@nina-pm/shared';
import type { SqlClient } from './migrate/types';
import type { SeedEquipment } from './seed-equipment';

export { seedEquipment, seedObjectId, type SeedEquipmentResult } from './seed-equipment';

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

export interface SeedDemo extends SeedEquipment {
  tenant: { id: string; key: string; name: string; settings?: Record<string, unknown> };
  otherTenant: { id: string; key: string; name: string };
  identities: SeedIdentity[];
}

/** Stabile UUID (Version 8, aus einem Hash) für die Mitgliedschaft einer Identität in einem Mandanten. */
export function memberId(identityId: string, tenantId: string): string {
  const h = createHash('sha256').update(`app_user:${tenantId}:${identityId}`).digest('hex');
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
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
    // Wie bei jeder Mandantenanlage (FA-MON-02): die mitgelieferten Mondprofile.
    for (const p of BUILT_IN_MOON_PROFILES) {
      await client.query(
        `INSERT INTO moon_profile (tenant_id, name, separation_deg, width_days, relax_scale,
           moon_min_alt_deg, moon_max_alt_deg, max_illumination_pct, moon_must_be_down, is_built_in)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) ON CONFLICT (tenant_id, name) DO NOTHING`,
        [
          t.id,
          p.name,
          p.separationDeg,
          p.widthDays,
          p.relaxScale,
          p.moonMinAltDeg,
          p.moonMaxAltDeg,
          p.maxIlluminationPct,
          p.moonMustBeDown,
        ],
      );
    }
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
