// @vitest-environment jsdom
/**
 * Bündeln gleichzeitiger Abrufe im API-Client (01.10.2026): Stammdaten-Listen teilen sich `GET /equipment`,
 * gleichzeitige Projekt-Einzelabrufe gehen gesammelt an `GET /project-details`; einzelne Abrufe und Listen mit
 * Filter bleiben wie bisher.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const calls: string[] = [];

function respond(url: string): unknown {
  if (url === '/api/web/v1/equipment')
    return {
      sites: [{ id: 's' }],
      telescopes: [],
      cameras: [],
      filters: [{ id: 'f' }],
      moonProfiles: [],
      rigs: [{ id: 'r' }],
    };
  if (url.startsWith('/api/web/v1/project-details?ids=')) {
    const ids = url.split('=')[1]?.split(',') ?? [];
    // ID(3) ist „nicht lesbar“ und fehlt im Sammelabruf.
    return { items: ids.filter((id) => id !== ID(3)).map((id) => ({ id, name: `P ${id}` })) };
  }
  if (url === `/api/web/v1/projects/${ID(3)}`) return null;
  if (url.startsWith('/api/web/v1/projects/')) return { id: url.split('/').pop(), name: 'einzeln' };
  if (url.startsWith('/api/web/v1/sites?')) return { items: [{ id: 'gefiltert' }] };
  return {};
}

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(url);
      const body = respond(url);
      if (body === null)
        return Promise.resolve(
          new Response(JSON.stringify({ status: 403, code: 'permission.denied' }), {
            status: 403,
            headers: { 'content-type': 'application/problem+json' },
          }),
        );
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Stammdaten-Listen', () => {
  it('gleichzeitige Listen teilen sich einen Aufruf; danach wieder frisch; mit Filter einzeln', async () => {
    const { equipmentApi } = await import('./client');
    const [rigs, filters, sites] = await Promise.all([
      equipmentApi.list('rigs'),
      equipmentApi.list('filters'),
      equipmentApi.list('sites'),
    ]);
    expect(calls).toEqual(['/api/web/v1/equipment']);
    expect([rigs.items, filters.items, sites.items]).toEqual([
      [{ id: 'r' }],
      [{ id: 'f' }],
      [{ id: 's' }],
    ]);
    await equipmentApi.list('rigs');
    expect(calls).toEqual(['/api/web/v1/equipment', '/api/web/v1/equipment']);
    expect((await equipmentApi.list('sites', '?q=x')).items).toEqual([{ id: 'gefiltert' }]);
    // Objektarten außerhalb des Bündels bleiben Einzelabrufe.
    await equipmentApi.list('exposure-templates');
    expect(calls.slice(-2)).toEqual(['/api/web/v1/sites?q=x', '/api/web/v1/exposure-templates']);
  });
});

describe('Projekt-Einzelabrufe', () => {
  it('ein Abruf allein bleibt GET /projects/{id}', async () => {
    const { projectsApi } = await import('./client');
    expect((await projectsApi.get(ID(1))).name).toBe('einzeln');
    expect(calls).toEqual([`/api/web/v1/projects/${ID(1)}`]);
  });

  it('gleichzeitige Abrufe gesammelt; Doppelte einmal; fehlende über den Einzelabruf mit dessen Fehler', async () => {
    const { projectsApi } = await import('./client');
    const results = await Promise.allSettled([
      projectsApi.get(ID(1)),
      projectsApi.get(ID(2)),
      projectsApi.get(ID(1)),
      projectsApi.get(ID(3)),
    ]);
    expect(calls[0]).toBe(`/api/web/v1/project-details?ids=${ID(1)},${ID(2)},${ID(3)}`);
    expect(calls[1]).toBe(`/api/web/v1/projects/${ID(3)}`);
    expect(calls).toHaveLength(2);
    expect(results.slice(0, 3).map((r) => (r.status === 'fulfilled' ? r.value.id : null))).toEqual([
      ID(1),
      ID(2),
      ID(1),
    ]);
    expect(results[3]?.status).toBe('rejected');
  });
});
