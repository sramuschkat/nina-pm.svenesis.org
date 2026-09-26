/**
 * AP-35: S-02 „Heute Nacht“ gegen den lokalen Stack. Browserzone `Europe/Berlin` (Playwright `timezoneId`),
 * Standort `America/Chicago`: am 18.09.2026 um 09:00, 16:00 und 20:00 MESZ zeigt „Heute Nacht“ die Nächte
 * 17./18., 18./19. und 18./19.09. (rules/ui.md, NT-01). Die Serveruhr stellt das Cookie `npm_test_now` je
 * Anfrage (nur `AUTH_TEST_MODE`), die Browseruhr `page.clock` – die Nacht kommt trotzdem nur vom Server.
 * Dazu axe hell/dunkel und 768/2400 px ohne horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { csrf, tableOverflow, testLogin } from './support';

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

/** Eigenes Rig an einem Standort in Chicago (Starfront). */
async function chicagoRig(admin: Page) {
  const stamp = String(Date.now());
  const siteId = crypto.randomUUID();
  expect(
    (
      await admin.request.post('/api/web/v1/sites', {
        headers: csrf,
        data: {
          id: siteId,
          name: `E2E-Heute ${stamp}`,
          latitudeDeg: 31.5471,
          longitudeDeg: -99.3823,
          elevationM: 400,
          timeZone: 'America/Chicago',
        },
      })
    ).status(),
  ).toBe(201);
  const telescopes = (await (await admin.request.get('/api/web/v1/telescopes')).json()) as {
    items: { id: string }[];
  };
  const cameras = (await (await admin.request.get('/api/web/v1/cameras')).json()) as {
    items: { id: string }[];
  };
  const rigName = `E2E-Heute-Rig ${stamp}`;
  expect(
    (
      await admin.request.post('/api/web/v1/rigs', {
        headers: csrf,
        data: {
          id: crypto.randomUUID(),
          name: rigName,
          siteId,
          telescopeId: telescopes.items[0]?.id,
          cameraId: cameras.items[0]?.id,
        },
      })
    ).status(),
  ).toBe(201);
  return rigName;
}

test('NT-01: 09:00/16:00/20:00 MESZ am 18.09.2026 → 17./18., 18./19., 18./19.09. (Chicago)', async ({
  page,
  baseURL,
}) => {
  await testLogin(page, 'owner');
  const rigName = await chicagoRig(page);
  const cases = [
    ['2026-09-18T09:00:00+02:00', '17./18.09.'],
    ['2026-09-18T16:00:00+02:00', '18./19.09.'],
    ['2026-09-18T20:00:00+02:00', '18./19.09.'],
  ] as const;
  for (const [at, night] of cases) {
    const iso = new Date(at).toISOString();
    await page
      .context()
      .addCookies([{ name: 'npm_test_now', value: encodeURIComponent(iso), url: baseURL ?? '' }]);
    await page.clock.setFixedTime(new Date(iso));
    await page.goto('/heute-nacht');
    const card = page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: rigName }),
    });
    await expect(card, at).toContainText(`Nacht ${night}`);
    // Uhrzeiten in Standortzeit mit Kürzel (NT-03), nie in der Browserzone.
    await expect(card).toContainText('CDT');
  }
  await page.context().clearCookies({ name: 'npm_test_now' });
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-02 ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await page.goto('/heute-nacht');
    await expect(page.getByRole('heading', { level: 1, name: 'Heute Nacht' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expectNoSerious(page, `S-02 ${theme}`);
  });
}

for (const width of [768, 2400]) {
  test(`S-02 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    await page.goto('/heute-nacht');
    await expect(page.getByRole('heading', { level: 1, name: 'Heute Nacht' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `S-02 @ ${String(width)}`).toBeLessThanOrEqual(0);
    expect(await tableOverflow(page)).toEqual([]);
  });
}
