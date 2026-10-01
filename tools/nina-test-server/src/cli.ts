/**
 * `pnpm nina-test-server --scenario <name> [--port 8787] [--host 0.0.0.0] [--rig rig.json]`
 * (ops/plugin-test-protocol.md): startet den Test-Server; im Plugin Server-URL `http://<rechner>:8787/api` und
 * Token `npm_test` eintragen. Läuft auf dem Mac oder auf dem Windows-Rechner (Node LTS).
 */
import { SCENARIO_NAMES, loadRig, loadScenario } from './scenario';
import { NinaTestServer } from './server';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const name = arg('scenario');
if (!name) {
  console.error(
    `Aufruf: pnpm nina-test-server --scenario <${SCENARIO_NAMES.join('|')}> [--port 8787] [--host 0.0.0.0]`,
  );
  process.exit(2);
}
const scenario = loadScenario(name);
const rigPath = arg('rig');
const server = new NinaTestServer(scenario, rigPath ? loadRig(rigPath) : loadRig());
const port = Number(arg('port', '8787'));
const host = arg('host', '0.0.0.0') ?? '0.0.0.0';
await server.listen(port, host);
const blocks = server.world.timeline();
console.log(`NINA-Test-Server: Szenario „${scenario.name}“ – ${scenario.description}`);
console.log(
  `  http://${host === '0.0.0.0' ? 'localhost' : host}:${String(port)}/api · Token npm_test${scenario.extraInstances ? ` (+ npm_test2 …)` : ''}`,
);
for (const b of blocks)
  console.log(
    `  Block ${String(b.index + 1)} (${b.kind}): ${new Date(b.startS * 1000).toISOString()} – ${new Date(b.endS * 1000).toISOString()}` +
      (b.meridianInMin !== undefined ? `, Meridian nach ${String(b.meridianInMin)} min` : ''),
  );
console.log('  Steuerung: POST /test/actions {"action": …} · Auswertung: GET /test/report');
