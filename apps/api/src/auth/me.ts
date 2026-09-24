import type { AuthRepository } from '@nina-pm/db';
import { ProblemError, type AuthContext, type MeResponse } from '@nina-pm/shared';

/** `GET /auth/me` (FA-LOG-10): Identität, Kontext, Mitgliedschaft mit wirksamer Rolle, Auswahl. */
export async function buildMe(repo: AuthRepository, auth: AuthContext): Promise<MeResponse> {
  const identity = await repo.identityById(auth.identityId);
  if (!identity) throw new ProblemError('auth.unauthenticated');
  const memberships = await repo.memberships(auth.identityId);
  const current = auth.tenantId ? memberships.find((m) => m.tenantId === auth.tenantId) : undefined;
  return {
    identity: {
      id: identity.id,
      discordUserId: identity.discordUserId,
      username: identity.discordUsername,
      globalName: identity.discordGlobalName,
      avatarHash: identity.avatarHash,
      mfa: identity.mfaEnabled,
    },
    context: auth.ctx,
    tenant: current
      ? {
          id: current.tenantId,
          key: current.tenantKey,
          name: current.tenantName,
          timeZone: await repo.tenantTimeZone(current.tenantId),
        }
      : null,
    member:
      current && auth.role
        ? {
            id: current.memberId,
            displayName: current.displayName,
            role: current.isOwner ? 'owner' : current.role,
            effectiveRole: auth.role,
          }
        : null,
    isSuperUser: auth.isSuperUser,
    mfaRequired: auth.mfaRequired,
    memberships: memberships.map((m) => ({
      tenantKey: m.tenantKey,
      tenantName: m.tenantName,
      role: m.isOwner ? 'owner' : m.role,
    })),
  };
}
