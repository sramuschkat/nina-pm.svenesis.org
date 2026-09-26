/**
 * Auswertungs-Demo (Betrieb, `ops-cli demo-evaluation`): erzeugt für den **Test-Mandanten** realistische
 * Auswertungsdaten der letzten Nächte – Sessions je Rig mit Lights, Verwerfungen, Wetter-Schnappschuss,
 * Sitzungsprotokoll und Klarnacht-Statistik. Rein und **deterministisch** (eigener Zufallsgenerator aus
 * `seed`, keine Uhr): Die Lambda rechnet bei jedem Teilaufruf alle Nächte neu und schreibt nur ihren
 * Abschnitt – gleiche Eingabe ergibt gleiche IDs und Werte.
 *
 * Modell (Annahmen, nur Demo):
 * - Wetter je Standort als AR(1)-Folge (Wetterlagen über mehrere Nächte), Güte `q` 0…1; unter 0,3 bleibt die
 *   Sternwarte zu (gelegentlich manuell „nicht genutzt“ markiert), unter 0,5 bricht die Session wegen Wolken ab.
 * - Aufnahme ab Beginn der Dunkelheit in Blöcken je Filter, Overhead 12 s je Frame, bis zu zwei Projekte je
 *   Nacht; Verwerfen mit Wolken-Anteil abhängig von `q` sowie Guiding, Fokus und Satelliten.
 * - Geschichte je Projekt (`story`): `active`, `completed` (Soll erreicht), `on_hold` (ab Nacht 45 pausiert),
 *   `unfinished` (ab Nacht 70 Saison vorbei), `channel_gap` (ein Filter läuft deutlich voraus – Kanalbalance),
 *   `fixed` (vorhandenes Projekt: genau sein heutiger Stand – `planned` = akzeptierte Frames – in den letzten
 *   `DEMO_FIXED_WINDOW` Nächten, vor allen anderen; sein Status bleibt unverändert).
 */
import { USABLE_NIGHT_MIN_HOURS } from './contracts/session-log';
import type { ForecastSnapshot } from './session-log';

export type DemoStory = 'active' | 'completed' | 'on_hold' | 'unfinished' | 'channel_gap' | 'fixed';

export interface DemoLine {
  readonly id: string;
  readonly panelId: string;
  readonly filter: string;
  readonly exposureS: number;
  readonly planned: number;
  readonly gain: number | null;
  readonly offsetAdu: number | null;
  readonly binning: number;
  readonly readoutMode: string | null;
}

export interface DemoProject {
  readonly id: string;
  readonly name: string;
  readonly rigId: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly story: DemoStory;
  readonly lines: readonly DemoLine[];
}

export interface DemoRig {
  readonly id: string;
  readonly siteId: string;
  /** NINA-Instanz des Rigs für die Sessions (`null` = keine). */
  readonly ninaInstanceId: string | null;
}

/** Nacht eines Standorts (vom Server aus der Engine): Dunkelheit und Mond. */
export interface DemoNightMeta {
  readonly darkFromUtc: string | null;
  readonly darkToUtc: string | null;
  readonly moonIllumPct: number;
}

export interface DemoInput {
  /** Verlauf (Wetter, Auswahl, Verwerfen): gleiche Werte bei gleichem `seed`, unabhängig von den IDs. */
  readonly seed: string;
  /** Salz nur für die erzeugten IDs (z. B. Mandanten-ID), damit IDs mandantenweit eindeutig sind. */
  readonly idSalt: string;
  /** Nacht-Schlüssel aufsteigend (z. B. 90 Nächte bis gestern). */
  readonly nights: readonly string[];
  readonly rigs: readonly DemoRig[];
  readonly projects: readonly DemoProject[];
  readonly meta: (siteId: string, night: string) => DemoNightMeta;
}

export interface DemoSessionLog {
  readonly startTime: string;
  readonly endTime: string;
  readonly seeingArcsec: number;
  readonly transparencyPct: number;
  readonly sqm: number;
  readonly temperatureC: number;
  readonly humidityPct: number;
  readonly windKmh: number;
  readonly cloudsNote: string | null;
  readonly moonIlluminationPct: number;
  readonly valueSources: Readonly<Record<string, 'forecast' | 'nina' | 'manual' | 'auto'>>;
}

export interface DemoSession {
  readonly id: string;
  readonly rigId: string;
  readonly ninaInstanceId: string | null;
  readonly night: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly status: 'completed' | 'aborted';
  readonly reviewed: boolean;
  readonly forecastSnapshot: ForecastSnapshot;
  readonly log: DemoSessionLog | null;
}

export interface DemoCapture {
  readonly id: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly panelId: string;
  readonly lineId: string;
  readonly night: string;
  readonly capturedAt: string;
  readonly exposureMidUtc: string;
  readonly filter: string;
  readonly exposureS: number;
  readonly gain: number | null;
  readonly offsetAdu: number | null;
  readonly binning: number;
  readonly readoutMode: string | null;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly pierSide: 'east' | 'west';
  readonly rejected: boolean;
  readonly rejectReason: 'clouds' | 'guiding' | 'focus' | 'satellite' | null;
  readonly fileName: string;
  readonly metrics: {
    readonly hfr: number;
    readonly stars: number;
    readonly guidingRmsArcsec: number;
    readonly altitudeDeg: number;
    readonly sensorTempC: number;
    readonly setPointC: number;
  };
}

export interface DemoNightStat {
  readonly siteId: string;
  readonly night: string;
  readonly usable: boolean;
  readonly usableHours: number | null;
  readonly source: 'session' | 'manual';
}

export interface DemoNight {
  readonly night: string;
  readonly sessions: readonly DemoSession[];
  readonly captures: readonly DemoCapture[];
  readonly stats: readonly DemoNightStat[];
}

export interface DemoResult {
  readonly nights: readonly DemoNight[];
  /** Status je Demo-Projekt nach der Geschichte (für den Abschluss); `fixed` fehlt – sein Status bleibt. */
  readonly finalStatus: ReadonlyMap<string, 'active' | 'completed' | 'on_hold' | 'unfinished'>;
  readonly summary: {
    readonly sessions: number;
    readonly captures: number;
    readonly rejected: number;
    readonly usableNights: number;
    readonly nights: number;
  };
}

/** Pausiert ab dieser Nacht (Index) bzw. Saisonende für `unfinished`. */
export const DEMO_PAUSE_AT = 45;
export const DEMO_SEASON_END_AT = 70;
/** Sessions der letzten so vielen Nächte bleiben ungeprüft. */
export const DEMO_UNREVIEWED_NIGHTS = 7;
/** Vorhandene Projekte (`fixed`) erhalten ihren Stand in diesen letzten Nächten. */
export const DEMO_FIXED_WINDOW = 12;
const OVERHEAD_S = 12;
const VISIBLE_SHARE = 0.5;
const BLOCK_FRAMES = 12;
const NO_SESSION_BELOW = 0.3;
const ABORT_BELOW = 0.5;

/** FNV-1a → 32 Bit. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: deterministischer Zufall 0 ≤ x < 1. */
function prng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID (Version 4, RFC 9562) aus dem Zufallsstrom. */
function uuidFrom(rand: () => number): string {
  const b = Array.from({ length: 16 }, () => Math.floor(rand() * 256));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Deterministische UUID aus einem Text (Demo-Projekte, Panels, Zeilen). */
export function demoUuid(key: string): string {
  return uuidFrom(prng(key));
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Normalverteilt (Box-Muller). */
function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const ratingIndexOf = (q: number) =>
  q >= 0.85 ? 4 : q >= 0.65 ? 3 : q >= 0.45 ? 2 : q >= 0.25 ? 1 : 0;

/** Wetter-Güte je Standort und Nacht: AR(1), Mittel ≈ 0,6. */
function weatherSeries(seed: string, nights: number): number[] {
  const rand = prng(`${seed}:weather`);
  const out: number[] = [];
  let x = gauss(rand);
  for (let i = 0; i < nights; i += 1) {
    x = 0.55 * x + 0.85 * gauss(rand);
    out.push(clamp(1 / (1 + Math.exp(-(1.7 * x + 0.15))), 0, 1));
  }
  return out;
}

function eligible(p: DemoProject, index: number, nights: number): boolean {
  if (p.story === 'fixed') return index >= nights - DEMO_FIXED_WINDOW;
  if (p.story === 'on_hold') return index < DEMO_PAUSE_AT;
  if (p.story === 'unfinished') return index < DEMO_SEASON_END_AT;
  return true;
}

/** Gewicht je Filter: bei `channel_gap` läuft der erste Filter deutlich voraus. */
function lineWeight(p: DemoProject, line: DemoLine): number {
  return p.story === 'channel_gap' && p.lines[0]?.id === line.id ? 4 : 1;
}

export function demoEvaluation(input: DemoInput): DemoResult {
  const rand = prng(`${input.seed}:frames`);
  const ids = prng(`${input.seed}:${input.idSalt}:ids`);
  const accepted = new Map<string, number>();
  const weather = new Map(
    [...new Set(input.rigs.map((r) => r.siteId))].map((s, i) => [
      s,
      weatherSeries(`${input.seed}:site${String(i)}`, input.nights.length),
    ]),
  );
  const nights: DemoNight[] = [];
  let totalCaptures = 0;
  let totalRejected = 0;
  let totalSessions = 0;
  let usableNights = 0;

  input.nights.forEach((night, index) => {
    const sessions: DemoSession[] = [];
    const captures: DemoCapture[] = [];
    const hoursBySite = new Map<string, number>();
    const openSites = new Set<string>();
    for (const rig of input.rigs) {
      const meta = input.meta(rig.siteId, night);
      const base = weather.get(rig.siteId)?.[index] ?? 0;
      const q = clamp(base + 0.05 * gauss(rand), 0, 1);
      if (!meta.darkFromUtc || !meta.darkToUtc || q < NO_SESSION_BELOW) continue;
      openSites.add(rig.siteId);
      const darkFrom = Date.parse(meta.darkFromUtc);
      const darkTo = Date.parse(meta.darkToUtc);
      const darkS = (darkTo - darkFrom) / 1000;
      const aborted = q < ABORT_BELOW;
      const imagingS = aborted ? darkS * (q - 0.25) * 0.9 : darkS * (0.78 + 0.2 * q);
      const sessionId = uuidFrom(ids);
      const startedAt = darkFrom - 20 * 60_000;
      let t = darkFrom;
      const end = darkFrom + imagingS * 1000;
      const moon = meta.moonIllumPct;
      // Bis zu zwei Projekte je Nacht, nach Geschichte und etwas Zufall.
      // Vorhandene Projekte (`fixed`) zuerst, damit ihr heutiger Stand sicher erreicht wird.
      const candidates = input.projects
        .filter((p) => p.rigId === rig.id && eligible(p, index, input.nights.length))
        .filter((p) => p.lines.some((l) => (accepted.get(l.id) ?? 0) < l.planned))
        .sort(
          (a, b) =>
            Number(b.story === 'fixed') - Number(a.story === 'fixed') ||
            hash(`${night}:${a.name}`) - hash(`${night}:${b.name}`),
        )
        .slice(0, 2);
      let acceptedS = 0;
      let seq = 0;
      candidates.forEach((p) => {
        // Ein Ziel steht höchstens die halbe Nacht hoch genug (Sichtbarkeit).
        const until = Math.min(end, t + darkS * 1000 * VISIBLE_SHARE);
        while (t < until) {
          const open = p.lines.filter((l) => (accepted.get(l.id) ?? 0) < l.planned);
          if (open.length === 0) break;
          const line = [...open].sort(
            (a, b) =>
              (accepted.get(a.id) ?? 0) / a.planned / lineWeight(p, a) -
              (accepted.get(b.id) ?? 0) / b.planned / lineWeight(p, b),
          )[0] as DemoLine;
          for (let f = 0; f < BLOCK_FRAMES && t < until; f += 1) {
            if ((accepted.get(line.id) ?? 0) >= line.planned) break;
            const startMs = t;
            t += (line.exposureS + OVERHEAD_S) * 1000;
            const cloudP = 0.02 + (1 - q) * 0.28;
            const r = rand();
            const rejectReason =
              r < cloudP
                ? ('clouds' as const)
                : r < cloudP + 0.02
                  ? ('guiding' as const)
                  : r < cloudP + 0.03
                    ? ('focus' as const)
                    : r < cloudP + 0.04
                      ? ('satellite' as const)
                      : null;
            const rejected = rejectReason !== null;
            if (!rejected) {
              accepted.set(line.id, (accepted.get(line.id) ?? 0) + 1);
              acceptedS += line.exposureS;
            }
            seq += 1;
            const progress = (startMs - darkFrom) / Math.max(1, darkTo - darkFrom);
            captures.push({
              id: uuidFrom(ids),
              sessionId,
              projectId: p.id,
              panelId: line.panelId,
              lineId: line.id,
              night,
              capturedAt: iso(startMs + line.exposureS * 1000),
              exposureMidUtc: iso(startMs + (line.exposureS * 1000) / 2),
              filter: line.filter,
              exposureS: line.exposureS,
              gain: line.gain,
              offsetAdu: line.offsetAdu,
              binning: line.binning,
              readoutMode: line.readoutMode,
              raDeg: p.raDeg,
              decDeg: p.decDeg,
              rotationDeg: p.rotationDeg,
              pierSide: progress < 0.5 ? 'east' : 'west',
              rejected,
              rejectReason,
              fileName: `${night}_${p.name.replace(/[^A-Za-z0-9]+/g, '-')}_${line.filter}_${String(seq).padStart(4, '0')}.fits`,
              metrics: {
                hfr: round(
                  clamp(
                    1.7 + (1 - q) * 0.9 + (rejectReason === 'focus' ? 1.2 : 0) + 0.12 * gauss(rand),
                    1.2,
                    5,
                  ),
                  2,
                ),
                stars: Math.max(
                  40,
                  Math.round(1900 * q + 150 * gauss(rand) - (rejectReason === 'clouds' ? 900 : 0)),
                ),
                guidingRmsArcsec: round(
                  clamp(
                    0.45 +
                      (1 - q) * 0.35 +
                      (rejectReason === 'guiding' ? 1.1 : 0) +
                      0.06 * gauss(rand),
                    0.2,
                    3,
                  ),
                  2,
                ),
                altitudeDeg: round(
                  clamp(
                    40 + 35 * Math.sin(Math.PI * clamp(progress, 0, 1)) + 3 * gauss(rand),
                    20,
                    88,
                  ),
                  1,
                ),
                sensorTempC: round(-10 + 0.1 * gauss(rand), 1),
                setPointC: -10,
              },
            });
            totalCaptures += 1;
            if (rejected) totalRejected += 1;
          }
        }
      });
      const endedAt = Math.max(t, darkFrom) + 5 * 60_000;
      const seeing = round(clamp(1.3 + (1 - q) * 1.8 + 0.25 * gauss(rand), 0.9, 5), 1);
      const snapshot: ForecastSnapshot = {
        night,
        fetchedAtUtc: iso(darkFrom - 6 * 3_600_000),
        hours: Math.round(darkS / 3600),
        cloudPct: round(clamp((1 - q) * 100 + 8 * gauss(rand), 0, 100), 1),
        transparencyPct: round(clamp(q * 100 + 6 * gauss(rand), 0, 100), 1),
        seeingScore: round(clamp(q * 100 + 10 * gauss(rand), 0, 100), 1),
        temperatureC: round(
          9 + 5 * Math.sin((index / input.nights.length) * Math.PI) + 2 * gauss(rand),
          1,
        ),
        humidityPct: round(clamp(60 + (1 - q) * 30 + 5 * gauss(rand), 25, 100), 1),
        windKmh: round(clamp(10 + 6 * gauss(rand), 0, 45), 1),
        ratingIndex: ratingIndexOf(q),
        nightMean: round(q, 3),
        moonIllumPct: round(moon, 1),
      };
      const withLog = rand() < 0.75;
      sessions.push({
        id: sessionId,
        rigId: rig.id,
        ninaInstanceId: rig.ninaInstanceId,
        night,
        startedAt: iso(startedAt),
        endedAt: iso(endedAt),
        status: aborted ? 'aborted' : 'completed',
        reviewed: index < input.nights.length - DEMO_UNREVIEWED_NIGHTS,
        forecastSnapshot: snapshot,
        log: withLog
          ? {
              startTime: iso(startedAt),
              endTime: iso(endedAt),
              seeingArcsec: seeing,
              transparencyPct: snapshot.transparencyPct ?? 0,
              sqm: round(clamp(20.6 + 0.8 * q - 1.6 * (moon / 100) + 0.1 * gauss(rand), 17, 22), 2),
              temperatureC: snapshot.temperatureC ?? 0,
              humidityPct: snapshot.humidityPct ?? 0,
              windKmh: snapshot.windKmh ?? 0,
              cloudsNote: aborted
                ? 'Wolkenfelder, Session abgebrochen'
                : q < 0.65
                  ? 'Zeitweise Schleierwolken'
                  : null,
              moonIlluminationPct: round(moon, 1),
              valueSources: {
                startTime: 'auto',
                endTime: 'auto',
                seeingArcsec: 'forecast',
                transparencyPct: 'forecast',
                sqm: 'manual',
                temperatureC: 'nina',
                humidityPct: 'nina',
                windKmh: 'forecast',
                cloudsNote: 'manual',
                moonIlluminationPct: 'auto',
              },
            }
          : null,
      });
      totalSessions += 1;
      hoursBySite.set(rig.siteId, Math.max(hoursBySite.get(rig.siteId) ?? 0, acceptedS / 3600));
    }
    const stats: DemoNightStat[] = [];
    for (const siteId of new Set(input.rigs.map((r) => r.siteId))) {
      if (openSites.has(siteId)) {
        const h = round(hoursBySite.get(siteId) ?? 0, 2);
        const usable = h >= USABLE_NIGHT_MIN_HOURS;
        if (usable) usableNights += 1;
        stats.push({ siteId, night, usable, usableHours: h, source: 'session' });
      } else if (rand() < 0.4) {
        stats.push({ siteId, night, usable: false, usableHours: null, source: 'manual' });
      }
    }
    nights.push({ night, sessions, captures, stats });
  });

  const finalStatus = new Map<string, 'active' | 'completed' | 'on_hold' | 'unfinished'>();
  for (const p of input.projects) {
    if (p.story === 'fixed') continue;
    const done = p.lines.every((l) => (accepted.get(l.id) ?? 0) >= l.planned);
    finalStatus.set(
      p.id,
      p.story === 'on_hold'
        ? 'on_hold'
        : p.story === 'unfinished'
          ? done
            ? 'completed'
            : 'unfinished'
          : done
            ? 'completed'
            : 'active',
    );
  }
  return {
    nights,
    finalStatus,
    summary: {
      sessions: totalSessions,
      captures: totalCaptures,
      rejected: totalRejected,
      usableNights,
      nights: input.nights.length,
    },
  };
}

/** Filter eines Demo-Projekts: Kurzname, Belichtung, Anzahl. */
export interface DemoCatalogLine {
  readonly filter: string;
  readonly exposureS: number;
  readonly planned: number;
}

export interface DemoCatalogProject {
  readonly name: string;
  readonly targetName: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly story: Exclude<DemoStory, 'fixed'>;
  readonly lines: readonly DemoCatalogLine[];
}

/**
 * Demo-Projekte für ein Mono-Rig (Koordinaten J2000). Filter als Rolle (`L`, `R`, `G`, `B`, `Ha`, `OIII`, `SII`);
 * `demoFilterName` ordnet sie den Kurznamen des Mandanten zu. Anzahlen so gewählt, dass die Geschichten in 90
 * Nächten an einem Rig mit etwa neun dunklen Stunden aufgehen. Präfix „Demo –“ (Entscheidung Sven, 26.09.2026).
 */
export const DEMO_PROJECTS: readonly DemoCatalogProject[] = [
  {
    name: 'Demo – M 31 Andromedagalaxie (LRGB)',
    targetName: 'M 31',
    raDeg: 10.68,
    decDeg: 41.27,
    rotationDeg: 35,
    story: 'completed',
    lines: [
      { filter: 'L', exposureS: 300, planned: 120 },
      { filter: 'R', exposureS: 300, planned: 40 },
      { filter: 'G', exposureS: 300, planned: 40 },
      { filter: 'B', exposureS: 300, planned: 40 },
    ],
  },
  {
    name: 'Demo – NGC 7000 Nordamerikanebel (HOO)',
    targetName: 'NGC 7000',
    raDeg: 314.75,
    decDeg: 44.53,
    rotationDeg: 0,
    story: 'channel_gap',
    lines: [
      { filter: 'Ha', exposureS: 600, planned: 300 },
      { filter: 'OIII', exposureS: 600, planned: 800 },
    ],
  },
  {
    name: 'Demo – IC 1396 Elefantenrüssel (SHO)',
    targetName: 'IC 1396',
    raDeg: 324.75,
    decDeg: 57.5,
    rotationDeg: 90,
    story: 'active',
    lines: [
      { filter: 'Ha', exposureS: 600, planned: 250 },
      { filter: 'OIII', exposureS: 600, planned: 250 },
      { filter: 'SII', exposureS: 600, planned: 250 },
    ],
  },
  {
    name: 'Demo – M 33 Dreiecksgalaxie (LRGB)',
    targetName: 'M 33',
    raDeg: 23.46,
    decDeg: 30.66,
    rotationDeg: 0,
    story: 'on_hold',
    lines: [
      { filter: 'L', exposureS: 300, planned: 600 },
      { filter: 'R', exposureS: 300, planned: 160 },
      { filter: 'G', exposureS: 300, planned: 160 },
      { filter: 'B', exposureS: 300, planned: 160 },
    ],
  },
  {
    name: 'Demo – NGC 6888 Mondsichelnebel (HOO)',
    targetName: 'NGC 6888',
    raDeg: 303.0,
    decDeg: 38.35,
    rotationDeg: 0,
    story: 'unfinished',
    lines: [
      { filter: 'Ha', exposureS: 600, planned: 250 },
      { filter: 'OIII', exposureS: 600, planned: 250 },
    ],
  },
];

/** Übliche Kurznamen je Filterrolle (Groß-/Kleinschreibung egal). */
const FILTER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  L: ['L', 'LUM', 'LUMINANCE', 'LUMINOS', 'CLEAR'],
  R: ['R', 'RED'],
  G: ['G', 'GREEN'],
  B: ['B', 'BLUE'],
  Ha: ['HA', 'H-ALPHA', 'HALPHA', 'H'],
  OIII: ['OIII', 'O3', 'O-III'],
  SII: ['SII', 'S2', 'S-II'],
};

/** Kurzname des Mandanten für eine Filterrolle; `null`, wenn es keinen passenden Filter gibt. */
export function demoFilterName(role: string, shortNames: readonly string[]): string | null {
  const aliases = FILTER_ALIASES[role] ?? [role.toUpperCase()];
  return shortNames.find((n) => aliases.includes(n.trim().toUpperCase())) ?? null;
}

/** Kennzeichen in der Beschreibung der erzeugten Projekte. */
export const DEMO_PROJECT_MARK =
  'Auswertungs-Demo (ops-cli demo-evaluation) – automatisch erzeugt.';
