/**
 * Bereich Auswertung (AP-64, S-60…S-64): Pfade der drei Reiter Nächte | Projekte | Standort-Statistik und der
 * gemeinsame Filter Rig + Zeitraum in der URL (`?rig=…&zeitraum=…&von=…&bis=…`), damit er beim Reiterwechsel und beim
 * Zurück erhalten bleibt. Zeiträume einheitlich in Nächten (Nacht-Schlüssel, NT-04): letzte 30 / 90 / 365 Nächte,
 * dieses Jahr, von–bis. Rein: „heute“ kommt vom Aufrufer.
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';

export const EVALUATION_PATHS = {
  nights: '/auswertung/naechte',
  projects: '/auswertung/projekte',
  site: '/auswertung/standort',
} as const;

export const PERIODS = ['30', '90', '365', 'year', 'custom'] as const;
export type Period = (typeof PERIODS)[number];
/** Adresse der Oberfläche (deutsch, Entscheidung Sven 27.09.2026) ↔ Zeitraum. */
const PERIOD_PARAM: Record<Period, string> = {
  '30': '30',
  '90': '90',
  '365': '365',
  year: 'jahr',
  custom: 'frei',
};
export const DEFAULT_PERIOD: Period = '30';

const KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface EvaluationFilter {
  /** Rig-ID; `''` = alle Rigs. */
  readonly rigId: string;
  /** Standort der Standort-Statistik; `''` = Standort des gewählten Rigs. */
  readonly siteId: string;
  readonly period: Period;
  /** Von–bis (nur `custom`). */
  readonly from: string;
  readonly to: string;
}

/** Filter aus den Suchparametern; unbekannte Werte fallen auf den Standard zurück. */
export function parseFilter(params: URLSearchParams): EvaluationFilter {
  const raw = params.get('zeitraum') ?? '';
  const period =
    (Object.entries(PERIOD_PARAM).find(([, v]) => v === raw)?.[0] as Period | undefined) ??
    DEFAULT_PERIOD;
  const key = (v: string | null) => (v && KEY.test(v) ? v : '');
  return {
    rigId: params.get('rig') ?? '',
    siteId: params.get('standort') ?? '',
    period,
    from: key(params.get('von')),
    to: key(params.get('bis')),
  };
}

/** Suchparameter des Filters (Standardwerte fallen weg, damit die Adresse kurz bleibt). */
export function filterSearch(f: EvaluationFilter): string {
  const p = new URLSearchParams();
  if (f.rigId) p.set('rig', f.rigId);
  if (f.siteId) p.set('standort', f.siteId);
  if (f.period !== DEFAULT_PERIOD) p.set('zeitraum', PERIOD_PARAM[f.period]);
  if (f.period === 'custom') {
    if (f.from) p.set('von', f.from);
    if (f.to) p.set('bis', f.to);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Nächte des Zeitraums als `{from, to}` (Nacht-Schlüssel, beide einschließlich). „Letzte n Nächte“ enden mit der
 * Nacht von heute; „dieses Jahr“ beginnt am 1. Januar; von–bis wird geordnet, fehlt eine Grenze, gilt 30 Nächte.
 */
export function periodRange(f: Pick<EvaluationFilter, 'period' | 'from' | 'to'>, today: string) {
  const back = (n: number) => keyFromDays(daysFromKey(today) - (n - 1));
  switch (f.period) {
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom': {
      const from = f.from || back(30);
      const to = f.to || today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    default:
      return { from: back(Number(f.period)), to: today };
  }
}

/**
 * Nacht im Bereich (eine Seite je Nacht und Rig, Entscheidung Sven 07.10.2026); der Filter wandert mit, damit
 * „← Nächte“ dorthin zurückführt. `session` wählt eine Session der Nacht vor.
 */
export const nightPath = (rigId: string, night: string, search = '', session?: string) => {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (session) p.set('session', session);
  const q = p.toString();
  return `${EVALUATION_PATHS.nights}/${rigId}/${night}${q ? `?${q}` : ''}`;
};

/**
 * Link auf eine Session (Projekte, Standort-Statistik, Übersicht, Discord): leitet auf ihre Nacht um und wählt sie vor;
 * mit `whole` die ganze Nacht.
 */
export const sessionPath = (sessionId: string, whole = false) =>
  `${EVALUATION_PATHS.nights}/${sessionId}${whole ? '?nacht=1' : ''}`;

/** Wochentag einer Nacht (Abend) in der Sprache der Oberfläche, z. B. „Di“. Kalenderrechnung ohne Zone. */
export function nightWeekday(night: string, language: string): string {
  const [y, m, d] = night.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'de-DE', {
    weekday: 'short',
    timeZone: 'UTC',
  })
    .format(Date.UTC(y, m - 1, d))
    .replace(/\.$/, '');
}
