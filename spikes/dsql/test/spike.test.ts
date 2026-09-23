import { describe, expect, it, vi } from 'vitest';
import { checks, type Check } from '../src/checks';
import { iamPrincipalForGrant } from '../src/connect';
import { Recorder, renderMarkdown, type Protocol, type SqlClient } from '../src/protocol';
import { runSpike } from '../src/run-spike';

function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/** Gefälschte Verbindung: `respond` entscheidet je SQL über Zeilen oder Fehler. */
function fakeClient(respond: (sql: string) => Record<string, unknown>[] | Error = () => []) {
  const queries: string[] = [];
  const client: SqlClient & { queries: string[] } = {
    queries,
    query(sql: string) {
      queries.push(sql);
      const r = respond(sql);
      return r instanceof Error
        ? Promise.reject(r)
        : Promise.resolve({ rows: r, rowCount: r.length });
    },
    end: vi.fn(() => Promise.resolve()),
  };
  return client;
}

const newProtocol = (): Protocol => ({
  tool: 'test',
  startedAt: 't0',
  environment: {},
  checks: [],
  notes: [],
});

describe('Recorder', () => {
  it('hält Befehl, Parameterbeschreibung, Ergebnis und Dauer fest', async () => {
    let t = 0;
    const rec = new Recorder(() => (t += 5));
    await rec.step(
      fakeClient(() => [{ n: 1 }]),
      'admin',
      'SELECT  $1::int\n AS n',
      { params: ['x'.repeat(10)], paramsLabel: '10 Zeichen' },
    );
    expect(rec.steps[0]).toMatchObject({
      conn: 'admin',
      command: 'SELECT $1::int AS n -- Parameter: 10 Zeichen',
      outcome: 'ok',
      rowCount: 1,
      sample: '[{"n":1}]',
      durationMs: 5,
      matched: true,
    });
  });

  it('wertet erwartete Fehler mit SQLSTATE aus', async () => {
    const rec = new Recorder();
    const fk = fakeClient(() => pgError('23503', 'violates foreign key'));
    await rec.step(fk, 'a', 'INSERT 1', { expect: 'error', codes: ['23503'] });
    await rec.step(fk, 'a', 'INSERT 2', { expect: 'error', codes: ['40001'] });
    await rec.step(fk, 'a', 'INSERT 3');
    await rec.step(fk, 'a', 'INSERT 4', { expect: 'any' });
    expect(rec.steps.map((s) => [s.sqlstate, s.matched])).toEqual([
      ['23503', true],
      ['23503', false],
      ['23503', false],
      ['23503', true],
    ]);
  });

  it('ein erwarteter Fehler, der ausbleibt, passt nicht', async () => {
    const rec = new Recorder();
    await rec.step(fakeClient(), 'a', 'TRUNCATE x', { expect: 'error' });
    expect(rec.steps[0]?.matched).toBe(false);
  });
});

describe('runSpike', () => {
  const okCheck: Check = {
    id: 'T-1',
    title: 'ok',
    tk: '-',
    run: async ({ rec, admin }) => (await rec.step(admin, 'admin', 'SELECT 1'), 'fein'),
  };
  const offCheck: Check = {
    id: 'T-2',
    title: 'abweichend',
    tk: '-',
    run: async ({ rec, admin }) => (
      await rec.step(admin, 'admin', 'TRUNCATE t', { expect: 'error' }),
      'lief durch'
    ),
  };
  const brokenCheck: Check = {
    id: 'T-3',
    title: 'kaputt',
    tk: '-',
    run: () => Promise.reject(new Error('Verbindung weg')),
  };

  it('protokolliert je Prüfpunkt Ergebnis und läuft nach einem Abbruch weiter', async () => {
    const admin = fakeClient();
    const protocol = await runSpike({
      connect: () => Promise.resolve(admin),
      connectPlain: () => Promise.resolve(admin),
      iamPrincipalArn: 'arn:aws:iam::1:user/x',
      skipLong: true,
      protocol: newProtocol(),
      checks: [okCheck, brokenCheck, offCheck],
      log: () => undefined,
    });
    expect(protocol.checks.map((c) => [c.id, c.verdict])).toEqual([
      ['T-1', 'bestätigt'],
      ['T-3', 'Fehler'],
      ['T-2', 'abweichend'],
    ]);
    expect(protocol.checks[1]?.summary).toContain('Verbindung weg');
    expect(admin.end).toHaveBeenCalled();
  });

  it('Markdown enthält je Schritt Befehl und Ergebnis', async () => {
    const protocol = await runSpike({
      connect: () => Promise.resolve(fakeClient(() => [{ v: 1 }])),
      connectPlain: () => Promise.resolve(fakeClient()),
      iamPrincipalArn: 'arn',
      skipLong: true,
      protocol: newProtocol(),
      checks: [okCheck],
      log: () => undefined,
    });
    const md = renderMarkdown(protocol);
    expect(md).toContain('| T-1 | ok | - | bestätigt | fein |');
    expect(md).toContain('`SELECT 1`');
    expect(md).toContain('ok · 1 Zeile(n) · [{"v":1}]');
  });

  it('alle zehn Prüfpunkte laufen gegen eine gefälschte Datenbank ohne Programmfehler durch', async () => {
    const db = () =>
      fakeClient((sql) => {
        if (sql.startsWith('CREATE INDEX ASYNC') || sql.startsWith('ALTER TABLE ASYNC'))
          return [{ job_id: 'job-1' }];
        if (sql.startsWith('SELECT version()')) return [{ version: 'PostgreSQL 16 (fake)' }];
        if (sql.includes('FROM pg_proc')) return [{ name: 'wait_for_job', args: 'job_id text' }];
        if (sql.includes('count(*)')) return [{ n: 3 }];
        if (sql.includes('TRUNCATE')) return pgError('0A000', 'unsupported');
        return [];
      });
    const protocol = await runSpike({
      connect: () => Promise.resolve(db()),
      connectPlain: () => Promise.resolve(db()),
      iamPrincipalArn: 'arn:aws:iam::1:user/x',
      skipLong: true,
      protocol: newProtocol(),
      log: () => undefined,
    });
    expect(protocol.checks.map((c) => c.id)).toEqual(checks.map((c) => c.id));
    for (const c of protocol.checks) {
      expect(c.verdict, `${c.id}: ${c.summary}`).not.toBe('Fehler');
      expect(c.steps.length, c.id).toBeGreaterThan(0);
      for (const s of c.steps) expect(s.command.length, c.id).toBeGreaterThan(0);
    }
    // Die gefälschte DB lehnt nichts ab: erwartete Fehler bleiben aus, also „abweichend“.
    expect(protocol.checks.find((c) => c.id === 'S1-01')?.verdict).toBe('abweichend');
    const md = renderMarkdown(protocol);
    expect(md).toContain('sys.wait_for_job');
    expect(md).toContain('Transaktion > 5 min');
  });
});

describe('iamPrincipalForGrant', () => {
  it('führt eine STS-Sitzung auf die IAM-Rolle zurück', () => {
    expect(iamPrincipalForGrant('arn:aws:sts::509219055019:assumed-role/AdminRole/sven')).toBe(
      'arn:aws:iam::509219055019:role/AdminRole',
    );
  });

  it('lässt IAM-Benutzer unverändert', () => {
    expect(iamPrincipalForGrant('arn:aws:iam::509219055019:user/sven')).toBe(
      'arn:aws:iam::509219055019:user/sven',
    );
  });
});
