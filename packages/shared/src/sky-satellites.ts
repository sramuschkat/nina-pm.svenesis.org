/**
 * Bahndaten für „Ereignisse der Nacht“ (Heute Nacht, Wunsch Sven 27.09.2026): TLEs der Raumstationen und des
 * Hubble-Teleskops von CelesTrak, täglich vom `worker` (Zeitplan `daily`) nach `webBucket/catalog/sky/` gelegt
 * und von der Oberfläche über CloudFront gelesen. Format wie `satellites` in `data/sky-events.json` der
 * Vorlage (`tools/sky-events-data.js`); Grundhelligkeit `std` (1000 km, halb beleuchtet) nach Heavens-Above.
 */
import { z } from 'zod';

/** Objektschlüssel im Web-Bucket und Pfad unter dem Origin (iam.md §3: `catalog/sky/*`). */
export const SKY_SATELLITES_KEY = 'catalog/sky/satellites.json';
export const SKY_SATELLITES_PATH = `/${SKY_SATELLITES_KEY}`;

/** Überflug-Vorhersagen gelten etwa zwei Wochen nach der TLE-Epoche (Vorlage `evStale`). */
export const SKY_TLE_MAX_AGE_DAYS = 14;

export const SKY_SATELLITES = [
  { id: 25544, name: 'ISS', std: -1.8 },
  { id: 48274, name: 'Tiangong', std: 0 },
  { id: 20580, name: 'Hubble', std: 2.2 },
] as const;

const tleLine = (n: '1' | '2') =>
  z
    .string()
    .length(69)
    .refine((l) => l.startsWith(`${n} `), `TLE-Zeile ${n}`);

export const SkySatellite = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(40),
  std: z.number(),
  tle1: tleLine('1'),
  tle2: tleLine('2'),
});
export type SkySatellite = z.infer<typeof SkySatellite>;

export const SkySatellitesFile = z.object({
  /** Zeitpunkt des Abrufs (ISO 8601, UTC). */
  generated: z.string().datetime(),
  satellites: z.array(SkySatellite).min(1).max(10),
});
export type SkySatellitesFile = z.infer<typeof SkySatellitesFile>;

/**
 * TLE-Prüfsumme (Spalte 69): Summe der Ziffern, `-` zählt 1, modulo 10. Schützt vor abgeschnittenen oder
 * verfälschten Antworten.
 */
export function tleChecksumOk(line: string): boolean {
  if (line.length !== 69) return false;
  let sum = 0;
  for (const ch of line.slice(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

/**
 * Die beiden TLE-Zeilen einer CelesTrak-Antwort (`gp.php?CATNR=…&FORMAT=TLE`: Name, Zeile 1, Zeile 2) für
 * genau die erwartete Katalognummer; `null` bei allem anderen.
 */
export function parseCelestrakTle(
  text: string,
  catalogNumber: number,
): { tle1: string; tle2: string } | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const tle1 = lines.find((l) => l.startsWith('1 '));
  const tle2 = lines.find((l) => l.startsWith('2 '));
  if (!tle1 || !tle2) return null;
  const id = String(catalogNumber).padStart(5, '0');
  if (tle1.slice(2, 7) !== id || tle2.slice(2, 7) !== id) return null;
  if (!tleChecksumOk(tle1) || !tleChecksumOk(tle2)) return null;
  return { tle1, tle2 };
}
