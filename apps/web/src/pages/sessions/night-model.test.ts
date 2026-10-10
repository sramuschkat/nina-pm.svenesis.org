/**
 * AP-64/AP-77: Auswertung einer Nacht aus Session-Daten – Hinweise (Warnungen und Fehler), Projekt-Chips und Effizienz
 * der Nächte-Liste (Transit als Serie), Ergebnis je Projekt, Kennzahlen, Bedingungen mehrerer Sessions, Zeitraum und
 * Filter in der Adresse.
 */
import { describe, expect, it } from 'vitest';
import type {
  NightSessionCapture,
  NightSessionDetail,
  NightSessionLineRow,
  NightSessionListItem,
  NightSessionProject,
} from '../../api/client';
import { filterSearch, parseFilter, periodRange } from './evaluation';
import {
  efficiencyBar,
  gapsWithin,
  groupNights,
  mergeConditions,
  mergeDetails,
  metricPoints,
  nightFacts,
  nightWarnings,
  projectChips,
  projectResults,
  weatherTone,
} from './night-model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (over: Partial<NightSessionLineRow> = {}): NightSessionLineRow => ({
  projectId: ID(10),
  projectName: 'IC 1795',
  projectCreatedBy: ID(3),
  canCorrect: true,
  exposureLineId: ID(20),
  filterShortName: 'HA',
  exposureS: 600,
  planned: 10,
  plannedSeries: null,
  plannedLater: false,
  acquired: 10,
  rejected: 0,
  accepted: 10,
  bonus: 0,
  bonusRejected: 0,
  integrationS: 6000,
  night: { acquired: 10, rejected: 0, rejectedIndividual: 0, rejectedCorrection: 0 },
  ...over,
});

const capture = (over: Partial<NightSessionCapture> = {}): NightSessionCapture => ({
  id: ID(30),
  capturedAt: '2026-10-07T03:21:00Z',
  frameType: 'light',
  projectId: ID(10),
  projectName: 'IC 1795',
  projectCreatedBy: ID(3),
  exposureLineId: ID(20),
  assignment: 'assigned',
  filterShortName: 'HA',
  filterActual: null,
  exposureS: 600,
  gain: null,
  offset: null,
  binning: 1,
  result: 'saved',
  isBonus: false,
  temperatureDeviation: false,
  settingsDeviation: false,
  rejected: false,
  rejectReason: null,
  fileName: null,
  hfr: 1.4,
  stars: 1100,
  ...over,
});

describe('Hinweise der Nacht (AP-77)', () => {
  const ev = (kind: string, n: number) => ({
    id: ID(90 + n),
    occurredAt: '2026-10-07T03:00:00Z',
    kind,
    message: null,
    durationS: null,
  });
  it('Fehler zuerst, dann Warnungen in fester Reihenfolge; übrige Ereignisse zählen nicht', () => {
    expect(
      nightWarnings([
        ev('af', 1),
        ev('lease_lost', 2),
        ev('error', 3),
        ev('warning', 4),
        ev('warning', 5),
      ]),
    ).toEqual({
      errors: 1,
      warnings: 3,
      kinds: [
        { kind: 'error', count: 1 },
        { kind: 'warning', count: 2 },
        { kind: 'lease_lost', count: 1 },
      ],
    });
    expect(nightWarnings([ev('af', 1)])).toEqual({ errors: 0, warnings: 0, kinds: [] });
  });

  it('Bedingungen mehrerer Sessions: Spanne über alle, Quelle der ersten', () => {
    expect(
      mergeConditions([
        [{ metric: 'cloudPct', source: 'captures', median: 2, min: 0, max: 10 }],
        [
          { metric: 'cloudPct', source: 'telemetry', median: 6, min: 1, max: 40 },
          { metric: 'windMs', source: 'telemetry', median: 3, min: 1, max: 5 },
        ],
      ]),
    ).toEqual([
      { metric: 'cloudPct', source: 'captures', median: 4, min: 0, max: 40 },
      { metric: 'windMs', source: 'telemetry', median: 3, min: 1, max: 5 },
    ]);
  });
});

describe('Nächte-Liste: Projekt-Chips und Effizienz', () => {
  const project = (over: Partial<NightSessionProject> = {}): NightSessionProject => ({
    projectId: ID(10),
    projectName: 'IC 1795',
    createdBy: ID(3),
    transit: false,
    frames: 21,
    filters: [
      { filter: 'HA', frames: 10 },
      { filter: 'OIII', frames: 10 },
      { filter: 'SII', frames: 1 },
    ],
    ...over,
  });

  it('Frames je Filter; Transit als Serie', () => {
    const [deep, transit] = projectChips([
      project(),
      project({
        projectId: ID(11),
        projectName: 'WASP-3b',
        transit: true,
        frames: 558,
        filters: [{ filter: 'RED', frames: 558 }],
      }),
    ]);
    expect(deep).toMatchObject({ series: false, createdBy: ID(3) });
    expect(deep?.parts).toEqual([
      { filter: 'HA', frames: 10 },
      { filter: 'OIII', frames: 10 },
      { filter: 'SII', frames: 1 },
    ]);
    expect(transit).toMatchObject({ series: true, parts: [{ filter: 'RED', frames: 558 }] });
  });

  it('Effizienz „8,2 von 9,6 h · 85 %“; Balken begrenzt auf 100 %; ohne Effizienz null', () => {
    expect(efficiencyBar({ exposureS: 29_520, usableDarkS: 34_560, pct: 85.4 })).toEqual({
      exposureH: 8.2,
      darkH: 9.6,
      pct: 85,
      widthPct: 85.4,
    });
    expect(efficiencyBar({ exposureS: 100, usableDarkS: 50, pct: 200 })?.widthPct).toBe(100);
    expect(efficiencyBar({ exposureS: 100, usableDarkS: 0, pct: null })?.pct).toBeNull();
    expect(efficiencyBar(null)).toBeNull();
  });

  it('Wetterpunkt nach Klasse', () => {
    expect(weatherTone({ ratingIndex: 4, nightMean: 0.9 })).toBe('good');
    expect(weatherTone({ ratingIndex: 2, nightMean: 0.5 })).toBe('fair');
    expect(weatherTone({ ratingIndex: 0, nightMean: 0.1 })).toBe('poor');
    expect(weatherTone(null)).toBe('none');
  });
});

describe('Ergebnis je Projekt, Kennzahlen, Aufnahmen', () => {
  it('Filter-Chips Ist/Soll mit ✓ bzw. !, Transit als Serie, Verworfen und Bonus summiert', () => {
    const [p, exo] = projectResults([
      row(),
      row({ exposureLineId: ID(21), filterShortName: 'SII', planned: 6, acquired: 1, rejected: 1 }),
      row({
        exposureLineId: ID(22),
        filterShortName: 'OIII',
        planned: 0,
        plannedLater: true,
        acquired: 4,
        bonus: 2,
      }),
      row({
        projectId: ID(11),
        projectName: 'WASP-3b',
        exposureLineId: ID(23),
        filterShortName: 'RED',
        planned: 0,
        plannedSeries: { fromUtc: '2026-10-07T01:11:00Z', untilUtc: '2026-10-07T05:54:00Z' },
        acquired: 558,
        integrationS: 16_740,
      }),
    ]);
    expect(p?.filters.map((f) => [f.filter, f.acquired, f.planned, f.ok])).toEqual([
      ['HA', 10, 10, true],
      ['SII', 1, 6, false],
      ['OIII', 4, null, null],
    ]);
    expect(p).toMatchObject({ rejected: 1, bonus: 2, transit: false, integrationS: 18_000 });
    expect(exo).toMatchObject({ transit: true, integrationS: 16_740 });
    expect(exo?.filters[0]).toMatchObject({ planned: null, ok: true, acquired: 558 });
  });

  it('Kennzahlen: Dunkel, Lights, Flats, Leerlauf ohne Flip, Flip und Autofokus', () => {
    const f = nightFacts(
      {
        captures: [
          capture(),
          capture({ id: ID(31), frameType: 'flat' }),
          capture({ id: ID(32), frameType: 'dark_flat' }),
          capture({ id: ID(33), result: 'failed' }),
        ],
        events: [
          {
            id: ID(40),
            occurredAt: '2026-10-07T08:22:00Z',
            kind: 'flip',
            message: null,
            durationS: 1260,
          },
          {
            id: ID(41),
            occurredAt: '2026-10-07T05:00:00Z',
            kind: 'af',
            message: null,
            durationS: 120,
          },
        ],
        kpis: {
          darkFromUtc: '2026-10-07T01:00:00Z',
          darkToUtc: '2026-10-07T10:36:00Z',
          runtimeS: null,
          usableDarkS: null,
          exposureS: 29_520,
          efficiencyPct: 85,
          overhead: null,
          safetyPauseS: 0,
          blockChanges: 0,
          filterChanges: 0,
          plan: null,
        },
      },
      [
        { fromUtc: 0, toUtc: 1200, kind: 'idle' },
        { fromUtc: 2000, toUtc: 3260, kind: 'flip' },
      ],
    );
    expect(f).toEqual({
      darkS: 34_560,
      exposureS: 29_520,
      efficiencyPct: 85,
      lights: 1,
      flats: 1,
      darkFlats: 1,
      idleS: 1200,
      flips: 1,
      autofocus: 1,
    });
  });

  it('HFR-Reihe nur gespeicherte Lights mit Messwert', () => {
    const list = [
      capture(),
      capture({ id: ID(31), frameType: 'flat', hfr: null, stars: null }),
      capture({ id: ID(32), frameType: 'dark_flat', hfr: null, stars: null }),
      capture({ id: ID(33), temperatureDeviation: true, rejected: true }),
      capture({ id: ID(34), assignment: 'unassigned', hfr: null, stars: null }),
    ];
    expect(metricPoints(list)).toHaveLength(2);
  });
});

describe('Filter der Auswertung in der Adresse', () => {
  it('Standard 30 Nächte bis heute; Jahr; von–bis geordnet', () => {
    expect(periodRange(parseFilter(new URLSearchParams()), '2026-10-07')).toEqual({
      from: '2026-09-08',
      to: '2026-10-07',
    });
    expect(periodRange(parseFilter(new URLSearchParams('zeitraum=jahr')), '2026-10-07')).toEqual({
      from: '2026-01-01',
      to: '2026-10-07',
    });
    expect(
      periodRange(
        parseFilter(new URLSearchParams('zeitraum=frei&von=2026-10-01&bis=2026-09-01')),
        '2026-10-07',
      ),
    ).toEqual({ from: '2026-09-01', to: '2026-10-01' });
  });

  it('Hin und zurück ohne Standardwerte; unbekannte Werte fallen zurück', () => {
    const f = parseFilter(new URLSearchParams(`rig=${ID(1)}&zeitraum=90&x=1`));
    expect(filterSearch(f)).toBe(`?rig=${ID(1)}&zeitraum=90`);
    expect(parseFilter(new URLSearchParams('zeitraum=kaputt&von=2026-13')).period).toBe('30');
    expect(filterSearch(parseFilter(new URLSearchParams('zeitraum=30')))).toBe('');
  });
});

describe('Eine Karte je Nacht und Rig (Entscheidung Sven 07.10.2026)', () => {
  const item = (over: Partial<NightSessionListItem> = {}): NightSessionListItem => ({
    id: ID(1),
    rigId: ID(500),
    rigName: 'SFRO-Rig',
    siteTimeZone: 'America/Chicago',
    night: '2026-10-06',
    status: 'completed',
    startedAt: '2026-10-07T01:00:00Z',
    endedAt: '2026-10-07T06:10:00Z',
    sessionEndUtc: null,
    createdOffline: false,
    ninaInstanceName: 'PC',
    frames: 10,
    bonusFrames: 0,
    integrationS: 6000,
    unassigned: 0,
    efficiency: { exposureS: 6000, usableDarkS: 18_000, pct: 33.3 },
    weather: null,
    projects: [
      {
        projectId: ID(10),
        projectName: 'IC 1795',
        createdBy: ID(3),
        transit: false,
        frames: 10,
        filters: [{ filter: 'HA', frames: 10 }],
      },
    ],
    ...over,
  });

  it('zwei Sessions einer Nacht → eine Gruppe mit Summen', () => {
    const groups = groupNights([
      item({
        id: ID(2),
        startedAt: '2026-10-07T06:15:00Z',
        endedAt: '2026-10-07T11:52:00Z',
        efficiency: { exposureS: 12_000, usableDarkS: 18_000, pct: 66.7 },
        weather: { ratingIndex: 4, nightMean: 0.9 },
        projects: [
          {
            projectId: ID(10),
            projectName: 'IC 1795',
            createdBy: ID(3),
            transit: false,
            frames: 11,
            filters: [
              { filter: 'HA', frames: 1 },
              { filter: 'SII', frames: 10 },
            ],
          },
        ],
      }),
      item(),
      item({ id: ID(3), rigId: ID(501), rigName: 'Rig B' }),
      item({ id: ID(4), night: '2026-10-05' }),
    ]);
    expect(groups.map((g) => [g.night, g.rigName, g.sessions.length])).toEqual([
      ['2026-10-06', 'SFRO-Rig', 2],
      ['2026-10-06', 'Rig B', 1],
      ['2026-10-05', 'SFRO-Rig', 1],
    ]);
    const g = groups[0] as (typeof groups)[number];
    expect(g.sessions.map((x) => x.id)).toEqual([ID(1), ID(2)]);
    expect([g.startedAt, g.endedAt]).toEqual(['2026-10-07T01:00:00Z', '2026-10-07T11:52:00Z']);
    expect(g.efficiency).toEqual({ exposureS: 18_000, usableDarkS: 36_000, pct: 50 });
    expect(g.weather).toEqual({ ratingIndex: 4, nightMean: 0.9 });
    expect(g.integrationS).toBe(12_000);
    expect(g.projects).toEqual([
      {
        projectId: ID(10),
        projectName: 'IC 1795',
        createdBy: ID(3),
        transit: false,
        frames: 21,
        filters: [
          { filter: 'HA', frames: 11 },
          { filter: 'SII', frames: 10 },
        ],
      },
    ]);
  });

  it('läuft eine Session noch, ist das Ende offen; ganze Nacht aus zwei Details, Lücken je Session', () => {
    expect(
      groupNights([item(), item({ id: ID(2), endedAt: null, status: 'running' })])[0],
    ).toMatchObject({
      endedAt: null,
      status: 'running',
    });
    const d = (id: number, at: string, exposureS: number): NightSessionDetail =>
      ({
        session: {
          ...item({ id: ID(id), startedAt: at }),
          planRevision: 1,
          darknessEndUtc: null,
        },
        rows: [row()],
        captures: [capture({ id: ID(30 + id), capturedAt: at })],
        capturesTruncated: false,
        events: [{ id: ID(40 + id), occurredAt: at, kind: 'af', message: null, durationS: 60 }],
        flats: [],
        kpis: {
          darkFromUtc: null,
          darkToUtc: null,
          runtimeS: null,
          usableDarkS: 10_000,
          exposureS,
          efficiencyPct: null,
          overhead: null,
          safetyPauseS: 0,
          blockChanges: 0,
          filterChanges: 0,
          plan: null,
        },
        reasons: [],
      }) as NightSessionDetail;
    const m = mergeDetails([
      d(1, '2026-10-07T01:00:00Z', 5000),
      d(2, '2026-10-07T06:00:00Z', 3000),
    ]);
    expect(m.captures.map((c) => c.id)).toEqual([ID(31), ID(32)]);
    expect(m.rows).toHaveLength(1);
    expect(m.kpis).toMatchObject({ exposureS: 8000, usableDarkS: 20_000, efficiencyPct: 40 });
    const gaps = [
      {
        fromUtc: Date.parse('2026-10-07T03:00:00Z') / 1000,
        toUtc: Date.parse('2026-10-07T03:30:00Z') / 1000,
        kind: 'idle',
      },
      {
        fromUtc: Date.parse('2026-10-07T08:00:00Z') / 1000,
        toUtc: Date.parse('2026-10-07T08:30:00Z') / 1000,
        kind: 'idle',
      },
    ];
    expect(
      gapsWithin(gaps, { startedAt: '2026-10-07T01:00:00Z', endedAt: '2026-10-07T06:10:00Z' }),
    ).toEqual([gaps[0]]);
  });
});
