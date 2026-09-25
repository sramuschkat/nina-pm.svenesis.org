/**
 * `pnpm fake-plugin [--base-url <url>]` (TK 17, AP-14c): eine Fake-Plugin-Nacht gegen die Sync-API.
 * Das Token kommt ausschließlich aus der Umgebungsvariable `TEST_RIG_TOKEN` (H-24) und wird nie
 * ausgegeben. Ohne `--base-url` gilt `http://localhost:8787` (lokaler Stack, `pnpm dev:api`).
 */
import { argv, env, exit } from 'node:process';
import { printReport, runFakeNight } from './night';

const i = argv.indexOf('--base-url');
const baseUrl = i >= 0 ? argv[i + 1] : (env.FAKE_PLUGIN_BASE_URL ?? 'http://localhost:8787');
const token = env.TEST_RIG_TOKEN;
if (!baseUrl || !token) {
  console.error(
    'TEST_RIG_TOKEN fehlt (H-24): Token der Test-Instanz als Umgebungsvariable setzen, nie in Dateien.',
  );
  exit(2);
}
const report = await runFakeNight({ baseUrl, token });
printReport(report);
exit(report.ok ? 0 : 1);
