/**
 * AP-71: Diagnose ohne falsches „Mond blockiert“. Steht ein Ziel ab `startAtS` nicht mehr in Dunkelheit und über der
 * Mindesthöhe (Neuplanung nach dem Untergang), heißt der Grund `not_visible`; `moon_blocked` nur, wenn der Mond der
 * einzige Grund ist (Simulator: IC 5146 bei 2 % Mond als „Mond blockiert“).
 */
import { describe, expect, it } from 'vitest';
import { planGrid, type GridInput, type GridUnit, type SlotRange } from '../src';

const SLOTS = 10;

const unit = (
  id: string,
  canImage: SlotRange[],
  moonSafe: SlotRange[] | null = null,
): GridUnit => ({
  unitId: id,
  projectId: id,
  priority: 1,
  minTimeOnTargetH: 0,
  dueDate: null,
  peakAltDeg: 60,
  canImage,
  meridianAtS: null,
  transit: null,
  panels: [
    {
      index: 0,
      lines: [
        {
          id: `${id}-L`,
          filter: 'L',
          exposureS: 300,
          planned: 20,
          accepted: 0,
          enabled: true,
          moonProfile: moonSafe === null ? null : 'mp',
          safe: moonSafe ?? [],
        },
      ],
    },
  ],
});

function grid(units: GridUnit[], startAtS: number | null, moonAltDeg = -10): GridInput {
  return {
    mode: 'productive',
    slotS: 300,
    slots: SLOTS,
    startAtS,
    moonAltDeg: new Array<number>(SLOTS).fill(moonAltDeg),
    moonProfiles: [{ id: 'mp', distanceDeg: 60, maxIllumPct: 50, mustBeDown: false, widthDays: 7 }],
    tonight: null,
    units,
    settings: {
      strategy: 'proportional',
      sortChain: ['lowest_peak_altitude', 'setting_soonest', 'most_remaining', 'constrained'],
      bonusEnabled: false,
      overshootPct: 0,
      mosaicPanelsIndependent: true,
      dither: { enabled: false, every: 3 },
      filterSwitch: { enabled: false, every: 10, tolerancePct: 50 },
      overhead: {
        slewCenterS: 60,
        filterChangeS: 0,
        ditherSettleS: 0,
        afEveryMin: 0,
        afDurationS: 0,
        downloadS: 0,
      },
      flip: { enabled: false, afterMin: 5, maxAfterMin: 15, pauseBeforeMin: 0, durationS: 240 },
    },
  };
}

const reasons = (g: GridInput, unitId: string) =>
  planGrid(g)
    .diagnostics.filter((d) => d.unitId === unitId)
    .map((d) => d.reason);

describe('Diagnose: unter der Mindesthöhe ist nicht „Mond blockiert“ (AP-71)', () => {
  it('Neuplanung nach dem Untergang des Ziels → not_visible', () => {
    // Ziel nur in Slots 0–3 sichtbar, die Neuplanung beginnt bei Slot 6, kein Mond.
    const r = reasons(grid([unit('IC5146', [[0, 3]]), unit('M31', [[0, 9]])], 6 * 300), 'IC5146');
    expect(r.length).toBeGreaterThan(0);
    expect(r).not.toContain('moon_blocked');
    expect(r).toContain('not_visible');
  });

  it('sichtbar, aber jede Zeile mondunsicher → weiter moon_blocked', () => {
    const r = reasons(grid([unit('M42', [[0, 9]], []), unit('M31', [[0, 9]])], null, 40), 'M42');
    expect(r).toContain('moon_blocked');
  });
});
