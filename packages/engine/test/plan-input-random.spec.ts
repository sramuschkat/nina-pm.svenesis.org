/**
 * `randomPlanInput` (AP-08c): Grundlage des Paritätstests Node ↔ Jint. Muss deterministisch sein, gültige
 * Eingaben liefern und die Pfade der Planung abdecken (canonical-json.md, rules/engine.md Nr. 7).
 */
import { describe, expect, it } from 'vitest';
import { canonicalInputJson, planNight, randomPlanInput } from '../src';

describe('randomPlanInput', () => {
  it('gleicher Seed → gleiche Eingabe, anderer Seed → andere', () => {
    expect(canonicalInputJson(randomPlanInput(42))).toBe(canonicalInputJson(randomPlanInput(42)));
    expect(canonicalInputJson(randomPlanInput(42))).not.toBe(
      canonicalInputJson(randomPlanInput(43)),
    );
  });

  it('200 Seeds: alle planbar und die wichtigen Pfade abgedeckt', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const input = randomPlanInput(seed);
      const plan = planNight(input);
      expect(plan.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      if (input.startAtUtc !== null) seen.add('replan');
      if (input.projects.some((p) => p.transit !== null)) seen.add('transit');
      if (input.projects.some((p) => p.panels.length > 1)) seen.add('mosaic');
      if (input.scheduler.flip.enabled) seen.add('flip');
      if (input.scheduler.strategy === 'manual_priority') seen.add('manual');
      if (input.site.latitudeDeg < 0) seen.add('south');
      if (input.site.latitudeDeg > 66) seen.add('polar');
      if (input.moonProfiles.some((m) => m.moonMustBeDown)) seen.add('moonDown');
      if (
        input.projects.some((p) =>
          p.panels.some((x) => x.lines.some((l) => l.ninaFilterName === null)),
        )
      )
        seen.add('unmappedFilter');
      if (plan.blocks.length > 0) seen.add('blocks');
    }
    expect([...seen].sort()).toEqual(
      [
        'blocks',
        'flip',
        'manual',
        'moonDown',
        'mosaic',
        'polar',
        'replan',
        'south',
        'transit',
        'unmappedFilter',
      ].sort(),
    );
  });
});
