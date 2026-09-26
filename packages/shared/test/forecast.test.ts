/**
 * Folgeplanung und Prognose (AP-33; FA-FOL-01…05, FA-FOL-07; FK 8.5): Restbedarf mit Overhead, Spanne
 * optimistisch/realistisch (Gewicht aus Vorhersage bzw. Klarnacht-Quote, Fortschreibung über den Horizont),
 * Kandidatennächte mit Nutzen und Ampel, Saisonwarnung mit Vorschlägen, Wiederaufnahme, Vertragsform.
 */
import { describe, expect, it } from 'vitest';
import { ForecastView, forecastView, type ForecastInput } from '../src';
import { NGC281, projects } from './fixtures/plan';

const ngc = projects.find((p) => p.id === NGC281);
if (!ngc) throw new Error('Fixture fehlt');
const lineId = ngc.panels[0]?.lines[0]?.id as string;
const weather = (nightMean: number, over: Record<string, unknown> = {}) => ({
  nightMean,
  ratingIndex: nightMean >= 0.65 ? 3 : 2,
  coverage: 1,
  bestWindow: null,
  aerosolMissing: false,
  seeingIncomplete: false,
  incomplete: false,
  precipProbPct: 10,
  precipMm: 0,
  ...over,
});

const base: ForecastInput = {
  rig: { id: ngc.rigId as string, name: 'Rig' },
  siteTimeZone: 'America/Chicago',
  computedAt: '2026-09-26T18:00:00Z',
  currentNight: '2026-09-26',
  projects: [ngc],
  stored: [
    {
      night: '2026-09-26',
      darkHours: 8,
      lineFrames: { [lineId]: 10 },
      projectHours: { [ngc.id]: 1 },
    },
    {
      night: '2026-09-27',
      darkHours: 8,
      lineFrames: { [lineId]: 10 },
      projectHours: { [ngc.id]: 1 },
    },
  ],
  weather: new Map([['2026-09-26', weather(0.5)]]),
  clearNights: { usable: 3, recorded: 5 },
  overheadS: () => 30,
};

describe('forecastView', () => {
  it('Restbedarf mit Overhead; Spanne optimistisch und realistisch mit Fortschreibung', () => {
    const v = forecastView(base);
    expect(ForecastView.safeParse(v).error?.issues ?? []).toEqual([]);
    // Weniger als 10 erfasste Nächte → Startquote 0,5.
    expect(v.clearQuota).toEqual({ rate: 0.5, source: 'default', recordedNights: 5 });
    expect(v.nights.map((n) => [n.weight, n.weightSource])).toEqual([
      [0.5, 'forecast'],
      [0.5, 'quota'],
    ]);
    const p = v.projects[0];
    // NGC 281: 40 geplant, 23 akzeptiert → 17 × (300 + 30) s.
    expect(p?.need).toEqual([{ filter: 'Ha', frames: 17, hours: 1.56 }]);
    expect(p?.optimistic).toEqual({ nights: 2, completesNight: '2026-09-27', extrapolated: false });
    // Realistisch: 5 + 5 Frames im Horizont, Rest 7 bei 5 je Nacht → 2 weitere Nächte.
    expect(p?.realistic).toEqual({ nights: 4, completesNight: '2026-09-29', extrapolated: true });
  });

  it('Kandidatennächte: Nutzen = Frames × Gewicht, Ampel; Kennzeichen stufen ab', () => {
    const v = forecastView({
      ...base,
      weather: new Map([
        ['2026-09-26', weather(0.9)],
        ['2026-09-27', weather(0.9, { aerosolMissing: true })],
      ]),
    });
    const c = v.projects[0]?.candidates ?? [];
    expect(c.map((x) => [x.night, x.benefit, x.light])).toEqual([
      ['2026-09-26', 10, 'green'],
      ['2026-09-27', 10, 'yellow'],
    ]);
    expect(c[0]?.filters).toEqual([{ filter: 'Ha', frames: 10 }]);
    const bad = forecastView({ ...base, weather: new Map([['2026-09-26', weather(0.2)]]) });
    expect(bad.projects[0]?.candidates[0]?.light).toBe('red');
  });

  it('Klarnacht-Quote aus der Statistik ab 10 erfassten Nächten', () => {
    const v = forecastView({ ...base, clearNights: { usable: 15, recorded: 20 } });
    expect(v.clearQuota).toEqual({ rate: 0.75, source: 'stats', recordedNights: 20 });
    expect(v.nights[1]?.weight).toBe(0.75);
  });

  it('Saisonwarnung mit Vorschlägen; ohne Zeit im Horizont auch Pausieren', () => {
    const warned = {
      ...ngc,
      priority: 3,
      effort: {
        ...(ngc.effort ?? {}),
        tag: 'multi_night' as const,
        nights: 5,
        earliestCompletion: null,
        achievablePct: 80,
        requiredHours: 2,
        bestNight: null,
        bestNightHoursByStage: [],
        limitingFactor: null,
        fullyObservable: false,
        coveragePct: 80,
        fromNight: '2026-09-26',
        toNight: '2026-12-01',
        stride: 3,
        engineVersion: 'x',
        computedAt: '2026-09-26T00:00:00Z',
      },
    };
    const v = forecastView({ ...base, projects: [warned] });
    const p = v.projects[0];
    expect(p?.seasonWarning).toEqual({ achievablePct: 80, seasonEnd: '2026-12-01' });
    expect(p?.suggestions.map((s) => [s.kind, s.oneClick])).toEqual([
      ['raise_priority', true],
      ['reduce_frames', false],
      ['other_rig', false],
      ['next_year', false],
    ]);
    const idle = forecastView({
      ...base,
      projects: [{ ...ngc, priority: 1 }],
      stored: base.stored.map((n) => ({ ...n, lineFrames: {} })),
    });
    expect(idle.projects[0]?.optimistic).toEqual({
      nights: null,
      completesNight: null,
      extrapolated: false,
    });
    expect(idle.projects[0]?.suggestions.map((s) => s.kind)).toEqual([
      'pause',
      'reduce_frames',
      'other_rig',
      'next_year',
    ]);
  });

  it('Wiederaufnahme: pausierte/unfertige Projekte mit Restbedarf; aktive nicht', () => {
    const paused = {
      ...ngc,
      id: '00000000-0000-4000-8000-000000000777',
      status: 'on_hold' as const,
    };
    const v = forecastView({ ...base, projects: [ngc, paused] });
    expect(v.projects.map((p) => p.projectId)).toEqual([ngc.id]);
    expect(v.resume).toEqual([
      expect.objectContaining({ projectId: paused.id, status: 'on_hold', needFrames: 17 }),
    ]);
  });
});
