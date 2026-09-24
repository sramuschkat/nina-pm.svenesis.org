/**
 * Rechte-Testgenerator (TK 5.5, NFA-17): für **jede** registrierte Route × {Owner, Admin, Admin ohne 2FA,
 * User, fremder Mandant, anonym, Super User im System-Kontext} ein Aufruf mit echter Sitzung; erwartet
 * wird, was `can()` mit dem Kontext der echten Sitzungsprüfung und dem Beispielobjekt sagt. Eine neue
 * Route ohne Beispiel in EXAMPLES lässt den Test scheitern.
 */
import { can, COOKIE_NAMES, type Action, type ResourceMeta } from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES } from '../src/app';
import { resolveSessionState } from '../src/auth/session';
import { seedPersonas, type Persona, type PersonaWorld } from './support/personas';
import { createStack, type Stack } from './support/stack';

interface Example {
  readonly url: string;
  readonly method?: string;
  /** Rumpf; als Funktion je Aufruf neu (z. B. frische Client-UUID). */
  readonly body?: unknown;
  /** Stellt nach jedem Aufruf den Ausgangszustand wieder her (verändernde Routen). */
  readonly reset?: () => Promise<unknown>;
  /** Objekt, auf das die Route zugreift (für `can` mit Objekt); fehlt bei Routen ohne Objekt. */
  readonly resource?: ResourceMeta;
  readonly okStatus?: number;
  /** Abweichende Erwartung je Persona (fachliche Ergebnisse jenseits der Rechte). */
  readonly expect?: Readonly<Record<string, number>>;
}

let stack: Stack;
let world: PersonaWorld;
let jobId: string;
let EXAMPLES: Record<string, Example>;

beforeAll(async () => {
  stack = await createStack();
  world = await seedPersonas(stack);
  const repo = stack.services.repositories({ tenantId: world.tenantA });
  jobId = (
    await repo.job.enqueue({
      kind: 'multi_sim',
      dedupeKey: 'multi_sim:r:2026-09-24',
      createdBy: world.members.user,
    })
  ).jobId;
  await stack.pg.admin.query(
    "UPDATE job SET status = 'done', dedupe_active = NULL, result_s3_key = $1 WHERE id = $2",
    [`tenant/${world.tenantA}/jobs/${jobId}.json`, jobId],
  );
  const ownJob: ResourceMeta = { tenantId: world.tenantA, createdBy: world.members.user };
  const notSuper = Object.fromEntries(
    ['Owner', 'Admin', 'Admin ohne 2FA', 'User', 'User 2', 'fremder Mandant (Admin)'].map((n) => [
      n,
      403,
    ]),
  );
  EXAMPLES = {
    'GET /api/health': { url: '/api/health' },
    'GET /api/banner': { url: '/api/banner' },
    'GET /api/web/v1/audit/system': { url: '/api/web/v1/audit/system' },
    'GET /api/auth/discord/start': { url: '/api/auth/discord/start?next=/projekte', okStatus: 302 },
    'GET /api/auth/discord/callback': {
      url: '/api/auth/discord/callback?code=x&state=y',
      okStatus: 302,
    },
    'POST /api/auth/invitation/claim': {
      url: '/api/auth/invitation/claim',
      method: 'POST',
      body: { token: 'A'.repeat(43) },
      okStatus: 404,
    },
    'POST /api/auth/context': {
      url: '/api/auth/context',
      method: 'POST',
      body: { system: true },
      expect: notSuper,
    },
    'POST /api/auth/logout': { url: '/api/auth/logout', method: 'POST', okStatus: 204 },
    'GET /api/auth/me': { url: '/api/auth/me' },
    'GET /api/auth/sessions': { url: '/api/auth/sessions' },
    'DELETE /api/auth/sessions/{id}': {
      url: `/api/auth/sessions/${crypto.randomUUID()}`,
      method: 'DELETE',
      okStatus: 404,
    },
    'DELETE /api/auth/sessions': { url: '/api/auth/sessions', method: 'DELETE', okStatus: 204 },
    'POST /api/auth/invitations/preview': {
      url: '/api/auth/invitations/preview',
      method: 'POST',
      body: { token: 'A'.repeat(43) },
      okStatus: 404,
    },
    'GET /api/web/v1/jobs/{id}': { url: `/api/web/v1/jobs/${jobId}`, resource: ownJob },
    'GET /api/web/v1/files/download-url': {
      url: `/api/web/v1/files/download-url?purpose=job_result&id=${jobId}`,
      resource: ownJob,
    },
    ...memberExamples(),
    ...systemExamples(),
  };
});

afterAll(() => stack.close());

const admin = () => stack.pg.admin;
const target = () => ({
  tenantId: world.tenantA,
  targetMemberId: world.members.user2,
  targetRole: 'user' as const,
});

function memberExamples(): Record<string, Example> {
  const m = world.members;
  const onlyOwner = { Admin: 403 };
  return {
    'GET /api/web/v1/members': { url: '/api/web/v1/members' },
    'PATCH /api/web/v1/members/{id}': {
      url: `/api/web/v1/members/${m.user2}`,
      method: 'PATCH',
      body: { displayName: 'User Zwei' },
      resource: target(),
      okStatus: 204,
    },
    'DELETE /api/web/v1/members/{id}': {
      url: `/api/web/v1/members/${m.user2}`,
      method: 'DELETE',
      resource: target(),
      okStatus: 204,
      reset: () => admin().query("UPDATE app_user SET status = 'active' WHERE status = 'removed'"),
    },
    // Rollen nur durch den Owner (E2): Route-Aktion member.manage, Rollenwechsel member.admin.manage.
    'PUT /api/web/v1/members/{id}/role': {
      url: `/api/web/v1/members/${m.user2}/role`,
      method: 'PUT',
      body: { role: 'user' },
      resource: target(),
      okStatus: 204,
      expect: onlyOwner,
    },
    'DELETE /api/web/v1/members/{id}/sessions': {
      url: `/api/web/v1/members/${m.user2}/sessions`,
      method: 'DELETE',
      resource: target(),
      okStatus: 204,
    },
    'POST /api/web/v1/me/leave': {
      url: '/api/web/v1/me/leave',
      method: 'POST',
      okStatus: 204,
      expect: { Owner: 409 },
      reset: () => admin().query("UPDATE app_user SET status = 'active' WHERE status = 'removed'"),
    },
    'POST /api/web/v1/tenant/owner-transfer': {
      url: '/api/web/v1/tenant/owner-transfer',
      method: 'POST',
      body: { memberId: m.admin },
      okStatus: 204,
      reset: () =>
        admin().query('UPDATE tenant SET owner_member_id = $1 WHERE id = $2', [
          m.owner,
          world.tenantA,
        ]),
    },
    'POST /api/web/v1/invitations': {
      url: '/api/web/v1/invitations',
      method: 'POST',
      body: () => ({ id: crypto.randomUUID() }),
      okStatus: 201,
    },
    'POST /api/web/v1/invitations/admin': {
      url: '/api/web/v1/invitations/admin',
      method: 'POST',
      body: () => ({ id: crypto.randomUUID() }),
      okStatus: 201,
    },
    'GET /api/web/v1/invitations': { url: '/api/web/v1/invitations' },
    'GET /api/web/v1/me/preferences': { url: '/api/web/v1/me/preferences' },
    'GET /api/web/v1/notifications': { url: '/api/web/v1/notifications' },
    'POST /api/web/v1/notifications/read': {
      url: '/api/web/v1/notifications/read',
      method: 'POST',
      body: { all: true },
    },
    'PUT /api/web/v1/me/preferences/{key}': {
      url: '/api/web/v1/me/preferences/ui.theme',
      method: 'PUT',
      body: { value: 'dark' },
      okStatus: 204,
    },
    'DELETE /api/web/v1/invitations/{id}': {
      url: `/api/web/v1/invitations/${crypto.randomUUID()}`,
      method: 'DELETE',
      okStatus: 404,
    },
  };
}

function systemExamples(): Record<string, Example> {
  let n = 0;
  return {
    'GET /api/system/v1/tenants': { url: '/api/system/v1/tenants' },
    'POST /api/system/v1/tenants': {
      url: '/api/system/v1/tenants',
      method: 'POST',
      body: () => ({ tenantKey: `rights-${(n += 1)}`, displayName: 'Rechte-Test' }),
      okStatus: 201,
    },
    'PATCH /api/system/v1/tenants/{id}': {
      url: `/api/system/v1/tenants/${world.tenantB}`,
      method: 'PATCH',
      body: { status: 'active' },
    },
    'POST /api/system/v1/tenants/{id}/invitations': {
      url: `/api/system/v1/tenants/${world.tenantB}/invitations`,
      method: 'POST',
      body: () => ({ id: crypto.randomUUID() }),
      okStatus: 201,
    },
    'PUT /api/system/v1/tenants/{id}/owner': {
      url: `/api/system/v1/tenants/${world.tenantB}/owner`,
      method: 'PUT',
      body: {
        memberId: world.members.foreignAdmin,
        reason: 'Rechte-Test',
        keepPreviousAsAdmin: true,
      },
      reset: () =>
        admin().query('UPDATE tenant SET owner_member_id = NULL WHERE id = $1', [world.tenantB]),
    },
    'GET /api/system/v1/tenants/{id}/members': {
      url: `/api/system/v1/tenants/${world.tenantA}/members`,
    },
    'GET /api/system/v1/super-users': { url: '/api/system/v1/super-users' },
    'POST /api/system/v1/super-users': {
      url: '/api/system/v1/super-users',
      method: 'POST',
      body: { discordUserId: '9'.repeat(18) },
      okStatus: 404,
    },
    'PATCH /api/system/v1/super-users/{id}': {
      url: `/api/system/v1/super-users/${world.identities.superUser}`,
      method: 'PATCH',
      body: { status: 'active' },
      okStatus: 204,
    },
    'DELETE /api/system/v1/super-users/{id}': {
      url: `/api/system/v1/super-users/${crypto.randomUUID()}`,
      method: 'DELETE',
      okStatus: 404,
    },
    'PATCH /api/system/v1/identities/{id}': {
      url: `/api/system/v1/identities/${world.identities.user2}`,
      method: 'PATCH',
      body: { status: 'active' },
      okStatus: 204,
    },
    'DELETE /api/system/v1/tenants/{id}': {
      url: `/api/system/v1/tenants/${crypto.randomUUID()}`,
      method: 'DELETE',
      body: { confirmTenantKey: 'gibt-es-nicht' },
      okStatus: 404,
    },
    'GET /api/system/v1/audit': { url: '/api/system/v1/audit' },
    'GET /api/system/v1/settings/{key}': { url: '/api/system/v1/settings/maintenanceBanner' },
    'PUT /api/system/v1/settings/{key}': {
      url: '/api/system/v1/settings/maintenanceBanner',
      method: 'PUT',
      body: { value: { active: false, textDe: '', textEn: '' } },
    },
    'GET /api/system/v1/identities': {
      url: '/api/system/v1/identities?discordUserId=' + '9'.repeat(18),
      okStatus: 404,
    },
  };
}

const routeKey = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;
const metaOf = (r: object) => r as { 'x-npm-action': Action; 'x-npm-session'?: 'required' };

async function call(persona: Persona, example: Example) {
  const sid = await persona.session();
  const auth = sid
    ? (await resolveSessionState(stack.services.auth, sid, stack.clock.now())).auth
    : null;
  const body =
    typeof example.body === 'function' ? (example.body as () => unknown)() : example.body;
  const res = await stack.request(example.url, {
    method: example.method ?? 'GET',
    ...(body !== undefined ? { body } : {}),
    ...(sid ? { cookies: { [COOKIE_NAMES.session]: sid } } : {}),
  });
  await example.reset?.();
  const text = await res.text();
  const code = text.startsWith('{') ? (JSON.parse(text) as { code?: string }).code : undefined;
  return { status: res.status, code, auth };
}

describe('Rechte-Tests: Route × Rolle (generiert)', () => {
  it('jede Route hat eine Aktion und ein Beispiel', () => {
    for (const route of ROUTES) {
      expect(metaOf(route)['x-npm-action'], routeKey(route)).toBeTruthy();
      expect(EXAMPLES[routeKey(route)], `Beispiel fehlt für ${routeKey(route)}`).toBeDefined();
    }
  });

  for (const route of ROUTES) {
    const key = routeKey(route);
    const { 'x-npm-action': action, 'x-npm-session': session } = metaOf(route);
    describe(`${key} (${action}${session ? ', Sitzung' : ''})`, () => {
      const names = [
        'Owner',
        'Admin',
        'Admin ohne 2FA',
        'User',
        'fremder Mandant (Admin)',
        'anonym',
        'Super User im System-Kontext',
      ];
      for (const name of names) {
        it(name, async () => {
          const example = EXAMPLES[key];
          const persona = world.personas.find((p) => p.name === name);
          if (!example || !persona) throw new Error('Beispiel/Persona fehlt');
          const { status, code, auth } = await call(persona, example);
          const ok = example.expect?.[name] ?? example.okStatus ?? 200;
          if (action === 'public' && !session) {
            expect(status).toBe(ok);
          } else if (!auth) {
            expect([status, code]).toEqual([401, 'auth.unauthenticated']);
          } else if (action === 'public') {
            expect(status).toBe(ok);
          } else if (!can(auth, action)) {
            expect([status, code]).toEqual([403, 'permission.denied']);
          } else if (persona.foreign && example.resource) {
            // Mandantengebundenes Repository: fremde Objekte existieren nicht.
            expect(status).toBe(404);
          } else if (can(auth, action, example.resource)) {
            expect(status).toBe(ok);
          } else {
            expect([status, code]).toEqual([403, 'permission.denied']);
          }
        });
      }

      it('Admin ohne 2FA verhält sich wie User (SV-03)', async () => {
        const example = EXAMPLES[key];
        const noMfa = world.personas.find((p) => p.name === 'Admin ohne 2FA');
        const user2 = world.personas.find((p) => p.name === 'User 2');
        if (!example || !noMfa || !user2) throw new Error('Personas fehlen');
        const a = await call(noMfa, example);
        const b = await call(user2, example);
        expect({ status: a.status, code: a.code }).toEqual({ status: b.status, code: b.code });
      });
    });
  }
});
