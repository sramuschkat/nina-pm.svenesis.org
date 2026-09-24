/**
 * @nina-pm/engine – öffentliche API der Engine (TK 3.1, 8.2).
 * Rein und deterministisch: kein Date/Intl/Math.random/I/O, Trigonometrie nur aus src/math
 * (docs/rules/engine.md).
 */
export * from './astro';
export * from './geometry';
export * from './plan';
export * from './visibility';
export { canonicalHash, canonicalInputJson, CanonicalError } from './canonical';
export { sha256hex } from './hash/sha256';
export * as math from './math';
export { q, roundHalfAwayFromZero, type QuantizeInv } from './round';

/** SemVer; bei jeder Verhaltensänderung erhöhen, Major = inkompatibler PlanInput/NightPlan. */
export const ENGINE_VERSION = '0.3.0';
