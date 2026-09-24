/**
 * Saisonbeginn/-ende (FK 8.1, AP-10) gegen die astropy-Referenz `season.json` (tools/reference/
 * gen_season.py): Status gleich, Saisongrenzen ±1 Nacht, nutzbare Zeit je Nacht ±2 Slots.
 */
import { describe, expect, it } from 'vitest';
import { seasonWindow, type TimeZoneTransition, type TwilightLimit } from '../src/index';
import season from './fixtures/season.json';
import sunMoon from './fixtures/sun_moon.json';

interface Case {
  id: string;
  site: string;
  twilight: TwilightLimit;
  minAltDeg: number;
  minTimeSec: number;
  raJ2000Deg: number;
  decJ2000Deg: number;
  status: 'in_season' | 'out_of_season' | 'never';
  seasonStart: string | null;
  seasonEnd: string | null;
  nights: { night: string; usableSec: number; longestRunSec: number }[];
}
interface Site {
  id: string;
  lat: number;
  lon: number;
  timeZoneTransitions: TimeZoneTransition[];
}

const sites = (sunMoon as { sites: Site[] }).sites;
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

describe('Saison gegen astropy (season.json)', () => {
  for (const c of (season as { cases: Case[] }).cases) {
    it(`${c.id}: ${c.status}, Beginn ${String(c.seasonStart)}, Ende ${String(c.seasonEnd)} (±1 Nacht)`, () => {
      const site = sites.find((s) => s.id === c.site);
      if (!site) throw new Error(`Standort ${c.site} fehlt`);
      const r = seasonWindow({
        site: { latDeg: site.lat, lonDeg: site.lon },
        nights: c.nights.map((n) => n.night),
        timeZoneTransitions: site.timeZoneTransitions,
        target: { raJ2000Deg: c.raJ2000Deg, decJ2000Deg: c.decJ2000Deg },
        twilight: c.twilight,
        minAltDeg: c.minAltDeg,
        minTimeSec: c.minTimeSec,
      });
      expect(r.status).toBe(c.status);
      for (const [ours, ref] of [
        [r.seasonStart, c.seasonStart],
        [r.seasonEnd, c.seasonEnd],
      ] as const) {
        if (ref === null) expect(ours).toBeNull();
        else expect(dayDiff(ours ?? '1970-01-01', ref)).toBeLessThanOrEqual(1);
      }
      r.nights.forEach((n, i) => {
        const ref = c.nights[i];
        expect(n.night).toBe(ref?.night);
        expect(Math.abs(n.longestRunSec - (ref?.longestRunSec ?? 0)), n.night).toBeLessThanOrEqual(
          600,
        );
        expect(Math.abs(n.usableSec - (ref?.usableSec ?? 0)), n.night).toBeLessThanOrEqual(600);
      });
    });
  }

  it('zirkumpolar und nie pausierend: Polaris in Hannover (nautisch, 30°) hat kein Saisonende', () => {
    const hannover = sites.find((s) => s.id === 'hannover');
    if (!hannover) throw new Error('Hannover fehlt');
    const nights = Array.from({ length: 365 }, (_, i) =>
      new Date(Date.UTC(2026, 8, 17 + i)).toISOString().slice(0, 10),
    );
    const r = seasonWindow({
      site: { latDeg: hannover.lat, lonDeg: hannover.lon },
      nights,
      timeZoneTransitions: hannover.timeZoneTransitions,
      target: { raJ2000Deg: 37.9546, decJ2000Deg: 89.2641 },
      twilight: 'nautical',
      minAltDeg: 30,
      minTimeSec: 3600,
    });
    expect([r.status, r.seasonStart, r.seasonEnd]).toEqual(['in_season', null, null]);
  });

  it('nie sichtbar: M8 in Hannover bei 30° → never, ohne Rasterlauf', () => {
    const hannover = sites.find((s) => s.id === 'hannover');
    if (!hannover) throw new Error('Hannover fehlt');
    const r = seasonWindow({
      site: { latDeg: hannover.lat, lonDeg: hannover.lon },
      nights: ['2026-09-17', '2026-09-18'],
      timeZoneTransitions: hannover.timeZoneTransitions,
      target: { raJ2000Deg: 270.9042, decJ2000Deg: -24.3867 },
      twilight: 'astronomical',
      minAltDeg: 30,
      minTimeSec: 3600,
    });
    expect([r.status, r.usableSecToSeasonEnd]).toEqual(['never', 0]);
  });
});
