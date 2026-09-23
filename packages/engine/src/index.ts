/**
 * @nina-pm/engine – öffentliche API der Engine (TK 3.1).
 * Rein und deterministisch: kein Date/Intl/Math.random/I/O, Trigonometrie nur aus src/math
 * (docs/rules/engine.md). Fachliche Module folgen ab AP-08a.
 */

/** SemVer; bei jeder Verhaltensänderung erhöhen, Major = inkompatibler PlanInput/NightPlan. */
export const ENGINE_VERSION = '0.0.0';
