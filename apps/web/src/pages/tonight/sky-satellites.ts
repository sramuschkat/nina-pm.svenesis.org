/**
 * Bahndaten für „Ereignisse der Nacht“: die täglich vom `worker` abgelegte Datei `catalog/sky/satellites.json`
 * (über CloudFront, gleicher Origin). Fehlt sie – lokal oder vor dem ersten Lauf –, gilt der mitgelieferte Stand
 * der Vorlage (`data/sky-events.json`); ab 14 Tagen Alter zeigt die Seite einen Hinweis statt Überflügen.
 */
import { SKY_SATELLITES_PATH, SkySatellitesFile } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';

async function loadSatellites(): Promise<SkySatellitesFile> {
  try {
    const res = await fetch(SKY_SATELLITES_PATH, { credentials: 'same-origin' });
    if (res.ok) return SkySatellitesFile.parse(await res.json());
  } catch {
    // Rückfall unten
  }
  const bundled = (await import('@nina-pm/catalog-data/data/sky-events.json')).default as {
    generated: string;
    satellites: unknown;
  };
  return SkySatellitesFile.parse({
    generated: bundled.generated,
    satellites: bundled.satellites,
  });
}

export function useSkySatellites() {
  return useQuery({
    queryKey: ['sky', 'satellites'],
    queryFn: loadSatellites,
    staleTime: 60 * 60 * 1000,
  });
}
