/** Lambda `worker`: Job-Dispatcher für Zeitpläne und Jobs (TK 13, 7.4). */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  deleteExpiredInvitations,
  EquipmentRepository,
  expireSubmissions,
  settleTransits,
  JobRepository,
  latestWeather,
  projectsWithoutThumbnail,
  recordSiteNightForecast,
  recordTenantStorage,
  setProjectThumbnail,
  thumbnailKeyInUse,
  saveWeather,
  siteNightRunDone,
  tenantIdsForStorage,
  weatherSites,
  purgeRigTelemetry,
  rollupRigTelemetry,
} from '@nina-pm/db';
import { ENGINE_VERSION } from '@nina-pm/engine';
import { s3TenantUsageReader } from '../files/tenant-files';
import { lambdaDatabase } from '../lib/database';
import { emitDsqlRetries } from '../lib/metrics';
import { logger } from '../lib/logger';
import { catalogRefreshHandler, enqueueExoCatalog, exoCatalogTick } from '../worker/catalog';
import { dispatch } from '../worker/dispatch';
import { effortJobHandler, effortSiteTick } from '../worker/effort';
import { effortDbDeps } from '../worker/effort-db';
import { s3JobResultStore } from '../files/job-results';
import { impactJobHandler, multiSimJobHandler } from '../worker/multi-sim';
import { forecastDbDeps, multiSimDbDeps } from '../worker/multi-sim-db';
import { forecastJobHandler, forecastSiteTick } from '../worker/forecast';
import {
  sessionCloseHandler,
  sessionReportHandler,
  type SessionJobDeps,
} from '../worker/session-jobs';
import { JOB_HANDLERS, runJob, type JobRunnerDeps } from '../worker/jobs';
import { requiredEnv } from '../lib/params';
import { createNotificationService } from '../notifications/service';
import {
  reconcileJobHandler,
  reconcileSiteTick,
  sessionTick,
  type SessionOpsDeps,
} from '../worker/session-ops';
import { measureTenantStorage, tickTasks } from '../worker/tasks';
import { httpClient } from '../lib/http-client';
import { weatherJobHandler, weatherTick, type WeatherJobDeps } from '../weather/job';
import { recordNightForecasts } from '../weather/night-forecast';
import {
  HIPS2FITS_TIMEOUT_MS,
  thumbnailJobHandler,
  thumbnailTick,
  type ThumbnailDeps,
} from '../worker/thumbnail';
import { thumbnailLoader } from '../worker/thumbnail-db';
import { CELESTRAK_TIMEOUT_MS, refreshSkySatellites } from '../worker/sky-satellites';
import { discordPostHandler } from '../discord/post-job';
import { discordTick } from '../discord/tick';

// Metrik `DsqlRetries` (TK 16.2) aus jeder OCC-Wiederholung.
emitDsqlRetries(process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'nina-pm-worker');

const effort = effortDbDeps(async () => (await lambdaDatabase()).db);
const sessionOps: SessionOpsDeps = {
  db: async () => (await lambdaDatabase()).db,
  enqueue: async (tenantId, input) =>
    (await lambdaDatabase()).repositories({ tenantId }).job.enqueue(input),
  notify: async (tenantId, kind, recipients, payload, now) =>
    createNotificationService((await lambdaDatabase()).db).notify(
      tenantId,
      kind,
      recipients,
      payload,
      {
        now,
      },
    ),
  // EMF-Zeile direkt auf stdout (nicht über den Logger, der sie einpacken würde).
  emit: (line) => void process.stdout.write(`${line}\n`),
  service: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'nina-pm-worker',
};
const sessionJobs: SessionJobDeps = {
  db: async () => (await lambdaDatabase()).db,
  enqueue: async (tenantId, input) =>
    (await lambdaDatabase()).repositories({ tenantId }).job.enqueue(input),
};
const http = httpClient({ version: ENGINE_VERSION });
const s3 = new S3Client({});
const weather: WeatherJobDeps = {
  http,
  latest: async (lat, lon) => latestWeather((await lambdaDatabase()).db, lat, lon),
  save: async (entry) => saveWeather((await lambdaDatabase()).db, entry),
  site: async (tenantId, siteId) =>
    new EquipmentRepository((await lambdaDatabase()).db, { tenantId }).site(siteId),
};
const thumbnails: ThumbnailDeps = {
  load: thumbnailLoader(async () => (await lambdaDatabase()).db),
  keyInUse: async (key) => thumbnailKeyInUse((await lambdaDatabase()).db, key),
  fetchImage: (url) => http.getBytes(url, { timeoutMs: HIPS2FITS_TIMEOUT_MS }),
  // Nur unter catalog/thumbs/* (iam.md: webBucket.grantReadWrite(worker, 'catalog/thumbs/*')).
  put: async (key, bytes) => {
    await s3.send(
      new PutObjectCommand({
        Bucket: requiredEnv('WEB_BUCKET'),
        Key: key,
        Body: bytes,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  },
  save: async (tenantId, projectId, key) =>
    setProjectThumbnail((await lambdaDatabase()).db, tenantId, projectId, key),
};
// Ergebnisse unter tenant/<tid>/jobs/* (iam.md: dataBucket.grantReadWrite(worker, 'tenant/*')).
const multiSim = multiSimDbDeps(
  async () => (await lambdaDatabase()).db,
  (tenantId, jobId, result) =>
    s3JobResultStore(s3, requiredEnv('DATA_BUCKET')).put(tenantId, jobId, result),
);
const jobs: JobRunnerDeps = {
  queue: async () => (await lambdaDatabase()).jobQueue(),
  handlers: {
    ...JOB_HANDLERS,
    effort: effortJobHandler(effort),
    session_close: sessionCloseHandler(sessionJobs),
    session_report: sessionReportHandler(sessionJobs),
    reconcile: reconcileJobHandler(sessionOps),
    catalog_refresh: catalogRefreshHandler({
      db: async () => (await lambdaDatabase()).db,
      fetchText: async (url, timeoutMs) =>
        new TextDecoder().decode((await http.getBytes(url, { timeoutMs })).bytes),
    }),
    weather: weatherJobHandler(weather),
    thumbnail: thumbnailJobHandler(thumbnails),
    multi_sim: multiSimJobHandler(multiSim),
    impact: impactJobHandler(multiSim),
    forecast: forecastJobHandler(forecastDbDeps(async () => (await lambdaDatabase()).db)),
    discord_post: discordPostHandler({ db: async () => (await lambdaDatabase()).db }),
  },
};

/** Wartungsaufgaben eines Laufs; `startedAt` begrenzt die externen Abrufe (`HOURLY_FETCH_BUDGET_MS`). */
const maintenanceFor = (startedAt: number) => ({
  cleanupInvitations: async () => {
    const deleted = await deleteExpiredInvitations((await lambdaDatabase()).db, new Date());
    logger.info('invitation_cleanup', { deleted });
    return deleted;
  },
  sessions: async () => {
    const r = await sessionTick(sessionOps, new Date());
    if (r.stale > 0 || r.closing > 0) logger.info('sessions_tick', r);
    return r;
  },
  weather: async () => {
    const db = (await lambdaDatabase()).db;
    const runs = await weatherTick(
      {
        sites: () => weatherSites(db),
        enqueue: (tenantId, input) => new JobRepository(db, { tenantId }).enqueue(input),
        runDone: (tenantId, key) => siteNightRunDone(db, tenantId, key),
      },
      jobs,
      new Date(),
      { startedAt },
    );
    logger.info('weather_sites', { runs });
    return runs;
  },
  nightForecasts: async () => {
    const db = (await lambdaDatabase()).db;
    const written = await recordNightForecasts(
      {
        sites: () => weatherSites(db),
        latest: (lat, lon) => latestWeather(db, lat, lon),
        record: (input, now) => recordSiteNightForecast(db, input, now),
      },
      new Date(),
    );
    if (written > 0) logger.info('night_forecasts', { written });
    return written;
  },
  thumbnails: async () => {
    const db = (await lambdaDatabase()).db;
    const runs = await thumbnailTick(
      {
        candidates: (limit) => projectsWithoutThumbnail(db, limit),
        enqueue: (tenantId, input) => new JobRepository(db, { tenantId }).enqueue(input),
      },
      jobs,
      { startedAt },
    );
    logger.info('thumbnail_tick', { runs });
    return runs;
  },
  rigTelemetry: async () => {
    const db = (await lambdaDatabase()).db;
    const now = new Date();
    const hours = await rollupRigTelemetry(db, now);
    const purged = await purgeRigTelemetry(db, now);
    if (hours > 0 || purged > 0) logger.info('rig_telemetry', { hours, purged });
    return hours;
  },
  reconcileSiteNights: async () => {
    const runs = await reconcileSiteTick(effort, jobs, new Date());
    logger.info('reconcile_site_nights', { runs });
    return runs;
  },
  forecastSiteNights: async () => {
    const runs = await forecastSiteTick(effort, jobs, new Date());
    logger.info('forecast_site_nights', { runs });
    return runs;
  },
  effortSiteNights: async () => {
    const runs = await effortSiteTick(effort, jobs, new Date());
    logger.info('effort_site_nights', { runs });
    return runs;
  },
  discord: async () => {
    const runs = await discordTick((await lambdaDatabase()).db, jobs, new Date());
    if (runs > 0) logger.info('discord_tick', { runs });
    return runs;
  },
  settleTransits: async () => {
    const result = await settleTransits((await lambdaDatabase()).db, new Date());
    logger.info('transits', { ...result });
    return result;
  },
  expireSubmissions: async () => {
    const expired = await expireSubmissions((await lambdaDatabase()).db, new Date());
    logger.info('submission_expiry', { expired });
    return expired;
  },
  skySatellites: async () => {
    const count = await refreshSkySatellites({
      fetchText: async (url) =>
        new TextDecoder().decode(
          (await http.getBytes(url, { timeoutMs: CELESTRAK_TIMEOUT_MS })).bytes,
        ),
      // Nur unter catalog/sky/* (iam.md: webBucket.grantPut(worker, 'catalog/sky/*')).
      put: async (key, body) => {
        await s3.send(
          new PutObjectCommand({
            Bucket: requiredEnv('WEB_BUCKET'),
            Key: key,
            Body: body,
            ContentType: 'application/json',
            CacheControl: 'public, max-age=3600',
          }),
        );
      },
      now: () => new Date(),
    });
    logger.info('sky_satellites', { count });
    return count;
  },
  exoCatalogsDaily: async () => {
    const db = (await lambdaDatabase()).db;
    return exoCatalogTick({ enqueue: (c) => enqueueExoCatalog(db, c) }, jobs, ['exoclock']);
  },
  exoCatalogsWeekly: async () => {
    const db = (await lambdaDatabase()).db;
    return exoCatalogTick({ enqueue: (c) => enqueueExoCatalog(db, c) }, jobs, ['nasa', 'toi']);
  },
  measureStorage: async () => {
    const db = (await lambdaDatabase()).db;
    const reader = s3TenantUsageReader(s3, requiredEnv('DATA_BUCKET'));
    const measured = await measureTenantStorage({
      tenantIds: () => tenantIdsForStorage(db),
      usage: (id) => reader.usage(id),
      record: (id, usage) => recordTenantStorage(db, id, usage, new Date()),
      onError: (tenantId, error) =>
        logger.warn('tenant_storage_failed', {
          tenantId,
          error: error instanceof Error ? error.message : 'unbekannt',
        }),
    });
    logger.info('tenant_storage', { measured });
    return measured;
  },
});

export const handler = (event: unknown) =>
  dispatch(event, {
    tasks: tickTasks(jobs, maintenanceFor(Date.now())),
    runJob: (jobId) => runJob(jobs, jobId),
  });
