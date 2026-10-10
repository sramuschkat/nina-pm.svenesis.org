/**
 * AP-77: Reiter „Qualität“ (statt „Bilder“) und „Sessions & Protokoll“ im Projekt nach einer Fake-Plugin-Nacht – alte
 * Adresse `?reiter=bilder` öffnet „Qualität“; Matrix und Verlauf nebeneinander (Laptop) bzw. untereinander bei 768 px
 * (Lage gemessen), Dateiliste als CSV, Qualitätskarten und Session-Spalten; kein horizontales Scrollen, axe hell/dunkel.
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

test('S-31 „Qualität“ und „Sessions & Protokoll“: Lage gemessen, CSV, axe hell/dunkel, 768 px', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { projectId, projectName } = await nightOnOwnRig(admin, user, baseURL ?? '');

  // Alte Adresse aus AP-72b öffnet den neuen Reiter.
  await admin.goto(`/projekte/${projectId}?reiter=bilder`);
  await expect(admin.getByRole('tab', { name: 'Qualität', selected: true })).toBeVisible();
  await expect(admin.getByRole('tab', { name: 'Bilder' })).toHaveCount(0);
  const matrix = admin.getByRole('table', { name: 'Anteil guter Lights je Nacht und Filter' });
  const trend = admin.getByRole('img', { name: /je Nacht und Filter, zuletzt:/ });
  await expect(matrix).toBeVisible();
  await expect(trend).toBeVisible();
  await expect(matrix.getByRole('row').nth(1)).toContainText('%');
  // Matrix und Verlauf überlappen nicht: nebeneinander, wenn die Spalte breit genug ist, sonst darunter.
  const m1 = await matrix.boundingBox();
  const t1 = await trend.boundingBox();
  if (!m1 || !t1) throw new Error('Matrix oder Verlauf nicht sichtbar');
  expect(t1.x >= m1.x + m1.width - 1 || t1.y >= m1.y + m1.height - 1).toBe(true);
  // Die Matrix passt in ihre Karte (keine abgeschnittene Summenspalte).
  const card = await admin
    .getByRole('region', { name: 'Anteil guter Lights je Nacht und Filter' })
    .boundingBox();
  if (!card) throw new Error('Karte nicht sichtbar');
  expect(m1.x + m1.width).toBeLessThanOrEqual(card.x + card.width + 1);
  await admin
    .getByRole('group', { name: 'Kennzahl' })
    .getByRole('button', { name: '% gut' })
    .click();
  await expect(admin.getByRole('img', { name: /^% gut je Nacht und Filter/ })).toBeVisible();
  // Dateiliste: alle Lights als CSV mit Kopfzeile.
  const href = await admin.getByRole('link', { name: /^Alle Lights \(CSV/ }).getAttribute('href');
  const csv = await admin.request.get(href ?? '');
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('night;capturedAtUtc;filter;exposureS;quality');
  await expectNoSerious(admin, 'Qualität light');

  // Sessions & Protokoll: Karten je Filter und Spalte Qualität.
  await admin.getByRole('tab', { name: 'Sessions & Protokoll' }).click();
  await expect(admin.getByRole('list', { name: `Filter von ${projectName}` })).toBeVisible();
  const sessions = admin.getByRole('table', { name: `Sessions von ${projectName}` });
  await expect(sessions.getByRole('columnheader', { name: 'Qualität' })).toBeVisible();
  await expect(sessions.getByRole('row').nth(1)).toContainText('% gut');
  await expectNoSerious(admin, 'Sessions light');

  const dark = await (await browser.newContext({ viewport: WIDE })).newPage();
  await dark.addInitScript(() => window.localStorage.setItem('npm.theme', 'dark'));
  await testLogin(dark, 'owner');
  await dark.goto(`/projekte/${projectId}?reiter=qualitaet`);
  await expect(
    dark.getByRole('table', { name: 'Anteil guter Lights je Nacht und Filter' }),
  ).toBeVisible();
  await expectNoSerious(dark, 'Qualität dark');

  // 768 px: untereinander, ohne horizontales Scrollen.
  await admin.setViewportSize({ width: 768, height: 1000 });
  await admin.getByRole('tab', { name: 'Qualität' }).click();
  await expect(matrix).toBeVisible();
  const m2 = await matrix.boundingBox();
  const t2 = await admin.getByRole('img', { name: /je Nacht und Filter, zuletzt:/ }).boundingBox();
  if (!m2 || !t2) throw new Error('Matrix oder Verlauf nicht sichtbar');
  expect(t2.y).toBeGreaterThan(m2.y + m2.height - 1);
  const overflow = await admin.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
