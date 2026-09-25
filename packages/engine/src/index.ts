/**
 * @nina-pm/engine – öffentliche API der Engine (TK 3.1, 8.2).
 * Rein und deterministisch: kein Date/Intl/Math.random/I/O, Trigonometrie nur aus src/math
 * (docs/rules/engine.md).
 */
export * from './astro';
export * from './effort';
export * from './geometry';
export * from './plan';
export * from './visibility';
export * as sky from './sky';
export { canonicalHash, canonicalInputJson, CanonicalError } from './canonical';
export { sha256hex } from './hash/sha256';
export * as math from './math';
export { q, roundHalfAwayFromZero, type QuantizeInv } from './round';

export { ENGINE_VERSION } from './version';
