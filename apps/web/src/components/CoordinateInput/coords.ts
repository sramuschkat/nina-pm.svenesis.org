/**
 * Koordinaten lesen und schreiben (components.md §2.6). Beide Schreibweisen werden bei der Eingabe
 * angenommen; RA wird auf [0, 360) normalisiert, Dec/Breite auf [-90, 90] **begrenzt** (Fehler statt
 * stillem Abschneiden), Länge auf [-180, 180]. Rundung auf 1e-6° wie die Engine (canonical-json.md).
 */
export type CoordKind = 'ra' | 'dec' | 'lon' | 'lat';
export type CoordFormat = 'sexagesimal' | 'decimal';

export type ParseResult =
  | { ok: true; valueDeg: number }
  | { ok: false; reason: 'invalid' | 'range' }
  | { ok: true; valueDeg: null };

export const COORD_RANGE: Readonly<Record<CoordKind, { min: number; max: number }>> = {
  ra: { min: 0, max: 360 },
  dec: { min: -90, max: 90 },
  lat: { min: -90, max: 90 },
  lon: { min: -180, max: 180 },
};

export const COORD_EXAMPLE: Readonly<Record<CoordKind, string>> = {
  ra: '00h 52m 49s',
  dec: '+56° 37′ 48″',
  lat: '52° 22′ 14″',
  lon: '9° 44′ 17″',
};

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Sexagesimal: Teile durch Leerzeichen, `:` oder Einheitenzeichen getrennt; Vorzeichen vorn. Zwischen Minuten
 * und Sekunden ist ein Trenner Pflicht – „12 345“ wurde sonst still als 12°34′05″ gelesen (Prüfung 28.09.2026).
 */
const SEXAGESIMAL =
  /^([+\-−])?\s*(\d{1,3})\s*(?:[h°:\s]\s*)(\d{1,2})\s*(?:(?:[m′':\s]\s*)(\d{1,2}(?:[.,]\d+)?)\s*[s″"]?|[m′'])?$/i;
const DECIMAL = /^([+\-−])?\s*(\d{1,3}(?:[.,]\d+)?)\s*°?$/;
/** Nur Stunden („12h“, „5,5 h“) – für RA. */
const HOURS = /^(\d{1,2}(?:[.,]\d+)?)\s*h$/i;

export function parseCoordinate(kind: CoordKind, input: string): ParseResult {
  const text = input.trim().replace(/\s+/g, ' ');
  if (text === '') return { ok: true, valueDeg: null };
  let value: number | undefined;
  const sex = SEXAGESIMAL.exec(text);
  const hours = kind === 'ra' ? HOURS.exec(text) : null;
  if (hours) value = Number((hours[1] ?? '').replace(',', '.')) * 15;
  else if (sex && (sex[3] !== undefined || /[h:]/i.test(text))) {
    const sign = sex[1] === '-' || sex[1] === '−' ? -1 : 1;
    const a = Number(sex[2]);
    const b = Number(sex[3] ?? 0);
    const c = Number((sex[4] ?? '0').replace(',', '.'));
    if (b >= 60 || c >= 60) return { ok: false, reason: 'invalid' };
    const abs = a + b / 60 + c / 3600;
    // RA sexagesimal ist in Stunden.
    value = sign * (kind === 'ra' ? abs * 15 : abs);
  } else {
    const dec = DECIMAL.exec(text);
    if (!dec) return { ok: false, reason: 'invalid' };
    const sign = dec[1] === '-' || dec[1] === '−' ? -1 : 1;
    value = sign * Number((dec[2] ?? '').replace(',', '.'));
  }
  if (!Number.isFinite(value)) return { ok: false, reason: 'invalid' };
  if (kind === 'ra') {
    if (value < 0 || value > 360) return { ok: false, reason: 'range' };
    return { ok: true, valueDeg: round6(value === 360 ? 0 : value) };
  }
  const { min, max } = COORD_RANGE[kind];
  if (value < min || value > max) return { ok: false, reason: 'range' };
  return { ok: true, valueDeg: round6(value) };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatCoordinate(
  kind: CoordKind,
  valueDeg: number | null,
  format: CoordFormat,
): string {
  if (valueDeg === null) return '';
  if (format === 'decimal') {
    const v = round6(valueDeg);
    // 359,9999999 rundet sonst auf „360“ (Prüfung 28.09.2026).
    return String(kind === 'ra' && v >= 360 ? 0 : v + 0);
  }
  if (kind === 'ra') {
    let totalS = Math.round(((((valueDeg % 360) + 360) % 360) / 15) * 3600 * 10) / 10;
    if (totalS >= 86400) totalS -= 86400;
    const h = Math.floor(totalS / 3600);
    const m = Math.floor((totalS - h * 3600) / 60);
    const s = totalS - h * 3600 - m * 60;
    return `${pad(h)}h ${pad(m)}m ${s.toFixed(1).padStart(4, '0')}s`;
  }
  const totalS = Math.round(Math.abs(valueDeg) * 3600);
  // Kein „−00° 00′ 00″“ für winzige negative Werte (Prüfung 28.09.2026).
  const sign = valueDeg < 0 && totalS > 0 ? '−' : kind === 'dec' ? '+' : '';
  const d = Math.floor(totalS / 3600);
  const m = Math.floor((totalS - d * 3600) / 60);
  const s = totalS - d * 3600 - m * 60;
  return `${sign}${pad(d)}° ${pad(m)}′ ${pad(s)}″`;
}
