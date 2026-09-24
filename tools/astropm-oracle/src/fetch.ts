/**
 * Lädt die Originalquellen des Astro-PM-NINA-Plugins am gepinnten Commit (`sources.json`), prüft
 * SHA-256 und wendet `oracle.patch` an (allocation.md §11.2). Ziel: `upstream/` (gitignored).
 * Eine Stempeldatei merkt sich Commit und Patch-Hash; unverändert → kein erneuter Download.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORACLE_DIR = fileURLToPath(new URL('..', import.meta.url));
export const UPSTREAM_DIR = join(ORACLE_DIR, 'upstream');

export interface SourcePin {
  readonly repo: string;
  readonly commit: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

export function loadPin(): SourcePin {
  return JSON.parse(readFileSync(join(ORACLE_DIR, 'sources.json'), 'utf8')) as SourcePin;
}

export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

function stamp(pin: SourcePin): string {
  return `${pin.commit} ${sha256(readFileSync(join(ORACLE_DIR, 'oracle.patch')))}\n`;
}

/** Quellen laden und patchen; `true`, wenn neu geladen wurde. */
export async function fetchSources(log: (msg: string) => void = console.log): Promise<boolean> {
  const pin = loadPin();
  const stampFile = join(UPSTREAM_DIR, '.stamp');
  if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp(pin)) return false;
  rmSync(UPSTREAM_DIR, { recursive: true, force: true });
  for (const file of pin.files) {
    const url = `https://raw.githubusercontent.com/${pin.repo}/${pin.commit}/${file.path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${String(res.status)}`);
    const body = new Uint8Array(await res.arrayBuffer());
    const hash = sha256(body);
    if (hash !== file.sha256) throw new Error(`${file.path}: SHA-256 ${hash} ≠ ${file.sha256}`);
    const target = join(UPSTREAM_DIR, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    log(`geladen: ${file.path}`);
  }
  execFileSync(
    'patch',
    ['-p1', '--forward', '--batch', '-d', UPSTREAM_DIR, '-i', join(ORACLE_DIR, 'oracle.patch')],
    {
      stdio: 'inherit',
    },
  );
  writeFileSync(stampFile, stamp(pin));
  log(`Originalquellen ${pin.commit.slice(0, 7)} gepatcht → ${UPSTREAM_DIR}`);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await fetchSources();
