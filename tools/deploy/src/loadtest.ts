/**
 * `pnpm loadtest:prod` (AP-17, iam.md §9 – Drosselung statt WAF): je ≈ 10 s mit 100 Aufrufen/s gegen
 * `GET /api/auth/discord/start` (über CloudFront, erwartet `302`/`429`) und die `execute-api`-Adresse
 * (erwartet `403`/`429`); danach höchste Parallelität der `api` aus CloudWatch. Ergebnis als Artefakt
 * `docs/test-runs/<Datum>/ap-17/loadtest.json`. **Nur Sven** – belastet prod kurz.
 */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { config } from '@nina-pm/infra/config';
import { evaluate, summarize, type Hit } from './golive/load';
import { aws, cdkOutputs, commit, writeProtocol } from './golive/run';

const RATE = 100;
const SECONDS = 10;

async function burst(url: string): Promise<Hit[]> {
  const pending: Promise<Hit>[] = [];
  for (let i = 0; i < RATE * SECONDS; i += 1) {
    const started = Date.now();
    pending.push(
      fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
        .then(async (res) => {
          await res.arrayBuffer().catch(() => undefined);
          return { status: res.status, ms: Date.now() - started };
        })
        .catch(() => ({ status: 0, ms: Date.now() - started })),
    );
    await new Promise((r) => setTimeout(r, 1000 / RATE));
  }
  return Promise.all(pending);
}

async function main() {
  const executeApi = cdkOutputs()['NinaPm-Api']?.ApiEndpoint;
  if (!executeApi)
    throw new Error('infra/cdk-outputs.json ohne NinaPm-Api.ApiEndpoint – zuerst deployen');
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (
    await rl.question('Lasttest gegen prod (2 × 10 s, 100/s) starten? (ja/nein) ')
  ).trim();
  rl.close();
  if (answer !== 'ja') process.exit(1);

  const from = new Date(Date.now() - 60_000);
  const startUrl = `https://${config.domainName}/api/auth/discord/start?next=/`;
  const directUrl = `${executeApi.replace(/\/$/, '')}/api/health`;
  console.log(`▶ ${startUrl}`);
  const start = summarize('GET /api/auth/discord/start (CloudFront)', await burst(startUrl));
  console.log(`  ${JSON.stringify(start.byStatus)}`);
  console.log(`▶ ${directUrl}`);
  const direct = summarize('GET /api/health (execute-api direkt)', await burst(directUrl));
  console.log(`  ${JSON.stringify(direct.byStatus)}`);

  // Metriken brauchen etwas, bis sie in CloudWatch stehen.
  await new Promise((r) => setTimeout(r, 90_000));
  const to = new Date();
  const stat = (metric: string, statistic: string) =>
    aws<{ Datapoints?: Record<string, number>[] }>([
      'cloudwatch',
      'get-metric-statistics',
      '--namespace',
      'AWS/Lambda',
      '--metric-name',
      metric,
      '--dimensions',
      `Name=FunctionName,Value=${config.lambdas.api.functionName}`,
      '--start-time',
      from.toISOString(),
      '--end-time',
      to.toISOString(),
      '--period',
      '60',
      '--statistics',
      statistic,
    ])?.Datapoints ?? [];
  const concurrency = stat('ConcurrentExecutions', 'Maximum');
  const maxConcurrency =
    concurrency.length === 0 ? null : Math.max(...concurrency.map((d) => d.Maximum ?? 0));
  const throttles = stat('Throttles', 'Sum').reduce((s, d) => s + (d.Sum ?? 0), 0);
  const verdict = evaluate(start, direct, maxConcurrency, config.reservedConcurrency.api);

  const artifact = {
    at: to.toISOString(),
    commit: commit(),
    rate: RATE,
    seconds: SECONDS,
    results: [start, direct],
    api: {
      maxConcurrentExecutions: maxConcurrency,
      throttles,
      reserved: config.reservedConcurrency.api,
    },
    verdict,
  };
  const path = writeProtocol('loadtest.json', `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `\n${verdict.ok ? '✓ Drosselung wirkt' : '✗ Befunde'}${verdict.findings.map((f) => `\n  – ${f}`).join('')}`,
  );
  console.log(`Artefakt: ${path}`);
  process.exit(verdict.ok ? 0 : 1);
}

await main();
