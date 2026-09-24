/**
 * Vertrag Engine ↔ shared (AP-13c): `buildPlanInput` (shared) liefert ein `PlanInput`, das die Engine
 * annimmt (Typprüfung beim Übersetzen), und `planNight` liefert einen `NightPlan`, der das zod-Schema
 * erfüllt. Liegt hier, weil nur dieses Werkzeug beide Pakete kennt.
 */
import { planNight, type NightPlan, type PlanInput } from '@nina-pm/engine';
import { buildPlanInput, NightPlanSchema, PlanInputSchema } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import {
  moonProfiles,
  NGC281,
  nights,
  projects,
  rig,
  STARFRONT,
} from '../../../packages/shared/test/fixtures/plan';

describe('PlanInput → planNight → NightPlan', () => {
  it('Beispielnacht Starfront: Schema auf beiden Seiten erfüllt, Blöcke geplant', () => {
    const input: PlanInput = buildPlanInput(rig, projects, moonProfiles, nights, {
      night: '2026-09-17',
      site: STARFRONT,
      autofocusAfterTimeMin: 60,
    });
    expect(PlanInputSchema.safeParse(input).success).toBe(true);
    const plan: NightPlan = planNight(input);
    expect(NightPlanSchema.safeParse(plan).error?.issues ?? []).toEqual([]);
    expect(plan.blocks.some((b) => b.projectId === NGC281)).toBe(true);
    // OIII-Zeile ohne bestätigten Filternamen: Diagnose filter_not_found mit lineId (NT-E1).
    expect(plan.diagnostics.some((d) => d.reason === 'filter_not_found' && d.lineId)).toBe(true);
    expect(plan.nightWindow).toEqual({
      startUtc: '2026-09-18T00:00:00Z',
      endUtc: '2026-09-18T13:00:00Z',
    });
  });

  it('zod-Parse des PlanInput ändert das Ergebnis nicht (Serialisierung über JSON)', () => {
    const input = buildPlanInput(rig, projects, moonProfiles, nights, {
      night: '2026-09-17',
      site: STARFRONT,
    });
    const parsed = PlanInputSchema.parse(JSON.parse(JSON.stringify(input))) as PlanInput;
    expect(planNight(parsed).outputHash).toBe(planNight(input).outputHash);
  });
});
