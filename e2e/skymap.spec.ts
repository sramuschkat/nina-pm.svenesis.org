/**
 * AP-21: S-20 Sternkarte gegen den lokalen Stack – Karte mit Bildfeld, Ziehen des Bildfelds (Koordinaten
 * folgen, FA-FRM-04), Seitenleiste, Zeitsteuerung, *Neues Projekt* übernimmt Koordinaten, Rotation und Rig
 * (FA-FRM-12); Bewertung *Beste der Nacht* in der Tabelle von S-21 (FA-FRM-13); axe hell/dunkel, 768/2400 px ohne
 * horizontales Scrollen. Ohne Himmelsfotos (`foto=keins`), damit der Test nicht vom CDS-Netz abhängt.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { WIDE, testLogin } from './support';

const ORION =
  '/planung/sternkarte?ra=83.82&dec=-5.39&fov=4&fra=83.82&fdec=-5.39&t=1797368400&foto=keins';

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('S-20: Bildfeld ziehen, Koordinaten folgen; Neues Projekt übernimmt Framing', async ({
  page,
}) => {
  await testLogin(page, 'user1');
  await page.goto(ORION);
  await expect(page.getByRole('heading', { level: 1, name: 'Sternkarte' })).toBeVisible();
  // Erst messen, wenn alle Daten (u. a. das Nachtdiagramm unter der Karte) geladen sind – kein Layoutwechsel mehr.
  await page.waitForLoadState('networkidle');
  const map = page.getByRole('img', { name: 'Sternkarte mit Bildfeld des Rigs' });
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  if (!box) throw new Error('Karte ohne Größe');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy - 40, { steps: 5 });
  await page.mouse.up();
  await expect(page).toHaveURL(/fra=83\.[0-7]/);
  const url = new URL(page.url());
  const fra = Number(url.searchParams.get('fra'));
  const fdec = Number(url.searchParams.get('fdec'));
  expect(fra).toBeLessThan(83.82); // nach rechts = West
  expect(fdec).toBeGreaterThan(-5.39); // nach oben = Nord
  expect(url.searchParams.get('ra')).toBe('83.82'); // Ansicht bleibt

  await page.getByRole('link', { name: 'Neues Projekt' }).click();
  await page.waitForURL(/\/projekte\/neu\?/);
  const q = new URL(page.url()).searchParams;
  expect(Number(q.get('ra'))).toBeCloseTo(fra, 5);
  await expect(page.getByLabel('Rektaszension (J2000)')).not.toHaveValue('');
});

test('S-20: Seitenleiste und Zeitsteuerung', async ({ page }) => {
  await testLogin(page, 'user1');
  await page.goto(ORION);
  // AP-26k: Seitenbereich tatsächlich rechts neben der Karte (gleiche Oberkante), Objektbereich darunter.
  const aside = page.getByRole('complementary', { name: 'Bildfeld, Mosaik und Ebenen' });
  const mapBox = await page
    .getByRole('img', { name: 'Sternkarte mit Bildfeld des Rigs' })
    .boundingBox();
  const sideBox = await aside.boundingBox();
  const belowBox = await page
    .getByRole('region', { name: 'Gewähltes Objekt und Nacht' })
    .boundingBox();
  expect(mapBox && sideBox && belowBox).toBeTruthy();
  if (mapBox && sideBox && belowBox) {
    expect(sideBox.x).toBeGreaterThanOrEqual(mapBox.x + mapBox.width - 1);
    expect(Math.abs(sideBox.y - mapBox.y)).toBeLessThan(40);
    expect(belowBox.y).toBeGreaterThan(mapBox.y + mapBox.height - 1);
  }
  await page.getByRole('tab', { name: 'Ebenen', exact: true }).click();
  await aside.getByRole('tab', { name: 'Overlays' }).click();
  // Der Zustand steht in der URL; das Häkchen folgt nach der Navigation.
  await aside.getByRole('checkbox', { name: 'Galaktisch' }).click();
  await expect(aside.getByRole('checkbox', { name: 'Galaktisch' })).toBeChecked();
  await expect(page).toHaveURL(/ebenen=[^&]*galactic/);
  await page.getByRole('button', { name: '+1 h' }).click();
  await expect(page).toHaveURL(/t=1797372000/);
  await expect(page.getByText(/^Mond -?\d+° · \d+° Abstand · \d+ %$/)).toBeVisible();
  await expectNoSerious(page, 'S-20');
});

test('S-21: eine Tabelle, mit Rig nach Bewertung „Beste der Nacht“, Filterempfehlung', async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await testLogin(page, 'user1');
  await page.goto('/planung/objekte?nacht=2026-12-15&kandidaten=1');
  await expect(page.getByRole('tab', { name: 'Beste der Nacht' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Bewertung' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  const first = page.getByRole('row').nth(1);
  await expect(first).toContainText(/\d+ %/);
  await expect(first).toContainText(/Schmalband|Breitband/);
  await expectNoSerious(page, 'S-21 Beste der Nacht');
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-20 ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await page.goto(ORION);
    await expect(page.getByRole('img', { name: 'Sternkarte mit Bildfeld des Rigs' })).toBeVisible();
    await expectNoSerious(page, `S-20 ${theme}`);
  });
}

for (const width of [768, 2400]) {
  test(`S-20 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await testLogin(page, 'owner');
    await page.goto(ORION);
    await expect(page.getByRole('img', { name: 'Sternkarte mit Bildfeld des Rigs' })).toBeVisible();
    expect(await overflow(page), `S-20 @ ${String(width)}`).toBeLessThanOrEqual(0);
  });
}

test('S-20: gleiche Kontextleiste wie der Objektbrowser; Mond und Dunkelheit, Klick stellt die Uhrzeit', async ({
  page,
}) => {
  await testLogin(page, 'owner');
  await page.goto('/planung/sternkarte');
  const context = page.getByRole('region', { name: 'Rig und Nacht' });
  await expect(context.getByRole('button', { name: /^Nacht ab dem Abend des/ })).toBeVisible();
  await expect(context.locator('input[type="date"]')).toHaveCount(0);
  await expect(context.getByRole('button', { name: 'Heute Nacht' })).toBeVisible();
  const clock = context.getByLabel('Uhrzeit');
  const strip = page.getByRole('img', { name: /Mond und Dunkelheit der Nacht/ });
  await expect(strip).toBeVisible();
  const box = await strip.boundingBox();
  if (!box) throw new Error('Streifen ohne Maße');
  await strip.click({ position: { x: box.width / 2, y: box.height / 2 } });
  // Mitte des Fensters (1 h vor Sonnenuntergang bis 1 h nach Aufgang) liegt nach Mitternacht.
  await expect(clock).toHaveValue(/^0[0-3]:\d\d$/);
  await expect(page.getByText('eingestellte Uhrzeit')).toBeVisible();
});
