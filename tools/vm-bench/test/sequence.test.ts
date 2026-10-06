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

describe('Flat-Boxen (vm-flats, AP-50)', () => {
  it('hängt drei Boxen an NINA-PM Instructions, Je Kombination mit Trained Flat/Dark Flat Exposure', () => {
    const path = benchSequence(
      {
        sequence: {
          from: 'one-night-safety',
          removeFromStart: ['WaitForSunAltitude'],
          flats: true,
        },
      },
      mkdtempSync(join(tmpdir(), 'seq-')),
    );
    const text = readFileSync(path, 'utf8');
    const find = (o: unknown): Record<string, unknown> | undefined => {
      if (Array.isArray(o)) return o.map(find).find(Boolean);
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        if (String(r.$type ?? '').startsWith('NinaPm.Nina.Sequencer.NinaPmContainer')) return r;
        return Object.values(r).map(find).find(Boolean);
      }
      return undefined;
    };
    const box = find(JSON.parse(text)) as Record<
      string,
      { $id: string; Items: { $values: Record<string, unknown>[] } }
    >;
    expect(box.FlatsSetupRunner?.Items.$values).toEqual([]);
    expect(box.FlatsTeardownRunner?.Items.$values).toEqual([]);
    const items = box.FlatsRunner?.Items.$values ?? [];
    expect(items.map((i) => shortType(String(i.$type)))).toEqual([
      'TrainedFlatExposure',
      'TrainedDarkFlatExposure',
    ]);
    // Vollständig wie von NINA gespeichert (Trained*-Anweisungen leeren beim Laden ihre Unterelemente):
    // Reihenfolge nach den NINA-Konstruktoren – Index 2 = Filter, Index 4 = Container mit Schleife und Belichtung.
    const shape = (i: Record<string, unknown>) =>
      (i.Items as { $values: Record<string, unknown>[] }).$values.map((x) =>
        shortType(String(x.$type)),
      );
    expect(shape(items[0] as Record<string, unknown>)).toEqual([
      'CloseCover',
      'ToggleLight',
      'SwitchFilter',
      'SetBrightness',
      'SequentialContainer',
      'ToggleLight',
      'OpenCover',
    ]);
    expect(shape(items[1] as Record<string, unknown>)).toEqual([
      'CloseCover',
      'ToggleLight',
      'SwitchFilter',
      'SetBrightness',
      'SequentialContainer',
      'OpenCover',
    ]);
    for (const i of items) {
      expect(i.KeepPanelClosed).toBe(true);
      expect((i.Parent as { $ref: string }).$ref).toBe(box.FlatsRunner?.$id);
      const inner = (i.Items as { $values: Record<string, unknown>[] }).$values[4] as {
        $id: string;
        Conditions: { $values: { $type: string; Iterations: number; Parent: { $ref: string } }[] };
        Items: { $values: { $type: string; ImageType: string; Parent: { $ref: string } }[] };
      };
      expect(shortType(inner.Conditions.$values[0]?.$type ?? '')).toBe('LoopCondition');
      expect(inner.Conditions.$values[0]?.Parent.$ref).toBe(inner.$id);
      expect(shortType(inner.Items.$values[0]?.$type ?? '')).toBe('TakeExposure');
      expect(inner.Items.$values[0]?.Parent.$ref).toBe(inner.$id);
    }
    expect(
      (items[1]?.Items as { $values: { Items?: { $values: { ImageType: string }[] } }[] })
        .$values[4]?.Items?.$values[0]?.ImageType,
    ).toBe('DARK');
    const ids = [...text.matchAll(/"\$id": "(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Flat-Panel wie die Rig-Checkliste: Vor Flats nach dem Warten Abdeckung zu und Licht an, Nach Flats Licht aus', () => {
    const path = benchSequence(
      {
        sequence: {
          from: 'one-night-safety',
          flats: true,
          flatsBeforeWait: 'nauticalDawn',
          flatsPanel: true,
        },
      },
      mkdtempSync(join(tmpdir(), 'seq-')),
    );
    const text = readFileSync(path, 'utf8');
    const find = (o: unknown): Record<string, unknown> | undefined => {
      if (Array.isArray(o)) return o.map(find).find(Boolean);
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        if (String(r.$type ?? '').startsWith('NinaPm.Nina.Sequencer.NinaPmContainer')) return r;
        return Object.values(r).map(find).find(Boolean);
      }
      return undefined;
    };
    const box = find(JSON.parse(text)) as Record<
      string,
      {
        $id: string;
        Items: { $values: { $type: string; OnOff?: boolean; Parent: { $ref: string } }[] };
      }
    >;
    const setup = box.FlatsSetupRunner?.Items.$values ?? [];
    expect(setup.map((i) => [shortType(i.$type), i.OnOff])).toEqual([
      ['WaitForTime', undefined],
      ['CloseCover', undefined],
      ['ToggleLight', true],
    ]);
    const teardown = box.FlatsTeardownRunner?.Items.$values ?? [];
    expect(teardown.map((i) => [shortType(i.$type), i.OnOff])).toEqual([['ToggleLight', false]]);
    for (const i of [...setup, ...teardown])
      expect([box.FlatsSetupRunner?.$id, box.FlatsTeardownRunner?.$id]).toContain(i.Parent.$ref);
    const ids = [...text.matchAll(/"\$id": "(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Mehrere Nächte (vm-multi-night, AP-52)', () => {
  it('Autofokus aus der Tagesschleife, Warten auf Zeit und Höchstzahl gesetzt, Box vor jeder Belichtung am „Ziel“', () => {
    const path = benchSequence(
      {
        sequence: {
          from: 'multi-night',
          removeFromStart: ['RunAutofocus'],
          waitForTime: { source: 'NauticalDusk', offsetMinutes: 2 },
          maxNights: 2,
          beforeExposureBox: true,
        },
      },
      mkdtempSync(join(tmpdir(), 'seq-')),
    );
    const text = readFileSync(path, 'utf8');
    type Node = { $type?: string; $id?: string; Name?: string } & Record<string, unknown>;
    const all: Node[] = [];
    const walk = (o: unknown) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') {
        if ((o as Node).$type) all.push(o as Node);
        Object.values(o).forEach(walk);
      }
    };
    walk(JSON.parse(text));
    const of = (t: string) => all.filter((n) => shortType(n.$type ?? '') === t);
    const day = all.find((n) => n.Name === 'NINA-PM Tage') as Node & { Items: { $values: Node[] } };
    expect(day.Items.$values.map((i) => shortType(i.$type ?? ''))).toEqual([
      'WaitForTimeInstruction',
      'UnparkScope',
      'CoolCamera',
      'SequentialContainer',
      'StopGuiding',
      'ParkScope',
      'WarmCamera',
    ]);
    expect(of('WaitForTimeInstruction')[0]).toMatchObject({
      Source: 'NauticalDusk',
      OffsetMinutes: 2,
    });
    expect(of('DayLoopCondition')[0]).toMatchObject({ MaxNights: 2 });
    const box = of('BeforeExposureTrigger')[0] as Node & { Parent: { $ref: string } };
    const ziel = all.find((n) => n.Name === 'Ziel');
    expect(box.Parent.$ref).toBe(ziel?.$id);
    expect(of('WaitForTimeSpan')[0]).toMatchObject({ Time: 1 });
    const ids = [...text.matchAll(/"\$id": "(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
