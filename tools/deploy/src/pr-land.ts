/**
 * `pnpm pr:land <nr> [<nr> …] [--deploy]` – PRs der Reihe nach landen, ohne daneben zu warten:
 * je PR auf die CI warten, prüfen, ob er konfliktfrei ist, mit Merge-Commit mergen und den Branch
 * löschen. Mit `--deploy` folgt danach `pnpm deploy:prod` (fragt weiterhin nach „ja“).
 *
 * Ersatz für GitHub-Auto-Merge: im privaten Repo ohne GitHub Pro gibt es keine Pflicht-Checks, und
 * `gh pr merge --auto` würde sofort mergen, statt auf die CI zu warten. Nur Sven führt das aus
 * (Claude Code mergt keine eigenen PRs).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function gh(args: string[], inherit = false): { ok: boolean; out: string } {
  const res = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}`.trim() };
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** GitHub rechnet `mergeable` nach jedem Merge neu (UNKNOWN); kurz warten. */
async function mergeable(pr: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const state = gh(['pr', 'view', pr, '--json', 'mergeable', '--jq', '.mergeable']).out;
    if (state !== 'UNKNOWN' && state !== '') return state;
    await sleep(5000);
  }
  return 'UNKNOWN';
}

async function land(pr: string): Promise<void> {
  const state = gh(['pr', 'view', pr, '--json', 'state', '--jq', '.state']).out;
  if (state === 'MERGED') {
    console.log(`#${pr} ist schon gemergt.`);
    return;
  }
  if (state !== 'OPEN') fail(`#${pr} ist ${state || 'nicht auffindbar'}.`);

  console.log(`\n▶ #${pr}: warte auf die CI …`);
  // Neue Läufe nach einem Push brauchen einen Moment, bis sie erscheinen.
  await sleep(5000);
  const checks = gh(['pr', 'checks', pr, '--watch', '--interval', '15', '--fail-fast'], true);
  if (!checks.ok) fail(`#${pr}: CI nicht grün – bitte Claude Code Bescheid geben.`);

  const m = await mergeable(pr);
  if (m === 'CONFLICTING')
    fail(`#${pr} hat Konflikte mit main – Claude Code löst sie, danach erneut pnpm pr:land ${pr}.`);
  if (m !== 'MERGEABLE') fail(`#${pr}: GitHub meldet mergeable = ${m}.`);

  const merged = gh(['pr', 'merge', pr, '--merge', '--delete-branch'], true);
  if (!merged.ok) fail(`#${pr} ließ sich nicht mergen.`);
  console.log(`✓ #${pr} gemergt.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const deploy = args.includes('--deploy');
  const prs = args.filter((a) => /^\d+$/.test(a));
  if (prs.length === 0) fail('Aufruf: pnpm pr:land <nr> [<nr> …] [--deploy]');

  for (const pr of prs) await land(pr);

  // Lokalen main nachziehen (gh wechselt beim Löschen des Branches meist schon dorthin).
  spawnSync('git', ['checkout', 'main'], { cwd: repoRoot, stdio: 'inherit' });
  spawnSync('git', ['pull', '--ff-only'], { cwd: repoRoot, stdio: 'inherit' });

  if (!deploy) {
    console.log('\nFertig. Deploy bei Bedarf: pnpm deploy:prod');
    return;
  }
  const res = spawnSync('pnpm', ['deploy:prod'], { cwd: repoRoot, stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

await main();
