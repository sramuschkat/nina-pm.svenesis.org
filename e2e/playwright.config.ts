/**
 * Playwright (TK 17, AP-06a): prod-naher lokaler Stack – die **gebaute** SPA (mit Bausteinübersicht
 * `VITE_GALLERY=1`) hinter einem Server mit den Headern aus iam.md §10 und die API im Node-Adapter mit
 * Test-Login und PGlite (kein Docker). Browserzone Europe/Berlin (rules/ui.md, Zeitzonen-Tests).
 * `pnpm e2e` – alle Tests; `pnpm test:a11y` – nur die axe-Prüfungen.
 */
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 8787;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Je Shard ein Worker (ein lokaler Stack, eine Datenbank); `fullyParallel` verteilt beim Sharden einzelne
  // Tests statt ganzer Dateien, damit die CI-Shards gleich lang laufen. Tests hängen nicht voneinander ab.
  fullyParallel: true,
  workers: 1,
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
      command: 'pnpm --filter @nina-pm/web build:e2e && pnpm exec tsx e2e/server.ts',
      cwd: '..',
      url: `http://localhost:${WEB_PORT}/datenschutz`,
      env: { PORT: String(WEB_PORT), API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
