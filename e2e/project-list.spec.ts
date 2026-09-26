/**
 * AP-11c: S-30 Projektliste gegen den lokalen Stack: Filter und Favorit; Löschen über den
 * `ConfirmDialog` → erscheint in „Gelöscht“ → Wiederherstellen → wieder in der Liste; User sieht die
 * Ansicht „Gelöscht“ nicht; axe; 768/2400 px.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { csrf, tableOverflow, testLogin } from './support';

async function createProject(page: Page, name: string, targetType: string): Promise<string> {
  const { items } = (await (await page.request.get('/api/web/v1/rigs')).json()) as {
    items: { id: string }[];
  };
  const id = crypto.randomUUID();
  const res = await page.request.post('/api/web/v1/projects', {
    headers: csrf,
    data: { id, name, rigId: items[0]?.id ?? null, targetType, raDeg: 13.2, decDeg: 56.6 },
  });
  expect(res.status()).toBe(201);
  return id;
}

test('S-30: Filter und Favorit', async ({ page }) => {
  await testLogin(page, 'owner');
  const stamp = String(Date.now());
  const galaxy = `E2E-Galaxie ${stamp}`;
  const nebula = `E2E-Nebel ${stamp}`;
  await createProject(page, galaxy, `Galaxie-${stamp}`);
  await createProject(page, nebula, `Nebel-${stamp}`);
  await page.goto('/projekte');
  await expect(page.getByRole('link', { name: galaxy })).toBeVisible();
  await expect(page.getByRole('link', { name: nebula })).toBeVisible();

  await page.getByLabel('Objekttyp').selectOption({ label: `Nebel-${stamp}` });
  await expect(page.getByRole('link', { name: galaxy })).toHaveCount(0);
  await expect(page.getByRole('link', { name: nebula })).toBeVisible();
  await page.getByLabel('Objekttyp').selectOption({ label: 'alle' });

  const star = page.getByRole('button', { name: `„${galaxy}“ als Favorit` });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('nur Favoriten').check();
  await expect(page.getByRole('link', { name: galaxy })).toBeVisible();
  await expect(page.getByRole('link', { name: nebula })).toHaveCount(0);
});

test('S-30: Löschen → Gelöscht → Wiederherstellen; User sieht „Gelöscht“ nicht', async ({
  page,
  browser,
}) => {
  await testLogin(page, 'owner');
  const name = `E2E-Papierkorb ${String(Date.now())}`;
  await createProject(page, name, 'Galaxie');
  await page.goto('/projekte');
  await page.getByRole('button', { name: `„${name}“ löschen` }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Papierkorb');
  await dialog.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('link', { name })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Gelöscht' }).click();
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText(/\d{2}:\d{2} (MESZ|MEZ|CEST|CET)/);
  await row.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Projekte' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();

  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  await user.goto('/projekte');
  await expect(user.getByRole('heading', { level: 1, name: 'Projekte' })).toBeVisible();
  await expect(user.getByRole('tab', { name: 'Gelöscht' })).toHaveCount(0);
  expect((await user.request.get('/api/web/v1/projects?deleted=true')).status()).toBe(403);
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-30 a11y ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await createProject(page, `E2E-a11y-Liste ${theme} ${String(Date.now())}`, 'Galaxie');
    await page.goto('/projekte');
    await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
    for (const view of ['Liste', 'Karten']) {
      await page.getByRole('radio', { name: view }).click();
      const result = await new AxeBuilder({ page }).analyze();
      const serious = result.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        serious.map(
          (v) => `${view}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
        ),
      ).toEqual([]);
    }
  });
}

for (const width of [768, 1280, 2400]) {
  test(`S-30 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await testLogin(page, 'owner');
    await createProject(page, `E2E-Breite-Liste ${String(width)} ${String(Date.now())}`, 'Galaxie');
    await page.goto('/projekte');
    await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
    for (const view of ['Liste', 'Karten', 'Detail']) {
      await page.getByRole('radio', { name: view }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, view).toBeLessThanOrEqual(0);
      expect(await tableOverflow(page), view).toEqual([]);
    }
  });
}
