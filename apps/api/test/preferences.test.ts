/** Persönliche Einstellungen je Mitgliedschaft (TK 11.3: Theme und Dichte in user_preference). */
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
beforeEach(() => s.reset());
afterAll(() => s.close());

describe('me/preferences', () => {
  it('speichert Theme und Dichte je Mitglied, liefert nur gültige Werte', async () => {
    const tenant = await s.seed.tenant('pref');
    const a = await s.seed.identity();
    const b = await s.seed.identity();
    await s.seed.member(a.id, tenant, 'user');
    await s.seed.member(b.id, tenant, 'user');
    const sa = { [COOKIE_NAMES.session]: await s.seed.session(a.id, tenant, 'tenant') };
    const sb = { [COOKIE_NAMES.session]: await s.seed.session(b.id, tenant, 'tenant') };
    expect(await (await s.request('/api/web/v1/me/preferences', { cookies: sa })).json()).toEqual(
      {},
    );
    expect(
      (
        await s.request('/api/web/v1/me/preferences/ui.theme', {
          method: 'PUT',
          body: { value: 'dark' },
          cookies: sa,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await s.request('/api/web/v1/me/preferences/ui.density', {
          method: 'PUT',
          body: { value: 'wide' },
          cookies: sa,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await s.request('/api/web/v1/me/preferences/ui.density', {
          method: 'PUT',
          body: { value: 'compact' },
          cookies: sa,
        })
      ).status,
    ).toBe(204);
    expect(await (await s.request('/api/web/v1/me/preferences', { cookies: sa })).json()).toEqual({
      'ui.theme': 'dark',
      'ui.density': 'compact',
    });
    expect(await (await s.request('/api/web/v1/me/preferences', { cookies: sb })).json()).toEqual(
      {},
    );
  });

  it('unbekannter Schlüssel bzw. ungültiger Wert → 422 validation.failed; ohne Mandanten-Kontext → 403', async () => {
    const tenant = await s.seed.tenant('pref');
    const a = await s.seed.identity();
    await s.seed.member(a.id, tenant, 'user');
    const sa = { [COOKIE_NAMES.session]: await s.seed.session(a.id, tenant, 'tenant') };
    expect(
      (
        await s.request('/api/web/v1/me/preferences/ui.theme', {
          method: 'PUT',
          body: { value: 'red' },
          cookies: sa,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await s.request('/api/web/v1/me/preferences/ui.redlight', {
          method: 'PUT',
          body: { value: true },
          cookies: sa,
        })
      ).status,
    ).toBe(422);
    const select = { [COOKIE_NAMES.session]: await s.seed.session(a.id, null, 'select') };
    expect((await s.request('/api/web/v1/me/preferences', { cookies: select })).status).toBe(403);
  });
});
