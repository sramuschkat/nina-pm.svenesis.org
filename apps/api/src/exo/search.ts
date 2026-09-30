/**
 * Transitsuche S-22 (AP-42, FA-EXO-01…14): Kataloge zusammenführen (ExoClock → NASA → TOI, FA-EXO-03), je Planet
 * die Transits der Nacht mit der Engine rechnen (`predictTransits`, transit.md §2) und je Transit Mond, benötigte
 * Öffnung (FA-EXO-07) und Filter des Rigs (FA-EXO-08, NT-41) ergänzen. Der Katalog liegt höchstens 10 min im
 * Speicher der `api` (ändert sich nur über `catalog_refresh`).
 */
import type { ExoCatalog, ExoCatalogRow } from '@nina-pm/db';
import {
  apertureFit,
  createTransitSkyCache,
  estimatedApertureMm,
  jdeFromUnix,
  mapBandToRig,
  moonAt,
  predictTransits,
  recommendedBand,
  separationDeg,
  sizeClass,
  spectralClass,
  targetApparent,
  type ExoTimeSystem,
  type RigFilter,
  type Site,
} from '@nina-pm/engine';
import type { ExoTransitView } from '@nina-pm/shared';
import { exposureFor, type ExposureRig } from './exposure';
import { mergeExoEntries } from './merge';

export type StoredExoEntry = ExoCatalogRow & {
  readonly id: string;
  readonly catalog: ExoCatalog;
  readonly fetchedAt: Date;
};

const CACHE_MS = 10 * 60_000;
let cache: { at: number; rows: StoredExoEntry[] } | null = null;

/** Alle Katalogzeilen, höchstens 10 min alt. */
export async function cachedExoCatalog(
  load: () => Promise<StoredExoEntry[]>,
  now = Date.now(),
): Promise<StoredExoEntry[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.rows;
  const rows = await load();
  cache = { at: now, rows };
  return rows;
}

export function clearExoCatalogCache(): void {
  cache = null;
}

export interface TransitSearch {
  readonly entries: readonly StoredExoEntry[];
  readonly catalogs: readonly ExoCatalog[];
  readonly site: Site;
  readonly nightStartUtc: number;
  readonly nightEndUtc: number;
  readonly minAltDeg: number;
  readonly twilightDeg: number;
  readonly k: 1 | 2 | 3;
  readonly rigApertureMm: number | null;
  /** Filter der bestätigten Filterradbelegung. */
  readonly rigFilters: readonly RigFilter[];
  /** Kennwerte für die Belichtungsempfehlung (transit.md §6). */
  readonly exposureRig: ExposureRig;
  readonly myProjects: ReadonlyMap<string, number>;
}

const iso = (unixSec: number) => new Date(unixSec * 1000).toISOString().replace('.000Z', 'Z');
const round = (x: number, digits: number) => Number(x.toFixed(digits));

function magnitude(e: StoredExoEntry): number | null {
  switch (e.magBandUsed) {
    case 'V':
      return e.magVJohnson;
    case 'R':
      return e.magRCousins;
    case 'G':
      return e.magGaiaG;
    case 'T':
      return e.magTess;
    default:
      return null;
  }
}

export function searchTransits(s: TransitSearch): ExoTransitView[] {
  const wanted = new Set<string>(s.catalogs);
  // APC (mehrdeutige TOI-Kandidaten) gehören nicht zur Suche (FA-EXO-02: PC, CP, KP); der Import verwirft sie seit
  // 30.09.2026, ältere Katalogstände können sie bis zum nächsten wöchentlichen Abruf noch enthalten.
  const merged = mergeExoEntries(
    s.entries.filter((e) => wanted.has(e.catalog) && e.disposition !== 'APC'),
  );
  const sky = createTransitSkyCache(s.site);
  const out: ExoTransitView[] = [];
  for (const e of merged) {
    if (e.durationH === null || !(e.durationH > 0)) continue;
    const events = predictTransits(
      {
        ephemeris: {
          t0BjdTdb: e.t0BjdTdb,
          periodD: e.periodD,
          t0SigmaD: e.t0SigmaD,
          periodSigmaD: e.periodSigmaD,
          durationH: e.durationH,
          ocMin: e.oMinusCMin,
          ocSigmaMin: null,
          timeSystem: e.timeSystemSource as ExoTimeSystem,
          raDeg: e.raDeg,
          decDeg: e.decDeg,
        },
        site: s.site,
        nightStartUtc: s.nightStartUtc,
        nightEndUtc: s.nightEndUtc,
        twilightDeg: s.twilightDeg,
        minAltDeg: s.minAltDeg,
        k: s.k,
      },
      sky,
    );
    if (events.length === 0) continue;
    // Kenndaten, die dem führenden Katalog fehlen, aus den nachrangigen (ExoClock kennt z. B. keinen Radius);
    // die Ephemeride bleibt immer die des führenden Eintrags (FA-EXO-03).
    const fill = <K extends 'planetRadiusRe' | 'distancePc' | 'teffK' | 'ticId'>(k: K) =>
      e[k] ?? e.others.map((o) => o[k]).find((v) => v !== null) ?? null;
    const radiusRe = fill('planetRadiusRe');
    const distancePc = fill('distancePc');
    const teffK = fill('teffK');
    const ticId = fill('ticId');
    const mag = magnitude(e);
    const required =
      e.minApertureMm ?? estimatedApertureMm(e.magRCousins ?? mag, e.depthMmag, e.durationH);
    const band = recommendedBand(teffK, mag);
    const choice = mapBandToRig(band, s.rigFilters);
    for (const ev of events) {
      const moon = moonAt(ev.tcUtc, s.site);
      const place = targetApparent(
        { raJ2000Deg: e.raDeg, decJ2000Deg: e.decDeg },
        jdeFromUnix(ev.tcUtc),
      );
      out.push({
        key: `${e.catalog}:${e.planet}:${String(ev.n)}`,
        planet: e.planet,
        star: e.star,
        catalog: e.catalog,
        alsoIn: [...e.alsoIn],
        disposition: e.disposition,
        priority: (e.exoclockPriority as ExoTransitView['priority']) ?? null,
        ticId,
        raDeg: e.raDeg,
        decDeg: e.decDeg,
        sizeClass: sizeClass(radiusRe),
        radiusRe,
        distancePc,
        teffK,
        spectralClass: spectralClass(teffK),
        mag,
        magBand: e.magBandUsed,
        depthMmag: e.depthMmag,
        depthEstimated: e.depthEstimated,
        durationH: e.durationH,
        durationEstimated: e.durationEstimated,
        periodD: e.periodD,
        rpOverRs: e.rpOverRs,
        aOverRs: e.aOverRs,
        inclinationDeg: e.inclinationDeg,
        ocMin: e.oMinusCMin,
        timeSystemSource: e.timeSystemSource,
        t0BjdTdb: e.t0BjdTdb,
        fetchedAt: e.fetchedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        transit: {
          n: ev.n,
          tcBjdTdb: ev.tcBjdTdb,
          tcUtc: iso(ev.tcUtc),
          ingressUtc: iso(ev.ingressUtc),
          egressUtc: iso(ev.egressUtc),
          windowStartUtc: iso(ev.windowStartUtc),
          windowEndUtc: iso(ev.windowEndUtc),
          sigmaS: ev.sigmaS,
          bufferS: ev.bufferS,
          baselineBeforeMin: ev.baselineBeforeMin,
          baselineAfterMin: ev.baselineAfterMin,
          ocAppliedMin: ev.ocAppliedMin,
          timeSystemUncertain: ev.timeSystemUncertain,
          ephemerisAge: ev.ephemerisAge,
          observable: ev.observable,
          usableFraction: ev.usableFraction,
          fullyObservable: ev.fullyObservable,
          startDark: ev.startDark,
          endDark: ev.endDark,
          startAboveMinAlt: ev.startAboveMinAlt,
          endAboveMinAlt: ev.endAboveMinAlt,
          baselineInTwilight: ev.baselineInTwilight,
          meridianUtc: ev.meridianUtc === null ? null : iso(ev.meridianUtc),
          meridianInWindow: ev.meridianInWindow,
          meridianNearTransit: ev.meridianNearTransit,
          altAtIngressDeg: round(ev.altAtIngressDeg, 2),
          altAtCenterDeg: round(ev.altAtCenterDeg, 2),
          altAtEgressDeg: round(ev.altAtEgressDeg, 2),
          moonSepDeg: round(separationDeg(moon.raDeg, moon.decDeg, place.raDeg, place.decDeg), 1),
          moonIllumPct: round(moon.illumPct, 0),
        },
        aperture:
          required === null
            ? null
            : {
                requiredMm: round(required, 0),
                estimated: e.minApertureMm === null,
                fit: s.rigApertureMm === null ? null : apertureFit(required, s.rigApertureMm),
              },
        filter: { band, choice },
        exposure: exposureFor(
          {
            band,
            choice,
            magR: e.magRCousins,
            magV: e.magVJohnson,
            mag,
            depthMmag: e.depthMmag,
            durationH: e.durationH,
            rpOverRs: e.rpOverRs,
            windowS: ev.windowEndUtc - ev.windowStartUtc,
            // Höchster Stand im Fenster: Kontakte, bei Kulmination im Fenster deren Höhe (ohne Refraktion).
            altMaxDeg: Math.max(
              ev.altAtIngressDeg,
              ev.altAtCenterDeg,
              ev.altAtEgressDeg,
              ev.meridianInWindow ? 90 - Math.abs(s.site.latDeg - e.decDeg) : -90,
            ),
            altMidDeg: ev.altAtCenterDeg,
          },
          s.exposureRig,
        ),
        myProjects: s.myProjects.get(e.planet) ?? 0,
      });
    }
  }
  // Standard nach Transitmitte (FA-EXO-06), dann Planet.
  return out.sort((a, b) =>
    a.transit.tcUtc < b.transit.tcUtc
      ? -1
      : a.transit.tcUtc > b.transit.tcUtc
        ? 1
        : a.planet < b.planet
          ? -1
          : 1,
  );
}
