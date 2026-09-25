/** Wettervorhersage S-50 (AP-23): Pfad, URL-Zustand und externe Wetterkarte (nur als Link, FA-WET-08). */

export const WEATHER_PATH = '/wetter';

export const weatherHref = (siteId: string) => `${WEATHER_PATH}?standort=${siteId}`;

/**
 * meteoblue-Wetterkarte (FA-WET-08, Vorlage astro-weather.js `mbSlug`): Koordinaten als `31.547N-99.382E`,
 * West und Süd negativ – ein `W`/`S` versteht meteoblue nicht. Nur ein Link nach Klick, kein Einbetten.
 */
export function meteoblueHref(latDeg: number, lonDeg: number, lang: string): string {
  const base =
    lang === 'en'
      ? 'https://www.meteoblue.com/en/weather/maps/'
      : 'https://www.meteoblue.com/de/wetter/maps/';
  return `${base}${latDeg.toFixed(3)}N${lonDeg.toFixed(3)}E`;
}
