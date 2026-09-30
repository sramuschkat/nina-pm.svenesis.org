/**
 * Anmeldung und Sitzungen unter `/api/auth` (TK 5.2–5.4; FA-LOG-01…10, FA-SU-01…04).
 * Nicht-GET-Routen verlangen `X-NPM-Request: 1` (CSRF-Middleware, SV-04).
 */
import { timingSafeEqual } from 'node:crypto';
import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  COOKIE_NAMES,
  ContextRequest,
  INVITE_COOKIE_TTL_SECONDS,
  InvitationClaimRequest,
  InvitationClaimResponse,
  InvitationPreview,
  InvitationPreviewRequest,
  MeResponse,
  ViewAsRequest,
  OAUTH_COOKIE_TTL_SECONDS,
  ProblemError,
  safeNext,
  SessionList,
  TenantKey,
  Uuid,
  type AuthContext,
} from '@nina-pm/shared';
import type { Context } from 'hono';
import { authorizeUrl } from '../auth/discord';
import { establishSession } from '../auth/login';
import { buildMe } from '../auth/me';
import { pkceChallenge, randomToken, sha256Hex } from '../auth/crypto';
import { resolveSessionState } from '../auth/session';
import { clearCookie, readCookie, serializeCookie, signValue, verifyValue } from '../lib/cookies';
import type { ApiEnv } from '../lib/env';
import { isoUtc } from '../lib/format';
import { logger } from '../lib/logger';
import { defineRoute, problemContent, redirectResponse } from './define';
import type { ApiServices } from './services';

interface OAuthCookie {
  s: string;
  v: string;
  n: string;
  m?: string;
}

const LOGIN_FAILED = '/?anmeldung=fehler';
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const sameString = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function requireAuth(c: Context<ApiEnv>): AuthContext {
  const auth = c.get('auth');
  if (!auth) throw new ProblemError('auth.unauthenticated');
  return auth;
}

function noStore(c: Context<ApiEnv>) {
  c.header('cache-control', 'no-store');
}

const REQ = ['TK 5.2', 'FA-LOG-01', 'FA-LOG-05', 'SV-02'];

export const discordStartRoute = defineRoute(
  { action: 'public', requirements: REQ },
  {
    method: 'get',
    path: '/api/auth/discord/start',
    summary: 'Anmeldung mit Discord beginnen (state + PKCE S256 im signierten Cookie)',
    tags: ['auth'],
    request: {
      query: z.object({
        next: z.string().max(2048).optional(),
        mandant: z.string().max(64).optional(),
      }),
    },
    responses: { 302: redirectResponse('Weiterleitung zu Discord') },
  },
);

export const discordCallbackRoute = defineRoute(
  { action: 'public', requirements: [...REQ, 'FA-LOG-02', 'FA-LOG-07', 'FA-SU-01'] },
  {
    method: 'get',
    path: '/api/auth/discord/callback',
    summary: 'Rückkehr von Discord: state/PKCE prüfen, Identität, Einladung, Sitzung',
    tags: ['auth'],
    request: {
      query: z.object({
        code: z.string().max(512).optional(),
        state: z.string().max(512).optional(),
        error: z.string().max(256).optional(),
      }),
    },
    responses: {
      302: redirectResponse(
        'Weiterleitung zu `next`, `/mandant-waehlen`, `/kein-zugang` oder `/?anmeldung=fehler`',
      ),
    },
  },
);

export const invitationClaimRoute = defineRoute(
  { action: 'public', requirements: ['TK 5.2', 'FA-BEN-01', 'DAT5-15'] },
  {
    method: 'post',
    path: '/api/auth/invitation/claim',
    summary:
      'Einladungslink vormerken (Cookie __Host-npm_invite, 15 min); eingelöst wird im Callback',
    tags: ['auth'],
    request: {
      body: { content: { 'application/json': { schema: InvitationClaimRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Einladung gültig',
        content: { 'application/json': { schema: InvitationClaimResponse } },
      },
      404: problemContent('invitation.invalid'),
      410: problemContent('invitation.expired'),
    },
  },
);

export const invitationPreviewRoute = defineRoute(
  { action: 'public', requirements: ['TK 7.2', 'FA-BEN-01', 'DAT-20'] },
  {
    method: 'post',
    path: '/api/auth/invitations/preview',
    summary: 'Vorschau eines Einladungslinks (Token im Body, nicht im Pfad)',
    tags: ['auth'],
    request: {
      body: {
        content: { 'application/json': { schema: InvitationPreviewRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Vorschau',
        content: { 'application/json': { schema: InvitationPreview } },
      },
      404: problemContent('invitation.invalid'),
      410: problemContent('invitation.expired'),
    },
  },
);

export const contextRoute = defineRoute(
  { action: 'public', session: 'required', requirements: ['TK 5.2', 'FA-LOG-02', 'FA-SU-02'] },
  {
    method: 'post',
    path: '/api/auth/context',
    summary: 'Mandant bzw. System-Kontext wählen (dieselbe Sitzungszeile)',
    tags: ['auth'],
    request: {
      body: { content: { 'application/json': { schema: ContextRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Neuer Kontext',
        content: { 'application/json': { schema: MeResponse } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent(
        'auth.no_membership, auth.mfa_required, tenant.locked, permission.denied',
      ),
      404: problemContent('tenant.not_found'),
    },
  },
);

export const viewAsRoute = defineRoute(
  { action: 'public', session: 'required', requirements: ['security-auth.md', 'SV-03'] },
  {
    method: 'post',
    path: '/api/auth/view-as',
    summary:
      'Rollenansicht „Als User ansehen“ ein-/ausschalten (nur Admin/Owner, nur Herabstufung, je Sitzung)',
    tags: ['auth'],
    request: {
      body: { content: { 'application/json': { schema: ViewAsRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Kontext mit neuer wirksamer Rolle',
        content: { 'application/json': { schema: MeResponse } },
      },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('permission.denied'),
    },
  },
);

export const logoutRoute = defineRoute(
  { action: 'public', requirements: ['TK 5.3', 'FA-LOG-06'] },
  {
    method: 'post',
    path: '/api/auth/logout',
    summary: 'Abmelden: Sitzungszeile löschen, Cookie entfernen',
    tags: ['auth'],
    responses: { 204: { description: 'Abgemeldet' } },
  },
);

export const meRoute = defineRoute(
  { action: 'public', session: 'required', requirements: ['TK 5.3', 'FA-LOG-07', 'FA-LOG-10'] },
  {
    method: 'get',
    path: '/api/auth/me',
    summary: 'Angemeldete Person, Kontext, wirksame Rolle und mfaRequired',
    tags: ['auth'],
    responses: {
      200: { description: 'Ich', content: { 'application/json': { schema: MeResponse } } },
      401: problemContent('Nicht angemeldet'),
      403: problemContent('auth.identity_blocked'),
    },
  },
);

export const sessionsRoute = defineRoute(
  { action: 'public', session: 'required', requirements: ['TK 5.3', 'FA-LOG-08', 'SV-11'] },
  {
    method: 'get',
    path: '/api/auth/sessions',
    summary: 'Eigene Anmeldesitzungen',
    tags: ['auth'],
    responses: {
      200: { description: 'Sitzungen', content: { 'application/json': { schema: SessionList } } },
      401: problemContent('Nicht angemeldet'),
    },
  },
);

export const deleteSessionRoute = defineRoute(
  { action: 'public', session: 'required', requirements: ['TK 5.3', 'FA-LOG-08'] },
  {
    method: 'delete',
    path: '/api/auth/sessions/{id}',
    summary: 'Eigene Sitzung beenden (sofort wirksam)',
    tags: ['auth'],
    request: { params: z.object({ id: Uuid }) },
    responses: {
      204: { description: 'Beendet' },
      401: problemContent('Nicht angemeldet'),
      404: problemContent('resource.not_found'),
    },
  },
);

export const deleteAllSessionsRoute = defineRoute(
  { action: 'public', session: 'required', requirements: ['TK 5.3', 'FA-LOG-08'] },
  {
    method: 'delete',
    path: '/api/auth/sessions',
    summary: 'Überall abmelden (alle eigenen Sitzungen, sofort wirksam)',
    tags: ['auth'],
    responses: { 204: { description: 'Beendet' }, 401: problemContent('Nicht angemeldet') },
  },
);

export const AUTH_ROUTES = [
  discordStartRoute,
  discordCallbackRoute,
  invitationClaimRoute,
  invitationPreviewRoute,
  contextRoute,
  viewAsRoute,
  logoutRoute,
  meRoute,
  sessionsRoute,
  deleteSessionRoute,
  deleteAllSessionsRoute,
] as const;

export function authRoutes(services: () => Promise<ApiServices>) {
  const app = new OpenAPIHono<ApiEnv>();

  app.openapi(discordStartRoute, async (c) => {
    const svc = await services();
    const { next, mandant } = c.req.valid('query');
    const state = randomToken();
    const verifier = randomToken();
    const payload: OAuthCookie = {
      s: state,
      v: verifier,
      n: safeNext(next),
      ...(mandant && TenantKey.safeParse(mandant).success ? { m: mandant } : {}),
    };
    const now = svc.now();
    const cookie = signValue(
      await svc.authConfig.cookieSecret(),
      'oauth',
      payload,
      sec(now) + OAUTH_COOKIE_TTL_SECONDS,
    );
    c.header(
      'set-cookie',
      serializeCookie(COOKIE_NAMES.oauth, cookie, { maxAgeSeconds: OAUTH_COOKIE_TTL_SECONDS }),
    );
    noStore(c);
    return c.redirect(
      authorizeUrl({
        clientId: await svc.authConfig.discordClientId(),
        redirectUri: svc.authConfig.redirectUri,
        state,
        codeChallenge: pkceChallenge(verifier),
      }),
      302,
    );
  });

  app.openapi(discordCallbackRoute, async (c) => {
    const svc = await services();
    const now = svc.now();
    const query = c.req.valid('query');
    const secret = await svc.authConfig.cookieSecret();
    const cookies = c.req.header('cookie');
    noStore(c);
    c.header('set-cookie', clearCookie(COOKIE_NAMES.oauth), { append: true });
    const fail = (reason: string) => {
      logger.warn('oauth_failed', { reason });
      return c.redirect(LOGIN_FAILED, 302);
    };

    const oauth = verifyValue<OAuthCookie>(
      secret,
      'oauth',
      readCookie(cookies, COOKIE_NAMES.oauth),
      sec(now),
    );
    if (!oauth || typeof oauth.s !== 'string' || typeof oauth.v !== 'string') return fail('cookie');
    if (!query.state || !sameString(query.state, oauth.s)) return fail('state');
    if (query.error || !query.code) return fail('discord_denied');

    let profile;
    try {
      profile = await svc.discord.profile({
        code: query.code,
        codeVerifier: oauth.v,
        redirectUri: svc.authConfig.redirectUri,
        clientId: await svc.authConfig.discordClientId(),
        clientSecret: await svc.authConfig.discordClientSecret(),
      });
    } catch (error) {
      logger.warn('oauth_exchange_failed', {
        error: error instanceof Error ? error.message : 'unbekannt',
      });
      return fail('exchange');
    }

    const identity = await svc.auth.upsertIdentity(profile, now);
    if (identity.status === 'blocked') {
      c.header('set-cookie', clearCookie(COOKIE_NAMES.invite), { append: true });
      return c.redirect('/kein-zugang?grund=gesperrt', 302);
    }
    const invite = verifyValue<{ t?: unknown }>(
      secret,
      'invite',
      readCookie(cookies, COOKIE_NAMES.invite),
      sec(now),
    );
    const result = await establishSession(svc.auth, c, {
      identity,
      tenantKey: oauth.m,
      invitationToken: typeof invite?.t === 'string' ? invite.t : undefined,
      bootstrapIds: await svc.authConfig.bootstrapSuperUsers(),
      next: safeNext(oauth.n),
      now,
    });
    c.header('set-cookie', clearCookie(COOKIE_NAMES.invite), { append: true });
    c.header('set-cookie', result.setCookie, { append: true });
    logger.info('login', {
      identityId: identity.id,
      context: result.context,
      tenantId: result.tenantId ?? undefined,
      mfa: identity.mfaEnabled,
    });
    return c.redirect(result.location, 302);
  });

  app.openapi(invitationClaimRoute, async (c) => {
    const svc = await services();
    const { token } = c.req.valid('json');
    const now = svc.now();
    const invitation = await svc.auth.claimableInvitation(sha256Hex(token), now);
    const value = signValue(
      await svc.authConfig.cookieSecret(),
      'invite',
      { t: token },
      sec(now) + INVITE_COOKIE_TTL_SECONDS,
    );
    c.header(
      'set-cookie',
      serializeCookie(COOKIE_NAMES.invite, value, { maxAgeSeconds: INVITE_COOKIE_TTL_SECONDS }),
    );
    noStore(c);
    return c.json({ tenantName: invitation.tenantName, role: invitation.role }, 200);
  });

  app.openapi(invitationPreviewRoute, async (c) => {
    const svc = await services();
    const inv = await svc.auth.claimableInvitation(sha256Hex(c.req.valid('json').token), svc.now());
    noStore(c);
    return c.json(
      { tenantName: inv.tenantName, role: inv.role, expiresAt: isoUtc(inv.expiresAt) },
      200,
    );
  });

  app.openapi(contextRoute, async (c) => {
    const svc = await services();
    const auth = requireAuth(c);
    const body = c.req.valid('json');
    const repo = svc.auth;
    if ('system' in body) {
      if ((await repo.superUserStatus(auth.identityId)) !== 'active')
        throw new ProblemError('permission.denied');
      if (!auth.mfa) throw new ProblemError('auth.mfa_required');
      await repo.setContext(auth.sessionId, auth.identityId, 'system', null);
    } else {
      const tenant = await repo.tenantByKey(body.tenantKey);
      if (!tenant) throw new ProblemError('tenant.not_found');
      if (tenant.status === 'locked') throw new ProblemError('tenant.locked');
      const member = await repo.memberOf(auth.identityId, tenant.id);
      if (member?.status !== 'active') throw new ProblemError('auth.no_membership');
      await repo.setContext(auth.sessionId, auth.identityId, 'tenant', tenant.id);
      await repo.touchMemberLogin(member.id, svc.now());
    }
    const state = await resolveSessionState(
      repo,
      readCookie(c.req.header('cookie'), COOKIE_NAMES.session),
      svc.now(),
    );
    if (!state.auth) throw new ProblemError('auth.unauthenticated');
    noStore(c);
    return c.json(await buildMe(repo, state.auth), 200);
  });

  // Rollenansicht (30.09.2026): nur im Mandanten und nur mit gespeicherter Rolle Admin/Owner **mit 2FA** –
  // maßgeblich ist die gespeicherte Rolle, nicht die wirksame (die ist in der Ansicht schon `user`). Ohne 2FA
  // wirkt ein Admin ohnehin als User und verhält sich auch hier wie einer (SV-03). Nie mehr Rechte als
  // gespeichert: `session.ts` wertet `acting_role` nur als Herabstufung aus.
  app.openapi(viewAsRoute, async (c) => {
    const svc = await services();
    const auth = requireAuth(c);
    const { asUser } = c.req.valid('json');
    const repo = svc.auth;
    if (auth.ctx !== 'tenant' || !auth.tenantId) throw new ProblemError('permission.denied');
    const member = await repo.memberOf(auth.identityId, auth.tenantId);
    if (!auth.mfa || member?.status !== 'active' || member.role !== 'admin')
      throw new ProblemError('permission.denied');
    await repo.setActingRole(auth.sessionId, auth.identityId, asUser ? 'user' : null);
    const state = await resolveSessionState(
      repo,
      readCookie(c.req.header('cookie'), COOKIE_NAMES.session),
      svc.now(),
    );
    if (!state.auth) throw new ProblemError('auth.unauthenticated');
    noStore(c);
    return c.json(await buildMe(repo, state.auth), 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const sid = readCookie(c.req.header('cookie'), COOKIE_NAMES.session);
    if (sid && /^[A-Za-z0-9_-]{43}$/.test(sid))
      await (await services()).auth.deleteSessionByHash(sha256Hex(sid));
    c.header('set-cookie', clearCookie(COOKIE_NAMES.session));
    noStore(c);
    return c.body(null, 204);
  });

  app.openapi(meRoute, async (c) => {
    const svc = await services();
    noStore(c);
    return c.json(await buildMe(svc.auth, requireAuth(c)), 200);
  });

  app.openapi(sessionsRoute, async (c) => {
    const svc = await services();
    const auth = requireAuth(c);
    const iso = (d: Date | string) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rows = await svc.auth.listSessions(auth.identityId, svc.now());
    const identity = await svc.auth.identityById(auth.identityId);
    noStore(c);
    return c.json(
      {
        sessions: rows.map((r) => ({
          id: r.id,
          current: r.id === auth.sessionId,
          device: r.userAgent,
          ipTruncated: r.ipTruncated,
          createdAt: iso(r.createdAt),
          lastSeenAt: iso(r.lastSeenAt),
        })),
        lastLoginAt: identity?.lastLoginAt ? iso(identity.lastLoginAt) : null,
      },
      200,
    );
  });

  app.openapi(deleteSessionRoute, async (c) => {
    const svc = await services();
    const auth = requireAuth(c);
    const { id } = c.req.valid('param');
    if (!(await svc.auth.deleteSession(auth.identityId, id)))
      throw new ProblemError('resource.not_found');
    if (id === auth.sessionId) c.header('set-cookie', clearCookie(COOKIE_NAMES.session));
    return c.body(null, 204);
  });

  app.openapi(deleteAllSessionsRoute, async (c) => {
    const svc = await services();
    const auth = requireAuth(c);
    await svc.auth.deleteAllSessions(auth.identityId);
    c.header('set-cookie', clearCookie(COOKIE_NAMES.session));
    return c.body(null, 204);
  });

  return app;
}
