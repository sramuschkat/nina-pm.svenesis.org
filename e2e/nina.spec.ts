/**
 * AP-14c: S-42 NINA-Instanzen & Tokens und S-41 „An NINA ausgeliefert“ gegen den lokalen Stack – Token
 * genau einmal, Plugin-Aufruf mit dem Token erscheint in der Diagnose, Widerruf wirkt ab der nächsten
 * Anfrage (401), axe hell/dunkel, 768/2400 px ohne horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { testLogin } from './support';

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

test('S-42: Instanz anlegen, Token einmal, Diagnose, Widerruf wirkt sofort', async ({ page }) => {
  await testLogin(page, 'owner');
  await page.goto('/nina/instanzen');
  await expect(page.getByRole('heading', { name: 'NINA-Instanzen & Tokens' })).toBeVisible();
  const name = `E2E-PC ${String(Date.now())}`;
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Instanz anlegen' }).click();
  const token = (await page.getByTestId('nina-token').textContent()) ?? '';
  expect(token).toMatch(/^npm_[0-9A-Za-z]{43}$/);
  const auth = { authorization: `Bearer ${token}` };
  expect((await page.request.get('/api/nina/v1/bootstrap', { headers: auth })).status()).toBe(200);
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByText(token)).toHaveCount(0);

  await page.getByRole('button', { name, exact: true }).click();
  const detail = page.getByRole('region', { name });
  await expect(detail.getByText('GET /bootstrap')).toBeVisible();
  await detail.getByRole('button', { name: 'Widerrufen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Widerrufen' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const after = await page.request.get('/api/nina/v1/targets', { headers: auth });
  expect(after.status()).toBe(401);
  expect(((await after.json()) as { code: string }).code).toBe('nina.token_invalid');
});

test('User sieht den Reiter NINA-Instanzen nicht und erhält auf der Seite keinen Zugriff', async ({
  page,
}) => {
  await testLogin(page, 'user1');
  await page.goto('/nina/ausgeliefert');
  await expect(page.getByRole('heading', { name: 'An NINA ausgeliefert' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'NINA-Instanzen' })).toHaveCount(0);
  await page.goto('/nina/instanzen');
  await expect(page.getByRole('heading', { name: 'NINA-Instanzen & Tokens' })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-41 und S-42 ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await page.goto('/nina/ausgeliefert');
    await expect(page.getByRole('heading', { name: 'An NINA ausgeliefert' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expectNoSerious(page, `S-41 ${theme}`);
    await page.goto('/nina/instanzen');
    await expect(page.getByRole('heading', { name: 'NINA-Instanzen & Tokens' })).toBeVisible();
    await expectNoSerious(page, `S-42 ${theme}`);
  });
}

for (const width of [768, 2400]) {
  test(`S-41 und S-42 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    for (const [path, heading] of [
      ['/nina/ausgeliefert', 'An NINA ausgeliefert'],
      ['/nina/instanzen', 'NINA-Instanzen & Tokens'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} @ ${String(width)}`).toBeLessThanOrEqual(0);
    }
  });
}

test('NINA › Hilfe: Sequencer – für jedes Mitglied, Verzeichnis springt, axe hell/dunkel', async ({
  page,
}) => {
  await testLogin(page, 'user1');
  await page.goto('/nina/hilfe');
  await expect(
    page.getByRole('heading', { name: 'Hilfe: NINA-PM im Advanced Sequencer' }),
  ).toBeVisible();
  const toc = page.getByRole('navigation', { name: 'Inhalt' });
  await toc.getByRole('link', { name: 'NINA-PM Wait for Time' }).click();
  await expect(page).toHaveURL(/#wait-for-time$/);
  await expect(
    page.getByRole('heading', { name: 'NINA-PM Wait for Time', level: 3 }),
  ).toBeInViewport();
  await expect(
    page.getByRole('table', { name: 'Einstellungen: NINA-PM Wait for Time' }),
  ).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => window.localStorage.setItem('npm.theme', t), theme);
    await page.reload();
    await expectNoSerious(page, `Sequencer-Hilfe ${theme}`);
  }
});

for (const width of [768, 2400]) {
  test(`NINA › Hilfe: Sequencer bei ${width} px ohne horizontales Scrollen`, async ({ page }) => {
    await testLogin(page, 'owner');
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/nina/hilfe');
    await expect(page.getByRole('navigation', { name: 'Inhalt' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    // Verzeichnis links neben dem Text (breit) bzw. darüber (schmal) – echte Lage, nicht die Spaltenvorlage.
    const toc = await page.getByRole('navigation', { name: 'Inhalt' }).boundingBox();
    const intro = await page.getByText('NINA-PM bringt eigene Bausteine').boundingBox();
    if (!toc || !intro) throw new Error('Lage nicht messbar');
    if (width >= 1100) expect(toc.x + toc.width).toBeLessThanOrEqual(intro.x);
    else expect(toc.y + toc.height).toBeLessThanOrEqual(intro.y);
  });
}
