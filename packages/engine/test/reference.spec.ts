/**
 * Referenztests gegen astropy (TK 9.2, AP-08b). Fixtures aus `tools/reference` (CI-Job `reference.yml`).
 * Toleranzen: Dämmerung/Sonnenauf-/-untergang ±60 s (streifende Nächte ausgenommen), Mondauf-/-untergang
 * ±30 s plus |h_app| ≤ 0,01° zur berechneten Zeit, Mondhöhe ±0,05°, Mond RA/Dec ±0,1° (Winkelabstand),
 * Beleuchtung ±1 %, Zielhöhe ±0,05° (scheinbar nur ab 15°), Meridiandurchgang ±30 s.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  meridianTransitUtc,
  moonAt,
  moonEvents,
  nightTimes,
  separationDeg,
  sunAnchors,
  sunCrossings,
  targetAt,
  type TimeZoneTransition,
} from '../src/index';

interface SunEvent {
  h0: number;
  down: number | null;
  up: number | null;
  grazing: boolean;
}
interface NightFixture {
  site: string;
  night: string;
  noonStartUtc: number;
  noonEndUtc: number;
  sun: Record<'sun' | 'civil' | 'nautical' | 'astronomical' | 'flats8' | 'flats2', SunEvent>;
  moonEvents: { type: 'rise' | 'set'; t: number }[];
  moon: { t: number; raTopoDeg: number; decTopoDeg: number; altAppDeg: number; illumPct: number }[];
}
interface SiteFixture {
  id: string;
  lat: number;
  lon: number;
  timeZoneTransitions: TimeZoneTransition[];
}
interface TargetFixture {
  site: string;
  night: string;
  target: string;
  raJ2000Deg: number;
  decJ2000Deg: number;
  noonStartUtc: number;
  noonEndUtc: number;
  meridianTransitUtc: number | null;
  samples: { t: number; altGeoDeg: number; azDeg: number; altAppDeg: number }[];
}

const load = <T>(name: string): T =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'),
  ) as T;

const sunMoon = load<{ sites: SiteFixture[]; nights: NightFixture[] }>('sun_moon.json');
const targets = load<{ targets: TargetFixture[] }>('targets.json');
const sites = new Map(sunMoon.sites.map((s) => [s.id, s]));
const siteOf = (id: string) => {
  const s = sites.get(id);
  if (!s) throw new Error(`Standort ${id} fehlt`);
  return s;
};

const within = (actual: number | null, expected: number | null, tol: number, label: string) => {
  if (expected === null) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  expect(Math.abs((actual ?? 0) - expected), label).toBeLessThanOrEqual(tol);
};

// Toleranzen seit der Astronomie-Prüfung 28.09.2026 nahe an der erreichten Genauigkeit (vorher 10–40× lockerer;
// ein fehlendes ΔT – 0,0105° am Mond – wäre durchgerutscht). TK 9.2 nennt die fachlichen Obergrenzen.
describe('Sonne: Dämmerung, Auf-/Untergang, Himmelsflats (±15 s)', () => {
  it.each(sunMoon.nights.map((n) => [`${n.site} ${n.night}`, n] as const))('%s', (_label, fx) => {
    const s = siteOf(fx.site);
    const site = { latDeg: s.lat, lonDeg: s.lon };
    const n = nightTimes({ site, night: fx.night, timeZoneTransitions: s.timeZoneTransitions });
    expect(n.noonStartUtc).toBe(fx.noonStartUtc);
    expect(n.noonEndUtc).toBe(fx.noonEndUtc);
    const pairs = [
      ['sun', n.sunset],
      ['civil', n.twilight.civil],
      ['nautical', n.twilight.nautical],
      ['astronomical', n.twilight.astronomical],
    ] as const;
    for (const [key, crossing] of pairs) {
      const ref = fx.sun[key];
      if (ref.grazing) continue; // streifend: von den Referenztests ausgenommen (night.md §2)
      within(crossing.startUtc, ref.down, 15, `${key} Abwärts`);
      within(crossing.endUtc, ref.up, 15, `${key} Aufwärts`);
    }
    const anchors = sunAnchors(site, n.noonStartUtc, n.noonEndUtc);
    for (const key of ['flats8', 'flats2'] as const) {
      const ref = fx.sun[key];
      if (ref.grazing) continue;
      within(sunCrossings(site, anchors, ref.h0).endUtc, ref.up, 15, `${key} Aufwärts`);
    }
  });
});

describe('Mond: Auf-/Untergang (±5 s), Höhe (±0,01°), Ort (±0,01°), Beleuchtung (±0,05 %)', () => {
  it.each(sunMoon.nights.map((n) => [`${n.site} ${n.night}`, n] as const))('%s', (_label, fx) => {
    const s = siteOf(fx.site);
    const site = { latDeg: s.lat, lonDeg: s.lon };
    const events = moonEvents(site, fx.noonStartUtc, fx.noonEndUtc);
    // Randfälle an den Fenstergrenzen (±60 s) können einseitig fehlen
    const inner = (t: number) => t > fx.noonStartUtc + 60 && t < fx.noonEndUtc - 60;
    const ours = events.filter((e) => inner(e.atUtc));
    const ref = fx.moonEvents.filter((e) => inner(e.t));
    expect(ours.map((e) => e.type)).toEqual(ref.map((e) => e.type));
    ours.forEach((e, i) => {
      expect(
        Math.abs(e.atUtc - (ref[i]?.t ?? 0)),
        `${e.type} ${String(e.atUtc)}`,
      ).toBeLessThanOrEqual(5);
      expect(Math.abs(moonAt(e.atUtc, site).altDeg)).toBeLessThanOrEqual(0.01);
    });
    for (const m of fx.moon) {
      const ours2 = moonAt(m.t, site);
      expect(
        separationDeg(ours2.raDeg, ours2.decDeg, m.raTopoDeg, m.decTopoDeg),
      ).toBeLessThanOrEqual(0.01);
      expect(Math.abs(ours2.altDeg - m.altAppDeg)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(ours2.illumPct - m.illumPct)).toBeLessThanOrEqual(0.05);
    }
  });
});

describe('Ziele: Höhe und Azimut (±0,01°), Meridiandurchgang (±3 s)', () => {
  it.each(targets.targets.map((t) => [`${t.site} ${t.night} ${t.target}`, t] as const))(
    '%s',
    (_label, fx) => {
      const s = siteOf(fx.site);
      const site = { latDeg: s.lat, lonDeg: s.lon };
      const target = { raJ2000Deg: fx.raJ2000Deg, decJ2000Deg: fx.decJ2000Deg };
      for (const sample of fx.samples) {
        const ours = targetAt(target, sample.t, site);
        expect(Math.abs(ours.altGeometricDeg - sample.altGeoDeg)).toBeLessThanOrEqual(0.01);
        // Azimut auf dem Himmel gemessen (× cos h), sonst wird er nahe dem Zenit beliebig empfindlich.
        const dAz = ((ours.azDeg - sample.azDeg + 540) % 360) - 180;
        expect(Math.abs(dAz * Math.cos((sample.altGeoDeg * Math.PI) / 180))).toBeLessThanOrEqual(
          0.01,
        );
        // Die Referenz rechnet die scheinbare Höhe seit 28.09.2026 mit Saemundsson wie die Engine (AST-D30) –
        // damit gilt der Vergleich bis zum Horizont, nicht erst ab 15°.
        if (sample.altGeoDeg >= -1)
          expect(Math.abs(ours.altDeg - sample.altAppDeg)).toBeLessThanOrEqual(0.01);
      }
      within(
        meridianTransitUtc(target, site, fx.noonStartUtc, fx.noonEndUtc),
        fx.meridianTransitUtc,
        3,
        'tM',
      );
    },
  );
});
