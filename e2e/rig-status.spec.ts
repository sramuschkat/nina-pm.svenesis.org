/**
 * AP-70: S-43 Rig-Zustand mit der Karte „Rig jetzt“ gegen den lokalen Stack – Heartbeat einer NINA-Instanz mit Gerätestatus
 * und SkyAlert-Wetter, Anzeige mit gemessener Lage (über der Telemetrie, volle Breite), axe hell/dunkel, 768 px ohne
 * horizontales Scrollen.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { csrf, testLogin } from './support';

/** Rig in Starfront mit einer NINA-Instanz, die einen Heartbeat mit Gerätestatus und Wetter geschickt hat. */
async function rigWithHeartbeat(page: Page) {
  const stamp = String(Date.now());
  const siteId = crypto.randomUUID();
  expect(
    (
      await page.request.post('/api/web/v1/sites', {
        headers: csrf,
        data: {
          id: siteId,
          name: `E2E-Zustand ${stamp}`,
          latitudeDeg: 31.5471,
          longitudeDeg: -99.3823,
          elevationM: 400,
          timeZone: 'America/Chicago',
        },
      })
    ).status(),
  ).toBe(201);
  const list = async (path: string) =>
    ((await (await page.request.get(`/api/web/v1/${path}`)).json()) as { items: { id: string }[] })
      .items;
  const rigId = crypto.randomUUID();
  expect(
    (
      await page.request.post('/api/web/v1/rigs', {
        headers: csrf,
        data: {
          id: rigId,
          name: `E2E-Zustand-Rig ${stamp}`,
          siteId,
          telescopeId: (await list('telescopes'))[0]?.id,
          cameraId: (await list('cameras'))[0]?.id,
        },
      })
    ).status(),
  ).toBe(201);
  const created = await page.request.post('/api/web/v1/nina-instances', {
    headers: csrf,
    data: { id: crypto.randomUUID(), rigId, name: 'SFRO' },
  });
  expect(created.status()).toBe(201);
  const { token } = (await created.json()) as { token: string };
  const hb = await page.request.post('/api/nina/v1/heartbeat', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      state: 'running',
      pluginVersion: '0.4.21',
      engineVersion: '0.6.0',
      camera: { temperatureC: -10, setPointC: -10, coolerOn: true, coolerPowerPct: 38 },
      filterWheel: [
        { position: 1, name: 'LUMINOS', focusOffset: 0 },
        { position: 2, name: 'RED', focusOffset: 0 },
      ],
      devices: {
        connected: {
          camera: true,
          mount: true,
          focuser: true,
          filterWheel: true,
          rotator: false,
          guider: true,
          safetyMonitor: true,
          weather: true,
          flatDevice: true,
          switch: true,
          dome: false,
        },
        focuser: { position: 2050, temperatureC: 17.4, moving: false },
        mountState: {
          pierSide: 'east',
          tracking: true,
          atPark: false,
          slewing: false,
          altitudeDeg: 42.5,
          azimuthDeg: 359.4,
        },
        guider: { rmsTotalArcsec: 0.62, rmsRaArcsec: 0.41, rmsDecArcsec: 0.46 },
        filter: 'LUMINOS',
        safe: true,
        weather: { cloudCoverPct: 0, skyQualityMag: 21.62, temperatureC: 11.2, dewPointC: 9.1 },
      },
      optics: {
        focalLengthMm: 2938,
        focalRatio: 6.8,
        pixelSizeUm: 3.76,
        sensorWidthPx: 9576,
        sensorHeightPx: 6388,
        cameraName: 'ZWO ASI6200MM Pro',
        telescopeName: 'CDK17',
        ninaVersion: '3.2.0.9001',
      },
    },
  });
  expect(hb.status()).toBe(200);
  return rigId;
}

async function expectNoSerious(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${label}: ${v.id}`)).toEqual([]);
}

test('S-43: „Rig jetzt“ mit Gerätestatus und Wetter über der Telemetrie, volle Breite', async ({
  page,
}) => {
  await testLogin(page, 'owner');
  const rigId = await rigWithHeartbeat(page);
  await page.goto(`/rig-zustand?rig=${rigId}`);
  const card = page.getByRole('region', { name: 'Rig jetzt' });
  await expect(card).toContainText('SFRO');
  await expect(card).toContainText('LUMINOS · keine Filter-Offsets in NINA');
  await expect(card).toContainText('21,62 mag/″²');
  await expect(card).toContainText('CDK17 · 2.938 mm · f/6,8 · 0,26″/px');
  await expect(
    card.getByRole('list', { name: 'Verbundene Geräte' }).getByRole('listitem'),
  ).toHaveCount(11);
  // AP-77: Das Wetter aus dem Heartbeat steht als Telemetrie-Quelle „Wettergerät“ (Verlauf) unter der Karte.
  const weather = page.getByRole('heading', { name: 'Verlauf Wettergerät' });
  await expect(weather).toBeVisible();
  // Lage gemessen: Karte über dem Telemetrie-Bereich, gleich breit wie die Leiste.
  const toolbar = await page.getByRole('group', { name: 'Zeitraum' }).locator('..').boundingBox();
  const box = await card.boundingBox();
  const below = await weather.boundingBox();
  if (!toolbar || !box || !below)
    throw new Error('Leiste, Karte oder Wetter-Verlauf nicht sichtbar');
  expect(box.y).toBeGreaterThan(toolbar.y);
  expect(box.y + box.height).toBeLessThanOrEqual(below.y);
  expect(Math.abs(box.width - toolbar.width)).toBeLessThanOrEqual(1);
});

for (const theme of ['light', 'dark'] as const) {
  test(`S-43 „Rig jetzt“ ohne serious/critical (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('npm.theme', t), theme);
    await testLogin(page, 'owner');
    const rigId = await rigWithHeartbeat(page);
    await page.goto(`/rig-zustand?rig=${rigId}`);
    await expect(page.getByRole('region', { name: 'Rig jetzt' })).toContainText('SFRO');
    await expectNoSerious(page, `S-43 ${theme}`);
  });
}

test('S-43 „Rig jetzt“ bei 768 px ohne horizontales Scrollen', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await testLogin(page, 'owner');
  const rigId = await rigWithHeartbeat(page);
  await page.goto(`/rig-zustand?rig=${rigId}`);
  await expect(page.getByRole('region', { name: 'Rig jetzt' })).toContainText('SFRO');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
