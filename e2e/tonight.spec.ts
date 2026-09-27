/**
 * AP-35: S-02 „Heute Nacht“ gegen den lokalen Stack. Browserzone `Europe/Berlin` (Playwright `timezoneId`),
 * Standort `America/Chicago`: am 18.09.2026 um 09:00, 16:00 und 20:00 MESZ zeigt „Heute Nacht“ die Nächte
 * 17./18., 18./19. und 18./19.09. (rules/ui.md, NT-01). Die Serveruhr stellt das Cookie `npm_test_now` je
 * Anfrage (nur `AUTH_TEST_MODE`), die Browseruhr `page.clock` – die Nacht kommt trotzdem nur vom Server.
 * Zuerst wird das Rig gewählt (Umbau 27.09.2026): Auswahl per Liste, Rig in der URL; darunter „Mond und
 * Dunkelheit“, Plan, „Nacht im Detail“, „Mond & Planeten“. Dazu axe hell/dunkel und 768/2400 px ohne
 * horizontales Scrollen.
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
  const rigId = crypto.randomUUID();
  expect(
    (
      await admin.request.post('/api/web/v1/rigs', {
        headers: csrf,
        data: {
          id: rigId,
          name: rigName,
          siteId,
          telescopeId: telescopes.items[0]?.id,
          cameraId: cameras.items[0]?.id,
        },
      })
    ).status(),
  ).toBe(201);
  return { rigName, rigId };
}

test('NT-01: 09:00/16:00/20:00 MESZ am 18.09.2026 → 17./18., 18./19., 18./19.09. (Chicago)', async ({
  page,
  baseURL,
}) => {
  await testLogin(page, 'owner');
  const { rigName, rigId } = await chicagoRig(page);
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
    await page.goto(`/heute-nacht?rig=${rigId}`);
    const context = page.getByRole('region', { name: 'Rig und Nacht' });
    await expect(context.getByRole('combobox', { name: 'Rig wählen' })).toContainText(rigName);
    await expect(context, at).toContainText(`Nacht ${night}`);
    // Uhrzeiten in Standortzeit mit Kürzel (NT-03), nie in der Browserzone.
    await expect(page.getByRole('region', { name: 'Mond und Dunkelheit' })).toContainText(
      'Zeiten in Standortzeit (CDT)',
    );
  }
  await page.context().clearCookies({ name: 'npm_test_now' });
});

test('S-02: Rig zuerst wählen, dann Mond und Dunkelheit, Nacht im Detail, Mond & Planeten', async ({
  page,
}) => {
  await testLogin(page, 'owner');
  const { rigName, rigId } = await chicagoRig(page);
  await page.goto('/heute-nacht');
  const context = page.getByRole('region', { name: 'Rig und Nacht' });
  await context.getByRole('combobox', { name: 'Rig wählen' }).click();
  await page.getByRole('option', { name: new RegExp(rigName) }).click();
  await expect(page).toHaveURL(new RegExp(`rig=${rigId}`));
  await expect(context).toContainText(`E2E-Heute`);
  await expect(page.getByRole('img', { name: /Mond und Dunkelheit der Nacht/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Nacht im Detail' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Mond & Planeten' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Sichtbarkeit von Mond und Planeten/ })).toBeVisible();
  const events = page.locator('section').filter({
    has: page.getByRole('heading', { level: 2, name: 'Ereignisse der Nacht' }),
  });
  await expect(events).toContainText('Satellitenbahnen Stand');
  await expect(events).toContainText('Die nächsten Finsternisse am Standort');
  await expect(
    page.getByRole('heading', { name: /Ungeprüfte Sessions|Offene Warteschlange/ }),
  ).toHaveCount(0);
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
