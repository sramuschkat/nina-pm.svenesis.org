/**
 * Zufällige `PlanInput` mit festem Seed für den Paritätstest Node ↔ Jint (AP-08c; canonical-json.md:
 * „≥ 500 zufällige `PlanInput` → gleicher `inputHash`/`outputHash` in Node und Jint“; rules/engine.md Nr. 7).
 * Rein und deterministisch über `seededRandom` (xorshift32), damit Jint dieselben Eingaben aus dem Bundle
 * erzeugt: Die Erwartungsdatei enthält nur Seed und Hashes, ein abweichender Generator fällt am `inputHash` auf.
 *
 * Abgedeckt: sechs Standorte (Nord/Süd, polarnah, feste und wechselnde Zeitzonen), Nächte über das Jahr
 * inklusive Zeitumstellung, Einzelziele und Mosaike (Panel-Einheiten oder Projekt-Einheit), Mondprofile,
 * Filterzuordnung (NT-E1), Transitfenster, Flip, Rotator/Kamerawinkel, beide Strategien, Bonus, Dither,
 * Filterwechsel, Himmels-Flats und Neuplanung mit `tonight`.
 */
import { daysFromKey, keyFromDays } from '../astro/time';
import { nightBounds, type TimeZoneTransition } from '../astro/timezone';
import { SORT_CHAIN_KEYS, type SortChainKey } from './grid';
import { seededRandom } from './grid-random';
import { isoFromUnix, unixFromIso } from './iso';
import type {
  PlanInput,
  PlanLine,
  PlanMoonProfile,
  PlanPanel,
  PlanProject,
  PlanTonight,
  TwilightName,
} from './plan-input';

interface Site {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly elevationM: number;
  readonly transitions: readonly { readonly atUtc: string; readonly utcOffsetMinutes: number }[];
}

/** Standorte mit Übergangstabellen für 2026 (erster Eintrag = Offset vor Tabellenbeginn). */
const SITES: readonly Site[] = [
  // Starfront, Texas (America/Chicago)
  {
    latitudeDeg: 31.5471,
    longitudeDeg: -99.3823,
    elevationM: 400,
    transitions: [
      { atUtc: '2025-11-02T07:00:00Z', utcOffsetMinutes: -360 },
      { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
      { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
    ],
  },
  // Hannover (Europe/Berlin)
  {
    latitudeDeg: 52.3705,
    longitudeDeg: 9.7332,
    elevationM: 55,
    transitions: [
      { atUtc: '2025-10-26T01:00:00Z', utcOffsetMinutes: 60 },
      { atUtc: '2026-03-29T01:00:00Z', utcOffsetMinutes: 120 },
      { atUtc: '2026-10-25T01:00:00Z', utcOffsetMinutes: 60 },
    ],
  },
  // Tromsø (Europe/Oslo): Mitternachtssonne und Polarnacht
  {
    latitudeDeg: 69.6492,
    longitudeDeg: 18.9553,
    elevationM: 10,
    transitions: [
      { atUtc: '2025-10-26T01:00:00Z', utcOffsetMinutes: 60 },
      { atUtc: '2026-03-29T01:00:00Z', utcOffsetMinutes: 120 },
      { atUtc: '2026-10-25T01:00:00Z', utcOffsetMinutes: 60 },
    ],
  },
  // Siding Spring (Australia/Sydney), Südhalbkugel mit Sommerzeit im Südsommer
  {
    latitudeDeg: -31.2733,
    longitudeDeg: 149.0617,
    elevationM: 1165,
    transitions: [
      { atUtc: '2025-10-04T16:00:00Z', utcOffsetMinutes: 660 },
      { atUtc: '2026-04-04T16:00:00Z', utcOffsetMinutes: 600 },
      { atUtc: '2026-10-03T16:00:00Z', utcOffsetMinutes: 660 },
    ],
  },
  // Atacama (America/Santiago)
  {
    latitudeDeg: -24.6272,
    longitudeDeg: -70.4042,
    elevationM: 2635,
    transitions: [
      { atUtc: '2025-09-07T04:00:00Z', utcOffsetMinutes: -180 },
      { atUtc: '2026-04-05T03:00:00Z', utcOffsetMinutes: -240 },
      { atUtc: '2026-09-06T04:00:00Z', utcOffsetMinutes: -180 },
    ],
  },
  // Mauna Kea (Pacific/Honolulu), feste Zone
  {
    latitudeDeg: 19.8207,
    longitudeDeg: -155.4681,
    elevationM: 4205,
    transitions: [{ atUtc: '2000-01-01T00:00:00Z', utcOffsetMinutes: -600 }],
  },
];

const FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'] as const;
const READOUT = ['High Gain Mode', 'Low Noise', 'Extended Fullwell'] as const;
const EXPOSURES = [30, 60, 120, 180, 300, 600] as const;
const TWILIGHTS: readonly TwilightName[] = ['civil', 'nautical', 'astronomical'];
const FIRST_DAY = daysFromKey('2026-01-05');
const LAST_DAY = daysFromKey('2026-12-20');

function rngFor(seed: number) {
  const next = seededRandom(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    int,
    /** Gleichverteilt in [lo, hi] mit `places` Nachkommastellen (ganzzahlig erzeugt, dann geteilt). */
    num: (lo: number, hi: number, places: number) => {
      const f =
        places === 0 ? 1 : places === 1 ? 10 : places === 2 ? 100 : places === 3 ? 1e3 : 1e4;
      return int(lo * f, hi * f) / f;
    },
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[int(0, list.length - 1)] as T,
  };
}

/** Kanonische UUID-Form aus Seed und laufender Nummer (nur Hex-Ziffern). */
function idFactory(seed: number) {
  let n = 0;
  const hex = (v: number, len: number) => {
    let s = '';
    let x = v;
    for (let i = 0; i < len; i++) {
      s = '0123456789abcdef'[x % 16] + s;
      x = Math.floor(x / 16);
    }
    return s;
  };
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${hex(seed % 16777216, 6)}${hex(n, 6)}`;
  };
}

/** Zufällige, gültige `PlanInput` (mode `productive`) zum Seed. */
export function randomPlanInput(seed: number): PlanInput {
  const r = rngFor(seed);
  const nextId = idFactory(seed);
  const site = r.pick(SITES);
  const night = keyFromDays(r.int(FIRST_DAY, LAST_DAY));
  const transitions: TimeZoneTransition[] = site.transitions.map((t) => ({
    atUtc: unixFromIso(t.atUtc),
    utcOffsetMinutes: t.utcOffsetMinutes,
  }));
  const { noonStartUtc } = nightBounds(night, transitions);

  const moonProfiles: PlanMoonProfile[] = Array.from({ length: r.int(0, 3) }, () => {
    const mustBeDown = r.chance(0.15);
    return {
      id: nextId(),
      separationDeg: r.int(10, 120),
      widthDays: r.int(1, 14),
      relaxScale: r.num(0, 2, 1),
      moonMinAltDeg: r.int(-10, 10),
      moonMaxAltDeg: r.int(20, 90),
      maxIlluminationPct: mustBeDown ? 0 : r.int(10, 100),
      moonMustBeDown: mustBeDown,
    };
  });

  const hasFilterWheel = r.chance(0.85);
  const line = (): PlanLine => {
    const planned = r.int(1, 60);
    const filter = r.pick(FILTERS);
    return {
      id: nextId(),
      filter,
      ninaFilterName: r.chance(0.1) ? null : `${filter} 36mm`,
      exposureS: r.pick(EXPOSURES),
      planned,
      accepted: r.int(0, planned),
      pending: r.int(0, 2),
      enabled: r.chance(0.9),
      moonProfileId:
        moonProfiles.length > 0 && r.chance(0.6) ? r.pick(moonProfiles.map((p) => p.id)) : null,
      gain: r.chance(0.8) ? r.int(0, 300) : null,
      offset: r.chance(0.8) ? r.int(0, 60) : null,
      binning: r.chance(0.8) ? 1 : 2,
      readoutMode: r.chance(0.5) ? r.pick(READOUT) : null,
    };
  };

  const mosaicIndependent = r.chance(0.5);
  const projects: PlanProject[] = Array.from({ length: r.int(1, 6) }, (_, k) => {
    const raDeg = r.num(0, 359.9999, 4);
    const decDeg = r.num(-85, 85, 4);
    const rotationDeg = r.num(0, 359.9, 1);
    const cols = r.chance(0.3) ? r.int(1, 2) : 1;
    const rows = cols > 1 || r.chance(0.2) ? r.int(1, 2) : 1;
    const panels: PlanPanel[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        panels.push({
          id: nextId(),
          index: panels.length,
          raDeg: (raDeg + (i - (cols - 1) / 2) * 1.2 + 360) % 360,
          decDeg: Math.max(-89, Math.min(89, decDeg + (j - (rows - 1) / 2) * 0.9)),
          rotationDeg,
          lines: Array.from({ length: r.int(1, 4) }, line),
        });
    const lines = panels.flatMap((p) => p.lines);
    const transitStart = noonStartUtc + r.int(6 * 3600, 16 * 3600);
    const transit =
      r.chance(0.1) && lines.length > 0
        ? {
            observationId: nextId(),
            lineId: r.pick(lines.map((l) => l.id)),
            windowStartUtc: isoFromUnix(transitStart),
            windowEndUtc: isoFromUnix(transitStart + r.int(3600, 3 * 3600)),
            lockedAtUtc: isoFromUnix(transitStart - 3600),
          }
        : null;
    const offsetDays = (lo: number, hi: number) => keyFromDays(daysFromKey(night) + r.int(lo, hi));
    return {
      id: nextId(),
      raDeg,
      decDeg,
      rotationDeg,
      priority: r.chance(0.3) ? 0 : k + 1,
      minAltitudeDeg: r.int(10, 45),
      minTimeOnTargetH: r.num(0, 3, 1),
      twilight: r.pick(TWILIGHTS),
      startDate: r.chance(0.2) ? offsetDays(-30, 5) : null,
      dueDate: r.chance(0.2) ? offsetDays(-5, 60) : null,
      panels,
      transit,
    };
  });

  const hasRotator = r.chance(0.5);
  const sortChain: SortChainKey[] = [];
  for (const key of SORT_CHAIN_KEYS) if (r.chance(0.5)) sortChain.push(key);
  // Reihenfolge mischen (Fisher-Yates mit dem Seed-Generator).
  for (let i = sortChain.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    const a = sortChain[i] as SortChainKey;
    sortChain[i] = sortChain[j] as SortChainKey;
    sortChain[j] = a;
  }

  const replan = r.chance(0.25);
  const startAt = noonStartUtc + r.int(7 * 3600, 15 * 3600);
  const unitsOf = (p: PlanProject) =>
    mosaicIndependent && p.panels.length > 1
      ? p.panels.map((panel) => `${p.id}/p${String(panel.index)}`)
      : [p.id];
  const firstUnit = unitsOf(projects[0] as PlanProject)[0] as string;
  const tonight: PlanTonight | null = replan
    ? {
        pastBlocks: r.chance(0.5)
          ? [
              {
                unitId: firstUnit,
                fromUtc: isoFromUnix(startAt - 2 * 3600),
                toUtc: isoFromUnix(startAt - 3600),
              },
            ]
          : [],
        exposedSecByUnit: r.chance(0.5) ? { [firstUnit]: r.int(0, 3600) } : {},
        lastAutofocusUtc: r.chance(0.5) ? isoFromUnix(startAt - r.int(600, 7200)) : null,
        filterCycle: [],
        flipDoneByPanel: r.chance(0.3) ? { [firstUnit]: true } : {},
        currentUnitId: r.chance(0.5) ? firstUnit : null,
      }
    : null;

  return {
    mode: 'productive',
    night,
    site: {
      latitudeDeg: site.latitudeDeg,
      longitudeDeg: site.longitudeDeg,
      elevationM: site.elevationM,
    },
    tzdataVersion: '2026a',
    timeZoneTransitions: site.transitions,
    rig: {
      id: nextId(),
      hasRotator,
      defaultRotationDeg: hasRotator ? null : r.chance(0.8) ? r.num(0, 359.9, 1) : null,
      rotationToleranceDeg: r.int(1, 10),
      hasFilterWheel,
    },
    scheduler: {
      strategy: r.chance(0.7) ? 'proportional' : 'manual_priority',
      sortChain,
      bonusEnabled: r.chance(0.4),
      overshootPct: r.pick([0, 10, 25]),
      mosaicPanelsIndependent: mosaicIndependent,
      ditherEnabled: r.chance(0.7),
      ditherEvery: r.int(1, 5),
      filterSwitchEnabled: r.chance(0.4),
      filterSwitchEvery: r.int(1, 20),
      filterSwitchTolerancePct: r.pick([0, 25, 50]),
      flatsSource: r.chance(0.7) ? 'panel' : 'sky',
      flip: {
        enabled: r.chance(0.6),
        afterMin: r.int(0, 10),
        maxAfterMin: r.int(10, 30),
        pauseBeforeMin: r.int(0, 5),
        durationS: r.int(60, 300),
      },
      overhead: {
        slewCenterS: r.int(30, 180),
        filterChangeS: r.int(0, 30),
        ditherSettleS: r.int(0, 30),
        afEveryMin: r.chance(0.5) ? r.int(30, 120) : 0,
        afDurationS: r.int(60, 240),
        downloadS: r.int(0, 10),
      },
    },
    moonProfiles,
    projects,
    startAtUtc: replan ? isoFromUnix(startAt) : null,
    tonight,
  };
}
