/**
 * Zustand der Sternkarte S-20 in der URL (teilbare Links, Zurück-Taste): Blickrichtung und Sichtfeld,
 * Ausrichtung, Bildfeld (Mitte, Rotation, Mosaik), Rig und Vergleichs-Rig, Zeitpunkt, Himmelsfoto und
 * Ebenen. Ohne React; getestet in der Testdatei neben diesem Modul.
 */
import { SURVEY_IDS, type SurveyId } from './surveys';
import { OVERLAYS, PROJECT_OVERLAYS, type Overlay, type ProjectOverlay } from './render';

export const SKYMAP_PATH = '/planung/sternkarte';

export interface SkyMapState {
  /** Blickmitte J2000 (Grad). */
  readonly ra: number;
  readonly dec: number;
  /** Horizontales Sichtfeld (Grad). */
  readonly fov: number;
  readonly orient: 'north' | 'horizon';
  /** Bildfeldmitte J2000 (Grad). */
  readonly fra: number;
  readonly fdec: number;
  /** Positionswinkel des Bildfelds (Grad); `null` = Standard des Rigs. */
  readonly rot: number | null;
  readonly cols: number;
  readonly rows: number;
  readonly overlap: number;
  readonly rig: string | null;
  readonly compare: string | null;
  /** Zeitpunkt (Unix-Sekunden); `null` = jetzt. */
  readonly t: number | null;
  readonly survey: SurveyId | 'none';
  readonly overlays: ReadonlySet<Overlay>;
  readonly projects: ReadonlySet<ProjectOverlay>;
  /** Dichteregler des Katalog-Overlays: Grenzhelligkeit (mag). */
  readonly density: number;
  readonly alpha: number;
  /** Höhen-Schwelle der Sichtbarkeits-Heatmap (Grad). */
  readonly heat: number;
}

export const FOV_MIN = 0.1;
export const FOV_MAX = 180;

export const DEFAULT_OVERLAYS: readonly Overlay[] = [
  'milkyWay',
  'eqGrid',
  'constLines',
  'constLabels',
  'starNames',
  'dso',
  'dsoSizes',
  'horizon',
  'minAlt',
  'sun',
  'moon',
  'planets',
];

export const DEFAULT_STATE: SkyMapState = {
  ra: 83.82,
  dec: -5.39,
  fov: 8,
  orient: 'north',
  fra: 83.82,
  fdec: -5.39,
  rot: null,
  cols: 1,
  rows: 1,
  overlap: 20,
  rig: null,
  compare: null,
  t: null,
  survey: 'dss2color',
  overlays: new Set(DEFAULT_OVERLAYS),
  projects: new Set<ProjectOverlay>(['active', 'submitted']),
  density: 11,
  alpha: 0.9,
  heat: 30,
};

const num = (p: URLSearchParams, k: string, lo: number, hi: number): number | undefined => {
  const v = p.get(k);
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
};

const list = <T extends string>(
  p: URLSearchParams,
  k: string,
  all: readonly T[],
): Set<T> | undefined => {
  const v = p.get(k);
  if (v === null) return undefined;
  return new Set(v.split(',').filter((x): x is T => (all as readonly string[]).includes(x)));
};

export function stateFromParams(p: URLSearchParams): SkyMapState {
  const d = DEFAULT_STATE;
  const fra = num(p, 'fra', 0, 360) ?? num(p, 'ra', 0, 360) ?? d.fra;
  const fdec = num(p, 'fdec', -90, 90) ?? num(p, 'dec', -90, 90) ?? d.fdec;
  const survey = p.get('foto');
  return {
    ra: num(p, 'ra', 0, 360) ?? fra,
    dec: num(p, 'dec', -90, 90) ?? fdec,
    fov: num(p, 'fov', FOV_MIN, FOV_MAX) ?? d.fov,
    orient: p.get('ausrichtung') === 'horizont' ? 'horizon' : 'north',
    fra,
    fdec,
    rot: num(p, 'rot', 0, 360) ?? null,
    cols: Math.round(num(p, 'h', 1, 16) ?? d.cols),
    rows: Math.round(num(p, 'v', 1, 16) ?? d.rows),
    overlap: num(p, 'ueberlappung', 0, 60) ?? d.overlap,
    rig: p.get('rig'),
    compare: p.get('vergleich'),
    t: num(p, 't', 0, 1e11) ?? null,
    survey:
      survey === 'keins'
        ? 'none'
        : (SURVEY_IDS as readonly string[]).includes(survey ?? '')
          ? (survey as SurveyId)
          : d.survey,
    overlays: list(p, 'ebenen', OVERLAYS) ?? new Set(d.overlays),
    projects: list(p, 'projekte', PROJECT_OVERLAYS) ?? new Set(d.projects),
    density: num(p, 'dichte', 4, 16) ?? d.density,
    alpha: num(p, 'deckkraft', 0.1, 1) ?? d.alpha,
    heat: num(p, 'heatmap', 0, 90) ?? d.heat,
  };
}

const round = (x: number, digits: number) => String(Math.round(x * 10 ** digits) / 10 ** digits);
const sameSet = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** Nur abweichende Werte in die URL; Koordinaten auf 1e-5° (≈ 0,04″). */
export function paramsFromState(
  s: SkyMapState,
  extra: Record<string, string> = {},
): URLSearchParams {
  const d = DEFAULT_STATE;
  const p = new URLSearchParams();
  p.set('ra', round(s.ra, 5));
  p.set('dec', round(s.dec, 5));
  p.set('fov', round(s.fov, 4));
  if (s.orient === 'horizon') p.set('ausrichtung', 'horizont');
  p.set('fra', round(s.fra, 5));
  p.set('fdec', round(s.fdec, 5));
  if (s.rot !== null) p.set('rot', round(s.rot, 2));
  if (s.cols !== 1) p.set('h', String(s.cols));
  if (s.rows !== 1) p.set('v', String(s.rows));
  if (s.overlap !== d.overlap) p.set('ueberlappung', round(s.overlap, 1));
  if (s.rig) p.set('rig', s.rig);
  if (s.compare) p.set('vergleich', s.compare);
  if (s.t !== null) p.set('t', String(Math.round(s.t)));
  if (s.survey !== d.survey) p.set('foto', s.survey === 'none' ? 'keins' : s.survey);
  if (!sameSet(s.overlays, d.overlays)) p.set('ebenen', [...s.overlays].join(','));
  if (!sameSet(s.projects, d.projects)) p.set('projekte', [...s.projects].join(','));
  if (s.density !== d.density) p.set('dichte', round(s.density, 1));
  if (s.alpha !== d.alpha) p.set('deckkraft', round(s.alpha, 2));
  if (s.heat !== d.heat) p.set('heatmap', round(s.heat, 1));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p;
}

/** Link auf die Sternkarte mit Bildfeld und Blick auf ein Ziel (S-21 *Sternkarte*, Projekt-Editor). */
export function skyMapHref(target: {
  ra: number;
  dec: number;
  rot?: number | null;
  rig?: string | null;
  fov?: number;
  cols?: number;
  rows?: number;
  overlap?: number;
  project?: string;
  object?: string;
}): string {
  const s: SkyMapState = {
    ...DEFAULT_STATE,
    ra: target.ra,
    dec: target.dec,
    fra: target.ra,
    fdec: target.dec,
    fov: target.fov ?? DEFAULT_STATE.fov,
    rot: target.rot ?? null,
    rig: target.rig ?? null,
    cols: target.cols ?? 1,
    rows: target.rows ?? 1,
    overlap: target.overlap ?? DEFAULT_STATE.overlap,
  };
  const extra: Record<string, string> = {};
  if (target.project) extra.projekt = target.project;
  if (target.object) extra.objekt = target.object;
  return `${SKYMAP_PATH}?${paramsFromState(s, extra).toString()}`;
}

/** Sichtfeld, das ein Bildfeld (samt Mosaik) gut zeigt: etwa das 2,5-fache der größeren Kante. */
export function fovForFrame(wDeg: number, hDeg: number, cols = 1, rows = 1): number {
  return Math.min(FOV_MAX, Math.max(FOV_MIN * 5, 2.5 * Math.max(wDeg * cols, hDeg * rows)));
}
