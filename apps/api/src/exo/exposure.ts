/**
 * Belichtungsempfehlung je Transit (transit.md §6): Kennwerte von Teleskop, Kamera, Standort und Filter des Rigs
 * einmal je Anfrage sammeln, je Transit `exposureAdvice` der Engine rufen. Fehlen Angaben, nennt die Antwort sie
 * (`status: 'missing'`), statt mit Annahmen zu rechnen.
 */
import {
  exposureAdvice,
  skyMagForBortle,
  type ExposureBand,
  type ExposurePoint,
  type FilterChoice,
  type TransitBand,
} from '@nina-pm/engine';
import type { ExoExposure } from '@nina-pm/shared';

type Num = number | string | null | undefined;
const num = (v: Num): number | null => (v === null || v === undefined ? null : Number(v));

export interface ExposureRig {
  readonly apertureMm: number | null;
  readonly obstructionPct: number;
  /** Wirksame Brennweite (mit Reducer). */
  readonly focalLengthMm: number | null;
  readonly pixelSizeUm: number;
  readonly readNoiseE: number | null;
  readonly saturationE: number | null;
  readonly qePct: number;
  readonly darkES: number;
  readonly gain: number | null;
  readonly elevationM: number;
  readonly bortle: number | null;
  readonly downloadS: number;
  readonly filters: ReadonlyMap<
    string,
    { readonly bandwidthNm: number | null; readonly transmissionPct: number | null }
  >;
}

interface GainModeRow {
  gain: number;
  readNoiseE: number | null;
  fullWellE: number | null;
  ePerAdu: number | null;
}

/** Rig-Kennwerte; Gain-Modus des Standard-Gains vor den Kamerawerten, Dunkelstrom halbiert je 6 °C Kühlung. */
export function exposureRig(p: {
  telescope:
    { apertureMm: Num; focalLengthMm: Num; reducerFactor: Num; obstructionPct: Num } | undefined;
  camera:
    | {
        pixelSizeUm: Num;
        bitDepth: Num;
        readNoiseE: Num;
        fullWellE: Num;
        gainEPerAdu: Num;
        quantumEfficiencyPct: Num;
        darkCurrentES20c: Num;
        isCooled: boolean;
        coolingSetpointC: Num;
        defaultGain: number | null;
        gainModes: readonly GainModeRow[];
      }
    | undefined;
  site: { elevationM: Num; bortleClass: Num };
  downloadS: number;
  filters: readonly { id: string; bandwidthNm: Num; transmissionPct: Num }[];
}): ExposureRig {
  const t = p.telescope;
  const c = p.camera;
  const mode =
    c && c.defaultGain !== null ? c.gainModes.find((m) => m.gain === c.defaultGain) : undefined;
  const fullWell = num(mode?.fullWellE) ?? num(c?.fullWellE);
  const ePerAdu = num(mode?.ePerAdu) ?? num(c?.gainEPerAdu);
  const adc = ePerAdu === null ? null : (Math.pow(2, num(c?.bitDepth) ?? 16) - 1) * ePerAdu;
  const limits = [fullWell, adc].filter((x): x is number => x !== null && x > 0);
  const dark20 = num(c?.darkCurrentES20c) ?? 0;
  const setpoint = num(c?.coolingSetpointC);
  const aperture = num(t?.apertureMm);
  const focal = num(t?.focalLengthMm);
  return {
    apertureMm: aperture,
    obstructionPct: num(t?.obstructionPct) ?? 0,
    focalLengthMm: focal === null ? null : focal * (num(t?.reducerFactor) ?? 1),
    pixelSizeUm: num(c?.pixelSizeUm) ?? 0,
    readNoiseE: num(mode?.readNoiseE) ?? num(c?.readNoiseE),
    saturationE: c && limits.length > 0 ? Math.min(...limits) : null,
    qePct: num(c?.quantumEfficiencyPct) ?? 80,
    darkES: c?.isCooled && setpoint !== null ? dark20 * Math.pow(2, (setpoint - 20) / 6) : dark20,
    gain: c?.defaultGain ?? null,
    elevationM: num(p.site.elevationM) ?? 0,
    bortle: num(p.site.bortleClass),
    downloadS: p.downloadS,
    filters: new Map(
      p.filters.map((f) => [
        f.id,
        { bandwidthNm: num(f.bandwidthNm), transmissionPct: num(f.transmissionPct) },
      ]),
    ),
  };
}

const round = (x: number, digits: number) => Number(x.toFixed(digits));

function view(p: ExposurePoint) {
  return {
    exposureS: p.exposureS,
    fwhmArcsec: round(p.fwhmArcsec, 1),
    peakPct: round(p.peakFraction * 100, 0),
    framesInWindow: p.framesInWindow,
    precisionMmag: round(p.precisionMmag, 1),
    transitSnr: round(p.transitSnr, 1),
  };
}

export interface ExposureTarget {
  readonly band: TransitBand;
  readonly choice: FilterChoice | null;
  /** `false` = Filter eines unbestätigten Platzes (Ersatz, transit.md §6). */
  readonly filterConfirmed?: boolean;
  readonly magR: number | null;
  readonly magV: number | null;
  readonly mag: number | null;
  readonly depthMmag: number | null;
  readonly durationH: number;
  readonly rpOverRs: number | null;
  readonly windowS: number;
  readonly altMaxDeg: number;
  readonly altMidDeg: number;
}

export function exposureFor(x: ExposureTarget, rig: ExposureRig): ExoExposure {
  const missing: Extract<ExoExposure, { status: 'missing' }>['missing'] = [];
  if (rig.apertureMm === null || rig.focalLengthMm === null) missing.push('telescope');
  if (rig.readNoiseE === null || !(rig.pixelSizeUm > 0)) missing.push('camera_noise');
  if (rig.saturationE === null) missing.push('camera_saturation');
  if (x.choice === null) missing.push('filter');
  const band: ExposureBand =
    x.choice === null || x.choice.match === 'lum'
      ? 'lum'
      : x.choice.match === 'same_band'
        ? x.band
        : 'Rc';
  const mag = band === 'lum' ? (x.magV ?? x.mag) : (x.magR ?? x.mag);
  if (mag === null) missing.push('magnitude');
  if (x.depthMmag === null || !(x.depthMmag > 0)) missing.push('depth');
  if (missing.length > 0 || x.choice === null || mag === null || x.depthMmag === null)
    return { status: 'missing', missing: missing.length > 0 ? missing : ['filter'] };
  const filter = rig.filters.get(x.choice.filterId);
  const skyV = skyMagForBortle(rig.bortle);
  const a = exposureAdvice({
    band,
    mag,
    depthMmag: x.depthMmag,
    durationH: x.durationH,
    rpOverRs: x.rpOverRs,
    windowS: x.windowS,
    altMaxDeg: x.altMaxDeg,
    altMidDeg: x.altMidDeg,
    apertureMm: rig.apertureMm as number,
    obstructionPct: rig.obstructionPct,
    focalLengthMm: rig.focalLengthMm as number,
    pixelSizeUm: rig.pixelSizeUm,
    readNoiseE: rig.readNoiseE as number,
    saturationE: rig.saturationE as number,
    qePct: rig.qePct,
    darkES: rig.darkES,
    bandwidthNm: filter?.bandwidthNm ?? null,
    transmissionPct: filter?.transmissionPct ?? null,
    skyMagArcsec2V: skyV,
    elevationM: rig.elevationM,
    downloadS: rig.downloadS,
  });
  return {
    status: 'ok',
    ...view(a),
    filterShortName: x.choice.shortName,
    filterConfirmed: x.filterConfirmed ?? true,
    gain: rig.gain,
    defocus: a.defocus,
    limitedBy: a.limitedBy,
    inFocus: a.inFocus === null ? null : view(a.inFocus),
    skyMagArcsec2: round(a.skyMagArcsec2, 2),
    bortle: rig.bortle,
    airmass: round(a.airmass, 2),
  };
}
