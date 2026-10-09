/**
 * Automatische Bildbewertung (AP-72b, FA-AUS-25): je Light gegen die Grenzwerte des Rigs. HFR und Sterne relativ zum
 * Median desselben Projekts und Filters (nicht verworfene Lights, mindestens `GRADE_MIN_REF`), Guiding-RMS und Wolken
 * absolut. Rein – Server (Eingang, Projekt-Ansicht, Nacht) und Tests rechnen dasselbe.
 */
import type { ImageQualitySettings } from './contracts/equipment';
import type { ImageGrade, ImageGradeMetric } from './generated/enums';

/** Startwerte (Entscheidung Sven 09.10.2026): HFR + 30 %, Sterne < 50 %, RMS > 1,5″, Wolken > 50 %, nur markieren. */
export const IMAGE_QUALITY_DEFAULTS: ImageQualitySettings = {
  mode: 'mark',
  hfrPct: 30,
  starsPct: 50,
  rmsArcsec: 1.5,
  cloudPct: 50,
};

/** Mindestzahl Lights im Bezug, sonst prüfen HFR und Sterne nicht (zu wenig Daten für einen Median). */
export const GRADE_MIN_REF = 10;

/** Bezug je Projekt und Filter: Median HFR (px) und Sterne der nicht verworfenen Lights. */
export interface GradeRef {
  readonly hfr: number | null;
  readonly stars: number | null;
  readonly n: number;
}

/** Was die Bewertung von einem Light braucht. */
export interface GradeInput {
  readonly hfr: number | null;
  readonly stars: number | null;
  readonly rmsArcsec: number | null;
  readonly cloudCoverPct: number | null;
}

/** Überschrittener Grenzwert: Kennzahl, Wert und Grenze (HFR in px wie der Bezug). */
export interface GradeFlag {
  readonly metric: ImageGradeMetric;
  readonly value: number;
  readonly limit: number;
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Grenzwerte, die gegen ein Light verstoßen; leer = in Ordnung. */
export function gradeFlags(
  m: GradeInput,
  ref: GradeRef | null,
  s: ImageQualitySettings,
): GradeFlag[] {
  const out: GradeFlag[] = [];
  const enough = ref !== null && ref.n >= GRADE_MIN_REF;
  if (enough && s.hfrPct !== null && m.hfr !== null && ref.hfr !== null && ref.hfr > 0) {
    const limit = ref.hfr * (1 + s.hfrPct / 100);
    if (m.hfr > limit) out.push({ metric: 'hfr', value: m.hfr, limit: round(limit, 3) });
  }
  if (enough && s.starsPct !== null && m.stars !== null && ref.stars !== null && ref.stars > 0) {
    const limit = ref.stars * (s.starsPct / 100);
    if (m.stars < limit) out.push({ metric: 'stars', value: m.stars, limit: round(limit, 1) });
  }
  if (s.rmsArcsec !== null && m.rmsArcsec !== null && m.rmsArcsec > s.rmsArcsec)
    out.push({ metric: 'rms', value: m.rmsArcsec, limit: s.rmsArcsec });
  if (s.cloudPct !== null && m.cloudCoverPct !== null && m.cloudCoverPct > s.cloudPct)
    out.push({ metric: 'cloud', value: m.cloudCoverPct, limit: s.cloudPct });
  return out;
}

/**
 * Zustand eines Lights: `rejected` (verworfen, gleich aus welchem Grund) vor `kept` („Behalten“ bestätigt – wird nicht
 * wieder markiert) vor `flagged` vor `ok`; `none` ohne jeden prüfbaren Messwert.
 */
export function imageGrade(
  m: GradeInput,
  flags: readonly GradeFlag[],
  state: { rejected: boolean; kept: boolean },
): ImageGrade {
  if (state.rejected) return 'rejected';
  if (state.kept) return 'kept';
  if (flags.length > 0) return 'flagged';
  if (m.hfr === null && m.stars === null && m.rmsArcsec === null && m.cloudCoverPct === null)
    return 'none';
  return 'ok';
}

/** Median; leere Liste → `null`. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Bezug je Filter aus den nicht verworfenen Lights (Projekt). */
export function gradeRefs(
  lights: readonly {
    filter: string;
    hfr: number | null;
    stars: number | null;
    rejected: boolean;
  }[],
): Map<string, GradeRef> {
  const groups = new Map<string, { hfr: number[]; stars: number[]; n: number }>();
  for (const l of lights) {
    if (l.rejected) continue;
    let g = groups.get(l.filter);
    if (!g) {
      g = { hfr: [], stars: [], n: 0 };
      groups.set(l.filter, g);
    }
    g.n++;
    if (l.hfr !== null) g.hfr.push(l.hfr);
    if (l.stars !== null) g.stars.push(l.stars);
  }
  return new Map(
    [...groups.entries()].map(([f, g]) => [
      f,
      { hfr: median(g.hfr), stars: median(g.stars), n: g.n },
    ]),
  );
}
