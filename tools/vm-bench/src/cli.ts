/**
 * `pnpm vm-bench <befehl>` – VM-Prüfstand (ops/vm-bench.md): echtes NINA in der Windows-VM, gesteuert vom Mac.
 *   setup                         Prüfstand-Server starten und den Einrichtungsbefehl für die VM ausgeben (einmalig)
 *   config --vm-host <ip> [--profile-id <id>]
 *   status                        Agent und Advanced API prüfen, Sequenzen in NINA auflisten
 *   update-agent                  Agenten in der VM aus dem Repository neu laden
 *   install-plugin <ordner>       Plugin-Build in die VM bringen (NINA wird neu gestartet)
 *   run <lauf> [--plugin <ordner>] Lauf aus runs/<lauf>.json: NINA frisch, Geräte, Test-Server, Sequenz, Auswertung
 *   screenshot [reiter] [--out <datei>]
 * Läufe stehen in `.vm-bench/<zeit>-<lauf>/` (nicht im Repository).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRig, loadScenario } from '../../nina-test-server/src/scenario';
import { NinaTestServer, type TestAction } from '../../nina-test-server/src/server';
import { AdvancedApi, type Device } from './advanced-api';
import { BenchServer, type JobResult, type JobType } from './bench-server';
import { CONFIG_PATH, loadConfig, macAddresses, saveConfig, type BenchConfig } from './config';
import { benchSequence, SEQUENCE, type SequenceSpec } from './sequence';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** Plugin-Id von NINA-PM (Guid-Attribut in NinaPm.Nina.csproj): Schlüssel der Plugin-Optionen im Profil. */
const NINA_PM_PLUGIN_ID = '4b8e6c1d-2f7a-4e39-9d55-0c1a7e3b9f42';
const RUNS = fileURLToPath(new URL('../runs/', import.meta.url));
const ALL_DEVICES: Device[] = [
  'camera',
  'mount',
  'filterwheel',
  'focuser',
  'rotator',
  'guider',
  'safetymonitor',
  'dome',
  'flatdevice',
  'weather',
  'switch',
];

/** Ein VM-Lauf (`runs/<name>.json`). */
export interface BenchRun {
  readonly name: string;
  readonly description: string;
  /** Kopfloser Lauf mit denselben Prüfungen (`tools/nina-sim/runs/<simRun>.json`, ausgewertet mit `--vm`). */
  readonly simRun?: string;
  /** Test-Server-Szenario; ohne Angabe (`prod`) kein Test-Server. */
  readonly scenario?: string;
  /**
   * Gegen prod (Test-Mandant, P-05): Prod-Profil (`prodProfileId`, Token von Sven), kein Test-Server. Nach `untilMin`
   * stoppt der Prüfstand die Sequenz, wartet auf die Outbox und zählt aus dem Log; den Abgleich im Web macht Sven.
   */
  readonly prod?: boolean;
  readonly untilMin: number;
  /**
   * Sequenz: Beispielsequenz aus `apps/nina-plugin/NinaPm.Nina/Samples/<from>.json`, ohne die genannten Anweisungen
   * im Start-Bereich (NINA 3.2 speichert „deaktiviert“ nicht – `Status` ist keine JSON-Eigenschaft –, darum entfernen).
   * Der Agent legt sie als `nina-pm-bench.json` in NINAs Standard-Sequenzordner.
   */
  readonly sequence: SequenceSpec;
  /** Profilwerte vor dem Lauf (Pfad wie `/profile/show`, z. B. `MeridianFlipSettings-Recenter`). */
  readonly profile?: Readonly<Record<string, string | number | boolean>>;
  /** Geräte verbinden; alle anderen werden getrennt. */
  readonly connect: readonly Device[];
  readonly coolC?: number;
  /**
   * Zeitpunkte nach dem Serverstart: Screenshot eines Reiters, Kamera-Sollwert, Test-Server-Aktion, Safety-Monitor unsicher/sicher
   * (`safe`, OmniSim-Simulatorschnittstelle, bleibt verbunden) oder getrennt/verbunden (`monitor`, Advanced API).
   */
  readonly steps?: readonly {
    atMin: number;
    screenshot?: string;
    tab?: string;
    coolC?: number;
    safe?: boolean;
    monitor?: 'connect' | 'disconnect';
    /** Aktion des Test-Servers (`POST /test/actions`), z. B. `lock_transit` für P-15b. */
    server?: string;
  }[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

async function withBench<T>(cfg: BenchConfig, body: (b: BenchServer) => Promise<T>): Promise<T> {
  const bench = new BenchServer(cfg.key);
  await bench.listen(cfg.benchPort);
  try {
    return await body(bench);
  } finally {
    bench.close();
  }
}

async function job(
  bench: BenchServer,
  type: JobType,
  args: Record<string, unknown>,
  outDir: string,
  timeoutMs = 600_000,
): Promise<JobResult> {
  const r = await Promise.race([
    bench.enqueue(type, args, outDir),
    sleep(timeoutMs).then(() => ({
      ok: false,
      message: `Agent: keine Antwort in ${String(timeoutMs / 1000)} s`,
      files: {},
    })),
  ]);
  log(`Agent ${type}: ${r.ok ? 'ok' : 'FEHLER'} ${r.message}`);
  if (!r.ok) throw new Error(`Agent ${type}: ${r.message}`);
  return r;
}

async function needAgent(bench: BenchServer): Promise<void> {
  const a = await bench.waitForAgent(20_000);
  if (!a)
    throw new Error(
      'Agent in der VM meldet sich nicht (Aufgabe „NINA-PM Bench Agent“ läuft? VM angemeldet?)',
    );
  log(`Agent: ${a.host}, NINA ${a.nina}`);
}

function api(cfg: BenchConfig): AdvancedApi {
  if (!cfg.vmHost) throw new Error('VM-Adresse fehlt: pnpm vm-bench config --vm-host <ip>');
  return new AdvancedApi(cfg.vmHost, cfg.apiPort);
}

function zipDir(dir: string): string {
  const zip = join(mkdtempSync(join(tmpdir(), 'vm-bench-')), 'nina-pm-plugin.zip');
  execFileSync('zip', ['-r', '-q', zip, '.'], { cwd: dir });
  return zip;
}

async function installPlugin(
  cfg: BenchConfig,
  bench: BenchServer,
  dir: string,
  outDir: string,
): Promise<void> {
  const staged = bench.stage(zipDir(dir));
  await job(
    bench,
    'install-plugin',
    { file: staged.name, sha256: staged.sha256, start: true, profileId: cfg.profileId ?? '' },
    outDir,
  );
}

/** OmniSim-Safety-Monitor 0 auf sicher/unsicher (`PUT /simulator/v1/safetymonitor/0/issafesetting`). */
async function omnisimSafe(cfg: BenchConfig, safe: boolean): Promise<void> {
  if (!cfg.vmHost) throw new Error('VM-Adresse fehlt');
  const res = await fetch(
    `http://${cfg.vmHost}:${String(cfg.omnisimPort)}/simulator/v1/safetymonitor/0/issafesetting`,
    {
      method: 'PUT',
      body: new URLSearchParams({ IsSafeSetting: String(safe) }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await res.json()) as { ErrorNumber?: number; ErrorMessage?: string };
  if (!res.ok || body.ErrorNumber)
    throw new Error(`OmniSim: ${body.ErrorMessage ?? String(res.status)}`);
}

/**
 * Warten, bis die Nacht vorbei ist: alle Sessions des Test-Servers abgeschlossen, danach 60 s Nachlauf für die
 * letzten Meldungen; höchstens bis `deadlineMs` (`untilMin` der Laufdatei).
 */
async function waitForNightEnd(cfg: BenchConfig, deadlineMs: number): Promise<void> {
  let doneAt: number | undefined;
  while (Date.now() < deadlineMs) {
    try {
      const rep = (await (
        await fetch(`http://127.0.0.1:${String(cfg.testServerPort)}/test/report`)
      ).json()) as { sessions?: { status: string }[] };
      const sessions = rep.sessions ?? [];
      if (sessions.length > 0 && sessions.every((x) => x.status === 'completed')) {
        doneAt ??= Date.now();
        if (Date.now() - doneAt >= 60_000) {
          log('Session abgeschlossen – Lauf endet vor dem Zeitlimit');
          return;
        }
      } else doneAt = undefined;
    } catch {
      // Test-Server kurz nicht erreichbar: weiter warten.
    }
    await sleep(10_000);
  }
}

/** Zählung aus den `NINA-PM |`-Zeilen eines prod-Laufs (Abgleich mit dem Web macht Sven). */
export function logSummary(text: string) {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.includes('NINA-PM | '))
    .map((l) => l.slice(l.indexOf('NINA-PM | ') + 10));
  const field = (l: string, k: string) => new RegExp(`(?:^| )${k}=("[^"]*"|\\S+)`).exec(l)?.[1];
  const ev = (name: string) => lines.filter((l) => l.startsWith(`${name} `) || l === name);
  const outbox = ev('OUTBOX')
    .map((l) => Number(field(l, 'pending') ?? NaN))
    .filter((n) => !Number.isNaN(n));
  const warnings: Record<string, number> = {};
  for (const l of ev('WARNING'))
    warnings[field(l, 'code') ?? '?'] = (warnings[field(l, 'code') ?? '?'] ?? 0) + 1;
  return {
    capturesSaved: ev('CAPTURE').filter((l) => field(l, 'result') === 'saved').length,
    capturesOther: ev('CAPTURE').filter((l) => field(l, 'result') !== 'saved').length,
    blocksStarted: ev('BLOCK_START').length,
    plans: ev('PLAN').map((l) => field(l, 'reason')),
    sessions: ev('SESSION').map((l) => field(l, 'status')),
    outboxPendingAtEnd: outbox.length ? outbox[outbox.length - 1] : null,
    rejectedApi: ev('API').filter((l) => /status=4\d\d/.test(l)).length,
    errors: ev('ERROR').length,
    warnings,
  };
}

async function screenshot(a: AdvancedApi, tab: string | undefined, path: string): Promise<void> {
  if (tab) await a.switchTab(tab as Parameters<AdvancedApi['switchTab']>[0]);
  await sleep(1500);
  writeFileSync(path, await a.screenshot());
  log(`Screenshot ${path}`);
}

/**
 * Vor dem Lauf: OmniSim muss laufen, sobald der Safety-Monitor verbunden wird – nach einem Neustart der VM startet
 * er nicht von selbst (04.10.2026: Lauf brach erst nach dem NINA-Start mit „fetch failed“ ab).
 */
async function preflight(cfg: BenchConfig, r: BenchRun): Promise<void> {
  if (!r.connect.includes('safetymonitor')) return;
  const url = `http://${cfg.vmHost ?? ''}:${String(cfg.omnisimPort)}/management/apiversions`;
  const ok = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    .then((res) => res.ok)
    .catch(() => false);
  if (!ok)
    throw new Error(
      `OmniSim antwortet nicht (Port ${String(cfg.omnisimPort)}) – in der VM ASCOM OmniSim starten (und PHD2 für den Guider)`,
    );
}

async function run(cfg: BenchConfig, name: string): Promise<boolean> {
  const r = JSON.parse(readFileSync(join(RUNS, `${name}.json`), 'utf8')) as BenchRun;
  await preflight(cfg, r);
  const dir = join(ROOT, '.vm-bench', `${stamp()}-${r.name}`);
  mkdirSync(dir, { recursive: true });
  const a = api(cfg);
  return withBench(cfg, async (bench) => {
    await needAgent(bench);
    const plugin = arg('plugin');
    if (plugin) await installPlugin(cfg, bench, plugin, dir);
    // NINA frisch: ninapm.db löschen (ein gespeicherter Plan derselben Nacht schlösse sie sofort ab, VM-Lauf 03.10.2026).
    const profileId = r.prod ? cfg.prodProfileId : cfg.profileId;
    if (r.prod && !profileId) throw new Error('Kein Prod-Profil: pnpm vm-bench clone-profile …');
    await job(bench, 'restart-nina', { resetDb: true, profileId: profileId ?? '' }, dir);
    log(`Advanced API ${await a.waitUntilUp(180_000)}`);
    // Safety-Monitor zuerst auf sicher – ein abgebrochener Lauf kann OmniSim unsicher hinterlassen haben.
    await omnisimSafe(cfg, true);
    for (const [path, value] of Object.entries(r.profile ?? {})) await a.setProfile(path, value);
    for (const d of ALL_DEVICES.filter((x) => !r.connect.includes(x)))
      await a.disconnect(d).catch(() => undefined);
    const profile = await a.activeProfile();
    for (const d of r.connect) log(`verbunden: ${d} (${await a.connectFromProfile(d, profile)})`);
    if (r.coolC !== undefined) await a.cool(r.coolC);
    const folder = (profile.SequenceSettings as { DefaultSequenceFolder?: string } | undefined)
      ?.DefaultSequenceFolder;
    if (!folder) throw new Error('Profil ohne SequenceSettings.DefaultSequenceFolder');
    const staged = bench.stage(benchSequence(r, dir));
    await job(bench, 'put-sequence', { file: staged.name, sha256: staged.sha256, folder }, dir);
    if (!(await a.sequences()).includes(SEQUENCE))
      throw new Error(`Sequenz „${SEQUENCE}“ nach dem Ablegen nicht in NINA`);

    const server = r.scenario ? new NinaTestServer(loadScenario(r.scenario), loadRig()) : undefined;
    const http = server ? await server.listen(cfg.testServerPort, '0.0.0.0') : undefined;
    const startedMs = Date.now();
    const startUtc = new Date(startedMs).toISOString();
    try {
      log(
        r.scenario
          ? `Test-Server „${r.scenario}“ läuft, Sequenz „${SEQUENCE}“ startet`
          : `prod: Sequenz „${SEQUENCE}“ startet`,
      );
      await a.loadSequence(SEQUENCE);
      await a.startSequence();
      // Uhr der VM (04.10.2026: nach einem Neustart 7 h falsch → Plugin sperrte mit clock_skew, Nacht sofort zu Ende).
      // Der erste Heartbeat kommt nach höchstens 60 s; die Schritte sind absolut terminiert, Warten verschiebt sie nicht.
      await sleep(75_000);
      if ((await a.logMessages()).some((m) => m.includes('ERROR code=clock_skew')))
        throw new Error(
          'Uhr der VM weicht ab (clock_skew) – in der VM: w32tm /resync /force (Zeitdienst w32time gestartet, Zeitquelle gesetzt)',
        );
      for (const s of [...(r.steps ?? [])].sort((x, y) => x.atMin - y.atMin)) {
        await sleep(Math.max(0, startedMs + s.atMin * 60_000 - Date.now()));
        try {
          if (s.coolC !== undefined) await a.cool(s.coolC);
          if (s.safe !== undefined) await omnisimSafe(cfg, s.safe);
          if (s.monitor === 'disconnect') await a.disconnect('safetymonitor');
          if (s.monitor === 'connect') await a.connectFromProfile('safetymonitor', profile);
          if (s.safe !== undefined || s.monitor)
            log(`Safety-Monitor: ${s.monitor ?? (s.safe ? 'sicher' : 'unsicher')}`);
          if (s.server && server) {
            server.apply(s.server as TestAction);
            log(`Test-Server: ${s.server}`);
          }
          if (s.screenshot) await screenshot(a, s.tab, join(dir, `${s.screenshot}.png`));
        } catch (e) {
          log(`Schritt bei Minute ${String(s.atMin)}: ${String(e)}`);
        }
      }
      if (server) {
        await waitForNightEnd(cfg, startedMs + r.untilMin * 60_000);
        const report = await (
          await fetch(`http://127.0.0.1:${String(cfg.testServerPort)}/test/report`)
        ).json();
        writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        await a.stopSequence().catch(() => undefined);
      } else {
        await sleep(Math.max(0, startedMs + r.untilMin * 60_000 - Date.now()));
        await a.stopSequence().catch(() => undefined);
        log('Sequenz gestoppt – 3 min für die Outbox (Heartbeat-Takt 60 s)');
        await sleep(180_000);
      }
    } finally {
      http?.close();
    }
    const logs = await job(
      bench,
      'collect-log',
      { sinceUtc: new Date(startedMs - 10 * 60_000).toISOString() },
      dir,
    );
    if (!logs.files['nina.log']) throw new Error('Agent hat kein NINA-Log geliefert');
    writeFileSync(
      join(dir, 'bench.json'),
      `${JSON.stringify({ run: r.name, startUtc, endUtc: new Date().toISOString() }, null, 2)}\n`,
    );
    if (!r.simRun) {
      const summary = logSummary(readFileSync(logs.files['nina.log'], 'utf8'));
      writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      log(`Zusammenfassung: ${JSON.stringify(summary)}`);
      log(`Ergebnis in ${dir}`);
      return summary.errors === 0 && summary.rejectedApi === 0 && summary.outboxPendingAtEnd === 0;
    }
    const check = spawnSync('pnpm', ['plugin:sim', '--vm', dir, r.simRun], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    log(`Ergebnis in ${dir}`);
    return check.status === 0;
  });
}

async function main(): Promise<number> {
  const cmd = process.argv[2];
  const cfg = loadConfig();
  switch (cmd) {
    case 'setup': {
      console.log(`Konfiguration: ${CONFIG_PATH}`);
      console.log(
        'In der VM PowerShell „Als Administrator ausführen“ und EINEN dieser Befehle einfügen (die Adresse, die die VM erreicht):\n',
      );
      for (const ip of macAddresses())
        console.log(
          `  powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing http://${ip}:${String(cfg.benchPort)}/setup/Install-NinaPmBench.ps1 -OutFile $env:TEMP\\ib.ps1; & $env:TEMP\\ib.ps1 -Server http://${ip}:${String(cfg.benchPort)} -Key ${cfg.key}"\n`,
        );
      return withBench(cfg, async (bench) => {
        console.log('Warte auf den Agenten (höchstens 20 min) …');
        const a = await bench.waitForAgent(20 * 60_000);
        if (!a) return 1;
        log(`Agent meldet sich: ${a.host}, NINA ${a.nina}. Einrichtung fertig.`);
        // Noch kurz erreichbar bleiben: die letzte Verbindungsprüfung des Einrichtungsskripts kommt nach dem Agenten.
        await sleep(30_000);
        return 0;
      });
    }
    case 'config': {
      const next = {
        ...cfg,
        ...(arg('vm-host') ? { vmHost: arg('vm-host') } : {}),
        ...(arg('profile-id') ? { profileId: arg('profile-id') } : {}),
      };
      saveConfig(next);
      console.log(
        `gespeichert: vmHost=${next.vmHost ?? '–'} profileId=${next.profileId ?? '–'} (${CONFIG_PATH})`,
      );
      return 0;
    }
    case 'status':
      return withBench(cfg, async (bench) => {
        await needAgent(bench);
        await job(bench, 'ping', {}, join(ROOT, '.vm-bench', 'status'), 30_000);
        const a = api(cfg);
        log(`Advanced API ${await a.waitUntilUp(10_000)} unter ${a.base}`);
        log(`Sequenzen: ${(await a.sequences()).join(', ')}`);
        return 0;
      });
    case 'install-plugin': {
      const dir = process.argv[3];
      if (!dir) throw new Error('Ordner des Plugin-Builds angeben');
      return withBench(cfg, async (bench) => {
        await needAgent(bench);
        await installPlugin(cfg, bench, dir, join(ROOT, '.vm-bench', `${stamp()}-install`));
        return 0;
      });
    }
    case 'run': {
      const name = process.argv[3];
      if (!name) throw new Error('Lauf angeben, z. B. vm-flip');
      return (await run(cfg, name)) ? 0 : 1;
    }
    case 'update-agent':
      return withBench(cfg, async (bench) => {
        await needAgent(bench);
        await job(bench, 'update-agent', {}, join(ROOT, '.vm-bench', 'status'), 60_000);
        await sleep(8_000);
        const back = await bench.waitForAgent(60_000);
        log(
          back
            ? 'Agent nach der Aktualisierung wieder da'
            : 'Agent meldet sich nach der Aktualisierung nicht',
        );
        return back ? 0 : 1;
      });
    case 'clone-profile': {
      // Prod-Profil für P-05/P-11: Kopie des Prüfstand-Profils, Token trägt Sven selbst ein (nie über den Prüfstand).
      const name = arg('name');
      const serverUrl = arg('server-url');
      if (!name || !serverUrl || !cfg.profileId)
        throw new Error('--name und --server-url angeben; profileId in der Konfiguration');
      const flip = (arg('flip') ?? '').split(',').filter(Boolean).map(Number);
      const args = {
        sourceId: cfg.profileId,
        name,
        serverUrl,
        testMode: false,
        pluginId: NINA_PM_PLUGIN_ID,
        filters: (arg('filters') ?? '').split(',').filter(Boolean),
        ...(flip.length === 3
          ? {
              flip: {
                MinutesAfterMeridian: flip[0],
                MaxMinutesAfterMeridian: flip[1],
                PauseTimeBeforeMeridian: flip[2],
                Recenter: false,
              },
            }
          : {}),
      };
      return withBench(cfg, async (bench) => {
        await needAgent(bench);
        const r = await job(
          bench,
          'clone-profile',
          args,
          join(ROOT, '.vm-bench', 'status'),
          120_000,
        );
        const id = /Profil ([0-9a-f-]{36})/.exec(r.message)?.[1];
        if (!id) throw new Error(`keine Profil-Id: ${r.message}`);
        saveConfig({ ...cfg, prodProfileId: id });
        const a = api(cfg);
        await a.waitUntilUp(180_000);
        await a.get('/profile/switch', { profileid: id });
        log(
          `Profil „${name}“ (${id}) angelegt und in NINA aktiv – Token jetzt auf der Optionsseite eintragen`,
        );
        return 0;
      });
    }
    case 'screenshot': {
      const tab = process.argv[3]?.startsWith('--') ? undefined : process.argv[3];
      const out = arg('out') ?? join(ROOT, '.vm-bench', `${stamp()}-screenshot.png`);
      mkdirSync(join(out, '..'), { recursive: true });
      await screenshot(api(cfg), tab, out);
      return 0;
    }
    default:
      console.error(
        'Aufruf: pnpm vm-bench setup | config --vm-host <ip> | status | update-agent | install-plugin <ordner> | run <lauf> [--plugin <ordner>] | screenshot [reiter]',
      );
      return 2;
  }
}

process.exitCode = await main().catch((e: unknown) => {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  return 1;
});
