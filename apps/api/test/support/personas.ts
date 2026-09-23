/** Rollen für den Rechte-Testgenerator (TK 5.5): Route × Persona. */
import type { AuthContext } from '@nina-pm/shared';

export const TENANT_A = '0190c3f4-0000-7000-8000-00000000000a';
export const TENANT_B = '0190c3f4-0000-7000-8000-00000000000b';
export const MEMBER = {
  owner: '0190c3f4-0000-7000-8000-0000000000a1',
  admin: '0190c3f4-0000-7000-8000-0000000000a2',
  user: '0190c3f4-0000-7000-8000-0000000000a3',
  foreignAdmin: '0190c3f4-0000-7000-8000-0000000000b1',
} as const;

const base = (over: Partial<AuthContext>): AuthContext => ({
  identityId: 'identity',
  sessionId: 'session',
  ctx: 'tenant',
  tenantId: TENANT_A,
  memberId: MEMBER.user,
  role: 'user',
  isOwner: false,
  isSuperUser: false,
  mfa: true,
  mfaRequired: false,
  ...over,
});

export interface Persona {
  readonly name: string;
  readonly auth: AuthContext | null;
  /** Mandant ist ein anderer als der der Beispielobjekte. */
  readonly foreign?: boolean;
}

export const PERSONAS: readonly Persona[] = [
  { name: 'Owner', auth: base({ memberId: MEMBER.owner, role: 'admin', isOwner: true }) },
  { name: 'Admin', auth: base({ memberId: MEMBER.admin, role: 'admin' }) },
  // Ohne 2FA liefert die Sitzungsprüfung role 'user' (SV-03): muss sich wie User verhalten.
  { name: 'Admin ohne 2FA', auth: base({ memberId: MEMBER.admin, role: 'user', mfa: false }) },
  { name: 'User', auth: base({ memberId: MEMBER.user, role: 'user' }) },
  {
    name: 'fremder Mandant (Admin)',
    auth: base({ tenantId: TENANT_B, memberId: MEMBER.foreignAdmin, role: 'admin' }),
    foreign: true,
  },
  { name: 'anonym', auth: null },
  {
    name: 'Super User im System-Kontext',
    auth: base({ ctx: 'system', tenantId: null, memberId: null, role: null, isSuperUser: true }),
  },
];
