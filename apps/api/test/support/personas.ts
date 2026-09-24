/**
 * Rollen für den Rechte-Testgenerator (TK 5.5): echte Identitäten, Mitgliedschaften und Sitzungen in
 * PGlite – der `AuthContext` entsteht über die echte Sitzungsprüfung.
 */
import type { Stack } from './stack';

export interface Persona {
  readonly name: string;
  /** Legt je Aufruf eine frische Sitzung an; `null` = anonym. */
  readonly session: () => Promise<string | null>;
  /** Mandant ist ein anderer als der der Beispielobjekte. */
  readonly foreign?: boolean;
}

export interface PersonaWorld {
  readonly tenantA: string;
  readonly tenantB: string;
  readonly members: Record<'owner' | 'admin' | 'adminNoMfa' | 'user' | 'user2', string>;
  readonly personas: readonly Persona[];
}

export async function seedPersonas(stack: Stack): Promise<PersonaWorld> {
  const { seed } = stack;
  const tenantA = await seed.tenant('tenant-a');
  const tenantB = await seed.tenant('tenant-b');
  const person = async (tenantId: string, role: 'admin' | 'user', mfa: boolean) => {
    const identity = await seed.identity({ mfaEnabled: mfa });
    const memberId = await seed.member(identity.id, tenantId, role);
    return { identity, memberId, tenantId };
  };
  const owner = await person(tenantA, 'admin', true);
  await seed.owner(tenantA, owner.memberId);
  const admin = await person(tenantA, 'admin', true);
  const adminNoMfa = await person(tenantA, 'admin', false);
  const user = await person(tenantA, 'user', false);
  const user2 = await person(tenantA, 'user', false);
  const foreign = await person(tenantB, 'admin', true);
  const superIdentity = await seed.identity({ mfaEnabled: true });
  await seed.superUser(superIdentity.id);

  const inTenant = (p: { identity: { id: string }; tenantId: string }) => () =>
    seed.session(p.identity.id, p.tenantId, 'tenant');
  return {
    tenantA,
    tenantB,
    members: {
      owner: owner.memberId,
      admin: admin.memberId,
      adminNoMfa: adminNoMfa.memberId,
      user: user.memberId,
      user2: user2.memberId,
    },
    personas: [
      { name: 'Owner', session: inTenant(owner) },
      { name: 'Admin', session: inTenant(admin) },
      { name: 'Admin ohne 2FA', session: inTenant(adminNoMfa) },
      { name: 'User', session: inTenant(user) },
      { name: 'User 2', session: inTenant(user2) },
      { name: 'fremder Mandant (Admin)', session: inTenant(foreign), foreign: true },
      { name: 'anonym', session: () => Promise.resolve(null) },
      {
        name: 'Super User im System-Kontext',
        session: () => seed.session(superIdentity.id, null, 'system'),
      },
    ],
  };
}
