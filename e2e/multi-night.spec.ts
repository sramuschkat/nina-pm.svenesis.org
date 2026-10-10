/**
 * Mehrnacht-Simulation neu (S-40, 10.10.2026): Job-Antworten per `page.route` (der lokale Stack rechnet keine Jobs) mit
 * den Zahlen aus Svens Screenshot – Kacheln, sieben Säulen in einer Zeile innerhalb der Karte, Projekt × Nacht ohne
 * horizontales Scrollen der Seite (768/2400 px, Lage per `boundingBox`), Aufklappen der Filter; axe hell/dunkel.
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

const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nights = [
  ['2026-10-10', 0.1, 1, 0.8],
  ['2026-10-11', 1, 4, 7.9],
  ['2026-10-12', 1, 4, 8.0],
  ['2026-10-13', 1, 3, 8.1],
  ['2026-10-14', 0.1, 0, 0.8],
  ['2026-10-15', 0.1, 0, 0.8],
  ['2026-10-16', 1, null, 7.5],
] as const;

function result(rigId: string) {
  return {
    kind: 'multi_sim',
    rigId,
    rigName: 'SFRO-Rig',
    siteTimeZone: 'America/Chicago',
    nightFrom: '2026-10-10',
    nightCount: 7,
    weather: true,
    computedAt: '2026-10-10T18:00:00Z',
    nights: nights.map(([night, weight, rating, exposure]) => ({
      night,
      darkHours: 9.7,
      weight,
      ratingIndex: rating,
      hasForecast: rating !== null,
      exposureHours: exposure,
      projects: [
        { projectId: P(1), frames: 10, hours: exposure * 0.5 },
        { projectId: P(2), frames: 10, hours: exposure * 0.3 },
        { projectId: P(3), frames: 10, hours: exposure * 0.2 },
      ],
    })),
    projects: [
      { id: P(1), name: 'DrZi1', need: 469, sim: 233.4, done: null },
      { id: P(2), name: 'NGC 7331', need: 900, sim: 245, done: null },
      { id: P(3), name: 'LDN1228-LRGB', need: 427, sim: 348.8, done: null },
      { id: P(4), name: 'IC 1795-RGB', need: 0, sim: 0, done: null },
    ].map((p) => ({
      projectId: p.id,
      name: p.name,
      approvalStatus: 'approved',
      needFrames: p.need,
      simulatedFrames: p.sim,
      hours: 10,
      nightsUsed: 7,
      completesNight: p.done,
      sharePct: 30,
      filters: p.need > 0 ? [{ filter: 'L', need: p.need, simulated: p.sim }] : [],
    })),
  };
}

async function openWithResult(page: Page, rigId: string) {
  await page.route('**/api/web/v1/simulations/multi', (r) =>
    r.fulfill({ status: 202, json: { jobId: P(99) } }),
  );
  await page.route(`**/api/web/v1/jobs/${P(99)}`, (r) =>
    r.fulfill({
      json: {
        id: P(99),
        kind: 'multi_sim',
        status: 'done',
        attempts: 1,
        errorCode: null,
        createdAt: '2026-10-10T18:00:00Z',
        startedAt: null,
        finishedAt: null,
        hasResult: true,
      },
    }),
  );
  await page.route(`**/api/web/v1/jobs/${P(99)}/result`, (r) => r.fulfill({ json: result(rigId) }));
  await page.goto(`/nina/simulator?rig=${rigId}&nacht=2026-10-10`);
  await page.getByRole('button', { name: 'Mehrnacht' }).click();
  await page.getByLabel('Wetter einrechnen').check();
  await page.getByRole('button', { name: 'Mehrnacht berechnen' }).click();
  await expect(page.getByRole('list', { name: 'Nächte im Zeitraum' })).toBeVisible();
}

test('Mehrnacht neu: Kacheln, sieben Säulen in einer Zeile, Projekt × Nacht; 768/2400 px; axe hell/dunkel', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { rigId } = await nightOnOwnRig(admin, user, baseURL ?? '');
  await openWithResult(admin, rigId);

  const tiles = admin.getByRole('group', { name: 'Kurzfassung' });
  await expect(tiles.getByText('33,9 h')).toBeVisible();
  await expect(tiles.getByText('3 von 7')).toBeVisible();
  const columns = admin.getByRole('list', { name: 'Nächte im Zeitraum' }).getByRole('listitem');
  await expect(columns).toHaveCount(7);
  await expect(columns.nth(0)).toContainText('zählt zu 10 % · 8 h, wenn klar');
  await expect(columns.nth(6)).toContainText('ohne Vorhersage – zählt voll');
  await expect(admin.getByText('Schon fertig: IC 1795-RGB')).toBeVisible();

  for (const width of [2400, 768]) {
    await admin.setViewportSize({ width, height: 1000 });
    // Sieben Säulen in einer Zeile, alle innerhalb der Liste.
    const list = await admin.getByRole('list', { name: 'Nächte im Zeitraum' }).boundingBox();
    const first = await columns.nth(0).boundingBox();
    const last = await columns.nth(6).boundingBox();
    if (!list || !first || !last) throw new Error('Säulen nicht sichtbar');
    expect(Math.abs(first.y - last.y), `eine Zeile @ ${String(width)}`).toBeLessThan(2);
    expect(last.x + last.width).toBeLessThanOrEqual(list.x + list.width + 1);
    const overflow = await admin.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `kein waagerechtes Scrollen @ ${String(width)}`).toBeLessThanOrEqual(0);
  }
  await admin.setViewportSize(WIDE);
  const table = admin.getByRole('table', { name: /Projekte über den Zeitraum/ });
  const row = table.getByRole('row', { name: /DrZi1/ });
  await expect(row).toContainText('233,4 von 469 Frames · 50 %');
  await expect(row).toContainText('nicht in 7 Nächten');
  await row.getByRole('button', { name: /DrZi1/ }).click();
  await expect(admin.getByRole('table', { name: 'Filter von DrZi1' })).toBeVisible();
  await expectNoSerious(admin, 'Mehrnacht hell');

  const dark = await (await browser.newContext({ viewport: WIDE })).newPage();
  await dark.addInitScript(() => window.localStorage.setItem('npm.theme', 'dark'));
  await testLogin(dark, 'owner');
  await openWithResult(dark, rigId);
  await expectNoSerious(dark, 'Mehrnacht dunkel');
});
