/**
 * AP-15: S-60/S-61 gegen den lokalen Stack – eine Fake-Plugin-Nacht auf einem eigenen Rig erscheint
 * vollständig in S-61, eine Aufnahme mit beiden Kennzeichen (Temperatur, Einstellungen) ist sichtbar;
 * axe hell/dunkel, 768/2400 px ohne horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { runFakeNight } from '../tools/fake-plugin/src/night';
import { WIDE, csrf, testLogin } from './support';

const json = async <T>(page: Page, url: string): Promise<T> => {
  const res = await page.request.get(url);
  expect(res.status(), url).toBe(200);
  return (await res.json()) as T;
};

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

/** Eigenes Rig mit freigegebenem Projekt, NINA-Instanz und einer Fake-Plugin-Nacht. */
async function nightOnOwnRig(admin: Page, user: Page, baseURL: string) {
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
  return { rigId, rigName, projectId, projectName: `E2E-Session-Projekt ${stamp}` };
}

test('S-60/S-61: Fake-Plugin-Nacht vollständig, Aufnahme mit beiden Kennzeichen sichtbar', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { rigId, rigName } = await nightOnOwnRig(admin, user, baseURL ?? '');

  await admin.goto('/auswertung/sessions');
  await expect(admin.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
  await admin.getByLabel('Rig', { exact: true }).selectOption(rigId);
  const rows = admin.getByRole('row').filter({ hasText: rigName });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('CDT');
  await rows.filter({ hasNotText: 'offline angelegt' }).getByRole('link').click();

  await expect(admin.getByRole('heading', { level: 1, name: new RegExp(rigName) })).toBeVisible();
  await expect(admin.getByText('1 Aufnahmen ohne Zuordnung')).toBeVisible();
  await admin.getByRole('tab', { name: 'Aufnahmen' }).click();
  await admin.getByLabel('Anzeigen').selectOption('deviations');
  const flagged = admin.getByRole('table', { name: 'Aufnahmen' }).getByRole('row').nth(1);
  await expect(flagged).toContainText('Temperaturabweichung');
  await expect(flagged).toContainText('Einstellungen abweichend');
  await expect(flagged).toContainText('330 s');
  await expectNoSerious(admin, 'S-61 Aufnahmen');

  // AF-06: Frames korrigieren (Regel max, Untergrenze = einzeln verworfen).
  await admin.getByRole('tab', { name: 'Soll/Ist' }).click();
  await admin.getByRole('button', { name: 'Korrektur', exact: true }).click();
  await admin.getByLabel('Verworfen').fill('1');
  await admin.getByLabel('Grund').selectOption('clouds');
  await admin.getByRole('button', { name: 'Korrektur speichern' }).click();
  await expect(admin.getByText('Korrektur gespeichert.')).toBeVisible();
  const row = admin.getByRole('table', { name: 'Soll/Ist' }).getByRole('row').nth(1);
  // Spalten: Projekt, Filter, Soll, Ist, Verworfen, Akzeptiert, …
  await expect(row.getByRole('cell').nth(4)).toHaveText('1');
  await expect(row.getByRole('cell').nth(5)).toHaveText('3');
});

test('AF-08: Projekt abschließen – verschwindet aus „An NINA ausgeliefert“, bleibt in der Projektliste', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { rigId, projectId, projectName } = await nightOnOwnRig(admin, user, baseURL ?? '');

  await admin.goto('/nina/ausgeliefert');
  await admin.getByLabel('Rig', { exact: true }).selectOption(rigId);
  await expect(admin.getByRole('article', { name: projectName })).toBeVisible();

  // Aktiv → Bereit zur Bearbeitung → Abgeschlossen (projectStatusTransitions).
  for (const status of ['ready_to_process', 'completed'])
    expect(
      (
        await admin.request.put(`/api/web/v1/projects/${projectId}/status`, {
          headers: csrf,
          data: { status },
        })
      ).status(),
    ).toBe(200);
  await admin.getByRole('button', { name: 'Aktualisieren' }).click();
  await expect(admin.getByRole('article', { name: projectName })).toHaveCount(0);
  await expect(admin.getByText('NINA erhält derzeit keine Ziele.')).toBeVisible();

  const listed = await admin.request.get(`/api/web/v1/projects?rigId=${rigId}`);
  const items = ((await listed.json()) as { items: { id: string; status: string }[] }).items;
  expect(items.find((p) => p.id === projectId)?.status).toBe('completed');
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-60 und S-61 ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await page.goto('/auswertung/sessions');
    await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expectNoSerious(page, `S-60 ${theme}`);
    const link = page.getByRole('link', { name: /\d\d\.\/\d\d\.\d\d\./ }).first();
    if ((await link.count()) > 0) {
      await link.click();
      await expect(page.getByRole('tab', { name: 'Soll/Ist' })).toBeVisible();
      await expectNoSerious(page, `S-61 ${theme}`);
    }
  });
}

for (const width of [768, 2400]) {
  test(`S-60 und S-61 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    await page.goto('/auswertung/sessions');
    await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow(), `S-60 @ ${String(width)}`).toBeLessThanOrEqual(0);
    const link = page.getByRole('link', { name: /\d\d\.\/\d\d\.\d\d\./ }).first();
    if ((await link.count()) > 0) {
      await link.click();
      await expect(page.getByRole('tab', { name: 'Soll/Ist' })).toBeVisible();
      expect(await overflow(), `S-61 @ ${String(width)}`).toBeLessThanOrEqual(0);
    }
  });
}
