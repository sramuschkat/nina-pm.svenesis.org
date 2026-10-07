/**
 * Aktuelle Nacht `currentNight(site, now)` (NT-01, specs/engine/night.md §1.1). Rechnet **nur** über
 * die Nacht-Tabelle des Standorts (H1) – keine eigene Dämmerungssuche, keine Ortszeit. Zweite
 * Fassung in NinaPm.Core (AP-16b) mit denselben Testvektoren
 * (packages/shared/contracts/test-vectors/current-night.json).
 */
import { ProblemError } from './errors';

export interface NightRow {
  /** Nacht-Schlüssel `YYYY-MM-DD` (Abenddatum in Standortzeit). */
  readonly night: string;
  readonly noonStartUtc: string;
  readonly noonEndUtc: string;
  readonly nightWindowEndUtc: string;
}

export interface NightTable {
  readonly nights: readonly NightRow[];
}

const ms = (iso: string, field: string): number => {
  const t = Date.parse(iso);
  if (!/Z$/.test(iso) || Number.isNaN(t)) {
    throw new ProblemError('engine.input_invalid', [
      { path: field, message: 'UTC-Zeitpunkt mit Z erwartet' },
    ]);
  }
  return t;
};

/** Liefert die Nacht-Zeile der aktuellen Nacht; `now` ist ein UTC-Zeitpunkt (ISO mit `Z`). */
export function currentNightRow(site: NightTable, now: string): NightRow {
  const t = ms(now, 'now');
  const { nights } = site;
  const first = nights[0];
  if (!first) throw tooShort('Nacht-Tabelle ist leer');

  let index = nights.findIndex(
    (n, i) =>
      ms(n.noonStartUtc, `nights[${i}].noonStartUtc`) <= t &&
      t < ms(n.noonEndUtc, `nights[${i}].noonEndUtc`),
  );
  // Tabelle beginnt nach der Mittagsnacht (z. B. from = morgen): dann gilt nights[0] (H1).
  if (index < 0 && t < ms(first.noonStartUtc, 'nights[0].noonStartUtc')) index = 0;
  if (index < 0) throw tooShort('now liegt hinter dem Ende der Nacht-Tabelle');

  const row = nights[index] as NightRow;
  if (ms(row.nightWindowEndUtc, `nights[${index}].nightWindowEndUtc`) <= t) {
    // Morgen nach Nachtfensterende: die kommende Nacht ist „heute“.
    const next = nights[index + 1];
    if (!next) throw tooShort('Folgenacht fehlt in der Nacht-Tabelle');
    return next;
  }
  return row;
}

export function currentNight(site: NightTable, now: string): string {
  return currentNightRow(site, now).night;
}

/**
 * Nacht, deren Nachtfenster schon zu Ende ist, deren Mittag-zu-Mittag-Zeitraum aber noch läuft (Morgen nach dem
 * Fensterende, `currentNight` zeigt schon die folgende Nacht) – sonst `null`. „Heute Nacht“ zeigt diese Nacht weiter,
 * solange ihre Session noch läuft (Flats nach der Dämmerung, Rest eines Transits; Analyse 07.10.2026).
 */
export function nightOfEndedWindow(site: NightTable, now: string): string | null {
  const t = ms(now, 'now');
  const row = site.nights.find(
    (n, i) =>
      ms(n.noonStartUtc, `nights[${i}].noonStartUtc`) <= t &&
      t < ms(n.noonEndUtc, `nights[${i}].noonEndUtc`),
  );
  if (!row) return null;
  return ms(row.nightWindowEndUtc, 'nightWindowEndUtc') <= t ? row.night : null;
}

function tooShort(message: string): ProblemError {
  return new ProblemError('engine.input_invalid', [{ path: 'nights', message }], message);
}
