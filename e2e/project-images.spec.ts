/**
 * AP-72b: Reiter „Bilder“ im Projekt nach einer Fake-Plugin-Nacht – Tabelle und Seitenleiste nebeneinander (Laptop),
 * untereinander bei 768 px (Lage gemessen), kein horizontales Scrollen, axe hell/dunkel.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { nightOnOwnRig } from './night-support';
import { WIDE, testLogin } from './support';

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

test('S-31 „Bilder“: Tabelle und Seitenleiste, Lage gemessen, axe hell/dunkel, 768 px', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { projectId } = await nightOnOwnRig(admin, user, baseURL ?? '');

  await admin.goto(`/projekte/${projectId}?reiter=bilder`);
  await expect(admin.getByRole('tab', { name: 'Bilder', selected: true })).toBeVisible();
  const table = admin.getByRole('table', { name: /Bilder$/ });
  const side = admin.getByRole('complementary', { name: 'Bild-Details' });
  await expect(table).toBeVisible();
  await expect(side).toBeVisible();
  await expect(admin.getByRole('group', { name: 'Bewertung' })).toBeVisible();
  // Nebeneinander auf dem Laptop: Seitenleiste rechts neben der Tabelle, oben bündig.
  const t1 = await table.boundingBox();
  const s1 = await side.boundingBox();
  if (!t1 || !s1) throw new Error('Tabelle oder Seitenleiste nicht sichtbar');
  expect(s1.x).toBeGreaterThanOrEqual(t1.x + t1.width);
  await expectNoSerious(admin, 'Bilder light');

  const dark = await (await browser.newContext({ viewport: WIDE })).newPage();
  await dark.addInitScript(() => window.localStorage.setItem('npm.theme', 'dark'));
  await testLogin(dark, 'owner');
  await dark.goto(`/projekte/${projectId}?reiter=bilder`);
  await expect(dark.getByRole('complementary', { name: 'Bild-Details' })).toBeVisible();
  await expectNoSerious(dark, 'Bilder dark');

  // 768 px: untereinander, ohne horizontales Scrollen.
  await admin.setViewportSize({ width: 768, height: 1000 });
  await expect(side).toBeVisible();
  const t2 = await table.boundingBox();
  const s2 = await side.boundingBox();
  if (!t2 || !s2) throw new Error('Tabelle oder Seitenleiste nicht sichtbar');
  // Untereinander: gleiche Spalte (links bündig), Seitenleiste unter dem Tabellenkopf.
  expect(Math.abs(s2.x - t2.x)).toBeLessThanOrEqual(24);
  expect(s2.y).toBeGreaterThan(t2.y);
  const overflow = await admin.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
