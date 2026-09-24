/**
 * Anmeldung und Sitzungen (AP-04a; TK 5.2–5.4, FA-LOG-01…10, FA-SU-01…04) – Integrationstests in Node
 * ohne Browser, mit echtem SQL auf PGlite und einer Discord-Nachbildung, die PKCE prüft.
 */
import { COOKIE_NAMES, SESSION_IDLE_DAYS, SESSION_MAX_DAYS } from '@nina-pm/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/auth/crypto';
import { signValue } from '../src/lib/cookies';
import { discordProfile } from './support/fake-discord';
import { COOKIE_SECRET, createStack, setCookies, type Stack } from './support/stack';

const DAY = 86_400_000;
let s: Stack;
beforeEach(async () => {
  s = await createStack();
});
afterEach(() => s.close());

const sidCookie = (sid: string | undefined) => ({ [COOKIE_NAMES.session]: sid ?? '' });
const me = (sid: string | undefined) => s.request('/api/auth/me', { cookies: sidCookie(sid) });

async function tenantWithMember(role: 'admin' | 'user', mfa = true, key = 'sternwarte') {
  const tenantId = await s.seed.tenant(key);
  const profile = discordProfile({ mfaEnabled: mfa });
  const identity = await s.seed.identity({ discordUserId: profile.discordUserId, mfaEnabled: mfa });
  const memberId = await s.seed.member(identity.id, tenantId, role);
  return { tenantId, profile, identity, memberId };
}

describe('Discord-Anmeldung (TK 5.2)', () => {
  it('start: 302 zu Discord mit state, PKCE S256, Scope identify und signiertem __Host-npm_oauth', async () => {
    const res = await s.request('/api/auth/discord/start?next=/projekte');
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location') ?? '');
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: '1552568154146742332',
      scope: 'identify',
      code_challenge_method: 'S256',
      redirect_uri: 'https://nina-pm.svenesis.org/api/auth/discord/callback',
    });
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const raw = setCookies(res)[COOKIE_NAMES.oauth]?.raw ?? '';
    expect(raw).toMatch(
      /^__Host-npm_oauth=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/,
    );
    // Der Verifier steht nur signiert im Cookie, nie in der URL.
    expect(res.headers.get('location')).not.toContain(raw.split('=')[1]?.split('.')[0] ?? 'x');
  });

  it('callback: Identität anlegen, Sitzung setzen, Weiterleitung zu next; genau ein Mandant → tenant', async () => {
    const { profile, tenantId } = await tenantWithMember('user');
    const { callback, location, sid } = await s.login(
      { ...profile, username: 'neu', mfaEnabled: false },
      { next: '/projekte?x=1' },
    );
    expect(callback.status).toBe(302);
    expect(location).toBe('/projekte?x=1');
    const cookies = setCookies(callback);
    expect(cookies[COOKIE_NAMES.session]?.raw).toMatch(
      new RegExp(
        `^__Host-npm_sid=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_DAYS * 86400}$`,
      ),
    );
    expect(cookies[COOKIE_NAMES.oauth]?.raw).toContain('Max-Age=0');
    const body = (await (await me(sid)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      context: 'tenant',
      tenant: { id: tenantId, key: 'sternwarte' },
      identity: { username: 'neu', mfa: false },
    });
    const row = await s.pg.admin.query(
      'SELECT last_login_at, mfa_enabled FROM identity WHERE discord_user_id = $1',
      [profile.discordUserId],
    );
    expect(row.rows[0]).toMatchObject({ mfa_enabled: false });
    expect(row.rows[0]?.last_login_at).not.toBeNull();
  });

  it('in der Datenbank steht nur session_hash, nie der Cookie-Wert', async () => {
    await tenantWithMember('user');
    const { sid } = await s.login(discordProfile());
    const rows = await s.pg.admin.query('SELECT * FROM auth_session');
    expect(JSON.stringify(rows.rows)).not.toContain(sid ?? 'x');
    expect(rows.rows.some((r) => r.session_hash === sha256Hex(sid ?? ''))).toBe(true);
  });

  it('ohne Mitgliedschaft → Kontext select, /kein-zugang; mehrere → /mandant-waehlen; ?mandant wählt vor', async () => {
    expect((await s.login(discordProfile(), { next: '/x' })).location).toBe('/kein-zugang');
    const a = await s.seed.tenant('alpha');
    const b = await s.seed.tenant('beta');
    const p = discordProfile();
    const id = await s.seed.identity({ discordUserId: p.discordUserId });
    await s.seed.member(id.id, a, 'user');
    await s.seed.member(id.id, b, 'user');
    expect((await s.login(p, { next: '/x' })).location).toBe('/mandant-waehlen?next=%2Fx');
    const chosen = await s.login(p, { next: '/x', mandant: 'beta' });
    expect(chosen.location).toBe('/x');
    expect(await (await me(chosen.sid)).json()).toMatchObject({ tenant: { key: 'beta' } });
  });

  it.each([
    ['https://evil.example/x', '/'],
    ['//evil.example/x', '/'],
    ['/\\evil.example/x', '/'],
    ['javascript:alert(1)', '/'],
    ['/projekte/1', '/projekte/1'],
  ])('next %s → %s (Muster ^/(?![/\\\\]))', async (next, expected) => {
    await tenantWithMember('user')
      .then(({ profile }) => s.login(profile, { next }))
      .then(({ location }) => {
        expect(location).toBe(expected);
      });
  });

  describe('Abbruch bei Manipulation (kein Sitzungs-Cookie, Weiterleitung /?anmeldung=fehler)', () => {
    const noSession = (res: Response) => {
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/?anmeldung=fehler');
      expect(setCookies(res)[COOKIE_NAMES.session]).toBeUndefined();
    };

    it('falscher state', async () => {
      const start = await s.request('/api/auth/discord/start');
      const oauth = setCookies(start)[COOKIE_NAMES.oauth]?.value ?? '';
      const { code } = s.discord.authorize(start.headers.get('location') ?? '', discordProfile());
      noSession(
        await s.request(`/api/auth/discord/callback?code=${code}&state=${'x'.repeat(43)}`, {
          cookies: { [COOKIE_NAMES.oauth]: oauth },
        }),
      );
    });

    it('fehlendes Cookie bzw. manipuliertes Cookie', async () => {
      const start = await s.request('/api/auth/discord/start');
      const oauth = setCookies(start)[COOKIE_NAMES.oauth]?.value ?? '';
      const { code, state } = s.discord.authorize(
        start.headers.get('location') ?? '',
        discordProfile(),
      );
      noSession(await s.request(`/api/auth/discord/callback?code=${code}&state=${state}`));
      const [body, mac] = oauth.split('.');
      const tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body ?? '', 'base64url').toString()), n: '/admin' })).toString('base64url')}.${mac}`;
      noSession(
        await s.request(`/api/auth/discord/callback?code=${code}&state=${state}`, {
          cookies: { [COOKIE_NAMES.oauth]: tampered },
        }),
      );
    });

    it('falscher code_verifier: Code aus einer anderen Anmeldung', async () => {
      const a = await s.request('/api/auth/discord/start');
      const b = await s.request('/api/auth/discord/start');
      const codeA = s.discord.authorize(a.headers.get('location') ?? '', discordProfile()).code;
      const stateB = new URL(b.headers.get('location') ?? '').searchParams.get('state');
      const oauthB = setCookies(b)[COOKIE_NAMES.oauth]?.value ?? '';
      noSession(
        await s.request(`/api/auth/discord/callback?code=${codeA}&state=${stateB}`, {
          cookies: { [COOKIE_NAMES.oauth]: oauthB },
        }),
      );
      expect(s.discord.exchanges.at(-1)?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('fehlender code_verifier (gültig signiertes Cookie ohne Verifier)', async () => {
      const start = await s.request('/api/auth/discord/start');
      const { code, state } = s.discord.authorize(
        start.headers.get('location') ?? '',
        discordProfile(),
      );
      const noVerifier = signValue(
        COOKIE_SECRET,
        'oauth',
        { s: state, n: '/' },
        Math.floor(s.clock.now().getTime() / 1000) + 600,
      );
      noSession(
        await s.request(`/api/auth/discord/callback?code=${code}&state=${state}`, {
          cookies: { [COOKIE_NAMES.oauth]: noVerifier },
        }),
      );
    });

    it('abgelaufenes oauth-Cookie (10 min) und Abbruch bei Discord (?error)', async () => {
      const start = await s.request('/api/auth/discord/start');
      const oauth = setCookies(start)[COOKIE_NAMES.oauth]?.value ?? '';
      const { code, state } = s.discord.authorize(
        start.headers.get('location') ?? '',
        discordProfile(),
      );
      s.clock.advance(601_000);
      noSession(
        await s.request(`/api/auth/discord/callback?code=${code}&state=${state}`, {
          cookies: { [COOKIE_NAMES.oauth]: oauth },
        }),
      );
      s.clock.advance(-601_000);
      noSession(
        await s.request(`/api/auth/discord/callback?error=access_denied&state=${state}`, {
          cookies: { [COOKIE_NAMES.oauth]: oauth },
        }),
      );
    });
  });
});

describe('Sitzung (TK 5.3, SV-01)', () => {
  it('Logout wirkt ab der nächsten Anfrage', async () => {
    const { profile } = await tenantWithMember('user');
    const { sid } = await s.login(profile);
    expect((await me(sid)).status).toBe(200);
    const out = await s.request('/api/auth/logout', { method: 'POST', cookies: sidCookie(sid) });
    expect(out.status).toBe(204);
    expect(setCookies(out)[COOKIE_NAMES.session]?.raw).toContain('Max-Age=0');
    expect(await (await me(sid)).json()).toMatchObject({
      status: 401,
      code: 'auth.unauthenticated',
    });
  });

  it('DELETE /auth/sessions/{id} beendet eine andere eigene Sitzung sofort; fremde bleiben unberührt', async () => {
    const { profile } = await tenantWithMember('user');
    const first = await s.login(profile);
    const second = await s.login(profile);
    const list = (await (
      await s.request('/api/auth/sessions', { cookies: sidCookie(second.sid) })
    ).json()) as {
      sessions: { id: string; current: boolean }[];
    };
    expect(list.sessions).toHaveLength(2);
    const other = list.sessions.find((x) => !x.current);
    const foreign = await s.login(discordProfile());
    const foreignList = (await (
      await s.request('/api/auth/sessions', { cookies: sidCookie(foreign.sid) })
    ).json()) as {
      sessions: { id: string }[];
    };
    expect(
      (
        await s.request(`/api/auth/sessions/${foreignList.sessions[0]?.id}`, {
          method: 'DELETE',
          cookies: sidCookie(second.sid),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await s.request(`/api/auth/sessions/${other?.id}`, {
          method: 'DELETE',
          cookies: sidCookie(second.sid),
        })
      ).status,
    ).toBe(204);
    expect((await me(first.sid)).status).toBe(401);
    expect((await me(second.sid)).status).toBe(200);
    expect((await me(foreign.sid)).status).toBe(200);
    expect(
      (await s.request('/api/auth/sessions', { method: 'DELETE', cookies: sidCookie(second.sid) }))
        .status,
    ).toBe(204);
    expect((await me(second.sid)).status).toBe(401);
  });

  it('Rollenwechsel und Deaktivierung wirken ab der nächsten Anfrage (kein Cache)', async () => {
    const { profile, memberId } = await tenantWithMember('admin', true);
    const { sid } = await s.login(profile);
    expect(await (await me(sid)).json()).toMatchObject({
      member: { role: 'admin', effectiveRole: 'admin' },
    });
    await s.pg.admin.query("UPDATE app_user SET role = 'user' WHERE id = $1", [memberId]);
    expect(await (await me(sid)).json()).toMatchObject({
      member: { role: 'user', effectiveRole: 'user' },
    });
    await s.pg.admin.query("UPDATE app_user SET status = 'disabled' WHERE id = $1", [memberId]);
    expect(await (await me(sid)).json()).toMatchObject({ context: 'select', member: null });
  });

  it('Ablauf: 14 Tage ohne Anfrage → 401; mit Anfragen höchstens 30 Tage', async () => {
    const { profile } = await tenantWithMember('user');
    const { sid } = await s.login(profile);
    s.clock.advance(SESSION_IDLE_DAYS * DAY - 60_000);
    expect((await me(sid)).status).toBe(200);
    s.clock.advance(SESSION_IDLE_DAYS * DAY - 60_000);
    expect((await me(sid)).status).toBe(200);
    s.clock.advance(SESSION_IDLE_DAYS * DAY);
    expect(await (await me(sid)).json()).toMatchObject({ code: 'auth.unauthenticated' });

    const again = await s.login(profile);
    for (let day = 0; day < SESSION_MAX_DAYS - 1; day += 7) {
      s.clock.advance(7 * DAY);
      if (day + 7 < SESSION_MAX_DAYS)
        expect((await me(again.sid)).status, `Tag ${day + 7}`).toBe(200);
    }
    s.clock.advance(3 * DAY);
    expect((await me(again.sid)).status).toBe(401);
  });

  it('last_seen_at wird innerhalb von 5 min nur einmal geschrieben', async () => {
    const { profile } = await tenantWithMember('user');
    const { sid } = await s.login(profile);
    const lastSeen = async () =>
      (
        await s.pg.admin.query('SELECT last_seen_at FROM auth_session WHERE session_hash = $1', [
          sha256Hex(sid ?? ''),
        ])
      ).rows[0]?.last_seen_at as Date;
    const created = await lastSeen();
    s.clock.advance(60_000);
    await me(sid);
    s.clock.advance(3 * 60_000);
    await me(sid);
    expect(await lastSeen()).toEqual(created);
    s.clock.advance(2 * 60_000);
    await me(sid);
    const touched = await lastSeen();
    expect(touched.getTime()).toBe(s.clock.now().getTime());
    s.clock.advance(60_000);
    await me(sid);
    expect(await lastSeen()).toEqual(touched);
  });

  it('abgelaufene Zeilen werden bei der Anmeldung aufgeräumt', async () => {
    const { profile } = await tenantWithMember('user');
    await s.login(profile);
    s.clock.advance(SESSION_MAX_DAYS * DAY + 1);
    await s.login(profile);
    const count = (await s.pg.admin.query('SELECT count(*)::int AS n FROM auth_session')).rows[0]
      ?.n;
    expect(count).toBe(1);
  });

  it('unbekannte oder formal falsche Sitzungs-ID → 401', async () => {
    expect((await me('x'.repeat(43))).status).toBe(401);
    expect((await me("' OR 1=1 --")).status).toBe(401);
  });
});

describe('2FA, Sperren, System-Kontext (SV-03, FA-SU-02, DAT5-8)', () => {
  it('Admin ohne 2FA wirkt als User; /auth/me meldet mfaRequired', async () => {
    const { profile } = await tenantWithMember('admin', false);
    const { sid } = await s.login(profile);
    expect(await (await me(sid)).json()).toMatchObject({
      mfaRequired: true,
      member: { role: 'admin', effectiveRole: 'user' },
    });
  });

  it('Owner ohne 2FA: gespeicherte Rolle owner, wirksam user', async () => {
    const { profile, tenantId, memberId } = await tenantWithMember('admin', false);
    await s.seed.owner(tenantId, memberId);
    const { sid } = await s.login(profile);
    expect(await (await me(sid)).json()).toMatchObject({
      mfaRequired: true,
      member: { role: 'owner', effectiveRole: 'user' },
    });
  });

  it('Super-User-Bootstrap: gelistete Discord-ID mit 2FA → super_user + system_audit; ohne 2FA nicht', async () => {
    const withMfa = discordProfile({ mfaEnabled: true });
    const noMfa = discordProfile({ mfaEnabled: false });
    s.setBootstrapIds([withMfa.discordUserId, noMfa.discordUserId]);
    const a = await s.login(withMfa, { next: '/system' });
    expect(a.location).toBe('/mandant-waehlen?next=%2Fsystem');
    const b = await s.login(noMfa);
    expect(b.location).toBe('/kein-zugang');
    const su = await s.pg.admin.query(
      'SELECT i.discord_user_id, su.created_by FROM super_user su JOIN identity i ON i.id = su.identity_id',
    );
    expect(su.rows).toEqual([{ discord_user_id: withMfa.discordUserId, created_by: null }]);
    const audit = await s.pg.admin.query('SELECT actor, action FROM system_audit');
    expect(audit.rows).toEqual([{ actor: 'super_user', action: 'super_user.bootstrap' }]);
    await s.login(withMfa);
    expect((await s.pg.admin.query('SELECT count(*)::int AS n FROM system_audit')).rows[0]?.n).toBe(
      1,
    );

    const ctx = await s.request('/api/auth/context', {
      method: 'POST',
      body: { system: true },
      cookies: sidCookie(a.sid),
    });
    expect(await ctx.json()).toMatchObject({ context: 'system', isSuperUser: true });
  });

  it('System-Kontext ohne 2FA → 403 auth.mfa_required; ohne Super User → 403 permission.denied', async () => {
    const p = discordProfile({ mfaEnabled: false });
    const identity = await s.seed.identity({ discordUserId: p.discordUserId, mfaEnabled: false });
    await s.seed.superUser(identity.id);
    const { sid } = await s.login(p);
    const res = await s.request('/api/auth/context', {
      method: 'POST',
      body: { system: true },
      cookies: sidCookie(sid),
    });
    expect(await res.json()).toMatchObject({ status: 403, code: 'auth.mfa_required' });
    expect(await (await me(sid)).json()).toMatchObject({
      isSuperUser: true,
      mfaRequired: true,
      context: 'select',
    });
    const other = await s.login(discordProfile());
    const denied = await s.request('/api/auth/context', {
      method: 'POST',
      body: { system: true },
      cookies: sidCookie(other.sid),
    });
    expect(await denied.json()).toMatchObject({ code: 'permission.denied' });
  });

  it('gesperrte Identität → 403 auth.identity_blocked (auch mit laufender Sitzung); Login endet auf /kein-zugang', async () => {
    const { profile, identity } = await tenantWithMember('user');
    const { sid } = await s.login(profile);
    await s.pg.admin.query("UPDATE identity SET status = 'blocked' WHERE id = $1", [identity.id]);
    expect(await (await me(sid)).json()).toMatchObject({
      status: 403,
      code: 'auth.identity_blocked',
    });
    const again = await s.login(profile);
    expect(again.location).toBe('/kein-zugang?grund=gesperrt');
    expect(again.sid).toBeUndefined();
  });

  it('gesperrter Mandant → 403 tenant.locked auf Mandantenrouten; Kontextwechsel dorthin abgelehnt', async () => {
    const { profile, tenantId } = await tenantWithMember('admin', true);
    const { sid } = await s.login(profile);
    const jobUrl = `/api/web/v1/jobs/${crypto.randomUUID()}`;
    expect((await s.request(jobUrl, { cookies: sidCookie(sid) })).status).toBe(404);
    await s.pg.admin.query("UPDATE tenant SET status = 'locked' WHERE id = $1", [tenantId]);
    expect(await (await s.request(jobUrl, { cookies: sidCookie(sid) })).json()).toMatchObject({
      status: 403,
      code: 'tenant.locked',
    });
    // Die Sitzung selbst bleibt nutzbar (Auswahl), damit ein anderer Mandant gewählt werden kann.
    expect(await (await me(sid)).json()).toMatchObject({ context: 'select' });
    const ctx = await s.request('/api/auth/context', {
      method: 'POST',
      body: { tenantKey: 'sternwarte' },
      cookies: sidCookie(sid),
    });
    expect(await ctx.json()).toMatchObject({ code: 'tenant.locked' });
  });

  it('Kontextwechsel: fremder Mandant → auth.no_membership, unbekannt → tenant.not_found', async () => {
    const { profile } = await tenantWithMember('user');
    await s.seed.tenant('andere');
    const { sid } = await s.login(profile);
    const post = (body: unknown) =>
      s.request('/api/auth/context', { method: 'POST', body, cookies: sidCookie(sid) });
    expect(await (await post({ tenantKey: 'andere' })).json()).toMatchObject({
      code: 'auth.no_membership',
    });
    expect(await (await post({ tenantKey: 'gibt-es-nicht' })).json()).toMatchObject({
      code: 'tenant.not_found',
    });
    expect((await post({ tenantKey: 'sternwarte' })).status).toBe(200);
  });
});

describe('Einladung (TK 5.2, DAT5-15)', () => {
  it('claim setzt __Host-npm_invite (15 min); Callback löst ein und wählt den Mandanten', async () => {
    const tenantId = await s.seed.tenant('neu');
    const token = await s.seed.invitation(tenantId, 'owner');
    const claim = await s.request('/api/auth/invitation/claim', {
      method: 'POST',
      body: { token },
    });
    expect(await claim.json()).toEqual({ tenantName: 'Mandant neu', role: 'owner' });
    const invite = setCookies(claim)[COOKIE_NAMES.invite];
    expect(invite?.raw).toMatch(/Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=900$/);
    expect(invite?.value).not.toContain(token);
    const p = discordProfile();
    const { location, sid, callback } = await s.login(p, {
      next: '/start',
      cookies: { [COOKIE_NAMES.invite]: invite?.value ?? '' },
    });
    expect(location).toBe('/start');
    expect(setCookies(callback)[COOKIE_NAMES.invite]?.raw).toContain('Max-Age=0');
    expect(await (await me(sid)).json()).toMatchObject({
      tenant: { key: 'neu' },
      member: { role: 'owner', effectiveRole: 'admin' },
    });
    // Owner-Einladung bei vorhandenem Owner → 404 invitation.invalid (TK 5.2).
    const second = await s.seed.invitation(tenantId, 'owner');
    expect(
      await (
        await s.request('/api/auth/invitation/claim', { method: 'POST', body: { token: second } })
      ).json(),
    ).toMatchObject({
      status: 404,
      code: 'invitation.invalid',
    });
  });

  it('abgelaufen → 410, unbekannt → 404, verbraucht → 404; bereits Mitglied → Hinweis im Redirect', async () => {
    const tenantId = await s.seed.tenant('club');
    const expired = await s.seed.invitation(tenantId, 'user', {
      expiresAt: new Date(s.clock.now().getTime() - 1000),
    });
    const claim = (token: string) =>
      s.request('/api/auth/invitation/claim', { method: 'POST', body: { token } });
    expect((await claim(expired)).status).toBe(410);
    expect((await claim('B'.repeat(43))).status).toBe(404);
    const token = await s.seed.invitation(tenantId, 'user');
    const invite = setCookies(await claim(token))[COOKIE_NAMES.invite]?.value ?? '';
    const p = discordProfile();
    await s.login(p, { cookies: { [COOKIE_NAMES.invite]: invite } });
    expect((await claim(token)).status).toBe(404);
    const again = await s.login(p, { next: '/a', cookies: { [COOKIE_NAMES.invite]: invite } });
    expect(again.location).toBe('/a?einladung=invitation.invalid');
  });

  it('an eine Discord-ID gebundene Einladung gilt nur für dieses Konto', async () => {
    const tenantId = await s.seed.tenant('bound');
    const token = await s.seed.invitation(tenantId, 'user', {
      discordUserId: '999999999999999999',
    });
    const invite =
      setCookies(
        await s.request('/api/auth/invitation/claim', { method: 'POST', body: { token } }),
      )[COOKIE_NAMES.invite]?.value ?? '';
    const res = await s.login(discordProfile(), { cookies: { [COOKIE_NAMES.invite]: invite } });
    expect(res.location).toBe('/kein-zugang?einladung=invitation.invalid');
  });
});
