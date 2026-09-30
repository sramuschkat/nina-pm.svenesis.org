/**
 * S-22 Exoplaneten (AP-42): URL-Zustand (Rig, Nacht, gewählter Transit), Filter der Transitsuche (FA-EXO-05) als
 * reine Funktion und Recherche-Links (FA-EXO-09). Die Filter gelten in der Oberfläche; die Transits der Nacht
 * rechnet der Server einmal je Rig, Nacht, Katalogauswahl und Mindesthöhe.
 */
import type { ExoSearchSettings, ExoTransitView } from '../../api/client';

export const EXO_PATH = '/planung/exoplaneten';

/** Vorgaben der Filter (FA-EXO-05; ExoClock ist der Standardkatalog, FA-EXO-02). */
export { EXO_SEARCH_DEFAULTS } from '@nina-pm/shared';

export interface ExoUrl {
  readonly rig: string;
  readonly night: string;
  /** Schlüssel des gewählten Transits (`<catalog>:<planet>:<n>`). */
  readonly sel: string;
}

export const urlFromParams = (p: URLSearchParams): ExoUrl => ({
  rig: p.get('rig') ?? '',
  night: /^\d{4}-\d{2}-\d{2}$/.test(p.get('night') ?? '') ? (p.get('night') as string) : '',
  sel: p.get('sel') ?? '',
});

export const paramsFromUrl = (u: ExoUrl): URLSearchParams =>
  new URLSearchParams(Object.entries(u).filter(([, v]) => v !== '') as [string, string][]);

const PRIORITY_RANK: Readonly<Record<string, number>> = { alert: 0, high: 1, medium: 2, low: 3 };

/** „nur Alert / High und höher / Medium und höher“ (FA-EXO-05); ohne ExoClock-Priorität fällt der Planet heraus. */
function priorityOk(t: ExoTransitView, p: ExoSearchSettings['priority']): boolean {
  if (p === 'all') return true;
  const rank = t.priority === null ? undefined : PRIORITY_RANK[t.priority];
  return rank !== undefined && rank <= (PRIORITY_RANK[p] ?? 3);
}

/**
 * Filter der Transitsuche (FA-EXO-05). Fehlt Helligkeit oder Tiefe, bleibt der Transit sichtbar (der Vorfilter
 * des Imports hat NASA/TOI schon danach gesiebt).
 */
export function applyExoFilters(
  items: readonly ExoTransitView[],
  s: ExoSearchSettings,
): ExoTransitView[] {
  return items.filter((t) => {
    if (!priorityOk(t, s.priority)) return false;
    if (t.mag !== null && t.mag > s.maxMag) return false;
    if (t.depthMmag !== null && t.depthMmag < s.minDepthMmag) return false;
    if (s.observableOnly && !t.transit.observable) return false;
    if (s.startEndDark && !(t.transit.startDark && t.transit.endDark)) return false;
    if (s.startEndAboveMinAlt && !(t.transit.startAboveMinAlt && t.transit.endAboveMinAlt))
      return false;
    // Nur ein Flip zwischen Ingress und Egress blendet aus (Entscheidung Sven 30.09.2026); im Fenster wird markiert.
    if (s.hideFlip && t.transit.meridianInTransit) return false;
    return true;
  });
}

/** Lichtjahre aus Parsec (Anzeige, AST-D14). */
export const lightYears = (pc: number) => pc * 3.26156;

/** Recherche-Links (FA-EXO-09): NASA bzw. ExoFOP (TOI), ExoClock, SIMBAD. */
export function researchLinks(t: ExoTransitView): { name: string; href: string }[] {
  const links: { name: string; href: string }[] = [];
  if (
    t.catalog === 'toi' ||
    (t.ticId !== null && !t.alsoIn.includes('nasa') && t.catalog !== 'nasa')
  )
    links.push({
      name: 'ExoFOP',
      href: `https://exofop.ipac.caltech.edu/tess/target.php?id=${encodeURIComponent(t.ticId ?? t.planet)}`,
    });
  if (t.catalog === 'nasa' || t.alsoIn.includes('nasa'))
    links.push({
      name: 'NASA',
      href: `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(t.star)}`,
    });
  if (t.catalog === 'exoclock' || t.alsoIn.includes('exoclock'))
    links.push({
      name: 'ExoClock',
      href: `https://www.exoclock.space/database/planets/${encodeURIComponent(t.planet.replace(/\s+/g, ''))}/`,
    });
  links.push({
    name: 'SIMBAD',
    href: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(t.star)}`,
  });
  return links;
}
