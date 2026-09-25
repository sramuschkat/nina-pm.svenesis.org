/**
 * `buildPlanInput` (AP-13c, CC-15): reine Abbildung Rig + Projekte + Mondprofile + Nacht-Tabelle →
 * `PlanInput`; Schema, Auswahl der Projekte, Sortierung, Filterzuordnung (NT-E1), Projektstandard-Profil,
 * Autofokus nur mit Trigger (M7), offene Aufnahmen (NT-20).
 */
import { describe, expect, it } from 'vitest';
import { buildPlanInput, PlanInputSchema } from '../src';
import {
  DRAFT,
  moonProfiles,
  NGC281,
  NGC7000,
  nights,
  projects,
  rig,
  STARFRONT,
  STRICT,
} from './fixtures/plan';

const build = (over: Partial<Parameters<typeof buildPlanInput>[4]> = {}) =>
  buildPlanInput(rig, projects, moonProfiles, nights, {
    night: '2026-09-17',
    site: STARFRONT,
    ...over,
  });

describe('buildPlanInput', () => {
  it('liefert ein gültiges PlanInput; nur freigegebene, aktive Projekte des Rigs, nach ID sortiert', () => {
    const input = build();
    expect(PlanInputSchema.safeParse(input).error?.issues ?? []).toEqual([]);
    expect(input.projects.map((p) => p.id)).toEqual([NGC281, NGC7000]);
    expect(input.projects.some((p) => p.id === DRAFT)).toBe(false);
    expect(input.mode).toBe('productive');
    expect(input.tzdataVersion).toBe('2026a');
  });

  it('Sortierkette ohne unbekannte Schlüssel; Scheduler und Flip aus dem Rig', () => {
    const input = build();
    expect(input.scheduler.sortChain).toEqual([
      'lowest_peak_altitude',
      'setting_soonest',
      'most_remaining',
      'constrained',
    ]);
    expect(input.scheduler.flip).toEqual({
      enabled: false,
      afterMin: 5,
      maxAfterMin: 15,
      pauseBeforeMin: 0,
      durationS: 240,
    });
  });

  it('Filterrad: nur bestätigte NINA-Namen; unbestätigter Platz → ninaFilterName null (NT-E1)', () => {
    const input = build();
    const lines = input.projects.flatMap((p) => p.panels.flatMap((x) => x.lines));
    expect(input.rig.hasFilterWheel).toBe(true);
    expect(lines.map((l) => [l.filter, l.ninaFilterName])).toEqual([
      ['Ha', 'Ha'],
      ['OIII', null],
      ['L', 'Lum'],
    ]);
  });

  it('Mondprofile: Profil der Zeile und synthetisches Projektstandard-Profil; nur benutzte Profile', () => {
    const input = build();
    const ngc7000 = input.projects.find((p) => p.id === NGC7000);
    const [oiii, l] = ngc7000?.panels[0]?.lines ?? [];
    expect(oiii?.moonProfileId).toBe(STRICT);
    expect(l?.moonProfileId).toBe(`project:${NGC7000}`);
    expect(input.moonProfiles.map((p) => p.id)).toEqual([STRICT, `project:${NGC7000}`].sort());
    expect(input.moonProfiles.find((p) => p.id === `project:${NGC7000}`)).toMatchObject({
      separationDeg: 60,
      widthDays: 5,
      maxIlluminationPct: 60,
    });
  });

  it('Autofokus nur mit Trigger „Autofokus nach Zeit“ (M7); offene Aufnahmen je Zeile (NT-20)', () => {
    expect(build().scheduler.overhead.afEveryMin).toBe(0);
    expect(build({ autofocusAfterTimeMin: 45 }).scheduler.overhead.afEveryMin).toBe(60);
    const lineId = projects.find((p) => p.id === NGC281)?.panels[0]?.lines[0]?.id ?? '';
    const withPending = build({ pendingByLine: { [lineId]: 3 } });
    expect(withPending.projects[0]?.panels[0]?.lines[0]).toMatchObject({
      accepted: 23,
      pending: 3,
    });
  });

  it('inaktives Panel (AP-22): seine Zeilen kommen deaktiviert an, das Panel bleibt erhalten', () => {
    const withInactive = projects.map((p) =>
      p.id === NGC7000
        ? { ...p, panels: p.panels.map((panel) => ({ ...panel, enabled: false })) }
        : p,
    );
    const input = buildPlanInput(rig, withInactive, moonProfiles, nights, {
      night: '2026-09-17',
      site: STARFRONT,
    });
    const target = input.projects.find((p) => p.id === NGC7000);
    expect(target?.panels).toHaveLength(1);
    expect(target?.panels.flatMap((p) => p.lines.map((l) => l.enabled))).toEqual([false, false]);
  });

  it('Panel-Index = Position (NINA-Nummer − 1), auch wenn panel_index Lücken hat (NT-32)', () => {
    const gaps = projects.map((p) =>
      p.id === NGC7000
        ? {
            ...p,
            panels: [
              { ...(p.panels[0] as (typeof p.panels)[number]), panelIndex: 5 },
              { ...(p.panels[0] as (typeof p.panels)[number]), id: 'zweites', panelIndex: 2 },
            ],
          }
        : p,
    );
    const input = buildPlanInput(rig, gaps, moonProfiles, nights, {
      night: '2026-09-17',
      site: STARFRONT,
    });
    const target = input.projects.find((p) => p.id === NGC7000);
    expect(target?.panels.map((p) => [p.id, p.index])).toEqual([
      ['zweites', 0],
      [target?.panels[1]?.id, 1],
    ]);
  });

  it('gleiche Daten in anderer Reihenfolge → identisches PlanInput', () => {
    const reversed = buildPlanInput(
      rig,
      [...projects].reverse(),
      [...moonProfiles].reverse(),
      nights,
      {
        night: '2026-09-17',
        site: STARFRONT,
      },
    );
    expect(reversed).toEqual(build());
  });
});
