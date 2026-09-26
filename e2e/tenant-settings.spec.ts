/**
 * AP-07c: Owner übertragen (S-70, FA-BEN-09), Mandanteneinstellungen (S-71), Änderungsprotokoll (S-72),
 * persönliche Einstellungen und Anmeldesitzungen (S-73).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { csrf, testLogin } from './support';

async function pageAs(browser: Browser, fixture: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await testLogin(page, fixture);
  return page;
}

async function memberId(page: Page, displayName: string): Promise<string> {
  const { members } = (await (await page.request.get('/api/web/v1/members')).json()) as {
    members: { id: string; displayName: string }[];
  };
  const m = members.find((x) => x.displayName === displayName);
  if (!m) throw new Error(`${displayName} fehlt`);
  return m.id;
}

test('Owner überträgt nach ConfirmDialog an einen Admin → sofort Owner, alter Owner bleibt Admin', async ({
  browser,
}) => {
  const owner = await pageAs(browser, 'owner');
  const admin = await pageAs(browser, 'admin');
  const olivia = await memberId(owner, 'Olivia Owner');
  await owner.goto('/verwaltung/mitglieder');
  // AP-26b: Owner übertragen als Dialog aus dem Seitenkopf, Bestätigung weiterhin per ConfirmDialog.
  await owner.getByRole('button', { name: 'Owner übertragen' }).click();
  const form = owner.getByRole('dialog', { name: 'Owner übertragen' });
  await form.getByLabel('Neuer Owner').selectOption({ label: 'Anton Admin' });
  await form.getByRole('button', { name: 'Owner übertragen' }).click();
  const dialog = owner.getByRole('alertdialog', {
    name: 'Owner-Rolle an „Anton Admin“ übertragen?',
  });
  await expect(dialog).toContainText('Du bleibst Admin.');
  await dialog.getByRole('button', { name: 'Owner übertragen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(form).toHaveCount(0);
  try {
    await expect(owner.getByRole('button', { name: 'Benutzermenü' })).toContainText('(Admin)');
    await expect(owner.getByRole('button', { name: 'Owner übertragen' })).toHaveCount(0);
    await admin.goto('/');
    await expect(admin.getByRole('button', { name: 'Benutzermenü' })).toContainText('(Owner)');
  } finally {
    const back = await admin.request.post('/api/web/v1/tenant/owner-transfer', {
      data: { memberId: olivia },
      headers: csrf,
    });
    expect(back.status()).toBe(204);
  }
});

test('„Owner übertragen“ ist für Admins nicht sichtbar; die API lehnt mit 403 ab', async ({
  browser,
}) => {
  const admin = await pageAs(browser, 'admin');
  await admin.goto('/verwaltung/mitglieder');
  await expect(admin.getByRole('tab', { name: 'Mitglieder', exact: true })).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Einladen', exact: true })).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Owner übertragen' })).toHaveCount(0);
  const self = await memberId(admin, 'Anton Admin');
  const res = await admin.request.post('/api/web/v1/tenant/owner-transfer', {
    data: { memberId: self },
    headers: csrf,
  });
  expect(res.status()).toBe(403);
});

test('S-71: Einstellung speichern wirkt auf die Mandantenzeit; unbekannter Schlüssel → 422', async ({
  browser,
}) => {
  const owner = await pageAs(browser, 'owner');
  await owner.goto('/verwaltung/einstellungen');
  await expect(owner.getByText('Sitzungsdauer und Discord-2FA')).toBeVisible();
  const tz = owner.getByLabel('Zeitzone des Mandanten');
  await tz.fill('America/Chicago');
  await owner.getByRole('button', { name: 'Speichern' }).click();
  await expect(owner.getByText('Gespeichert.')).toBeVisible();
  try {
    const me = (await (await owner.request.get('/api/auth/me')).json()) as {
      tenant: { timeZone: string };
    };
    expect(me.tenant.timeZone).toBe('America/Chicago');
    const bad = await owner.request.patch('/api/web/v1/tenant/settings', {
      data: { settings: { sessionMaxDays: 30 } },
      headers: csrf,
    });
    expect(bad.status()).toBe(422);
    expect(await bad.json()).toMatchObject({ code: 'validation.failed' });
    await owner.goto('/verwaltung/protokoll');
    await expect(
      owner.getByRole('row', { name: /Zeitzone des Mandanten: Europe\/Berlin → America\/Chicago/ }),
    ).toBeVisible();
  } finally {
    await owner.request.patch('/api/web/v1/tenant/settings', {
      data: { settings: { tenantTimezone: 'Europe/Berlin' } },
      headers: csrf,
    });
  }
});

test('S-73: Überall abmelden → ein zweiter Tab erhält bei der nächsten Anfrage 401', async ({
  context,
}) => {
  const a = await context.newPage();
  await testLogin(a, 'user2');
  const b = await context.newPage();
  await a.goto('/einstellungen');
  await expect(a.getByRole('heading', { name: 'Meine Anmeldesitzungen' })).toBeVisible();
  await expect(a.getByText('diese Sitzung')).toBeVisible();
  await a.getByRole('button', { name: 'Überall abmelden' }).click();
  await a
    .getByRole('alertdialog', { name: 'Überall abmelden?' })
    .getByRole('button', { name: 'Sitzungen beenden' })
    .click();
  await expect(a.getByRole('link', { name: 'Mit Discord anmelden' })).toBeVisible();
  const res = await b.request.get('/api/web/v1/notifications');
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ code: 'auth.unauthenticated' });
});

test('S-73 im Benutzermenü erreichbar; Erscheinungsbild umschalten', async ({ page }) => {
  await testLogin(page, 'user1');
  await page.goto('/');
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: 'Meine Anmeldesitzungen' }).click();
  await expect(page).toHaveURL('/einstellungen');
  await page.getByLabel('Erscheinungsbild', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Erscheinungsbild', { exact: true }).selectOption('light');
});

for (const width of [768, 2400]) {
  test(`S-71…S-73 bei ${width} px ohne horizontales Scrollen`, async ({ browser }) => {
    const owner = await pageAs(browser, 'owner');
    await owner.setViewportSize({ width, height: 900 });
    for (const path of ['/verwaltung/einstellungen', '/verwaltung/protokoll', '/einstellungen']) {
      await owner.goto(path);
      await expect(owner.locator('#main h1')).toBeVisible();
      expect(
        await owner.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        path,
      ).toBe(true);
    }
  });
}
