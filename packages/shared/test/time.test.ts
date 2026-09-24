import { describe, expect, it } from 'vitest';
import { formatNightKey, formatTzAbbr, formatZonedTime } from '../src/time';

describe('formatTzAbbr (NT-03, rules/ui.md)', () => {
  it.each([
    ['2026-09-18T02:08:00Z', 'America/Chicago', 'CDT'],
    ['2026-12-18T02:08:00Z', 'America/Chicago', 'CST'],
    ['2026-07-01T12:00:00Z', 'Europe/Berlin', 'MESZ'],
    ['2026-12-01T12:00:00Z', 'Europe/Berlin', 'MEZ'],
    ['2026-07-01T12:00:00Z', 'Asia/Kolkata', 'UTC+5:30'],
    ['2026-07-01T12:00:00Z', 'Asia/Kathmandu', 'UTC+5:45'],
    ['2026-07-01T12:00:00Z', 'Pacific/Kiritimati', 'UTC+14'],
    ['2026-07-01T12:00:00Z', 'UTC', 'UTC'],
  ])('%s in %s → %s', (at, zone, expected) => {
    expect(formatTzAbbr(at, zone)).toBe(expected);
  });
});

describe('Uhrzeit und Doppeldatum', () => {
  it('Standortzeit, nie Browserzeit: 02:08Z → 21:08 in Chicago', () => {
    expect(formatZonedTime('2026-09-18T02:08:00Z', 'America/Chicago')).toBe('21:08');
    expect(formatZonedTime('2026-09-18T02:08:00Z', 'Europe/Berlin')).toBe('04:08');
  });

  it.each([
    ['2026-09-17', '17./18.09.'],
    ['2026-09-30', '30.09./01.10.'],
    ['2026-12-31', '31.12./01.01.'],
    ['2028-02-28', '28./29.02.'],
    ['2028-02-29', '29.02./01.03.'],
  ])('%s → %s', (night, expected) => {
    expect(formatNightKey(night)).toBe(expected);
  });
});
