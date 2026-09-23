import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Git speichert keinen Schreibschutz. Diese Prüfung stellt sicher, dass die Kopiervorlage
// (CLAUDE.md Regel 7) und packages/catalog-data unverändert bleiben (AP-01, H-03).
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const manifests = fileURLToPath(new URL('../manifests/', import.meta.url));

const COPIES = [
  { dir: 'legacy/astro-tools-2026-09-21', manifest: 'legacy-astro-tools-2026-09-21.sha256' },
  {
    dir: 'packages/catalog-data',
    manifest: 'catalog-data.sha256',
    only: ['data', 'js', 'README.md'],
  },
];

function readManifest(name: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of readFileSync(join(manifests, name), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) throw new Error(`Ungültige Zeile in ${name}: ${line}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

function listFiles(root: string, dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name !== '.DS_Store')
    .map((entry) => relative(join(root, dir), join(entry.parentPath, entry.name)));
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe.each(COPIES)('$dir', ({ dir, manifest, only }) => {
  const expected = readManifest(manifest);
  const files = listFiles(repoRoot, dir).filter(
    (file) => !only || only.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)),
  );

  it('enthält genau die Dateien der Prüfsummenliste', () => {
    expect([...files].sort()).toEqual([...expected.keys()].sort());
  });

  it('ist unverändert', () => {
    const changed = [...expected].filter(
      ([file, hash]) => sha256(join(repoRoot, dir, file)) !== hash,
    );
    expect(changed.map(([file]) => file)).toEqual([]);
  });
});

describe('packages/catalog-data', () => {
  it('ist eine unveränderte Kopie aus der Vorlage', () => {
    const legacy = readManifest('legacy-astro-tools-2026-09-21.sha256');
    const catalog = readManifest('catalog-data.sha256');
    for (const [file, hash] of catalog) {
      if (file === 'README.md') continue;
      expect(legacy.get(file), file).toBe(hash);
    }
  });
});
