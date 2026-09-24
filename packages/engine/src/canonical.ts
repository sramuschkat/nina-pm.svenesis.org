/**
 * `canonicalInputJson` (specs/engine/canonical-json.md, TK 8.1): eine Zeichenkette für alle Hosts –
 * Schlüssel sortiert nach UTF-16-Codeeinheiten, keine Leerzeichen, Zahlen über `q(x, 1e9)` (ab
 * |x| ≥ 1e6 unverändert), `-0` → `0`, `undefined` weggelassen, **alle Codepunkte > U+007F als `\uXXXX`**
 * (ASCII-rein, damit der Hash in Node und .NET gleich ist, AST-D10).
 */
import { sha256hex } from './hash/sha256';
import { q } from './round';

export class CanonicalError extends Error {
  constructor(
    readonly code:
      'canonical.non_finite' | 'canonical.undefined_in_array' | 'canonical.unsupported',
    readonly path: string,
  ) {
    super(`${code} bei ${path || '$'}`);
    this.name = 'CanonicalError';
  }
}

const HEX = '0123456789abcdef';

/** JSON-Zeichenkette wie `JSON.stringify`, zusätzlich jede Codeeinheit > U+007F als `\uxxxx`. */
function quote(text: string): string {
  const json = JSON.stringify(text);
  let out = '';
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c > 0x7f)
      out += `\\u${HEX[(c >> 12) & 0xf] ?? ''}${HEX[(c >> 8) & 0xf] ?? ''}${HEX[(c >> 4) & 0xf] ?? ''}${HEX[c & 0xf] ?? ''}`;
    else out += json.charAt(i);
  }
  return out;
}

function number(x: number, path: string): string {
  if (x !== x || x === Infinity || x === -Infinity)
    throw new CanonicalError('canonical.non_finite', path);
  if (x === 0) return '0'; // auch −0
  const v = Math.abs(x) >= 1e6 ? x : q(x, 1e9);
  return String(v === 0 ? 0 : v);
}

/** Sortierung nach UTF-16-Codeeinheiten (entspricht `Array.prototype.sort()` ohne Vergleich). */
function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function write(value: unknown, path: string): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'undefined':
    case 'function':
      return undefined;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return number(value, path);
    case 'string':
      return quote(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const item = write(value[i], `${path}[${String(i)}]`);
          if (item === undefined)
            throw new CanonicalError('canonical.undefined_in_array', `${path}[${String(i)}]`);
          items.push(item);
        }
        return `[${items.join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareUtf16);
      const parts: string[] = [];
      for (const key of keys) {
        const item = write(record[key], `${path}.${key}`);
        if (item !== undefined) parts.push(`${quote(key)}:${item}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      // bigint, symbol
      throw new CanonicalError('canonical.unsupported', path);
  }
}

export function canonicalInputJson(input: unknown): string {
  const out = write(input, '');
  if (out === undefined) throw new CanonicalError('canonical.unsupported', '');
  return out;
}

/** `inputHash` bzw. `outputHash`: SHA-256 über die UTF-8-Bytes der kanonischen Zeichenkette. */
export function canonicalHash(input: unknown): string {
  return sha256hex(canonicalInputJson(input));
}
