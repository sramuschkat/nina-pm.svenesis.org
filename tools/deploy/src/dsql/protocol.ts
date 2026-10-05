/** Protokoll von `pnpm test:dsql` (AP-03, H-22): Grundlage für die Deploy-Vorbedingung „test:dsql grün“. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SuiteRecord {
  readonly id: string;
  readonly title: string;
  readonly ok: boolean;
  readonly summary: string;
  readonly durationMs: number;
}

export interface DsqlTestProtocol {
  readonly tool: string;
  readonly startedAt: string;
  finishedAt?: string;
  readonly migrationsHash: string;
  readonly commit: string;
  cluster?: { identifier: string; region: string; createMs: number; activeMs: number };
  readonly caller: string;
  suites: SuiteRecord[];
  notes: string[];
  passed?: boolean;
}

/**
 * Benutzer- und Sitzungsnamen in ARNs schwärzen (Sicherheitsanalyse 05.10.2026): Das Repo ist öffentlich, die
 * Protokolle liegen unter `docs/test-runs/`. Rollen-ARNs bleiben (sie stehen ohnehin im CDK-Code), Benutzer und
 * Sitzungen (oft E-Mail-Adressen) nicht.
 */
export function redactPrincipals(text: string): string {
  return text
    .replace(/(arn:aws[\w-]*:iam::\d{12}:user\/)[\w+=,.@/-]+/g, '$1<admin>')
    .replace(/(arn:aws[\w-]*:sts::\d{12}:assumed-role\/[\w+=,.@-]+\/)[\w+=,.@-]+/g, '$1<sitzung>');
}

export function renderProtocol(p: DsqlTestProtocol): string {
  const lines = [
    '# pnpm test:dsql – Protokoll (AP-03)',
    '',
    '| | |',
    '|---|---|',
    `| Beginn / Ende | ${p.startedAt} / ${p.finishedAt ?? '–'} |`,
    `| Commit | ${p.commit} |`,
    `| Migrationsstand | ${p.migrationsHash} |`,
    `| Cluster | ${p.cluster ? `${p.cluster.identifier} (${p.cluster.region}), ACTIVE nach ${p.cluster.activeMs} ms` : '–'} |`,
    `| Aufrufer | ${p.caller} |`,
    `| Ergebnis | ${p.passed ? '**grün**' : '**rot**'} |`,
    '',
    '| Nr. | Prüfung | Ergebnis | Zusammenfassung | ms |',
    '|---|---|---|---|---|',
    ...p.suites.map(
      (s) =>
        `| ${s.id} | ${s.title} | ${s.ok ? '✔' : '✘'} | ${s.summary.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${s.durationMs} |`,
    ),
  ];
  if (p.notes.length > 0) lines.push('', '## Hinweise', '', ...p.notes.map((n) => `- ${n}`));
  return `${lines.join('\n')}\n`;
}

export function writeProtocol(dir: string, p: DsqlTestProtocol): string {
  mkdirSync(dir, { recursive: true });
  let name = 'protocol';
  for (let n = 2; existsSync(join(dir, `${name}.json`)); n += 1) name = `protocol-${n}`;
  writeFileSync(join(dir, `${name}.json`), redactPrincipals(`${JSON.stringify(p, null, 2)}\n`));
  writeFileSync(join(dir, `${name}.md`), redactPrincipals(renderProtocol(p)));
  return join(dir, name);
}

/** Sucht unter docs/test-runs/<datum>/ap-03/ ein grünes Protokoll für genau diesen Migrationsstand. */
export function findGreenProtocol(testRunsDir: string, migrationsHash: string): string | undefined {
  if (!existsSync(testRunsDir)) return undefined;
  for (const day of readdirSync(testRunsDir).sort().reverse()) {
    const dir = join(testRunsDir, day, 'ap-03');
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()) {
      try {
        const p = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Partial<DsqlTestProtocol>;
        if (p.migrationsHash === migrationsHash && p.passed === true) return join(dir, file);
      } catch {
        /* unlesbare Datei überspringen */
      }
    }
  }
  return undefined;
}
