/**
 * AP-12b: S-32 Meine Objekte und S-34 Entwürfe gegen den lokalen Stack: User reicht ein (Formular mit
 * Wunschangaben), ordnet die Rangfolge und zieht zurück; Admin sieht Entwürfe, User nicht; axe; 768/2400 px.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { csrf, testLogin } from './support';

async function completeProject(page: Page, name: string): Promise<string> {
  const rigs = (await (await page.request.get('/api/web/v1/rigs')).json()) as {
    items: { id: string }[];
  };
  const filters = (await (await page.request.get('/api/web/v1/filters')).json()) as {
    items: { id: string; shortName: string }[];
  };
  const id = crypto.randomUUID();
  const res = await page.request.post('/api/web/v1/projects', {
    headers: csrf,
    data: { id, name, rigId: rigs.items[0]?.id, raDeg: 13.2, decDeg: 56.6 },
  });
  expect(res.status()).toBe(201);
  const panel = ((await res.json()) as { panels: { id: string }[] }).panels[0]?.id;
  const line = await page.request.post(`/api/web/v1/projects/${id}/lines`, {
    headers: csrf,
    data: {
      id: crypto.randomUUID(),
      panelId: panel,
      filterId: filters.items.find((f) => f.shortName === 'Ha')?.id,
      exposureS: 300,
      plannedCount: 20,
      moonMode: 'none',
    },
  });
  expect(line.status()).toBe(201);
  return id;
}

async function submitViaApi(page: Page, id: string) {
  const res = await page.request.post(`/api/web/v1/projects/${id}/submit`, {
    headers: csrf,
    data: {},
  });
  expect(res.status()).toBe(200);
}

test('S-32: User reicht ein, ordnet die Rangfolge und zieht zurück', async ({ page }) => {
  await testLogin(page, 'user1');
  const stamp = String(Date.now());
  const first = `E2E-Rang-A ${stamp}`;
  const second = `E2E-Rang-B ${stamp}`;
  await completeProject(page, first);
  const secondId = await completeProject(page, second);

  await page.goto('/projekte/meine-objekte');
  await expect(page.getByRole('heading', { level: 1, name: 'Meine Objekte' })).toBeVisible();
  await page.getByRole('tab', { name: /^Entwurf/ }).click();
  const card = page.getByRole('article', { name: first });
  await card.getByRole('button', { name: 'Einreichen' }).click();
  const form = page.getByRole('form', { name: `„${first}“ einreichen` });
  await form.getByLabel('Begründung / Kommentar').fill('Gern im Oktober');
  await form.getByRole('button', { name: 'Einreichen' }).click();
  await expect(card).toHaveCount(0);
  await submitViaApi(page, secondId);

  await page.reload();
  await page.getByRole('tab', { name: /^Eingereicht/ }).click();
  const list = page.getByRole('list', { name: 'Rangfolge deiner eingereichten Objekte' });
  const mine = list.getByRole('listitem').filter({ hasText: stamp });
  await expect(mine).toHaveText([new RegExp(first), new RegExp(second)]);
  const ranking = page.waitForRequest(
    (r) => r.method() === 'PUT' && r.url().endsWith('/api/web/v1/me/submission-ranking'),
  );
  await page.getByRole('button', { name: `„${second}“ nach oben` }).click();
  expect((await ranking).postDataJSON()).toMatchObject({
    items: expect.arrayContaining([{ kind: 'project', id: secondId }]) as unknown,
  });
  await expect(mine.first()).toContainText(second);

  await mine.filter({ hasText: first }).getByRole('button', { name: 'Zurückziehen' }).click();
  await expect(list.getByRole('listitem').filter({ hasText: first })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Entwurf/ }).click();
  await expect(page.getByRole('article', { name: first })).toBeVisible();
});

test('S-34: Admin sieht Entwürfe anderer, User nicht', async ({ page, browser }) => {
  await testLogin(page, 'user1');
  const name = `E2E-Entwurf ${String(Date.now())}`;
  await completeProject(page, name);
  await page.goto('/projekte');
  await expect(page.getByRole('link', { name: 'Entwürfe' })).toHaveCount(0);

  const owner = await (await browser.newContext()).newPage();
  await testLogin(owner, 'owner');
  await owner.goto('/projekte/entwuerfe');
  await expect(owner.getByRole('heading', { level: 1, name: 'Entwürfe' })).toBeVisible();
  await expect(owner.getByRole('row').filter({ hasText: name })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-32/S-34 a11y ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    const id = await completeProject(page, `E2E-a11y-Mein ${theme} ${String(Date.now())}`);
    await submitViaApi(page, id);
    for (const path of ['/projekte/meine-objekte', '/projekte/entwuerfe']) {
      await page.goto(path);
      await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
      const result = await new AxeBuilder({ page }).analyze();
      const serious = result.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        serious.map(
          (v) => `${path}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
        ),
      ).toEqual([]);
    }
  });
}

for (const width of [768, 2400]) {
  test(`S-32/S-34 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await testLogin(page, 'owner');
    const id = await completeProject(
      page,
      `E2E-Breite-Mein ${String(width)} ${String(Date.now())}`,
    );
    await submitViaApi(page, id);
    for (const path of ['/projekte/meine-objekte', '/projekte/entwuerfe']) {
      await page.goto(path);
      await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}
