/**
 * Soll-Pläne (`docs/contracts/golden-plans/G*.json`, AP-13b Paint): `paintGrid` muss die erwartete
 * Zuteilung exakt liefern (rules/engine.md Nr. 6). Abnahme durch Sven über `approvedBy` (H-13); nicht
 * abgenommene Pläne gelten als vorläufig, werden aber genauso geprüft.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkGrid,
  goldenDiagnostics,
  goldenEntries,
  goldenWarnings,
  paintGrid,
  planGrid,
  type GoldenEntry,
  type GridInput,
} from '../src';

const dir = fileURLToPath(new URL('../../../docs/contracts/golden-plans/', import.meta.url));

interface GoldenPlan {
  readonly id: string;
  readonly title: string;
  readonly approvedBy: string | null;
  readonly input: GridInput;
  readonly expected: {
    readonly slotAssignment?: readonly (string | null)[];
    readonly entries?: readonly GoldenEntry[];
    readonly warnings?: readonly GoldenEntry[];
    readonly diagnostics?: readonly GoldenEntry[];
  };
}

const plans = readdirSync(dir)
  .filter((f) => /^G[0-9]+[a-z]?\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(`${dir}${f}`, 'utf8')) as GoldenPlan);

describe('Transit-Vorlauf (NT-25, AP-44)', () => {
  // Ein regulärer Block vor einem gesperrten Transit endet spätestens zum Vorlaufbeginn fenster[0] − slewCenterS − 60 s.
  const withTransit = plans.filter(
    (p) => p.expected.entries && p.input.units.some((u) => u.transit) && p.input.startAtS === null,
  );
  it.each(withTransit.map((p) => [p.id, p] as const))(
    '%s: Regelblock endet vor dem Vorlauf',
    (_id, plan) => {
      const entries = goldenEntries(planGrid(plan.input));
      for (const unit of plan.input.units.filter((u) => u.transit)) {
        const series = entries.find(
          (e) => e.cmd === 'expose_series' && e.line === unit.transit?.lineId,
        );
        if (!series) continue; // vorgefiltert (Transitkonflikt)
        const lead =
          (unit.transit?.windowS[0] ?? 0) - plan.input.settings.overhead.slewCenterS - 60;
        // Letzter Slew dieser Einheit vor der Serie = Vorlauf; das „end“ davor schließt den Regelblock.
        let slew = -1;
        entries.forEach((e, i) => {
          if (
            e.cmd === 'slew_center' &&
            e.unit === unit.unitId &&
            Number(e.atS) <= Number(series.atS)
          )
            slew = i;
        });
        const before = entries
          .slice(0, Math.max(slew, 0))
          .filter((e) => e.cmd === 'end')
          .at(-1);
        if (before) expect(Number(before.atS), plan.id).toBeLessThanOrEqual(lead);
      }
    },
  );
});

describe('Soll-Pläne (Paint und Ablauf)', () => {
  it('sind vorhanden (Pflichtfälle README)', () => {
    expect(plans.length).toBeGreaterThanOrEqual(33);
  });

  it.each(plans.filter((p) => p.expected.slotAssignment).map((p) => [p.id, p.title, p] as const))(
    '%s %s',
    (_id, _title, plan) => {
      expect(checkGrid(plan.input)).toEqual([]);
      expect(paintGrid(plan.input).slotAssignment).toEqual(plan.expected.slotAssignment);
    },
  );

  it.each(plans.filter((p) => p.expected.entries).map((p) => [p.id, p.title, p] as const))(
    'Ablauf %s %s',
    (_id, _title, plan) => {
      const result = planGrid(plan.input);
      expect(goldenEntries(result)).toEqual(plan.expected.entries);
      expect(goldenWarnings(result)).toEqual(plan.expected.warnings ?? []);
      expect(goldenDiagnostics(result)).toEqual(plan.expected.diagnostics ?? []);
    },
  );
});
