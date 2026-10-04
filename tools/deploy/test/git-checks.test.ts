import { describe, expect, it } from 'vitest';
import type { Cmd } from '../src/ci-gate';
import { checkHeadIsFreshOriginMain } from '../src/git-checks';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function git(opts: { fetchOk: boolean; head: string; remote: string }): Cmd & { calls: string[] } {
  const calls: string[] = [];
  const fn = (args: string[]) => {
    calls.push(args.join(' '));
    if (args[0] === 'fetch') return { ok: opts.fetchOk, out: '' };
    if (args.includes('HEAD')) return { ok: true, out: opts.head };
    if (args.includes('origin/main')) return { ok: opts.remote !== '', out: opts.remote };
    throw new Error(`unerwartet: git ${args.join(' ')}`);
  };
  return Object.assign(fn, { calls });
}

describe('deploy:prod – HEAD ist aktueller origin/main', () => {
  it('gibt den Commit zurück, wenn fetch gelingt und HEAD gleich origin/main ist', () => {
    const g = git({ fetchOk: true, head: A, remote: A });
    expect(checkHeadIsFreshOriginMain(g)).toBe(A);
    expect(g.calls[0]).toBe('fetch --quiet origin main');
  });

  it('bricht ab, wenn git fetch scheitert – auch wenn HEAD dem alten origin/main gleicht', () => {
    expect(() => checkHeadIsFreshOriginMain(git({ fetchOk: false, head: A, remote: A }))).toThrow(
      'git fetch origin main',
    );
  });

  it('paralleler Fetch sperrt kurz origin/main: zweiter Versuch genügt, höchstens drei', () => {
    let fetches = 0;
    const flaky = Object.assign(
      (args: string[]) => {
        if (args[0] === 'fetch') return { ok: ++fetches >= 2, out: '' };
        return { ok: true, out: A };
      },
      { calls: [] as string[] },
    );
    expect(checkHeadIsFreshOriginMain(flaky)).toBe(A);
    expect(fetches).toBe(2);
    const g = git({ fetchOk: false, head: A, remote: A });
    expect(() => checkHeadIsFreshOriginMain(g)).toThrow('git fetch origin main');
    expect(g.calls.filter((c) => c.startsWith('fetch'))).toHaveLength(3);
  });

  it('bricht ab, wenn HEAD nicht origin/main ist', () => {
    expect(() => checkHeadIsFreshOriginMain(git({ fetchOk: true, head: A, remote: B }))).toThrow(
      'ist nicht origin/main',
    );
  });

  it('bricht ab, wenn origin/main fehlt (früher stillschweigend durchgelassen)', () => {
    expect(() => checkHeadIsFreshOriginMain(git({ fetchOk: true, head: A, remote: '' }))).toThrow(
      'lässt sich nicht auflösen',
    );
  });
});
