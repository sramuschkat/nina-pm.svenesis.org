/** `pnpm test:a11y` (TK 17, CC5-9): axe für Shell, Anmelde-Bildschirme und Bausteine – keine serious/critical-Verstöße, beide Themes. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { testLogin } from './support';

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${label}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
  ).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`a11y ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    });

    test('Anmelde-Bildschirme und Textseiten', async ({ page }) => {
      for (const path of [
        '/',
        '/?anmeldung=fehler',
        '/kein-zugang',
        '/einladung',
        '/datenschutz',
        '/quellen',
      ]) {
        await page.goto(path);
        await expect(page.locator('#main')).toBeVisible();
        await expectNoSerious(page, path);
      }
    });

    test('Glocke geöffnet (AP-06b); Tastatur: Enter öffnet, Escape schließt', async ({ page }) => {
      await testLogin(page, 'owner');
      await page.goto('/');
      const bell = page.getByRole('button', { name: /^Benachrichtigungen/ });
      await bell.focus();
      await page.keyboard.press('Enter');
      const panel = page.getByRole('dialog', { name: 'Benachrichtigungen' });
      await expect(panel).toBeVisible();
      await expect(panel.locator('[role=status]')).toHaveCount(0);
      await expectNoSerious(page, 'notifications');
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(bell).toBeFocused();
    });

    test('Shell im Mandanten, Benutzermenü, ConfirmDialog, Mandantenauswahl', async ({ page }) => {
      await testLogin(page, 'owner');
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: 'Mandant „Demo-Sternfreunde“' }),
      ).toBeVisible();
      await expectNoSerious(page, 'shell');
      await page.getByRole('button', { name: 'Benutzermenü' }).click();
      await expectNoSerious(page, 'menu');
      await page.getByRole('menuitem', { name: 'Überall abmelden' }).click();
      await expectNoSerious(page, 'dialog');
      await page.keyboard.press('Escape');
      await testLogin(page, 'superuser');
      await page.goto('/mandant-waehlen');
      await expectNoSerious(page, 'mandant-waehlen');
    });

    test('Bausteine', async ({ page }) => {
      await page.goto('/_bausteine');
      await expectNoSerious(page, 'bausteine');
      await page.getByRole('button', { name: 'Dialog öffnen' }).click();
      await expectNoSerious(page, 'confirm-dialog');
    });
  });
}
