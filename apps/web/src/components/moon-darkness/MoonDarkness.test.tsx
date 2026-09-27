// @vitest-environment jsdom
/**
 * „Mond und Dunkelheit“ und Mondkalender (Planung): Werte der Nacht 27./28.09.2026 in Starfront (America/Chicago)
 * gegen den Beobachtungsplaner (Screenshot Sven 27.09.2026: astr. 20:48–06:09, Sonnenuntergang 19:27, Aufgang
 * 07:30, Mondaufgang 19:55, 97 %, 17,0 Tage nach Neumond, abnehmend) auf ± 3 min; Mondsymbol; Streifen mit Kopf,
 * Auf-/Zuklappen und Legende; axe.
 */
import { formatZonedTime } from '@nina-pm/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { calendarMonth, moonDarkness } from './model';
import { litPath } from './MoonIcon';
import { MoonDarkness } from './MoonDarkness';

const SITE = { latDeg: 31.547111, lonDeg: -99.382222 };
const TZ = 'America/Chicago';
const TRANSITIONS = [
  { atUtc: Date.parse('2026-03-08T08:00:00Z') / 1000, utcOffsetMinutes: -300 },
  { atUtc: Date.parse('2026-11-01T07:00:00Z') / 1000, utcOffsetMinutes: -360 },
];
const hm = (sec: number | null) => formatZonedTime(new Date((sec ?? 0) * 1000).toISOString(), TZ);
const minutes = (s: string) => {
  const [h, m] = s.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const near = (sec: number | null, expected: string) =>
  Math.abs(((minutes(hm(sec)) - minutes(expected) + 720 + 1440) % 1440) - 720) <= 3;

const data = moonDarkness({
  site: SITE,
  night: '2026-09-27',
  timeZoneTransitions: TRANSITIONS,
  timeZone: TZ,
});

describe('moonDarkness (Nacht 27./28.09.2026, Starfront)', () => {
  it('Dämmerung, Sonne und Mond wie im Beobachtungsplaner (± 3 min)', () => {
    expect(near(data.sunset.startUtc, '19:27')).toBe(true);
    expect(near(data.sunset.endUtc, '07:30')).toBe(true);
    expect(near(data.astronomical.startUtc, '20:48')).toBe(true);
    expect(near(data.astronomical.endUtc, '06:09')).toBe(true);
    expect(near(data.civil.startUtc, '19:52')).toBe(true);
    const rise = data.moonEvents.find((e) => e.type === 'rise');
    expect(near(rise?.atUtc ?? null, '19:55')).toBe(true);
    expect(data.phase.illumPct).toBeGreaterThan(95);
    expect(data.phase.phaseIndex).toBe(5);
    expect(data.phase.ageDays).toBeCloseTo(17.0, 0);
    expect(data.moonPeak?.altDeg).toBeGreaterThan(65);
    // Fenster eine Stunde vor Sonnenuntergang bis eine Stunde nach Aufgang, auf volle Stunden.
    expect(hm(data.window.fromUtc)).toBe('18:00');
    expect(hm(data.window.toUtc)).toBe('09:00');
  });

  it('Mondkalender September 2026: Viertel den Nächten zugeordnet, drei beste Nächte um Neumond', () => {
    const cal = calendarMonth(2026, 9, SITE, TRANSITIONS);
    expect(cal.days).toHaveLength(30);
    expect(cal.firstWeekday).toBe(1); // 1.9.2026 = Dienstag
    expect(cal.quarters.map((q) => [q.kind, q.night])).toEqual([
      // Wie im Beobachtungsplaner: Viertel vor Mittag gehören zur Nacht des Vorabends.
      ['last', '2026-09-03'],
      ['new', '2026-09-10'],
      ['first', '2026-09-18'],
      ['full', '2026-09-25'],
    ]);
    expect(cal.best).toHaveLength(3);
    for (const b of cal.best) expect(Math.abs(Number(b.slice(8)) - 11)).toBeLessThanOrEqual(3);
    const full = cal.days.find((d) => d.night === '2026-09-25');
    expect(full?.moonFreeSec).toBe(0);
    expect(cal.barMaxSec).toBeGreaterThanOrEqual(8 * 3600);
  });

  it('Mondsymbol: Neumond ohne Licht, Halbmond gerade Grenze, Vollmond ganze Scheibe', () => {
    expect(litPath(0, 13, 12)).toBeNull();
    expect(litPath(90, 13, 12)).toContain('A 0 12');
    expect(litPath(180, 13, 12)).toContain('A 12 12');
  });
});

describe('MoonDarkness', () => {
  it('Kopf mit Phase, Streifen mit Legende, zuklappbar; axe', async () => {
    render(<MoonDarkness data={data} night="2026-09-27" timeZone={TZ} />);
    expect(
      screen.getByText(/^Abnehmender Mond · 9\d % beleuchtet · 1[67],\d Tage nach Neumond$/),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Nacht 27\./ }).getAttribute('aria-label')).toMatch(
      /9 h \d+ min astronomisch dunkel.*Zeiten in CDT/,
    );
    expect(screen.getByText('astronomisch dunkel')).toBeInTheDocument();
    await expectNoSeriousA11y();
    const toggle = screen.getByRole('button', { name: 'Mond und Dunkelheit' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
