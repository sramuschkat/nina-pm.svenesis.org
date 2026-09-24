import { describe, expect, it, vi } from 'vitest';
import { createApiFetch, discordLoginUrl, loginUrl } from '../src/auth';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(res: Response) {
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(res),
  );
  const go = vi.fn();
  const apiFetch = createApiFetch(fetchImpl as unknown as typeof fetch, {
    currentPath: () => '/projekte/7?tab=plan',
    go,
  });
  return { fetchImpl, go, apiFetch };
}

describe('apiFetch (TK 5.3, SV-04)', () => {
  it('setzt X-NPM-Request nur bei nicht-GET', async () => {
    const a = setup(json(200, {}));
    await a.apiFetch('/api/auth/me');
    expect(new Headers(a.fetchImpl.mock.calls[0]?.[1]?.headers).get('X-NPM-Request')).toBeNull();
    const b = setup(new Response(null, { status: 204 }));
    await b.apiFetch('/api/auth/logout', { method: 'POST' });
    expect(new Headers(b.fetchImpl.mock.calls[0]?.[1]?.headers).get('X-NPM-Request')).toBe('1');
  });

  it('401 auth.unauthenticated → Anmeldeseite mit next = aktueller Pfad, ohne Wiederholung', async () => {
    const { apiFetch, go, fetchImpl } = setup(
      json(401, { status: 401, code: 'auth.unauthenticated' }),
    );
    await expect(apiFetch('/api/auth/me')).rejects.toMatchObject({
      problem: { code: 'auth.unauthenticated' },
    });
    expect(go).toHaveBeenCalledWith('/?next=%2Fprojekte%2F7%3Ftab%3Dplan');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('andere Fehler werfen ApiError ohne Navigation', async () => {
    const { apiFetch, go } = setup(json(403, { status: 403, code: 'permission.denied' }));
    await expect(apiFetch('/api/web/v1/x')).rejects.toMatchObject({
      problem: { status: 403, code: 'permission.denied' },
    });
    expect(go).not.toHaveBeenCalled();
  });

  it('Anmelde-URLs nur mit relativen Pfaden', () => {
    expect(loginUrl('//evil.example')).toBe('/');
    expect(loginUrl('/a b')).toBe('/?next=%2Fa%20b');
    expect(discordLoginUrl('https://evil.example', 'demo')).toBe(
      '/api/auth/discord/start?next=%2F&mandant=demo',
    );
  });
});
