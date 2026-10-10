/**
 * AP-73: S-02 Startseite „Heute“ (Übersicht und „Heute Nacht“ zusammengelegt) gegen den lokalen Stack. Browserzone
 * `Europe/Berlin` (Playwright `timezoneId`), Standort `America/Chicago`: am 18.09.2026 um 09:00, 16:00 und 20:00 MESZ
 * zeigt „Heute“ die Nächte 17./18., 18./19. und 18./19.09. (rules/ui.md, NT-01). Die Serveruhr stellt das Cookie
 * `npm_test_now` je Anfrage (nur `AUTH_TEST_MODE`), die Browseruhr `page.clock` – die Nacht kommt trotzdem nur vom
 * Server. Zuerst wird das Rig gewählt (Auswahl per Liste, Rig in der URL); darunter fünf Kennzahlen, Zeitleiste mit
 * Aufklappern, Plan | Rig jetzt + Zu tun, Nächste Nächte, Aktive Projekte. `/heute-nacht` leitet mit Abfrage und Anker
 * auf `/` um; im Menü nur „Heute“. Lage per `boundingBox` bei 1440 und 768 px, axe hell/dunkel, 768/2400 px ohne
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
    await page.goto(`/?rig=${rigId}`);
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

/** Wartet, bis die Seitenhöhe 600 ms lang gleich bleibt (Karten laden nach; Prognose-Jobs fragen weiter ab). */
async function settled(page: Page) {
  let last = -1;
  let since = Date.now();
  await expect
    .poll(
      async () => {
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        if (h !== last) {
          last = h;
          since = Date.now();
        }
        return Date.now() - since >= 600;
      },
      { timeout: 15_000, intervals: [150] },
    )
    .toBe(true);
}

const box = async (l: ReturnType<Page['locator']>) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('nicht sichtbar');
  return b;
};

test('S-02: Kopf „Heute“, Rig zuerst wählen, Kennzahlen, Zeitleiste, Aufklapper, Plan, Rig jetzt, Zu tun', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await testLogin(page, 'owner');
  const { rigName, rigId } = await chicagoRig(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Heute' })).toBeVisible();
  await expect(page.getByText(/^Demo-Sternfreunde · /)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Neues Projekt' })).toHaveAttribute(
    'href',
    '/projekte/neu',
  );
  // Ein Menüpunkt „Heute“, aktiv auf der Startseite; „Heute Nacht“ und „Übersicht“ entfallen.
  const menu = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(menu.getByRole('link', { name: 'Heute', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(menu.getByRole('link', { name: /Heute Nacht|Übersicht/ })).toHaveCount(0);
  const context = page.getByRole('region', { name: 'Rig und Nacht' });
  // Die Startseite lädt nach (Plan, Zu tun, Prognose); erst danach die Rig-Liste öffnen, sonst schließt ein
  // Neuzeichnen sie vor dem Klick auf die Option.
  await settled(page);
  await context.getByRole('combobox', { name: 'Rig wählen' }).click();
  // Per Tastatur (Typeahead der Liste): mit vielen Test-Rigs liegt die Option sonst außerhalb des sichtbaren Teils.
  const option = page.getByRole('option', { name: new RegExp(rigName) });
  await page.keyboard.type(rigName);
  await expect(option).toBeFocused();
  await page.keyboard.press('Enter');
  // Ist das Test-Rig schon vorgewählt (frischer Stack, steht vorn in der Liste), ändert die Wahl die Adresse nicht.
  const combo = context.getByRole('combobox', { name: 'Rig wählen' });
  await expect(combo).toContainText(rigName);
  if (!page.url().includes(`rig=${rigId}`))
    expect(new URL(page.url()).searchParams.get('rig')).toBeNull();
  await expect(context).toContainText(`E2E-Heute`);
  await settled(page);
  const tiles = page.getByRole('list', { name: 'Kennzahlen der Nacht' }).getByRole('listitem');
  await expect(tiles).toHaveCount(5);
  await expect(tiles.nth(4)).toContainText('Rig jetzt');
  // Kachel „Dunkel“ (AP-73): nur nautisch und astronomisch in Standortzeit (CDT), die eigene Zeit (MESZ) dahinter.
  const twilight = tiles
    .first()
    .getByRole('table', { name: 'Nautische und astronomische Dämmerung der Nacht' });
  await expect(twilight.getByRole('row')).toHaveCount(4);
  await expect(twilight).toContainText('dahinter deine Zeit');
  await expect(twilight).not.toContainText('bürgerlich');
  // Lage gemessen: Tabelle innerhalb der Kachel; fünf Kacheln in einer Reihe, „Dunkel“ am breitesten.
  const tile = await box(tiles.first());
  const table = await box(twilight);
  expect(table.x + table.width).toBeLessThanOrEqual(tile.x + tile.width + 0.5);
  const boxes = await Promise.all((await tiles.all()).map((x) => box(x)));
  expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);
  for (const b of boxes.slice(1)) expect(tile.width).toBeGreaterThan(b.width * 1.3);
  const timeline = page.getByRole('group', { name: 'Zeitleiste der Nacht' });
  for (const lane of ['Himmel', 'Wetter', 'Mond', 'Plan', 'Ereignisse'])
    await expect(timeline.getByText(lane, { exact: true })).toBeVisible();
  const plan = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Plan für diese Nacht' }) });
  await expect(plan).toBeVisible();
  // Aufklapper unter der Zeitleiste: „Ereignisse der Nacht“ offen, die anderen erst beim Aufklappen.
  const events = page.getByRole('region', { name: 'Ereignisse der Nacht' });
  await expect(events).toContainText('Satellitenbahnen Stand');
  await expect(events).toContainText('Die nächsten Finsternisse am Standort');
  await expect(page.getByRole('img', { name: /Sichtbarkeit von Mond und Planeten/ })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: /Mond und Planeten – Sichtbarkeit/ }).click();
  await expect(page.getByRole('img', { name: /Sichtbarkeit von Mond und Planeten/ })).toBeVisible();
  // Aufklapper liegen zwischen Zeitleiste und Plan; gemessen erst, wenn alles nachgeladen ist.
  await settled(page);
  const t = await box(timeline);
  const e = await box(events);
  const p = await box(plan);
  expect(e.y).toBeGreaterThan(t.y + t.height);
  expect(p.y).toBeGreaterThan(e.y + e.height);
  // Plan links, rechts daneben „Rig jetzt“ über „Zu tun“.
  const live = page.getByRole('region', { name: 'Rig jetzt' });
  const todo = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Zu tun' }) });
  await expect(live).toBeVisible();
  await expect(todo).toBeVisible();
  const l = await box(live);
  const d = await box(todo);
  expect(l.x).toBeGreaterThanOrEqual(p.x + p.width);
  expect(Math.abs(l.y - p.y)).toBeLessThanOrEqual(2);
  expect(d.y).toBeGreaterThan(l.y + l.height);
  // Darunter „Nächste Nächte“ und „Aktive Projekte“ (eingeklappt).
  await expect(page.getByRole('heading', { level: 2, name: 'Nächste Nächte' })).toBeVisible();
  const projects = page.getByRole('button', { name: /Aktive Projekte/ });
  await expect(projects).toHaveAttribute('aria-expanded', 'false');
  await projects.click();
  await expect(projects).toHaveAttribute('aria-expanded', 'true');
  // Testmandant: Tabelle mit Restzeit bzw. Leerzustand.
  await expect(page.getByRole('region', { name: 'Aktive Projekte' })).toContainText(
    /Restzeit|Keine aktiven Projekte/,
  );
});

test('Tablet 768 px: „Dunkel“ über die volle Breite, Plan, Rig jetzt und Zu tun untereinander', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await testLogin(page, 'owner');
  await page.goto('/');
  // Erst messen, wenn Plan, Zu tun und Prognose nachgeladen sind (sonst wächst eine Karte zwischen zwei Messungen).
  await settled(page);
  const kpis = page.getByRole('list', { name: 'Kennzahlen der Nacht' });
  const tiles = kpis.getByRole('listitem');
  await expect(tiles).toHaveCount(5);
  const k = await box(kpis);
  const dark = await box(tiles.first());
  expect(Math.abs(dark.width - k.width)).toBeLessThanOrEqual(2);
  const [a, b] = [await box(tiles.nth(1)), await box(tiles.nth(2))];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2);
  expect(a.y).toBeGreaterThan(dark.y + dark.height);
  const plan = await box(
    page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'Plan für diese Nacht' }) }),
  );
  const live = await box(page.getByRole('region', { name: 'Rig jetzt' }));
  const todo = await box(
    page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'Zu tun' }) }),
  );
  expect(live.y).toBeGreaterThan(plan.y + plan.height);
  expect(todo.y).toBeGreaterThan(live.y + live.height);
  expect(Math.abs(live.x - plan.x)).toBeLessThanOrEqual(2);
});

test('/heute-nacht leitet mit Rig, Nacht und Anker auf die Startseite um', async ({ page }) => {
  await testLogin(page, 'owner');
  const { rigId } = await chicagoRig(page);
  await page.goto(`/heute-nacht?rig=${rigId}#naechste-naechte`);
  await expect(page).toHaveURL(`/?rig=${rigId}#naechste-naechte`);
  await expect(page.getByRole('heading', { level: 1, name: 'Heute' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-02 ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Heute' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expectNoSerious(page, `S-02 ${theme}`);
  });
}

for (const width of [768, 2400]) {
  test(`S-02 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Heute' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `S-02 @ ${String(width)}`).toBeLessThanOrEqual(0);
    expect(await tableOverflow(page)).toEqual([]);
  });
}
