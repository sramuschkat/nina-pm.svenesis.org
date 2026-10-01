/**
 * AP-61: S-23 Rechner am Seed-Rig – Reiter in der Planung, Vorbelegung aus Rig und Filter, Belichtung mit
 * Effizienztabelle, Sampling je Binning, Exoplanet-Stern über die URL; Ausrüstung links und Reiter rechts ab
 * 1024 px, darunter untereinander; axe ohne ernste Verstöße; 768/2400 px ohne horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { WIDE, testLogin } from './support';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id);

test('S-23: Reiter Rechner, Belichtung, Sampling und Exoplanet-Stern', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await testLogin(page, 'user1');
  await page.goto('/planung/exoplaneten');
  await page.getByRole('link', { name: 'Rechner' }).click();
  await expect(page).toHaveURL(/\/planung\/rechner$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Rechner' })).toBeVisible();

  // Vorbelegung aus dem Seed-Rig: Öffnung und Pixelgröße gefüllt, kürzeste Einzelbelichtung gerechnet.
  await expect(page.getByLabel(/^Öffnung/)).not.toHaveValue('');
  await expect(page.getByLabel(/^Pixelgröße/)).not.toHaveValue('');
  await expect(page.getByText('Kürzeste Einzelbelichtung')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Effizienz je Belichtungszeit' })).toBeVisible();

  // Ausrüstung links, Ergebnisse rechts (gemessen, nicht nur die Spaltenvorlage).
  const left = await page.getByRole('region', { name: 'Ausrüstung' }).boundingBox();
  const right = await page.getByRole('region', { name: 'Ergebnisse' }).boundingBox();
  expect(left && right && left.x + left.width <= right.x).toBe(true);
  expect(await serious(page)).toEqual([]);

  await page.getByRole('tab', { name: 'Sampling' }).click();
  await expect(page).toHaveURL(/tab=sampling/);
  await expect(
    page.getByRole('table', { name: 'Sampling je Binning' }).getByRole('row'),
  ).toHaveCount(5);
  await expect(page.getByText('Empfohlenes Binning')).toBeVisible();

  // Aus S-22 (FA-EXO-14 Aktion *Rechner*): Werte des Transits im Reiter Exoplanet-Stern. Das Seed-Rig hat keinen
  // passenden Filter für die Empfehlung in S-22, der Rechner rechnet trotzdem (Katalogwerte, Filter L).
  await page.goto('/planung/exoplaneten?night=2026-10-06');
  await page.getByRole('button', { name: 'Weitere Angaben zu WASP-12b' }).click();
  await page
    .getByRole('region', { name: 'Belichtung – WASP-12' })
    .getByRole('link', { name: 'Im Rechner öffnen' })
    .click();
  await expect(page).toHaveURL(/\/planung\/rechner\?tab=exo&.*star=WASP-12/);
  await expect(page.getByText(/Werte aus der Transitsuche für WASP-12/)).toBeVisible();
  await expect(page.getByLabel(/^Transittiefe/)).not.toHaveValue('');
  await expect(page.getByRole('region', { name: 'Belichtung – WASP-12' })).toBeVisible();
  await expect(page.getByText('Transit-SNR')).toBeVisible();
  // Eingaben einer Reihe auf einer Linie, auch bei zweizeiliger Beschriftung (Wunsch Sven 01.10.2026).
  // Bei 1280 px brechen die Beschriftungen um.
  await page.setViewportSize({ width: 1280, height: 900 });
  const tops = await Promise.all(
    [/^Sternhelligkeit/, /^Transittiefe/, /^Transitdauer/].map(async (l) =>
      Math.round((await page.getByLabel(l).boundingBox())?.y ?? -1),
    ),
  );
  expect(new Set(tops).size, tops.join(',')).toBe(1);
  expect(await serious(page)).toEqual([]);
});

test('S-23 bei 768 und 2400 px ohne horizontales Scrollen; unter 1024 px untereinander', async ({
  page,
}) => {
  await testLogin(page, 'user1');
  for (const width of [768, 2400]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['exposure', 'sampling', 'exo']) {
      await page.goto(`/planung/rechner?tab=${tab}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Rechner' })).toBeVisible();
      await expect(page.getByLabel(/^Öffnung/)).not.toHaveValue('');
      expect(await overflow(page), `${String(width)} px, ${tab}`).toBeLessThanOrEqual(0);
    }
    const left = await page.getByRole('region', { name: 'Ausrüstung' }).boundingBox();
    const right = await page.getByRole('region', { name: 'Ergebnisse' }).boundingBox();
    if (width < 1024) expect(left && right && left.y + left.height <= right.y).toBe(true);
    else expect(left && right && left.x + left.width <= right.x).toBe(true);
  }
});
