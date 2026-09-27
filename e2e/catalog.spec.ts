/**
 * AP-20: S-21 Objektbrowser (Suche, Nachtwerte am Rig, Galerie), *Projekt anlegen* → Editor mit
 * Katalogobjekt, Katalogsuche im Editor, S-82 Kataloge (Stand, *Neu importieren*); axe hell/dunkel,
 * 768/2400 px ohne horizontales Scrollen. Der lokale Stack importiert den Katalog beim Start.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { WIDE, csrf, testLogin } from './support';

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('S-21: Suche, Nachtwerte am Rig, Projekt anlegen übernimmt das Katalogobjekt', async ({
  page,
}) => {
  // Breit genug für alle Spalten: mit Rig stehen Bewertung und Filterempfehlung immer in der Tabelle (eine
  // Tabelle seit 27.09.2026); schmaler blendet die Tabelle „Typ“ nach Priorität aus.
  await page.setViewportSize(WIDE);
  await testLogin(page, 'user1');
  await page.goto('/planung/objekte');
  await expect(page.getByRole('heading', { level: 1, name: 'Objektbrowser' })).toBeVisible();
  await page.getByLabel('Suche', { exact: true }).fill('Andromeda');
  const row = page.getByRole('row').filter({ hasText: 'Andromeda Galaxy' }).first();
  await expect(row).toContainText('M 31');
  await expect(row).toContainText('Galaxie');
  await expect(row.getByTitle('Band V (OpenNGC)')).toBeVisible();
  // Das Seed-Rig liefert die Nachtwerte (Standortzeit mit Kürzel).
  await expect(page.getByRole('columnheader', { name: 'Nutzbar' })).toBeVisible();
  await expect(page.getByText(/^Dunkel .* · Mond \d+ % beleuchtet$/)).toBeVisible();
  await expect(page.getByText(/OpenNGC v20260501 \(CC BY-SA 4\.0\)/)).toBeVisible();

  await row.getByRole('link', { name: 'Projekt anlegen' }).click();
  await page.waitForURL(/\/projekte\/neu\?objekt=NGC\+224/);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('M 31 – Andromeda Galaxy');
  await expect(page.getByLabel('Zielname')).toHaveValue('M 31');
  await expect(page.getByText('Verknüpft mit M 31 aus dem Objektkatalog.')).toBeVisible();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.waitForURL(/\/projekte\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop() ?? '';
  const project = (await (await page.request.get(`/api/web/v1/projects/${id}`)).json()) as {
    dsoObjectId: string | null;
    catalogNames: string;
    raDeg: number;
  };
  expect(project.dsoObjectId).not.toBeNull();
  expect(project.catalogNames).toContain('NGC 224');
  expect(project.raDeg).toBeCloseTo(10.6848, 3);
});

test('Katalogsuche im Editor füllt Name, Koordinaten und Typ', async ({ page }) => {
  await testLogin(page, 'user1');
  await page.goto('/projekte/neu');
  const box = page.getByRole('combobox', { name: 'Katalogsuche' });
  await box.fill('m57');
  await page.getByRole('option', { name: /^M 57/ }).click();
  await expect(page.getByLabel('Zielname')).toHaveValue('M 57');
  await expect(page.getByLabel('Objekttyp')).toHaveValue('Planetarischer Nebel');
  await expect(page.getByLabel('Rektaszension (J2000)')).not.toHaveValue('');
  await expectNoSerious(page, 'S-31 Katalogsuche');
});

test('S-21 Galerie und Filter nach Anzeigegruppe', async ({ page }) => {
  await testLogin(page, 'user1');
  await page.goto('/planung/objekte?typ=planetary_nebula&katalog=M&ansicht=galerie');
  await expect(page.getByRole('heading', { name: '4 Treffer' })).toBeVisible();
  await expect(page.getByText('M 57')).toBeVisible();
  await expectNoSerious(page, 'S-21 Galerie');
});

async function superUserPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await testLogin(page, 'superuser');
  const res = await page.request.post('/api/auth/context', {
    data: { system: true },
    headers: csrf,
  });
  expect(res.ok()).toBe(true);
  return page;
}

test('S-82: Stand des Objektkatalogs und Neu importieren', async ({ browser }) => {
  const page = await superUserPage(browser);
  await page.goto('/system/audit');
  const panel = page.getByRole('region', { name: 'Kataloge' });
  await expect(panel.getByText('v20260501')).toBeVisible();
  await expect(panel.getByText('13.969 aus NGC.csv + 64 aus addendum.csv')).toBeVisible();
  await expect(panel.getByText('entspricht der Katalogdatei')).toBeVisible();
  await panel.getByRole('button', { name: 'Neu importieren' }).click();
  await expect(panel.getByText(/Import gestartet/)).toBeVisible();
  await expect(panel.getByText('fertig')).toBeVisible({ timeout: 30_000 });
  await expectNoSerious(page, 'S-82');
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-21 ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await page.goto('/planung/objekte?katalog=M');
    await expect(page.getByRole('heading', { name: /\d+ Treffer/ })).toBeVisible();
    await expectNoSerious(page, `S-21 ${theme}`);
  });
}

for (const width of [768, 2400]) {
  test(`S-21 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    await page.goto('/planung/objekte?katalog=M');
    await expect(page.getByRole('heading', { name: /\d+ Treffer/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Nutzbar' })).toBeVisible();
    expect(await overflow(page), `Liste @ ${String(width)}`).toBeLessThanOrEqual(0);
    // Die Ansicht steht in der URL; der Umschalter folgt nach der Navigation.
    await page.getByLabel('Galerie').click();
    await expect(page.getByLabel('Galerie')).toBeChecked();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Projekt anlegen' }).first(),
    ).toBeVisible();
    expect(await overflow(page), `Galerie @ ${String(width)}`).toBeLessThanOrEqual(0);
  });
}

test('Planung öffnet den Objektbrowser; Mond und Dunkelheit, Datumswahl mit Mondkalender (768 px)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await testLogin(page, 'owner');
  await page.goto('/planung');
  await expect(page).toHaveURL(/\/planung\/objekte/);
  const tabs = page.getByRole('navigation', { name: /Planung/ }).getByRole('link');
  await expect(tabs.first()).toHaveText('Objektbrowser');
  await expect(page.getByRole('button', { name: 'Mond und Dunkelheit' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Mond und Dunkelheit der Nacht/ })).toBeVisible();
  // Nur der eigene Mondkalender, kein Datumsfeld des Browsers.
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  const date = page.getByRole('button', { name: /^Nacht ab dem Abend des/ });
  const before = await date.textContent();
  await date.click();
  const dialog = page.getByRole('dialog', { name: /Mondkalender/ });
  await expect(
    dialog.getByRole('button', { name: /Nacht \d\d\.\/\d\d\.\d\d\.:/ }).first(),
  ).toBeVisible();
  expect(await overflow(page), 'Kalender @ 768').toBeLessThanOrEqual(0);
  await expectNoSerious(page, 'Mondkalender');
  await dialog.getByRole('button', { name: /Nacht 15\./ }).click();
  await expect(dialog).toBeHidden();
  await expect(date).not.toHaveText(before ?? '');
  await expect(date).toHaveText(/15\.\d\d\.\d{4}/);
});
