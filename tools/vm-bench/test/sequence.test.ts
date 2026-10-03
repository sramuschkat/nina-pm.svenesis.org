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

describe('globaler Dither-Trigger (vm-smoke)', () => {
  it('hängt Dither after Exposures an die Wurzel, mit eigener Box und freien $id', () => {
    const path = benchSequence(
      {
        sequence: {
          from: 'one-night-safety',
          removeFromStart: ['WaitForSunAltitude'],
          globalDither: 1,
        },
      },
      mkdtempSync(join(tmpdir(), 'seq-')),
    );
    const text = readFileSync(path, 'utf8');
    const seq = JSON.parse(text) as {
      $id: string;
      Triggers: { $values: Record<string, unknown>[] };
    };
    const t = seq.Triggers.$values[0] as {
      $type: string;
      AfterExposures: number;
      Parent: { $ref: string };
    };
    expect(shortType(t.$type)).toBe('DitherAfterExposures');
    expect(t.AfterExposures).toBe(1);
    expect(t.Parent.$ref).toBe(seq.$id);
    const ids = [...text.matchAll(/"\$id": "(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(text).toContain('NINA.Sequencer.SequenceItem.Guider.Dither, NINA.Sequencer');
  });
});
