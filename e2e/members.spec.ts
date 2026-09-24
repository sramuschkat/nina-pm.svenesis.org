/**
 * S-70 Mitglieder & Einladungen (AP-07b, FA-BEN-01…11): Owner ernennt/entzieht Admin-Rechte (wirkt ab der
 * nächsten Anfrage), Sitzungen beenden → 401, Owner-Aktionen für Admins ausgeblendet (API 403), Admin ohne
 * 2FA sieht nur User-Aktionen und `auth.mfa_required`, Einladung erzeugen und widerrufen.
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

const nav = (page: Page) => page.getByRole('navigation', { name: 'Hauptnavigation' });

test('Owner entzieht Admin-Rechte (ConfirmDialog) und ernennt wieder – wirkt ab der nächsten Anfrage', async ({
  browser,
}) => {
  const owner = await pageAs(browser, 'owner');
  const admin = await pageAs(browser, 'admin');
  await admin.goto('/');
  await expect(nav(admin).getByRole('link', { name: 'Administration' })).toBeVisible();

  await owner.goto('/verwaltung/mitglieder');
  await owner.getByRole('button', { name: 'Anton Admin' }).click();
  await owner.getByRole('button', { name: 'Admin-Rechte entziehen' }).click();
  const dialog = owner.getByRole('alertdialog', {
    name: 'Admin-Rechte von „Anton Admin“ entziehen?',
  });
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Admin-Rechte entziehen' }).click();
  await expect(dialog).toHaveCount(0);
  try {
    await admin.reload();
    await expect(admin.getByRole('button', { name: 'Benutzermenü' })).toContainText('(User)');
    await expect(nav(admin).getByText('Administration')).toHaveCount(0);
    expect((await admin.request.get('/api/web/v1/members')).status()).toBe(403);
  } finally {
    await owner.getByRole('button', { name: 'Anton Admin' }).click();
    await owner.getByLabel('Grund (optional, steht im Änderungsprotokoll)').fill('E2E zurück');
    await owner.getByRole('button', { name: 'Zu Admin machen' }).click();
    await expect(owner.getByRole('button', { name: 'Admin-Rechte entziehen' })).toBeVisible();
  }
  await admin.reload();
  await expect(admin.getByRole('button', { name: 'Benutzermenü' })).toContainText('(Admin)');
  await expect(nav(admin).getByRole('link', { name: 'Administration' })).toBeVisible();
});

test('Sitzungen beenden → das Mitglied erhält bei der nächsten Anfrage 401', async ({
  browser,
}) => {
  const owner = await pageAs(browser, 'owner');
  const user = await pageAs(browser, 'user2');
  expect((await user.request.get('/api/auth/me')).status()).toBe(200);
  await owner.goto('/verwaltung/mitglieder');
  await owner.getByRole('button', { name: 'Ben Benutzer' }).click();
  await owner.getByRole('button', { name: 'Sitzungen beenden' }).click();
  await owner
    .getByRole('alertdialog', { name: 'Sitzungen von „Ben Benutzer“ beenden?' })
    .getByRole('button', { name: 'Sitzungen beenden' })
    .click();
  const res = await user.request.get('/api/web/v1/notifications');
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ code: 'auth.unauthenticated' });
});

test('Admin sieht keine Owner-Aktionen; die API lehnt trotzdem ab (403)', async ({ browser }) => {
  const admin = await pageAs(browser, 'admin');
  await admin.goto('/verwaltung/mitglieder');
  await expect(admin.getByRole('heading', { name: 'Einladen' })).toBeVisible();
  await expect(admin.getByRole('radio', { name: 'Admin' })).toHaveCount(0);
  await expect(admin.getByRole('button', { name: 'User einladen' })).toBeVisible();
  await admin.getByRole('button', { name: 'Olivia Owner' }).click();
  await expect(admin.getByText('Der Owner ist geschützt')).toBeVisible();
  await admin.getByRole('button', { name: 'Uta User' }).click();
  await expect(admin.getByRole('button', { name: 'Sitzungen beenden' })).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Zu Admin machen' })).toHaveCount(0);
  const uta = await memberId(admin, 'Uta User');
  const res = await admin.request.put(`/api/web/v1/members/${uta}/role`, {
    data: { role: 'admin' },
    headers: csrf,
  });
  expect(res.status()).toBe(403);
  const inv = await admin.request.post('/api/web/v1/invitations/admin', {
    data: { id: crypto.randomUUID() },
    headers: csrf,
  });
  expect(inv.status()).toBe(403);
});

test('Admin ohne 2FA sieht nur User-Aktionen und den Hinweis auth.mfa_required', async ({
  browser,
}) => {
  const owner = await pageAs(browser, 'owner');
  const uta = await memberId(owner, 'Uta User');
  const setRole = (role: 'admin' | 'user') =>
    owner.request.put(`/api/web/v1/members/${uta}/role`, { data: { role }, headers: csrf });
  expect((await setRole('admin')).ok()).toBe(true);
  try {
    const user = await pageAs(browser, 'user1');
    await user.goto('/');
    await expect(user.getByRole('button', { name: 'Benutzermenü' })).toContainText('(Admin)');
    await expect(user.getByText('Admin-Rechte ruhen, bis Discord-2FA aktiv ist')).toBeVisible();
    await expect(nav(user).getByText('Administration')).toHaveCount(0);
    await user.goto('/verwaltung/mitglieder');
    await expect(user.getByRole('alert')).toContainText(
      'Zwei-Faktor-Authentifizierung bei Discord erforderlich',
    );
    await owner.goto('/verwaltung/mitglieder');
    await owner.getByRole('button', { name: 'Uta User' }).click();
    await expect(owner.getByText('Rechte ruhen – 2FA fehlt:')).toBeVisible();
  } finally {
    await setRole('user');
  }
});

test('Einladung erzeugen, in der Liste sehen und widerrufen (ConfirmDialog)', async ({
  browser,
}) => {
  const owner = await pageAs(browser, 'owner');
  await owner.goto('/verwaltung/mitglieder');
  const note = `E2E ${Date.now().toString(36)}`;
  await owner.getByLabel('Notiz').fill(note);
  await owner.getByRole('button', { name: 'User einladen' }).click();
  await expect(owner.getByTestId('invitation-link')).toContainText('/einladung#');
  const row = owner.getByRole('row', { name: new RegExp(note) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Widerrufen' }).click();
  await owner
    .getByRole('alertdialog', { name: 'Einladung widerrufen?' })
    .getByRole('button', { name: 'Widerrufen' })
    .click();
  await expect(owner.getByRole('row', { name: new RegExp(note) })).toHaveCount(0);
});

test('„Mandant verlassen“ im Benutzermenü – nicht für den Owner', async ({ browser }) => {
  const owner = await pageAs(browser, 'owner');
  await owner.goto('/');
  await owner.getByRole('button', { name: 'Benutzermenü' }).click();
  await expect(owner.getByRole('menuitem', { name: 'Mandant verlassen' })).toHaveCount(0);
  const user = await pageAs(browser, 'user1');
  await user.goto('/');
  await user.getByRole('button', { name: 'Benutzermenü' }).click();
  await user.getByRole('menuitem', { name: 'Mandant verlassen' }).click();
  const dialog = user.getByRole('alertdialog', { name: 'Mandant „Demo-Sternfreunde“ verlassen?' });
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await user.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

for (const width of [768, 2400]) {
  test(`S-70 bei ${width} px ohne horizontales Scrollen`, async ({ browser }) => {
    const owner = await pageAs(browser, 'owner');
    await owner.setViewportSize({ width, height: 900 });
    await owner.goto('/verwaltung/mitglieder');
    await owner.getByRole('button', { name: 'Anton Admin' }).click();
    expect(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}
