/**
 * AP-22: Mosaik 2×2 in der Sternkarte entwerfen und ins Projekt übernehmen → vier Panels mit dem Plan von
 * Panel 1, Panel-Liste im Editor, Simulator plant Panel-Blöcke (Nacht 17./18.09.2026, Starfront).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { csrf, testLogin } from './support';

const NIGHT = '2026-09-17';
const STARFRONT = { latitudeDeg: 31.5471, longitudeDeg: -99.3823, elevationM: 400 };

const json = async <T>(page: Page, url: string): Promise<T> => {
  const res = await page.request.get(url);
  expect(res.status(), url).toBe(200);
  return (await res.json()) as T;
};

async function setup(admin: Page, user: Page) {
  const stamp = String(Date.now());
  const siteId = crypto.randomUUID();
  await admin.request.post('/api/web/v1/sites', {
    headers: csrf,
    data: { id: siteId, name: `E2E-Mosaik ${stamp}`, ...STARFRONT, timeZone: 'America/Chicago' },
  });
  const telescopes = await json<{ items: { id: string }[] }>(admin, '/api/web/v1/telescopes');
  const cameras = await json<{ items: { id: string }[] }>(admin, '/api/web/v1/cameras');
  const rigId = crypto.randomUUID();
  await admin.request.post('/api/web/v1/rigs', {
    headers: csrf,
    data: {
      id: rigId,
      name: `E2E-Mosaik-Rig ${stamp}`,
      siteId,
      telescopeId: telescopes.items[0]?.id,
      cameraId: cameras.items[0]?.id,
      hasRotator: true,
    },
  });
  const filters = await json<{ items: { id: string; shortName: string }[] }>(
    user,
    '/api/web/v1/filters',
  );
  const projectId = crypto.randomUUID();
  const name = `E2E-Mosaik ${stamp}`;
  const created = await user.request.post('/api/web/v1/projects', {
    headers: csrf,
    data: { id: projectId, name, rigId, raDeg: 13.2046, decDeg: 56.6297 },
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
  return { rigId, projectId, name };
}

test('Mosaik 2×2 aus der Sternkarte → vier Panels, Panel-Liste, Simulator mit Panel-Blöcken', async ({
  page,
  browser,
}) => {
  await testLogin(page, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const s = await setup(page, user);

  await page.goto(
    `/planung/sternkarte?ra=13.2046&dec=56.6297&fra=13.2046&fdec=56.6297&fov=8&rig=${s.rigId}&projekt=${s.projectId}&foto=keins`,
  );
  await page.getByLabel('Panels horizontal').fill('2');
  await page.getByLabel('Panels vertikal').fill('2');
  await expect(page).toHaveURL(/h=2&v=2/);
  await page.getByRole('button', { name: 'Ins Projekt übernehmen' }).click();
  await expect(
    page.getByText('Mosaik, Koordinaten und Rotation ins Projekt übernommen.'),
  ).toBeVisible();

  const project = await json<{
    mosaic: { cols: number; rows: number };
    panels: { label: string; lines: { plannedCount: number }[] }[];
  }>(page, `/api/web/v1/projects/${s.projectId}`);
  expect(project.mosaic).toMatchObject({ cols: 2, rows: 2 });
  expect(project.panels.map((p) => p.label)).toEqual(['Panel 1', 'Panel 2', 'Panel 3', 'Panel 4']);
  for (const p of project.panels) expect(p.lines.map((l) => l.plannedCount)).toEqual([40]);

  await page.goto(`/projekte/${s.projectId}`);
  const list = page.getByRole('region', { name: 'Panels' });
  await expect(list.getByRole('row')).toHaveCount(5);
  await expect(page.getByText('Mosaik 2 × 2 · 20 % Überlappung')).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('section').analyze();
  expect(
    axe.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => v.id),
  ).toEqual([]);

  await page.goto(`/nina/simulator?rig=${s.rigId}&nacht=${NIGHT}`);
  await expect(page.getByText(/^Plan-Hash sha256:/)).toBeVisible({ timeout: 30_000 });
  // Blöcke je Panel: das Planprotokoll nennt je Belichtung die Panel-Nummer (= NINA-Nummer).
  const rows = page.getByRole('row').filter({ hasText: 'Belichtung' }).filter({ hasText: s.name });
  await expect(rows.first()).toBeVisible();
  const panels = new Set<string>();
  for (const row of await rows.all())
    panels.add((await row.getByRole('cell').nth(3).textContent()) ?? '');
  expect([...panels].sort()).toEqual(['1', '2', '3', '4']);
});
