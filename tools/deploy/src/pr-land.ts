/**
 * `pnpm pr:land <nr> [<nr> …] [--deploy]` – PRs der Reihe nach landen, ohne daneben zu warten:
 * je PR auf die CI warten, prüfen, ob er konfliktfrei ist, mit Merge-Commit mergen und den Branch
 * löschen – nur den Kopf-Commit, dessen CI abgewartet wurde (`--match-head-commit`). Mit `--deploy` folgt danach `pnpm deploy:prod` (fragt weiterhin nach „ja“).
 *
 * Meldet sich auf macOS mit einer Mitteilung (gelandet, CI rot, Konflikt, Deploy-Bestätigung), damit niemand
 * danebensitzen muss (Sven 03.10.2026) – einfach in einem eigenen Terminal-Tab starten und weiterarbeiten.
 *
 * Ersatz für GitHub-Auto-Merge: im privaten Repo ohne GitHub Pro gibt es keine Pflicht-Checks, und
 * `gh pr merge --auto` würde sofort mergen, statt auf die CI zu warten. Nur Sven führt das aus
 * (Claude Code mergt keine eigenen PRs).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeAtHead, readPrHead } from './pr-land-merge';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function gh(args: string[], inherit = false): { ok: boolean; out: string } {
  const res = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}`.trim() };
}

/** macOS-Mitteilung (Benachrichtigungszentrale); anderswo oder ohne osascript still. */
function notify(title: string, message: string): void {
  if (process.platform !== 'darwin') return;
  const q = (t: string) => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  spawnSync(
    'osascript',
    ['-e', `display notification "${q(message)}" with title "${q(title)}" sound name "Glass"`],
    {
      stdio: 'ignore',
    },
  );
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  notify('pr:land – Abbruch', message);
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

  // Kopf-Commit vor dem Warten festhalten: gemergt wird nur genau dieser Stand (pr-land-merge.ts).
  let head: string;
  try {
    head = readPrHead(gh, pr);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  console.log(`\n▶ #${pr} (${head.slice(0, 7)}): warte auf die CI …`);
  // Neue Läufe nach einem Push brauchen einen Moment, bis sie erscheinen.
  await sleep(5000);
  const checks = gh(['pr', 'checks', pr, '--watch', '--interval', '15', '--fail-fast'], true);
  if (!checks.ok) fail(`#${pr}: CI nicht grün – bitte Claude Code Bescheid geben.`);

  const m = await mergeable(pr);
  if (m === 'CONFLICTING')
    fail(`#${pr} hat Konflikte mit main – Claude Code löst sie, danach erneut pnpm pr:land ${pr}.`);
  if (m !== 'MERGEABLE') fail(`#${pr}: GitHub meldet mergeable = ${m}.`);

  try {
    mergeAtHead(gh, pr, head);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  console.log(`✓ #${pr} gemergt.`);
  notify('pr:land', `#${pr} gelandet`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const deploy = args.includes('--deploy');
  const prs = args.filter((a) => /^\d+$/.test(a));
  if (prs.length === 0) fail('Aufruf: pnpm pr:land <nr> [<nr> …] [--deploy]');

  for (const pr of prs) await land(pr);

  // Lokalen main nachziehen (gh wechselt beim Löschen des Branches meist schon dorthin). Scheitert das
  // (z. B. eine liegengebliebene, nicht verfolgte Datei), wird nicht deployt – sonst liefe der alte Stand.
  const checkout = spawnSync('git', ['checkout', 'main'], { cwd: repoRoot, stdio: 'inherit' });
  if (checkout.status !== 0)
    fail('git checkout main ist gescheitert – Arbeitsbaum prüfen, dann erneut.');
  const pull = spawnSync('git', ['pull', '--ff-only'], { cwd: repoRoot, stdio: 'inherit' });
  if (pull.status !== 0)
    fail(
      'git pull --ff-only ist gescheitert – main ist nicht aktuell, es wird nicht deployt. ' +
        'Meldung oben lesen (z. B. nicht verfolgte Datei entfernen), dann `pnpm deploy:prod`.',
    );

  if (!deploy) {
    console.log('\nFertig. Deploy bei Bedarf: pnpm deploy:prod');
    return;
  }
  notify(
    'pr:land',
    `${prs.map((p) => `#${p}`).join(', ')} gelandet – Deploy startet (Bestätigung „ja“ im Terminal)`,
  );
  const res = spawnSync('pnpm', ['deploy:prod'], { cwd: repoRoot, stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

await main();
