// @vitest-environment jsdom
/**
 * Zeitleiste der Nacht: gemeinsame Achse in Standortzeit, Abschnitte an der richtigen Stelle, Marken, Linie
 * „jetzt“ nur im Fenster, Hinweis in leeren Spuren, Textalternative je beschriebener Spur; axe.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { NightTimeline, type TimelineLane } from './NightTimeline';

const at = (s: string) => Date.parse(s) / 1000;
// Starfront 18:00–08:00 CDT
const FROM = at('2026-09-27T23:00:00Z');
const TO = at('2026-09-28T13:00:00Z');

const lanes: TimelineLane[] = [
  {
    key: 'plan',
    label: 'Plan',
    segments: [
      {
        fromUtc: at('2026-09-28T02:00:00Z'),
        toUtc: at('2026-09-28T05:30:00Z'),
        color: 'var(--npm-chart-series-1)',
        label: 'NGC 281',
      },
    ],
    markers: [{ atUtc: at('2026-09-28T04:00:00Z'), color: 'red', title: 'Meridianflip 23:00' }],
    describe: true,
  },
  { key: 'events', label: 'Ereignisse', segments: [], note: 'keine Ereignisse' },
];

describe('NightTimeline', () => {
  it('Achse in Standortzeit, Abschnitt an der richtigen Stelle, Marke, Textalternative; axe', async () => {
    const { container } = render(
      <NightTimeline
        fromUtc={FROM}
        toUtc={TO}
        timeZone="America/Chicago"
        nowUtc={at('2026-09-28T03:00:00Z')}
        lanes={lanes}
        label="Zeitleiste der Nacht"
        deviceTimeZone="America/Chicago"
      />,
    );
    const group = screen.getByRole('group', { name: 'Zeitleiste der Nacht' });
    // Stunden 18 … 08 CDT, bei mehr als 16 Stunden jede zweite; hier 15 → alle.
    expect(group.textContent).toContain('18');
    expect(group.textContent).toContain('08');
    // Block 21:00–00:30 CDT: links 3/14 = 21,43 %, Breite 3,5/14 = 25 %.
    const block = within(group).getByText('NGC 281');
    expect(parseFloat(block.style.left)).toBeCloseTo((3 / 14) * 100, 5);
    expect(parseFloat(block.style.width)).toBeCloseTo(25, 5);
    expect(block).toHaveAttribute('title', 'NGC 281');
    // Textalternative der beschriebenen Spur.
    const list = container.querySelector('ul.visually-hidden');
    expect(list?.textContent).toContain('21:00–00:30: NGC 281');
    expect(list?.textContent).toContain('23:00: Meridianflip 23:00');
    // Leere Spur mit Hinweis; Linie „jetzt“ um 22:00 CDT.
    expect(within(group).getByText('keine Ereignisse')).toBeTruthy();
    const now = group.querySelector('[title="jetzt 22:00"]') as HTMLElement;
    expect(now).toBeTruthy();
    expect(Number(now.style.getPropertyValue('--now-f'))).toBeCloseTo(4 / 14, 5);
    expect(group.textContent).toContain('Zeiten in Standortzeit (CDT)');
    await expectNoSeriousA11y();
  });

  it('Rig-Zeit und Zeit des Users: zweite Stundenzeile, wenn die Zonen abweichen', () => {
    render(
      <NightTimeline
        fromUtc={FROM}
        toUtc={TO}
        timeZone="America/Chicago"
        lanes={lanes}
        label="Zeitleiste der Nacht"
        deviceTimeZone="Europe/Berlin"
      />,
    );
    const group = screen.getByRole('group', { name: 'Zeitleiste der Nacht' });
    expect(within(group).getByText('Standort CDT')).toBeTruthy();
    expect(within(group).getByText('Bei dir MESZ')).toBeTruthy();
    // 18:00 CDT = 01:00 MESZ – beide Zeilen stehen an derselben Stelle der Achse.
    const site = within(group).getAllByText('18')[0] as HTMLElement;
    expect(site.style.left).toBe('0%');
    expect(
      within(group)
        .getAllByText('01')
        .some((el) => el.style.left === '0%'),
    ).toBe(true);
    expect(group.textContent).toContain(
      'Obere Zeile: Standortzeit (CDT), darunter deine Zeit (MESZ).',
    );
  });

  it('gleiche Zone: nur eine Stundenzeile', () => {
    render(
      <NightTimeline
        fromUtc={FROM}
        toUtc={TO}
        timeZone="America/Chicago"
        lanes={lanes}
        label="Zeitleiste der Nacht"
        deviceTimeZone="America/Chicago"
      />,
    );
    expect(screen.queryByText(/^Bei dir/)).toBeNull();
    expect(screen.getByText('Standort CDT')).toBeTruthy();
  });

  it('keine Linie „jetzt“ außerhalb des Fensters', () => {
    render(
      <NightTimeline
        fromUtc={FROM}
        toUtc={TO}
        timeZone="America/Chicago"
        nowUtc={TO + 3600}
        lanes={lanes}
        label="Zeitleiste der Nacht"
        deviceTimeZone="America/Chicago"
      />,
    );
    expect(document.querySelector('[title^="jetzt"]')).toBeNull();
  });
});
