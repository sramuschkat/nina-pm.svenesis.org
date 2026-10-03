import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { benchSequence, shortType } from '../src/sequence';

describe('Laufsequenz des Prüfstands', () => {
  it('entfernt Warten und Autofokus aus dem Start-Bereich, alles andere bleibt', () => {
    const path = benchSequence(
      {
        sequence: {
          from: 'one-night-safety',
          removeFromStart: ['WaitForSunAltitude', 'RunAutofocus'],
        },
      },
      mkdtempSync(join(tmpdir(), 'seq-')),
    );
    const seq = JSON.parse(readFileSync(path, 'utf8')) as {
      Items: { $values: { $type: string; Items?: { $values: { $type: string }[] } }[] };
    };
    const areas = seq.Items.$values.map((a) => shortType(a.$type));
    expect(areas).toEqual(['StartAreaContainer', 'TargetAreaContainer', 'EndAreaContainer']);
    const start = seq.Items.$values[0]?.Items?.$values.map((i) => shortType(i.$type));
    expect(start).toEqual(['UnparkScope', 'CoolCamera']);
    expect(JSON.stringify(seq)).toContain('NinaPmContainer');
    expect(JSON.stringify(seq)).toContain('SafetyWaitInstruction');
  });
});
