/**
 * Auth im Frontend (TK 11.4): lädt `GET /api/auth/me` (Identität, Kontext, Mitgliedschaften, wirksame
 * Rolle, `mfaRequired`). Kein Token, kein Refresh (SV-01) – die Sitzung liegt serverseitig.
 */
import { can, type Action, type AuthContext, type ResourceMeta } from '@nina-pm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api, type Me } from '../api/client';
import { ApiError } from './api-fetch';

export const ME_QUERY_KEY = ['auth', 'me'] as const;

interface AuthValue {
  /** `undefined` = lädt, `null` = anonym. */
  me: Me | null | undefined;
  /** Kontext für `can()` – aus `/auth/me` abgeleitet; `null` = anonym. */
  context: AuthContext | null;
  /** 403 auth.identity_blocked beim Laden. */
  blocked: boolean;
  refresh(): Promise<void>;
}

const AuthCtx = createContext<AuthValue | null>(null);

/** `can()` braucht `AuthContext` (TK 5.3); die Sitzungs-ID kennt das Frontend nicht und braucht sie nicht. */
export function toAuthContext(me: Me): AuthContext {
  return {
    identityId: me.identity.id,
    sessionId: '',
    ctx: me.context,
    tenantId: me.tenant?.id ?? null,
    memberId: me.member?.id ?? null,
    role: me.member?.effectiveRole ?? null,
    isOwner: me.member?.role === 'owner',
    isSuperUser: me.isSuperUser,
    mfa: me.identity.mfa,
    mfaRequired: me.mfaRequired,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async (): Promise<{ me: Me | null; blocked: boolean }> => {
      try {
        return { me: await api.me(), blocked: false };
      } catch (error) {
        if (error instanceof ApiError && error.problem.status === 401)
          return { me: null, blocked: false };
        if (error instanceof ApiError && error.problem.code === 'auth.identity_blocked') {
          return { me: null, blocked: true };
        }
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const value = useMemo<AuthValue>(
    () => ({
      me: query.isPending ? undefined : (query.data?.me ?? null),
      context: query.data?.me ? toAuthContext(query.data.me) : null,
      blocked: query.data?.blocked ?? false,
      refresh: () => client.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    }),
    [query.isPending, query.data, client],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth außerhalb von AuthProvider');
  return ctx;
}

/** Nur zum Ein-/Ausblenden (TK 5.5); die API prüft immer selbst. */
export function useCan(action: Action, resource?: ResourceMeta): boolean {
  const { context } = useAuth();
  return can(context, action, resource);
}
