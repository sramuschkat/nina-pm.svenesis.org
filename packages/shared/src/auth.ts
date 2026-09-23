/** Ergebnis der Sitzungsprüfung je Anfrage (TK 5.3) – kein Token, kein Cache. */
import type { AuthContextKind } from './generated/enums';

export interface AuthContext {
  identityId: string;
  sessionId: string;
  ctx: AuthContextKind;
  tenantId: string | null;
  memberId: string | null;
  /** Wirksame Rolle: ohne 2FA 'user' (SV-03). */
  role: 'admin' | 'user' | null;
  isOwner: boolean;
  isSuperUser: boolean;
  mfa: boolean;
  mfaRequired: boolean;
}

/** Sitzungsdauer (TK 5.3): gleitend 14 Tage Inaktivität, höchstens 30 Tage ab Anmeldung. */
export const SESSION_IDLE_DAYS = 14;
export const SESSION_MAX_DAYS = 30;

/** CSRF (SV-04): Pflicht-Header auf jeder nicht-GET-Methode unter /api/auth, /api/web/v1, /api/system/v1. */
export const CSRF_HEADER = 'X-NPM-Request';
export const CSRF_HEADER_VALUE = '1';
