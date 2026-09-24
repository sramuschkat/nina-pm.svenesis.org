/**
 * Soll-Pläne (`docs/contracts/golden-plans/G*.json`, AP-13b Paint): `paintGrid` muss die erwartete
 * Zuteilung exakt liefern (rules/engine.md Nr. 6). Abnahme durch Sven über `approvedBy` (H-13); nicht
 * abgenommene Pläne gelten als vorläufig, werden aber genauso geprüft.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkGrid, paintGrid, type GridInput } from '../src';

const dir = fileURLToPath(new URL('../../../docs/contracts/golden-plans/', import.meta.url));

interface GoldenPlan {
  readonly id: string;
  readonly title: string;
  readonly approvedBy: string | null;
  readonly input: GridInput;
  readonly expected: { readonly slotAssignment?: readonly (string | null)[] };
}

const plans = readdirSync(dir)
  .filter((f) => /^G[0-9]+[a-z]?\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(`${dir}${f}`, 'utf8')) as GoldenPlan);

describe('Soll-Pläne (Paint)', () => {
  it('sind vorhanden (Pflichtfälle README)', () => {
    expect(plans.length).toBeGreaterThanOrEqual(18);
  });

  it.each(plans.filter((p) => p.expected.slotAssignment).map((p) => [p.id, p.title, p] as const))(
    '%s %s',
    (_id, _title, plan) => {
      expect(checkGrid(plan.input)).toEqual([]);
      expect(paintGrid(plan.input).slotAssignment).toEqual(plan.expected.slotAssignment);
    },
  );
});
