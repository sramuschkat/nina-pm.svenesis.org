/**
 * Lokaler Node-Adapter (`pnpm dev:api`, Playwright-Stack; TK 17). **Nie im Lambda-Bundle** – die
 * Lambda-Einstiege liegen in src/handlers/, und nur hier gibt es den Test-Login
 * (`AUTH_TEST_MODE=true`, `POST /api/auth/test-login {identityFixture}`, Fixtures aus
 * docs/seed/seed-demo.json). Ebenfalls nur mit `AUTH_TEST_MODE`: die **Testuhr je Anfrage** über das Cookie
 * `npm_test_now` (ISO-Zeitpunkt; E2E „Heute Nacht“, AP-35). Datenbank: `DATABASE_URL` (PostgreSQL 16) oder ohne sie PGlite im
 * Speicher mit Demo-Seed.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import {
  AuditRepository,
  EquipmentRepository,
  ApprovalRepository,
  SimulationRepository,
  NinaInstanceRepository,
  NinaRigRepository,
  NinaSessionRepository,
  NinaIngestRepository,
  SessionReviewRepository,
  SessionLogRepository,
  ChangeRequestRepository,
  ninaTokenLookup,
  ninaTouch,
  ProjectRepository,
  AuthRepository,
  JobQueue,
  JobRepository,
  MemberRepository,
  NotificationRepository,
  PreferenceRepository,
  openDatabase,
  TenantAdminRepository,
  type OpenDatabase,
  readMaintenanceBanner,
  TenantRepository,
  latestWeather,
  saveWeather,
  siteNightRunDone,
  setProjectThumbnail,
  thumbnailKeyInUse,
  weatherSites,
} from '@nina-pm/db';
import { seedCore, seedEquipment, type SeedDemo } from '@nina-pm/db/seed';
import { openPglite } from '@nina-pm/db/testing/pglite';
import { COOKIE_NAMES, safeNext } from '@nina-pm/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { createApp } from './app';
import { parseIdList } from './auth/config';
import { httpDiscordClient } from './auth/discord';
import { establishSession } from './auth/login';
import { clearCookie, readCookie, verifyValue } from './lib/cookies';
import type { ApiEnv } from './lib/env';
import { logger } from './lib/logger';
import { problemResponse } from './lib/problem';
import type { ApiServices } from './routes/services';
import { effortJobHandler } from './worker/effort';
import { effortDbDeps } from './worker/effort-db';
import { memoryJobResultStore } from './files/job-results';
import { impactJobHandler, multiSimJobHandler } from './worker/multi-sim';
import { forecastDbDeps, multiSimDbDeps } from './worker/multi-sim-db';
import { forecastJobHandler } from './worker/forecast';
import {
  sessionCloseHandler,
  sessionReportHandler,
  type SessionJobDeps,
} from './worker/session-jobs';
import { JOB_HANDLERS, runJob, type JobRunnerDeps } from './worker/jobs';
import { catalogRefreshHandler, importCatalog } from './worker/catalog';
import { reconcileJobHandler } from './worker/session-ops';
import { httpClient } from './lib/http-client';
import { weatherJobHandler, weatherTick } from './weather/job';
import { sampleOpenMeteo } from './weather/sample';
import { thumbnailLoader } from './worker/thumbnail-db';
import { thumbnailJobHandler } from './worker/thumbnail';

const PORT = Number(process.env.PORT ?? 8787);
const AUTH_TEST_MODE = process.env.AUTH_TEST_MODE === 'true';
const LOCAL_ORIGIN_VERIFY = 'local-dev-origin-verify';

const seed = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../docs/seed/seed-demo.json', import.meta.url)),
    'utf8',
  ),
) as SeedDemo;

async function database(): Promise<OpenDatabase['db']> {
  if (process.env.DATABASE_URL) {
    return openDatabase({ kind: 'postgres', connectionString: process.env.DATABASE_URL }).db;
  }
  const pg = await openPglite();
  await seedCore(pg.admin, seed);
  await seedEquipment(
    new EquipmentRepository(pg.db, { tenantId: seed.tenant.id }),
    seed.tenant.id,
    seed,
    new Date(),
  );
  logger.info('local_db', { kind: 'pglite', seeded: true });
  return pg.db;
}

const db = await database();
// Objektkatalog (AP-20): lokal beim Start importieren, solange `dso_object` leer ist (prod: Job über S-82).
if (!(await db.selectFrom('dsoObject').select('id').limit(1).executeTakeFirst())) {
  await importCatalog(db, new Date());
  logger.info('local_catalog', { imported: true });
}
// Testuhr je Anfrage (nur AUTH_TEST_MODE, Cookie `npm_test_now`): E2E prüfen „Heute Nacht“ zu festen Zeiten,
// ohne die Uhr anderer Anfragen zu verstellen.
const testNow = new AsyncLocalStorage<Date>();
const TEST_NOW_COOKIE = 'npm_test_now';
const now = () => testNow.getStore() ?? new Date();
const queue = new JobQueue(db);
const localSessionJobs: SessionJobDeps = {
  db: () => Promise.resolve(db),
  enqueue: (tenantId, input) => new JobRepository(db, { tenantId }).enqueue(input),
};
// Vorschaubilder (AP-25) lokal im Speicher, ausgeliefert unter /catalog/thumbs/… (Vite leitet weiter);
// ohne LOCAL_THUMBNAILS=live ein graues Platzhalterbild statt eines CDS-Abrufs.
const localThumbs = new Map<string, Uint8Array>();
const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const localThumbnailHandler = thumbnailJobHandler({
  load: thumbnailLoader(() => Promise.resolve(db)),
  keyInUse: (key) =>
    Promise.resolve(localThumbs.has(key)).then(async (has) => has || thumbnailKeyInUse(db, key)),
  fetchImage: (url) =>
    process.env.LOCAL_THUMBNAILS === 'live'
      ? httpClient({ version: 'local' }).getBytes(url, { timeoutMs: 60_000 })
      : Promise.resolve({ bytes: new Uint8Array(PLACEHOLDER_JPEG), contentType: 'image/jpeg' }),
  put: (key, bytes) => {
    localThumbs.set(key, bytes);
    return Promise.resolve();
  },
  save: (tenantId, projectId, key) => setProjectThumbnail(db, tenantId, projectId, key),
});

// Ergebnisse von multi_sim/impact lokal im Speicher (AP-32a).
const localJobResults = memoryJobResultStore();
const localMultiSim = multiSimDbDeps(() => Promise.resolve(db), localJobResults.put);
const jobs: JobRunnerDeps = {
  queue: () => Promise.resolve(queue),
  handlers: {
    ...JOB_HANDLERS,
    effort: effortJobHandler(effortDbDeps(() => Promise.resolve(db))),
    session_close: sessionCloseHandler(localSessionJobs),
    session_report: sessionReportHandler(localSessionJobs),
    reconcile: reconcileJobHandler({ db: () => Promise.resolve(db) }),
    // Exoplaneten-Kataloge (AP-40) lokal nur über *Neu laden* in S-82, dann mit echten Abrufen.
    catalog_refresh: catalogRefreshHandler({
      db: () => Promise.resolve(db),
      fetchText: async (url, timeoutMs) =>
        new TextDecoder().decode(
          (await httpClient({ version: 'local' }).getBytes(url, { timeoutMs })).bytes,
        ),
    }),
    thumbnail: localThumbnailHandler,
    multi_sim: multiSimJobHandler(localMultiSim),
    impact: impactJobHandler(localMultiSim),
    forecast: forecastJobHandler(forecastDbDeps(() => Promise.resolve(db))),
    // Astro-Wetter (AP-23): lokal mit Beispieldaten, echte Open-Meteo-Abrufe nur mit LOCAL_WEATHER=live.
    weather: weatherJobHandler({
      http:
        process.env.LOCAL_WEATHER === 'live'
          ? httpClient({ version: 'local' })
          : sampleOpenMeteo(now),
      latest: (lat, lon) => latestWeather(db, lat, lon),
      save: (entry) => saveWeather(db, entry),
      site: (tenantId, siteId) => new EquipmentRepository(db, { tenantId }).site(siteId),
    }),
  },
};
// Wie `tick-5min`: beim Start und dann alle 5 min; je Ort höchstens ein Abruf je Viertelstunde.
const localWeatherTick = () =>
  weatherTick(
    {
      sites: () => weatherSites(db),
      enqueue: (tenantId, input) => new JobRepository(db, { tenantId }).enqueue(input),
      runDone: (tenantId, key) => siteNightRunDone(db, tenantId, key),
    },
    jobs,
    now(),
  ).catch((error: unknown) =>
    logger.warn('local_weather_failed', {
      error: error instanceof Error ? error.message : 'unbekannt',
    }),
  );
void localWeatherTick();
setInterval(() => void localWeatherTick(), 5 * 60_000).unref();
const services: ApiServices = {
  repositories: (ctx) => ({
    job: new JobRepository(db, ctx),
    member: new MemberRepository(db, ctx),
    preference: () => new PreferenceRepository(db, ctx),
    notification: () => new NotificationRepository(db, ctx),
    audit: () => new AuditRepository(db, ctx),
    equipment: () => new EquipmentRepository(db, ctx),
    projects: () => new ProjectRepository(db, ctx),
    approvals: () => new ApprovalRepository(db, ctx),
    simulations: () => new SimulationRepository(db, ctx),
    ninaInstances: () => new NinaInstanceRepository(db, ctx),
    ninaRig: (rigId: string) => new NinaRigRepository(db, ctx, rigId),
    ninaSession: (rigId: string, instanceId: string) =>
      new NinaSessionRepository(db, ctx, rigId, instanceId),
    ninaIngest: (rigId: string) => new NinaIngestRepository(db, ctx, rigId),
    sessionReview: () => new SessionReviewRepository(db, ctx),
    sessionLog: () => new SessionLogRepository(db, ctx),
    changeRequests: () => new ChangeRequestRepository(db, ctx),
    tenant: () => new TenantRepository(db, ctx),
  }),
  tenantAdmin: (actor) => new TenantAdminRepository(db, actor),
  auth: new AuthRepository(db),
  authConfig: {
    cookieSecret: () =>
      Promise.resolve(process.env.COOKIE_SECRET ?? 'local-dev-cookie-secret-not-for-prod'),
    discordClientId: () => Promise.resolve(process.env.DISCORD_CLIENT_ID ?? 'local'),
    discordClientSecret: () => Promise.resolve(process.env.DISCORD_CLIENT_SECRET ?? 'local'),
    bootstrapSuperUsers: () =>
      Promise.resolve(parseIdList(process.env.BOOTSTRAP_SUPER_USERS ?? '')),
    redirectUri: `http://localhost:${PORT}/api/auth/discord/callback`,
  },
  discord: httpDiscordClient(),
  downloads: {
    presignGet: (key) =>
      Promise.resolve({
        url: `http://localhost:${PORT}/local-files/${key}`,
        expiresAt: now().toISOString(),
      }),
  },
  tenantFiles: { deleteTenantFiles: () => Promise.resolve(0) },
  jobResults: localJobResults,
  maintenanceBanner: () => readMaintenanceBanner(db),
  // Jobs laufen lokal im selben Prozess (statt async Lambda-Invoke).
  uploads: {
    planLog: (tenantId, sessionId) =>
      Promise.resolve({
        url: 'http://localhost/plan-log',
        fields: { key: `tenant/${tenantId}/plans/${sessionId}.json.gz` },
      }),
  },
  db: db,
  nina: {
    lookup: (hash) => ninaTokenLookup(db, hash),
    touch: (p, at) => ninaTouch(db, p, at),
  },
  jobInvoker: {
    invoke: (jobId) => {
      setImmediate(() => void runJob(jobs, jobId));
      return Promise.resolve();
    },
  },
  now,
};

const app = createApp({
  originVerifyValue: () => Promise.resolve(LOCAL_ORIGIN_VERIFY),
  buildId: 'local',
  services: () => Promise.resolve(services),
});

if (AUTH_TEST_MODE) {
  const Body = z.object({
    identityFixture: z.string().max(40),
    next: z.string().max(2048).optional(),
    mandant: z.string().max(64).optional(),
  });
  // Anmeldung ohne Discord mit einer Seed-Identität (TK 17) – durchläuft dieselbe Sitzungslogik.
  app.post('/api/auth/test-login', async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
    const fixture = parsed.success
      ? seed.identities.find((i) => i.fixture === parsed.data.identityFixture)
      : undefined;
    if (!parsed.success || !fixture) return problemResponse('validation.failed');
    const identity = await services.auth.upsertIdentity(
      {
        discordUserId: fixture.discordUserId,
        username: fixture.discordName,
        globalName: fixture.displayName,
        avatarHash: null,
        mfaEnabled: fixture.mfa,
      },
      now(),
    );
    // Wie der Discord-Callback: ein zuvor über /auth/invitation/claim gesetztes Einladungs-Cookie einlösen.
    const invite = verifyValue<{ t?: unknown }>(
      await services.authConfig.cookieSecret(),
      'invite',
      readCookie(c.req.header('cookie'), COOKIE_NAMES.invite),
      Math.floor(now().getTime() / 1000),
    );
    const result = await establishSession(services.auth, c as never, {
      identity,
      tenantKey: parsed.data.mandant,
      invitationToken: typeof invite?.t === 'string' ? invite.t : undefined,
      bootstrapIds: [],
      next: safeNext(parsed.data.next),
      now: now(),
    });
    c.header('set-cookie', result.setCookie);
    if (invite) c.header('set-cookie', clearCookie(COOKIE_NAMES.invite), { append: true });
    return c.json({ location: result.location, context: result.context });
  });

  // NINA-Filterrad-Meldung ohne Plugin (E2E zu S-10, AP-09c) – dieselbe Repository-Methode wie der
  // Heartbeat (AP-14). Mandant aus dem Seed; nur mit AUTH_TEST_MODE, nie im Lambda-Bundle.
  const Report = z.object({
    rigId: z.uuid(),
    slots: z
      .array(
        z.object({
          position: z.number().int().min(1).max(20),
          name: z.string().min(1).max(60),
          focusOffset: z.number().nullable().default(null),
        }),
      )
      .max(20),
  });
  app.post('/api/auth/test-nina-filter-wheel', async (c) => {
    const parsed = Report.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return problemResponse('validation.failed');
    const result = await new EquipmentRepository(db, {
      tenantId: seed.tenant.id,
    }).reportNinaFilterWheel(parsed.data.rigId, parsed.data.slots, now());
    return c.json(result);
  });
}

// Lokal gibt es kein CloudFront: den Origin-Verify-Header hier ergänzen.
const local = new Hono<ApiEnv>();
local.get('/catalog/thumbs/:file', (c) => {
  const bytes = localThumbs.get(`catalog/thumbs/${c.req.param('file')}`);
  return bytes
    ? c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'image/jpeg' })
    : c.notFound();
});
local.all('*', (c) => {
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-origin-verify', LOCAL_ORIGIN_VERIFY);
  const forward = () => app.fetch(new Request(c.req.raw, { headers }));
  const fixed = AUTH_TEST_MODE ? readCookie(c.req.header('cookie'), TEST_NOW_COOKIE) : undefined;
  const at = fixed ? new Date(decodeURIComponent(fixed)) : null;
  return at && !Number.isNaN(at.getTime()) ? testNow.run(at, forward) : forward();
});

serve({ fetch: local.fetch, port: PORT }, () => {
  logger.info('local_api', {
    port: PORT,
    authTestMode: AUTH_TEST_MODE,
    database: process.env.DATABASE_URL ? 'postgres' : 'pglite',
  });
});
