/** Gemeinsames der lokalen Go-live-Skripte (nur Sven, Admin-Profil, H-06): AWS-CLI, Ablage der Protokolle. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '@nina-pm/infra/config';

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** AWS-CLI mit JSON-Ausgabe; `undefined` bei Fehler (die Prüfung meldet ihn dann als offen). */
export function aws<T>(args: readonly string[], region: string = config.region): T | undefined {
  const res = spawnSync('aws', [...args, '--region', region, '--output', 'json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (res.status !== 0) return undefined;
  const out = `${res.stdout ?? ''}`.trim();
  return (out ? JSON.parse(out) : {}) as T;
}

/** Ablage `docs/test-runs/<YYYY-MM-DD>/ap-17/<name>` (lokales Datum). */
export function protocolPath(name: string, now = new Date()): string {
  const d = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dir = `${repoRoot}docs/test-runs/${d}/ap-17`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return `${dir}/${name}`;
}

export function writeProtocol(name: string, content: string): string {
  const path = protocolPath(name);
  writeFileSync(path, content);
  return path.replace(repoRoot, '');
}

export function cdkOutputs(): Record<string, Record<string, string>> {
  const file = `${repoRoot}infra/cdk-outputs.json`;
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>)
    : {};
}

export function commit(): string {
  return spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).stdout.trim();
}
