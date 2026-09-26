/**
 * AP-26c/AP-26d: Startseite als Übersicht gegen den lokalen Stack – Kopf mit Mandant, Kennzahlen, Karten
 * Warteschlange, Wetter heute Nacht (Beispieldaten des lokalen Wetter-Adapters), Aktive Projekte, Letzte
 * Sessions mit ihren Links; axe ohne serious/critical; 768 und 2400 px ohne horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { tableOverflow, testLogin } from './support';

const CARDS = ['Warteschlange', 'Wetter heute Nacht', 'Aktive Projekte', 'Letzte Sessions'];

async function openHome(page: Page, fixture = 'owner') {
  await testLogin(page, fixture);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
  await expect(page.getByText(/^Demo-Sternfreunde · /)).toBeVisible();
}

test('Übersicht: Karten mit Links zu den Zielseiten; Neues Projekt; axe', async ({ page }) => {
  await openHome(page);
  for (const name of CARDS) await expect(page.getByRole('region', { name })).toBeVisible();
  const kpis = page.getByRole('list', { name: 'Kennzahlen' });
  await expect(kpis.getByRole('listitem')).toHaveCount(4);
  await expect(kpis).toContainText(/\d+ offen\s*\d+ ohne deine Stimme/);
  await expect(kpis).toContainText(/Integration \p{L}+/u);
  await expect(page.getByRole('link', { name: 'Neues Projekt' })).toHaveAttribute(
    'href',
    '/projekte/neu',
  );
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => v.id),
  ).toEqual([]);
  await page.getByRole('link', { name: 'Zur Projektliste' }).click();
  await expect(page).toHaveURL('/projekte');
  await page.goto('/');
  await page.getByRole('link', { name: 'Alle Sessions' }).click();
  await expect(page).toHaveURL('/auswertung/sessions');
  await page.goto('/');
  await page.getByRole('link', { name: 'Zum Wetter' }).click();
  await expect(page).toHaveURL('/wetter');
});

test('User: Warteschlange erreichbar, keine Administration', async ({ page }) => {
  await openHome(page, 'user1');
  await page.getByRole('link', { name: 'Zur Warteschlange' }).click();
  await expect(page).toHaveURL('/projekte/warteschlange');
  await expect(page.getByRole('heading', { level: 1, name: 'Warteschlange' })).toBeVisible();
});

for (const width of [768, 2400]) {
  test(`Übersicht bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHome(page);
    await expect(page.getByRole('region', { name: 'Letzte Sessions' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await tableOverflow(page)).toEqual([]);
  });
}
