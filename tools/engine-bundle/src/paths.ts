import { fileURLToPath } from 'node:url';

/** Ausgabeort beider Dateien; `packages/engine/build/` ist nicht versioniert (TK 3.1). */
export const BUILD_DIR = fileURLToPath(new URL('../../../packages/engine/build/', import.meta.url));
export const BUNDLE = `${BUILD_DIR}engine.iife.js`;
export const EXPECTED = `${BUILD_DIR}parity-expected.json`;
export const ENGINE_ENTRY = fileURLToPath(
  new URL('../../../packages/engine/src/index.ts', import.meta.url),
);
/** Globaler Name des IIFE-Bundles; Jint ruft `NinaPmEngine.planNight(...)` usw. */
export const GLOBAL_NAME = 'NinaPmEngine';
