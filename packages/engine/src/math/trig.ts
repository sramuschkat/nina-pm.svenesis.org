/**
 * sin, cos, tan als Port von fdlibm 5.3 (Sun Microsystems, frei verwendbar; `k_sin.c`, `k_cos.c`,
 * `k_tan.c`, `e_rem_pio2.c`, `k_rem_pio2.c`, `s_sin.c`, `s_cos.c`, `s_tan.c`). Gleiche Konstanten und
 * Rechenreihenfolge wie das Original, damit alle Hosts bitgleiche Ergebnisse liefern (TK 8.1).
 */
import { fromWords, hi, lo, scalbn, withLo } from './bits';

// ---- __kernel_sin -------------------------------------------------------------------------------
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

function kSin(x: number, y: number, iy: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000) return x; // |x| < 2^-27
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

// ---- __kernel_cos -------------------------------------------------------------------------------
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kCos(x: number, y: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1; // |x| < 2^-27
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y)); // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0); // x/4
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// ---- __kernel_tan -------------------------------------------------------------------------------
const T = [
  3.33333333333334091986e-1, 1.33333333333201242699e-1, 5.39682539762260521377e-2,
  2.18694882948595424599e-2, 8.86323982359930005737e-3, 3.59207910759131235356e-3,
  1.45620945432529025516e-3, 5.88041240820264096874e-4, 2.46463134818469906812e-4,
  7.817944429395570923e-5, 7.14072491382608190305e-5, -1.85586374855275456654e-5,
  2.59073051863633712884e-5,
] as const;
const PIO4 = 7.85398163397448278999e-1;
const PIO4LO = 3.06161699786838301793e-17;

function kTan(xIn: number, yIn: number, iy: number): number {
  let x = xIn;
  let y = yIn;
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000) {
    // |x| < 2^-28
    if ((ix | lo(x) | (iy + 1)) === 0) return 1 / Math.abs(x);
    if (iy === 1) return x;
    // −1/(x+y) sorgfältig
    const w0 = x + y;
    const z0 = withLo(w0, 0);
    const v0 = y - (z0 - x);
    const a = -1 / w0;
    const t0 = withLo(a, 0);
    const s0 = 1 + t0 * z0;
    return t0 + a * (s0 + t0 * v0);
  }
  if (ix >= 0x3fe59428) {
    // |x| >= 0.6744
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    const z0 = PIO4 - x;
    const w0 = PIO4LO - y;
    x = z0 + w0;
    y = 0;
  }
  let z = x * x;
  let w = z * z;
  let r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  let v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  let s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  w = x + r;
  if (ix >= 0x3fe59428) {
    v = iy;
    return (1 - ((hx >> 30) & 2)) * (v - 2 * (x - ((w * w) / (w + v) - r)));
  }
  if (iy === 1) return w;
  // −1/w sorgfältig
  z = withLo(w, 0);
  v = r - (z - x);
  const a = -1 / w;
  const t = withLo(a, 0);
  s = 1 + t * z;
  return t + a * (s + t * v);
}

// ---- __kernel_rem_pio2 (Payne-Hanek) ------------------------------------------------------------
const INIT_JK = [2, 3, 4, 6] as const;
const PIO2 = [
  1.57079625129699707031, 7.54978941586159635335e-8, 5.39030252995776476554e-15,
  3.28200341580791294123e-22, 1.27065575308067607349e-29, 1.22933308981111328932e-36,
  2.73370053816464559624e-44, 2.16741683877804819444e-51,
] as const;
const TWO24 = 1.6777216e7;
const TWON24 = 5.9604644775390625e-8;

/** 2/π in 24-Bit-Blöcken (fdlibm `two_over_pi`). */
const TWO_OVER_PI = [
  0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62, 0x95993c, 0x439041, 0xfe5163,
  0xabdebb, 0xc561b7, 0x246e3a, 0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129,
  0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c, 0x7026b4, 0x5f7e41, 0x3991d6, 0x398353, 0x39f49c,
  0x845f8b, 0xbdf928, 0x3b1ff8, 0x97ffde, 0x05980f, 0xef2f11, 0x8b5a0a, 0x6d1f6d, 0x367ecf,
  0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5, 0xf17b3d, 0x0739f7, 0x8a5292,
  0xea6bfb, 0x5fb11f, 0x8d5d08, 0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3,
  0x91615e, 0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880, 0x4d7327, 0x310606, 0x1556ca,
  0x73a8c9, 0x60e27b, 0xc08c6b,
] as const;

/** Rest von x modulo π/2 für |x| ≥ 2^20·π/2 (prec = 2, Ergebnis in y[0] + y[1]). */
function kernelRemPio2(x: number[], y: number[], e0: number, nx: number): number {
  const prec = 2;
  const jk = INIT_JK[prec];
  const jp = jk;
  const jx = nx - 1;
  let jv = Math.trunc((e0 - 3) / 24);
  if (jv < 0) jv = 0;
  let q0 = e0 - 24 * (jv + 1);
  const f: number[] = [];
  const q: number[] = [];
  const fq: number[] = [];
  const iq: number[] = [];
  let j = jv - jx;
  const m = jx + jk;
  for (let i = 0; i <= m; i++, j++) f[i] = j < 0 ? 0 : (TWO_OVER_PI[j] ?? 0);
  for (let i = 0; i <= jk; i++) {
    let fw = 0;
    for (j = 0; j <= jx; j++) fw += (x[j] ?? 0) * (f[jx + i - j] ?? 0);
    q[i] = fw;
  }
  let jz = jk;
  let z: number;
  let n: number;
  let ih: number;
  for (;;) {
    // recompute
    let i = 0;
    j = jz;
    z = q[jz] ?? 0;
    for (; j > 0; i++, j--) {
      const fw = Math.trunc(TWON24 * z);
      iq[i] = Math.trunc(z - TWO24 * fw);
      z = (q[j - 1] ?? 0) + fw;
    }
    z = scalbn(z, q0);
    z -= 8 * Math.floor(z * 0.125);
    n = Math.trunc(z);
    z -= n;
    ih = 0;
    if (q0 > 0) {
      i = (iq[jz - 1] ?? 0) >> (24 - q0);
      n += i;
      iq[jz - 1] = (iq[jz - 1] ?? 0) - (i << (24 - q0));
      ih = (iq[jz - 1] ?? 0) >> (23 - q0);
    } else if (q0 === 0) ih = (iq[jz - 1] ?? 0) >> 23;
    else if (z >= 0.5) ih = 2;

    if (ih > 0) {
      n += 1;
      let carry = 0;
      for (i = 0; i < jz; i++) {
        const k = iq[i] ?? 0;
        if (carry === 0) {
          if (k !== 0) {
            carry = 1;
            iq[i] = 0x1000000 - k;
          }
        } else iq[i] = 0xffffff - k;
      }
      if (q0 === 1) iq[jz - 1] = (iq[jz - 1] ?? 0) & 0x7fffff;
      else if (q0 === 2) iq[jz - 1] = (iq[jz - 1] ?? 0) & 0x3fffff;
      if (ih === 2) {
        z = 1 - z;
        if (carry !== 0) z -= scalbn(1, q0);
      }
    }

    if (z === 0) {
      let t = 0;
      for (i = jz - 1; i >= jk; i--) t |= iq[i] ?? 0;
      if (t === 0) {
        // mehr Bits von 2/π nötig
        let k = 1;
        while ((iq[jk - k] ?? 0) === 0) k++;
        for (i = jz + 1; i <= jz + k; i++) {
          f[jx + i] = TWO_OVER_PI[jv + i] ?? 0;
          let fw = 0;
          for (j = 0; j <= jx; j++) fw += (x[j] ?? 0) * (f[jx + i - j] ?? 0);
          q[i] = fw;
        }
        jz += k;
        continue;
      }
    }
    break;
  }

  if (z === 0) {
    jz -= 1;
    q0 -= 24;
    while ((iq[jz] ?? 0) === 0) {
      jz--;
      q0 -= 24;
    }
  } else {
    z = scalbn(z, -q0);
    if (z >= TWO24) {
      const fw = Math.trunc(TWON24 * z);
      iq[jz] = Math.trunc(z - TWO24 * fw);
      jz += 1;
      q0 += 24;
      iq[jz] = fw;
    } else iq[jz] = Math.trunc(z);
  }

  let fw = scalbn(1, q0);
  for (let i = jz; i >= 0; i--) {
    q[i] = fw * (iq[i] ?? 0);
    fw *= TWON24;
  }
  for (let i = jz; i >= 0; i--) {
    fw = 0;
    for (let k = 0; k <= jp && k <= jz - i; k++) fw += (PIO2[k] ?? 0) * (q[i + k] ?? 0);
    fq[jz - i] = fw;
  }
  fw = 0;
  for (let i = jz; i >= 0; i--) fw += fq[i] ?? 0;
  y[0] = ih === 0 ? fw : -fw;
  fw = (fq[0] ?? 0) - fw;
  for (let i = 1; i <= jz; i++) fw += fq[i] ?? 0;
  y[1] = ih === 0 ? fw : -fw;
  return n & 7;
}

// ---- __ieee754_rem_pio2 -------------------------------------------------------------------------
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb,
  0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb,
  0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c,
  0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
] as const;
const INVPIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.0222662487111664558e-21;
const PIO2_3T = 8.47842766036889956997e-32;

/** x = n·π/2 + (y[0] + y[1]); liefert n. */
export function remPio2(x: number, y: number[]): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    y[0] = x;
    y[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3π/4
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) {
        y[0] = z - PIO2_1T;
        y[1] = z - y[0] - PIO2_1T;
      } else {
        z -= PIO2_2;
        y[0] = z - PIO2_2T;
        y[1] = z - y[0] - PIO2_2T;
      }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) {
      y[0] = z + PIO2_1T;
      y[1] = z - y[0] + PIO2_1T;
    } else {
      z += PIO2_2;
      y[0] = z + PIO2_2T;
      y[1] = z - y[0] + PIO2_2T;
    }
    return -1;
  }
  if (ix <= 0x413921fb) {
    // |x| ≲ 2^19·π/2: mittlere Größe
    let t = Math.abs(x);
    const n = Math.trunc(t * INVPIO2 + 0.5);
    const fn = n;
    let r = t - fn * PIO2_1;
    let w = fn * PIO2_1T;
    if (n < 32 && ix !== NPIO2_HW[n - 1]) {
      y[0] = r - w;
    } else {
      const j = ix >> 20;
      y[0] = r - w;
      let i = j - ((hi(y[0]) >> 20) & 0x7ff);
      if (i > 16) {
        t = r;
        w = fn * PIO2_2;
        r = t - w;
        w = fn * PIO2_2T - (t - r - w);
        y[0] = r - w;
        i = j - ((hi(y[0]) >> 20) & 0x7ff);
        if (i > 49) {
          t = r;
          w = fn * PIO2_3;
          r = t - w;
          w = fn * PIO2_3T - (t - r - w);
          y[0] = r - w;
        }
      }
    }
    y[1] = r - (y[0] ?? 0) - w;
    if (hx < 0) {
      y[0] = -(y[0] ?? 0);
      y[1] = -y[1];
      return -n;
    }
    return n;
  }
  if (ix >= 0x7ff00000) {
    y[0] = x - x;
    y[1] = x - x;
    return 0;
  }
  // große Argumente: z = scalbn(|x|, ilogb(x) − 23)
  const e0 = (ix >> 20) - 1046;
  let z = fromWords(ix - (e0 << 20), lo(x));
  const tx: number[] = [];
  for (let i = 0; i < 2; i++) {
    tx[i] = Math.trunc(z);
    z = (z - (tx[i] ?? 0)) * TWO24;
  }
  tx[2] = z;
  let nx = 3;
  while ((tx[nx - 1] ?? 0) === 0) nx--;
  const n = kernelRemPio2(tx, y, e0, nx);
  if (hx < 0) {
    y[0] = -(y[0] ?? 0);
    y[1] = -(y[1] ?? 0);
    return -n;
  }
  return n;
}

// ---- sin, cos, tan ------------------------------------------------------------------------------
export function sin(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const y = [0, 0];
  const n = remPio2(x, y);
  const [a, b] = y as [number, number];
  switch (n & 3) {
    case 0:
      return kSin(a, b, 1);
    case 1:
      return kCos(a, b);
    case 2:
      return -kSin(a, b, 1);
    default:
      return -kCos(a, b);
  }
}

export function cos(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const y = [0, 0];
  const n = remPio2(x, y);
  const [a, b] = y as [number, number];
  switch (n & 3) {
    case 0:
      return kCos(a, b);
    case 1:
      return -kSin(a, b, 1);
    case 2:
      return -kCos(a, b);
    default:
      return kSin(a, b, 1);
  }
}

export function tan(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kTan(x, 0, 1);
  if (ix >= 0x7ff00000) return x - x;
  const y = [0, 0];
  const n = remPio2(x, y);
  const [a, b] = y as [number, number];
  return kTan(a, b, 1 - ((n & 1) << 1));
}
