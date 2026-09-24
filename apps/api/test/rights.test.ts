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
  readonly body?: unknown;
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
    'GET /api/web/v1/jobs/{id}': { url: `/api/web/v1/jobs/${jobId}`, resource: ownJob },
    'GET /api/web/v1/files/download-url': {
      url: `/api/web/v1/files/download-url?purpose=job_result&id=${jobId}`,
      resource: ownJob,
    },
  };
});

afterAll(() => stack.close());

const routeKey = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;
const metaOf = (r: object) => r as { 'x-npm-action': Action; 'x-npm-session'?: 'required' };

async function call(persona: Persona, example: Example) {
  const sid = await persona.session();
  const auth = sid
    ? (await resolveSessionState(stack.services.auth, sid, stack.clock.now())).auth
    : null;
  const res = await stack.request(example.url, {
    method: example.method ?? 'GET',
    ...(example.body !== undefined ? { body: example.body } : {}),
    ...(sid ? { cookies: { [COOKIE_NAMES.session]: sid } } : {}),
  });
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
