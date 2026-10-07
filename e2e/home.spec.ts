/**
 * AP-26c/AP-26d: Startseite als Übersicht gegen den lokalen Stack – eigener Menüpunkt „Übersicht“ (27.09.2026),
 * Kopf mit Mandant, Kennzahlen, Karten Warteschlange, Aktive Projekte, Letzte Sessions mit ihren Links (keine
 * Karte „Wetter heute Nacht“ mehr); *Wetter (7 Tage)* direkt unter den Kennzahlen über die volle Breite
 * (Wunsch Sven 02.10.2026, gemessen); axe ohne serious/critical; 768 und 2400 px ohne horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { tableOverflow, testLogin } from './support';

const CARDS = ['Warteschlange', 'Aktive Projekte', 'Letzte Sessions'];

async function openHome(page: Page, fixture = 'owner') {
  await testLogin(page, fixture);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
  await expect(page.getByText(/^Demo-Sternfreunde · /)).toBeVisible();
}

test('Übersicht: Karten mit Links zu den Zielseiten; Neues Projekt; axe', async ({ page }) => {
  await openHome(page);
  for (const name of CARDS) await expect(page.getByRole('region', { name })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Wetter heute Nacht' })).toHaveCount(0);
  // Eigener Menüpunkt, aktiv auf der Startseite.
  const menu = page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Übersicht' });
  await expect(menu).toHaveAttribute('aria-current', 'page');
  const kpis = page.getByRole('list', { name: 'Kennzahlen' });
  await expect(kpis.getByRole('listitem')).toHaveCount(4);
  await expect(kpis).toContainText(/\d+ offen\s*\d+ ohne deine Stimme/);
  await expect(kpis).toContainText(/Integration \p{L}+/u);
  // Wetter (7 Tage) direkt unter den Kennzahlen, vor den Spalten, so breit wie die Kennzahlzeile.
  const weather = page.getByRole('region', { name: 'Wetter (7 Tage)' });
  await expect(weather).toBeVisible();
  const box = async (l: ReturnType<Page['locator']>) => {
    const b = await l.boundingBox();
    if (!b) throw new Error('nicht sichtbar');
    return b;
  };
  const [k, w, p] = [
    await box(kpis),
    await box(weather),
    await box(page.getByRole('region', { name: 'Aktive Projekte' })),
  ];
  expect(w.y).toBeGreaterThan(k.y + k.height);
  expect(p.y).toBeGreaterThan(w.y + w.height);
  expect(Math.abs(w.width - k.width)).toBeLessThanOrEqual(2);
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
  await expect(page).toHaveURL('/auswertung/naechte');
  // Über den Menüpunkt zurück zur Übersicht.
  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Übersicht' })
    .click();
  await expect(page).toHaveURL('/');
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
