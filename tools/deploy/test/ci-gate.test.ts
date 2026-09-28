import { describe, expect, it } from 'vitest';
import { ensureGreenCi, isFullRun, type CiGateDeps, type Cmd } from '../src/ci-gate';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

interface Fake {
  /** Zeile(n) von `gh run list --commit <sha>` je Aufruf (letzter Wert bleibt stehen). */
  own: string[];
  /** Ausgabe von `gh run list --status success`. */
  recent?: string;
  /** Anzahl übersprungener Jobs je Lauf-ID. */
  skipped: Record<string, number>;
  trees?: Record<string, string>;
}

function deps(fake: Fake): CiGateDeps & { watched: string[] } {
  const watched: string[] = [];
  let ownCalls = 0;
  const gh: Cmd = (args) => {
    if (args[0] === 'run' && args[1] === 'list' && args[2] === '--commit') {
      const out = fake.own[Math.min(ownCalls, fake.own.length - 1)] ?? '';
      ownCalls += 1;
      return { ok: true, out };
    }
    if (args[0] === 'run' && args[1] === 'list') return { ok: true, out: fake.recent ?? '' };
    if (args[0] === 'run' && args[1] === 'view') {
      const n = fake.skipped[args[2] ?? ''];
      return n === undefined ? { ok: false, out: '' } : { ok: true, out: String(n) };
    }
    throw new Error(`unerwartet: gh ${args.join(' ')}`);
  };
  const git: Cmd = (args) => {
    const m = /^(.+)\^\{tree\}$/.exec(args[1] ?? '');
    const tree = m?.[1] ? fake.trees?.[m[1]] : undefined;
    return tree ? { ok: true, out: tree } : { ok: false, out: '' };
  };
  return {
    git,
    gh,
    sleep: async () => undefined,
    watch: (id) => watched.push(id),
    log: () => undefined,
    watched,
  };
}

describe('deploy:prod – CI-Vorbedingung (P1-21a)', () => {
  it('vollständiger grüner Lauf auf HEAD genügt', async () => {
    const d = deps({ own: ['completed success 11'], skipped: { '11': 0 } });
    await expect(ensureGreenCi(HEAD, d)).resolves.toBe('Lauf auf diesem Commit');
  });

  it('grüner Lauf mit übersprungenen Jobs (reiner Doku-Lauf) genügt nicht', async () => {
    const d = deps({ own: ['completed success 11'], skipped: { '11': 4 } });
    await expect(ensureGreenCi(HEAD, d)).rejects.toThrow('übersprungenen Jobs');
  });

  it('gleicher Git-Tree zählt nur mit vollständigem Lauf', async () => {
    const trees = { [HEAD]: 't1', [OTHER]: 't1' };
    const docsOnly = deps({
      own: ['completed failure 11'],
      recent: `${OTHER} 22`,
      skipped: { '22': 7 },
      trees,
    });
    await expect(ensureGreenCi(HEAD, docsOnly)).rejects.toThrow('nicht grün (completed failure)');

    const full = deps({
      own: ['completed failure 11'],
      recent: `${OTHER} 22`,
      skipped: { '22': 0 },
      trees,
    });
    await expect(ensureGreenCi(HEAD, full)).resolves.toBe('gleicher Stand wie bbbbbbb');
  });

  it('anderer Git-Tree zählt nicht', async () => {
    const d = deps({
      own: [''],
      recent: `${OTHER} 22`,
      skipped: { '22': 0 },
      trees: { [HEAD]: 't1', [OTHER]: 't2' },
    });
    await expect(ensureGreenCi(HEAD, d)).rejects.toThrow('kein Lauf');
  });

  it('laufende CI wird abgewartet und dann vollständig geprüft', async () => {
    const d = deps({
      own: ['', 'in_progress  33', 'completed success 33'],
      skipped: { '33': 0 },
    });
    await expect(ensureGreenCi(HEAD, d)).resolves.toBe('Lauf auf diesem Commit, abgewartet');
    expect(d.watched).toEqual(['33']);
  });

  it('isFullRun: nur mit gültiger Lauf-ID und null übersprungenen Jobs', () => {
    const d = deps({ own: [''], skipped: { '5': 0, '6': 1 } });
    expect(isFullRun(d.gh, '5')).toBe(true);
    expect(isFullRun(d.gh, '6')).toBe(false);
    expect(isFullRun(d.gh, '7')).toBe(false);
    expect(isFullRun(d.gh, '')).toBe(false);
    expect(isFullRun(d.gh, '5; rm')).toBe(false);
  });
});
