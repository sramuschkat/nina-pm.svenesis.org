/**
 * Vorlagen aus `docs/contracts/nina/*.example.json` (die Beispielnacht, TK 7.6): der Test-Server übernimmt deren
 * Struktur und ersetzt Zeiten, Ziele und Filter. Kurz-IDs (`a91f…`) werden wie in
 * `packages/shared/test/nina-contracts.test.ts` zu festen UUIDs ergänzt.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../../docs/contracts/nina/', import.meta.url));

/** Feste UUID (v4-Form) aus einem Namen – gleiche Eingabe, gleiche ID. */
export function uuidFor(name: string): string {
  const h = createHash('sha256').update(name).digest('hex');
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function expand(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^sha256:[0-9a-f]*…$/.test(value)) return `sha256:${'0'.repeat(64)}`;
    if (/^[0-9a-z-]+…$/i.test(value)) return uuidFor(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
  return value;
}

/** Vertragsbeispiel als tiefe Kopie mit ergänzten IDs. */
export function example<T = Record<string, unknown>>(name: string): T {
  return expand(JSON.parse(readFileSync(`${dir}${name}.example.json`, 'utf8'))) as T;
}
