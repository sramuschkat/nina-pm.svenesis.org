/** CSRF-Tabellentests (SV-04, TK 5.3, AP-05). */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { csrf, requiresCsrfHeader } from '../src/lib/csrf';
import { testApp, viaCloudFront } from './support/app';
import { PERSONAS } from './support/personas';

// Beispielrouten der späteren Pakete (AP-04a u. a.) – geprüft wird nur die Middleware davor.
const app = new Hono();
app.use('*', csrf());
for (const path of ['/api/auth/discord/start', '/api/auth/discord/callback'])
  app.get(path, (c) => c.text('ok'));
for (const path of [
  '/api/auth/invitation/claim',
  '/api/auth/invitations/preview',
  '/api/auth/logout',
  '/api/web/v1/projects',
  '/api/system/v1/tenants',
  '/api/nina/v1/plan',
]) {
  app.post(path, (c) => c.text('ok'));
}
app.delete('/api/web/v1/projects/1', (c) => c.text('ok'));

const req = (method: string, path: string, headers: Record<string, string> = {}) =>
  app.request(path, { method, headers });

describe('CSRF-Middleware', () => {
  it.each([
    ['POST', '/api/web/v1/projects'],
    ['DELETE', '/api/web/v1/projects/1'],
    ['POST', '/api/system/v1/tenants'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/invitation/claim'],
    ['POST', '/api/auth/invitations/preview'],
  ])('%s %s ohne X-NPM-Request → 403 auth.csrf_missing', async (method, path) => {
    const res = await req(method, path);
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ status: 403, code: 'auth.csrf_missing' });
  });

  it.each([
    ['POST', '/api/web/v1/projects'],
    ['POST', '/api/auth/invitation/claim'],
    ['DELETE', '/api/web/v1/projects/1'],
  ])('%s %s mit X-NPM-Request: 1 → durchgelassen', async (method, path) => {
    expect((await req(method, path, { 'X-NPM-Request': '1' })).status).toBe(200);
  });

  it('falscher Header-Wert → 403', async () => {
    expect((await req('POST', '/api/web/v1/projects', { 'X-NPM-Request': 'true' })).status).toBe(
      403,
    );
  });

  it.each(['/api/auth/discord/start', '/api/auth/discord/callback'])(
    'GET-Anmelderoute %s ohne Header → 200',
    async (path) => {
      expect((await req('GET', path)).status).toBe(200);
    },
  );

  it('/api/nina/v1 mit Bearer-Token ohne Header → durchgelassen', async () => {
    const res = await req('POST', '/api/nina/v1/plan', { Authorization: 'Bearer npm_test_token' });
    expect(res.status).toBe(200);
  });

  it('Präfixe exakt, nicht als Teilzeichenkette', () => {
    expect(requiresCsrfHeader('POST', '/api/web/v1x')).toBe(false);
    expect(requiresCsrfHeader('POST', '/api/authx')).toBe(false);
    expect(requiresCsrfHeader('HEAD', '/api/web/v1/a')).toBe(false);
  });

  it('ist in createApp vor Sitzung und Routing eingebaut', async () => {
    const owner = PERSONAS[0]?.auth ?? null;
    const { app: full } = testApp(owner);
    const res = await full.request('/api/web/v1/jobs/00000000-0000-4000-8000-000000000001', {
      method: 'POST',
      headers: viaCloudFront,
    });
    expect(await res.json()).toMatchObject({ code: 'auth.csrf_missing' });
  });
});
