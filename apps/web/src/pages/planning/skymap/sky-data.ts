/**
 * Sterndaten der Sternkarte (AP-21): helle Sterne, Sternbilder und Milchstraße aus
 * `@nina-pm/catalog-data/sky/sky.json` (eigener Chunk, lädt mit der Karte), die Sterne von 6 bis 8 mag aus
 * `data/stars-8.bin` (erst beim Hineinzoomen). Positionen J2000 als Einheitsvektoren, einmal gerechnet.
 */
import starsBinUrl from '@nina-pm/catalog-data/data/stars-8.bin?url';

export interface StarField {
  readonly count: number;
  /** x, y, z je Stern (J2000). */
  readonly vec: Float64Array;
  readonly mag: Float32Array;
  /** Namen der hellen Sterne (Index → Name de/en, Bayer). */
  readonly names?: ReadonlyMap<number, { de: string; en: string }>;
}

export interface ConstellationLabel {
  readonly abbr: string;
  readonly vec: readonly [number, number, number];
  readonly rank: number;
  readonly de: string;
  readonly latin: string;
  readonly en: string;
}

export interface BrightSky {
  readonly stars: StarField;
  /** Polylinien je Sternbild als Vektorfolgen. */
  readonly lines: readonly (readonly (readonly [number, number, number])[])[];
  readonly bounds: readonly (readonly (readonly [number, number, number])[])[];
  readonly labels: readonly ConstellationLabel[];
  /** Milchstraße auf einem 1°-Raster: Mittelpunkt und Stufe 1–5. */
  readonly milkyWay: readonly {
    readonly vec: readonly [number, number, number];
    readonly level: number;
  }[];
}

export const unit = (raDeg: number, decDeg: number): [number, number, number] => {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
};

interface SkyJson {
  stars: (number | string)[][];
  lines: Record<string, number[][]>;
  bounds: [string, number[]][];
  labels: (string | number)[][];
  milkyWay: { w: number; h: number; step: number; rle: string };
}

const pairs = (flat: readonly number[]) => {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    out.push(unit(flat[i] as number, flat[i + 1] as number));
  return out;
};

/** Milchstraße: Lauflängen (Buchstabe a–f = Stufe 0–5, dann Länge) auf 0,5°, zusammengefasst auf 1°. */
export function decodeMilkyWay(mw: SkyJson['milkyWay']): BrightSky['milkyWay'] {
  const grid = new Uint8Array(mw.w * mw.h);
  const re = /([a-f])(\d+)/g;
  let pos = 0;
  for (let m = re.exec(mw.rle); m; m = re.exec(mw.rle)) {
    const level = (m[1] as string).charCodeAt(0) - 97;
    const n = Number(m[2]);
    if (level > 0) grid.fill(level, pos, pos + n);
    pos += n;
  }
  const out: { vec: [number, number, number]; level: number }[] = [];
  for (let row = 0; row < mw.h; row += 2) {
    for (let col = 0; col < mw.w; col += 2) {
      const level = Math.max(
        grid[row * mw.w + col] ?? 0,
        grid[row * mw.w + col + 1] ?? 0,
        grid[(row + 1) * mw.w + col] ?? 0,
        grid[(row + 1) * mw.w + col + 1] ?? 0,
      );
      if (level === 0) continue;
      // Zeilen ab Dec +90° südwärts, Spalten ab RA 0° ostwärts; Mittelpunkt der 1°-Zelle.
      out.push({ vec: unit((col + 1) * mw.step, 90 - (row + 1) * mw.step), level });
    }
  }
  return out;
}

export function parseSky(json: SkyJson): BrightSky {
  const n = json.stars.length;
  const vec = new Float64Array(n * 3);
  const mag = new Float32Array(n);
  const names = new Map<number, { de: string; en: string }>();
  json.stars.forEach((s, i) => {
    const v = unit(s[0] as number, s[1] as number);
    vec.set(v, i * 3);
    mag[i] = s[2] as number;
    const de = typeof s[4] === 'string' ? s[4] : '';
    const en = typeof s[5] === 'string' ? s[5] : de;
    if (de || en) names.set(i, { de: de || en, en: en || de });
  });
  return {
    stars: { count: n, vec, mag, names },
    lines: Object.values(json.lines).flatMap((polys) => polys.map(pairs)),
    bounds: json.bounds.map(([, ring]) => pairs(ring)),
    labels: json.labels.map((l) => ({
      abbr: String(l[0]),
      vec: unit(Number(l[1]), Number(l[2])),
      rank: Number(l[3]),
      de: String(l[4]),
      latin: String(l[5]),
      en: String(l[6]),
    })),
    milkyWay: decodeMilkyWay(json.milkyWay),
  };
}

/**
 * `stars-8.bin` (Format in `legacy/…/tools/star-catalog-data.js`): 12 Byte Kopf („SVST“, Version, Satzlänge,
 * Anzahl), je Stern RA uint16 (Vollkreis), Dec int16 (±90° = ±32767), mag × 20 uint8, …; little-endian.
 */
export function decodeFaintStars(buf: ArrayBuffer): StarField {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SVST') throw new Error('stars-8.bin: unbekanntes Format');
  const rec = dv.getUint16(6, true);
  const count = dv.getUint32(8, true);
  const vec = new Float64Array(count * 3);
  const mag = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const o = 12 + rec * i;
    const ra = (dv.getUint16(o, true) / 65536) * 360;
    const dec = (dv.getInt16(o + 2, true) / 32767) * 90;
    vec.set(unit(ra, dec), i * 3);
    mag[i] = dv.getUint8(o + 4) / 20;
  }
  return { count, vec, mag };
}

let bright: Promise<BrightSky> | null = null;
let faint: Promise<StarField> | null = null;

export function loadBrightSky(): Promise<BrightSky> {
  bright ??= import('@nina-pm/catalog-data/sky/sky.json').then((m) =>
    parseSky((m as unknown as { default: SkyJson }).default),
  );
  return bright;
}

export function loadFaintStars(): Promise<StarField> {
  faint ??= fetch(starsBinUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`stars-8.bin: ${String(r.status)}`);
      return r.arrayBuffer();
    })
    .then(decodeFaintStars);
  return faint;
}
