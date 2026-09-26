/**
 * S-80…S-82 (AP-07a, FA-SU-03…09, FA-MAN-01…03): Super User legt einen Mandanten an → Owner-Einladung →
 * Owner-Login; Löschen erst nach exakter Eingabe der Mandanten-ID; Wartungshinweis für alle.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { csrf, testLogin } from './support';

const OUTSIDER_DISCORD_ID = '100000000000000006';

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

const uniqueKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;

async function createTenant(page: Page, key: string, name: string, discordUserId?: string) {
  await page.goto('/system/mandanten');
  await page.getByLabel('Mandanten-ID').fill(key);
  await page.getByLabel('Name', { exact: true }).fill(name);
  if (discordUserId)
    await page
      .getByRole('region', { name: 'Mandant anlegen' })
      .getByLabel('An Discord-User-ID binden (optional)')
      .fill(discordUserId);
  await page.getByRole('button', { name: 'Anlegen und Owner-Einladung erzeugen' }).click();
  return (await page.getByTestId('invitation-link').first().textContent()) ?? '';
}

test('Super User legt Mandant an → Owner-Einladung → Owner-Login (Test-Login)', async ({
  browser,
}) => {
  const sys = await superUserPage(browser);
  const key = uniqueKey('e2e');
  const link = await createTenant(sys, key, 'E2E Sternwarte', OUTSIDER_DISCORD_ID);
  expect(link).toMatch(/\/einladung#[A-Za-z0-9_-]{43}$/);
  const row = sys.getByRole('row', { name: new RegExp(key) });
  await expect(row).toContainText('Owner ausstehend');

  // Eingeladene Person: Link öffnen (Vorschau), Einladung vormerken, anmelden → Owner im neuen Mandanten.
  const owner = await (await browser.newContext()).newPage();
  await owner.goto(new URL(link).pathname + new URL(link).hash);
  await expect(owner.getByText('E2E Sternwarte')).toBeVisible();
  const token = new URL(link).hash.slice(1);
  expect(
    (
      await owner.request.post('/api/auth/invitation/claim', { data: { token }, headers: csrf })
    ).ok(),
  ).toBe(true);
  await testLogin(owner, 'outsider');
  await owner.goto('/');
  await expect(owner.getByText(/^E2E Sternwarte · /)).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Benutzermenü' })).toContainText('(Owner)');

  await sys.reload();
  await expect(sys.getByRole('row', { name: new RegExp(key) })).toContainText('Otto Fremd');
});

test('Mandant löschen erst nach exakter Eingabe der Mandanten-ID (ConfirmDialog)', async ({
  browser,
}) => {
  const sys = await superUserPage(browser);
  const key = uniqueKey('weg');
  await createTenant(sys, key, 'Zum Löschen');
  await sys.getByRole('button', { name: key, exact: true }).click();
  await sys.getByRole('button', { name: 'Mandant löschen' }).click();
  const dialog = sys.getByRole('alertdialog', { name: 'Mandant „Zum Löschen“ löschen?' });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Mandant löschen' });
  await expect(confirm).toBeDisabled();
  const input = dialog.getByRole('textbox');
  await input.fill(key.toUpperCase());
  await expect(confirm).toBeDisabled();
  await input.fill(` ${key} `);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(sys.getByRole('button', { name: key, exact: true })).toHaveCount(0);
  // Im System-Audit steht der Vorgang.
  await sys.goto('/system/audit');
  await expect(
    sys
      .getByRole('row', { name: /Mandant gelöscht/ })
      .filter({ hasText: key })
      .first(),
  ).toBeVisible();
});

test('Wartungshinweis erscheint für alle, auch vor der Anmeldung', async ({ browser }) => {
  const sys = await superUserPage(browser);
  try {
    await sys.goto('/system/audit');
    await sys.getByLabel('Hinweis anzeigen').check();
    await sys.getByLabel('Text (Deutsch)').fill('Wartung heute ab 20 Uhr');
    await sys.getByLabel('Text (Englisch)').fill('Maintenance tonight from 8 pm');
    await sys.getByRole('button', { name: 'Speichern' }).click();
    await expect(sys.getByText('Gespeichert.')).toBeVisible();
    const anon = await (await browser.newContext()).newPage();
    await anon.goto('/');
    await expect(anon.getByRole('status', { name: 'Wartungshinweis' })).toHaveText(
      'Wartung heute ab 20 Uhr',
    );
  } finally {
    await sys.request.put('/api/system/v1/settings/maintenanceBanner', {
      data: { value: { active: false, textDe: '', textEn: '' } },
      headers: csrf,
    });
  }
});

test('System-Seiten nur im System-Kontext; Owner sieht den Hinweis permission.denied', async ({
  page,
}) => {
  await testLogin(page, 'owner');
  await page.goto('/system/mandanten');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mandanten' })).toHaveCount(0);
});

for (const width of [768, 2400]) {
  test(`System-Seiten bei ${width} px ohne horizontales Scrollen`, async ({ browser }) => {
    const sys = await superUserPage(browser);
    await sys.setViewportSize({ width, height: 900 });
    for (const path of ['/system/mandanten', '/system/super-user', '/system/audit']) {
      await sys.goto(path);
      await expect(sys.locator('#main h1')).toBeVisible();
      if (path === '/system/mandanten')
        await sys.getByRole('button', { name: 'demo', exact: true }).click();
      expect(
        await sys.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        path,
      ).toBe(true);
    }
  });
}
