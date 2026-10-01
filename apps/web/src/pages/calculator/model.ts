/**
 * Rechner S-23 (AP-61, `docs/specs/engine/calculator.md`): Felder, Vorbelegung aus Rig und Filter, URL-Zustand
 * und die drei Rechnungen. Gerechnet wird im Browser mit der Engine (Belichtung, Sampling) bzw. derselben
 * Empfehlung wie die Karte *Belichtung* in S-22 (`exposureAdvice` + `exposureResult`, Modus *Exoplanet-Stern*).
 */
import {
  calculatorBand,
  DEFAULT_SEEING_ARCSEC,
  DEFAULT_SWAMP_FACTOR,
  exposureAdvice,
  MAX_SWAMP_FACTOR,
  MIN_SWAMP_FACTOR,
  sampling,
  skyMagForBortle,
  subExposure,
  type ExposureBand,
  type Sampling,
  type SubExposure,
} from '@nina-pm/engine';
import { exposureResult, exposureRig, type ExoExposure } from '@nina-pm/shared';
import type { Item as EquipmentItem } from '../equipment/shared';

export const CALC_PATH = '/planung/rechner';
export const CALC_TABS = ['exposure', 'sampling', 'exo'] as const;
export type CalcTab = (typeof CALC_TABS)[number];
export const CALC_BANDS: readonly ExposureBand[] = ['lum', 'V', 'Rc', 'Ic'];

/** Felder der Ausrüstung (links), vorbelegt aus Rig und Filter. */
export const EQUIPMENT_FIELDS = [
  'apertureMm',
  'obstructionPct',
  'focalLengthMm',
  'pixelSizeUm',
  'widthPx',
  'heightPx',
  'readNoiseE',
  'saturationE',
  'qePct',
  'darkES',
  'bandwidthNm',
  'transmissionPct',
  'skyMag',
  'elevationM',
  'downloadS',
] as const;
/** Felder der Reiter; Ziel-Felder des Exoplanet-Sterns kommen auch aus S-22 (URL). */
export const TAB_FIELDS = [
  'swampFactor',
  'seeingArcsec',
  'mag',
  'depthMmag',
  'durationH',
  'rpOverRs',
  'windowH',
  'altMaxDeg',
  'altMidDeg',
] as const;
export type FieldKey = (typeof EQUIPMENT_FIELDS)[number] | (typeof TAB_FIELDS)[number];
export type Fields = Readonly<Record<FieldKey, string>>;

/** Einheit je Feld (i18n-frei). */
export const UNITS: Readonly<Record<FieldKey, string>> = {
  apertureMm: 'mm',
  obstructionPct: '%',
  focalLengthMm: 'mm',
  pixelSizeUm: 'µm',
  widthPx: 'px',
  heightPx: 'px',
  readNoiseE: 'e⁻',
  saturationE: 'e⁻',
  qePct: '%',
  darkES: 'e⁻/s',
  bandwidthNm: 'nm',
  transmissionPct: '%',
  skyMag: 'mag/″²',
  elevationM: 'm',
  downloadS: 's',
  swampFactor: '× RN²',
  seeingArcsec: '″',
  mag: 'mag',
  depthMmag: 'mmag',
  durationH: 'h',
  rpOverRs: 'Rp/R★',
  windowH: 'h',
  altMaxDeg: '°',
  altMidDeg: '°',
};

/** Zahl aus einem Feld: Komma oder Punkt, leer bzw. ungültig = `null`. */
export function parseNum(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Feldwert ohne überflüssige Nachkommastellen (Punkt; die Felder nehmen auch Komma an). */
const str = (n: number | null, digits = 3): string =>
  n === null || !Number.isFinite(n) ? '' : String(Number(n.toFixed(digits)));

type Rig = EquipmentItem<'rigs'>;
type Site = EquipmentItem<'sites'>;
type Telescope = EquipmentItem<'telescopes'>;
type Camera = EquipmentItem<'cameras'>;
type Filter = EquipmentItem<'filters'>;

export interface RigContext {
  readonly rig: Rig | null;
  readonly site: Site | null;
  readonly telescope: Telescope | null;
  readonly camera: Camera | null;
  readonly filter: Filter | null;
}

/** Band des gewählten Filters (ohne Filter Luminanz). */
export function bandFor(filter: Filter | null): ExposureBand {
  return filter
    ? calculatorBand({
        photometricBand: filter.photometricBand,
        filterType: filter.filterType,
        centerWavelengthNm: filter.centerWavelengthNm,
      })
    : 'lum';
}

/**
 * Vorbelegung aus Rig, Standort, Teleskop, Kamera und Filter: dieselben Kennwerte wie die Belichtungsempfehlung
 * der Transitsuche (`exposureRig`: Gain-Modus des Standard-Gains, Sättigung, Dunkelstrom bei Kühlung), Himmel aus
 * der Bortle-Klasse (ohne Angabe 4). Ohne Angabe bleibt ein Feld leer.
 */
export function rigDefaults(c: RigContext): Fields {
  const r = exposureRig({
    telescope: c.telescope ?? undefined,
    camera: c.camera ?? undefined,
    site: { elevationM: c.site?.elevationM ?? null, bortleClass: c.site?.bortleClass ?? null },
    downloadS: c.rig?.scheduler.overhead.downloadS ?? 0,
    filters: c.filter ? [c.filter] : [],
  });
  const f = c.filter ? r.filters.get(c.filter.id) : undefined;
  return {
    apertureMm: str(r.apertureMm, 1),
    obstructionPct: str(r.obstructionPct, 1),
    focalLengthMm: str(r.focalLengthMm, 1),
    pixelSizeUm: c.camera ? str(r.pixelSizeUm, 2) : '',
    widthPx: str(c.camera?.widthPx ?? null, 0),
    heightPx: str(c.camera?.heightPx ?? null, 0),
    readNoiseE: str(r.readNoiseE, 2),
    saturationE: str(r.saturationE, 0),
    qePct: c.camera ? str(r.qePct, 0) : '',
    darkES: c.camera ? str(r.darkES, 4) : '',
    bandwidthNm: str(f?.bandwidthNm ?? null, 1),
    transmissionPct: str(f?.transmissionPct ?? null, 0),
    skyMag: str(skyMagForBortle(r.bortle), 2),
    elevationM: str(r.elevationM, 0),
    downloadS: str(r.downloadS, 1),
    swampFactor: String(DEFAULT_SWAMP_FACTOR),
    seeingArcsec: String(DEFAULT_SEEING_ARCSEC),
    mag: '',
    depthMmag: '',
    durationH: '',
    rpOverRs: '',
    windowH: '',
    altMaxDeg: '',
    altMidDeg: '',
  };
}

// ---- URL ------------------------------------------------------------------------------------------

/** Ziel-Felder, die S-22 („Im Rechner öffnen“) über die URL mitgibt. */
const URL_TARGET: readonly (readonly [FieldKey, string])[] = [
  ['mag', 'mag'],
  ['depthMmag', 'depth'],
  ['durationH', 't14'],
  ['rpOverRs', 'k'],
  ['windowH', 'window'],
  ['altMaxDeg', 'altMax'],
  ['altMidDeg', 'altMid'],
];

export interface CalcUrl {
  readonly tab: CalcTab;
  readonly rig: string;
  readonly filter: string;
  readonly band: ExposureBand | null;
  readonly star: string;
  readonly target: Partial<Record<FieldKey, string>>;
}

export function urlFromParams(p: URLSearchParams): CalcUrl {
  const tab = p.get('tab');
  const band = p.get('band');
  const target: Partial<Record<FieldKey, string>> = {};
  for (const [field, key] of URL_TARGET) {
    const v = p.get(key);
    if (v !== null && parseNum(v) !== null) target[field] = v;
  }
  return {
    tab: (CALC_TABS as readonly string[]).includes(tab ?? '') ? (tab as CalcTab) : 'exposure',
    rig: p.get('rig') ?? '',
    filter: p.get('filter') ?? '',
    band: (CALC_BANDS as readonly string[]).includes(band ?? '') ? (band as ExposureBand) : null,
    star: p.get('star') ?? '',
    target,
  };
}

export function paramsFromUrl(u: CalcUrl): URLSearchParams {
  const p = new URLSearchParams();
  if (u.tab !== 'exposure') p.set('tab', u.tab);
  if (u.rig) p.set('rig', u.rig);
  if (u.filter) p.set('filter', u.filter);
  if (u.band) p.set('band', u.band);
  if (u.star) p.set('star', u.star);
  for (const [field, key] of URL_TARGET) {
    const v = u.target[field];
    if (v !== undefined && v !== '') p.set(key, v);
  }
  return p;
}

/** Link aus der Belichtungskarte von S-22 in den Reiter *Exoplanet-Stern* (FA-EXO-14 Aktion *Rechner*). */
export function exoCalculatorHref(x: {
  rigId: string;
  filterId: string | null;
  star: string;
  band: ExposureBand;
  mag: number | null;
  depthMmag: number | null;
  durationH: number;
  rpOverRs: number | null;
  windowS: number;
  altMaxDeg: number;
  altMidDeg: number;
}): string {
  const p = paramsFromUrl({
    tab: 'exo',
    rig: x.rigId,
    filter: x.filterId ?? '',
    band: x.band,
    star: x.star,
    target: {
      mag: str(x.mag, 3),
      depthMmag: str(x.depthMmag, 2),
      durationH: str(x.durationH, 3),
      rpOverRs: str(x.rpOverRs, 4),
      windowH: str(x.windowS / 3600, 3),
      altMaxDeg: str(x.altMaxDeg, 1),
      altMidDeg: str(x.altMidDeg, 1),
    },
  });
  return `${CALC_PATH}?${p.toString()}`;
}

// ---- Rechnungen -----------------------------------------------------------------------------------

export type Calc<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'missing'; readonly missing: readonly FieldKey[] }
  | { readonly status: 'invalid'; readonly invalid: readonly FieldKey[] };

/** Pflichtfelder lesen; fehlende bzw. nicht positive Werte sammeln. */
function read<K extends FieldKey>(
  v: Fields,
  required: readonly K[],
  allowZero: readonly FieldKey[] = [],
): { values: Record<K, number>; missing: FieldKey[]; invalid: FieldKey[] } {
  const values = {} as Record<K, number>;
  const missing: FieldKey[] = [];
  const invalid: FieldKey[] = [];
  for (const k of required) {
    const n = parseNum(v[k]);
    if (n === null) missing.push(k);
    else if (n < 0 || (n === 0 && !allowZero.includes(k))) invalid.push(k);
    else values[k] = n;
  }
  return { values, missing, invalid };
}

const optional = (v: Fields, k: FieldKey): number | null => {
  const n = parseNum(v[k]);
  return n === null || n < 0 ? null : n;
};

function result<T>(r: { missing: FieldKey[]; invalid: FieldKey[] }, value: () => T): Calc<T> {
  if (r.missing.length > 0) return { status: 'missing', missing: r.missing };
  if (r.invalid.length > 0) return { status: 'invalid', invalid: r.invalid };
  return { status: 'ok', value: value() };
}

export function computeExposure(v: Fields, band: ExposureBand): Calc<SubExposure> {
  const r = read(v, [
    'apertureMm',
    'focalLengthMm',
    'pixelSizeUm',
    'readNoiseE',
    'qePct',
    'skyMag',
    'swampFactor',
  ] as const);
  const swamp = r.values.swampFactor;
  if (swamp !== undefined && (swamp < MIN_SWAMP_FACTOR || swamp > MAX_SWAMP_FACTOR))
    r.invalid.push('swampFactor');
  return result(r, () =>
    subExposure({
      band,
      bandwidthNm: optional(v, 'bandwidthNm') || null,
      transmissionPct: optional(v, 'transmissionPct'),
      apertureMm: r.values.apertureMm,
      obstructionPct: Math.min(optional(v, 'obstructionPct') ?? 0, 90),
      focalLengthMm: r.values.focalLengthMm,
      pixelSizeUm: r.values.pixelSizeUm,
      qePct: r.values.qePct,
      skyMagArcsec2V: r.values.skyMag,
      readNoiseE: r.values.readNoiseE,
      darkES: optional(v, 'darkES') ?? 0,
      saturationE: optional(v, 'saturationE') || null,
      swampFactor: r.values.swampFactor,
    }),
  );
}

export function computeSampling(v: Fields): Calc<Sampling> {
  const r = read(v, ['focalLengthMm', 'pixelSizeUm', 'seeingArcsec'] as const);
  return result(r, () =>
    sampling({
      focalLengthMm: r.values.focalLengthMm,
      pixelSizeUm: r.values.pixelSizeUm,
      widthPx: optional(v, 'widthPx') || null,
      heightPx: optional(v, 'heightPx') || null,
      seeingArcsec: r.values.seeingArcsec,
    }),
  );
}

export function computeExo(
  v: Fields,
  x: { band: ExposureBand; filterShortName: string; gain: number | null; bortle: number | null },
): Calc<Extract<ExoExposure, { status: 'ok' }>> {
  const r = read(
    v,
    [
      'apertureMm',
      'focalLengthMm',
      'pixelSizeUm',
      'readNoiseE',
      'saturationE',
      'qePct',
      'skyMag',
      'mag',
      'depthMmag',
      'durationH',
      'windowH',
      'altMaxDeg',
      'altMidDeg',
    ] as const,
    ['mag'],
  );
  // Sternhelligkeit darf negativ sein (sehr helle Sterne), Höhen höchstens 90°.
  const mag = parseNum(v.mag);
  if (mag !== null && mag < 0) {
    r.invalid.splice(r.invalid.indexOf('mag'), 1);
    r.values.mag = mag;
  }
  for (const k of ['altMaxDeg', 'altMidDeg'] as const)
    if ((r.values[k] ?? 0) > 90) r.invalid.push(k);
  return result(r, () =>
    exposureResult(
      exposureAdvice({
        band: x.band,
        mag: r.values.mag,
        depthMmag: r.values.depthMmag,
        durationH: r.values.durationH,
        rpOverRs: optional(v, 'rpOverRs') || null,
        windowS: r.values.windowH * 3600,
        altMaxDeg: r.values.altMaxDeg,
        altMidDeg: r.values.altMidDeg,
        apertureMm: r.values.apertureMm,
        obstructionPct: Math.min(optional(v, 'obstructionPct') ?? 0, 90),
        focalLengthMm: r.values.focalLengthMm,
        pixelSizeUm: r.values.pixelSizeUm,
        readNoiseE: r.values.readNoiseE,
        saturationE: r.values.saturationE,
        qePct: r.values.qePct,
        darkES: optional(v, 'darkES') ?? 0,
        bandwidthNm: optional(v, 'bandwidthNm') || null,
        transmissionPct: optional(v, 'transmissionPct'),
        skyMagArcsec2V: r.values.skyMag,
        elevationM: optional(v, 'elevationM') ?? 0,
        downloadS: optional(v, 'downloadS') ?? 0,
      }),
      {
        band: x.band,
        mag: r.values.mag,
        filterShortName: x.filterShortName,
        filterConfirmed: true,
        gain: x.gain,
        bortle: x.bortle,
      },
    ),
  );
}
