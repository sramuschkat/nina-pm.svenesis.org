/**
 * `pnpm plugin:sim [P-xx …] [--out <ordner>] [--keep]` – kopfloser Nachtlauf (ops/plugin-test-protocol.md
 * „Kopfloser Nachtlauf“): je Lauf aus `runs/P-xx.json` den Test-Server mit virtueller Uhr starten, den Plugin-Kern mit
 * simuliertem NINA (`apps/nina-plugin/NinaPm.Sim`) eine Nacht in Sekunden fahren lassen, danach die Protokollschritte
 * automatisch prüfen und `test-run:check` laufen lassen. Ohne Angabe alle Läufe. Exitcode 1, wenn einer scheitert.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimServer } from '../../nina-test-server/src/server';
import { checkRun, EXPECTATIONS } from '../../test-run-check/src/check';
import { parseLog, type LogEvent } from '../../test-run-check/src/log';
import type { RunResult } from '../../test-run-check/src/result';
import { evaluate, type Assert } from './asserts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RUNS = fileURLToPath(new URL('../runs/', import.meta.url));
const PROJECT = join(ROOT, 'apps/nina-plugin/NinaPm.Sim');
const DLL = join(PROJECT, 'bin/Release/net8.0/NinaPm.Sim.dll');

interface RunPart {
  readonly scenario: string;
  readonly untilMin?: number;
  readonly setup?: unknown;
  readonly steps?: unknown[];
  /** Sequenz „Mehrere Nächte“ (AP-52): Tagesschleife mit Warten auf Zeit (`NinaPm.Sim`, `SimDayLoop`). */
  readonly dayLoop?: unknown;
}

/** Benannte Prüfung (Läufe ohne Protokoll, z. B. der VM-Kurzlauf `vm-smoke`). */
interface NamedCheck {
  readonly name: string;
  readonly asserts: readonly Assert[];
}

interface RunFile extends Partial<RunPart> {
  readonly protocol?: string;
  readonly name?: string;
  readonly checks?: readonly NamedCheck[];
  readonly description?: string;
  /** Mehrere Nächte nacheinander (je ein frischer Test-Server und eine frische ninapm.db), z. B. P-22. */
  readonly parts?: readonly RunPart[];
  readonly asserts?: readonly (readonly Assert[])[];
}

/** Benannte Prüfungen auf Log und Report; `vm` = gegen echtes NINA (sonst werden `vmOnly`-Prüfungen übersprungen). */
export function evaluateChecks(
  checks: readonly NamedCheck[],
  log: string,
  report: unknown,
  vm: boolean,
): { passed: boolean; lines: string[] } {
  const { events } = parseLog(log);
  const lines: string[] = [];
  let passed = true;
  for (const c of checks) {
    const outcomes = c.asserts
      .filter((a) => vm || !a.vmOnly)
      .map((a) => evaluate(a, events, report));
    const ok = outcomes.every((o) => o.ok);
    if (!ok) passed = false;
    lines.push(`  ${ok ? '✓' : '✗'} ${c.name}`);
    for (const o of outcomes) if (!o.ok) lines.push(`      ✗ ${o.text}`);
  }
  return { passed, lines };
}

/** Ein Teil: Test-Server mit virtueller Uhr, NinaPm.Sim dagegen; liefert Report und Logtext. */
async function runPart(
  protocol: string,
  part: RunPart,
  dir: string,
): Promise<{ report: unknown; log: string }> {
  mkdirSync(dir, { recursive: true });
  const runPath = join(dir, 'run.json');
  writeFileSync(runPath, JSON.stringify({ protocol, ...part }, null, 2));
  const startS = Math.floor(Date.now() / 1000);
  const server = createSimServer(part.scenario, startS);
  const http = await server.listen(0, '127.0.0.1');
  const port = (http.address() as AddressInfo).port;
  try {
    await new Promise<void>((done, fail) => {
      const child = spawn(
        'dotnet',
        [
          DLL,
          '--server',
          `http://127.0.0.1:${String(port)}/api`,
          '--run',
          runPath,
          '--out',
          dir,
          '--start',
          new Date(startS * 1000).toISOString(),
        ],
        { stdio: ['ignore', 'inherit', 'inherit'] },
      );
      child.on('error', fail);
      child.on('exit', (code) =>
        code === 0 ? done() : fail(new Error(`NinaPm.Sim endete mit ${String(code)}`)),
      );
    });
  } finally {
    http.close();
  }
  return { report: server.report(), log: readFileSync(join(dir, 'nina.log'), 'utf8') };
}

export interface RunOutcome {
  readonly protocol: string;
  readonly passed: boolean;
  readonly lines: string[];
}

export async function runOne(file: string, outRoot: string): Promise<RunOutcome> {
  const run = JSON.parse(readFileSync(join(RUNS, file), 'utf8')) as RunFile;
  if (run.checks) {
    const name = run.name ?? file.slice(0, -5);
    const dir = join(outRoot, name);
    rmSync(dir, { recursive: true, force: true });
    const r = await runPart(
      name,
      {
        scenario: run.scenario ?? '',
        untilMin: run.untilMin,
        setup: run.setup,
        steps: run.steps,
        dayLoop: run.dayLoop,
      },
      dir,
    );
    writeFileSync(join(dir, 'report.json'), `${JSON.stringify(r.report, null, 2)}\n`);
    const c = evaluateChecks(run.checks, r.log, r.report, false);
    return { protocol: name, passed: c.passed, lines: c.lines };
  }
  if (!run.protocol || !run.asserts) throw new Error(`${file}: weder protocol/asserts noch checks`);
  const exp = EXPECTATIONS.protocols[run.protocol];
  if (!exp) throw new Error(`${file}: keine Erwartungen für ${run.protocol}`);
  if (run.asserts.length !== exp.steps.length)
    throw new Error(
      `${file}: ${String(run.asserts.length)} Prüfgruppen, ${run.protocol} hat ${String(exp.steps.length)} Schritte`,
    );

  const dir = join(outRoot, run.protocol);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const parts: RunPart[] = run.parts
    ? [...run.parts]
    : [
        {
          scenario: run.scenario ?? '',
          untilMin: run.untilMin,
          setup: run.setup,
          steps: run.steps,
          dayLoop: run.dayLoop,
        },
      ];
  const results: { report: unknown; log: string }[] = [];
  for (const [i, part] of parts.entries())
    results.push(
      await runPart(
        run.protocol,
        part,
        parts.length === 1 ? dir : join(dir, `part-${String(i + 1)}`),
      ),
    );
  const report = parts.length === 1 ? results[0]?.report : { parts: results.map((r) => r.report) };
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (parts.length > 1) writeFileSync(join(dir, 'nina.log'), results.map((r) => r.log).join(''));

  // Zeilennummern über alle Teile fortlaufend; je Teil gefiltert für `part`.
  const perPart: LogEvent[][] = [];
  let offset = 0;
  for (const r of results) {
    perPart.push(parseLog(r.log).events.map((e) => ({ ...e, line: e.line + offset })));
    offset += r.log.split('\n').length - 1;
  }
  const events = perPart.flat();
  const startS = Math.floor(Date.now() / 1000);
  const lines: string[] = [];
  const steps = run.asserts.map((group, i) => {
    const outcomes = group.map((a) =>
      evaluate(
        a,
        a.part ? (perPart[a.part - 1] ?? []) : events,
        results[(a.part ?? 1) - 1]?.report,
      ),
    );
    const ok = outcomes.every((o) => o.ok);
    lines.push(`  ${ok ? '✓' : '✗'} ${String(i + 1)}. ${exp.steps[i] ?? ''}`);
    for (const o of outcomes.filter((x) => !x.ok)) lines.push(`      ✗ ${o.text}`);
    return {
      n: i + 1,
      ok,
      note: `kopflos: ${outcomes.map((o) => `${o.ok ? '' : '✗ '}${o.text}`).join('; ')}`,
    };
  });
  const result: RunResult = {
    protocol: run.protocol,
    date: new Date(startS * 1000).toISOString().slice(0, 10),
    pluginVersion: 'NinaPm.Core (Arbeitskopie)',
    ninaVersion: 'kein NINA – simuliert (NinaPm.Sim)',
    server: 'nina_test_server',
    scenario: parts[0]?.scenario ?? null,
    result: steps.every((s) => s.ok) ? 'go' : 'no_go',
    steps,
    logCheck: { status: 'not_run', missing: [], unexpected: [] },
    deviations: [
      'Kopfloser Nachtlauf (tools/nina-sim): Plugin-Kern mit simuliertem NINA und virtueller Uhr; NINA-eigenes Verhalten (Sequencer, Geräte, ImageSaved) prüfen der Windows-Sequenztest und der VM-Kurzlauf.',
    ],
    artifacts: ['nina.log', 'report.json'],
  };
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const check = checkRun(dir);
  for (const m of check.logCheck.missing) lines.push(`  ✗ test-run:check fehlt: ${m}`);
  for (const u of check.logCheck.unexpected) lines.push(`  ✗ test-run:check unerwartet: ${u}`);
  for (const e of check.schemaErrors) lines.push(`  ✗ result.json: ${e}`);
  return { protocol: run.protocol, passed: check.passed, lines };
}

/** `--vm <ordner>`: echten VM-Lauf prüfen – `nina.log` (NINA-Log der Sitzung) und `report.json` (Test-Server-Report). */
function checkVm(dir: string, name = 'vm-smoke'): never {
  const run = JSON.parse(readFileSync(join(RUNS, `${name}.json`), 'utf8')) as RunFile;
  const c = evaluateChecks(
    run.checks ?? [],
    readFileSync(join(dir, 'nina.log'), 'utf8'),
    JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as unknown,
    true,
  );
  console.log(`${c.passed ? '✓' : '✗'} VM-Kurzlauf ${name} ${dir}`);
  for (const l of c.lines) console.log(l);
  writeFileSync(join(dir, 'vm-check.txt'), `${c.lines.join('\n')}\n`);
  process.exit(c.passed ? 0 : 1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const vmIndex = args.indexOf('--vm');
  if (vmIndex >= 0)
    checkVm(
      resolve(args[vmIndex + 1] ?? '.'),
      args.find((a) => a.startsWith('vm-')),
    );
  const outIndex = args.indexOf('--out');
  const outRoot = resolve(outIndex >= 0 ? (args[outIndex + 1] ?? '') : join(ROOT, '.sim-runs'));
  const wanted = args.filter((a, i) => /^(P-|vm-)/.test(a) && args[i - 1] !== '--out');
  const files = readdirSync(RUNS)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => wanted.length === 0 || wanted.includes(f.slice(0, -5)))
    .sort();
  if (files.length === 0) {
    console.error(`Keine Läufe gefunden (${wanted.join(', ')})`);
    process.exit(2);
  }
  execFileSync('dotnet', ['build', PROJECT, '-c', 'Release', '-v', 'q', '-nologo'], {
    stdio: 'inherit',
  });
  let ok = true;
  for (const f of files) {
    const started = Date.now();
    const r = await runOne(f, outRoot);
    console.log(
      `${r.passed ? '✓' : '✗'} ${r.protocol} (${String(Math.round((Date.now() - started) / 100) / 10)} s) → ${join(outRoot, r.protocol)}`,
    );
    for (const l of r.lines) if (!r.passed || !l.includes('✓')) console.log(l);
    if (!r.passed) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
