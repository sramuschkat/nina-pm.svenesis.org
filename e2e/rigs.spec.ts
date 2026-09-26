/**
 * AP-09c: S-10 Rigs gegen den lokalen Stack (Seed aus seed-demo.json): Rig anlegen und
 * Scheduler-Einstellungen speichern (seit AP-26i im Nacht-Simulator), 412 bei parallelem Speichern, Filterradbelegung mit Vorschlag
 * bestätigen, User nur lesend, 768/2400 px. Seit AP-26b: Rig-Liste links, Detail rechts mit Reitern
 * (Allgemein, Ausrüstung, Scheduler, Filterrad, NINA), *Neu* im Seitenkopf. Seit AP-26d stehen
 * *Löschen* und *Speichern* im Kopf der Rig-Karte; *Speichern* sendet das Formular des aktiven Reiters.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { csrf, testLogin } from './support';

async function pageAs(browser: Browser, fixture: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await testLogin(page, fixture);
  return page;
}

async function rigId(page: Page, prefix: string): Promise<string> {
  const { items } = (await (await page.request.get('/api/web/v1/rigs')).json()) as {
    items: { id: string; name: string }[];
  };
  const rig = items.find((r) => r.name.startsWith(prefix));
  if (!rig) throw new Error(`Rig ${prefix} fehlt`);
  return rig.id;
}

/** Reiter der Rig-Seite wählen (AP-26b). */
async function showTab(page: Page, name: string) {
  const tab = page
    .getByRole('tablist', { name: 'Rig-Bereiche' })
    .getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openRig(page: Page, name: RegExp) {
  await page.goto('/ausruestung/rigs');
  await expect(page.getByRole('heading', { level: 1, name: 'Rigs' })).toBeVisible();
  const item = page
    .getByRole('region', { name: 'Rigs', exact: true })
    .getByRole('button', { name })
    .first();
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'true');
}

test('S-10: Rig anlegen und Scheduler-Einstellungen speichern', async ({ page }) => {
  await testLogin(page, 'owner');
  await page.goto('/ausruestung/rigs');
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Neues Rig' })).toBeVisible();
  const name = `E2E-Rig ${String(Date.now())}`;
  await page.getByLabel('Name', { exact: true }).fill(name);
  await showTab(page, 'Ausrüstung');
  await page
    .getByRole('combobox', { name: 'Teleskop', exact: true })
    .selectOption({ label: 'RASA 8' });
  await page
    .getByRole('combobox', { name: 'Kamera', exact: true })
    .selectOption({ label: 'OSC 26MP' });
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.getByText('Einstellungsversion 1')).toBeVisible();
  // Das neue Rig steht in der Liste und ist gewählt.
  await expect(
    page.getByRole('region', { name: 'Rigs', exact: true }).getByRole('button', { name }),
  ).toHaveAttribute('aria-current', 'true');
  // Farbkamera: kein Filterrad-Bereich.
  await showTab(page, 'Filterrad');
  await expect(page.getByText('Farbkamera ohne Filterrad')).toBeVisible();

  // Scheduler: am Rig nur Zusammenfassung, bearbeitet wird im Nacht-Simulator (AP-26i).
  await showTab(page, 'Scheduler');
  await page.getByRole('link', { name: 'Im Simulator bearbeiten' }).click();
  await page.waitForURL(/\/nina\/simulator\?rig=[0-9a-f-]+&einstellungen=1/);
  const scheduler = page.getByRole('form', { name: 'Scheduler-Einstellungen' });
  await expect(scheduler).toBeVisible();
  await scheduler.getByLabel('Dither alle N Belichtungen').fill('3');
  await scheduler.getByLabel('Autofokus alle (min)').fill('0');
  await expect(scheduler.getByText('Autofokus aus')).toBeVisible();
  await scheduler.getByRole('button', { name: '„meiste Restarbeit“ nach oben' }).click();
  await expect(scheduler.getByLabel('Flat-Quelle')).toBeDisabled();
  await scheduler.getByLabel('Automatische Flats am Ende der Session').check();
  await scheduler.getByLabel('Flat-Quelle').selectOption({ label: 'Himmel' });
  await scheduler.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(scheduler.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();

  const id = await rigId(page, name);
  const rig = (await (await page.request.get(`/api/web/v1/rigs/${id}`)).json()) as {
    settingsVersion: number;
    scheduler: {
      ditherEvery: number;
      flatsEnabled: boolean;
      sortChain: string[];
      flatsSource: string;
      overhead: { afEveryMin: number };
    };
  };
  expect(rig.settingsVersion).toBe(2);
  expect(rig.scheduler).toMatchObject({
    ditherEvery: 3,
    flatsEnabled: true,
    flatsSource: 'sky',
    sortChain: ['lowest_peak_altitude', 'most_remaining', 'setting_soonest', 'constrained'],
    overhead: { afEveryMin: 0 },
  });
});

test('S-10: paralleles Speichern → 412 mit „Neu laden“, danach speicherbar', async ({
  browser,
}) => {
  const a = await pageAs(browser, 'owner');
  const b = await pageAs(browser, 'admin');
  // Scheduler-Einstellungen im Nacht-Simulator (AP-26i).
  const id = await rigId(a, 'Rig B');
  for (const p of [a, b]) await p.goto(`/nina/simulator?rig=${id}&einstellungen=1`);
  const formA = a.getByRole('form', { name: 'Scheduler-Einstellungen' });
  const formB = b.getByRole('form', { name: 'Scheduler-Einstellungen' });
  await formA.getByLabel('Überschuss (%)').fill('12');
  await formA.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(formA.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();

  await formB.getByLabel('Überschuss (%)').fill('20');
  await formB.getByRole('button', { name: 'Speichern', exact: true }).click();
  const conflict = formB.getByRole('alert');
  await expect(conflict).toContainText('Jemand anderes hat den Datensatz inzwischen geändert');
  await conflict.getByRole('button', { name: 'Neu laden' }).click();
  await expect(formB.getByLabel('Überschuss (%)')).toHaveValue('12');
  await formB.getByLabel('Überschuss (%)').fill('20');
  await formB.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(formB.getByRole('status').filter({ hasText: 'Gespeichert.' })).toBeVisible();
});

test('FA-RIG-14: Filterradbelegung mit Vorschlägen bestätigen; User nur lesend', async ({
  browser,
}) => {
  const owner = await pageAs(browser, 'owner');
  const id = await rigId(owner, 'Rig A');
  const report = await owner.request.post('/api/auth/test-nina-filter-wheel', {
    data: {
      rigId: id,
      slots: ['L', 'R', 'G', 'B', 'Ha 3nm', 'OIII', 'SII 3nm'].map((name, i) => ({
        position: i + 1,
        name,
        focusOffset: 0,
      })),
    },
    headers: csrf,
  });
  expect(report.status()).toBe(200);

  await openRig(owner, /^Rig A/);
  await showTab(owner, 'Filterrad');
  const wheel = owner.getByRole('region', { name: 'Filterradbelegung – Zuordnung zu NINA' });
  await expect(wheel.getByLabel('NINA-Filtername an Platz 5')).toHaveValue('Ha 3nm');
  await expect(wheel.getByText('Vorschlag – nicht bestätigt')).toHaveCount(7);
  await wheel.getByRole('button', { name: 'Alle Vorschläge bestätigen' }).click();
  const dialog = owner.getByRole('alertdialog', { name: '7 Vorschläge bestätigen?' });
  await dialog.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(wheel.getByText('bestätigt', { exact: true })).toHaveCount(7);

  const user = await pageAs(browser, 'user1');
  await openRig(user, /^Rig A/);
  await showTab(user, 'Filterrad');
  const userWheel = user.getByRole('region', { name: 'Filterradbelegung – Zuordnung zu NINA' });
  await expect(userWheel.getByLabel('NINA-Filtername an Platz 5')).toBeDisabled();
  await expect(userWheel.getByRole('button', { name: 'Bestätigen' })).toHaveCount(0);
  await expect(user.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
  const denied = await user.request.put(`/api/web/v1/rigs/${id}/filter-wheel`, {
    data: { slots: [] },
    headers: csrf,
  });
  expect(denied.status()).toBe(403);
});

for (const width of [768, 2400]) {
  test(`S-10 bei ${String(width)} px ohne horizontales Scrollen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await testLogin(page, 'owner');
    await openRig(page, /^Rig A/);
    await showTab(page, 'Filterrad');
    await expect(
      page.getByRole('region', { name: 'Filterradbelegung – Zuordnung zu NINA' }),
    ).toBeVisible();
    for (const tab of ['Allgemein', 'Ausrüstung', 'Scheduler', 'Filterrad', 'NINA']) {
      await showTab(page, tab);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, tab).toBeLessThanOrEqual(0);
    }
  });
}
