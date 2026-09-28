import { describe, expect, it } from 'vitest';
import { mergeAtHead, readPrHead, type Gh } from '../src/pr-land-merge';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function gh(heads: string[], mergeOk = true): Gh & { calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const fn: Gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') {
      const out = heads[Math.min(i, heads.length - 1)] ?? '';
      i += 1;
      return { ok: out !== '', out };
    }
    if (args[0] === 'pr' && args[1] === 'merge') return { ok: mergeOk, out: '' };
    throw new Error(`unerwartet: gh ${args.join(' ')}`);
  };
  return Object.assign(fn, { calls });
}

describe('pr:land – nur den geprüften Kopf-Commit mergen', () => {
  it('liest headRefOid', () => {
    const g = gh([A]);
    expect(readPrHead(g, '42')).toBe(A);
    expect(g.calls[0]).toEqual(['pr', 'view', '42', '--json', 'headRefOid', '--jq', '.headRefOid']);
  });

  it('ohne lesbaren Kopf kein pr:land', () => {
    expect(() => readPrHead(gh(['']), '42')).toThrow('headRefOid');
    expect(() => readPrHead(gh(['kein-sha']), '42')).toThrow('headRefOid');
  });

  it('unveränderter Kopf: merge mit --match-head-commit', () => {
    const g = gh([A]);
    mergeAtHead(g, '42', A);
    expect(g.calls.at(-1)).toEqual([
      'pr',
      'merge',
      '42',
      '--merge',
      '--delete-branch',
      '--match-head-commit',
      A,
    ]);
  });

  it('Kopf hat sich bewegt: Abbruch ohne Merge', () => {
    const g = gh([B]);
    expect(() => mergeAtHead(g, '42', A)).toThrow('Kopf hat sich während des Wartens bewegt');
    expect(g.calls.some((c) => c[1] === 'merge')).toBe(false);
  });

  it('GitHub weist den Merge ab (Push zwischen Prüfung und Merge): Fehler', () => {
    expect(() => mergeAtHead(gh([A], false), '42', A)).toThrow('ließ sich nicht mergen');
  });
});
