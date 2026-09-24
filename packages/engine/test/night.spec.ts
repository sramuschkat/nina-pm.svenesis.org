/**
 * specs/engine/night.md §4 (AP-08b): Dämmerung je Grenze, Polarfälle, Zeitumstellung, Nachtfenster-
 * Rundung (NT-07, ±5 s), Himmelsflats (NT-40). Referenzzeiten auf ganze Sekunden gerundet (±1 s).
 */
import { describe, expect, it } from 'vitest';
import { EngineInputError, nightBounds, nightTimes, type TimeZoneTransition } from '../src/index';

const at = (iso: string) => Date.parse(iso) / 1000;
const tz = (...xs: [string, number][]): TimeZoneTransition[] =>
  xs.map(([iso, off]) => ({ atUtc: at(iso), utcOffsetMinutes: off }));

const CHICAGO = tz(
  ['2025-11-02T07:00:00Z', -360],
  ['2026-03-08T08:00:00Z', -300],
  ['2026-11-01T07:00:00Z', -360],
);
const BERLIN = tz(
  ['2025-10-26T01:00:00Z', 60],
  ['2026-03-29T01:00:00Z', 120],
  ['2026-10-25T01:00:00Z', 60],
);
const STARFRONT = { latDeg: 31.5471, lonDeg: -99.3823 };
const HANNOVER = { latDeg: 52.3705, lonDeg: 9.7332 };

const near = (actual: number | null, iso: string, tol: number) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual ?? 0) - at(iso)), `${String(actual)} gegen ${iso}`).toBeLessThanOrEqual(
    tol,
  );
};

describe('Nachtfenster-Rundung (NT-07, ±5 s, WS-28)', () => {
  it('Starfront 2026-09-17: 00:00:00Z – 13:00:00Z, 156 Slots; Dämmerung 01:04:49Z / 11:59:08Z (±1 s)', () => {
    const n = nightTimes({ site: STARFRONT, night: '2026-09-17', timeZoneTransitions: CHICAGO });
    expect(n.nightWindow).toEqual({
      startUtc: at('2026-09-18T00:00:00Z'),
      endUtc: at('2026-09-18T13:00:00Z'),
      slots: 156,
    });
    near(n.twilight.civil.startUtc, '2026-09-18T01:04:49Z', 1);
    near(n.twilight.civil.endUtc, '2026-09-18T11:59:08Z', 1);
  });

  it('Tabellenspalte nightWindowEndUtc: 18.09. → 13:00:00Z (11:59:45Z), 19.09. → 13:05:00Z (12:00:21Z)', () => {
    const n18 = nightTimes({ site: STARFRONT, night: '2026-09-18', timeZoneTransitions: CHICAGO });
    expect(n18.nightWindow.endUtc).toBe(at('2026-09-19T13:00:00Z'));
    near(n18.twilight.civil.endUtc, '2026-09-19T11:59:45Z', 1);
    const n19 = nightTimes({ site: STARFRONT, night: '2026-09-19', timeZoneTransitions: CHICAGO });
    expect(n19.nightWindow.endUtc).toBe(at('2026-09-20T13:05:00Z'));
    near(n19.twilight.civil.endUtc, '2026-09-20T12:00:21Z', 1);
  });

  it('Gegenprobe Starfront 2026-09-15: 00:05:00Z – 13:00:00Z, 155 Slots (Rundungsrichtung)', () => {
    const n = nightTimes({ site: STARFRONT, night: '2026-09-15', timeZoneTransitions: CHICAGO });
    expect(n.nightWindow).toEqual({
      startUtc: at('2026-09-16T00:05:00Z'),
      endUtc: at('2026-09-16T13:00:00Z'),
      slots: 155,
    });
    near(n.twilight.civil.startUtc, '2026-09-16T01:07:28Z', 1);
    near(n.twilight.civil.endUtc, '2026-09-16T11:57:55Z', 1);
  });
});

describe('Dämmerung je Grenze (night.md §2–§4)', () => {
  it('Starfront im September: alle drei Grenzen; darknessEnd nautisch 11:30:42Z, astronomisch 11:01:56Z', () => {
    const n = nightTimes({ site: STARFRONT, night: '2026-09-17', timeZoneTransitions: CHICAGO });
    for (const k of ['civil', 'nautical', 'astronomical'] as const)
      expect(n.twilight[k].kind).toBe('normal');
    near(n.twilight.nautical.endUtc, '2026-09-18T11:30:42Z', 1);
    near(n.twilight.astronomical.endUtc, '2026-09-18T11:01:56Z', 1);
  });

  it('Himmelsflats (NT-40): −8° = 11:49:41Z, −2° = 12:17:58Z; bei panel beide null', () => {
    const sky = nightTimes({
      site: STARFRONT,
      night: '2026-09-17',
      timeZoneTransitions: CHICAGO,
      flatsSource: 'sky',
    });
    near(sky.skyFlats.notBeforeUtc, '2026-09-18T11:49:41Z', 1);
    near(sky.skyFlats.notAfterUtc, '2026-09-18T12:17:58Z', 1);
    const panel = nightTimes({
      site: STARFRONT,
      night: '2026-09-17',
      timeZoneTransitions: CHICAGO,
      flatsSource: 'panel',
    });
    expect(panel.skyFlats).toEqual({ notBeforeUtc: null, notAfterUtc: null });
  });

  it('Hannover 21.06.: h_min = −14,19°, −18° ohne Durchgang, nautisch 21:59–00:47 UTC (2,80 h)', () => {
    const n = nightTimes({ site: HANNOVER, night: '2026-06-21', timeZoneTransitions: BERLIN });
    expect(n.sunMinAltDeg).toBeCloseTo(-14.19, 2);
    expect(n.twilight.astronomical).toMatchObject({
      kind: 'polarDay',
      startUtc: null,
      endUtc: null,
    });
    expect(n.twilight.civil.kind).toBe('normal');
    near(n.twilight.nautical.startUtc, '2026-06-21T21:59:00Z', 60);
    near(n.twilight.nautical.endUtc, '2026-06-22T00:47:00Z', 60);
    const hours = ((n.twilight.nautical.endUtc ?? 0) - (n.twilight.nautical.startUtc ?? 0)) / 3600;
    expect(hours).toBeCloseTo(2.8, 1);
  });

  it('Hannover 29.07.2026: h_min = −19,07°, 113,8 min astronomische Dunkelheit um den Antitransit 23:27:34Z (01:28 MESZ)', () => {
    const n = nightTimes({ site: HANNOVER, night: '2026-07-29', timeZoneTransitions: BERLIN });
    expect(n.sunMinAltDeg).toBeCloseTo(-19.07, 2);
    expect(Math.abs(n.antitransitUtc - at('2026-07-29T23:27:34Z'))).toBeLessThanOrEqual(1);
    const minutes =
      ((n.twilight.astronomical.endUtc ?? 0) - (n.twilight.astronomical.startUtc ?? 0)) / 60;
    expect(minutes).toBeGreaterThan(112.8);
    expect(minutes).toBeLessThan(114.8);
    // Abwärtsdurchgang nach lokaler Mitternacht (22:00Z = 00:00 MESZ)
    expect(n.twilight.astronomical.startUtc ?? 0).toBeGreaterThan(at('2026-07-29T22:00:00Z'));
    expect(n.twilight.astronomical.grazing).toBe(false);
  });

  it('streifender Fall: Hannover 26.07. (|h_min − h₀| = 0,37° < 0,5°) ist grazing', () => {
    const n = nightTimes({ site: HANNOVER, night: '2026-07-26', timeZoneTransitions: BERLIN });
    expect(n.twilight.astronomical.grazing).toBe(true);
  });

  it('A Coruña 2026-07-01: Dunkelheit ab 22:36:41Z (±60 s) – nach der Fenstermitte; Antitransit 00:37:40Z', () => {
    const n = nightTimes({
      site: { latDeg: 43.3623, lonDeg: -8.4115 },
      night: '2026-07-01',
      timeZoneTransitions: tz(['2026-03-29T01:00:00Z', 120]),
    });
    near(n.twilight.astronomical.startUtc, '2026-07-01T22:36:41Z', 60);
    expect(Math.abs(n.antitransitUtc - at('2026-07-02T00:37:40Z'))).toBeLessThanOrEqual(1);
  });

  it('La Silla (29,3° S) im Juni: Südhalbkugel, lange Nacht', () => {
    const n = nightTimes({
      site: { latDeg: -29.2563, lonDeg: -70.7377 },
      night: '2026-06-21',
      timeZoneTransitions: tz(['2026-04-05T03:00:00Z', -240]),
    });
    expect(n.twilight.astronomical.kind).toBe('normal');
    const hours =
      ((n.twilight.astronomical.endUtc ?? 0) - (n.twilight.astronomical.startUtc ?? 0)) / 3600;
    expect(hours).toBeGreaterThan(10.5);
  });

  it('Polarnacht 78° N, 21.12.: h_max = −11,44°; −6° ohne Durchgang → Fenster Mittag–Mittag; −12°/−18° mit je zwei Durchgängen', () => {
    const n = nightTimes({
      site: { latDeg: 78, lonDeg: 15.6 },
      night: '2026-12-21',
      timeZoneTransitions: tz(['2026-10-25T01:00:00Z', 60]),
    });
    expect(n.sunMaxAltDeg).toBeCloseTo(-11.44, 1);
    expect(n.twilight.civil.kind).toBe('polarNight');
    expect(n.twilight.nautical.kind).toBe('normal');
    expect(n.twilight.astronomical.kind).toBe('normal');
    expect(n.nightWindow).toMatchObject({ startUtc: n.noonStartUtc, endUtc: n.noonEndUtc });
  });

  it('Polartag 78° N, 21.06.: h_min über −6° → Fenster 18:00 Standortzeit + 12 h', () => {
    const n = nightTimes({
      site: { latDeg: 78, lonDeg: 15.6 },
      night: '2026-06-21',
      timeZoneTransitions: tz(['2026-03-29T01:00:00Z', 120]),
    });
    expect(n.twilight.civil.kind).toBe('polarDay');
    expect(n.nightWindow).toEqual({
      startUtc: at('2026-06-21T16:00:00Z'),
      endUtc: at('2026-06-22T04:00:00Z'),
      slots: 144,
    });
  });

  it('Dunkelheit am Pol (−85°, 29.05.–04.06.2026): kürzeste astronomische Spanne > 900 min (verify-planner.js:472)', () => {
    let shortest = Infinity;
    for (let d = 29; d <= 35; d++) {
      const night = d <= 31 ? `2026-05-${String(d)}` : `2026-06-0${String(d - 31)}`;
      const n = nightTimes({
        site: { latDeg: -85, lonDeg: -45 },
        night,
        timeZoneTransitions: tz(['2026-01-01T00:00:00Z', 0]),
      });
      const a = n.twilight.astronomical;
      const span = a.kind === 'polarNight' ? 1440 : ((a.endUtc ?? 0) - (a.startUtc ?? 0)) / 60;
      shortest = Math.min(shortest, span);
    }
    expect(shortest).toBeGreaterThan(900);
  });
});

describe('Nacht-Schlüssel und Zeitzonen (night.md §1, NT-46, AST-N2, AST-N16)', () => {
  const hours = (b: { noonStartUtc: number; noonEndUtc: number }) =>
    (b.noonEndUtc - b.noonStartUtc) / 3600;

  it('America/Chicago: 2026-10-31 = 25 h (17:00Z → 18:00Z), 2026-03-07 = 23 h (18:00Z → 17:00Z)', () => {
    expect(nightBounds('2026-10-31', CHICAGO)).toEqual({
      noonStartUtc: at('2026-10-31T17:00:00Z'),
      noonEndUtc: at('2026-11-01T18:00:00Z'),
    });
    expect(nightBounds('2026-03-07', CHICAGO)).toEqual({
      noonStartUtc: at('2026-03-07T18:00:00Z'),
      noonEndUtc: at('2026-03-08T17:00:00Z'),
    });
  });

  it('Europe/Berlin: 24.10. = 25 h, 28.03. = 23 h; 25.10. und 29.03. = 24 h', () => {
    expect(nightBounds('2026-10-24', BERLIN)).toEqual({
      noonStartUtc: at('2026-10-24T10:00:00Z'),
      noonEndUtc: at('2026-10-25T11:00:00Z'),
    });
    expect(hours(nightBounds('2026-03-28', BERLIN))).toBe(23);
    expect(nightBounds('2026-03-28', BERLIN).noonStartUtc).toBe(at('2026-03-28T11:00:00Z'));
    expect(hours(nightBounds('2026-10-25', BERLIN))).toBe(24);
    expect(hours(nightBounds('2026-03-29', BERLIN))).toBe(24);
  });

  it('Pacific/Kiritimati (+14 h): Nacht 2026-07-01 läuft 2026-06-30T22:00Z → 2026-07-01T22:00Z', () => {
    expect(nightBounds('2026-07-01', tz(['1995-01-01T00:00:00Z', 840]))).toEqual({
      noonStartUtc: at('2026-06-30T22:00:00Z'),
      noonEndUtc: at('2026-07-01T22:00:00Z'),
    });
  });

  it('Pacific/Apia 30.12.2011 existiert nicht → validation.failed statt 0-h-Nacht', () => {
    const apia = tz(
      ['2011-04-02T14:00:00Z', -660],
      ['2011-09-24T14:00:00Z', -600],
      ['2011-12-30T10:00:00Z', 840],
    );
    expect(() => nightBounds('2011-12-30', apia)).toThrow(EngineInputError);
    try {
      nightBounds('2011-12-30', apia);
    } catch (e) {
      expect(e).toMatchObject({ code: 'validation.failed' });
    }
  });

  it('ungültiger Schlüssel → validation.failed', () => {
    expect(() => nightBounds('2026-02-30', BERLIN)).toThrow(/validation.failed/);
  });
});
