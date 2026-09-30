/**
 * Regeln für Transit-Beobachtungen (transit.md §8; FA-EXO-18/20/33, FA-FRG-09) als reine Funktionen – gemeinsam für
 * API (Vorschau der Konflikte im Reiter) und Datenbankschicht (Prüfung in der Transaktion beim Festlegen, Bestätigen
 * und Freigeben). Zeitpunkte in Millisekunden seit 1970 (UTC).
 */

/** Transit-Zeile für den Vergleich „dasselbe Ereignis“ (FA-EXO-33a). */
export interface TransitLine {
  readonly filterId: string | null;
  readonly exposureS: number;
  readonly gain: number | null;
  readonly offsetAdu: number | null;
  readonly binning: number;
  readonly readoutMode: string | null;
}

/** Offene Beobachtung auf dem Rig (festgelegt bzw. in der Warteschlange gewünscht). */
export interface RigObservation {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  /** Ersteller des Projekts (`app_user.id`) – Bild neben dem Namen im Hinweis (30.09.2026). */
  readonly createdBy: string | null;
  readonly createdByName: string;
  readonly planet: string;
  readonly epoch: number;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly status: 'requested' | 'locked';
  /** Reihenfolge „frühere Festlegung“ (`locked_at`, sonst Anlage). */
  readonly orderMs: number;
  readonly primaryObservationId: string | null;
  readonly line: TransitLine | null;
}

export interface TransitCandidate {
  readonly projectId: string;
  readonly planet: string;
  readonly epoch: number;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly line: TransitLine | null;
}

export type TransitConflict =
  | { readonly kind: 'overlap'; readonly with: RigObservation }
  | { readonly kind: 'share_mismatch'; readonly with: RigObservation }
  | { readonly kind: 'share'; readonly primary: RigObservation };

const planetKey = (name: string) => name.toUpperCase().replace(/[\s_]/g, '');

export function sameTransitLine(a: TransitLine | null, b: TransitLine | null): boolean {
  if (!a || !b) return false;
  return (
    a.filterId === b.filterId &&
    a.exposureS === b.exposureS &&
    a.gain === b.gain &&
    a.offsetAdu === b.offsetAdu &&
    a.binning === b.binning &&
    (a.readoutMode ?? null) === (b.readoutMode ?? null)
  );
}

/**
 * Konflikt eines Kandidaten mit den offenen Beobachtungen des Rigs (FA-EXO-33). Beobachtungen desselben Projekts
 * zählen mit (eigene Fenster dürfen sich nicht überlappen). Reihenfolge: Überlappung mit einem anderen Ereignis
 * schlägt immer; sonst dasselbe Ereignis anderer Projekte → verknüpfen (gleiche Zeile) bzw. `share_mismatch`.
 * Die primäre Beobachtung ist die mit der frühesten Festlegung.
 */
export function transitConflict(
  c: TransitCandidate,
  others: readonly RigObservation[],
): TransitConflict | null {
  const overlapping = others
    .filter((o) => o.windowStartMs < c.windowEndMs && c.windowStartMs < o.windowEndMs)
    .sort((a, b) => a.orderMs - b.orderMs || (a.id < b.id ? -1 : 1));
  const same = (o: RigObservation) =>
    o.projectId !== c.projectId &&
    planetKey(o.planet) === planetKey(c.planet) &&
    o.epoch === c.epoch;
  const foreignEvent = overlapping.find((o) => !same(o));
  if (foreignEvent) return { kind: 'overlap', with: foreignEvent };
  const sameEvent = overlapping.filter(same);
  const first = sameEvent[0];
  if (!first) return null;
  const mismatch = sameEvent.find((o) => !sameTransitLine(o.line, c.line));
  if (mismatch) return { kind: 'share_mismatch', with: mismatch };
  const primary = sameEvent.find((o) => o.primaryObservationId === null) ?? first;
  return { kind: 'share', primary };
}

/** Frist (FA-FRG-09): Fensterbeginn − Vorlauf (Slew/Zentrieren + 60 s) − 15 min Aktualisierungsintervall. */
export function transitDeadlineMs(windowStartMs: number, slewCenterS: number): number {
  return windowStartMs - (slewCenterS + 60) * 1000 - 15 * 60_000;
}

/** Richtwert *Geplant* (FA-EXO-20): ⌊Fensterdauer / (Belichtung + Download)⌋. */
export function transitPlannedFrames(
  windowStartMs: number,
  windowEndMs: number,
  exposureS: number,
  downloadS: number,
): number {
  const cycle = exposureS + downloadS;
  if (!(cycle > 0)) return 0;
  return Math.max(0, Math.floor((windowEndMs - windowStartMs) / 1000 / cycle));
}
