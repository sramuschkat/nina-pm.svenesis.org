/**
 * Playwright-Grundgerüst (TK 17, CC-5): lokaler Stack aus Vite (Web) und dem Node-Adapter der API mit
 * Test-Login und PGlite (kein Docker nötig). AP-06a erweitert die Tests für die Oberfläche.
 */
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 8787;
const WEB_PORT = 5173;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]]
    : 'list',
  outputDir: '../test-results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    timezoneId: 'Europe/Berlin',
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Lokal ohne passenden Playwright-Browser: PW_CHANNEL=chrome nutzt das installierte Chrome.
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev:api',
      cwd: '..',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { AUTH_TEST_MODE: 'true', PORT: String(API_PORT), POWERTOOLS_LOG_LEVEL: 'WARN' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev:web',
      cwd: '..',
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
