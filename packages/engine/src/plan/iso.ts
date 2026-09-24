/**
 * ISO-8601-Zeitpunkte (`YYYY-MM-DDTHH:MM:SSZ`, ganze Sekunden, canonical-json.md Regel 8) und
 * deterministische UUID v7 für Plan- und Block-IDs (allocation.md §8.4) – ohne `Date` und `crypto`.
 */
import { civilFromDays, daysFromCivil, EngineInputError } from '../astro/time';
import { sha256hex } from '../hash/sha256';

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function isoFromUnix(sec: number): string {
  const s = Math.floor(sec);
  const days = Math.floor(s / 86400);
  const rem = s - days * 86400;
  const { y, m, d } = civilFromDays(days);
  const hh = Math.floor(rem / 3600);
  const mm = Math.floor((rem - hh * 3600) / 60);
  const ss = rem - hh * 3600 - mm * 60;
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}T${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}Z`;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

/** ISO-8601 in UTC (`…Z`) → Unix-Sekunden; Bruchteile werden abgeschnitten. */
export function unixFromIso(iso: string): number {
  const m = ISO.exec(iso);
  if (!m) throw new EngineInputError('engine.input_invalid', `Zeitpunkt ${iso}`);
  const [y, mo, d, hh, mi, ss] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return daysFromCivil(y, mo, d) * 86400 + hh * 3600 + mi * 60 + ss;
}

/**
 * UUID v7 aus einem Hash: 48 Bit Zeitstempel (ms), Version 7, Variante 10, Rest aus
 * `sha256(hash:n)` – gleiche Eingabe → gleiche ID (`uuidv7FromHash(nightPlanInputHash, n)`).
 */
export function uuidv7FromHash(hash: string, n: number, unixSec: number): string {
  const msHex = hexOf(Math.floor(unixSec) * 1000, 12);
  const r = sha256hex(`${hash}:${String(n)}`);
  const variant = hexOf((parseInt(r.slice(15, 16), 16) % 4) + 8, 1);
  return `${msHex.slice(0, 8)}-${msHex.slice(8, 12)}-7${r.slice(0, 3)}-${variant}${r.slice(3, 6)}-${r.slice(6, 18)}`;
}

/** Nicht negative ganze Zahl → Hex mit fester Breite (ohne `toString(radix)`, rules/engine.md Nr. 4). */
function hexOf(value: number, width: number): string {
  const digits = '0123456789abcdef';
  let v = Math.floor(value);
  let out = '';
  for (let i = 0; i < width; i++) {
    const d = v % 16;
    out = (digits[d] ?? '0') + out;
    v = Math.floor(v / 16);
  }
  return out;
}
