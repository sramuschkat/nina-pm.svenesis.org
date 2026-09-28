/**
 * `pnpm engine:bundle` → `packages/engine/build/engine.iife.js` (AP-08c, TK 8.1, rules/engine.md Nr. 7):
 * die ganze Engine als ein IIFE-Skript für Jint, Ziel ES2020, globaler Name `NinaPmEngine`, Kopfzeile mit
 * `ENGINE_VERSION` (das Plugin prüft sie beim Kopieren, TK 10.2). Danach wird das Bundle auf Konstrukte
 * geprüft, die Jint nicht oder nicht deterministisch ausführt.
 */
import { readFileSync } from 'node:fs';
import { ENGINE_VERSION } from '@nina-pm/engine';
import { build } from 'tsup';
import { BUILD_DIR, BUNDLE, ENGINE_ENTRY, GLOBAL_NAME } from './paths';
import { forbiddenInBundle } from './forbidden';

await build({
  entry: { engine: ENGINE_ENTRY },
  format: ['iife'],
  globalName: GLOBAL_NAME,
  target: 'es2020',
  platform: 'neutral',
  outDir: BUILD_DIR,
  outExtension: () => ({ js: '.iife.js' }),
  banner: {
    js: `/* @nina-pm/engine ${ENGINE_VERSION} – erzeugt mit pnpm engine:bundle, nicht bearbeiten */`,
  },
  clean: false,
  dts: false,
  sourcemap: false,
  minify: false,
  splitting: false,
  treeshake: true,
  config: false,
  silent: true,
});

const code = readFileSync(BUNDLE, 'utf8');
const found = forbiddenInBundle(code);
if (found.length > 0) {
  console.error(`✗ ${BUNDLE}: für Jint unzulässig: ${found.join(', ')}`);
  process.exit(1);
}
console.log(`✓ ${BUNDLE} (${ENGINE_VERSION}, ${String(Math.round(code.length / 1024))} KiB)`);
