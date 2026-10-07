/**
 * Gemeinsame Vorbereitung der Auswertungs-Tests (AP-15, AP-64): eigenes Rig an einem eigenen Standort mit
 * freigegebenem Projekt, NINA-Instanz und einer Fake-Plugin-Nacht.
 */
import { expect, type Page } from '@playwright/test';
import { runFakeNight } from '../tools/fake-plugin/src/night';
import { csrf } from './support';

const json = async <T>(page: Page, url: string): Promise<T> => {
  const res = await page.request.get(url);
  expect(res.status(), url).toBe(200);
  return (await res.json()) as T;
};

/** Eigenes Rig mit freigegebenem Projekt, NINA-Instanz und einer Fake-Plugin-Nacht. */
export async function nightOnOwnRig(admin: Page, user: Page, baseURL: string) {
  const stamp = String(Date.now());
  const siteId = crypto.randomUUID();
  await admin.request.post('/api/web/v1/sites', {
    headers: csrf,
    data: {
      id: siteId,
      name: `E2E-Sessions ${stamp}`,
      latitudeDeg: 31.5471,
      longitudeDeg: -99.3823,
      elevationM: 400,
      timeZone: 'America/Chicago',
    },
  });
  const telescopes = await json<{ items: { id: string }[] }>(admin, '/api/web/v1/telescopes');
  const cameras = await json<{ items: { id: string }[] }>(admin, '/api/web/v1/cameras');
  const rigId = crypto.randomUUID();
  const rigName = `E2E-Sessions-Rig ${stamp}`;
  expect(
    (
      await admin.request.post('/api/web/v1/rigs', {
        headers: csrf,
        data: {
          id: rigId,
          name: rigName,
          siteId,
          telescopeId: telescopes.items[0]?.id,
          cameraId: cameras.items[0]?.id,
        },
      })
    ).status(),
  ).toBe(201);
  const filters = await json<{ items: { id: string; shortName: string }[] }>(
    user,
    '/api/web/v1/filters',
  );
  const projectId = crypto.randomUUID();
  const created = await user.request.post('/api/web/v1/projects', {
    headers: csrf,
    data: { id: projectId, name: `E2E-Session-Projekt ${stamp}`, rigId, raDeg: 13.2, decDeg: 56.6 },
  });
  const panel = ((await created.json()) as { panels: { id: string }[] }).panels[0]?.id;
  await user.request.post(`/api/web/v1/projects/${projectId}/lines`, {
    headers: csrf,
    data: {
      id: crypto.randomUUID(),
      panelId: panel,
      filterId: filters.items.find((f) => f.shortName === 'Ha')?.id,
      exposureS: 300,
      plannedCount: 40,
      moonMode: 'none',
    },
  });
  await user.request.post(`/api/web/v1/projects/${projectId}/submit`, { headers: csrf, data: {} });
  expect(
    (
      await admin.request.post(`/api/web/v1/projects/${projectId}/approve`, {
        headers: csrf,
        data: { rigId, status: 'active' },
      })
    ).status(),
  ).toBe(200);
  const instance = await admin.request.post('/api/web/v1/nina-instances', {
    headers: csrf,
    data: { id: crypto.randomUUID(), rigId, name: `E2E-PC ${stamp}` },
  });
  const token = ((await instance.json()) as { token: string }).token;
  const report = await runFakeNight({ baseUrl: baseURL, token });
  expect(report.steps.filter((s) => s.status === 'failed')).toEqual([]);
  return { rigId, rigName, siteId, projectId, projectName: `E2E-Session-Projekt ${stamp}` };
}
