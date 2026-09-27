// @vitest-environment jsdom
/**
 * „Ereignisse der Nacht“: Gruppen mit Anzahl und erster Zeile, Zeiten in Standortzeit, leere Gruppen entfallen,
 * Hinweis bei veralteten Bahndaten statt Überflügen, Leertext ohne Ereignisse; axe.
 */
import { sky } from '@nina-pm/engine';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { NightEvents, type NightEventsProps } from './NightEvents';

const STARFRONT = { latDeg: 31.5471, lonDeg: -99.3823 };
const at = (s: string) => Date.parse(s) / 1000;
const FROM = at('2026-09-27T23:00:00Z');
const TO = at('2026-09-28T14:00:00Z');
// Stand 15.09.2026 (Vorlage `data/sky-events.json`).
const ISS: sky.SatelliteTle = {
  id: 25544,
  name: 'ISS',
  std: -1.8,
  tle1: '1 25544U 98067A   26257.85283187  .00006182  00000+0  11980-3 0  9992',
  tle2: '2 25544  51.6309 216.3169 0004922 141.7352 218.3986 15.49117649585657',
};

function props(over: Partial<NightEventsProps> = {}): NightEventsProps {
  const samples = sky.eventSamples(STARFRONT, FROM, TO);
  const galactic = sky.galacticCentre(samples, STARFRONT);
  return {
    timeZone: 'America/Chicago',
    nightUtc: FROM,
    passes: sky.satellitePassesForNight([ISS], FROM, TO, { ...STARFRONT, elevationM: 400 }),
    showers: sky.showersTonight(samples, STARFRONT).map((s) => ({
      tonight: s,
      rate: sky.meteorRate(s.shower, samples, STARFRONT, 6),
    })),
    moonIllumPct: 97,
    limitingMag: 6,
    galactic,
    season: galactic ? sky.galacticSeason(galactic.monthsHours) : null,
    eclipses: sky.nextEclipses(STARFRONT, at('2026-09-27T17:00:00Z')),
    ...over,
  };
}

describe('NightEvents', () => {
  it('Starfront 27./28.09.2026 wie die Vorlage: ISS, Südliche Tauriden, Sgr A*, sechs Finsternisse; axe', async () => {
    render(<NightEvents {...props()} />);
    const sats = screen.getByText('Überflüge von Raumstationen und Hubble').closest('summary');
    expect(sats?.textContent).toContain('ISS · 21:23–21:25');
    const showers = screen.getByText('Meteorströme').closest('summary');
    expect(showers?.textContent).toContain('Südliche Tauriden · in 39 Tagen');
    const gc = screen.getByText('Zentrum der Milchstraße').closest('summary');
    expect(gc?.textContent).toContain('Sgr A* (Schütze) · 20:50–22:30');
    const ecl = screen.getByText('Die nächsten Finsternisse am Standort').closest('summary');
    expect(ecl?.textContent).toMatch(
      /6Halbschatten-Mondfinsternis · Sa\., 20\.02\.2027, 17:13 CST/,
    );
    const table = screen.getByRole('table', { name: 'Überflüge von Raumstationen und Hubble' });
    const row = within(table).getAllByRole('row')[1];
    expect(row?.textContent).toContain('verschwindet im Erdschatten');
    expect(row?.textContent).toMatch(/bis −0,6 mag/);
    expect(screen.getByText('Zeiten in Standortzeit (CDT).')).toBeTruthy();
    await expectNoSeriousA11y();
  });

  it('veraltete Bahndaten: Hinweis statt Überflüge', () => {
    const late = at('2026-10-20T23:00:00Z');
    render(
      <NightEvents
        {...props({
          passes: sky.satellitePassesForNight([ISS], late, late + 15 * 3600, STARFRONT),
        })}
      />,
    );
    expect(screen.getByText(/keine verlässlichen Bahndaten: Stand .*14\.09\.2026/)).toBeTruthy();
  });

  it('ohne Ereignisse: Leertext', () => {
    render(
      <NightEvents
        {...props({
          passes: { passes: [], stale: [], newestEpochUtc: null, allStale: false },
          showers: [],
          galactic: null,
          season: null,
          eclipses: [],
        })}
      />,
    );
    expect(screen.getByText('In dieser Nacht gibt es keine dieser Ereignisse.')).toBeTruthy();
  });
});
