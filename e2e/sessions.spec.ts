/**
 * AP-15/AP-64/AP-77: Nächte (S-60) und Nacht (S-61, ohne Reiter) gegen den lokalen Stack – eine Fake-Plugin-Nacht auf
 * einem eigenen Rig erscheint als Karte und vollständig in der Nacht: Session-Qualität, Hinweise (Kennzeichen Temperatur
 * und Einstellungen, nicht zugeordnet mit Zuordnen), Qualitätskurve, Qualität je Filter und Korrektur in den Details je
 * Projekt, Ereignisse eingeklappt; axe hell/dunkel, 768/2400 px ohne horizontales Scrollen, Lage per `boundingBox`.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { nightOnOwnRig } from './night-support';
import { WIDE, csrf, testLogin } from './support';

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

test('S-60/S-61: Fake-Plugin-Nacht vollständig, Aufnahme mit beiden Kennzeichen sichtbar', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { rigId, rigName, projectName } = await nightOnOwnRig(admin, user, baseURL ?? '');

  await admin.goto('/auswertung/naechte');
  await expect(admin.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();
  await admin.getByLabel('Rig', { exact: true }).selectOption(rigId);
  // Eine Karte je Nacht und Rig (Entscheidung Sven 07.10.2026): offline angelegte und laufende Session zusammen.
  const card = admin.getByRole('article', { name: new RegExp(rigName) });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('2 Sessions');
  await expect(card).toContainText('CDT');
  await expect(card).toContainText(projectName.slice(0, 10));
  await card.getByRole('link', { name: /öffnen$/ }).click();

  await expect(admin.getByRole('heading', { level: 1, name: new RegExp(rigName) })).toBeVisible();
  // Die Session der NINA-Instanz (die zweite der Nacht) wählen; Soll/Ist und Qualität je Projekt gelten je Session.
  await admin
    .getByRole('group', { name: 'Session wählen' })
    .getByRole('button', { name: /^Session 2/ })
    .click();
  // Keine Reiter und kein Prüfen mehr (AP-77).
  await expect(admin.getByRole('tab')).toHaveCount(0);
  await expect(admin.getByText('ungeprüft')).toHaveCount(0);
  await expect(admin.getByRole('region', { name: /^Session-Qualität/ })).toBeVisible();
  await expect(
    admin.getByText('Abweichende Aufnahmen: Temperatur 1 · Einstellungen 1 (Details in der CSV)'),
  ).toBeVisible();
  await expect(admin.getByText(/^Aufnahmen nicht zugeordnet: 1/)).toBeVisible();
  // Qualitätskurve (AP-72) in der Übersicht: Kennzahlen umschaltbar, Kurve so breit wie die Karte (Lage gemessen).
  const keys = admin.getByRole('group', { name: 'Kennzahlen der Kurve' });
  await expect(keys.getByRole('button', { name: 'Guiding-RMS' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await keys.getByRole('button', { name: 'Wolken' }).click();
  await expect(keys.getByRole('button', { name: 'Wolken' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const curve = await admin.getByRole('img', { name: /Qualitätskurve/ }).boundingBox();
  const qualityCard = await admin
    .getByRole('region', { name: 'Bildqualität über die Nacht' })
    .boundingBox();
  if (!curve || !qualityCard) throw new Error('Qualitätskurve oder Karte nicht sichtbar');
  expect(curve.x).toBeGreaterThanOrEqual(qualityCard.x);
  expect(curve.x + curve.width).toBeLessThanOrEqual(qualityCard.x + qualityCard.width + 1);
  await expectNoSerious(admin, 'S-61 Übersicht');

  // Qualität je Filter in den Details: Tabelle innerhalb der Karte „Ergebnis je Projekt“ (Lage gemessen).
  await admin.getByRole('button', { name: 'Details', exact: true }).click();
  const perFilter = admin.getByRole('table', { name: `Bildqualität je Filter von ${projectName}` });
  await expect(perFilter).toBeVisible();
  await expect(perFilter.getByRole('row').nth(1)).toContainText('2,10 px');
  const tableBox = await perFilter.boundingBox();
  const resultsBox = await admin.getByRole('region', { name: 'Ergebnis je Projekt' }).boundingBox();
  if (!tableBox || !resultsBox) throw new Error('Qualität je Filter nicht sichtbar');
  expect(tableBox.x + tableBox.width).toBeLessThanOrEqual(resultsBox.x + resultsBox.width + 1);
  await admin.getByRole('button', { name: 'Details schließen' }).click();

  // FA-AUS-06: Korrektur in den Details je Projekt (Regel max, Untergrenze = einzeln verworfen).
  await admin.getByRole('button', { name: 'Details', exact: true }).click();
  await admin.getByRole('button', { name: 'Korrektur', exact: true }).click();
  await admin.getByRole('spinbutton', { name: 'Verworfen' }).fill('1');
  await admin.getByLabel('Grund').selectOption('clouds');
  await admin.getByRole('button', { name: 'Korrektur speichern' }).click();
  await expect(admin.getByText('Korrektur gespeichert.')).toBeVisible();
  await expect(
    admin
      .getByText('Soll = erster Plan dieser Session (ohne Bonus), Ist = Aufnahmen dieser Session.')
      .first(),
  ).toBeVisible();
  const row = admin
    .getByRole('table', { name: `Soll/Ist ${projectName}` })
    .getByRole('row')
    .nth(1);
  // Spalten: Filter, Soll, Ist, (Verworfen nur bei Werten > 0), Akzeptiert, Integration, Aktion.
  // Ist = Aufnahmen dieser Session (07.10.2026). Die Korrektur gilt je Zeile und Nacht; ihren Überhang trägt die
  // früher begonnene (offline angelegte) Session der Nacht – hier bleibt Verworfen 0 und die Spalte entfällt.
  await expect(row.getByRole('cell').nth(2)).toHaveText('3');
  await expect(row.getByRole('cell').nth(3)).toHaveText('3');
  // Geschlossen und erneut geöffnet: die Korrektur zeigt den Nachtwert, nicht den der Session.
  await admin.getByRole('button', { name: 'Abbrechen' }).click();
  await admin.getByRole('button', { name: 'Korrektur', exact: true }).click();
  await expect(admin.getByRole('spinbutton', { name: 'Verworfen' })).toHaveValue('1');
  await admin.getByRole('button', { name: 'Abbrechen' }).click();

  // Ereignisse eingeklappt am Ende der Übersicht.
  await admin.getByText(/^Alle Ereignisse \(\d+\)$/).click();
  await expect(admin.getByRole('region', { name: 'Ereignisse' })).toBeVisible();

  // Nicht zugeordnete Aufnahme in der Übersicht zuordnen: danach verschwindet der Hinweis.
  await admin.getByRole('button', { name: 'Zuordnen', exact: true }).click();
  const form = admin.getByRole('form', { name: 'Nicht zugeordnete Aufnahmen' });
  await form.getByRole('combobox').selectOption({ index: 1 });
  await form.getByRole('button', { name: 'Zuordnen' }).click();
  await expect(admin.getByText(/^Aufnahmen nicht zugeordnet/)).toHaveCount(0);
});

test('AF-08: Projekt abschließen – NINA erhält es nicht mehr, „An NINA ausgeliefert“ zeigt es ausgegraut als heute abgearbeitet', async ({
  browser,
  baseURL,
}) => {
  const admin = await (await browser.newContext({ viewport: WIDE })).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const { rigId, projectId, projectName } = await nightOnOwnRig(admin, user, baseURL ?? '');

  await admin.goto('/nina/ausgeliefert');
  await admin.getByLabel('Rig', { exact: true }).selectOption(rigId);
  await expect(admin.getByRole('article', { name: projectName })).toBeVisible();

  // Aktiv → Bereit zur Bearbeitung → Abgeschlossen (projectStatusTransitions).
  for (const status of ['ready_to_process', 'completed'])
    expect(
      (
        await admin.request.put(`/api/web/v1/projects/${projectId}/status`, {
          headers: csrf,
          data: { status },
        })
      ).status(),
    ).toBe(200);
  await admin.getByRole('button', { name: 'Aktualisieren' }).click();
  // In dieser Nacht belichtet: bleibt ausgegraut als „Heute Nacht abgearbeitet“ stehen (07.10.2026), NINA erhält es nicht.
  const card = admin.getByRole('article', { name: projectName });
  await expect(card.getByText(/Heute Nacht abgearbeitet · \d+ Aufnahmen/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Aus Auslieferung nehmen' })).toHaveCount(0);
  await expect(admin.getByText('NINA erhält derzeit keine Ziele.')).toBeVisible();
  const delivery = await admin.request.get(`/api/web/v1/rigs/${rigId}/delivery`);
  const shipped = ((await delivery.json()) as { items: { id: string; doneTonight?: unknown }[] })
    .items;
  expect(shipped.filter((i) => !i.doneTonight)).toEqual([]);

  const listed = await admin.request.get(`/api/web/v1/projects?rigId=${rigId}`);
  const items = ((await listed.json()) as { items: { id: string; status: string }[] }).items;
  expect(items.find((p) => p.id === projectId)?.status).toBe('completed');
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-60 und S-61 ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    await page.goto('/auswertung/naechte?zeitraum=365');
    await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expectNoSerious(page, `S-60 ${theme}`);
    const link = page.getByRole('link', { name: /^Nacht .* öffnen$/ }).first();
    if ((await link.count()) > 0) {
      await link.click();
      await expect(page.getByRole('region', { name: 'Ergebnis je Projekt' }).first()).toBeVisible();
      await expectNoSerious(page, `S-61 ${theme}`);
    }
  });
}

for (const width of [768, 2400]) {
  test(`S-60 und S-61 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    await page.goto('/auswertung/naechte?zeitraum=365');
    await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow(), `S-60 @ ${String(width)}`).toBeLessThanOrEqual(0);
    const link = page.getByRole('link', { name: /^Nacht .* öffnen$/ }).first();
    if ((await link.count()) > 0) {
      await link.click();
      await expect(page.getByRole('region', { name: 'Ergebnis je Projekt' }).first()).toBeVisible();
      expect(await overflow(), `S-61 @ ${String(width)}`).toBeLessThanOrEqual(0);
      // Aufgeklappt: Qualität je Filter mit Verläufen bleibt in der Breite.
      await page.getByRole('button', { name: 'Details', exact: true }).first().click();
      expect(await overflow(), `S-61 Details @ ${String(width)}`).toBeLessThanOrEqual(0);
    }
  });
}
