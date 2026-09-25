/**
 * Auswertung der automatisierbaren Punkte der Go-live-Checkliste (AP-17, `ops/golive-checklist.md`):
 * reine Funktionen über die JSON-Ausgaben der AWS-CLI bzw. HTTP-Antworten – der Lauf selbst
 * (`pnpm golive:check`) liest nur und läuft ausschließlich bei Sven mit Admin-Profil (H-06).
 */
export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const ok = (name: string, detail = 'ok'): CheckResult => ({ name, ok: true, detail });
const bad = (name: string, detail: string): CheckResult => ({ name, ok: false, detail });

/** Alarme aus TK 16.2 im Ops-Stack (Health-Check ohne Alarm, DPU-Schwelle nach 4 Wochen). */
export const EXPECTED_ALARMS = [
  'nina-pm-api-5xx-rate',
  'nina-pm-api-nina-errors',
  'nina-pm-api-stage-count',
  'nina-pm-api-throttles',
  'nina-pm-backup-jobs-failed',
  'nina-pm-dsql-retries',
  'nina-pm-stale-running-sessions',
  'nina-pm-worker-errors',
  'nina-pm-worker-failures-queue',
] as const;

export function checkAlarms(
  described: { MetricAlarms?: { AlarmName: string; AlarmActions?: string[] }[] },
  topicName: string,
): CheckResult {
  const name = 'Alarme nach TK 16.2 vorhanden und an das SNS-Topic gebunden';
  const alarms = described.MetricAlarms ?? [];
  const missing = EXPECTED_ALARMS.filter((n) => !alarms.some((a) => a.AlarmName === n));
  const unbound = alarms
    .filter((a) => (EXPECTED_ALARMS as readonly string[]).includes(a.AlarmName))
    .filter((a) => !(a.AlarmActions ?? []).some((arn) => arn.endsWith(`:${topicName}`)));
  if (missing.length > 0) return bad(name, `fehlt: ${missing.join(', ')}`);
  if (unbound.length > 0)
    return bad(name, `ohne Topic: ${unbound.map((a) => a.AlarmName).join(', ')}`);
  return ok(name, `${String(EXPECTED_ALARMS.length)} Alarme`);
}

export function checkSubscription(subs: {
  Subscriptions?: { Protocol: string; SubscriptionArn: string }[];
}): CheckResult {
  const name = 'Alarm-E-Mail-Abo bestätigt (H-09)';
  const mail = (subs.Subscriptions ?? []).filter((s) => s.Protocol === 'email');
  if (mail.length === 0) return bad(name, 'kein E-Mail-Abo');
  if (mail.some((s) => s.SubscriptionArn === 'PendingConfirmation'))
    return bad(name, 'Bestätigung ausstehend');
  return ok(name);
}

export function checkBackup(
  plans: { BackupPlansList?: { BackupPlanName: string }[] },
  jobs: { BackupJobs?: { State: string; CreationDate: string }[] },
): CheckResult {
  const name = 'AWS Backup: Plan nina-pm-dsql aktiv, letzter Lauf erfolgreich (SV-15)';
  if (!(plans.BackupPlansList ?? []).some((p) => p.BackupPlanName === 'nina-pm-dsql'))
    return bad(name, 'Plan nina-pm-dsql fehlt');
  const latest = [...(jobs.BackupJobs ?? [])].sort((a, b) =>
    a.CreationDate < b.CreationDate ? 1 : -1,
  )[0];
  if (!latest) return bad(name, 'noch kein Sicherungslauf');
  return latest.State === 'COMPLETED'
    ? ok(name, `letzter Lauf ${latest.CreationDate}`)
    : bad(name, `letzter Lauf ${latest.CreationDate}: ${latest.State}`);
}

export function checkDeletionProtection(cluster: {
  deletionProtectionEnabled?: boolean;
}): CheckResult {
  const name = 'DSQL-Cluster mit Löschschutz';
  return cluster.deletionProtectionEnabled === true ? ok(name) : bad(name, 'Löschschutz aus');
}

export function checkConcurrency(
  functionName: string,
  got: { ReservedConcurrentExecutions?: number },
  expected: number,
): CheckResult {
  const name = `Reservierte Parallelität ${functionName} = ${String(expected)}`;
  return got.ReservedConcurrentExecutions === expected
    ? ok(name)
    : bad(name, `ist ${String(got.ReservedConcurrentExecutions ?? 'nicht gesetzt')}`);
}

export function checkBudget(
  b: { Budget?: { BudgetLimit?: { Amount: string } } },
  usd: number,
): CheckResult {
  const name = `Budget-Alarm aktiv (${String(usd)} USD/Monat)`;
  const amount = Number(b.Budget?.BudgetLimit?.Amount);
  return amount === usd
    ? ok(name)
    : bad(name, `Budget ${Number.isNaN(amount) ? 'fehlt' : String(amount)}`);
}

export function checkHealth(status: {
  HealthCheckObservations?: { StatusReport?: { Status?: string } }[];
}): CheckResult {
  const name = 'Route-53-Health-Check /api/health über CloudFront grün';
  const obs = status.HealthCheckObservations ?? [];
  if (obs.length === 0) return bad(name, 'keine Beobachtungen');
  const good = obs.filter((o) => (o.StatusReport?.Status ?? '').startsWith('Success')).length;
  return good * 2 > obs.length
    ? ok(name, `${String(good)}/${String(obs.length)} Regionen erfolgreich`)
    : bad(name, `${String(good)}/${String(obs.length)} Regionen erfolgreich`);
}

/** JSON mit sortierten Schlüsseln – gleiche Konfiguration ergibt denselben Text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function compareDistribution(before: unknown, after: unknown): CheckResult {
  const name = 'Website-Distribution E2L6Q80SD8XPT0 unverändert (Vergleich vorher/nachher)';
  if (before === undefined)
    return bad(name, 'kein Vorher-Stand – zuerst mit --snapshot-website sichern');
  return canonical(before) === canonical(after) ? ok(name) : bad(name, 'Konfiguration weicht ab');
}

export function checkCsrf(path: string, status: number, code: unknown): CheckResult {
  const name = `CSRF: POST ${path} ohne X-NPM-Request → 403 auth.csrf_missing (SV-04)`;
  return status === 403 && code === 'auth.csrf_missing'
    ? ok(name)
    : bad(name, `Status ${String(status)} ${String(code ?? '')}`.trim());
}

export function checkThumbCsp(csp: string | null): CheckResult {
  const name =
    "catalog/thumbs: harte CSP (default-src 'none', sandbox) – HTML wird nicht ausgeführt";
  if (!csp) return bad(name, 'keine CSP');
  return /default-src 'none'/.test(csp) && /\bsandbox\b/.test(csp) ? ok(name) : bad(name, csp);
}

export function reportMarkdown(
  results: readonly CheckResult[],
  meta: { at: string; commit: string },
): string {
  const lines = [
    '# Go-live-Prüfung (AP-17, automatisierbare Punkte)',
    '',
    `Lauf ${meta.at}, Commit ${meta.commit}. Erzeugt von \`pnpm golive:check\` (nur lesend).`,
    '',
    '| Punkt | Ergebnis | Detail |',
    '|---|---|---|',
    ...results.map(
      (r) => `| ${r.name} | ${r.ok ? '☑' : '☐'} | ${r.detail.replace(/\|/g, '\\|')} |`,
    ),
    '',
    results.every((r) => r.ok) ? 'Alle Punkte grün.' : 'Mindestens ein Punkt offen.',
    '',
  ];
  return lines.join('\n');
}
