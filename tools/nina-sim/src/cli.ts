/**
 * `pnpm plugin:sim [P-xx …] [--out <ordner>] [--keep]` – kopfloser Nachtlauf (ops/plugin-test-protocol.md
 * „Kopfloser Nachtlauf“): je Lauf aus `runs/P-xx.json` den Test-Server mit virtueller Uhr starten, den Plugin-Kern mit
 * simuliertem NINA (`apps/nina-plugin/NinaPm.Sim`) eine Nacht in Sekunden fahren lassen, danach die Protokollschritte
 * automatisch prüfen und `test-run:check` laufen lassen. Ohne Angabe alle Läufe außer `real-*`. Exitcode 1, wenn
 * einer scheitert.
 *
 * `real-*`-Läufe (`"real": "<Szenario>"`, `"startUtc"`) fahren statt gegen den Test-Server gegen den **echten** Server
 * (`apps/api/src/bench/real-server.ts`, lokaler Stack mit PGlite), dessen Uhr der virtuellen Uhr des Simulators folgt –
 * z. B. die Nacht der Zeitumstellung (`real-dst`). Nur auf Abruf (`pnpm plugin:sim real-dst`), nicht im Standardlauf.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  /** Gegen den echten Server mit diesem Szenario (`RealScenario`) statt gegen den Test-Server. */
  readonly real?: string;
  /** Beginn der virtuellen Uhr (ISO, UTC); nur mit `real`, sonst „jetzt“. */
  readonly startUtc?: string;
  /** Nur mit `real`: Rig-Zeiten wie in Starfront gemessen (`RealServerOptions.rigTimes`). */
  readonly realRigTimes?: boolean;
  /**
   * Teil mit dem Simulator einer älteren Plugin-Version (Git-Ref, z. B. der Commit des freigegebenen Plugins):
   * Plugin-Update über eine bestehende `ninapm.db` (`real-upgrade`).
   */
  readonly fromRef?: string;
  /** `ninapm.db` des vorigen Teils weiterverwenden (`--keep-db`), statt frisch anzulegen. */
  readonly keepDb?: boolean;
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

/** Port des echten Servers für `real-*`-Läufe. */
const REAL_PORT = 18_960;

/**
 * NinaPm.Sim aus einem älteren Stand bauen (einmal je Ref, unter `.sim-runs/_ref-<ref>`): nur die Plugin-Quellen und
 * ihre Build-Eingaben (`docs/api/openapi.nina.json`, `packages/engine/src/version.ts`) per `git archive`, kein Worktree.
 */
function simAtRef(ref: string): string {
  const dir = join(ROOT, '.sim-runs', `_ref-${ref}`);
  const dll = join(dir, 'apps/nina-plugin/NinaPm.Sim/bin/Release/net8.0/NinaPm.Sim.dll');
  if (existsSync(dll)) return dll;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    // CI checkt nur den letzten Commit aus: den Ref gezielt nachholen.
    execFileSync('git', ['fetch', '--depth', '1', 'origin', ref], { cwd: ROOT, stdio: 'inherit' });
  }
  const tar = execFileSync(
    'git',
    [
      'archive',
      ref,
      'apps/nina-plugin',
      'docs/api/openapi.nina.json',
      'packages/engine/src/version.ts',
    ],
    { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 },
  );
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  execFileSync(
    'dotnet',
    ['build', join(dir, 'apps/nina-plugin/NinaPm.Sim'), '-c', 'Release', '-v', 'q', '-nologo'],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return dll;
}

/** NinaPm.Sim (Standard: aktueller Stand) gegen den Server auf `port` fahren (Uhr ab `startS`). */
function runSim(
  port: number,
  runPath: string,
  dir: string,
  startS: number,
  dll = DLL,
  keepDb = false,
): Promise<void> {
  return new Promise<void>((done, fail) => {
    const child = spawn(
      'dotnet',
      [
        dll,
        '--server',
        `http://127.0.0.1:${String(port)}/api`,
        '--run',
        runPath,
        '--out',
        dir,
        '--start',
        new Date(startS * 1000).toISOString(),
        ...(keepDb ? ['--keep-db'] : []),
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`NinaPm.Sim endete mit ${String(code)}`)),
    );
  });
}

/** Ein Teil: Test-Server (bzw. echter Server) mit virtueller Uhr, NinaPm.Sim dagegen; liefert Report und Logtext. */
async function runPart(
  protocol: string,
  part: RunPart,
  dir: string,
): Promise<{
  report: unknown;
  log: string;
  realChecks?: { name: string; ok: boolean; detail: string }[];
}> {
  mkdirSync(dir, { recursive: true });
  const runPath = join(dir, 'run.json');
  writeFileSync(runPath, JSON.stringify({ protocol, ...part }, null, 2));
  if (part.real) {
    const startMs = Date.parse(part.startUtc ?? '');
    if (Number.isNaN(startMs)) throw new Error(`${protocol}: startUtc fehlt`);
    // Erst hier laden: der echte Server zieht den ganzen API-Stack (PGlite, Katalog) – nur für `real-*`.
    const { startRealServer } = await import('../../../apps/api/src/bench/real-server');
    const real = await startRealServer({
      scenario: part.real as Parameters<typeof startRealServer>[0]['scenario'],
      port: REAL_PORT,
      latDeg: 50,
      log: (m) => console.log(m),
      startMs,
      ...(part.realRigTimes ? { rigTimes: true } : {}),
    });
    try {
      await runSim(REAL_PORT, runPath, dir, Math.floor(startMs / 1000));
      const rep = await real.report();
      return {
        report: rep.data,
        log: readFileSync(join(dir, 'nina.log'), 'utf8'),
        realChecks: rep.checks,
      };
    } finally {
      real.close();
    }
  }
  const startS = Math.floor(Date.now() / 1000);
  const server = createSimServer(part.scenario, startS);
  const http = await server.listen(0, '127.0.0.1');
  const port = (http.address() as AddressInfo).port;
  try {
    await runSim(port, runPath, dir, startS);
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

/**
 * Mehrere Teile gegen **einen** echten Server (Uhr läuft durch): je Teil ein Simulator, wahlweise aus einem älteren
 * Stand (`fromRef`) und mit der `ninapm.db` des vorigen Teils (`keepDb`) – Plugin-Update zwischen zwei Nächten.
 */
async function runRealParts(
  name: string,
  run: RunFile & { readonly real: string; readonly parts: readonly RunPart[] },
  dir: string,
): Promise<{
  report: unknown;
  log: string;
  realChecks: { name: string; ok: boolean; detail: string }[];
}> {
  const startMs = Date.parse(run.parts[0]?.startUtc ?? '');
  if (Number.isNaN(startMs)) throw new Error(`${name}: startUtc im ersten Teil fehlt`);
  const { startRealServer } = await import('../../../apps/api/src/bench/real-server');
  const real = await startRealServer({
    scenario: run.real as Parameters<typeof startRealServer>[0]['scenario'],
    port: REAL_PORT,
    latDeg: 50,
    log: (m) => console.log(m),
    startMs,
    ...(run.realRigTimes ? { rigTimes: true } : {}),
  });
  const logs: string[] = [];
  try {
    let previous: string | undefined;
    for (const [i, part] of run.parts.entries()) {
      const partDir = join(dir, `part-${String(i + 1)}`);
      mkdirSync(partDir, { recursive: true });
      const runPath = join(partDir, 'run.json');
      writeFileSync(runPath, JSON.stringify({ protocol: name, ...part }, null, 2));
      if (part.keepDb && previous)
        for (const f of ['ninapm.db', 'ninapm.db-wal', 'ninapm.db-shm'])
          if (existsSync(join(previous, f))) copyFileSync(join(previous, f), join(partDir, f));
      const dll = part.fromRef ? simAtRef(part.fromRef) : DLL;
      const partStart = Date.parse(part.startUtc ?? '');
      if (Number.isNaN(partStart))
        throw new Error(`${name}: startUtc in Teil ${String(i + 1)} fehlt`);
      await runSim(REAL_PORT, runPath, partDir, Math.floor(partStart / 1000), dll, part.keepDb);
      logs.push(readFileSync(join(partDir, 'nina.log'), 'utf8'));
      previous = partDir;
    }
    const rep = await real.report();
    return { report: rep.data, log: logs.join(''), realChecks: rep.checks };
  } finally {
    real.close();
  }
}

export async function runOne(file: string, outRoot: string): Promise<RunOutcome> {
  const run = JSON.parse(readFileSync(join(RUNS, file), 'utf8')) as RunFile;
  if (run.checks && run.real && run.parts) {
    const name = run.name ?? file.slice(0, -5);
    const dir = join(outRoot, name);
    rmSync(dir, { recursive: true, force: true });
    const r = await runRealParts(name, { ...run, real: run.real, parts: run.parts }, dir);
    writeFileSync(join(dir, 'report.json'), `${JSON.stringify(r.report, null, 2)}\n`);
    writeFileSync(join(dir, 'nina.log'), r.log);
    const c = evaluateChecks(run.checks, r.log, r.report, false);
    const realLines = r.realChecks.map((x) => `  ${x.ok ? '✓' : '✗'} ${x.name} – ${x.detail}`);
    return {
      protocol: name,
      passed: c.passed && r.realChecks.every((x) => x.ok),
      lines: [...c.lines, ...realLines],
    };
  }
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
        ...(run.real ? { real: run.real, startUtc: run.startUtc } : {}),
        ...(run.realRigTimes ? { realRigTimes: true } : {}),
      },
      dir,
    );
    writeFileSync(
      join(dir, 'report.json'),
      `${JSON.stringify({ ...(r.report as object), realChecks: r.realChecks ?? [] }, null, 2)}\n`,
    );
    const c = evaluateChecks(run.checks, r.log, r.report, false);
    // Prüfungen des echten Servers (aus der Datenbank) zusätzlich zu den Log-Prüfungen der Laufdatei.
    const realLines = (r.realChecks ?? []).map(
      (x) => `  ${x.ok ? '✓' : '✗'} ${x.name} – ${x.detail}`,
    );
    const realOk = (r.realChecks ?? []).every((x) => x.ok);
    return { protocol: name, passed: c.passed && realOk, lines: [...c.lines, ...realLines] };
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
  const wanted = args.filter((a, i) => /^(P-|vm-|real-)/.test(a) && args[i - 1] !== '--out');
  const files = readdirSync(RUNS)
    .filter((f) => f.endsWith('.json'))
    // `real-*` nur auf Abruf: der echte Server braucht deutlich länger als der Test-Server.
    .filter((f) => (wanted.length === 0 ? !f.startsWith('real-') : wanted.includes(f.slice(0, -5))))
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
