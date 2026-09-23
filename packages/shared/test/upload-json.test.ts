import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { boundedList, boundedString, MultiSimInput, parseUploadedJson } from '../src/contracts';
import { ProblemError } from '../src/errors';

const Import = z.object({ projects: boundedList(z.object({ name: boundedString(20) }), 3) });

const failure = (fn: () => unknown): ProblemError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProblemError) return e;
    throw e;
  }
  throw new Error('kein Fehler');
};

describe('parseUploadedJson (TK 7.1, SV-09)', () => {
  it('liest gültiges JSON', () => {
    expect(parseUploadedJson('{"projects":[{"name":"M31"}]}', Import)).toEqual({
      projects: [{ name: 'M31' }],
    });
  });

  it('ungültiges JSON → validation.failed an $', () => {
    const e = failure(() => parseUploadedJson('{"projects": [', Import));
    expect(e.code).toBe('validation.failed');
    expect(e.errors?.[0]?.path).toBe('$');
  });

  it('Liste über der .max()-Grenze → validation.failed mit Stelle', () => {
    const text = JSON.stringify({ projects: Array.from({ length: 4 }, () => ({ name: 'x' })) });
    const e = failure(() => parseUploadedJson(text, Import));
    expect(e.code).toBe('validation.failed');
    expect(e.errors?.[0]?.path).toBe('$.projects');
  });

  it('Zeichenkette über der Grenze → validation.failed mit Stelle', () => {
    const e = failure(() =>
      parseUploadedJson(JSON.stringify({ projects: [{ name: 'x'.repeat(21) }] }), Import),
    );
    expect(e.errors?.[0]?.path).toBe('$.projects[0].name');
  });
});

describe('MultiSimInput (SV-06)', () => {
  const base = { rigId: '0190c3f4-9f1e-7c3a-8b2d-0a1b2c3d4e5f', nightFrom: '2026-09-18' };
  it('nights ≤ 14', () => {
    expect(MultiSimInput.safeParse({ ...base, nights: 14 }).success).toBe(true);
    expect(MultiSimInput.safeParse({ ...base, nights: 15 }).success).toBe(false);
    expect(MultiSimInput.safeParse({ ...base, nights: 0 }).success).toBe(false);
  });
});
