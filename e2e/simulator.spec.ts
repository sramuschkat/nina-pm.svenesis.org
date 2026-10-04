/**
 * AP-13f: S-40 Nacht-Simulator gegen den lokalen Stack. Browserzone Europe/Berlin (Konfiguration),
 * Standort America/Chicago: Nacht 17./18.09.2026 zeigt Blockzeiten in CDT, der Plan-Hash des Browsers
 * (Web Worker) ist gleich dem Node-Lauf mit der Server-Tabelle (NT-46). Dazu axe hell/dunkel, 768/2400 px.
 * AP-26b/26g: Ergebnis zuerst auf einer Seite (Zielkarten, Nachtplan, Planprotokoll, Prüfungen), Einstellungen
 * über den Schalter *Einstellungen* einklappbar (bei Rig und Nacht in der URL zugeklappt).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { planNight, type PlanInput } from '../packages/engine/src';
import { buildPlanInput } from '../packages/shared/src';
import { csrf, testLogin } from './support';

const NIGHT = '2026-09-17';
const STARFRONT = { latitudeDeg: 31.5471, longitudeDeg: -99.3823, elevationM: 400 };

const json = async <T>(page: Page, url: string): Promise<T> => {
  const res = await page.request.get(url);
  expect(res.status(), url).toBe(200);
  return (await res.json()) as T;
};

/** Standort Starfront (America/Chicago), eigenes Rig, ein freigegebenes aktives Projekt mit Ha. */
async function setup(admin: Page, user: Page) {
  const stamp = String(Date.now());
  const siteId = crypto.randomUUID();
  expect(
    (
      await admin.request.post('/api/web/v1/sites', {
        headers: csrf,
        data: {
          id: siteId,
          name: `E2E-Starfront ${stamp}`,
          ...STARFRONT,
          timeZone: 'America/Chicago',
        },
      })
    ).status(),
  ).toBe(201);
  const telescopes = await json<{ items: { id: string }[] }>(admin, '/api/web/v1/telescopes');
  const cameras = await json<{ items: { id: string }[] }>(admin, '/api/web/v1/cameras');
  const rigId = crypto.randomUUID();
  expect(
    (
      await admin.request.post('/api/web/v1/rigs', {
        headers: csrf,
        data: {
          id: rigId,
          name: `E2E-Rig ${stamp}`,
          siteId,
          telescopeId: telescopes.items[0]?.id,
          cameraId: cameras.items[0]?.id,
          hasRotator: true,
        },
      })
    ).status(),
  ).toBe(201);
  const filters = await json<{ items: { id: string; shortName: string }[] }>(
    user,
    '/api/web/v1/filters',
  );
  const projectId = crypto.randomUUID();
  const name = `E2E-Simulator ${stamp}`;
  const created = await user.request.post('/api/web/v1/projects', {
    headers: csrf,
    data: { id: projectId, name, rigId, raDeg: 13.2046, decDeg: 56.6297 },
  });
  expect(created.status()).toBe(201);
  const panel = ((await created.json()) as { panels: { id: string }[] }).panels[0]?.id;
  expect(
    (
      await user.request.post(`/api/web/v1/projects/${projectId}/lines`, {
        headers: csrf,
        data: {
          id: crypto.randomUUID(),
          panelId: panel,
          filterId: filters.items.find((f) => f.shortName === 'Ha')?.id,
          exposureS: 300,
          plannedCount: 40,
          moonMode: 'none',
        },
      })
    ).status(),
  ).toBe(201);
  // Zweite Zeile mit mitgeliefertem Mondprofil: Zielkarte nennt es übersetzt („Mond: Entspannt“, 30.09.2026).
  const profiles = await json<{ items: { id: string; name: string }[] }>(
    user,
    '/api/web/v1/moon-profiles',
  );
  expect(
    (
      await user.request.post(`/api/web/v1/projects/${projectId}/lines`, {
        headers: csrf,
        data: {
          id: crypto.randomUUID(),
          panelId: panel,
          filterId: filters.items.find((f) => f.shortName === 'OIII')?.id,
          exposureS: 300,
          plannedCount: 20,
          moonMode: 'profile',
          moonProfileId: profiles.items.find((m) => m.name === 'moonProfile.relaxed')?.id,
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await user.request.post(`/api/web/v1/projects/${projectId}/submit`, {
        headers: csrf,
        data: {},
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await admin.request.post(`/api/web/v1/projects/${projectId}/approve`, {
        headers: csrf,
        data: { rigId, status: 'active' },
      })
    ).status(),
  ).toBe(200);
  return { siteId, rigId, projectId, name };
}

/** Node-Lauf mit denselben API-Daten und der Nacht-Tabelle des Servers (NT-46). */
async function nodeHash(page: Page, s: { siteId: string; rigId: string; projectId: string }) {
  const rigs = await json<{
    items: { id: string; scheduler: { overhead: { afEveryMin: number } } }[];
  }>(page, '/api/web/v1/rigs');
  const rig = rigs.items.find((r) => r.id === s.rigId);
  const project = await json<unknown>(page, `/api/web/v1/projects/${s.projectId}`);
  const moon = await json<{ items: unknown[] }>(page, '/api/web/v1/moon-profiles');
  const nights = await json<unknown>(
    page,
    `/api/web/v1/sites/${s.siteId}/nights?count=2&from=${NIGHT}`,
  );
  const input = buildPlanInput(
    rig as never,
    [project] as never,
    moon.items as never,
    nights as never,
    // Wie der Simulator: AF-Intervall des Rigs (FA-SIM-05).
    { night: NIGHT, site: STARFRONT, autofocusAfterTimeMin: rig?.scheduler.overhead.afEveryMin },
  );
  return planNight(input as PlanInput).outputHash;
}

test('S-40: Plan für die Seed-Daten, Blockzeiten in CDT, Hash = Node-Lauf', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await testLogin(admin, 'owner');
  const user = await (await browser.newContext()).newPage();
  await testLogin(user, 'user1');
  const s = await setup(admin, user);

  await admin.goto(`/nina/simulator?rig=${s.rigId}&nacht=${NIGHT}`);
  await expect(admin.getByRole('heading', { level: 1, name: 'Nacht-Simulator' })).toBeVisible();
  const hash = admin.getByText(/^Plan-Hash sha256:/);
  await expect(hash).toBeVisible({ timeout: 20_000 });
  // Ergebnis zuerst, Einstellungen zugeklappt.
  await expect(admin.getByRole('button', { name: 'Einstellungen', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  // Ergebnis auf einer Seite (AP-26g): Zielkarten, Nachtplan, Planprotokoll untereinander.
  await expect(
    admin.getByRole('heading', { level: 2, name: /Nachtplan \(Standortzeit CDT\)/ }),
  ).toBeVisible();
  const card = admin.getByRole('article', { name: s.name });
  await expect(card).toBeVisible();
  // Browser in Europe/Berlin, Standort in Chicago: Zeiten in Standortzeit mit Kürzel CDT.
  await expect(card).toContainText(/\d\d:\d\d CDT – \d\d:\d\d CDT/);
  // Mondprofil der Zeile mit Namen statt Kürzel „LA“; Tooltip nennt Abstand und Breite.
  const moonTag = card.getByText('Mond: Entspannt');
  await expect(moonTag).toBeVisible();
  await expect(moonTag).toHaveAttribute('title', /^Mondvermeidung „Entspannt“: bis \d+° Abstand/);
  await expect(card.getByText('LA', { exact: true })).toHaveCount(0);
  await card.screenshot({ path: 'test-results/simulator-card-moon.png' });
  await expect(admin.getByRole('cell', { name: /CDT$/ }).first()).toBeVisible();
  expect(await hash.textContent()).toBe(`Plan-Hash ${await nodeHash(admin, s)}`);

  // Speichern als night_plan (TK 7.2).
  await admin.getByRole('button', { name: 'Plan speichern' }).click();
  await expect(admin.getByText('Plan gespeichert.')).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-40 a11y ${theme}, 768/2400 px ohne horizontales Scrollen`, async ({ browser }) => {
    const admin = await (await browser.newContext()).newPage();
    await admin.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(admin, 'owner');
    const user = await (await browser.newContext()).newPage();
    await testLogin(user, 'user1');
    const s = await setup(admin, user);
    await admin.goto(`/nina/simulator?rig=${s.rigId}&nacht=${NIGHT}`);
    await expect(admin.getByText(/^Plan-Hash sha256:/)).toBeVisible({ timeout: 20_000 });
    const result = await new AxeBuilder({ page: admin }).analyze();
    const serious = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    // Aufgeklappte Einstellungen und Protokoll dürfen ebenfalls nicht waagerecht scrollen.
    await admin.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await expect(admin.getByRole('button', { name: 'Einstellungen', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const expanded = await new AxeBuilder({ page: admin }).analyze();
    expect(
      expanded.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => v.id),
    ).toEqual([]);
    for (const width of [768, 2400]) {
      await admin.setViewportSize({ width, height: 900 });
      const overflow = await admin.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${String(width)} px`).toBeLessThanOrEqual(0);
    }
  });
}
