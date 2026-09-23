import { ENGINE_VERSION } from '@nina-pm/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { sameSecret } from '../src/lib/origin-verify';

const SECRET = 'a'.repeat(43);
const app = createApp({ originVerifyValue: () => Promise.resolve(SECRET), buildId: 'b1' });
const viaCloudFront = { 'x-origin-verify': SECRET };

describe('GET /api/health', () => {
  it('antwortet über CloudFront mit Status, ENGINE_VERSION und Build, ohne Cache', async () => {
    const res = await app.request('/api/health', { headers: viaCloudFront });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', engineVersion: ENGINE_VERSION, build: 'b1' });
  });
});

describe('Origin-Verify (SV-16)', () => {
  it.each([
    ['ohne Header', {}],
    ['mit falschem Wert', { 'x-origin-verify': 'b'.repeat(43) }],
    ['mit kürzerem Wert', { 'x-origin-verify': 'a' }],
  ])('Direktaufruf %s → 403 permission.denied', async (_name, headers) => {
    const res = await app.request('/api/health', { headers });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ status: 403, code: 'permission.denied' });
  });

  it('prüft auch unbekannte Pfade, bevor 404 kommt', async () => {
    expect((await app.request('/api/gibt-es-nicht')).status).toBe(403);
  });

  it('vergleicht in konstanter Zeit und nur bei gleicher Länge', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
  });
});

describe('Fehlerantworten (rules/api.md)', () => {
  it('unbekannte Route → 404 resource.not_found', async () => {
    const res = await app.request('/api/gibt-es-nicht', { headers: viaCloudFront });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'resource.not_found' });
  });

  it('unerwarteter Fehler → 500 internal.error ohne Details', async () => {
    const broken = createApp({
      originVerifyValue: () => Promise.reject(new Error('SSM geheim kaputt')),
      buildId: 'b1',
    });
    const res = await broken.request('/api/health', {
      headers: { ...viaCloudFront, 'x-amzn-requestid': 'req-1' },
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      type: 'about:blank',
      title: 'Interner Fehler',
      status: 500,
      code: 'internal.error',
      requestId: 'req-1',
    });
    expect(text).not.toContain('SSM');
  });
});
