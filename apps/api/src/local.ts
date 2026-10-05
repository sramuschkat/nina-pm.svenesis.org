/**
 * Lokaler Node-Adapter (`pnpm dev:api`, Playwright-Stack; TK 17). **Nie im Lambda-Bundle** – die
 * Lambda-Einstiege liegen in src/handlers/, und nur hier gibt es den Test-Login
 * (`AUTH_TEST_MODE=true`, `POST /api/auth/test-login {identityFixture}`, Fixtures aus
 * docs/seed/seed-demo.json). Ebenfalls nur mit `AUTH_TEST_MODE`: die **Testuhr je Anfrage** über das Cookie
 * `npm_test_now` (ISO-Zeitpunkt; E2E „Heute Nacht“, AP-35). Datenbank: `DATABASE_URL` (PostgreSQL 16) oder ohne sie PGlite im
 * Speicher mit Demo-Seed. Aufbau in `local-stack.ts` (auch für den VM-Prüfstand); `LOCAL_TICK_S` schaltet den Takt wie
 * `tick-5min` ein.
 */
import { createLocalStack, listenLocal } from './local-stack';
import { logger } from './lib/logger';

const PORT = Number(process.env.PORT ?? 8787);
const tickS = Number(process.env.LOCAL_TICK_S ?? 0);

const stack = await createLocalStack({
  port: PORT,
  authTestMode: process.env.AUTH_TEST_MODE === 'true',
  databaseUrl: process.env.DATABASE_URL,
  discordMockUrl: process.env.DISCORD_MOCK_URL,
  liveThumbnails: process.env.LOCAL_THUMBNAILS === 'live',
  liveWeather: process.env.LOCAL_WEATHER === 'live',
  tickMs: tickS > 0 ? tickS * 1000 : undefined,
});

await listenLocal(stack.fetch, PORT);
logger.info('local_api', {
  port: PORT,
  authTestMode: process.env.AUTH_TEST_MODE === 'true',
  database: process.env.DATABASE_URL ? 'postgres' : 'pglite',
  tickS,
});
