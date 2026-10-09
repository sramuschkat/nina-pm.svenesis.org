/**
 * Bildqualität (AP-72, FA-AUS-23 ff., FA-RIG-20): „klar laut Bildern“ je Stunde und Filter-Offsets aus den
 * Autofokus-Läufen. Rein und deterministisch – Browser und API rechnen dasselbe. Grundlage sind die Messwerte, die das
 * Plugin je Aufnahme meldet (Sterne, Hintergrund, Wolken des Wettergeräts), und das Ereignis `af` (Filter, Position,
 * Temperatur). Keine Bilddateien.
 */

/** Median; leere Liste → `null`. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

// ---- Klar laut Bildern ----------------------------------------------------------------------------------

/** Bezugswerte je Projekt und Filter (Median der nicht verworfenen Lights der letzten Nächte). */
export interface QualityRef {
  readonly projectId: string;
  readonly filter: string;
  readonly stars: number | null;
  readonly hfr: number | null;
  readonly medianAdu: number | null;
  /** Zahl der Lights im Bezug. */
  readonly n: number;
}

export interface ClarityLight {
  /** Belichtungsbeginn in Sekunden UTC. */
  readonly atS: number;
  readonly projectId: string | null;
  readonly filter: string;
  readonly stars: number | null;
  readonly medianAdu: number | null;
  readonly cloudCoverPct: number | null;
}

export type ClarityVerdict = 'clear' | 'thin' | 'cloudy';

export interface ClarityHour {
  /** Beginn der vollen UTC-Stunde in Sekunden. */
  readonly fromS: number;
  readonly verdict: ClarityVerdict;
  /** Median Sterne ÷ Bezug (Projekt und Filter); `null` ohne Sternzahl oder Bezug. */
  readonly starsRatio: number | null;
  /** Median Hintergrund ÷ Bezug. */
  readonly backgroundRatio: number | null;
  /** Median der Wolkenbedeckung des Wettergeräts. */
  readonly cloudCoverPct: number | null;
  /** Lights in der Stunde. */
  readonly n: number;
}

/** Grenzen des Urteils (FA-AUS-23); Abstimmung an echten Nächten, Startwerte AP-72. */
export const CLARITY = {
  /** Sterne unter 40 % des Bezugs → bewölkt, unter 75 % → dünne Wolken. */
  cloudyStars: 0.4,
  thinStars: 0.75,
  /** Hintergrund über 150 % des Bezugs → mindestens dünne Wolken (Aufhellung durch Wolken). */
  thinBackground: 1.5,
  /** Wolkenbedeckung des Wettergeräts über 60 % → bewölkt, über 25 % → dünne Wolken. */
  cloudyCover: 60,
  thinCover: 25,
  /** Mindestzahl Lights im Bezug, sonst zählt der Bezug nicht. */
  minRef: 3,
} as const;

const refKey = (projectId: string, filter: string) => `${projectId}|${filter}`;

/**
 * „Klar laut Bildern“ je voller UTC-Stunde (FA-AUS-23): Sternzahl im Verhältnis zum Median desselben Projekts und
 * Filters (Bezug aus den letzten Nächten), Hintergrund (Median-ADU) im Verhältnis zum Bezug und – falls vorhanden – die
 * Wolkenbedeckung des Wettergeräts. Stunden ohne verwertbare Lights fehlen. Das schlechteste Teilurteil gilt.
 */
export function clarityByHour(
  lights: readonly ClarityLight[],
  refs: readonly QualityRef[],
): ClarityHour[] {
  const byKey = new Map(
    refs.filter((r) => r.n >= CLARITY.minRef).map((r) => [refKey(r.projectId, r.filter), r]),
  );
  const hours = new Map<number, ClarityLight[]>();
  for (const l of lights) {
    const from = Math.floor(l.atS / 3600) * 3600;
    const list = hours.get(from);
    if (list) list.push(l);
    else hours.set(from, [l]);
  }
  const out: ClarityHour[] = [];
  for (const [fromS, list] of [...hours.entries()].sort((a, b) => a[0] - b[0])) {
    const stars: number[] = [];
    const background: number[] = [];
    const cover: number[] = [];
    for (const l of list) {
      const ref = l.projectId === null ? undefined : byKey.get(refKey(l.projectId, l.filter));
      if (l.stars !== null && ref?.stars) stars.push(l.stars / ref.stars);
      if (l.medianAdu !== null && ref?.medianAdu) background.push(l.medianAdu / ref.medianAdu);
      if (l.cloudCoverPct !== null) cover.push(l.cloudCoverPct);
    }
    const starsRatio = medianOf(stars);
    const backgroundRatio = medianOf(background);
    const cloudCoverPct = medianOf(cover);
    if (starsRatio === null && cloudCoverPct === null) continue;
    let verdict: ClarityVerdict = 'clear';
    const worse = (v: ClarityVerdict) => {
      if (v === 'cloudy' || (v === 'thin' && verdict === 'clear')) verdict = v;
    };
    if (starsRatio !== null)
      worse(
        starsRatio < CLARITY.cloudyStars
          ? 'cloudy'
          : starsRatio < CLARITY.thinStars
            ? 'thin'
            : 'clear',
      );
    if (backgroundRatio !== null && backgroundRatio > CLARITY.thinBackground) worse('thin');
    if (cloudCoverPct !== null)
      worse(
        cloudCoverPct > CLARITY.cloudyCover
          ? 'cloudy'
          : cloudCoverPct > CLARITY.thinCover
            ? 'thin'
            : 'clear',
      );
    out.push({ fromS, verdict, starsRatio, backgroundRatio, cloudCoverPct, n: list.length });
  }
  return out;
}

/** Anteil klarer Stunden (0…1) einer Nacht; ohne Stunden `null`. */
export function clearShare(hours: readonly ClarityHour[]): number | null {
  if (hours.length === 0) return null;
  return hours.filter((h) => h.verdict === 'clear').length / hours.length;
}

/** Urteil der Nacht: überwiegend klar (≥ 75 % der Stunden), teilweise (≥ 25 %), sonst bewölkt. */
export function nightClarity(hours: readonly ClarityHour[]): ClarityVerdict | null {
  const share = clearShare(hours);
  if (share === null) return null;
  return share >= 0.75 ? 'clear' : share >= 0.25 ? 'thin' : 'cloudy';
}

// ---- Filter-Offsets ------------------------------------------------------------------------------------

/** Ein erfolgreicher Autofokus-Lauf (Ereignis `af`, Plugin ≥ 0.4.21). */
export interface FocusRun {
  /** NINA-Filtername beim Autofokus. */
  readonly filter: string;
  readonly position: number;
  readonly temperatureC: number;
}

export interface FilterOffset {
  readonly filter: string;
  readonly runs: number;
  /** Position bei der Bezugstemperatur (Achsenabschnitt der Regression + Steigung × Bezugstemperatur). */
  readonly positionAtRef: number;
  /** Offset zum Bezugsfilter in Schritten, gerundet; `null` bei zu wenig Läufen. */
  readonly offset: number | null;
  /** Streuung der Reste (Stichproben-Standardabweichung) in Schritten; `null` bei weniger als 2 Läufen. */
  readonly scatter: number | null;
}

export interface FocusOffsets {
  /** Bezugsfilter (Offset 0); `null`, wenn kein Filter genug Läufe hat. */
  readonly reference: string | null;
  /** Gemeinsame Temperaturdrift in Schritten je °C; `null` ohne Temperaturspanne. */
  readonly slopePerC: number | null;
  /** Bezugstemperatur (Mittel aller Läufe), auf die `positionAtRef` bezogen ist. */
  readonly referenceTemperatureC: number | null;
  readonly filters: readonly FilterOffset[];
  readonly totalRuns: number;
}

/** Mindestzahl Läufe je Filter für einen Offset-Vorschlag (AP-72). */
export const FOCUS_MIN_RUNS = 3;

/**
 * Filter-Offsets (FA-RIG-20): lineare Regression Position = a_Filter + b · Temperatur mit **gemeinsamer** Steigung b über
 * alle Filter (Kovarianz innerhalb der Filter ÷ Varianz innerhalb der Filter). Offset = a_Filter − a_Bezug; Bezug ist
 * `preferredReference` (z. B. der NINA-Name des L-Filters), wenn er genug Läufe hat, sonst der Filter mit den meisten
 * Läufen. Ohne Temperaturspanne ist b = 0 und der Offset die Differenz der Mittelwerte.
 */
export function focusOffsets(
  runs: readonly FocusRun[],
  preferredReference: string | null = null,
): FocusOffsets {
  const valid = runs.filter((r) => Number.isFinite(r.position) && Number.isFinite(r.temperatureC));
  const groups = new Map<string, FocusRun[]>();
  for (const r of valid) {
    const g = groups.get(r.filter);
    if (g) g.push(r);
    else groups.set(r.filter, [r]);
  }
  let sxy = 0;
  let sxx = 0;
  const means = new Map<string, { t: number; p: number }>();
  for (const [f, g] of groups) {
    const t = g.reduce((s, r) => s + r.temperatureC, 0) / g.length;
    const p = g.reduce((s, r) => s + r.position, 0) / g.length;
    means.set(f, { t, p });
    for (const r of g) {
      sxy += (r.temperatureC - t) * (r.position - p);
      sxx += (r.temperatureC - t) ** 2;
    }
  }
  const slope = sxx > 1e-9 ? sxy / sxx : null;
  const b = slope ?? 0;
  const tRef =
    valid.length > 0 ? valid.reduce((s, r) => s + r.temperatureC, 0) / valid.length : null;
  const enough = [...groups.entries()].filter(([, g]) => g.length >= FOCUS_MIN_RUNS);
  const reference =
    preferredReference !== null && (groups.get(preferredReference)?.length ?? 0) >= FOCUS_MIN_RUNS
      ? preferredReference
      : ([...enough].sort(
          (a, b2) => b2[1].length - a[1].length || a[0].localeCompare(b2[0]),
        )[0]?.[0] ?? null);
  const atRef = (f: string) => {
    const m = means.get(f) as { t: number; p: number };
    return m.p + b * ((tRef ?? m.t) - m.t);
  };
  const refPos = reference === null ? null : atRef(reference);
  const filters = [...groups.entries()]
    .sort((a, b2) => a[0].localeCompare(b2[0]))
    .map(([f, g]): FilterOffset => {
      const m = means.get(f) as { t: number; p: number };
      const residuals = g.map((r) => r.position - (m.p + b * (r.temperatureC - m.t)));
      const scatter =
        g.length >= 2 ? Math.sqrt(residuals.reduce((s, x) => s + x * x, 0) / (g.length - 1)) : null;
      const pos = atRef(f);
      return {
        filter: f,
        runs: g.length,
        positionAtRef: Math.round(pos * 10) / 10,
        offset: refPos !== null && g.length >= FOCUS_MIN_RUNS ? Math.round(pos - refPos) : null,
        scatter: scatter === null ? null : Math.round(scatter * 10) / 10,
      };
    });
  return {
    reference,
    slopePerC: slope === null ? null : Math.round(slope * 100) / 100,
    referenceTemperatureC: tRef === null ? null : Math.round(tRef * 100) / 100,
    filters,
    totalRuns: valid.length,
  };
}
