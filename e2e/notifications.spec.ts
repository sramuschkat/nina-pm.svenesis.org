/** Glocke und Startseite (AP-06b, AP-26c, FA-FRG-11): Rollenwechsel → Zähler beim Betroffenen → gelesen. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { csrf, testLogin } from './support';

async function pageAs(browser: Browser, fixture: string, theme = 'light'): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
  await testLogin(page, fixture);
  return page;
}

async function setRole(owner: Page, displayName: string, role: 'admin' | 'user') {
  const { members } = (await (await owner.request.get('/api/web/v1/members')).json()) as {
    members: { id: string; displayName: string }[];
  };
  const target = members.find((m) => m.displayName === displayName);
  if (!target) throw new Error(`Mitglied ${displayName} fehlt`);
  const res = await owner.request.put(`/api/web/v1/members/${target.id}/role`, {
    data: { role },
    headers: csrf,
  });
  expect(res.ok()).toBe(true);
}

test('Owner ändert die Rolle von user1 → Glocke zählt → alle als gelesen', async ({ browser }) => {
  const owner = await pageAs(browser, 'owner');
  const user = await pageAs(browser, 'user1');
  await user.request.post('/api/web/v1/notifications/read', { data: { all: true }, headers: csrf });
  await user.goto('/');
  await expect(user.getByRole('button', { name: 'Benachrichtigungen', exact: true })).toBeVisible();

  await setRole(owner, 'Uta User', 'admin');
  try {
    await user.reload();
    const bell = user.getByRole('button', { name: 'Benachrichtigungen, 1 ungelesen' });
    await expect(bell).toHaveText('1');
    await bell.click();
    const panel = user.getByRole('dialog', { name: 'Benachrichtigungen' });
    // Neueste zuerst; frühere (gelesene) Einträge anderer Tests dürfen darunter stehen.
    await expect(panel.getByRole('listitem').first()).toContainText(
      'Deine Rolle wurde von User zu Admin geändert',
    );
    await expect(panel.locator('time').first()).toHaveText(
      /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2} MES?Z$/,
    );
    const axe = await new AxeBuilder({ page: user }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await panel.getByRole('button', { name: 'Alle als gelesen markieren' }).click();
    await expect(
      user.getByRole('button', { name: 'Benachrichtigungen', exact: true }),
    ).toBeVisible();
    await expect(user.getByTestId('notification-count')).toHaveCount(0);
    await user.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  } finally {
    await setRole(owner, 'Uta User', 'user');
  }
  // Nur der Betroffene erhält role.changed – der Owner nicht.
  const ownerList = (await (await owner.request.get('/api/web/v1/notifications')).json()) as {
    items: { kind: string }[];
  };
  expect(ownerList.items.filter((n) => n.kind === 'role.changed')).toEqual([]);
});

test('Startseite (AP-26c): Übersicht → Warteschlange (User) bzw. Projektliste S-30 (Admin), im Rahmen', async ({
  browser,
}) => {
  const user = await pageAs(browser, 'user1');
  await user.goto('/');
  await expect(user.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
  await user.getByRole('link', { name: 'Zur Warteschlange' }).click();
  await expect(user).toHaveURL('/projekte/warteschlange');
  await expect(user.getByRole('heading', { level: 1, name: 'Warteschlange' })).toBeVisible();
  await expect(user.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
  const owner = await pageAs(browser, 'owner');
  await owner.goto('/');
  await owner.getByRole('link', { name: 'Zur Projektliste' }).click();
  await expect(owner).toHaveURL('/projekte');
  await expect(owner.getByRole('heading', { level: 1, name: 'Projekte' })).toBeVisible();
});

test('Glocke bei 768 px: Liste passt ins Fenster, kein horizontales Scrollen', async ({
  browser,
}) => {
  const owner = await pageAs(browser, 'owner');
  await owner.setViewportSize({ width: 768, height: 900 });
  await owner.goto('/');
  await owner.getByRole('button', { name: /^Benachrichtigungen/ }).click();
  const box = await owner.getByRole('dialog', { name: 'Benachrichtigungen' }).boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(768);
  expect(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
