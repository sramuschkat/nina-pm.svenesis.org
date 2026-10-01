import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type App, Tags } from 'aws-cdk-lib';
import { certEnv, env } from '../config';
import { ApiStack } from './api-stack';
import { CertStack } from './cert-stack';
import { ConfigStack } from './config-stack';
import { DataStack } from './data-stack';
import { EdgeStack } from './edge-stack';
import { JobsStack } from './jobs-stack';
import { MigrateStack } from './migrate-stack';
import { NINA_SEQUENCES_DIR, ninaPluginVersion } from './nina-sequences';
import { OpsStack } from './ops-stack';
import { WebStack } from './web-stack';

/** Baut alle Stacks (TK 4.1). */
export function buildApp(app: App) {
  const importClusterId = app.node.tryGetContext('dsqlClusterId') as string | undefined;
  const buildId = (app.node.tryGetContext('buildId') as string | undefined) ?? 'placeholder';
  const webDistPath = resolveWebDist(app, buildId);

  const data = new DataStack(app, 'NinaPm-Data', {
    env,
    ...(importClusterId ? { importClusterId } : {}),
  });
  const configStack = new ConfigStack(app, 'NinaPm-Config', { env });
  const cert = new CertStack(app, 'NinaPm-Cert', { env: certEnv, crossRegionReferences: true });
  const web = new WebStack(app, 'NinaPm-Web', { env });
  const params = configStack.params;
  // Migrationen laufen vor dem neuen Code von Api und Jobs (TK 6.8, CC-7).
  const migrate = new MigrateStack(app, 'NinaPm-Migrate', {
    env,
    dsqlClusterArn: data.clusterArn,
    dsqlEndpointParam: params.dsqlEndpoint,
  });
  const jobs = new JobsStack(app, 'NinaPm-Jobs', {
    env,
    dsqlClusterArn: data.clusterArn,
    dataBucket: data.dataBucket,
    webBucket: web.webBucket,
    params,
    webBuildIdParam: configStack.webBuildId,
  });
  const api = new ApiStack(app, 'NinaPm-Api', {
    env,
    dsqlClusterArn: data.clusterArn,
    dataBucket: data.dataBucket,
    worker: jobs.worker.fn,
    buildId,
    params,
    webBuildIdParam: configStack.webBuildId,
  });
  jobs.addStackDependency(migrate);
  api.addStackDependency(migrate);
  const edge = new EdgeStack(app, 'NinaPm-Edge', {
    env,
    crossRegionReferences: true,
    certificate: cert.certificate,
    webBucket: web.webBucket,
    buildId,
    httpApi: api.httpApi,
    webDistPath,
    ninaSequences: { path: NINA_SEQUENCES_DIR, pluginVersion: ninaPluginVersion() },
  });
  const ops = new OpsStack(app, 'NinaPm-Ops', {
    env,
    dsqlClusterArn: data.clusterArn,
    dsqlEndpointParam: params.dsqlEndpoint,
    failureQueue: jobs.failureQueue,
    api: api.api.fn,
    apiLogGroup: api.api.logGroup,
    worker: jobs.worker.fn,
    httpApi: api.httpApi,
  });

  Tags.of(app).add('project', 'nina-pm');
  return { data, config: configStack, cert, web, migrate, edge, jobs, api, ops };
}

/**
 * Gebaute SPA (`apps/web/dist`). `pnpm deploy:prod` baut sie mit `BUILD_ID=<commit>` und setzt
 * `-c requireWebDist=true`: dann muss `assets/<buildId>/` existieren. Ohne Build (Unit-Tests, reines
 * `cdk synth`) dient die Platzhalterseite.
 */
function resolveWebDist(app: App, buildId: string): string {
  const dist = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url));
  const required = String(app.node.tryGetContext('requireWebDist')) === 'true';
  if (required && !existsSync(join(dist, 'assets', buildId))) {
    throw new Error(
      `apps/web/dist ist nicht mit BUILD_ID=${buildId} gebaut – zuerst BUILD_ID=${buildId} pnpm --filter @nina-pm/web build`,
    );
  }
  if (existsSync(join(dist, 'index.html'))) return dist;
  return fileURLToPath(new URL('../placeholder/', import.meta.url));
}
