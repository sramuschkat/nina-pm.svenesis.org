import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { resources, synth, type Resource } from './synth';

// CDK-Assertions nach specs/infra/iam.md §12, Stand AP-02b: Nr. 1, 2, 3, 8, 9 und die Tabellen §2, §3, §5, §6, §9.
const t = synth();
const all = [t.data, t.config, t.cert, t.web, t.edge, t.jobs, t.api, t.ops];

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
}

const actionsOf = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);
const resourcesOf = (s: Statement) => (Array.isArray(s.Resource) ? s.Resource : [s.Resource]);
const json = (v: unknown) => JSON.stringify(v);

/** Rolle mit festem Namen samt aller Anweisungen ihrer Inline-Politiken. */
function appRole(roleName: string) {
  for (const template of all) {
    const role = resources(template, 'AWS::IAM::Role').find(
      ([, r]) => r.Properties.RoleName === roleName,
    );
    if (!role) continue;
    const [roleId, roleRes] = role;
    const statements = resources(template, 'AWS::IAM::Policy')
      .filter(([, p]) => json(p.Properties.Roles).includes(`"${roleId}"`))
      .flatMap(([, p]) => (p.Properties.PolicyDocument as { Statement: Statement[] }).Statement);
    return { roleRes, statements };
  }
  throw new Error(`Rolle ${roleName} fehlt`);
}

const ROLES = Object.values(config.lambdas).map((l) => l.roleName);
const apiRole = appRole(config.lambdas.api.roleName);
const workerRole = appRole(config.lambdas.worker.roleName);
const opsRole = appRole(config.lambdas.opsCli.roleName);

describe('Assertion 1: keine *-Ressourcen, keine Managed Policies außer AWSLambdaBasicExecutionRole', () => {
  it.each(ROLES)('%s', (roleName) => {
    const { roleRes, statements } = appRole(roleName);
    for (const s of statements) {
      expect(s.Effect, 'keine Deny-Anweisungen').toBe('Allow');
      const guarded = actionsOf(s).some(
        (a) => /^(dsql|s3|ssm):/.test(a) || a === 'lambda:InvokeFunction',
      );
      if (guarded) expect(resourcesOf(s), json(s.Action)).not.toContain('*');
    }
    const managed = (roleRes.Properties.ManagedPolicyArns as unknown[] | undefined) ?? [];
    expect(managed).toHaveLength(1);
    expect(json(managed[0])).toContain('service-role/AWSLambdaBasicExecutionRole');
  });

  it('dsql:DbConnect genau einmal je Rolle auf den Cluster-ARN, DbConnectAdmin nirgends', () => {
    for (const { statements } of [apiRole, workerRole, opsRole]) {
      const dsql = statements.filter((s) => actionsOf(s).some((a) => a.startsWith('dsql:')));
      expect(dsql).toHaveLength(1);
      expect(actionsOf(dsql[0] as Statement)).toEqual(['dsql:DbConnect']);
      expect(json(dsql[0]?.Resource)).toContain('ClusterResourceArn');
    }
    for (const template of all)
      expect(json(template.toJSON())).not.toContain('dsql:DbConnectAdmin');
  });
});

describe('Assertion 2: Invoke-Rechte', () => {
  const invokes = (statements: Statement[]) =>
    statements.filter((s) => actionsOf(s).includes('lambda:InvokeFunction'));

  it('NinaPmApi hat genau einen Invoke-Eintrag, und der zeigt auf worker', () => {
    const list = invokes(apiRole.statements);
    expect(list).toHaveLength(1);
    expect(json(list[0]?.Resource)).toContain('WorkerFunction');
  });

  it('NinaPmWorker und NinaPmOpsCli haben kein Invoke-Recht', () => {
    expect(invokes(workerRole.statements)).toEqual([]);
    expect(invokes(opsRole.statements)).toEqual([]);
  });

  it('niemand darf ops-cli aufrufen: keine Invoke-Anweisung, keine Ressourcenpolitik, keine Function-URL', () => {
    const [[opsFnId] = []] = resources(t.ops, 'AWS::Lambda::Function').filter(
      ([, f]) => f.Properties.FunctionName === config.lambdas.opsCli.functionName,
    );
    expect(opsFnId).toBeDefined();
    for (const template of all) {
      for (const [, p] of resources(template, 'AWS::IAM::Policy')) {
        const doc = json(p.Properties.PolicyDocument);
        expect(doc.includes(`"${opsFnId}"`) && doc.includes('lambda:InvokeFunction')).toBe(false);
        expect(doc).not.toContain('OpsCliFunction');
      }
      expect(resources(template, 'AWS::Lambda::Url')).toEqual([]);
    }
    expect(resources(t.ops, 'AWS::Lambda::Permission')).toEqual([]);
  });
});

describe('Assertion 3: worker liest keine Auth-Geheimnisse', () => {
  const ssmResources = workerRole.statements
    .filter((s) => actionsOf(s).some((a) => a.startsWith('ssm:')))
    .flatMap((s) => resourcesOf(s).map(json));

  it.each(['/nina-pm/oauth/', '/nina-pm/discord/client-secret', '/nina-pm/bootstrap-super-users'])(
    'kein Zugriff auf %s',
    (name) => {
      for (const r of ssmResources) expect(r).not.toContain(name);
    },
  );

  it('liest genau dsql-endpoint, web/build-id und system/alarm-webhook (iam.md §3)', () => {
    expect(ssmResources.map((r) => r.replace(/.*parameter/, '').replace(/"$/, '')).sort()).toEqual(
      ['/nina-pm/dsql-endpoint', '/nina-pm/system/alarm-webhook', '/nina-pm/web/build-id'].sort(),
    );
  });
});

describe('Rechte-Tabellen iam.md §2, §3, §5', () => {
  const ssmOf = (statements: Statement[]) =>
    statements
      .filter((s) => actionsOf(s).some((a) => a.startsWith('ssm:')))
      .flatMap((s) =>
        resourcesOf(s).map((r) =>
          json(r)
            .replace(/.*parameter/, '')
            .replace(/"$/, ''),
        ),
      )
      .sort();
  const s3Of = (statements: Statement[]) =>
    statements
      .filter((s) => actionsOf(s).some((a) => a.startsWith('s3:')))
      .map((s) => json(s.Resource));

  it('api liest genau die sieben SSM-Parameter aus §2', () => {
    expect(ssmOf(apiRole.statements)).toEqual(
      [
        '/nina-pm/bootstrap-super-users',
        '/nina-pm/discord/client-id',
        '/nina-pm/discord/client-secret',
        '/nina-pm/dsql-endpoint',
        '/nina-pm/oauth/cookie-secret',
        '/nina-pm/origin-verify',
        '/nina-pm/web/build-id',
      ].sort(),
    );
  });

  it('api: Daten-Bucket nur tenant/*, kein Web-Bucket, kein SQS', () => {
    const s3 = s3Of(apiRole.statements);
    expect(s3.join()).toContain('/tenant/*');
    expect(s3.join()).not.toContain('WebBucket');
    expect(apiRole.statements.some((s) => actionsOf(s).some((a) => a.startsWith('sqs:')))).toBe(
      false,
    );
  });

  it('worker: tenant/*, catalog/thumbs/* und assets/*; SQS nur SendMessage-Rechte der Destination', () => {
    const s3 = s3Of(workerRole.statements).join();
    for (const prefix of ['/tenant/*', '/catalog/thumbs/*', '/assets/*'])
      expect(s3).toContain(prefix);
    const sqs = workerRole.statements.filter((s) => actionsOf(s).some((a) => a.startsWith('sqs:')));
    expect(sqs.flatMap(actionsOf)).toContain('sqs:SendMessage');
    expect(sqs.flatMap(actionsOf)).not.toContain('sqs:ReceiveMessage');
  });

  it('ops-cli: nur dsql-endpoint und Nachrichten der Fehler-Queue lesen', () => {
    expect(ssmOf(opsRole.statements)).toEqual(['/nina-pm/dsql-endpoint']);
    const sqs = opsRole.statements
      .filter((s) => actionsOf(s).some((a) => a.startsWith('sqs:')))
      .flatMap(actionsOf);
    expect(sqs).toContain('sqs:ReceiveMessage');
    expect(s3Of(opsRole.statements)).toEqual([]);
  });
});

describe('Assertion 8 und Routen: Drosselung nach iam.md §9', () => {
  const [[, stage] = []] = resources(t.api, 'AWS::ApiGatewayV2::Stage');
  const routeKeys = resources(t.api, 'AWS::ApiGatewayV2::Route')
    .map(([, r]) => r.Properties.RouteKey as string)
    .sort();

  it('Stage 50 rps / Burst 100', () => {
    expect(stage?.Properties.DefaultRouteSettings).toMatchObject({
      ThrottlingRateLimit: 50,
      ThrottlingBurstLimit: 100,
    });
  });

  it('Routen-Drosselung genau für die fünf Routen', () => {
    expect(stage?.Properties.RouteSettings).toEqual({
      'GET /api/health': { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
      'ANY /api/nina/v1/{proxy+}': { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
      'GET /api/auth/discord/{proxy+}': { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
      'POST /api/auth/invitation/claim': { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
      'POST /api/auth/invitations/preview': { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 },
    });
  });

  it('Routen: eine Health-Route, keine eigene /api/auth/{proxy+}', () => {
    expect(routeKeys).toEqual(
      [
        'ANY /api/{proxy+}',
        'GET /api/health',
        'ANY /api/nina/v1/{proxy+}',
        'GET /api/auth/discord/{proxy+}',
        'POST /api/auth/invitation/claim',
        'POST /api/auth/invitations/preview',
      ].sort(),
    );
    expect(routeKeys.filter((k) => k.includes('health'))).toHaveLength(1);
    expect(routeKeys.some((k) => k.includes('/api/auth/{proxy+}'))).toBe(false);
  });

  it('reservierte Parallelität api 20, worker 5, ops-cli keine', () => {
    const fn = (name: string) =>
      all
        .flatMap((tpl) => resources(tpl, 'AWS::Lambda::Function'))
        .find(([, f]) => f.Properties.FunctionName === name)?.[1];
    expect(fn(config.lambdas.api.functionName)?.Properties.ReservedConcurrentExecutions).toBe(20);
    expect(fn(config.lambdas.worker.functionName)?.Properties.ReservedConcurrentExecutions).toBe(5);
    expect(
      fn(config.lambdas.opsCli.functionName)?.Properties.ReservedConcurrentExecutions,
    ).toBeUndefined();
  });

  it('Zugriffsprotokoll als JSON mit den Feldern aus TK 16.1, ohne IP', () => {
    const settings = stage?.Properties.AccessLogSettings as { Format: string };
    const format = JSON.parse(settings.Format) as Record<string, string>;
    expect(Object.keys(format)).toEqual(
      expect.arrayContaining(['requestId', 'routeKey', 'status', 'integrationLatency']),
    );
    expect(settings.Format).not.toMatch(/sourceIp|"ip"/);
  });
});

describe('Assertion 9 und Jobs', () => {
  it('keine Lambda setzt AUTH_TEST_MODE', () => {
    for (const template of all) {
      for (const [, fn] of resources(template, 'AWS::Lambda::Function')) {
        expect(json(fn.Properties.Environment ?? {})).not.toContain('AUTH_TEST_MODE');
      }
    }
  });

  it('genau vier Zeitpläne in der Gruppe nina-pm, UTC, mit {tick}', () => {
    const schedules = resources(t.jobs, 'AWS::Scheduler::Schedule').map(([, s]) => s.Properties);
    expect(schedules.map((s) => [s.Name, s.ScheduleExpression]).sort()).toEqual(
      [
        ['nina-pm-daily', 'cron(0 3 * * ? *)'],
        ['nina-pm-tick-5min', 'rate(5 minutes)'],
        ['nina-pm-tick-hourly', 'cron(0 * * * ? *)'],
        ['nina-pm-weekly', 'cron(30 4 ? * SUN *)'],
      ].sort(),
    );
    for (const s of schedules) {
      expect(s.GroupName).toBe(config.scheduleGroup);
      expect(['UTC', 'Etc/UTC']).toContain(s.ScheduleExpressionTimezone ?? 'UTC');
      const target = s.Target as { Input: string };
      expect(JSON.parse(target.Input)).toEqual({ tick: String(s.Name).replace('nina-pm-', '') });
    }
    expect(resources(t.jobs, 'AWS::Scheduler::ScheduleGroup')[0]?.[1].Properties.Name).toBe(
      'nina-pm',
    );
  });

  it('Fehler-Queue: SSE-SQS, 14 Tage, nur TLS; worker ohne Wiederholung mit onFailure in die Queue', () => {
    const [[queueId, queue] = []] = resources(t.jobs, 'AWS::SQS::Queue');
    expect(queue?.Properties).toMatchObject({
      QueueName: config.workerFailureQueue,
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: 14 * 24 * 3600,
    });
    const policy = json(
      resources(t.jobs, 'AWS::SQS::QueuePolicy')[0]?.[1].Properties.PolicyDocument,
    );
    expect(policy).toContain('aws:SecureTransport');
    const [[, invokeConfig] = []] = resources(t.jobs, 'AWS::Lambda::EventInvokeConfig');
    expect(invokeConfig?.Properties.MaximumRetryAttempts).toBe(0);
    expect(json(invokeConfig?.Properties.DestinationConfig)).toContain(`"${queueId}"`);
  });
});

describe('Lambdas und Logs (TK 4.2, 16.1, SV-15)', () => {
  const appFunctions = all
    .flatMap((tpl) => resources(tpl, 'AWS::Lambda::Function'))
    .filter(([, f]) => String(f.Properties.FunctionName ?? '').startsWith('nina-pm-'))
    .map(([, f]) => f);

  it('drei Anwendungs-Lambdas: Node 24, arm64, X-Ray aktiv, Source Maps', () => {
    expect(appFunctions.map((f) => f.Properties.FunctionName).sort()).toEqual(
      Object.values(config.lambdas)
        .map((l) => l.functionName)
        .sort(),
    );
    for (const f of appFunctions) {
      expect(f.Properties).toMatchObject({
        Runtime: 'nodejs24.x',
        Architectures: ['arm64'],
        TracingConfig: { Mode: 'Active' },
      });
      expect(json(f.Properties.Environment)).toContain('--enable-source-maps');
    }
  });

  it('alle Log-Gruppen behalten 90 Tage', () => {
    const groups = all.flatMap((tpl) => resources(tpl, 'AWS::Logs::LogGroup'));
    expect(groups.length).toBeGreaterThanOrEqual(5);
    for (const [id, g] of groups) expect(g.Properties.RetentionInDays, id).toBe(90);
  });
});

describe('Edge: /api/* an die HTTP API mit X-Origin-Verify (SV-16)', () => {
  const dist = resources(t.edge, 'AWS::CloudFront::Distribution')[0]?.[1] as Resource;
  const cfg = dist.Properties.DistributionConfig as {
    Origins: {
      Id: string;
      DomainName: unknown;
      OriginCustomHeaders?: { HeaderName: string; HeaderValue: unknown }[];
    }[];
    CacheBehaviors: {
      PathPattern: string;
      TargetOriginId: string;
      AllowedMethods: string[];
      CachePolicyId: string;
      OriginRequestPolicyId?: string;
    }[];
  };
  const apiBehavior = cfg.CacheBehaviors.find((b) => b.PathPattern === '/api/*');
  const apiOrigin = cfg.Origins.find((o) => o.Id === apiBehavior?.TargetOriginId);

  it('Origin ist die execute-api-Adresse aus NinaPm-Api', () => {
    expect(json(apiOrigin?.DomainName)).toContain('ApiEndpoint');
  });

  it('CloudFront sendet den einen Wert aus /nina-pm/origin-verify', () => {
    const header = apiOrigin?.OriginCustomHeaders?.find((h) => h.HeaderName === 'X-Origin-Verify');
    const ref = (header?.HeaderValue as { Ref?: string } | undefined)?.Ref;
    expect(ref).toBeDefined();
    const param = (t.edge.toJSON().Parameters as Record<string, { Type: string; Default: string }>)[
      ref ?? ''
    ];
    expect(param).toEqual({
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: config.ssm.originVerify,
    });
  });

  it('alle Methoden, ohne Cache, alle Viewer-Header außer Host', () => {
    expect(apiBehavior?.AllowedMethods).toHaveLength(7);
    expect(apiBehavior?.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    expect(apiBehavior?.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
  });
});

describe('Ops: SNS, Alarme nach TK 16.2, Health-Check, Budget', () => {
  it('SNS-Topic mit E-Mail-Abo (H-09)', () => {
    t.ops.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: config.alarmEmail,
    });
  });

  it('die Alarme aus TK 16.2 schicken an das Topic', () => {
    const alarms = resources(t.ops, 'AWS::CloudWatch::Alarm').map(([, a]) => a.Properties);
    expect(alarms.map((a) => a.AlarmName).sort()).toEqual(
      [
        'nina-pm-api-5xx-rate',
        'nina-pm-api-nina-errors',
        'nina-pm-api-stage-count',
        'nina-pm-api-throttles',
        'nina-pm-backup-jobs-failed',
        'nina-pm-dsql-retries',
        'nina-pm-stale-running-sessions',
        'nina-pm-worker-errors',
        'nina-pm-worker-failures-queue',
      ].sort(),
    );
    for (const a of alarms) expect(json(a.AlarmActions)).toContain('Alarms');
  });

  it('Schwellen: Throttles > 10, Stage-Count > 100.000, Backup > 0', () => {
    const byName = (n: string) =>
      resources(t.ops, 'AWS::CloudWatch::Alarm').find(([, a]) => a.Properties.AlarmName === n)?.[1]
        .Properties;
    expect(byName('nina-pm-api-throttles')).toMatchObject({
      Threshold: 10,
      MetricName: 'Throttles',
    });
    expect(byName('nina-pm-api-stage-count')).toMatchObject({
      Threshold: 100000,
      MetricName: 'Count',
    });
    expect(byName('nina-pm-backup-jobs-failed')).toMatchObject({
      Threshold: 0,
      MetricName: 'NumberOfBackupJobsFailed',
    });
  });

  it('Route-53-Health-Check auf /api/health über CloudFront, ohne Alarm', () => {
    t.ops.hasResourceProperties('AWS::Route53::HealthCheck', {
      HealthCheckConfig: {
        Type: 'HTTPS',
        FullyQualifiedDomainName: config.domainName,
        ResourcePath: '/api/health',
        FailureThreshold: 3,
      },
    });
    expect(json(t.ops.toJSON())).not.toContain('HealthCheckStatus');
  });

  it('Budget 20 USD im Monat an das Topic', () => {
    t.ops.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: { BudgetLimit: { Amount: 20, Unit: 'USD' }, TimeUnit: 'MONTHLY', BudgetType: 'COST' },
    });
  });
});
