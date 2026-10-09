/**
 * AP-35: S-02 „Heute Nacht“ gegen den lokalen Stack. Browserzone `Europe/Berlin` (Playwright `timezoneId`),
 * Standort `America/Chicago`: am 18.09.2026 um 09:00, 16:00 und 20:00 MESZ zeigt „Heute Nacht“ die Nächte
 * 17./18., 18./19. und 18./19.09. (rules/ui.md, NT-01). Die Serveruhr stellt das Cookie `npm_test_now` je
 * Anfrage (nur `AUTH_TEST_MODE`), die Browseruhr `page.clock` – die Nacht kommt trotzdem nur vom Server.
 * Zuerst wird das Rig gewählt (Umbau 27./28.09.2026): Auswahl per Liste, Rig in der URL; darunter
 * Einschätzung, Kennzahlen, Zeitleiste der Nacht, direkt darunter eingeklappt „Nachtwetter im Detail“ und die
 * Sichtbarkeit von Mond & Planeten, dann Plan und Ereignisse. Dazu axe hell/dunkel und 768/2400 px ohne
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
    // Rig-Zeit oben, darunter die Zeit des Users (Browserzone Europe/Berlin).
    const timeline = page.getByRole('group', { name: 'Zeitleiste der Nacht' });
    await expect(timeline).toContainText('Standort CDT');
    await expect(timeline).toContainText('Bei dir MESZ');
  }
  await page.context().clearCookies({ name: 'npm_test_now' });
});

test('S-02: Rig zuerst wählen, dann Kennzahlen, Zeitleiste, Plan, Ereignisse; Details eingeklappt', async ({
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
  const tiles = page.getByRole('list', { name: 'Kennzahlen der Nacht' }).getByRole('listitem');
  await expect(tiles).toHaveCount(4);
  // Kachel „Dunkel“ (09.10.2026): Dämmerungstabelle in Standortzeit (CDT), darunter die eigene Zeit (Browser MESZ).
  const twilight = tiles.first().getByRole('table', { name: 'Sonne und Dämmerungen der Nacht' });
  await expect(twilight.getByRole('row')).toHaveCount(6);
  await expect(twilight).toContainText('darunter deine Zeit');
  // Lage gemessen: Tabelle innerhalb der Kachel, alle Kacheln gleich hoch in einer Reihe.
  const tile = await tiles.first().boundingBox();
  const table = await twilight.boundingBox();
  expect(tile && table && table.x + table.width <= tile.x + tile.width + 0.5).toBe(true);
  const boxes = await Promise.all((await tiles.all()).map((x) => x.boundingBox()));
  expect(new Set(boxes.map((b) => Math.round(b?.height ?? 0))).size).toBe(1);
  expect(new Set(boxes.map((b) => Math.round(b?.y ?? 0))).size).toBe(1);
  const timeline = page.getByRole('group', { name: 'Zeitleiste der Nacht' });
  for (const lane of ['Himmel', 'Wetter', 'Mond', 'Plan', 'Ereignisse'])
    await expect(timeline.getByText(lane, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Plan für diese Nacht' })).toBeVisible();
  // Eingeklappt: erst beim Aufklappen sichtbar.
  await expect(page.getByRole('img', { name: /Sichtbarkeit von Mond und Planeten/ })).toHaveCount(
    0,
  );
  await page.getByText('Mond und Planeten – Sichtbarkeit').click();
  await expect(page.getByRole('img', { name: /Sichtbarkeit von Mond und Planeten/ })).toBeVisible();
  await page.getByText('Nachtwetter im Detail').click();
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
