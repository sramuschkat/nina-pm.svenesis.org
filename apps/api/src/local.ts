/**
 * Lokaler Node-Adapter (`pnpm dev:api`, Playwright-Stack; TK 17). **Nie im Lambda-Bundle** – die
 * Lambda-Einstiege liegen in src/handlers/, und nur hier gibt es den Test-Login
 * (`AUTH_TEST_MODE=true`, `POST /api/auth/test-login {identityFixture}`, Fixtures aus
 * docs/seed/seed-demo.json). Datenbank: `DATABASE_URL` (PostgreSQL 16) oder ohne sie PGlite im
 * Speicher mit Demo-Seed.
 */
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
import {
  sessionCloseHandler,
  sessionReportHandler,
  type SessionJobDeps,
} from './worker/session-jobs';
import { JOB_HANDLERS, runJob, type JobRunnerDeps } from './worker/jobs';
import { reconcileJobHandler } from './worker/session-ops';

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
const now = () => new Date();
const queue = new JobQueue(db);
const localSessionJobs: SessionJobDeps = {
  db: () => Promise.resolve(db),
  enqueue: (tenantId, input) => new JobRepository(db, { tenantId }).enqueue(input),
};
const jobs: JobRunnerDeps = {
  queue: () => Promise.resolve(queue),
  handlers: {
    ...JOB_HANDLERS,
    effort: effortJobHandler(effortDbDeps(() => Promise.resolve(db))),
    session_close: sessionCloseHandler(localSessionJobs),
    session_report: sessionReportHandler(localSessionJobs),
    reconcile: reconcileJobHandler({ db: () => Promise.resolve(db) }),
  },
};
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
local.all('*', (c) => {
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-origin-verify', LOCAL_ORIGIN_VERIFY);
  return app.fetch(new Request(c.req.raw, { headers }));
});

serve({ fetch: local.fetch, port: PORT }, () => {
  logger.info('local_api', {
    port: PORT,
    authTestMode: AUTH_TEST_MODE,
    database: process.env.DATABASE_URL ? 'postgres' : 'pglite',
  });
});
