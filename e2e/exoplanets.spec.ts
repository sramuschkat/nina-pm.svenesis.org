/**
 * AP-42: S-22 Exoplaneten – Transitsuche am Seed-Rig (Demo-Sternwarte, 51° N) in der Nacht 06./07.10.2026 mit
 * den Katalogauszügen, die der lokale Stack beim Start lädt (`apps/api/src/exo/samples`). Drei beobachtbare
 * ExoClock-Transits (TrES-3 b, WASP-12 b, Qatar-1 b); aufgeklappte Zeile mit Zeitleiste, Sternfeld, Himmelsposition
 * Belichtung und Zieldetails mit Hilfe-Tooltip; axe ohne ernste Verstöße; 768/2400 px ohne horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { WIDE, testLogin } from './support';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('S-22: Transits der Nacht, aufgeklappte Zeile mit Zeitleiste und Zieldetails', async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await testLogin(page, 'user1');
  await page.goto('/planung/exoplaneten?night=2026-10-06');
  await expect(page.getByRole('heading', { level: 1, name: 'Exoplaneten' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3 Transits' })).toBeVisible();
  await expect(page.getByText(/^Katalogstand: ExoClock/)).toBeVisible();
  const table = page.getByRole('table', { name: 'Exoplaneten' });
  for (const planet of ['TrES-3b', 'WASP-12b', 'Qatar-1b'])
    await expect(table.getByRole('row').filter({ hasText: planet })).toHaveCount(1);

  // Details inline: Zeile aufklappen (Wunsch Sven 30.09.2026)
  await table.getByRole('button', { name: 'Weitere Angaben zu WASP-12b' }).click();
  await expect(page.getByRole('region', { name: 'WASP-12b – Nacht und Transit' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sternfeld (DSS2) – WASP-12' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Himmelsposition von WASP-12' })).toBeVisible();
  await expect(page.getByText('Empfohlener Filter:')).toBeVisible();
  // Belichtung (FA-EXO-14a): Karte sichtbar; ohne passenden Filter nennt sie die fehlende Angabe
  await expect(page.getByRole('region', { name: 'Belichtung – WASP-12' })).toBeVisible();
  // Hilfe-Tooltip (FA-EXO-13): bei Maus sichtbar und im Fenster
  await page.getByRole('button', { name: 'Erklärung: Tiefe' }).hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  const box = await tip.boundingBox();
  expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= WIDE.width).toBe(true);
  await expect(page.getByRole('link', { name: 'In Framing öffnen' })).toHaveAttribute(
    'href',
    /\/planung\/sternkarte\?/,
  );

  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => v.id)).toEqual([]);
});

test('S-22 bei 768 und 2400 px ohne horizontales Scrollen', async ({ page }) => {
  await testLogin(page, 'user1');
  for (const width of [768, 2400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/planung/exoplaneten?night=2026-10-06');
    await expect(page.getByRole('heading', { name: '3 Transits' })).toBeVisible();
    await page.getByRole('button', { name: 'Weitere Angaben zu TrES-3b' }).click();
    await expect(page.getByRole('region', { name: 'TrES-3b – Nacht und Transit' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Belichtung – TrES-3' })).toBeVisible();
    expect(await overflow(page), `${String(width)} px`).toBeLessThanOrEqual(0);
  }
});

test('S-22 → Projekt (FA-EXO-15/17): anlegen, Reiter Exoplanet-Transit, erneut öffnen statt doppelt', async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await testLogin(page, 'user1');
  await page.goto('/planung/exoplaneten?night=2026-10-06');
  await expect(page.getByRole('heading', { name: '3 Transits' })).toBeVisible();
  const project = page.getByRole('button', {
    name: 'Exoplaneten-Projekt für Qatar-1b anlegen bzw. öffnen',
  });
  await project.click();
  await expect(page).toHaveURL(/\/projekte\/[0-9a-f-]{36}$/);
  const url = page.url();
  await expect(page.getByRole('tab', { name: 'Exoplanet-Transit' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Ephemeride' })).toContainText('Quelle ExoClock');
  await expect(page.getByRole('region', { name: 'Kommende beobachtbare Transits' })).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => v.id),
  ).toEqual([]);

  // Eindeutig je Planet, Rig und Ersteller (OP-22): derselbe Knopf öffnet dasselbe Projekt.
  await page.goto('/planung/exoplaneten?night=2026-10-06');
  await project.click();
  await expect(page).toHaveURL(url);

  for (const width of [768, 2400]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('region', { name: 'Ephemeride' })).toBeVisible();
    expect(await overflow(page), `${String(width)} px`).toBeLessThanOrEqual(0);
  }
});
