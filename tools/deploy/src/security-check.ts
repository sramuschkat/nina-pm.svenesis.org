/**
 * `pnpm security:check` (Sicherheitsanalyse 05.10.2026): prüft das AWS-Konto und die NINA-PM-Ressourcen auf
 * unautorisierten Zugriff – **nur lesende** AWS-CLI-Aufrufe, keine geheimen Werte im Protokoll. Nur Sven, lokal mit
 * Admin-Profil (H-06); Claude Code führt es nie aus. Protokoll unter `docs/test-runs/<Datum>/security/aws-check.md`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { config } from '@nina-pm/infra/config';
import { aws, cdkOutputs, commit, repoRoot } from './golive/run';
import {
  checkAccessAnalyzer,
  checkAccountPublicAccess,
  checkBucket,
  checkCloudTrail,
  checkDistribution,
  checkGuardDuty,
  checkHttpApi,
  checkIamUsers,
  checkLambda,
  checkLogRetention,
  checkQueuePolicy,
  checkRole,
  checkRoot,
  checkApiInventory,
  checkBucketInventory,
  checkLegacyAccess,
  checkSchedules,
  checkSsmInventory,
  parseCredentialReport,
  reportMarkdown,
  secretLiterals,
  type SecurityResult,
} from './security/checks';

const GLOBAL = 'us-east-1';

async function directStatus(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10_000) });
    return res.status;
  } catch {
    return undefined;
  }
}

function credentialReport(): Record<string, string>[] | undefined {
  // Bericht anstoßen (lesend, AWS erzeugt ihn), dann abholen; ein paar Versuche, bis er fertig ist.
  for (let i = 0; i < 10; i += 1) {
    aws(['iam', 'generate-credential-report'], GLOBAL);
    const r = aws<{ Content?: string }>(['iam', 'get-credential-report'], GLOBAL);
    if (r?.Content) return parseCredentialReport(Buffer.from(r.Content, 'base64').toString('utf8'));
    spawnSync('sleep', ['2']);
  }
  return undefined;
}

async function main() {
  const results: SecurityResult[] = [];
  const add = (r: SecurityResult | SecurityResult[]) =>
    results.push(...(Array.isArray(r) ? r : [r]));
  const outputs = cdkOutputs();
  const account = aws<{ Account?: string }>(['sts', 'get-caller-identity'])?.Account;
  if (!account)
    throw new Error('AWS-CLI ohne gültige Anmeldung – Admin-Profil setzen (AWS_PROFILE)');

  // ---- Konto ----
  add(checkRoot(aws(['iam', 'get-account-summary'], GLOBAL)));
  add(checkIamUsers(credentialReport(), Date.now()));
  add(
    checkAccountPublicAccess(
      aws(['s3control', 'get-public-access-block', '--account-id', account]),
    ),
  );
  const trails = aws<{
    trailList?: { Name?: string; IsMultiRegionTrail?: boolean; TrailARN?: string }[];
  }>(['cloudtrail', 'describe-trails']);
  const logging: Record<string, boolean> = {};
  for (const t of trails?.trailList ?? [])
    if (t.Name)
      logging[t.Name] = !!aws<{ IsLogging?: boolean }>([
        'cloudtrail',
        'get-trail-status',
        '--name',
        t.TrailARN ?? t.Name,
      ])?.IsLogging;
  add(checkCloudTrail(trails, logging));
  for (const region of [config.region, GLOBAL])
    add(checkGuardDuty(aws(['guardduty', 'list-detectors'], region), region));
  const analyzers = aws<{ analyzers?: { arn?: string; type?: string; status?: string }[] }>([
    'accessanalyzer',
    'list-analyzers',
  ]);
  const analyzer = analyzers?.analyzers?.find((a) => a.status === 'ACTIVE')?.arn;
  add(
    checkAccessAnalyzer(
      analyzers,
      analyzer ? aws(['accessanalyzer', 'list-findings', '--analyzer-arn', analyzer]) : undefined,
    ),
  );

  // ---- S3 ----
  for (const name of [config.buckets.web, config.buckets.data]) {
    const pab = aws<{ PublicAccessBlockConfiguration?: Record<string, boolean> }>([
      's3api',
      'get-public-access-block',
      '--bucket',
      name,
    ])?.PublicAccessBlockConfiguration;
    add(
      checkBucket({
        name,
        publicAccessBlock: pab,
        policyIsPublic: aws<{ PolicyStatus?: { IsPublic?: boolean } }>([
          's3api',
          'get-bucket-policy-status',
          '--bucket',
          name,
        ])?.PolicyStatus?.IsPublic,
        policy: aws<{ Policy?: string }>(['s3api', 'get-bucket-policy', '--bucket', name])?.Policy,
        aclGrants: aws<{ Grants?: { Grantee?: { URI?: string } }[] }>([
          's3api',
          'get-bucket-acl',
          '--bucket',
          name,
        ])?.Grants,
        encrypted: !!aws(['s3api', 'get-bucket-encryption', '--bucket', name]),
        versioning: aws<{ Status?: string }>(['s3api', 'get-bucket-versioning', '--bucket', name])
          ?.Status,
        ownership: aws<{ OwnershipControls?: { Rules?: { ObjectOwnership?: string }[] } }>([
          's3api',
          'get-bucket-ownership-controls',
          '--bucket',
          name,
        ])?.OwnershipControls?.Rules?.[0]?.ObjectOwnership,
      }),
    );
  }

  // ---- Lambda und ihre Rollen ----
  const fns =
    aws<{ Functions?: { FunctionName?: string; Role?: string; Runtime?: string }[] }>([
      'lambda',
      'list-functions',
    ])?.Functions?.filter((f) => /nina-pm|NinaPm/i.test(f.FunctionName ?? '')) ?? [];
  const roles = new Set<string>();
  for (const f of fns) {
    const name = f.FunctionName ?? '';
    const url = aws<{ AuthType?: string }>([
      'lambda',
      'get-function-url-config',
      '--function-name',
      name,
    ]);
    const env =
      aws<{ Environment?: { Variables?: Record<string, string> } }>([
        'lambda',
        'get-function-configuration',
        '--function-name',
        name,
      ])?.Environment?.Variables ?? {};
    add(
      checkLambda({
        name,
        hasFunctionUrl: !!url,
        functionUrlAuth: url?.AuthType,
        resourcePolicy: aws<{ Policy?: string }>(['lambda', 'get-policy', '--function-name', name])
          ?.Policy,
        envNames: Object.keys(env).sort(),
        envSecretLiterals: secretLiterals(env),
        runtime: f.Runtime,
      }),
    );
    if (f.Role) roles.add(f.Role.split('/').pop() ?? '');
  }
  for (const role of [...roles].filter(Boolean).sort()) {
    const attached =
      aws<{ AttachedPolicies?: { PolicyArn?: string }[] }>(
        ['iam', 'list-attached-role-policies', '--role-name', role],
        GLOBAL,
      )?.AttachedPolicies?.map((p) => p.PolicyArn ?? '') ?? [];
    const names =
      aws<{ PolicyNames?: string[] }>(['iam', 'list-role-policies', '--role-name', role], GLOBAL)
        ?.PolicyNames ?? [];
    const inline = names.map((n) => ({
      name: n,
      document:
        aws<{ PolicyDocument?: { Statement?: never } }>(
          ['iam', 'get-role-policy', '--role-name', role, '--policy-name', n],
          GLOBAL,
        )?.PolicyDocument ?? {},
    }));
    add(checkRole({ role, attached, inline }));
  }

  // ---- API Gateway, CloudFront, SSM, Logs, SQS ----
  const apiId = outputs['NinaPm-Api']?.PublishOutputRefHttpApiF5A9A8A73B77AB98 ?? '';
  const endpoint = outputs['NinaPm-Api']?.ApiEndpoint ?? '';
  add(
    checkHttpApi(
      apiId ? aws(['apigatewayv2', 'get-api', '--api-id', apiId]) : undefined,
      endpoint ? await directStatus(endpoint) : undefined,
    ),
  );
  const dists =
    aws<{ DistributionList?: { Items?: { Id?: string; Aliases?: { Items?: string[] } }[] } }>(
      ['cloudfront', 'list-distributions'],
      GLOBAL,
    )?.DistributionList?.Items ?? [];
  const dist = dists.find((d) => d.Aliases?.Items?.includes(config.domainName));
  add(
    checkDistribution(
      dist?.Id
        ? aws<{ DistributionConfig?: never }>(
            ['cloudfront', 'get-distribution-config', '--id', dist.Id],
            GLOBAL,
          )?.DistributionConfig
        : undefined,
    ),
  );
  add(
    checkSsmInventory(
      aws([
        'ssm',
        'describe-parameters',
        '--parameter-filters',
        'Key=Name,Option=BeginsWith,Values=/nina-pm/',
      ]),
      Object.values(config.ssm),
      [config.ssm.cookieSecret, config.ssm.discordClientSecret, config.ssm.alarmWebhook],
    ),
  );
  add(
    checkLegacyAccess(
      aws(['iam', 'list-roles', '--max-items', '1000'], GLOBAL),
      aws(['iam', 'list-open-id-connect-providers'], GLOBAL),
    ),
  );
  add(
    checkApiInventory(
      aws(['apigatewayv2', 'get-apis']),
      aws(['apigatewayv2', 'get-domain-names']),
      apiId,
    ),
  );
  add(
    checkBucketInventory(
      aws(['s3api', 'list-buckets'], GLOBAL),
      [config.buckets.web, config.buckets.data],
      aws(['s3api', 'get-bucket-cors', '--bucket', config.buckets.data]) ?? {},
    ),
  );
  const workerArn =
    outputs['NinaPm-Jobs']?.PublishOutputFnGetAttWorkerFunctionAF8A26AFArn865947EE ?? '';
  const scheduleNames = aws<{ Schedules?: { Name?: string }[] }>([
    'scheduler',
    'list-schedules',
    '--group-name',
    'nina-pm',
  ])?.Schedules;
  add(
    checkSchedules(
      scheduleNames
        ? {
            Schedules: scheduleNames.map((sc) => ({
              Name: sc.Name,
              Target: aws<{ Target?: { Arn?: string } }>([
                'scheduler',
                'get-schedule',
                '--group-name',
                'nina-pm',
                '--name',
                sc.Name ?? '',
              ])?.Target,
            })),
          }
        : undefined,
      workerArn || 'arn:aws:lambda:',
    ),
  );
  for (const prefix of ['/aws/lambda/nina-pm', '/aws/apigateway/nina-pm'])
    add(checkLogRetention(aws(['logs', 'describe-log-groups', '--log-group-name-prefix', prefix])));
  const queueUrl = outputs['NinaPm-Jobs']?.PublishOutputRefWorkerFailuresE34998E6E996E027;
  if (queueUrl)
    add(
      checkQueuePolicy(
        'nina-pm-worker-failures',
        aws<{ Attributes?: { Policy?: string } }>([
          'sqs',
          'get-queue-attributes',
          '--queue-url',
          queueUrl,
          '--attribute-names',
          'Policy',
        ])?.Attributes?.Policy,
      ),
    );

  // ---- Protokoll ----
  const now = new Date();
  const d = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dir = `${repoRoot}docs/test-runs/${d}/security`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = `${dir}/aws-check.md`;
  writeFileSync(
    path,
    reportMarkdown(results, { at: now.toISOString(), commit: commit(), account }),
  );
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) console.log(`☐ [${r.severity}] ${r.area}: ${r.name} – ${r.detail}`);
  console.log(
    `${String(results.length - bad.length)}/${String(results.length)} grün. Protokoll: ${path.replace(repoRoot, '')}`,
  );
  process.exit(bad.some((r) => r.severity === 'hoch') ? 1 : 0);
}

await main();
