/**
 * Sessionqualität (AP-77, FA-AUS-25): die Bewertung je Light (AP-72b, `gradeFlags`/`imageGrade`) fließt nur noch als
 * **Anteil** ein – je Projekt und Filter bzw. Zeile, je Session und je Nacht. Gut = in Ordnung (bzw. früher „behalten“),
 * auffällig = mindestens ein Grenzwert des Rigs überschritten, verworfen = aus Korrekturen; Lights ohne jeden prüfbaren
 * Messwert zählen nicht. Rein – Server (Nacht-Detail, Projekt) und Oberfläche rechnen dasselbe.
 */
import type { ImageGrade, ImageGradeMetric, SessionQualityGrade } from './generated/enums';
import type { QualityCounts, QualitySpread, QualityStats } from './contracts/sessions';
import { medianOf } from './image-quality';

/**
 * Stufen des Session-Urteils nach dem Anteil guter Lights (Entscheidung Sven 10.10.2026): sehr gut ≥ 95 %, gut ≥ 85 %,
 * mäßig ≥ 70 %, darunter schlecht.
 */
export const SESSION_GRADE_MIN_PCT = { very_good: 95, good: 85, fair: 70 } as const;

/** Was die Rechnung von einem Light braucht. */
export interface QualityLight {
  readonly grade: ImageGrade;
  readonly flags: readonly { readonly metric: ImageGradeMetric }[];
  readonly hfr: number | null;
  readonly stars: number | null;
  readonly rmsArcsec: number | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

const share = (good: number, flagged: number, rejected: number) => {
  const graded = good + flagged + rejected;
  return graded === 0 ? null : round1((good / graded) * 100);
};

/** Zählung und Anteil. */
export function qualityCounts(lights: readonly QualityLight[]): QualityCounts {
  let good = 0;
  let flagged = 0;
  let rejected = 0;
  let none = 0;
  const reasons: Record<ImageGradeMetric, number> = { hfr: 0, stars: 0, rms: 0, cloud: 0 };
  for (const l of lights) {
    if (l.grade === 'ok' || l.grade === 'kept') good += 1;
    else if (l.grade === 'rejected') rejected += 1;
    else if (l.grade === 'none') none += 1;
    else {
      flagged += 1;
      for (const m of new Set(l.flags.map((f) => f.metric))) reasons[m] += 1;
    }
  }
  return { good, flagged, rejected, none, sharePct: share(good, flagged, rejected), reasons };
}

/** Summe mehrerer Zählungen (Sessions einer Nacht, Nächte eines Projekts). */
export function combineQualityCounts(list: readonly QualityCounts[]): QualityCounts {
  const sum = (f: (c: QualityCounts) => number) => list.reduce((n, c) => n + f(c), 0);
  const good = sum((c) => c.good);
  const flagged = sum((c) => c.flagged);
  const rejected = sum((c) => c.rejected);
  return {
    good,
    flagged,
    rejected,
    none: sum((c) => c.none),
    sharePct: share(good, flagged, rejected),
    reasons: {
      hfr: sum((c) => c.reasons.hfr),
      stars: sum((c) => c.reasons.stars),
      rms: sum((c) => c.reasons.rms),
      cloud: sum((c) => c.reasons.cloud),
    },
  };
}

function spread(values: readonly number[], round: (x: number) => number): QualitySpread | null {
  const m = medianOf(values);
  if (m === null) return null;
  return { median: round(m), min: round(Math.min(...values)), max: round(Math.max(...values)) };
}

/** Zählung plus Median und Spanne von HFR, Sternen und Guiding-RMS (verworfene Lights zählen dort nicht). */
export function qualityStats(lights: readonly QualityLight[]): QualityStats {
  const kept = lights.filter((l) => l.grade !== 'rejected');
  const values = (f: (l: QualityLight) => number | null) =>
    kept.flatMap((l) => {
      const v = f(l);
      return v === null ? [] : [v];
    });
  return {
    ...qualityCounts(lights),
    hfr: spread(
      values((l) => l.hfr),
      round3,
    ),
    stars: spread(
      values((l) => l.stars),
      Math.round,
    ),
    rmsArcsec: spread(
      values((l) => l.rmsArcsec),
      round3,
    ),
  };
}

/** Urteil der Session bzw. Nacht aus dem Anteil guter Lights; `null` ohne bewertete Lights. */
export function sessionGrade(sharePct: number | null): SessionQualityGrade | null {
  if (sharePct === null) return null;
  if (sharePct >= SESSION_GRADE_MIN_PCT.very_good) return 'very_good';
  if (sharePct >= SESSION_GRADE_MIN_PCT.good) return 'good';
  if (sharePct >= SESSION_GRADE_MIN_PCT.fair) return 'fair';
  return 'poor';
}

/**
 * Anteil für die Anzeige als ganze Zahl: abgerundet, damit „100 %“ nur erscheint, wenn wirklich alle bewerteten Lights
 * gut sind (99,6 % mit einem auffälligen Light zeigt „99 %“).
 */
export const shareLabelPct = (sharePct: number): number => Math.floor(sharePct);
