import { describe, expect, it } from 'vitest';
import { parseLog } from '../../test-run-check/src/log';
import { at, evaluate } from '../src/asserts';

const log = parseLog(
  [
    'NINA-PM | BLOCK_START id=a',
    'NINA-PM | WARNING code=camera_temperature',
    'NINA-PM | CAPTURE id=c1 result=saved file="x.fits"',
    'NINA-PM | BLOCK_END id=a reason=completed',
    'NINA-PM | BLOCK_START id=b',
    'NINA-PM | WARNING code=camera_temperature',
    'NINA-PM | WARNING code=camera_temperature',
    'NINA-PM | BLOCK_END id=b reason=lease_lost',
  ].join('\n'),
).events;
const report = {
  captures: [{ result: 'saved', metrics: { setPointC: 0 } }, { result: 'failed' }],
  sessions: [{ status: 'completed' }],
};

describe('Prüfungen des kopflosen Nachtlaufs', () => {
  it('zählt Logzeilen mit Feldern', () => {
    expect(
      evaluate(
        { log: { event: 'WARNING', where: { code: 'camera_temperature' } }, min: 3, max: 3 },
        log,
        report,
      ).ok,
    ).toBe(true);
    expect(
      evaluate({ log: { event: 'CAPTURE', where: { result: 'aborted' } } }, log, report).ok,
    ).toBe(false);
  });

  it('prüft Reihenfolge und Abwesenheit vor/nach dem n-ten Anker', () => {
    expect(
      evaluate(
        { order: [{ event: 'BLOCK_START' }, { event: 'CAPTURE' }, { event: 'BLOCK_END' }] },
        log,
        report,
      ).ok,
    ).toBe(true);
    expect(
      evaluate({ order: [{ event: 'BLOCK_END' }, { event: 'CAPTURE' }] }, log, report).ok,
    ).toBe(false);
    expect(
      evaluate({ none: { event: 'CAPTURE' }, after: { event: 'BLOCK_START' }, nth: 2 }, log, report)
        .ok,
    ).toBe(true);
    expect(
      evaluate({ none: { event: 'CAPTURE' }, before: { event: 'BLOCK_END' } }, log, report).ok,
    ).toBe(false);
  });

  it('zählt je Block', () => {
    const r = evaluate(
      { perBlock: { event: 'WARNING', where: { code: 'camera_temperature' } }, max: 1 },
      log,
      report,
    );
    expect(r).toEqual({ ok: false, text: expect.stringContaining('[1, 2]') as unknown as string });
  });

  it('liest den Report über Punktpfade und Filter', () => {
    expect(at(report, 'sessions.0.status')).toBe('completed');
    expect(
      evaluate(
        { report: 'captures', where: { 'metrics.setPointC': 0 }, min: 1, max: 1 },
        log,
        report,
      ).ok,
    ).toBe(true);
    expect(evaluate({ report: 'sessions.0.status', equals: 'completed' }, log, report).ok).toBe(
      true,
    );
  });
  it('timeGap: Abstand zweier Zeitpunkte aus Log und Report (Warten auf Zeit, P-24)', () => {
    const wait = parseLog(
      [
        'NINA-PM | WAIT_TIME source=astronomicaldusk night=2026-10-03 untilUtc=2026-10-04T13:15:00Z',
        'NINA-PM | WAIT_TIME_END night=2026-10-03 atUtc=2026-10-04T13:15:20Z',
      ].join('\n'),
    ).events;
    const r = { epochUtc: '2026-10-04T13:00:00Z' };
    const gap = (minS: number, maxS: number) =>
      evaluate(
        {
          timeGap: [{ report: 'epochUtc' }, { event: 'WAIT_TIME', field: 'untilUtc' }],
          minS,
          maxS,
        },
        wait,
        r,
      ).ok;
    expect(gap(870, 930)).toBe(true);
    expect(gap(0, 60)).toBe(false);
    expect(
      evaluate(
        {
          timeGap: [
            { event: 'WAIT_TIME', field: 'untilUtc' },
            { event: 'WAIT_TIME_END', field: 'atUtc' },
          ],
          minS: 0,
          maxS: 30,
        },
        wait,
        r,
      ).ok,
    ).toBe(true);
    // Fehlender Zeitpunkt (2. Auftreten) ist ein Fehlschlag.
    expect(
      evaluate(
        {
          timeGap: [{ report: 'epochUtc' }, { event: 'WAIT_TIME_END', field: 'atUtc', nth: 2 }],
          minS: 0,
          maxS: 1e9,
        },
        wait,
        r,
      ).ok,
    ).toBe(false);
  });
});
