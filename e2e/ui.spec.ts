/**
 * Oberfläche (AP-06a): Theme-Test gegen die Token-Tabelle, Dichte, Breiten (UI-1), Standortzeit mit
 * Browserzone Europe/Berlin, CSP-Abnahme (SEC-2) mit Radix-Menü und -Dialog.
 */
import { expect, test, type Page } from '@playwright/test';
import { COLORS, DENSITY, THEMES } from '../packages/ui-tokens/src/tokens';
import { collectCspViolations, testLogin } from './support';

const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'scrollWidth <= clientWidth').toBeLessThanOrEqual(client);
}

for (const theme of THEMES) {
  test(`Theme-Test ${theme}: berechnete Farben entsprechen der Token-Tabelle (TK 11.3)`, async ({
    page,
  }) => {
    await page.goto(`/_bausteine?theme=${theme}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Beide Seiten vom Browser berechnen lassen (der Minifier kürzt z. B. #ffffff zu #fff).
    const pairs = await page.evaluate((tokens) => {
      const probe = document.createElement('div');
      document.body.append(probe);
      const out = tokens.map(([key, expected]) => {
        probe.style.color = `var(--npm-${key})`;
        const actual = getComputedStyle(probe).color;
        probe.style.color = expected;
        return [key, actual, getComputedStyle(probe).color];
      });
      probe.remove();
      return out;
    }, Object.entries(COLORS[theme]));
    for (const [key, actual, expected] of pairs)
      expect(norm(actual ?? ''), key).toBe(norm(expected ?? ''));
    // Berechnete Farben der Elemente: Hintergrund, Text, Gefahrenknopf im ConfirmDialog.
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe(hexToRgb(COLORS[theme].bg ?? ''));
    const text = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(text).toBe(hexToRgb(COLORS[theme].text ?? ''));
    await page.getByRole('button', { name: 'Dialog öffnen' }).click();
    const danger = await page
      .getByRole('button', { name: 'Löschen' })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(danger).toBe(hexToRgb(COLORS[theme].danger ?? ''));
  });
}

test('Dichte-Test: Zeilenhöhe und Abstände ändern sich, die Breite nicht', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const measure = async () =>
    page.evaluate(() => {
      const row = document
        .querySelector('[data-component="Table"] tbody tr')
        ?.getBoundingClientRect();
      const main = document.getElementById('main');
      return {
        rowH: row?.height ?? 0,
        mainW: main?.getBoundingClientRect().width ?? 0,
        pad: parseFloat(getComputedStyle(main ?? document.body).paddingLeft),
      };
    });
  const results: Record<string, { rowH: number; mainW: number; pad: number }> = {};
  for (const d of ['compact', 'normal', 'wide'] as const) {
    await page.goto(`/_bausteine?density=${d}`);
    await expect(page.locator('html')).toHaveAttribute('data-density', d);
    results[d] = await measure();
    expect(results[d]?.rowH).toBeGreaterThanOrEqual(parseFloat(DENSITY[d]['row-h'] ?? '0'));
    await noHorizontalScroll(page);
  }
  expect(results.compact?.rowH).toBeLessThan(results.normal?.rowH ?? 0);
  expect(results.normal?.rowH).toBeLessThan(results.wide?.rowH ?? 0);
  expect(results.compact?.pad).toBeLessThan(results.wide?.pad ?? 0);
  expect(results.compact?.mainW).toBe(results.wide?.mainW);
});

test('Dichte-Schalter der Shell: Wahl bleibt nach Neuladen, Breite unverändert', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await testLogin(page, 'owner');
  await page.goto('/');
  const width = async () =>
    page.locator('#main').evaluate((el) => el.getBoundingClientRect().width);
  const before = await width();
  await page.getByRole('radio', { name: 'kompakt' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  expect(await width()).toBe(before);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.getByRole('radio', { name: 'normal' }).click();
});

for (const width of [768, 1280, 2400]) {
  test(`Breiten-Test ${width} px: Shell ohne horizontales Scrollen; Arbeitsbereich volle Breite, Textseiten 1100 px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();
    await noHorizontalScroll(page);
    const { main, nav } = await page.evaluate(() => ({
      main: document.getElementById('main')?.getBoundingClientRect().width ?? 0,
      nav:
        document.querySelector('nav[aria-label="Hauptnavigation"]')?.getBoundingClientRect()
          .width ?? 0,
    }));
    // Kein zentrierter Container: Arbeitsbereich = Fensterbreite − Navigation.
    expect(Math.round(main + nav)).toBe(width);
    await page.goto('/datenschutz');
    await noHorizontalScroll(page);
    const text = await page.locator('#main').evaluate((el) => el.getBoundingClientRect().width);
    expect(text).toBeLessThanOrEqual(1100);
    if (width >= 1280) expect(text).toBe(1100);
  });
}

test('Bausteine bei 768 px und 2400 px ohne horizontales Scrollen (components.md §4 Nr. 6)', async ({
  page,
}) => {
  for (const width of [768, 2400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/_bausteine');
    await noHorizontalScroll(page);
  }
});

test('SiteTime mit Browserzone Europe/Berlin und Standort Chicago: 02:08Z → „21:08 CDT“, nie Browserzeit', async ({
  page,
}) => {
  await page.goto('/_bausteine');
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
    'Europe/Berlin',
  );
  await expect(page.locator('[data-component="SiteTime"] time')).toHaveText('21:08 CDT');
});

test('CSP-Abnahme (SEC-2): Radix-Menü und Radix-Dialog ohne CSP-Verstoß unter den prod-Headern', async ({
  page,
}) => {
  const violations = collectCspViolations(page);
  const headers = (await page.request.get('/')).headers();
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
  await testLogin(page, 'owner');
  await page.goto('/');
  await page.getByRole('button', { name: 'Benutzermenü' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Überall abmelden' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await page.goto('/_bausteine');
  await page.getByRole('combobox', { name: 'Rig' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(violations).toEqual([]);
});
