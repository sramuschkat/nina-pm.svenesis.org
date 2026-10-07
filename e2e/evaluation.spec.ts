/**
 * AP-64: Auswertung neu – Reiterwechsel Nächte | Projekte | Standort-Statistik mit erhaltenem Filter, alte Pfade leiten
 * um, Nacht öffnen, Prüfliste abarbeiten und als geprüft markieren, Aufnahmen nach Typ filtern, Kalender-Klick öffnet
 * die Nacht; axe hell/dunkel ohne serious/critical; 768 und 2400 px ohne horizontales Scrollen, Lage per
 * `boundingBox` gemessen (Karten, Kacheln, Kalender liegen im Fenster und nebeneinander, wo sie sollen).
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

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Formatiert einen Nacht-Schlüssel wie die Oberfläche („06./07.10.“). */
function nightLabel(night: string): string {
  const [y, m, d] = night.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const dd = (n: number) => String(n).padStart(2, '0');
  return next.getUTCMonth() + 1 === m
    ? `${dd(d)}./${dd(next.getUTCDate())}.${dd(m)}.`
    : `${dd(d)}.${dd(m)}./${dd(next.getUTCDate())}.${dd(next.getUTCMonth() + 1)}.`;
}

test('Reiterwechsel mit erhaltenem Filter; Standort-Statistik nimmt den Standort des Rigs', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { rigId, siteId } = await nightOnOwnRig(admin, user, baseURL ?? '');

  await admin.goto('/auswertung');
  await expect(admin).toHaveURL('/auswertung/naechte');
  await admin.getByLabel('Rig', { exact: true }).selectOption(rigId);
  await admin.getByLabel('Zeitraum', { exact: true }).selectOption('90');
  await expect(admin).toHaveURL(`/auswertung/naechte?rig=${rigId}&zeitraum=90`);
  const tabs = admin.getByRole('navigation', { name: 'Bereiche der Auswertung' });
  await tabs.getByRole('link', { name: 'Projekte' }).click();
  await expect(admin).toHaveURL(`/auswertung/projekte?rig=${rigId}&zeitraum=90`);
  await expect(admin.getByLabel('Rig', { exact: true })).toHaveValue(rigId);
  await expect(admin.getByLabel('Zeitraum', { exact: true })).toHaveValue('90');
  await tabs.getByRole('link', { name: 'Standort-Statistik' }).click();
  await expect(admin).toHaveURL(`/auswertung/standort?rig=${rigId}&zeitraum=90`);
  await expect(admin.getByLabel('Standort', { exact: true })).toHaveValue(siteId);
  await expect(admin.getByLabel('Zeitraum', { exact: true })).toHaveValue('90');
  // Zurück: der Filter bleibt.
  await admin.goBack();
  await expect(admin).toHaveURL(`/auswertung/projekte?rig=${rigId}&zeitraum=90`);
  // Menü „Auswertung“ führt auf Nächte.
  await admin
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Auswertung' })
    .click();
  await expect(admin).toHaveURL('/auswertung/naechte');
});

test('alte Pfade leiten um', async ({ page }) => {
  await testLogin(page, 'owner');
  const id = '00000000-0000-4000-8000-000000000001';
  await page.goto(`/auswertung/sessions?rig=${id}`);
  await expect(page).toHaveURL(`/auswertung/naechte?rig=${id}`);
  await page.goto(`/auswertung/sessions/${id}`);
  await expect(page).toHaveURL(`/auswertung/naechte/${id}`);
  await page.goto('/auswertung/projektbericht');
  await expect(page).toHaveURL('/auswertung/projekte');
  await page.goto('/auswertung/klarnacht');
  await expect(page).toHaveURL('/auswertung/standort');
  await page.goto('/auswertung/folgeplanung');
  await expect(page).toHaveURL('/heute-nacht#naechste-naechte');
});

test('Nacht öffnen, Prüfliste abarbeiten, als geprüft markieren; Aufnahmen nach Typ; Kalender öffnet die Nacht', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { rigId, rigName, projectName } = await nightOnOwnRig(admin, user, baseURL ?? '');

  await admin.goto(`/auswertung/naechte?rig=${rigId}`);
  const card = admin
    .getByRole('article', { name: new RegExp(rigName) })
    .filter({ hasNotText: 'offline angelegt' });
  await expect(card.getByText('ungeprüft')).toBeVisible();
  await card.getByRole('link', { name: /öffnen$/ }).click();
  await expect(admin.getByRole('heading', { level: 1, name: new RegExp(rigName) })).toBeVisible();

  // Prüfliste: Aufnahme ohne Zuordnung → zuordnen (über ⋯ je Zeile).
  const banner = admin.getByRole('region', { name: /Nacht prüfen/ });
  await expect(banner.getByText('Aufnahmen ohne Zuordnung: 1')).toBeVisible();
  await banner.getByRole('button', { name: 'zuordnen' }).click();
  await expect(admin).toHaveURL(/ansicht=aufnahmen/);
  const table = admin.getByRole('table', { name: 'Aufnahmen' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await table.getByRole('button', { name: /^Aktionen zur Aufnahme/ }).click();
  await admin.getByRole('menuitem', { name: 'Zuordnen' }).click();
  const form = admin.getByRole('form', { name: 'Nicht zugeordnete Aufnahmen' });
  await form.getByLabel(/Zeile für/).selectOption({ index: 1 });
  await form.getByRole('button', { name: 'Zuordnen' }).click();
  await expect(admin.getByRole('button', { name: /^Ohne Zuordnung 0/ })).toBeVisible();

  // Aufnahmen nach Typ: Anzahl im Chip = Zeilen der Tabelle.
  const chips = admin.getByRole('group', { name: 'Anzeigen' });
  for (const name of ['Lights', 'Flats', 'Alle']) {
    const chip = chips.getByRole('button', { name: new RegExp(`^${name} \\d+$`) });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    const count = Number((await chip.textContent())?.replace(/\D+/g, ''));
    if (count > 0) await expect(table.getByRole('row')).toHaveCount(count + 1);
  }
  await expectNoSerious(admin, 'Nacht Aufnahmen');

  // Zurück zur Übersicht: die Zuordnung ist erledigt, die Nacht wird als geprüft markiert.
  await admin.getByRole('tab', { name: 'Übersicht' }).click();
  await expect(banner.getByText(/einem Projekt zugeordnet/)).toBeVisible();
  await expect(
    admin.getByRole('region', { name: 'Ergebnis je Projekt' }).getByText(projectName),
  ).toBeVisible();
  await expectNoSerious(admin, 'Nacht Übersicht');
  await banner.getByRole('button', { name: 'Als geprüft markieren' }).click();
  await expect(banner).toHaveCount(0);
  await expect(admin.getByText('geprüft', { exact: true })).toBeVisible();

  // Verlauf & Notizen: Ereignisse als Zeitachse neben dem Protokoll.
  await admin.getByRole('tab', { name: 'Verlauf & Notizen' }).click();
  await expect(admin.getByRole('region', { name: 'Ereignisse' })).toContainText('CDT');
  await expect(admin.getByRole('heading', { name: 'Sitzungsprotokoll' })).toBeVisible();

  // Kalender-Klick öffnet die Nacht.
  const sessions = (await (
    await admin.request.get(`/api/web/v1/sessions?rigId=${rigId}`)
  ).json()) as { items: { id: string; night: string }[] };
  const night = sessions.items[0]?.night as string;
  await admin.getByRole('link', { name: '← Nächte' }).click();
  await expect(admin).toHaveURL(`/auswertung/naechte?rig=${rigId}`);
  await admin
    .getByRole('navigation', { name: 'Bereiche der Auswertung' })
    .getByRole('link', { name: 'Standort-Statistik' })
    .click();
  await admin
    .getByRole('button', { name: new RegExp(`^${nightLabel(night).replace(/\./g, '\\.')} · `) })
    .click();
  await expect(admin).toHaveURL(/\/auswertung\/naechte\/[0-9a-f-]{36}$/);
  await expect(admin.getByRole('heading', { level: 1, name: new RegExp(rigName) })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`Projekte und Standort-Statistik ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await page.goto('/auswertung/projekte?zeitraum=365');
    await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expectNoSerious(page, `Projekte ${theme}`);
    await page.goto('/auswertung/standort?zeitraum=90');
    await expect(page.getByRole('heading', { name: 'Nächte im Kalender' })).toBeVisible();
    await expectNoSerious(page, `Standort-Statistik ${theme}`);
    await page.goto('/heute-nacht');
    await expect(page.getByRole('heading', { level: 2, name: 'Nächste Nächte' })).toBeVisible();
    await expectNoSerious(page, `Nächste Nächte ${theme}`);
  });
}

for (const width of [768, 2400]) {
  test(`Auswertung bei ${String(width)} px ohne horizontales Scrollen, Lage gemessen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    await page.goto('/auswertung/naechte?zeitraum=365');
    await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();
    expect(await overflow(page), `Nächte @ ${String(width)}`).toBeLessThanOrEqual(0);
    // Kacheln: vier nebeneinander (breit) bzw. zwei je Zeile (schmal), alle im Fenster.
    const tiles = page.getByRole('region', { name: 'Kennzahlen' }).locator(':scope > *');
    await expect(tiles).toHaveCount(4);
    const boxes = await Promise.all([0, 1, 2, 3].map(async (i) => tiles.nth(i).boundingBox()));
    for (const b of boxes) expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(width);
    const sameRow = (a: number, b: number) => Math.abs((boxes[a]?.y ?? 0) - (boxes[b]?.y ?? 0)) < 2;
    expect(sameRow(0, 3), `Kacheln in einer Zeile @ ${String(width)}`).toBe(width >= 1280);
    expect(sameRow(0, 1)).toBe(true);
    // Karten der Nächte: so breit wie der Inhalt, nicht über den Rand.
    const card = page.getByRole('article').first();
    if ((await card.count()) > 0) {
      const b = await card.boundingBox();
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(b?.width ?? 0).toBeGreaterThan(width * 0.5);
    }
    await page.goto('/auswertung/projekte?zeitraum=365');
    await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();
    expect(await overflow(page), `Projekte @ ${String(width)}`).toBeLessThanOrEqual(0);
    await page.goto('/auswertung/standort?zeitraum=90');
    await expect(page.getByRole('heading', { name: 'Nächte im Kalender' })).toBeVisible();
    expect(await overflow(page), `Standort-Statistik @ ${String(width)}`).toBeLessThanOrEqual(0);
    // Kalender und Kacheln: breit nebeneinander, schmal untereinander.
    const calendar = await page.getByRole('heading', { name: 'Nächte im Kalender' }).boundingBox();
    const side = await page.getByRole('region', { name: 'Kennzahlen des Standorts' }).boundingBox();
    expect(
      Math.abs((calendar?.y ?? 0) - (side?.y ?? 0)) < 40,
      `nebeneinander @ ${String(width)}`,
    ).toBe(width >= 1280);
    const months = page.locator('table caption');
    await expect(months.first()).toBeAttached();
    for (const t of await page.locator('table').all()) {
      const b = await t.boundingBox();
      if (b) expect(b.x + b.width).toBeLessThanOrEqual(width);
    }
  });
}
