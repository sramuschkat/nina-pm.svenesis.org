/**
 * `pnpm test-run:check` (AP-S2b, CC5-11): Schema von `result.json`, Log-Grammatik und Erwartungen je Protokoll
 * an Beispielverzeichnissen – ein bestandener P-13-Lauf und Gegenproben, die fehlende Ereignisse melden.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRun, EXPECTATIONS } from '../src/check';
import { initRun } from '../src/init';
import { parseLog } from '../src/log';
import { validateResult } from '../src/result';

const result = (protocol: string, steps: number, over: Record<string, unknown> = {}) => ({
  protocol,
  date: '2026-09-29',
  pluginVersion: 'probe-0.1.0',
  ninaVersion: '3.2.0.9001',
  server: 'nina_test_server',
  scenario: null,
  result: 'go',
  steps: Array.from({ length: steps }, (_, i) => ({ n: i + 1, ok: true, note: '' })),
  logCheck: { status: 'not_run', missing: [], unexpected: [] },
  deviations: [],
  artifacts: ['nina.log'],
  ...over,
});

function run(res: object, log: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'test-run-'));
  writeFileSync(join(dir, 'result.json'), JSON.stringify(res));
  if (log !== null) writeFileSync(join(dir, 'nina.log'), log);
  const outcome = checkRun(dir);
  const written = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) as {
    logCheck: unknown;
  };
  return { outcome, written };
}

const T = '2026-09-29T20:0';
const P13_LOG = [
  `2026-09-29T20:00:00.000|INFO|Probe.cs|Run|12|NINA-PM | TRIGGER_SUPPRESSED type=AutofocusAfterTimeTrigger`,
  `NINA-PM | TRIGGER_SUPPRESSED type=DitherAfterExposures`,
  `NINA-PM | READOUT mode=set name="High Gain Mode" index=0`,
  `NINA-PM | CAPTURE id=0192a1 result=saved file="Probe_L_0001.fits" atUtc=${T}1:00Z`,
  `NINA-PM | WARNING code=probe_abort atUtc=${T}2:00Z`,
  `NINA-PM | CAPTURE id=0192a2 result=aborted atUtc=${T}2:03Z`,
  `NINA-PM | CAPTURE id=0192a3 result=saved file="Probe_L_0002.fits" atUtc=${T}4:00Z`,
  `NINA-PM | TRIGGER type=MeridianFlipTrigger atUtc=${T}5:00Z`,
  `NINA-PM | FLIP pierBefore=west pierAfter=east durationS=184`,
  `NINA-PM | FLIP_UNDETECTED`,
  'eine Zeile von NINA ohne Präfix',
].join('\n');

describe('Log-Grammatik', () => {
  it('liest Ereignisse ab dem Präfix, auch aus dem rohen NINA-Log, mit Werten in Anführungszeichen', () => {
    const { events, violations } = parseLog(P13_LOG);
    expect(violations).toEqual([]);
    expect(events).toHaveLength(10);
    expect(events[0]).toMatchObject({
      line: 1,
      event: 'TRIGGER_SUPPRESSED',
      fields: { type: 'AutofocusAfterTimeTrigger' },
    });
    expect(events[2]?.fields).toEqual({ mode: 'set', name: 'High Gain Mode', index: '0' });
  });

  it('meldet unbekannte Ereignisse und Schlüssel', () => {
    const { violations } = parseLog('NINA-PM | IMAGESAVED id=1\nNINA-PM | CAPTURE id=1 foo=bar');
    expect(violations).toEqual([
      'Zeile 1: unbekanntes Ereignis IMAGESAVED',
      'Zeile 2: CAPTURE – unbekannter Schlüssel foo',
    ]);
  });
});

describe('result.json', () => {
  it('gültiges Beispiel aus dem Protokoll-Dokument', () => {
    expect(validateResult(result('P-13', 5), 5)).toEqual([]);
  });

  it('meldet falsche Werte und falsche Schrittzahl', () => {
    const errors = validateResult(
      result('P-99', 4, { server: 'nina_test_server | prod', result: 'ok', date: '29.09.2026' }),
      5,
    );
    expect(errors).toEqual([
      'protocol: „P-99“ ist nicht P-01 … P-37 oder P-15b',
      'date: JJJJ-MM-TT erwartet',
      'server: genau „nina_test_server“ oder „prod“',
      'result: „go“ oder „no_go“',
      'steps: 5 Schritte erwartet, 4 vorhanden',
    ]);
  });
});

describe('Prüfung eines Laufs', () => {
  it('P-13 bestanden: logCheck pass wird in result.json eingetragen', () => {
    const { outcome, written } = run(result('P-13', 5), P13_LOG);
    expect(outcome).toMatchObject({ schemaErrors: [], passed: true });
    expect(written.logCheck).toEqual({ status: 'pass', missing: [], unexpected: [] });
  });

  it('P-13 ohne Flip und mit langsamem Abbruch: fail mit Befunden', () => {
    const log = P13_LOG.replace('NINA-PM | FLIP pierBefore=west pierAfter=east durationS=184', '')
      .replace(`result=aborted atUtc=${T}2:03Z`, `result=aborted atUtc=${T}2:09Z`)
      .concat('\nNINA-PM | ERROR code=clock_skew');
    const { outcome } = run(result('P-13', 5), log);
    expect(outcome.passed).toBe(false);
    expect(outcome.logCheck).toEqual({
      status: 'fail',
      missing: ['FLIP pierBefore=west pierAfter=east'],
      unexpected: ['ERROR in Zeile 12', 'Abbruch nach 9 s (Zeile 6, erlaubt < 5 s)'],
    });
  });

  it('P-02: doppelt zugeordnete Datei und zu wenige Aufnahmen', () => {
    const log = [
      'NINA-PM | CAPTURE id=a result=saved file="x.fits"',
      'NINA-PM | CAPTURE id=b result=saved file="x.fits"',
    ].join('\n');
    const { outcome } = run(result('P-02', 3), log);
    expect(outcome.logCheck.missing).toEqual([
      'CAPTURE result=saved (mindestens 20×), gefunden 2×',
    ]);
    expect(outcome.logCheck.unexpected).toEqual([
      'CAPTURE file="x.fits" mehrfach zugeordnet (Zeilen 1, 2)',
    ]);
  });

  it('ohne nina.log: not_run, Protokoll nicht bestanden', () => {
    const { outcome } = run(result('P-03', 3), null);
    expect(outcome.logCheck).toEqual({
      status: 'not_run',
      missing: ['nina.log fehlt'],
      unexpected: [],
    });
    expect(outcome.passed).toBe(false);
  });

  it('ein Schritt nicht ok → nicht bestanden, auch bei grünem Log', () => {
    const res = result('P-13', 5);
    (res.steps[1] as { ok: boolean }).ok = false;
    expect(run(res, P13_LOG).outcome.passed).toBe(false);
  });

  it('Protokoll ohne Erwartungen wird klar gemeldet', () => {
    const { outcome } = run(result('P-07', 3), P13_LOG);
    expect(outcome.schemaErrors).toContain(
      'keine Erwartungen für P-07 in expectations.json (ergänzt das Paket, das das Protokoll braucht)',
    );
  });

  it('Erwartungen: AP-S2b liefert P-01, P-02, P-03 und P-13, AP-16a P-04, AP-16c P-05, P-25, P-31, AP-16d P-06, P-15, P-19, P-28, P-32', () => {
    expect(Object.keys(EXPECTATIONS.protocols).sort()).toEqual([
      'P-01',
      'P-02',
      'P-03',
      'P-04',
      'P-05',
      'P-06',
      'P-13',
      'P-15',
      'P-19',
      'P-25',
      'P-28',
      'P-31',
      'P-32',
    ]);
    expect(EXPECTATIONS.protocols['P-04']?.package).toBe('AP-16a');
    for (const p of ['P-05', 'P-25', 'P-31'])
      expect(EXPECTATIONS.protocols[p]?.package).toBe('AP-16c');
    // Schrittzahl wie die Protokolltabelle (ops/plugin-test-protocol.md).
    expect(EXPECTATIONS.protocols['P-25']?.steps).toHaveLength(6);
  });

  it('--init legt eine Vorlage mit der Schrittzahl des Protokolls an', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'test-run-')), 'P-13');
    const steps = initRun('P-13', dir, new Date(2026, 8, 29));
    const res = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) as {
      date: string;
      steps: unknown[];
      logCheck: { status: string };
    };
    expect(steps).toHaveLength(5);
    expect(res).toMatchObject({ date: '2026-09-29', logCheck: { status: 'not_run' } });
    expect(res.steps).toHaveLength(5);
    expect(() => initRun('P-13', dir)).toThrow('existiert schon');
  });
});
