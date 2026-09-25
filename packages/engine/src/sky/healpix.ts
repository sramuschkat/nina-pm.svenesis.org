/**
 * HEALPix im NESTED-Schema, wie HiPS seine Kacheln ablegt (Górski et al. 2005) – für die Himmelsfotos der
 * Sternkarte (FA-FRM-03). Portiert aus `legacy/astro-tools-2026-09-21/js/sky-map.js` (hpxInterleave,
 * hpxXYF, hpxLoc, hpxPix); Trigonometrie über die Engine-Mathematik.
 */
import { asin, log, sin } from '../math';
import { DEG, RAD } from '../astro/angles';

const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4] as const;
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7] as const;

/** Bits von `ix` und `iy` verschränken (x auf geraden, y auf ungeraden Bits). */
export function hpxInterleave(ix: number, iy: number): number {
  let p = 0;
  let f = 1;
  for (let b = 0; b < 26; b += 1) {
    p += (((ix >> b) & 1) + ((iy >> b) & 1) * 2) * f;
    f *= 4;
  }
  return p;
}

/** Pixelnummer → Basisfläche und Lage darauf. */
export function hpxXyf(order: number, ipix: number): { face: number; ix: number; iy: number } {
  const n2 = (1 << order) * (1 << order);
  const face = Math.floor(ipix / n2);
  let r = ipix - face * n2;
  let ix = 0;
  let iy = 0;
  for (let b = 0; b < order; b += 1) {
    ix += (r % 2) * (1 << b);
    r = Math.floor(r / 2);
    iy += (r % 2) * (1 << b);
    r = Math.floor(r / 2);
  }
  return { face, ix, iy };
}

/** Stetige Flächenkoordinaten (0–1) → J2000-RA/Dec in Grad. */
export function hpxLoc(face: number, x: number, y: number): { raDeg: number; decDeg: number } {
  const jr = (JRLL[face] ?? 2) - x - y;
  let nr: number;
  let z: number;
  if (jr < 1) {
    nr = jr;
    z = 1 - (nr * nr) / 3;
  } else if (jr > 3) {
    nr = 4 - jr;
    z = (nr * nr) / 3 - 1;
  } else {
    nr = 1;
    z = ((2 - jr) * 2) / 3;
  }
  let t = (JPLL[face] ?? 0) * nr + x - y;
  if (t < 0) t += 8;
  if (t >= 8) t -= 8;
  return {
    raDeg: nr < 1e-15 ? 0 : (45 * t) / nr,
    decDeg: asin(Math.max(-1, Math.min(1, z))) * DEG,
  };
}

/** J2000-RA/Dec in Grad → Pixelnummer der Ordnung `order`. */
export function hpxPix(order: number, raDeg: number, decDeg: number): number {
  const nside = 1 << order;
  const z = sin(decDeg * RAD);
  const za = Math.abs(z);
  const tt = (((raDeg / 90) % 4) + 4) % 4;
  let face: number;
  let ix: number;
  let iy: number;
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt);
    const t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2);
    const jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt));
    const tp = tt - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.min(nside - 1, Math.floor(tp * tmp));
    const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
    if (z >= 0) {
      face = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }
  return face * nside * nside + hpxInterleave(ix, iy);
}

/** Pfad einer HiPS-Kachel (`Norder3/Dir0/Npix123`). */
export function hipsTilePath(order: number, ipix: number): string {
  return `Norder${String(order)}/Dir${String(Math.floor(ipix / 10000) * 10000)}/Npix${String(ipix)}`;
}

/**
 * Kachelordnung, bei der ein Kachelpixel etwa einem Bildschirmpixel entspricht (Kacheln 512 px;
 * 58,63° = Kantenlänge einer Kachel der Ordnung 0), begrenzt auf `[3, maxOrder]`.
 */
export function hipsOrderFor(degPerScreenPx: number, maxOrder: number, tilePx = 512): number {
  const order = Math.ceil(log(58.63 / tilePx / degPerScreenPx) / log(2));
  return Math.max(3, Math.min(maxOrder, order));
}
