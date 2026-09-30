/**
 * Projektansichten gegen den lokalen Stack (seit 30.09.2026; vorher AP-12b S-32 Meine Objekte und S-34
 * Entwürfe): Projektliste mit Schalter *Meine* und Status-Chips, *Einreichen* aus dem Zeilenmenü, Rangfolge
 * unter *Meine Rangfolge* in der Warteschlange und Zurückziehen; alte Adressen leiten weiter; Admin sieht
 * Entwürfe anderer über die Chips, User nicht; axe; 768/2400 px.
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

test('Meine Projekte: Einreichen aus dem Zeilenmenü, Rangfolge in der Warteschlange, Zurückziehen', async ({
  page,
}) => {
  await testLogin(page, 'user1');
  const stamp = String(Date.now());
  const first = `E2E-Rang-A ${stamp}`;
  const second = `E2E-Rang-B ${stamp}`;
  await completeProject(page, first);
  const secondId = await completeProject(page, second);

  // Alte Adresse „Meine Objekte“ → Projektliste mit Schalter *Meine*.
  await page.goto('/projekte/meine-objekte');
  await expect(page).toHaveURL(/\/projekte\?meine=1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Projekte' })).toBeVisible();
  await expect(
    page.getByRole('radiogroup', { name: 'Wessen Projekte' }).getByRole('radio', { name: 'Meine' }),
  ).toHaveAttribute('aria-checked', 'true');
  const chips = page.getByRole('group', { name: 'Status' });
  await chips.getByRole('button', { name: /^Entwurf/ }).click();
  await expect(page).toHaveURL(/status=draft/);
  await page.getByRole('button', { name: `Weitere Aktionen zu ${first}` }).click();
  await page.getByRole('menuitem', { name: 'Einreichen' }).click();
  const form = page.getByRole('form', { name: `„${first}“ einreichen` });
  await form.getByLabel('Begründung / Kommentar').fill('Gern im Oktober');
  await form.getByRole('button', { name: 'Einreichen' }).click();
  await expect(form).toHaveCount(0);
  await submitViaApi(page, secondId);

  await page.goto('/projekte/warteschlange');
  await page.getByRole('tab', { name: /^Meine Rangfolge/ }).click();
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
  await page.goto('/projekte?meine=1&status=draft');
  await expect(page.getByRole('link', { name: first })).toBeVisible();
});

test('Entwürfe: Admin sieht Entwürfe anderer über die Chips, User nicht', async ({
  page,
  browser,
}) => {
  await testLogin(page, 'user1');
  const name = `E2E-Entwurf ${String(Date.now())}`;
  await completeProject(page, name);
  await page.goto('/projekte');
  await expect(page.getByRole('link', { name: 'Entwürfe' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Meine Objekte' })).toHaveCount(0);

  const owner = await (await browser.newContext()).newPage();
  await testLogin(owner, 'owner');
  // Alte Adresse „Entwürfe“ → Chips *Entwurf* und *Zurückgegeben*.
  await owner.goto('/projekte/entwuerfe');
  await expect(owner).toHaveURL(/status=draft(%2C|,)returned/);
  const chips = owner.getByRole('group', { name: 'Status' });
  await expect(chips.getByRole('button', { name: /^Entwurf/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(owner.getByRole('row').filter({ hasText: name })).toBeVisible();
});

const PATHS = ['/projekte?meine=1', '/projekte?status=draft,returned&gruppe=status'];

for (const theme of ['light', 'dark'] as const) {
  test(`Projektansichten a11y ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await completeProject(page, `E2E-a11y-Mein ${theme} ${String(Date.now())}`);
    for (const path of PATHS) {
      await page.goto(path);
      await expect(page.getByRole('group', { name: 'Status' })).toBeVisible();
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
  test(`Projektansichten bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await testLogin(page, 'owner');
    await completeProject(page, `E2E-Breite-Mein ${String(width)} ${String(Date.now())}`);
    for (const path of PATHS) {
      await page.goto(path);
      await expect(page.getByRole('group', { name: 'Status' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}
