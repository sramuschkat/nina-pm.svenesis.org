/**
 * Konfiguration des VM-Prüfstands auf dem Mac (`~/.config/nina-pm/vm-bench.json`, nicht im Repository):
 * Prüfstand-Schlüssel (zufällig, nur für den Agenten – kein Zugang eines Menschen), Adresse der VM für die
 * Advanced API, Ports und NINA-Profil.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';

export interface BenchConfig {
  /** Gemeinsamer Schlüssel Mac ↔ Agent (Kopf `X-Bench-Key`). */
  key: string;
  /** IP der VM (Advanced API); `ipconfig` in der VM. */
  vmHost?: string;
  /** Port der Advanced API in NINA (Vorgabe 1888). */
  apiPort: number;
  /** Port des Prüfstand-Servers auf dem Mac. */
  benchPort: number;
  /** Port des Test-Servers auf dem Mac (Plugin-Optionen in der VM zeigen darauf). */
  testServerPort: number;
  /** Port von OmniSim in der VM (Simulator-Schnittstelle `/simulator/v1/…`, Safety-Monitor umschalten). */
  omnisimPort: number;
  /** NINA-Profil für die Läufe (`--profileid`); ohne Angabe das zuletzt benutzte. */
  profileId?: string;
}

export const CONFIG_PATH = join(homedir(), '.config', 'nina-pm', 'vm-bench.json');

export function loadConfig(path = CONFIG_PATH): BenchConfig {
  if (!existsSync(path)) {
    const fresh: BenchConfig = {
      key: randomBytes(24).toString('hex'),
      apiPort: 1888,
      benchPort: 8788,
      testServerPort: 8787,
      omnisimPort: 32323,
    };
    saveConfig(fresh, path);
    return fresh;
  }
  const c = JSON.parse(readFileSync(path, 'utf8')) as Partial<BenchConfig>;
  if (!c.key) throw new Error(`${path}: Schlüssel fehlt`);
  return {
    apiPort: 1888,
    benchPort: 8788,
    testServerPort: 8787,
    omnisimPort: 32323,
    ...c,
    key: c.key,
  };
}

export function saveConfig(c: BenchConfig, path = CONFIG_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
}

/** IPv4-Adressen des Macs (ohne Loopback) – eine davon erreicht die VM. */
export function macAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a !== undefined && a.family === 'IPv4' && !a.internal)
    .map((a) => (a as { address: string }).address);
}
