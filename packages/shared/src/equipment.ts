/**
 * Berechnete Werte der Ausrüstung (specs/engine/geometry.md §1, FA-TEL-03, FA-KAM-05/06, FA-RIG-02),
 * die Vorschlagsheuristik der Filterradbelegung (FA-RIG-14, NT-E1, Kap. 8.6) und die Prüfung von
 * Sortierkette und Flip (sort-chain.md, flip-rotation.md §1). Browser und API rechnen dasselbe.
 */
import { ProblemError } from './errors';
import { sortChainKeys } from './generated/enums';

/** Rundung wie die Engine: halbe Werte vom Nullpunkt weg, Kehrwert statt Schritt (canonical-json.md). */
const round = (x: number, inv: number) =>
  (x >= 0 ? Math.floor(x * inv + 0.5) : -Math.floor(-x * inv + 0.5)) / inv;

export interface ScaleInput {
  readonly focalLengthMm: number;
  readonly reducerFactor: number;
  readonly pixelSizeUm: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * geometry.md §1: effFocalMm = f · reducer; scale = 206,265 · pixel / effFocal (″/px, ungebinnt);
 * Bildfeld = scale · px / 3600 (bleibt bei Binning gleich). Maßstab 3, Bildfeld 4 Nachkommastellen.
 */
export function imageScale(input: ScaleInput, binning = 1) {
  const effFocalMm = input.focalLengthMm * input.reducerFactor;
  const scale = (206.265 * input.pixelSizeUm) / effFocalMm;
  return {
    effFocalMm: round(effFocalMm, 1e3),
    scaleArcsecPx: round(scale, 1e3),
    scaleBinnedArcsecPx: round(scale * binning, 1e3),
    fovWidthDeg: round((scale * input.widthPx) / 3600, 1e4),
    fovHeightDeg: round((scale * input.heightPx) / 3600, 1e4),
    fovDiagonalDeg: round(
      (scale * Math.sqrt(input.widthPx * input.widthPx + input.heightPx * input.heightPx)) / 3600,
      1e4,
    ),
  };
}

/** Teleskop (FA-TEL-03): Öffnungsverhältnis, effektive Brennweite, Dawes/Rayleigh (″), Airy-Scheibchen (µm). */
export function telescopeDerived(t: {
  apertureMm: number;
  focalLengthMm: number;
  reducerFactor: number;
}) {
  const effFocal = t.focalLengthMm * t.reducerFactor;
  const fRatioNative = t.focalLengthMm / t.apertureMm;
  const fRatioEff = effFocal / t.apertureMm;
  return {
    effFocalMm: round(effFocal, 1e1),
    fRatioNative: round(fRatioNative, 1e2),
    fRatioEffective: round(fRatioEff, 1e2),
    dawesArcsec: round(116 / t.apertureMm, 1e2),
    rayleighArcsec: round(138 / t.apertureMm, 1e2),
    /** Durchmesser des Airy-Scheibchens bis zum ersten Minimum, 2,44 · λ · N bei λ = 550 nm. */
    airyDiskUm: round(2.44 * 0.55 * fRatioEff, 1e2),
  };
}

/** Kamera (FA-KAM-05/06): Sensorgröße, Diagonale, Megapixel, Dynamik (Blenden), max. ADU, je Binning. */
export function cameraDerived(c: {
  widthPx: number;
  heightPx: number;
  pixelSizeUm: number;
  bitDepth: number;
  fullWellE: number | null;
  readNoiseE: number | null;
  supportedBinning: readonly number[];
}) {
  const widthMm = (c.widthPx * c.pixelSizeUm) / 1000;
  const heightMm = (c.heightPx * c.pixelSizeUm) / 1000;
  const dynamic =
    c.fullWellE !== null && c.readNoiseE !== null && c.readNoiseE > 0
      ? round(Math.log2(c.fullWellE / c.readNoiseE), 1e2)
      : null;
  return {
    sensorWidthMm: round(widthMm, 1e2),
    sensorHeightMm: round(heightMm, 1e2),
    sensorDiagonalMm: round(Math.sqrt(widthMm * widthMm + heightMm * heightMm), 1e2),
    megapixels: round((c.widthPx * c.heightPx) / 1e6, 1e2),
    aspectRatio: round(c.widthPx / c.heightPx, 1e3),
    dynamicRangeStops: dynamic,
    maxAdu: 2 ** c.bitDepth - 1,
    binned: [...c.supportedBinning]
      .sort((a, b) => a - b)
      .map((b) => ({
        binning: b,
        widthPx: Math.floor(c.widthPx / b),
        heightPx: Math.floor(c.heightPx / b),
        pixelSizeUm: round(c.pixelSizeUm * b, 1e2),
        megapixels: round((Math.floor(c.widthPx / b) * Math.floor(c.heightPx / b)) / 1e6, 1e2),
      })),
  };
}

// ---- Filterrad ----------------------------------------------------------------------------------

/** Kleinbuchstaben, ohne Leer- und Sonderzeichen („O III“ → „oiii“). */
export function normalizeFilterName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const isLetter = (ch: string) => /[a-z]/i.test(ch);

/**
 * Vorschlag für den NINA-Filternamen zu einem Web-Kurznamen (FA-RIG-14, Kap. 8.6):
 * 1. exakt nach Normalisierung; 2. sonst Präfix **nur in einer Richtung** – der NINA-Name beginnt mit
 * dem Kurznamen und das nächste Zeichen ist kein Buchstabe („Ha“ → „Ha 3nm“; nie „LPro“ → „L“,
 * „HaOIII“ → „Ha“, „Rc“ → „R“). Bei mehreren Treffern gewinnt der erste in NINAs Reihenfolge.
 */
export function suggestNinaFilterName(
  shortName: string,
  ninaNames: readonly string[],
): string | null {
  const key = normalizeFilterName(shortName);
  if (!key) return null;
  const exact = ninaNames.find((n) => normalizeFilterName(n) === key);
  if (exact !== undefined) return exact;
  const prefix = ninaNames.find((n) => {
    const trimmed = n.trim();
    if (trimmed.length <= shortName.length) return false;
    if (trimmed.slice(0, shortName.length).toLowerCase() !== shortName.toLowerCase()) return false;
    return !isLetter(trimmed.charAt(shortName.length));
  });
  return prefix ?? null;
}

// ---- Scheduler-Einstellungen --------------------------------------------------------------------

/** Unbekannter oder doppelter Schlüssel → `422 rig.sort_chain_invalid` (sort-chain.md); leer ist erlaubt. */
export function validateSortChain(chain: readonly string[]): void {
  const known = sortChainKeys as readonly string[];
  const seen = new Set<string>();
  chain.forEach((key, i) => {
    if (!known.includes(key))
      throw new ProblemError('rig.sort_chain_invalid', [
        { path: `sortChain[${String(i)}]`, message: `unbekannter Schlüssel ${key}` },
      ]);
    if (seen.has(key))
      throw new ProblemError('rig.sort_chain_invalid', [
        { path: `sortChain[${String(i)}]`, message: `doppelter Schlüssel ${key}` },
      ]);
    seen.add(key);
  });
}

/** `maxAfterMin ≥ afterMin` (flip-rotation.md §1) → sonst `422 rig.flip_settings_invalid`. */
export function validateFlip(s: {
  flipAfterMeridianMin: number;
  flipMaxAfterMeridianMin: number;
}): void {
  if (s.flipMaxAfterMeridianMin < s.flipAfterMeridianMin)
    throw new ProblemError('rig.flip_settings_invalid', [
      { path: 'flipMaxAfterMeridianMin', message: 'muss ≥ flipAfterMeridianMin sein' },
    ]);
}
