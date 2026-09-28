/**
 * `pnpm engine:parity [--count 500] [--seed 1]` → `packages/engine/build/parity-expected.json`
 * (AP-08c, canonical-json.md: „≥ 500 zufällige `PlanInput` → gleicher `inputHash`/`outputHash` in Node und
 * Jint“). Node rechnet die Erwartung, `apps/nina-plugin/NinaPm.Core.Tests` rechnet dasselbe mit Jint aus
 * `engine.iife.js` und vergleicht. Die Eingaben stehen nicht in der Datei: Jint erzeugt sie mit
 * `randomPlanInput(seed)` aus dem Bundle selbst, ein abweichender Generator fällt am `inputHash` auf.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  CanonicalError,
  ENGINE_VERSION,
  canonicalInputJson,
  planNight,
  q,
  randomPlanInput,
  sha256hex,
  type QuantizeInv,
} from '@nina-pm/engine';
import { CANONICAL_CASES, Q_CASES, SHA_CASES } from './cases';
import { BUILD_DIR, EXPECTED } from './paths';

const { values } = parseArgs({
  options: { count: { type: 'string', default: '500' }, seed: { type: 'string', default: '1' } },
});
const count = Number(values.count);
const first = Number(values.seed);

const errorCode = (e: unknown) =>
  e instanceof CanonicalError ? e.code : ((e as { code?: string }).code ?? 'error');

const canonical = CANONICAL_CASES.map((expr) => {
  try {
    // Fester Quelltext aus cases.ts, kein Fremdinhalt.
    const value: unknown = new Function(`return ${expr};`)();
    return { expr, json: canonicalInputJson(value) };
  } catch (e) {
    return { expr, error: errorCode(e) };
  }
});
const sha = SHA_CASES.map((text) => ({ text, hex: sha256hex(text) }));
const quantize = Q_CASES.map(([x, inv]) => ({ x, inv, out: q(x, inv as QuantizeInv) }));

const t0 = performance.now();
const plans = Array.from({ length: count }, (_, k) => {
  const seed = first + k;
  try {
    const plan = planNight(randomPlanInput(seed));
    return {
      seed,
      inputHash: plan.inputHash,
      outputHash: plan.outputHash,
      blocks: plan.blocks.length,
    };
  } catch (e) {
    return { seed, error: errorCode(e) };
  }
});
const ms = Math.round(performance.now() - t0);

mkdirSync(BUILD_DIR, { recursive: true });
writeFileSync(
  EXPECTED,
  `${JSON.stringify({ engineVersion: ENGINE_VERSION, canonical, sha, quantize, plans }, null, 1)}\n`,
);
const failed = plans.filter((p) => 'error' in p).length;
console.log(
  `✓ ${EXPECTED}: ${String(count)} Pläne ab Seed ${String(first)} in ${String(ms)} ms` +
    (failed > 0 ? `, davon ${String(failed)} mit Fehler (auch Fehler müssen gleich sein)` : ''),
);
