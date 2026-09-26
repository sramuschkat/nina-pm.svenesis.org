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

    test('System-Seiten S-80…S-82 mit Detail und Lösch-Dialog (AP-07a)', async ({ page }) => {
      await testLogin(page, 'superuser');
      await page.request.post('/api/auth/context', {
        data: { system: true },
        headers: { 'X-NPM-Request': '1' },
      });
      await page.goto('/system/mandanten');
      await page.getByRole('button', { name: 'demo', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Mandant löschen' })).toBeVisible();
      await expectNoSerious(page, 'S-80');
      await page.getByRole('button', { name: 'Mandant löschen' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expectNoSerious(page, 'S-80 Löschen');
      await page.keyboard.press('Escape');
      await page.goto('/system/super-user');
      await expect(
        page.getByRole('heading', { name: 'Identität systemweit sperren' }),
      ).toBeVisible();
      await expectNoSerious(page, 'S-81');
      await page.goto('/system/audit');
      await expect(page.getByRole('heading', { name: 'System-Audit', exact: true })).toBeVisible();
      await expectNoSerious(page, 'S-82');
    });

    test('S-70 Mitglieder mit Detail, Einladung und Dialog (AP-07b)', async ({ page }) => {
      await testLogin(page, 'owner');
      await page.goto('/verwaltung/mitglieder');
      await page.getByRole('button', { name: 'Anton Admin', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Admin-Rechte entziehen' })).toBeVisible();
      await expectNoSerious(page, 'S-70');
      await page.getByRole('button', { name: 'Entfernen' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expectNoSerious(page, 'S-70 Entfernen');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      // AP-26b: Reiter „Offene Einladungen (n)“ und Einladen als Dialog.
      await page.getByRole('tab', { name: /^Offene Einladungen/ }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
      await expectNoSerious(page, 'S-70 Offene Einladungen');
      await page.getByRole('button', { name: 'Einladen', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Einladen' })).toBeVisible();
      await expectNoSerious(page, 'S-70 Einladen');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Einladen' })).toHaveCount(0);
    });

    test('S-71…S-73 Einstellungen, Protokoll, Sitzungen (AP-07c)', async ({ page }) => {
      await testLogin(page, 'owner');
      for (const [path, heading] of [
        ['/verwaltung/einstellungen', 'Mandanteneinstellungen'],
        ['/verwaltung/protokoll', 'Protokoll'],
        ['/einstellungen', 'Persönliche Einstellungen'],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
        await expectNoSerious(page, path);
      }
      await page.getByRole('button', { name: 'Überall abmelden' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expectNoSerious(page, 'S-73 Dialog');
      await page.keyboard.press('Escape');
    });

    test('S-10…S-15 Ausrüstung mit Reitern und Lösch-Dialog (AP-09b/c)', async ({ page }) => {
      await testLogin(page, 'owner');
      for (const [path, heading] of [
        ['/ausruestung/rigs', 'Rigs'],
        ['/ausruestung/standorte', 'Standorte'],
        ['/ausruestung/teleskope', 'Teleskope'],
        ['/ausruestung/kameras', 'Kameras'],
        ['/ausruestung/filter', 'Filter & Belichtungsplan-Vorlagen'],
        ['/ausruestung/mondprofile', 'Mondprofile'],
      ] as const) {
        await page.goto(path);
        await expect(
          page.getByRole('heading', { level: 1, name: heading, exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: 'Wird geladen' })).toHaveCount(0);
        await expectNoSerious(page, path);
      }
      await page.goto('/ausruestung/filter');
      await page.getByRole('tab', { name: 'Spektrum' }).click();
      await expectNoSerious(page, 'S-14 Spektrum');
      await page.goto('/ausruestung/teleskope');
      await page.getByRole('button', { name: 'Löschen' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expectNoSerious(page, 'S-12 Löschen');
      await page.keyboard.press('Escape');
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
