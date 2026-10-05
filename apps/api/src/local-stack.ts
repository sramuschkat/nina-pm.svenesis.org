/**
 * Lokaler Stack (TK 17): derselbe API-Code wie in prod mit PGlite bzw. PostgreSQL, Jobs im selben Prozess. Genutzt von
 * `pnpm dev:api` (`local.ts`, Playwright) und vom VM-Prüfstand (`tools/vm-bench`, Läufe gegen den echten Server).
 * **Nie im Lambda-Bundle.** Test-Login und Testuhr je Anfrage (`npm_test_now`) nur mit `authTestMode`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  ExoProjectRepository,
  TransitRepository,
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
  DiscordRepository,
  latestWeather,
  saveWeather,
  siteNightRunDone,
  setProjectThumbnail,
  thumbnailKeyInUse,
  weatherSites,
  settleTransits,
} from '@nina-pm/db';
import { seedCore, seedEquipment, type SeedDemo } from '@nina-pm/db/seed';
import { openPglite } from '@nina-pm/db/testing/pglite';
import { COOKIE_NAMES, safeNext } from '@nina-pm/shared';
import { serve } from '@hono/node-server';
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
import { importExoSamples } from './exo/samples';
import { reconcileJobHandler, sessionTick, type SessionOpsDeps } from './worker/session-ops';
import { tickTasks } from './worker/tasks';
import { createNotificationService } from './notifications/service';
import { httpClient } from './lib/http-client';
import { weatherJobHandler, weatherTick } from './weather/job';
import { sampleOpenMeteo } from './weather/sample';
import { thumbnailLoader } from './worker/thumbnail-db';
import { thumbnailJobHandler } from './worker/thumbnail';
import { discordLocalFetch } from './discord/local-fetch';
import { discordPostHandler } from './discord/post-job';
import { discordTick } from './discord/tick';

const LOCAL_ORIGIN_VERIFY = 'local-dev-origin-verify';

const seed = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../docs/seed/seed-demo.json', import.meta.url)),
    'utf8',
  ),
) as SeedDemo;

async function database(databaseUrl: string | undefined): Promise<OpenDatabase['db']> {
  if (databaseUrl) {
    return openDatabase({ kind: 'postgres', connectionString: databaseUrl }).db;
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

export interface LocalStackOptions {
  /** Port, unter dem der Stack erreichbar ist (Weiterleitungs-URLs). */
  readonly port: number;
  readonly authTestMode: boolean;
  /** PostgreSQL 16; ohne Angabe PGlite im Speicher mit Demo-Seed. */
  readonly databaseUrl?: string | undefined;
  /** Discord-Nachbildung (`tools/discord-mock`); ohne Angabe nur ins Log. */
  readonly discordMockUrl?: string | undefined;
  readonly liveThumbnails?: boolean;
  readonly liveWeather?: boolean;
  /** Takt wie `tick-5min` (Jobs nachholen, Sessions, Transits, Discord); ohne Angabe aus. */
  readonly tickMs?: number | undefined;
}

export interface LocalStack {
  readonly fetch: (request: Request) => Response | Promise<Response>;
  readonly db: OpenDatabase['db'];
  readonly services: ApiServices;
  readonly jobs: JobRunnerDeps;
  readonly now: () => Date;
  /** Einmal `tick-5min` ausführen (wie der Zeitplan in prod). */
  readonly tick: () => Promise<void>;
  readonly close: () => void;
}

/** Seed des lokalen Stacks (Mandant, Identitäten, Ausrüstung); der Prüfstand nutzt Mandant und Owner daraus. */
export { seed as localSeed };

export async function createLocalStack(opts: LocalStackOptions): Promise<LocalStack> {
  const timers: NodeJS.Timeout[] = [];
  const db = await database(opts.databaseUrl);
  // Objektkatalog (AP-20): lokal beim Start importieren, solange `dso_object` leer ist (prod: Job über S-82).
  if (!(await db.selectFrom('dsoObject').select('id').limit(1).executeTakeFirst())) {
    await importCatalog(db, new Date());
    logger.info('local_catalog', { imported: true });
  }
  // Exoplaneten-Kataloge (AP-42): lokal die Auszüge aus `exo/samples`, solange die Tabelle leer ist; echte
  // Abrufe über *Neu laden* in S-82.
  if (!(await db.selectFrom('exoCatalogEntry').select('id').limit(1).executeTakeFirst())) {
    logger.info('local_exo_catalog', { rows: await importExoSamples(db, new Date()) });
  }
  // Testuhr je Anfrage (nur opts.authTestMode, Cookie `npm_test_now`): E2E prüfen „Heute Nacht“ zu festen Zeiten,
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
      opts.liveThumbnails === true
        ? httpClient({ version: 'local' }).getBytes(url, { timeoutMs: 60_000 })
        : Promise.resolve({ bytes: new Uint8Array(PLACEHOLDER_JPEG), contentType: 'image/jpeg' }),
    put: (key, bytes) => {
      localThumbs.set(key, bytes);
      return Promise.resolve();
    },
    save: (tenantId, projectId, key) => setProjectThumbnail(db, tenantId, projectId, key),
  });

  // Discord (AP-60) lokal nie an discord.com: mit DISCORD_MOCK_URL an tools/discord-mock, sonst nur ins Log.
  const localDiscordFetch = discordLocalFetch(opts.discordMockUrl);

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
      discord_post: discordPostHandler({ db: () => Promise.resolve(db), fetch: localDiscordFetch }),
      // Astro-Wetter (AP-23): lokal mit Beispieldaten, echte Open-Meteo-Abrufe nur mit LOCAL_WEATHER=live.
      weather: weatherJobHandler({
        http: opts.liveWeather === true ? httpClient({ version: 'local' }) : sampleOpenMeteo(now),
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
  timers.push(setInterval(() => void localWeatherTick(), 5 * 60_000).unref());
  // Discord-Zustellungen lokal alle 30 s statt 5 min.
  timers.push(
    setInterval(
      () =>
        void discordTick(db, jobs, now()).catch((error: unknown) =>
          logger.warn('local_discord_failed', {
            error: error instanceof Error ? error.message : '',
          }),
        ),
      30_000,
    ).unref(),
  );
  // Wie `tick-5min` in prod (Jobs nachholen, verwaiste Sessions und Abschluss, Transits, Discord): nur mit
  // `tickMs` – der VM-Prüfstand braucht Abschluss und Bericht, `pnpm dev:api` und die E2E-Läufe nicht.
  const sessionOps: SessionOpsDeps = {
    db: () => Promise.resolve(db),
    enqueue: (tenantId, input) => new JobRepository(db, { tenantId }).enqueue(input),
    notify: (tenantId, kind, recipients, payload, at) =>
      createNotificationService(db).notify(tenantId, kind, recipients, payload, { now: at }),
    emit: () => undefined,
    service: 'nina-pm-local',
  };
  const tick5min = tickTasks(
    { ...jobs, now },
    {
      // Nur `tick-5min` läuft hier; die tägliche Aufgabe ist Pflichtfeld, aber ungenutzt.
      cleanupInvitations: () => Promise.resolve(0),
      sessions: () => sessionTick(sessionOps, now()),
      settleTransits: () => settleTransits(db, now()),
      discord: () => discordTick(db, jobs, now()),
    },
  )['tick-5min'];
  const tick = async () => {
    for (const task of tick5min)
      await task.run().catch((error: unknown) =>
        logger.warn('local_tick_failed', {
          task: task.name,
          error: error instanceof Error ? error.message : 'unbekannt',
        }),
      );
  };
  if (opts.tickMs) timers.push(setInterval(() => void tick(), opts.tickMs).unref());
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
      exoProjects: () => new ExoProjectRepository(db, ctx),
      transits: () => new TransitRepository(db, ctx),
      tenant: () => new TenantRepository(db, ctx),
      discord: () => new DiscordRepository(db, ctx),
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
      redirectUri: `http://localhost:${String(opts.port)}/api/auth/discord/callback`,
    },
    discord: httpDiscordClient(),
    downloads: {
      presignGet: (key) =>
        Promise.resolve({
          url: `http://localhost:${String(opts.port)}/local-files/${key}`,
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
    discordFetch: localDiscordFetch,
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

  if (opts.authTestMode) {
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
    // Heartbeat (AP-14). Mandant aus dem Seed; nur mit opts.authTestMode, nie im Lambda-Bundle.
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
    const fixed = opts.authTestMode
      ? readCookie(c.req.header('cookie'), TEST_NOW_COOKIE)
      : undefined;
    const at = fixed ? new Date(decodeURIComponent(fixed)) : null;
    return at && !Number.isNaN(at.getTime()) ? testNow.run(at, forward) : forward();
  });

  return {
    fetch: local.fetch,
    db,
    services,
    jobs,
    now,
    tick,
    close: () => {
      for (const t of timers) clearInterval(t);
    },
  };
}

/** Stack auf `port` lauschen lassen; ohne `hostname` wie bisher auf allen Adressen (die VM erreicht den Mac darüber). */
export function listenLocal(
  fetch: LocalStack['fetch'],
  port: number,
  hostname?: string,
): Promise<{ close: () => void }> {
  return new Promise((resolve) => {
    const server = serve({ fetch, port, ...(hostname ? { hostname } : {}) }, () => {
      resolve({ close: () => void server.close() });
    });
  });
}
