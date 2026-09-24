/**
 * AP-09b: Stammdaten-Bildschirme S-11…S-15 gegen den lokalen Stack (Seed aus seed-demo.json):
 * Kamera und Mondprofil anlegen, Löschen in Verwendung zeigt die Verwender, User liest nur,
 * 768/2400 px ohne horizontales Scrollen.
 */
import { expect, test, type Page } from '@playwright/test';
import { testLogin } from './support';

const PAGES = [
  ['/ausruestung/standorte', 'Standorte'],
  ['/ausruestung/teleskope', 'Teleskope'],
  ['/ausruestung/kameras', 'Kameras'],
  ['/ausruestung/filter', 'Filter & Belichtungsplan-Vorlagen'],
  ['/ausruestung/mondprofile', 'Mondprofile'],
] as const;

async function heading(page: Page, name: string) {
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

test('S-13: Admin legt eine Kamera an; berechnete Werte erscheinen', async ({ page }) => {
  await testLogin(page, 'owner');
  await page.goto('/ausruestung/kameras');
  await heading(page, 'Kameras');
  await page.getByRole('button', { name: 'Neu' }).click();
  const name = `E2E-Kamera ${String(Date.now())}`;
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Breite (px)').fill('6248');
  await page.getByLabel('Höhe (px)').fill('4176');
  await page.getByLabel('Pixelgröße (µm)').fill('3.76');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText('23,49 × 15,70 mm')).toBeVisible();
});

test('S-15: Mondprofil klonen, minAlt ≥ maxAlt abweisen, dann speichern', async ({ page }) => {
  await testLogin(page, 'owner');
  await page.goto('/ausruestung/mondprofile');
  await heading(page, 'Mondprofile');
  await page.getByRole('button', { name: /^Streng/ }).click();
  await expect(page.getByLabel('Abstand bei Vollmond (°)')).toBeDisabled();
  await page.getByRole('button', { name: 'Klonen' }).click();
  const name = `E2E-Mond ${String(Date.now())}`;
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Min-Höhe Mond (°)').fill('10');
  await expect(page.getByText('Min-Höhe muss unter der Max-Höhe liegen.')).toBeVisible();
  await page.getByLabel('Min-Höhe Mond (°)').fill('-10');
  await page.getByLabel('Relax (°/°)').fill('1.5');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();
  await expect(page.getByRole('button', { name })).toBeVisible();
});

test('FA-RIG-13: Kamera eines Rigs löschen → ConfirmDialog, dann Verwenderliste', async ({
  page,
}) => {
  await testLogin(page, 'owner');
  await page.goto('/ausruestung/kameras');
  await page.getByRole('button', { name: /^Mono 26MP \(IMX571\)/ }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  const dialog = page.getByRole('alertdialog', { name: '„Mono 26MP (IMX571)“ löschen?' });
  await dialog.getByRole('button', { name: 'Löschen' }).click();
  const notice = page.getByRole('alert').filter({ hasText: 'wird noch verwendet' });
  await expect(notice).toContainText('Rig: Rig A – Refraktor mono mit Rotator');
  await expect(dialog).toHaveCount(0);
  // Die Kamera bleibt erhalten.
  await expect(page.getByRole('button', { name: /^Mono 26MP \(IMX571\)/ })).toBeVisible();
});

test('User sieht die Stammdaten nur lesend; die API lehnt Schreiben ab', async ({ page }) => {
  await testLogin(page, 'user1');
  await page.goto('/ausruestung/teleskope');
  await heading(page, 'Teleskope');
  await expect(page.getByRole('note')).toContainText('Nur lesend');
  await expect(page.getByRole('button', { name: 'Neu' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
  await expect(page.getByLabel('Öffnung (mm)')).toBeDisabled();
  const res = await page.request.post('/api/web/v1/telescopes', {
    data: {
      id: crypto.randomUUID(),
      name: 'verboten',
      opticalDesign: 'rc',
      apertureMm: 100,
      focalLengthMm: 800,
    },
    headers: { 'X-NPM-Request': '1' },
  });
  expect(res.status()).toBe(403);
});

for (const width of [768, 2400]) {
  test(`S-11…S-15 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    for (const [path, title] of PAGES) {
      await page.goto(path);
      await heading(page, title);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}
