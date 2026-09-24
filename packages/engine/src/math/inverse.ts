/**
 * atan, atan2, asin, acos als Port von fdlibm 5.3 (`s_atan.c`, `e_atan2.c`, `e_asin.c`, `e_acos.c`).
 */
import { hi, lo, withLo } from './bits';

// ---- atan ---------------------------------------------------------------------------------------
const ATANHI = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1,
  1.570796326794896558,
] as const;
const ATANLO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17,
  6.12323399573676603587e-17,
] as const;
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1,
  -1.1111110405462355788e-1, 9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2,
  -3.6531572744216915527e-2, 1.62858201153657823623e-2,
] as const;

export function atan(xIn: number): number {
  let x = xIn;
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lo(x) !== 0)) return x + x; // NaN
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e200000) return x; // |x| < 2^-29
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = (ATANHI[id] ?? 0) - (x * (s1 + s2) - (ATANLO[id] ?? 0) - x);
  return hx < 0 ? -r : r;
}

// ---- atan2 --------------------------------------------------------------------------------------
const TINY = 1.0e-300;
const PI_O_4 = 7.85398163397448279e-1;
const PI_O_2 = 1.570796326794896558;
const PI = 3.141592653589793116;
const PI_LO = 1.2246467991473532e-16;

export function atan2(y: number, x: number): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  const lx = lo(x);
  const hy = hi(y);
  const iy = hy & 0x7fffffff;
  const ly = lo(y);
  if ((ix | ((lx | -lx) >>> 31)) > 0x7ff00000 || (iy | ((ly | -ly) >>> 31)) > 0x7ff00000)
    return x + y; // NaN
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y); // x = 1.0
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2·Vorzeichen(x) + Vorzeichen(y)
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1:
        return y; // atan(±0, +anything) = ±0
      case 2:
        return PI + TINY;
      default:
        return -PI - TINY;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI_O_4 + TINY;
        case 1:
          return -PI_O_4 - TINY;
        case 2:
          return 3 * PI_O_4 + TINY;
        default:
          return -3 * PI_O_4 - TINY;
      }
    }
    switch (m) {
      case 0:
        return 0;
      case 1:
        return -0;
      case 2:
        return PI + TINY;
      default:
        return -PI - TINY;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    // |y/x| > 2^60
    z = PI_O_2 + 0.5 * PI_LO;
    m &= 1;
  } else if (hx < 0 && k < -60)
    z = 0; // 0 > |y|/x > −2^-60
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

// ---- asin, acos ---------------------------------------------------------------------------------
const PIO2_HI = 1.570796326794896558;
const PIO2_LO = 6.12323399573676603587e-17;
const PIO4_HI = 7.85398163397448278999e-1;
const PS0 = 1.66666666666666657415e-1;
const PS1 = -3.25565818622400915405e-1;
const PS2 = 2.01212532134862925881e-1;
const PS3 = -4.00555345006794114027e-2;
const PS4 = 7.91534994289814532176e-4;
const PS5 = 3.4793310759602116757e-5;
const QS1 = -2.40339491173441421878;
const QS2 = 2.02094576023350569471;
const QS3 = -6.8828397160545329303e-1;
const QS4 = 7.70381505559019352791e-2;

const pS = (t: number) => t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
const qS = (t: number) => 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));

export function asin(x: number): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| >= 1
    if (((ix - 0x3ff00000) | lo(x)) === 0) return x * PIO2_HI + x * PIO2_LO; // asin(±1) = ±π/2
    return (x - x) / (x - x); // NaN
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix < 0x3e400000) return x; // |x| < 2^-27
    const t = x * x;
    const w = pS(t) / qS(t);
    return x + x * w;
  }
  // 1 > |x| >= 0.5
  const w0 = 1 - Math.abs(x);
  const t = w0 * 0.5;
  const p = pS(t);
  const q = qS(t);
  const s = Math.sqrt(t);
  let r: number;
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    const w = p / q;
    r = PIO2_HI - (2 * (s + s * w) - PIO2_LO);
  } else {
    const w = withLo(s, 0);
    const c = (t - w * w) / (s + w);
    const rr = p / q;
    const pp = 2 * s * rr - (PIO2_LO - 2 * c);
    const qq = PIO4_HI - 2 * w;
    r = PIO4_HI - (pp - qq);
  }
  return hx > 0 ? r : -r;
}

export function acos(x: number): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| >= 1
    if (((ix - 0x3ff00000) | lo(x)) === 0) return hx > 0 ? 0 : PI + 2 * PIO2_LO;
    return (x - x) / (x - x); // NaN
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO; // |x| < 2^-57
    const z = x * x;
    const r = pS(z) / qS(z);
    return PIO2_HI - (x - (PIO2_LO - x * r));
  }
  if (hx < 0) {
    // x < −0.5
    const z = (1 + x) * 0.5;
    const s = Math.sqrt(z);
    const r = pS(z) / qS(z);
    const w = r * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  // x > 0.5
  const z = (1 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = withLo(s, 0);
  const c = (z - df * df) / (s + df);
  const r = pS(z) / qS(z);
  const w = r * s + c;
  return 2 * (df + w);
}
