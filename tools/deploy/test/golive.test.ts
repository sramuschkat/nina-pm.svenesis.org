/** AP-17: Auswertung der Go-live-Prüfung und des Lasttests (reine Funktionen, ohne AWS). */
import { describe, expect, it } from 'vitest';
import {
  canonical,
  checkAlarms,
  checkBackup,
  checkBudget,
  checkConcurrency,
  checkCsrf,
  checkDeletionProtection,
  checkHealth,
  checkSubscription,
  checkThumbCsp,
  compareDistribution,
  EXPECTED_ALARMS,
  reportMarkdown,
} from '../src/golive/checks';
import { evaluate, summarize } from '../src/golive/load';

const topic = 'arn:aws:sns:eu-central-1:1:nina-pm-alarms';

describe('Go-live-Prüfung', () => {
  it('Alarme: vollständig und am Topic; fehlende und ungebundene werden genannt', () => {
    const all = EXPECTED_ALARMS.map((n) => ({ AlarmName: n, AlarmActions: [topic] }));
    expect(checkAlarms({ MetricAlarms: all }, 'nina-pm-alarms').ok).toBe(true);
    expect(checkAlarms({ MetricAlarms: all.slice(1) }, 'nina-pm-alarms').detail).toContain(
      'nina-pm-api-5xx-rate',
    );
    const unbound = all.map((a, i) => (i === 0 ? { ...a, AlarmActions: [] } : a));
    expect(checkAlarms({ MetricAlarms: unbound }, 'nina-pm-alarms')).toMatchObject({
      ok: false,
      detail: 'ohne Topic: nina-pm-api-5xx-rate',
    });
  });

  it('Abo, Backup, Löschschutz, Parallelität, Budget, Health-Check', () => {
    expect(
      checkSubscription({
        Subscriptions: [{ Protocol: 'email', SubscriptionArn: 'PendingConfirmation' }],
      }).ok,
    ).toBe(false);
    expect(
      checkSubscription({ Subscriptions: [{ Protocol: 'email', SubscriptionArn: 'arn:x' }] }).ok,
    ).toBe(true);
    const plans = { BackupPlansList: [{ BackupPlanName: 'nina-pm-dsql' }] };
    expect(
      checkBackup(plans, {
        BackupJobs: [
          { State: 'FAILED', CreationDate: '2026-09-23T03:00:00Z' },
          { State: 'COMPLETED', CreationDate: '2026-09-24T03:00:00Z' },
        ],
      }).ok,
    ).toBe(true);
    expect(checkBackup(plans, { BackupJobs: [] }).detail).toBe('noch kein Sicherungslauf');
    expect(checkBackup({}, {}).ok).toBe(false);
    expect(checkDeletionProtection({ deletionProtectionEnabled: true }).ok).toBe(true);
    expect(checkDeletionProtection({}).ok).toBe(false);
    expect(checkConcurrency('nina-pm-api', { ReservedConcurrentExecutions: 20 }, 20).ok).toBe(true);
    expect(checkConcurrency('nina-pm-api', {}, 20).detail).toBe('ist nicht gesetzt');
    expect(checkBudget({ Budget: { BudgetLimit: { Amount: '20.0' } } }, 20).ok).toBe(true);
    expect(checkBudget({}, 20).detail).toBe('Budget fehlt');
    const obs = (s: string) => ({ StatusReport: { Status: s } });
    expect(
      checkHealth({
        HealthCheckObservations: [
          obs('Success: HTTP Status Code 200'),
          obs('Success: …'),
          obs('Failure'),
        ],
      }).ok,
    ).toBe(true);
    expect(checkHealth({}).ok).toBe(false);
  });

  it('Website-Distribution: gleiche Konfiguration trotz anderer Schlüsselreihenfolge; ohne Vorher-Stand offen', () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(compareDistribution({ a: 1, b: 2 }, { b: 2, a: 1 }).ok).toBe(true);
    expect(compareDistribution({ a: 1 }, { a: 2 }).ok).toBe(false);
    expect(compareDistribution(undefined, { a: 1 }).detail).toContain('--snapshot-website');
  });

  it('CSRF und harte CSP auf catalog/thumbs', () => {
    expect(checkCsrf('/api/auth/invitation/claim', 403, 'auth.csrf_missing').ok).toBe(true);
    expect(checkCsrf('/api/auth/invitation/claim', 401, 'auth.unauthenticated').ok).toBe(false);
    expect(checkThumbCsp("default-src 'none'; sandbox; frame-ancestors 'none'").ok).toBe(true);
    expect(checkThumbCsp("default-src 'self'").ok).toBe(false);
    expect(checkThumbCsp(null).ok).toBe(false);
  });

  it('Protokoll als Markdown-Tabelle', () => {
    const md = reportMarkdown(
      [
        { name: 'A', ok: true, detail: 'ok' },
        { name: 'B', ok: false, detail: 'x | y' },
      ],
      { at: '2026-09-25T10:00:00Z', commit: 'abc' },
    );
    expect(md).toContain('| A | ☑ | ok |');
    expect(md).toContain('| B | ☐ | x \\| y |');
    expect(md).toContain('Mindestens ein Punkt offen.');
  });
});

describe('Lasttest gegen die Drosselung', () => {
  const hits = (spec: Record<number, number>) =>
    Object.entries(spec).flatMap(([s, n]) =>
      Array.from({ length: n }, (_, i) => ({ status: Number(s), ms: i })),
    );

  it('grün: Anmeldestart 302/429, execute-api 403/429, Parallelität ≤ 20', () => {
    const start = summarize('start', hits({ 302: 60, 429: 940 }));
    const direct = summarize('direct', hits({ 403: 50, 429: 950 }));
    expect(start).toMatchObject({ requests: 1000, byStatus: { '302': 60, '429': 940 } });
    expect(evaluate(start, direct, 7, 20)).toEqual({ ok: true, findings: [] });
  });

  it('rot: keine Drosselung, 5xx, Direktzugriff 200, Parallelität überschritten oder unbekannt', () => {
    const start = summarize('start', hits({ 302: 990, 502: 10 }));
    const direct = summarize('direct', hits({ 200: 5, 403: 995 }));
    const v = evaluate(start, direct, 25, 20);
    expect(v.ok).toBe(false);
    expect(v.findings).toEqual([
      'Anmeldestart: keine 429 – Drosselung greift nicht',
      'Anmeldestart: unerwartete Status 502',
      'execute-api: unerwartete Status 200',
      'Parallelität 25 > reserviert 20',
    ]);
    expect(
      evaluate(summarize('s', hits({ 429: 1 })), summarize('d', hits({ 403: 1 })), null, 20)
        .findings,
    ).toEqual(['Parallelität der api nicht gemessen']);
  });
});
