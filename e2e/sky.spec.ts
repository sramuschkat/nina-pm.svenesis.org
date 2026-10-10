/**
 * AP-69 (S-65; FA-AUS-26 … FA-AUS-29): Auswertung „Himmel“ – Reiter mit erhaltenem Filter, Karte und Zeitachse mit
 * Testdaten (`/reports/sky` per `page.route`, die lokale Datenbank hat keine Aufnahmen über viele Nächte), Färbung in
 * der Adresse mit Legende, Tooltip und Klick auf ein Feld (→ S-31), Hervorheben zwischen Karte und Zeitachse, Klick auf
 * eine Nacht (→ S-61); Lage per `boundingBox` (Karte über der Zeitachse, volle Breite, keine Überlappung) bei 768 px
 * und breit, hell und dunkel; axe ohne serious/critical.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  defaultCenterRa,
  projectShape,
  toScreen,
  type ShapeInput,
} from '../apps/web/src/pages/sessions/sky-model';
import { WIDE, testLogin } from './support';

const RIG_A = '00000000-0000-4000-8000-0000000000a1';
const RIG_B = '00000000-0000-4000-8000-0000000000b2';
const pid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

type Mix = readonly (readonly [string, string, number])[];
const NB: Mix = [
  ['Ha', 'narrowband', 0.5],
  ['OIII', 'narrowband', 0.3],
  ['SII', 'narrowband', 0.2],
];
const BB: Mix = [
  ['L', 'luminance', 0.4],
  ['R', 'broadband', 0.2],
  ['G', 'broadband', 0.2],
  ['B', 'broadband', 0.2],
];
const OSC: Mix = [['UV/IR', 'uv_ir_cut', 1]];

function project(
  i: number,
  name: string,
  raDeg: number,
  decDeg: number,
  rigId: string | null,
  fovDeg: number | null,
  hours: number,
  mix: Mix,
) {
  return {
    id: pid(i),
    name,
    createdBy: pid(999),
    projectType: 'deep_sky',
    status: hours > 0 ? 'active' : 'planning',
    rigId,
    raDeg,
    decDeg,
    rotationDeg: 0,
    fov: fovDeg ? { widthDeg: fovDeg, heightDeg: fovDeg * 0.67 } : null,
    panels: [{ raDeg, decDeg, rotationDeg: 0 }],
    periodIntegrationS: hours * 3600,
    totalIntegrationS: hours * 3600 * 1.3,
    plannedS: 40 * 3600,
    percentDone: Math.min(100, hours * 3),
    byFilter:
      hours > 0
        ? mix.map(([filter, filterType, share]) => ({
            filter,
            filterType,
            integrationS: hours * 3600 * share,
          }))
        : [],
  };
}

const PROJECTS = [
  project(1, 'NGC 7000', 314.7, 44.3, RIG_A, 2.8, 24, NB),
  project(2, 'M 31', 10.7, 41.3, RIG_B, 3.4, 16, OSC),
  project(3, 'IC 1805', 38.2, 61.5, RIG_A, 2.8, 11, NB),
  project(4, 'M 42', 83.8, -5.4, RIG_B, 3.4, 3.5, OSC),
  project(5, 'M 81', 148.9, 69.1, RIG_A, 2.8, 7, BB),
  project(6, 'M 101', 210.8, 54.3, RIG_A, 2.8, 0, BB),
  project(7, 'M 51 ohne Rig', 202.5, 47.2, null, null, 0, BB),
];

const keys = (from: string, to: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/** Testantwort für den angefragten Zeitraum: zwei Rigs, Nächte mit Stapeln, Mond als Sinus der Phase. */
function report(from: string, to: string) {
  const nights = keys(from, to);
  return {
    from,
    to,
    generatedAt: `${to}T12:00:00Z`,
    rigs: [
      { id: RIG_A, name: 'Rig A' },
      { id: RIG_B, name: 'Rig B' },
    ],
    projects: PROJECTS,
    nights: nights.flatMap((night, i) =>
      i % 3 === 1
        ? []
        : [
            {
              rigId: RIG_A,
              night,
              projects: [
                { projectId: pid(1), integrationS: 3600 * (2 + (i % 4)) },
                { projectId: pid(3), integrationS: 3600 * 1.5 },
              ],
            },
            ...(i % 2 === 0
              ? [{ rigId: RIG_B, night, projects: [{ projectId: pid(2), integrationS: 3600 * 3 }] }]
              : []),
          ],
    ),
    moon: nights.map((night, i) => {
      const phaseDeg = (((i * 12.2) % 360) + 360) % 360;
      return {
        night,
        phaseDeg: Math.round(phaseDeg * 10) / 10,
        illumPct: Math.round(((1 - Math.cos((phaseDeg * Math.PI) / 180)) / 2) * 1000) / 10,
      };
    }),
  };
}

async function mockSky(page: Page) {
  await page.route('**/api/web/v1/reports/sky?*', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json: report(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? ''),
    });
  });
}

/** Bildschirmpunkt der Mitte eines Projekts auf der Karte (gleiche Rechnung wie die Seite, Zoom 1). */
async function centerOf(page: Page, id: string) {
  const canvas = page.getByTestId('all-sky-map');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Karte fehlt');
  const items = PROJECTS as unknown as ShapeInput[];
  const view = {
    width: Math.round(box.width),
    height: Math.round(box.height),
    zoom: 1,
    panX: 0,
    panY: 0,
    centerRa: defaultCenterRa(items),
  };
  const item = items.find((p) => p.id === id) as ShapeInput;
  const p = toScreen(view, projectShape(item, view.centerRa).center);
  return { x: box.x + p.x, y: box.y + p.y };
}

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

test('Reiter „Himmel“: Filter bleibt, Färbung in der Adresse, Tooltip, Klick öffnet Projekt und Nacht', async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await testLogin(page, 'owner');
  await mockSky(page);
  await page.goto('/auswertung/naechte?zeitraum=90');
  await page
    .getByRole('navigation', { name: 'Bereiche der Auswertung' })
    .getByRole('link', { name: 'Himmel' })
    .click();
  await expect(page).toHaveURL('/auswertung/himmel?zeitraum=90');
  await expect(page.getByText('7 Projekte · 5 mit Aufnahmen')).toBeVisible();

  // Legende je Färbung; „Filtermix“ steht in der Adresse.
  const legend = page.getByRole('list', { name: 'Legende der Karte' });
  await expect(legend.getByText('unter 2 h')).toBeVisible();
  await page.getByRole('button', { name: 'Filtermix' }).click();
  await expect(page).toHaveURL('/auswertung/himmel?zeitraum=90&farbe=filter');
  await expect(legend.getByText('Schmalband (SHO/HOO)')).toBeVisible();
  await expect(legend.getByText('ohne Aufnahmen im Zeitraum')).toBeVisible();

  // Tooltip über NGC 7000, Hervorheben in der Zeitachse (andere Projekte treten zurück).
  const ngc = await centerOf(page, pid(1));
  await page.mouse.move(ngc.x, ngc.y);
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('NGC 7000');
  await expect(tip).toContainText('24,0 h im Zeitraum');
  const stack = page.getByTestId('night-stack');
  await expect(stack.locator(`rect[data-project="${pid(3)}"]`).first()).toHaveCSS('opacity', '0.3');
  await expect(stack.locator(`rect[data-project="${pid(1)}"]`).first()).toHaveCSS('opacity', '1');

  // Umgekehrt: Projekt in der Zeitachse überfahren dimmt die übrigen.
  await page.mouse.move(5, 5);
  await stack
    .locator(`rect[data-project="${pid(3)}"]`)
    .first()
    .hover();
  await expect(stack.locator(`rect[data-project="${pid(1)}"]`).first()).toHaveCSS('opacity', '0.3');

  // Klick auf eine Nacht öffnet sie (S-61) mit dem Filter.
  await page.mouse.move(5, 5);
  const night = stack.getByRole('link').first();
  const nightLabel = (await night.getAttribute('aria-label')) ?? '';
  expect(nightLabel).toContain('Rig A');
  await night.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/auswertung/naechte/${RIG_A}/\\d{4}-\\d{2}-\\d{2}`));
  await page.goBack();

  // Klick auf das Feld öffnet das Projekt (S-31).
  const again = await centerOf(page, pid(1));
  await page.mouse.click(again.x, again.y);
  await expect(page).toHaveURL(`/projekte/${pid(1)}`);
});

for (const scheme of ['light', 'dark'] as const)
  for (const width of [768, 2400])
    test(`Lage ${scheme} ${String(width)} px: Karte über der Zeitachse, volle Breite, ohne Überlappung`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 1000 });
      await testLogin(page, 'owner');
      await page.addInitScript((s) => localStorage.setItem('npm.theme', s), scheme);
      await mockSky(page);
      await page.goto('/auswertung/himmel?zeitraum=90');
      await expect(page.getByText('7 Projekte · 5 mit Aufnahmen')).toBeVisible();
      const map = page.getByTestId('all-sky-map');
      const stack = page.getByTestId('night-stack');
      await expect(stack).toBeVisible();
      const card = (l: ReturnType<Page['getByTestId']>) =>
        l.locator('xpath=ancestor::section[1]').boundingBox();
      const [m, s, mapBox] = await Promise.all([card(map), card(stack), map.boundingBox()]);
      if (!m || !s || !mapBox) throw new Error('Karten fehlen');
      expect(m.y + m.height).toBeLessThanOrEqual(s.y);
      expect(Math.abs(m.width - s.width)).toBeLessThan(2);
      expect(Math.abs(m.x - s.x)).toBeLessThan(2);
      // Die Karte füllt ihre Karte (abzüglich Innenabstand); Hammer-Ellipse 2 : 1.
      expect(mapBox.width).toBeGreaterThan(m.width - 50);
      expect(mapBox.height).toBeGreaterThan(Math.min(mapBox.width / 2, 750 * 0.99) - 2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: test.info().outputPath(`sky-${scheme}-${String(width)}.png`),
        fullPage: true,
      });
      if (width === 2400) await expectNoSerious(page, `himmel ${scheme}`);
    });
