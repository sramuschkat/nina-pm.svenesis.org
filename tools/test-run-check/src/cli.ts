/**
 * `pnpm test-run:check <ordner> [<ordner> …]` – Ausgabe für Sven und Claude Code, Exitcode 1 bei Fehlschlag.
 * `pnpm test-run:check --init <P-xx> <ordner>` legt `result.json` mit der richtigen Schrittzahl an.
 */
import { initRun } from './init';
import { checkRun } from './check';

const args = process.argv.slice(2);
if (args[0] === '--init') {
  const [, protocol, dir] = args;
  if (!protocol || !dir) {
    console.error('Aufruf: pnpm test-run:check --init P-13 docs/test-runs/<JJJJ-MM-TT>/P-13');
    process.exit(2);
  }
  const steps = initRun(protocol, dir);
  console.log(`✓ ${dir}/result.json angelegt – Schritte (ok und note je Schritt eintragen):`);
  steps.forEach((s, i) => console.log(`  ${String(i + 1)}. ${s}`));
  process.exit(0);
}

const dirs = args.filter((a) => !a.startsWith('--'));
if (dirs.length === 0) {
  console.error('Aufruf: pnpm test-run:check docs/test-runs/<JJJJ-MM-TT>/<P-xx> [weitere Ordner]');
  process.exit(2);
}

let ok = true;
for (const dir of dirs) {
  const r = checkRun(dir);
  console.log(`${r.passed ? '✓' : '✗'} ${dir}: logCheck ${r.logCheck.status}`);
  for (const e of r.schemaErrors) console.log(`  result.json: ${e}`);
  for (const m of r.logCheck.missing) console.log(`  fehlt: ${m}`);
  for (const u of r.logCheck.unexpected) console.log(`  unerwartet: ${u}`);
  if (!r.passed) ok = false;
}
process.exit(ok ? 0 : 1);
