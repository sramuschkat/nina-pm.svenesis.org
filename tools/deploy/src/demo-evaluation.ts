/**
 * `pnpm demo:evaluation [--dry-run]` (nur Sven, Admin-Profil, H-06): Auswertungsdaten des **Test-Mandanten** in
 * prod löschen und 90 Nächte passende Demodaten erzeugen – über `ops-cli demo-evaluation` in Schritten (die
 * Lambda hat 60 s):
 *
 * 1. `plan` (Probelauf, zeigt Löschungen, Projekte und Mengen; `--dry-run` endet hier),
 * 2. Rückfrage „ja“,
 * 3. `clear` bis fertig, `projects`, `nights` in Abschnitten zu 10 Nächten, `finish`.
 *
 * `to` (letzte Nacht) und `keep` (Stand der vorhandenen Projekte) aus dem Probelauf gehen in jeden Schritt,
 * damit alle Aufrufe dieselben Nächte und Ziele rechnen. Protokoll unter
 * `docs/test-runs/<YYYY-MM-DD>/demo-evaluation/protocol.md`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { argv, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { commit, repoRoot } from './golive/run';
import { checkAccount, demoRunDir, invokeOps } from './ops-invoke';

const SCRIPT = 'demo:evaluation';
const dryRun = argv.includes('--dry-run');

interface Plan {
  to: string;
  from: string;
  nights: number;
  rig: string;
  deletes: Record<string, number>;
  keep: Record<string, number>;
  existingProjects: { name: string; lines: string[] }[];
  demoProjects: { name: string; story: string; lines: string[] }[];
  skippedProjects: string[];
  creates: {
    sessions: number;
    captures: number;
    rejected: number;
    usableNights: number;
    nights: number;
  };
}

const log: string[] = [];
const say = (line = '') => {
  console.log(line);
  log.push(line);
};

checkAccount(SCRIPT);
const plan = invokeOps<Plan>(SCRIPT, { command: 'demo-evaluation', tenant: 'test', step: 'plan' });
say(`# Auswertungs-Demo Test-Mandant – ${dryRun ? 'Probelauf' : 'Lauf'}`);
say();
say(`- Commit ${commit()}, ${new Date().toISOString()}`);
say(`- Rig: ${plan.rig}`);
say(`- Nächte: ${plan.from} … ${plan.to} (${String(plan.nights)})`);
say();
say('## Wird gelöscht');
for (const [table, n] of Object.entries(plan.deletes)) say(`- ${table}: ${String(n)}`);
say();
say('## Vorhandene Projekte (Stand bleibt)');
for (const p of plan.existingProjects) say(`- ${p.name}: ${p.lines.join(', ')}`);
say();
say('## Demo-Projekte');
for (const p of plan.demoProjects) say(`- ${p.name} (${p.story}): ${p.lines.join(', ')}`);
if (plan.skippedProjects.length > 0)
  say(`- ausgelassen (Filter fehlen): ${plan.skippedProjects.join(', ')}`);
say();
say('## Wird erzeugt');
say(
  `- ${String(plan.creates.sessions)} Sessions, ${String(plan.creates.captures)} Aufnahmen (davon ${String(plan.creates.rejected)} verworfen), ${String(plan.creates.usableNights)} nutzbare Nächte`,
);

const write = () => {
  const dir = demoRunDir(repoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = `${dir}/${dryRun ? 'dry-run.md' : 'protocol.md'}`;
  writeFileSync(file, `${log.join('\n')}\n`);
  console.log(`\nProtokoll: ${file.replace(repoRoot, '')}`);
};

if (dryRun) {
  write();
} else {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (
    await rl.question('\nAuswertungsdaten des Test-Mandanten löschen und neu erzeugen? (ja/nein) ')
  ).trim();
  rl.close();
  if (answer !== 'ja') {
    say('\nAbgebrochen – nichts geändert.');
    write();
  } else {
    const base = { command: 'demo-evaluation', tenant: 'test', to: plan.to, keep: plan.keep };
    say();
    say('## Ablauf');
    const deleted: Record<string, number> = {};
    for (let round = 1; ; round += 1) {
      const r = invokeOps<{ deleted: Record<string, number>; done: boolean }>(SCRIPT, {
        ...base,
        step: 'clear',
      });
      for (const [k, v] of Object.entries(r.deleted)) deleted[k] = (deleted[k] ?? 0) + v;
      if (r.done) break;
      console.log(`  löschen … Runde ${String(round)}`);
    }
    say(`- gelöscht: ${JSON.stringify(deleted)}`);
    const projects = invokeOps<{ projects: number; created: number }>(SCRIPT, {
      ...base,
      step: 'projects',
    });
    say(`- Demo-Projekte: ${String(projects.projects)} (neu angelegt ${String(projects.created)})`);
    let from: number | null = 0;
    let sessions = 0;
    let captures = 0;
    while (from !== null) {
      const r: {
        from: string;
        to: string;
        sessions: number;
        captures: number;
        next: number | null;
      } = invokeOps(SCRIPT, { ...base, step: 'nights', from, count: 10 });
      sessions += r.sessions;
      captures += r.captures;
      console.log(
        `  Nächte ${r.from} … ${r.to}: ${String(r.sessions)} Sessions, ${String(r.captures)} Aufnahmen`,
      );
      from = r.next;
    }
    say(`- geschrieben: ${String(sessions)} Sessions, ${String(captures)} Aufnahmen`);
    const fin = invokeOps<{ status: Record<string, string> }>(SCRIPT, { ...base, step: 'finish' });
    say(`- Endstatus Demo-Projekte: ${JSON.stringify(fin.status)}`);
    say();
    say(
      'Fertig. Die Prognose (S-62) rechnet der stündliche Lauf nach; sofort über *Prognose neu berechnen*.',
    );
    write();
  }
}
