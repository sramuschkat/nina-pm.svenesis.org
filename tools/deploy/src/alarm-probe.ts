/**
 * `pnpm alarm:probe [alarm…]` (AP-17, H-23): setzt Alarme kurz auf `ALARM`, damit die SNS-E-Mail
 * ausgelöst wird; CloudWatch setzt sie mit der nächsten Auswertung selbst zurück. Standard: der
 * Pflichtalarm `nina-pm-stale-running-sessions` und `nina-pm-api-stage-count` (Checkliste SV-06).
 * Protokoll unter `docs/test-runs/<Datum>/ap-17/alarm-probe.md` – den E-Mail-Eingang trägst du nach.
 * **Nur Sven**, Admin-Profil.
 */
import { spawnSync } from 'node:child_process';
import { config } from '@nina-pm/infra/config';
import { EXPECTED_ALARMS } from './golive/checks';
import { commit, repoRoot, writeProtocol } from './golive/run';

const DEFAULT = ['nina-pm-stale-running-sessions', 'nina-pm-api-stage-count'];
const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT;
const unknown = names.filter((n) => !(EXPECTED_ALARMS as readonly string[]).includes(n));
if (unknown.length > 0) {
  console.error(`Unbekannte Alarme: ${unknown.join(', ')}`);
  process.exit(2);
}
const at = new Date().toISOString();
const rows: string[] = [];
for (const name of names) {
  const res = spawnSync(
    'aws',
    [
      'cloudwatch',
      'set-alarm-state',
      '--alarm-name',
      name,
      '--state-value',
      'ALARM',
      '--state-reason',
      `Alarmprobe H-23 ${at}`,
      '--region',
      config.region,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const ok = res.status === 0;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  rows.push(
    `| ${name} | ${ok ? 'ALARM gesetzt' : `Fehler: ${`${res.stderr}`.trim()}`} | _Zeit eintragen_ |`,
  );
}
const path = writeProtocol(
  'alarm-probe.md',
  [
    '# Alarmprobe (AP-17, H-23)',
    '',
    `Lauf ${at}, Commit ${commit()}. E-Mail an ${config.alarmEmail} (SNS \`${config.alarmTopic}\`).`,
    '',
    '| Alarm | Probe | E-Mail erhalten |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n'),
);
console.log(`\nE-Mail-Eingang prüfen und in ${path} nachtragen.`);
