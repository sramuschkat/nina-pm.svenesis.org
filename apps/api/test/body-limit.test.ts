/**
 * TK 15 („Manipulierte Eingaben“): Anfrage-Body höchstens 1 MiB – darüber `413 request.too_large`, bevor Sitzung,
 * CSRF oder ein Handler laufen; gilt für Web- und NINA-API gleich. Knapp darunter geht die Anfrage normal weiter.
 */
import { REQUEST_BODY_MAX_BYTES } from '@nina-pm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStack, type Stack } from './support/stack';

let s: Stack;
beforeAll(async () => {
  s = await createStack();
});
afterAll(() => s.close());

/** JSON-Objekt mit etwa `bytes` Byte. */
const payload = (bytes: number) => ({ pad: 'x'.repeat(bytes - 20) });

describe('Body-Limit 1 MiB', () => {
  it('darüber 413 request.too_large – Web und NINA', async () => {
    for (const path of ['/api/web/v1/projects', '/api/nina/v1/sessions']) {
      const res = await s.request(path, {
        method: 'POST',
        body: payload(REQUEST_BODY_MAX_BYTES + 1024),
      });
      expect(res.status, path).toBe(413);
      expect(((await res.json()) as { code: string }).code).toBe('request.too_large');
    }
  });

  it('knapp darunter: normale Prüfung (hier ohne CSRF-Header bzw. ohne Token)', async () => {
    const web = await s.request('/api/web/v1/projects', {
      method: 'POST',
      body: payload(REQUEST_BODY_MAX_BYTES - 1024),
    });
    expect(web.status).not.toBe(413);
    const nina = await s.request('/api/nina/v1/sessions', {
      method: 'POST',
      body: payload(REQUEST_BODY_MAX_BYTES - 1024),
    });
    expect(nina.status).toBe(401);
  });
});
