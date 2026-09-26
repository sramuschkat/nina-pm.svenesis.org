/**
 * AP-09b: Stammdaten-Bildschirme S-11…S-15 gegen den lokalen Stack (Seed aus seed-demo.json):
 * Kamera und Mondprofil anlegen, Löschen in Verwendung zeigt die Verwender, User liest nur,
 * 768/2400 px ohne horizontales Scrollen. AP-26b: Listen-/Detail-Muster (links Liste, rechts Detail,
 * *Neu* rechts im Seitenkopf; unter 1024 px untereinander). AP-26d: *Löschen* und *Speichern* im Kopf
 * der Detailkarte, auf Höhe des Titels.
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
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Neue Kamera' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Neu', exact: true })).toHaveCount(0);
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

test('AP-26b: Liste links, Detail rechts; Auswahl markiert; unter 1024 px untereinander', async ({
  page,
}) => {
  await testLogin(page, 'owner');
  await page.goto('/ausruestung/teleskope');
  await heading(page, 'Teleskope');
  const list = page.getByRole('region', { name: 'Teleskope' });
  const item = list.getByRole('button', { name: /^RASA 8/ });
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'true');
  const detail = page.getByRole('heading', { level: 2, name: 'RASA 8' });
  await expect(detail).toBeVisible();
  // 1280 px: Detail rechts neben der Liste.
  const listBox = await list.boundingBox();
  const detailBox = await detail.boundingBox();
  expect(detailBox?.x ?? 0).toBeGreaterThan((listBox?.x ?? 0) + (listBox?.width ?? 0) - 1);
  // Kartenkopf: Speichern und Löschen auf Höhe des Titels, über dem ersten Feld.
  for (const action of ['Speichern', 'Löschen']) {
    const box = await page.getByRole('button', { name: action, exact: true }).boundingBox();
    expect(Math.abs((box?.y ?? 0) - (detailBox?.y ?? 0)), action).toBeLessThan(24);
  }
  const nameBox = await page.getByLabel('Name', { exact: true }).boundingBox();
  expect(nameBox?.y ?? 0).toBeGreaterThan(detailBox?.y ?? 0);
  // Suche in der Liste.
  await list.getByRole('searchbox', { name: 'Teleskope durchsuchen' }).fill('rasa');
  await expect(list.getByRole('button', { name: /^Refraktor 80\/480/ })).toHaveCount(0);
  await list.getByRole('searchbox', { name: 'Teleskope durchsuchen' }).fill('');
  // *Neu* rechts im Seitenkopf öffnet das leere Formular; keine Zeile ist mehr markiert.
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Neues Teleskop' })).toBeVisible();
  await expect(list.locator('[aria-current="true"]')).toHaveCount(0);
  // 768 px: Liste über dem Detail.
  await page.setViewportSize({ width: 768, height: 900 });
  // Nach dem Größenwechsel warten, bis das Layout umgebrochen ist (sonst misst der Test den Zwischenstand).
  const newHeading = page.getByRole('heading', { level: 2, name: 'Neues Teleskop' });
  await expect
    .poll(async () => {
      const l = await list.boundingBox();
      const d = await newHeading.boundingBox();
      return (d?.y ?? 0) - ((l?.y ?? 0) + (l?.height ?? 0));
    })
    .toBeGreaterThan(-1);
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
