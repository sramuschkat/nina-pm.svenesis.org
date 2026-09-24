/**
 * Sitzung nach erfolgreicher Anmeldung (TK 5.2 Schritte 5–7) – gemeinsam für den Discord-Callback und
 * den Test-Login im lokalen Node-Adapter.
 */
import type { AuthRepository, Identity, Membership } from '@nina-pm/db';
import { COOKIE_NAMES, isProblemError, SESSION_MAX_DAYS, type ErrorCode } from '@nina-pm/shared';
import type { Context } from 'hono';
import type { ApiEnv } from '../lib/env';
import { logger } from '../lib/logger';
import { serializeCookie } from '../lib/cookies';
import { deviceLabel, randomToken, sha256Hex, truncateIp } from './crypto';

export interface LoginInput {
  readonly identity: Identity;
  /** Gewünschter Mandant aus `?mandant=` (FA-LOG-02). */
  readonly tenantKey?: string | undefined;
  /** Klartext-Token aus `__Host-npm_invite`. */
  readonly invitationToken?: string | undefined;
  /** Discord-User-IDs aus `/nina-pm/bootstrap-super-users`. */
  readonly bootstrapIds: readonly string[];
  readonly next: string;
  readonly now: Date;
}

export interface LoginResult {
  readonly location: string;
  readonly setCookie: string;
  readonly context: 'tenant' | 'select';
  readonly tenantId: string | null;
}

/** Viewer-IP hinter CloudFront: letzter Eintrag von X-Forwarded-For (CloudFront hängt die Viewer-IP an). */
export function viewerIp(c: Context<ApiEnv>): string | undefined {
  const xff = c.req.header('x-forwarded-for');
  const last = xff
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);
  if (last) return last;
  const event = (
    c.env as { event?: { requestContext?: { http?: { sourceIp?: string } } } } | undefined
  )?.event;
  return event?.requestContext?.http?.sourceIp;
}

function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, 'https://app.invalid');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function establishSession(
  repo: AuthRepository,
  c: Context<ApiEnv>,
  input: LoginInput,
): Promise<LoginResult> {
  const { identity, now } = input;

  // 5. Einladung einlösen – ein Fehler verhindert die Anmeldung nicht, er wird angezeigt.
  let invitedTenantId: string | undefined;
  let invitationError: ErrorCode | undefined;
  if (input.invitationToken) {
    try {
      invitedTenantId = (
        await repo.redeemInvitation(sha256Hex(input.invitationToken), identity, now)
      ).tenantId;
    } catch (error) {
      if (!isProblemError(error)) throw error;
      invitationError = error.code;
      logger.info('invitation_redeem_failed', { code: error.code, identityId: identity.id });
    }
  }

  // 6. Super-User-Bootstrap (TK 5.4): gelistete Discord-ID mit 2FA.
  if (input.bootstrapIds.includes(identity.discordUserId) && identity.mfaEnabled) {
    if (await repo.bootstrapSuperUser(identity.id, identity.discordUserId)) {
      logger.info('super_user_bootstrap', { identityId: identity.id });
    }
  }
  const memberships = await repo.memberships(identity.id);
  const isSuperUser = (await repo.superUserStatus(identity.id)) === 'active';
  const pick = (m: Membership) =>
    (invitedTenantId !== undefined && m.tenantId === invitedTenantId) ||
    (invitedTenantId === undefined &&
      input.tenantKey !== undefined &&
      m.tenantKey === input.tenantKey);
  const target = memberships.find(pick) ?? (memberships.length === 1 ? memberships[0] : undefined);

  // 7. Sitzung anlegen; vorher abgelaufene Zeilen aufräumen (höchstens 500).
  await repo.cleanupExpired(now);
  const sid = randomToken();
  const userAgent = c.req.header('user-agent');
  await repo.createSession({
    sessionHash: sha256Hex(sid),
    identityId: identity.id,
    tenantId: target?.tenantId ?? null,
    context: target ? 'tenant' : 'select',
    userAgent: deviceLabel(userAgent) ?? null,
    ipTruncated: truncateIp(viewerIp(c)),
    now,
  });
  if (target) await repo.touchMemberLogin(target.memberId, now);

  let location = target
    ? input.next
    : memberships.length === 0 && !isSuperUser
      ? '/kein-zugang'
      : withParam('/mandant-waehlen', 'next', input.next);
  if (invitationError) location = withParam(location, 'einladung', invitationError);
  return {
    location,
    setCookie: serializeCookie(COOKIE_NAMES.session, sid, {
      maxAgeSeconds: SESSION_MAX_DAYS * 86_400,
    }),
    context: target ? 'tenant' : 'select',
    tenantId: target?.tenantId ?? null,
  };
}
