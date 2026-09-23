import type { TenantContext } from '@nina-pm/db';
import { ProblemError, type AuthContext } from '@nina-pm/shared';
import type { Context } from 'hono';
import type { ApiEnv } from '../lib/env';

/** Mandantenkontext **aus der Sitzung**, nie aus der Anfrage (TK 6.7). */
export function requireTenant(c: Context<ApiEnv>): { auth: AuthContext; tenant: TenantContext } {
  const auth = c.get('auth');
  if (!auth) throw new ProblemError('auth.unauthenticated');
  if (auth.ctx !== 'tenant' || !auth.tenantId || !auth.memberId || !auth.role) {
    throw new ProblemError('permission.denied');
  }
  return {
    auth,
    tenant: {
      tenantId: auth.tenantId,
      memberId: auth.memberId,
      role: auth.isOwner ? 'owner' : auth.role,
    },
  };
}
