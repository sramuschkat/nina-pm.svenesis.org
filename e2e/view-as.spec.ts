/**
 * Rollenansicht „Als User ansehen“ (30.09.2026) gegen den lokalen Stack: Owner schaltet im Benutzermenü auf
 * User-Rechte – Hinweis mit *Zurück*, keine Administration, Admin-Route serverseitig verweigert – und zurück;
 * User sieht den Eintrag nicht; axe.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { testLogin } from './support';

test('Owner: Als User ansehen und zurück; Server verweigert Admin-Routen in der Ansicht', async ({
  page,
}) => {
  await testLogin(page, 'owner');
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(nav.getByRole('link', { name: 'Administration' })).toBeVisible();
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await page.getByRole('menuitem', { name: 'Als User ansehen' }).click();
  const banner = page.getByRole('status').filter({ hasText: 'Rollenansicht' });
  await expect(banner).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Administration' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Benutzermenü' })).toContainText('User-Ansicht');
  expect((await page.request.get('/api/web/v1/drafts')).status()).toBe(403);
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => v.id),
  ).toEqual([]);

  await banner.getByRole('button', { name: 'Zurück zur Owner-Ansicht' }).click();
  await expect(banner).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Administration' })).toBeVisible();
  expect((await page.request.get('/api/web/v1/drafts')).status()).toBe(200);
});

test('User: kein Eintrag „Als User ansehen“', async ({ page }) => {
  await testLogin(page, 'user1');
  await page.goto('/');
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await expect(page.getByRole('menuitem', { name: 'Abmelden', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Als User ansehen' })).toHaveCount(0);
});
