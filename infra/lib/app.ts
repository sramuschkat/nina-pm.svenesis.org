import { type App, Tags } from 'aws-cdk-lib';
import { certEnv, env } from '../config';
import { ApiStack } from './api-stack';
import { CertStack } from './cert-stack';
import { ConfigStack } from './config-stack';
import { DataStack } from './data-stack';
import { EdgeStack } from './edge-stack';
import { JobsStack } from './jobs-stack';
import { MigrateStack } from './migrate-stack';
import { OpsStack } from './ops-stack';
import { WebStack } from './web-stack';

/** Baut alle Stacks (TK 4.1). */
export function buildApp(app: App) {
  const importClusterId = app.node.tryGetContext('dsqlClusterId') as string | undefined;
  const buildId = (app.node.tryGetContext('buildId') as string | undefined) ?? 'placeholder';

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
