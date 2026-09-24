/**
 * AP-11b: S-31 Projekt-Editor gegen den lokalen Stack (Seed aus seed-demo.json): Projekt anlegen,
 * Zeile per Schnelleingabe ergänzen, Kopf ändern und mit `If-Match` speichern; 412 bei parallelem
 * Speichern; Nachtdiagramm-Vorschau; User sieht ein fremdes Projekt nicht bearbeitbar; axe in beiden
 * Themes; 768/2400 px ohne horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { csrf, testLogin } from './support';

async function createViaEditor(page: Page, name: string): Promise<string> {
  await page.goto('/projekte');
  await page.getByRole('link', { name: 'Neues Projekt' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Neues Projekt' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Zielname').fill('NGC 281');
  await page.getByLabel('Rektaszension (J2000)').fill('00 52 49');
  await page.getByLabel('Deklination (J2000)').fill('+56 37 48');
  await page.getByLabel('Deklination (J2000)').blur();
  const rig = page.getByRole('combobox', { name: 'Rig' });
  await rig.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option').first().click();
  await expect(rig).not.toHaveText('Rig wählen');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.waitForURL(/\/projekte\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop() ?? '';
}

test('S-31: Projekt anlegen, Zeile ergänzen, speichern (If-Match)', async ({ page }) => {
  await testLogin(page, 'owner');
  const name = `E2E-Projekt ${String(Date.now())}`;
  const id = await createViaEditor(page, name);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);

  // Nachtdiagramm-Vorschau mit dem Ziel (Standort des Rigs)
  await expect(page.getByRole('img', { name: /Nachtdiagramm/ })).toBeVisible();

  // Schnelleingabe: Ha, 300 s, 2 Stunden → 24 Aufnahmen
  const quick = page.getByRole('group', { name: 'Schnelleingabe' });
  await quick.getByRole('combobox', { name: 'Filter' }).selectOption({ label: 'Ha' });
  await quick.getByRole('spinbutton', { name: 'Belichtung (s)' }).fill('300');
  await quick.getByRole('radio', { name: 'Stunden' }).check();
  await quick.getByRole('spinbutton', { name: 'Stunden' }).fill('2');
  await expect(quick.getByText('= 24 Aufnahmen')).toBeVisible();
  await quick.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByLabel('Geplante Aufnahmen der Zeile Ha')).toHaveValue('24');
  await expect(page.getByLabel('Summen des Panels')).toContainText('Geplant 24 Frames / 2,0 h');

  // Kopf ändern und speichern: PATCH mit If-Match der aktuellen Version
  const current = (await (await page.request.get(`/api/web/v1/projects/${id}`)).json()) as {
    version: number;
  };
  await page.getByRole('tab', { name: 'Bedingungen' }).click();
  await page.getByLabel('Mindesthöhe (°)').fill('35');
  await expect(page.getByText('Ungespeicherte Änderungen')).toBeVisible();
  const patch = page.waitForRequest(
    (r) => r.method() === 'PATCH' && r.url().endsWith(`/api/web/v1/projects/${id}`),
  );
  await page.getByRole('button', { name: 'Speichern' }).click();
  const request = await patch;
  expect(request.headers()['if-match']).toBe(`"${String(current.version)}"`);
  expect(request.postDataJSON()).toEqual({ conditions: { minAltitudeDeg: 35 } });
  await expect(page.getByText('Ungespeicherte Änderungen')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled();

  // Parallel geändert → 412 mit „Neu laden“
  const fresh = (await (await page.request.get(`/api/web/v1/projects/${id}`)).json()) as {
    version: number;
  };
  const other = await page.request.patch(`/api/web/v1/projects/${id}`, {
    data: { catalogNames: 'Sh2-184' },
    headers: { ...csrf, 'If-Match': `"${String(fresh.version)}"` },
  });
  expect(other.status()).toBe(200);
  await page.getByLabel('Mindesthöhe (°)').fill('40');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'inzwischen geändert' })).toBeVisible();
  await page.getByRole('button', { name: 'Neu laden' }).click();
  await expect(page.getByLabel('Mindesthöhe (°)')).toHaveValue('35');
  await page.getByRole('tab', { name: 'Zielinformationen' }).click();
  await expect(page.getByLabel('Katalognamen')).toHaveValue('Sh2-184');
  // Oberer Bereich als Reiter: die übrigen Felder sind verdeckt, nicht entfernt.
  await expect(page.getByLabel('Mindesthöhe (°)')).toBeHidden();
});

test('S-31: User öffnet einen fremden Entwurf nicht (FA-BER-02), keine Bearbeitung', async ({
  browser,
}) => {
  const owner = await (await browser.newContext()).newPage();
  await testLogin(owner, 'owner');
  const id = await createViaEditor(owner, `E2E-Lesend ${String(Date.now())}`);
  // Entwürfe anderer sind für User unsichtbar (FA-BER-02) – ohne Freigabe (AP-12a) bleibt 404.
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  await user.goto(`/projekte/${id}`);
  await expect(user.getByRole('alert')).toBeVisible();
  await expect(user.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-31 a11y ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await createViaEditor(page, `E2E-a11y ${theme} ${String(Date.now())}`);
    await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
    const result = await new AxeBuilder({ page }).analyze();
    const serious = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
    ).toEqual([]);
  });
}

for (const width of [768, 2400]) {
  test(`S-31 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await testLogin(page, 'owner');
    await createViaEditor(page, `E2E-Breite ${String(width)} ${String(Date.now())}`);
    await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
