/**
 * AP-23: Wettervorhersage S-50 mit den Beispieldaten des lokalen Adapters (drei nachgebildete Abrufe,
 * `apps/api/src/weather/sample.ts`): Grafik, Nachttabelle, Nachtdetail, meteoblue nur als Link; axe ohne
 * serious/critical; volle Breite ohne horizontales Scrollen bei 768 und 2400 px (NFA-01).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { testLogin } from './support';

async function openWeather(page: Page) {
  await testLogin(page, 'owner');
  await page.goto('/wetter');
  await expect(page.getByRole('heading', { name: 'Wettervorhersage', level: 1 })).toBeVisible();
  await expect(page.getByRole('img', { name: /Astro-Wetter über 7 Tage/ })).toBeVisible();
}

test('S-50: Grafik, Nächte, Nachtdetail; axe', async ({ page }) => {
  await openWeather(page);
  await expect(page.getByText(/Modelle icon-d2\+harmonie\+icon\+ecmwf\+gem\+cams/)).toBeVisible();
  const nights = page.getByRole('region', { name: 'Nächte' }).last();
  await expect(nights.getByRole('row')).not.toHaveCount(1);
  const second = nights.getByRole('button').nth(1);
  const label = (await second.textContent()) ?? '';
  await second.click();
  await expect(page.getByRole('heading', { name: new RegExp(`Nacht im Detail`) })).toBeVisible();
  expect(label).toMatch(/\d{2}\.\/\d{2}\.\d{2}\./);
  await expect(
    page.getByRole('link', { name: 'Wetterkarte bei meteoblue öffnen' }),
  ).toHaveAttribute('href', /^https:\/\/www\.meteoblue\.com\/de\/wetter\/maps\/51\.000N10\.000E$/);
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => v.id)).toEqual([]);
});

for (const width of [768, 2400]) {
  test(`S-50 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openWeather(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const figure = page.locator('figure').first();
    const fits = await figure.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
  });
}
