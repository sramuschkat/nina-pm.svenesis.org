/**
 * Zugriffstest-Generator der NINA-API (TK 5.6, SV-08, rules/api.md): für **jede** Route aus
 * `NINA_ROUTES` × {ohne Token, unbekanntes Token, widerrufenes Token, nur Web-Sitzung, gesperrter
 * Mandant, gültiges Token}. Eine neue Route ohne Beispiel lässt den Test scheitern.
 */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NINA_ROUTES } from '../src/app';
import { hashNinaToken, newNinaToken } from '../src/nina/token';
import { CAMERA, rigInput, SITE, TELESCOPE } from './support/equipment';
import { createStack, type Stack } from './support/stack';

let stack: Stack;
let tokens: { valid: string; revoked: string; locked: string };
let cookie: Record<string, string>;
let examples: Record<string, { url: string; method?: string; body?: unknown; ok?: number }>;

const routeKey = (r: { method: string; path: string }) =>
  `${r.method.toUpperCase()} ${r.path.replace(/\{(\w+)\}/g, '{$1}')}`;

async function tenantWithRig(key: string) {
  const tenantId = await stack.seed.tenant(key);
  const identity = await stack.seed.identity({ mfaEnabled: true });
  const owner = await stack.seed.member(identity.id, tenantId, 'admin');
  await stack.seed.owner(tenantId, owner);
  const eq = stack.services.repositories({ tenantId, memberId: owner }).equipment();
  const now = stack.clock.now();
  const site = await eq.createSite(crypto.randomUUID(), SITE, now);
  const telescope = await eq.createTelescope(crypto.randomUUID(), TELESCOPE, now);
  const camera = await eq.createCamera(crypto.randomUUID(), CAMERA, now);
  const rig = await eq.createRig(
    crypto.randomUUID(),
    rigInput(site.id, telescope.id, camera.id),
    now,
  );
  const instance = async () => {
    const t = newNinaToken();
    const row = await stack.services
      .repositories({ tenantId, memberId: owner })
      .ninaInstances()
      .create(
        {
          id: crypto.randomUUID(),
          rigId: rig.id,
          name: 'PC',
          tokenHash: t.hash,
          tokenPrefix: t.prefix,
        },
        now,
      );
    return { token: t.token, id: row.id };
  };
  return {
    tenantId,
    identity,
    instance,
    repos: stack.services.repositories({ tenantId, memberId: owner }),
  };
}

beforeAll(async () => {
  stack = await createStack();
  stack.clock.set(new Date('2026-09-18T14:00:00Z'));
  const a = await tenantWithRig('nina-a');
  const valid = await a.instance();
  const revoked = await a.instance();
  await a.repos.ninaInstances().revoke(revoked.id);
  const b = await tenantWithRig('nina-b');
  const locked = await b.instance();
  await stack.pg.admin.query("UPDATE tenant SET status = 'locked' WHERE id = $1", [b.tenantId]);
  tokens = { valid: valid.token, revoked: revoked.token, locked: locked.token };
  cookie = {
    [COOKIE_NAMES.session]: await stack.seed.session(a.identity.id, a.tenantId, 'tenant'),
  };
  expect(hashNinaToken(valid.token)).toMatch(/^[0-9a-f]{64}$/);
  // Session von Rig A (gültiges Token) für die Routen mit {sessionId}.
  const sessionId = crypto.randomUUID();
  const created = await stack.request('/api/nina/v1/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${valid.token}` },
    body: {
      id: sessionId,
      night: '2026-09-18',
      nightPlanId: null,
      startedAtUtc: '2026-09-18T13:00:00Z',
      offline: false,
    },
  });
  expect(created.status).toBe(201);
  examples = {
    'GET /api/nina/v1/bootstrap': { url: '/api/nina/v1/bootstrap' },
    'GET /api/nina/v1/targets': { url: '/api/nina/v1/targets' },
    'POST /api/nina/v1/plan': {
      url: '/api/nina/v1/plan',
      method: 'POST',
      body: { night: '2026-09-18', reason: 'initial', pendingCaptures: [] },
    },
    'POST /api/nina/v1/sessions': {
      url: '/api/nina/v1/sessions',
      method: 'POST',
      // Idempotent: dieselbe Session wie oben → 200.
      body: {
        id: sessionId,
        night: '2026-09-18',
        nightPlanId: null,
        startedAtUtc: '2026-09-18T13:00:00Z',
        offline: false,
      },
    },
    'PATCH /api/nina/v1/sessions/{sessionId}': {
      url: `/api/nina/v1/sessions/${sessionId}`,
      method: 'PATCH',
      body: { ninaConditions: {} },
    },
    'POST /api/nina/v1/sessions/{sessionId}/captures': {
      url: `/api/nina/v1/sessions/${sessionId}/captures`,
      method: 'POST',
      body: {
        captures: [
          {
            id: crypto.randomUUID(),
            frameType: 'light',
            capturedAtUtc: '2026-09-19T03:00:00Z',
            exposureMidUtc: '2026-09-19T03:02:30Z',
            night: '2026-09-18',
            blockId: null,
            projectId: null,
            panelId: null,
            exposureLineId: null,
            assignment: 'unassigned',
            filterShortName: 'Ha',
            filterActual: 'Ha',
            exposureS: 300,
            gain: null,
            offset: null,
            binning: 1,
            readoutMode: null,
            readoutModeIndex: 0,
            raDeg: 1,
            decDeg: 1,
            rotationDeg: 0,
            pierSide: null,
            rotatorMechDeg: 0,
            bonus: false,
            temperatureDeviation: false,
            result: 'aborted',
            nightPlanId: crypto.randomUUID(),
          },
        ],
      },
    },
    'POST /api/nina/v1/sessions/{sessionId}/events': {
      url: `/api/nina/v1/sessions/${sessionId}/events`,
      method: 'POST',
      body: {
        events: [
          { id: crypto.randomUUID(), occurredAtUtc: '2026-09-18T14:00:00Z', kind: 'warning' },
        ],
      },
    },
    'POST /api/nina/v1/heartbeat': {
      url: '/api/nina/v1/heartbeat',
      method: 'POST',
      body: { state: 'idle', pluginVersion: '1.0.0', engineVersion: '0.6.0' },
    },
  };
});
afterAll(() => stack.close());

const call = (
  ex: { url: string; method?: string; body?: unknown },
  o: { token?: string; cookies?: Record<string, string> },
) =>
  stack.request(ex.url, {
    method: ex.method ?? 'GET',
    headers: o.token ? { authorization: `Bearer ${o.token}` } : {},
    ...(o.cookies ? { cookies: o.cookies } : {}),
    ...(ex.body !== undefined ? { body: ex.body } : {}),
  });

describe('NINA-API: Zugriff je Route (generiert)', () => {
  it('jede NINA-Route hat ein Beispiel und die Aktion nina.sync', () => {
    for (const route of NINA_ROUTES) {
      expect(examples[routeKey(route)], `Beispiel fehlt für ${routeKey(route)}`).toBeDefined();
      expect((route as unknown as Record<string, unknown>)['x-npm-action']).toBe('nina.sync');
    }
  });

  for (const route of NINA_ROUTES) {
    const key = routeKey(route);
    describe(key, () => {
      const ex = () => examples[key] as { url: string };
      it('ohne Token → 401 nina.token_invalid', async () => {
        const r = await call(ex(), {});
        expect(r.status).toBe(401);
        expect(((await r.json()) as { code: string }).code).toBe('nina.token_invalid');
      });
      it('unbekanntes Token → 401', async () => {
        expect((await call(ex(), { token: `npm_${'1'.repeat(43)}` })).status).toBe(401);
      });
      it('widerrufenes Token → 401', async () => {
        expect((await call(ex(), { token: tokens.revoked })).status).toBe(401);
      });
      it('nur Web-Sitzung (Cookie) → 401', async () => {
        expect((await call(ex(), { cookies: cookie })).status).toBe(401);
      });
      it('gesperrter Mandant → 403 tenant.locked', async () => {
        const r = await call(ex(), { token: tokens.locked });
        expect(r.status).toBe(403);
        expect(((await r.json()) as { code: string }).code).toBe('tenant.locked');
      });
      it('gültiges Token → Erfolg', async () => {
        expect((await call(ex(), { token: tokens.valid })).status).toBe(200);
      });
    });
  }
});
