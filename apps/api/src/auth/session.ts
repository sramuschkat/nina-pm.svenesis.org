/**
 * Sitzungsprüfung je Anfrage (TK 5.3, SV-01): SHA-256 des Cookie-Werts → **eine** indizierte Abfrage,
 * kein Cache. Rollenwechsel, Deaktivierung, Sperre und Widerruf wirken ab der nächsten Anfrage.
 */
import { sessionAlive, type AuthRepository, type SessionRow } from '@nina-pm/db';
import type { AuthContext } from '@nina-pm/shared';
import { sha256Hex } from './crypto';

export interface SessionState {
  readonly auth: AuthContext | null;
  readonly row?: SessionRow;
  /** Anmeldung gültig, Zugang verweigert: gesperrte Identität bzw. gesperrter Mandant (DAT5-8). */
  readonly denial?: 'auth.identity_blocked' | 'tenant.locked';
}

export const ANONYMOUS: SessionState = { auth: null };

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

export type SessionStore = Pick<AuthRepository, 'resolveSession' | 'touch'>;

/** Leitet den `AuthContext` aus der Zeile ab (TK 5.3, 5.4; SV-03). */
export function toSessionState(row: SessionRow): SessionState {
  const base = {
    identityId: row.identityId,
    sessionId: row.sessionId,
    mfa: row.mfaEnabled,
    isSuperUser: row.superUserStatus === 'active',
  };
  const select: AuthContext = {
    ...base,
    ctx: 'select',
    tenantId: null,
    memberId: null,
    role: null,
    isOwner: false,
    mfaRequired: base.isSuperUser && !row.mfaEnabled,
    viewAsUser: false,
  };
  if (row.identityStatus === 'blocked') return { auth: null, row, denial: 'auth.identity_blocked' };

  if (row.context === 'system') {
    // System-Kontext nur für aktive Super User mit 2FA (FA-SU-02); sonst Auswahl.
    return {
      auth:
        base.isSuperUser && row.mfaEnabled
          ? { ...select, ctx: 'system', mfaRequired: false }
          : select,
      row,
    };
  }
  if (row.context === 'tenant' && row.tenantId) {
    if (row.tenantStatus === 'locked') return { auth: select, row, denial: 'tenant.locked' };
    if (
      row.memberId &&
      row.memberStatus === 'active' &&
      row.memberRole &&
      row.tenantStatus === 'active'
    ) {
      const admin = row.memberRole === 'admin';
      // Rollenansicht „Als User ansehen“ (30.09.2026): nur für Admins/Owner, nur Herabstufung – User-Rechte,
      // kein Owner, kein 2FA-Hinweis. Für gespeicherte User ist der Wert wirkungslos.
      const viewAsUser = admin && row.actingRole === 'user';
      return {
        auth: {
          ...base,
          ctx: 'tenant',
          tenantId: row.tenantId,
          memberId: row.memberId,
          // Ohne 2FA wirkt ein Admin oder Owner als User; die gespeicherte Rolle bleibt (SV-03).
          role: admin && row.mfaEnabled && !viewAsUser ? 'admin' : 'user',
          isOwner: row.ownerMemberId === row.memberId && !viewAsUser,
          mfaRequired: admin && !row.mfaEnabled && !viewAsUser,
          viewAsUser,
        },
        row,
      };
    }
    // Mitgliedschaft nicht mehr aktiv → Kontext `select` (TK 5.3).
  }
  return { auth: select, row };
}

export async function resolveSessionState(
  store: SessionStore,
  cookieValue: string | undefined,
  now: Date,
): Promise<SessionState> {
  if (!cookieValue || !SESSION_ID.test(cookieValue)) return ANONYMOUS;
  const row = await store.resolveSession(sha256Hex(cookieValue));
  if (!row || !sessionAlive(row, now)) return ANONYMOUS;
  await store.touch(row, now);
  return toSessionState(row);
}
