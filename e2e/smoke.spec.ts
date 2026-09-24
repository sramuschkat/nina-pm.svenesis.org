/** Smoke (AP-04a): Web-App lädt; Test-Login → Sitzung → /auth/me → Abmelden → 401 (TK 5.3, 17). */
import { expect, test } from '@playwright/test';

const csrf = { 'X-NPM-Request': '1' };

test('Web-App lädt und die Sitzung funktioniert über den gleichen Origin', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeAttached();

  const anonymous = await page.request.get('/api/auth/me');
  expect(anonymous.status()).toBe(401);

  const login = await page.request.post('/api/auth/test-login', {
    data: { identityFixture: 'owner' },
    headers: csrf,
  });
  expect(login.ok()).toBe(true);
  const cookie = (await page.context().cookies()).find((c) => c.name === '__Host-npm_sid');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });

  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({
    context: 'tenant',
    tenant: { key: 'demo' },
    member: { role: 'owner' },
  });

  expect((await page.request.post('/api/auth/logout', { headers: csrf })).status()).toBe(204);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});

test('POST ohne X-NPM-Request → 403 auth.csrf_missing', async ({ page }) => {
  const res = await page.request.post('/api/auth/logout');
  expect(res.status()).toBe(403);
  expect(await res.json()).toMatchObject({ code: 'auth.csrf_missing' });
});
