/**
 * Bahndaten für „Ereignisse der Nacht“ (Wunsch Sven 27.09.2026, Entscheidung „täglicher Job“): einmal täglich
 * (`daily`) die TLEs der Raumstationen und des Hubble-Teleskops von CelesTrak holen, prüfen und als
 * `catalog/sky/satellites.json` in den Web-Bucket legen (iam.md §3, nur `catalog/sky/*`). Alles oder nichts:
 * fehlt eine Bahn oder ist sie ungültig, bleibt die Datei vom Vortag stehen und der nächste Lauf holt nach –
 * die Oberfläche zeigt ab 14 Tagen Alter einen Hinweis statt einer Vorhersage.
 */
import {
  parseCelestrakTle,
  SKY_SATELLITES,
  SKY_SATELLITES_KEY,
  SkySatellitesFile,
  type SkySatellite,
} from '@nina-pm/shared';

export const CELESTRAK_URL = (id: number) =>
  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${String(id)}&FORMAT=TLE`;
export const CELESTRAK_TIMEOUT_MS = 15_000;

export interface SkySatellitesDeps {
  /** Text einer HTTPS-Antwort (Zeitlimit und Wiederholung im Client). */
  readonly fetchText: (url: string) => Promise<string>;
  /** Legt die Datei unter `key` ab (nur `catalog/sky/*`). */
  readonly put: (key: string, body: string) => Promise<void>;
  readonly now: () => Date;
}

/** Holt alle Bahnen und schreibt die Datei; liefert die Zahl der Satelliten. */
export async function refreshSkySatellites(deps: SkySatellitesDeps): Promise<number> {
  const satellites: SkySatellite[] = [];
  for (const s of SKY_SATELLITES) {
    const tle = parseCelestrakTle(await deps.fetchText(CELESTRAK_URL(s.id)), s.id);
    if (!tle) throw new Error(`CelesTrak: keine gültige TLE für ${s.name} (${String(s.id)})`);
    satellites.push({ id: s.id, name: s.name, std: s.std, ...tle });
  }
  const file = SkySatellitesFile.parse({ generated: deps.now().toISOString(), satellites });
  await deps.put(SKY_SATELLITES_KEY, `${JSON.stringify(file)}\n`);
  return satellites.length;
}
