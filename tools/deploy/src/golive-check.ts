/**
 * `pnpm golive:check [--snapshot-website]` (AP-17): prüft die automatisierbaren Punkte der
 * Go-live-Checkliste gegen prod – **nur lesend** – und legt das Protokoll unter
 * `docs/test-runs/<Datum>/ap-17/golive-check.md` ab. Nur Sven, lokal mit Admin-Profil (H-06).
 * `--snapshot-website` sichert zusätzlich die Konfiguration der Website-Distribution als Vorher-Stand
 * (H-23); ohne den Schalter wird gegen den jüngsten gesicherten Stand verglichen.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { config } from '@nina-pm/infra/config';
import {
  checkAlarms,
  checkBackup,
  checkBudget,
  checkConcurrency,
  checkCsrf,
  checkDeletionProtection,
  checkHealth,
  checkSubscription,
  checkThumbCsp,
  compareDistribution,
  reportMarkdown,
  type CheckResult,
} from './golive/checks';
import { aws, cdkOutputs, commit, repoRoot, writeProtocol } from './golive/run';

const WEBSITE_DISTRIBUTION = 'E2L6Q80SD8XPT0';
const base = `https://${config.domainName}`;

function latestSnapshot(): unknown {
  const root = `${repoRoot}docs/test-runs`;
  if (!existsSync(root)) return undefined;
  const files = readdirSync(root)
    .sort()
    .reverse()
    .map((d) => `${root}/${d}/ap-17/website-distribution.json`)
    .filter((f) => existsSync(f));
  return files[0] ? (JSON.parse(readFileSync(files[0], 'utf8')) as unknown) : undefined;
}

async function main() {
  const snapshot = process.argv.includes('--snapshot-website');
  const results: CheckResult[] = [];
  const outputs = cdkOutputs();
  const clusterArn = outputs['NinaPm-Data']?.DsqlClusterArn ?? '';
  const clusterId = clusterArn.split('/').pop() ?? '';

  const website = aws<{ DistributionConfig: unknown }>(
    ['cloudfront', 'get-distribution-config', '--id', WEBSITE_DISTRIBUTION],
    'us-east-1',
  )?.DistributionConfig;
  if (snapshot && website !== undefined) {
    const path = writeProtocol(
      'website-distribution.json',
      `${JSON.stringify(website, null, 2)}\n`,
    );
    console.log(`Vorher-Stand gesichert: ${path}`);
  } else {
    results.push(compareDistribution(latestSnapshot(), website));
  }

  results.push(
    checkAlarms(
      aws(['cloudwatch', 'describe-alarms', '--alarm-name-prefix', 'nina-pm-']) ?? {},
      config.alarmTopic,
    ),
  );
  const topicArn = `arn:aws:sns:${config.region}:${config.account}:${config.alarmTopic}`;
  results.push(
    checkSubscription(aws(['sns', 'list-subscriptions-by-topic', '--topic-arn', topicArn]) ?? {}),
  );
  results.push(
    checkBackup(
      aws(['backup', 'list-backup-plans']) ?? {},
      aws(['backup', 'list-backup-jobs', '--by-resource-arn', clusterArn, '--max-results', '10']) ??
        {},
    ),
  );
  results.push(
    checkDeletionProtection(aws(['dsql', 'get-cluster', '--identifier', clusterId]) ?? {}),
  );
  for (const [fn, expected] of [
    [config.lambdas.api.functionName, config.reservedConcurrency.api],
    [config.lambdas.worker.functionName, config.reservedConcurrency.worker],
  ] as const)
    results.push(
      checkConcurrency(
        fn,
        aws(['lambda', 'get-function-concurrency', '--function-name', fn]) ?? {},
        expected,
      ),
    );
  results.push(
    checkBudget(
      aws(
        [
          'budgets',
          'describe-budget',
          '--account-id',
          config.account,
          '--budget-name',
          'nina-pm-monthly',
        ],
        'us-east-1',
      ) ?? {},
      config.budgetUsd,
    ),
  );
  const checks = aws<{
    HealthChecks?: {
      Id: string;
      HealthCheckConfig: { FullyQualifiedDomainName?: string; ResourcePath?: string };
    }[];
  }>(['route53', 'list-health-checks'], 'us-east-1');
  const hc = checks?.HealthChecks?.find(
    (h) =>
      h.HealthCheckConfig.FullyQualifiedDomainName === config.domainName &&
      h.HealthCheckConfig.ResourcePath === '/api/health',
  );
  results.push(
    checkHealth(
      hc
        ? (aws(['route53', 'get-health-check-status', '--health-check-id', hc.Id], 'us-east-1') ??
            {})
        : {},
    ),
  );

  // HTTP-Prüfungen ohne Anmeldung.
  for (const path of ['/api/auth/invitation/claim', '/api/auth/invitations/preview']) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body = (await res.json().catch(() => ({}))) as { code?: unknown };
    results.push(checkCsrf(path, res.status, body.code));
  }
  const thumb = await fetch(`${base}/catalog/thumbs/golive-probe.html`);
  results.push(checkThumbCsp(thumb.headers.get('content-security-policy')));

  const at = new Date().toISOString();
  const md = reportMarkdown(results, { at, commit: commit() });
  const path = writeProtocol('golive-check.md', md);
  for (const r of results)
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` – ${r.detail}`}`);
  console.log(`\nProtokoll: ${path}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

await main();
