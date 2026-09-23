import { type App, Tags } from 'aws-cdk-lib';
import { certEnv, env } from '../config';
import { CertStack } from './cert-stack';
import { ConfigStack } from './config-stack';
import { DataStack } from './data-stack';
import { EdgeStack } from './edge-stack';
import { WebStack } from './web-stack';

/** Baut alle Stacks von AP-02a; Lambdas, Api, Jobs und Ops folgen mit AP-02b (TK 4.1). */
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
  const edge = new EdgeStack(app, 'NinaPm-Edge', {
    env,
    crossRegionReferences: true,
    certificate: cert.certificate,
    webBucket: web.webBucket,
    buildId,
  });

  Tags.of(app).add('project', 'nina-pm');
  return { data, config: configStack, cert, web, edge };
}
