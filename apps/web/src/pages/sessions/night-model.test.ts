/**
 * AP-64: Auswertung einer Nacht aus Session-Daten – Prüfliste des Prüf-Banners (keine Punkte → kein Banner; ohne
 * Zuordnung, Ist < Soll, Lücke > 10 min), Projekt-Chips und Effizienz der Nächte-Liste (Transit als Serie), Ergebnis je
 * Projekt, Aufnahmen-Typen, Zeitraum und Filter in der Adresse.
 */
import { describe, expect, it } from 'vitest';
import type {
  NightSessionCapture,
  NightSessionLineRow,
  NightSessionProject,
} from '../../api/client';
import { filterSearch, parseFilter, periodRange } from './evaluation';
import {
  captureCounts,
  efficiencyBar,
  metricPoints,
  nightFacts,
  projectChips,
  projectResults,
  reviewChecklist,
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

describe('Prüfliste (Prüf-Banner)', () => {
  it('keine Punkte → leere Liste (kein Banner)', () => {
    expect(reviewChecklist({ captures: [], rows: [] }, [])).toEqual([]);
    // Nur Flats, Soll erreicht, nur Flip-Lücke: nichts zu prüfen.
    expect(
      reviewChecklist({ captures: [capture({ frameType: 'flat' })], rows: [row()] }, [
        { fromUtc: 0, toUtc: 1800, kind: 'flip' },
      ]),
    ).toEqual([]);
  });

  it('alle Lights zugeordnet → ein erledigter Punkt', () => {
    expect(
      reviewChecklist({ captures: [capture(), capture({ id: ID(31) })], rows: [] }, []),
    ).toEqual([{ kind: 'assigned', ok: true, count: 2 }]);
  });

  it('ohne Zuordnung, Ist < Soll und Lücke > 10 min mit Grund', () => {
    const items = reviewChecklist(
      {
        captures: [capture(), capture({ id: ID(31), assignment: 'unassigned', projectId: null })],
        rows: [
          row(),
          row({ exposureLineId: ID(21), filterShortName: 'SII', planned: 6, acquired: 1 }),
          // Transit-Serie und Zeilen ohne Soll sind keine Prüfpunkte.
          row({
            exposureLineId: ID(22),
            planned: 0,
            plannedSeries: { fromUtc: '2026-10-07T01:11:00Z', untilUtc: '2026-10-07T05:54:00Z' },
            acquired: 558,
          }),
          row({ exposureLineId: ID(23), planned: null, acquired: 3 }),
        ],
      },
      [
        { fromUtc: 1000, toUtc: 1000 + 1200, kind: 'idle', reason: null },
        { fromUtc: 5000, toUtc: 5000 + 300, kind: 'idle' },
        { fromUtc: 9000, toUtc: 9000 + 1260, kind: 'flip' },
      ],
    );
    expect(items).toEqual([
      { kind: 'unassigned', ok: false, count: 1 },
      {
        kind: 'short',
        ok: false,
        lineId: ID(21),
        projectName: 'IC 1795',
        filter: 'SII',
        acquired: 1,
        planned: 6,
      },
      {
        kind: 'gap',
        ok: false,
        gapKind: 'idle',
        reason: null,
        count: 1,
        fromUtc: 1000,
        toUtc: 2200,
      },
    ]);
  });

  it('genau 10 min ist keine Lücke für die Prüfliste, 10 min 1 s schon', () => {
    const gap = (s: number) => [{ fromUtc: 0, toUtc: s, kind: 'safety' }];
    expect(reviewChecklist({ captures: [], rows: [] }, gap(600))).toEqual([]);
    expect(reviewChecklist({ captures: [], rows: [] }, gap(601))).toHaveLength(1);
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

  it('Typ-Chips zählen; Flats mit Dark-Flats; HFR-Reihe nur gespeicherte Lights mit Messwert', () => {
    const list = [
      capture(),
      capture({ id: ID(31), frameType: 'flat', hfr: null, stars: null }),
      capture({ id: ID(32), frameType: 'dark_flat', hfr: null, stars: null }),
      capture({ id: ID(33), temperatureDeviation: true, rejected: true }),
      capture({ id: ID(34), assignment: 'unassigned', hfr: null, stars: null }),
    ];
    expect(captureCounts(list)).toEqual({
      all: 5,
      lights: 3,
      flats: 2,
      deviations: 1,
      unassigned: 1,
      rejected: 1,
    });
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
