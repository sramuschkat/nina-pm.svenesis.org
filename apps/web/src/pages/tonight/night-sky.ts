/**
 * Himmel einer Nacht am Standort des Rigs (Heute Nacht): Fenster (eine Stunde vor bis eine Stunde nach dem
 * Nachtfenster, volle Stunden), Mond und Planeten, Meteorströme, Milchstraßenzentrum, Finsternisse und die
 * Überflüge aus den Bahndaten – einmal gerechnet und von Zeitleiste, Kennzahlen, „Mond & Planeten“ und
 * „Ereignisse der Nacht“ geteilt. Alles aus der Engine (`sky`).
 */
import { sky } from '@nina-pm/engine';
import { useMemo } from 'react';
import type { SiteView, TonightRig } from '../../api/client';
import { useSkySatellites } from './sky-satellites';

/** Grenzgröße der Schätzung „Erwartet“ (Vorlage: Standard 6,0 mag). */
export const LIMITING_MAG = 6;

export interface NightSky {
  readonly geo: { readonly latDeg: number; readonly lonDeg: number };
  readonly window: { readonly from: number; readonly to: number } | null;
  readonly bodies: readonly sky.NightBodiesRow[];
  readonly showers: readonly { tonight: sky.ShowerTonight; rate: sky.MeteorRate | null }[];
  readonly moonIllumPct: number;
  readonly galactic: sky.GalacticCentre | null;
  readonly season: sky.GalacticSeason | null;
  readonly eclipses: readonly sky.SiteEclipse[];
  /** `null`, solange die Bahndaten laden. */
  readonly passes: sky.NightPasses | null;
  /** Zeitpunkt des Abrufs der Bahndaten (ms), `null` ohne Daten. */
  readonly satellitesGenerated: number | null;
}

export function eventWindow(rig: TonightRig): { from: number; to: number } | null {
  if (!rig.nightWindow) return null;
  const from = Date.parse(rig.nightWindow.startUtc) / 1000;
  const to = Date.parse(rig.nightWindow.endUtc) / 1000;
  return {
    from: Math.floor((from - 3600) / 3600) * 3600,
    to: Math.ceil((to + 3600) / 3600) * 3600,
  };
}

export function useNightSky(site: SiteView, rig: TonightRig): NightSky {
  const satellites = useSkySatellites();
  const geo = useMemo(
    () => ({ latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg }),
    [site.latitudeDeg, site.longitudeDeg],
  );
  const win = eventWindow(rig);
  const from = win?.from ?? null;
  const to = win?.to ?? null;
  const night = useMemo(() => {
    if (from === null || to === null) return null;
    const samples = sky.eventSamples(geo, from, to);
    const galactic = sky.galacticCentre(samples, geo);
    const mid = samples[Math.floor(samples.length / 2)];
    return {
      bodies: sky.nightBodySamples(geo, from, to),
      showers: sky.showersTonight(samples, geo).map((s) => ({
        tonight: s,
        rate: sky.meteorRate(s.shower, samples, geo, LIMITING_MAG),
      })),
      moonIllumPct: mid?.moonIllumPct ?? 0,
      galactic,
      season: galactic ? sky.galacticSeason(galactic.monthsHours) : null,
      eclipses: sky.nextEclipses(geo, from),
    };
  }, [geo, from, to]);
  const passes = useMemo(() => {
    if (!satellites.data || from === null || to === null) return null;
    return sky.satellitePassesForNight(satellites.data.satellites, from, to, {
      ...geo,
      elevationM: site.elevationM,
    });
  }, [satellites.data, geo, site.elevationM, from, to]);
  return {
    geo,
    window: from !== null && to !== null ? { from, to } : null,
    bodies: night?.bodies ?? [],
    showers: night?.showers ?? [],
    moonIllumPct: night?.moonIllumPct ?? 0,
    galactic: night?.galactic ?? null,
    season: night?.season ?? null,
    eclipses: night?.eclipses ?? [],
    passes,
    satellitesGenerated: satellites.data ? Date.parse(satellites.data.generated) : null,
  };
}
