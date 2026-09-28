/**
 * CI-Vorbedingung von `pnpm deploy:prod` (TK 18). Ausgelagert, damit sie ohne GitHub testbar ist:
 * `git` und `gh` kommen als Funktionen herein.
 */

/** Ergebnis eines Kommandoaufrufs (Exit 0 → `ok`, `out` = stdout ohne Rand-Leerraum). */
export interface CmdResult {
  ok: boolean;
  out: string;
}
export type Cmd = (args: string[]) => CmdResult;

export interface CiGateDeps {
  git: Cmd;
  gh: Cmd;
  sleep: (ms: number) => Promise<void>;
  /** `gh run watch <id>` – wartet, bis der Lauf fertig ist. */
  watch: (runId: string) => void;
  log: (line: string) => void;
}

const RUNNING = ['in_progress', 'queued', 'waiting', 'pending', 'requested'];

/** Letzter CI-Lauf (ci.yml) eines Commits: Zustand `<status> <conclusion>` und Lauf-ID, oder leer. */
function latestRun(gh: Cmd, sha: string): { state: string; id: string } {
  const out = gh([
    'run',
    'list',
    '--commit',
    sha,
    '--workflow',
    'ci.yml',
    '--limit',
    '1',
    '--json',
    'status,conclusion,databaseId',
    '--jq',
    '.[] | .status + " " + .conclusion + " " + (.databaseId | tostring)',
  ]).out;
  const parts = out.split(' ');
  if (parts.length < 3 || !parts[0]) return { state: '', id: '' };
  return { state: `${parts[0]} ${parts[1]}`.trim(), id: parts[2] ?? '' };
}

/**
 * Ein Lauf zählt nur, wenn **kein** Job übersprungen wurde: In PRs überspringt `ci.yml` Tests, Build und
 * E2E bei reinen Doku-Änderungen, und GitHub meldet den Lauf trotzdem als `success`. Ein solcher Lauf sagt
 * nichts über den Code aus (der Vorgänger kann rot gewesen sein, P1-21a).
 */
export function isFullRun(gh: Cmd, runId: string): boolean {
  if (!/^\d+$/.test(runId)) return false;
  const res = gh([
    'run',
    'view',
    runId,
    '--json',
    'jobs',
    '--jq',
    '[.jobs[] | select(.conclusion == "skipped")] | length',
  ]);
  return res.ok && res.out === '0';
}

/**
 * CI-Vorbedingung (TK 18) ohne unnötiges Warten:
 * 1. vollständiger grüner Lauf auf `sha`, oder
 * 2. vollständiger grüner Lauf auf einem Commit mit **identischem Dateistand** (gleicher Git-Tree) – nach
 *    einem Merge-Commit eines aktuellen PR-Branches ist das der PR-Lauf; gleiche Dateien, gleiche Prüfungen, oder
 * 3. der Lauf auf `sha` läuft noch oder ist gerade angelegt (`queued`, `pending`, `requested`, `waiting`,
 *    `in_progress`, z. B. direkt nach `pr:land`) → warten (`gh run watch`), statt abzubrechen.
 * „Vollständig“ heißt: kein Job übersprungen (`isFullRun`). Wirft mit Begründung, wenn nichts davon zutrifft.
 */
export async function ensureGreenCi(sha: string, deps: CiGateDeps): Promise<string> {
  const { git, gh } = deps;
  const own = latestRun(gh, sha);
  if (own.state === 'completed success' && isFullRun(gh, own.id)) return 'Lauf auf diesem Commit';

  const tree = git(['rev-parse', `${sha}^{tree}`]).out;
  const recent = gh([
    'run',
    'list',
    '--workflow',
    'ci.yml',
    '--status',
    'success',
    '--limit',
    '40',
    '--json',
    'headSha,databaseId',
    '--jq',
    '.[] | .headSha + " " + (.databaseId | tostring)',
  ]).out.split('\n');
  for (const line of recent) {
    const [candidate, id] = line.split(' ');
    if (!candidate || !id || candidate === sha || !tree) continue;
    const t = git(['rev-parse', `${candidate}^{tree}`]);
    if (t.ok && t.out === tree && isFullRun(gh, id))
      return `gleicher Stand wie ${candidate.slice(0, 7)}`;
  }

  // Direkt nach dem Merge legt GitHub den Lauf erst nach einigen Sekunden an.
  let run = latestRun(gh, sha);
  for (let i = 0; run.state === '' && i < 12; i += 1) {
    await deps.sleep(5000);
    run = latestRun(gh, sha);
  }
  if (RUNNING.some((s) => run.state.startsWith(s))) {
    deps.log(`  CI auf ${sha.slice(0, 7)} läuft noch – warte …`);
    deps.watch(run.id);
    run = latestRun(gh, sha);
    if (run.state === 'completed success' && isFullRun(gh, run.id))
      return 'Lauf auf diesem Commit, abgewartet';
  }
  const detail =
    run.state === 'completed success'
      ? 'grün, aber mit übersprungenen Jobs (reiner Doku-Lauf)'
      : run.state || 'kein Lauf';
  throw new Error(`CI auf ${sha.slice(0, 7)} ist nicht grün (${detail}).`);
}
