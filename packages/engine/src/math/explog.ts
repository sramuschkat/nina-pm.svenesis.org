/**
 * exp, log, log10, pow als Port von fdlibm 5.3 (`e_exp.c`, `e_log.c`, `e_log10.c`, `e_pow.c`).
 */
import { hi, lo, scalbn, withHi, withLo } from './bits';

// ---- exp ----------------------------------------------------------------------------------------
const HUGE = 1.0e300;
const TWOM1000 = 9.3326361850321887899e-302; // 2^-1000
const O_THRESHOLD = 7.09782712893383973096e2;
const U_THRESHOLD = -7.4513321910194110842e2;
const LN2HI = [6.9314718036912381649e-1, -6.9314718036912381649e-1] as const;
const LN2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10] as const;
const HALF = [0.5, -0.5] as const;
const INVLN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

export function exp(xIn: number): number {
  let x = xIn;
  let hx = hi(x);
  const xsb = (hx >> 31) & 1; // Vorzeichen
  hx &= 0x7fffffff;
  let hiPart = 0;
  let loPart = 0;
  let k: number;
  if (hx >= 0x40862e42) {
    // |x| >= 709.78
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lo(x)) !== 0) return x + x; // NaN
      return xsb === 0 ? x : 0; // exp(±inf) = inf / 0
    }
    if (x > O_THRESHOLD) return HUGE * HUGE; // Überlauf
    if (x < U_THRESHOLD) return TWOM1000 * TWOM1000; // Unterlauf
  }
  if (hx > 0x3fd62e42) {
    // |x| > 0.5·ln2
    if (hx < 0x3ff0a2b2) {
      // |x| < 1.5·ln2
      hiPart = x - (LN2HI[xsb] ?? 0);
      loPart = LN2LO[xsb] ?? 0;
      k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(INVLN2 * x + (HALF[xsb] ?? 0));
      const t = k;
      hiPart = x - t * LN2HI[0];
      loPart = t * LN2LO[0];
    }
    x = hiPart - loPart;
  } else if (hx < 0x3e300000) {
    // |x| < 2^-28
    return 1 + x;
  } else k = 0;
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (loPart - (x * c) / (2 - c) - hiPart);
  if (k >= -1021) return withHi(y, hi(y) + (k << 20));
  return withHi(y, hi(y) + ((k + 1000) << 20)) * TWOM1000;
}

// ---- log ----------------------------------------------------------------------------------------
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const TWO54 = 1.8014398509481984e16;
const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

export function log(xIn: number): number {
  let x = xIn;
  let hx = hi(x);
  const lx = lo(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -TWO54 / 0; // log(±0) = −inf
    if (hx < 0) return (x - x) / 0; // log(−#) = NaN
    k -= 54;
    x *= TWO54; // subnormal hochskalieren
    hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000)); // x oder x/2 normalisieren
  k += i >> 20;
  const f = x - 1;
  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      const dk = k;
      return dk * LN2_HI + dk * LN2_LO;
    }
    const R = f * f * (0.5 - 0.3333333333333333 * f);
    if (k === 0) return f - R;
    const dk = k;
    return dk * LN2_HI - (R - dk * LN2_LO - f);
  }
  const s = f / (2 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}

// ---- log10 --------------------------------------------------------------------------------------
const IVLN10 = 4.34294481903251816668e-1;
const LOG10_2HI = 3.01029995663611771306e-1;
const LOG10_2LO = 3.69423907715893078616e-13;

export function log10(xIn: number): number {
  let x = xIn;
  let hx = hi(x);
  const lx = lo(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -TWO54 / 0;
    if (hx < 0) return (x - x) / 0;
    k -= 54;
    x *= TWO54;
    hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  const i = (k & 0x80000000) >>> 31;
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  const y = k + i;
  x = withHi(x, hx);
  const z = y * LOG10_2LO + IVLN10 * log(x);
  return z + y * LOG10_2HI;
}

// ---- pow ----------------------------------------------------------------------------------------
const BP = [1.0, 1.5] as const;
const DP_H = [0.0, 5.84962487220764160156e-1] as const;
const DP_L = [0.0, 1.35003920212974897128e-8] as const;
const TWO53 = 9007199254740992.0;
const TINY = 1.0e-300;
const L1 = 5.99999999999994648725e-1;
const L2 = 4.28571428578550184252e-1;
const L3 = 3.33333329818377432918e-1;
const L4 = 2.72728123808534006489e-1;
const L5 = 2.30660745775561754067e-1;
const L6 = 2.06975017800338417784e-1;
const LG2_ = 6.93147180559945286227e-1;
const LG2_H = 6.93147182464599609375e-1;
const LG2_L = -1.90465429995776804525e-9;
const OVT = 8.008566259537294e-17; // −(1024 − log2(ovfl + .5ulp))
const CP = 9.61796693925975554329e-1; // 2/(3·ln2)
const CP_H = 9.61796700954437255859e-1;
const CP_L = -7.02846165095275826516e-9;
const IVLN2 = 1.442695040888963387;
const IVLN2_H = 1.44269502162933349609;
const IVLN2_L = 1.92596299112661746887e-8;

export function pow(x: number, y: number): number {
  const hx = hi(x);
  const lx = lo(x);
  const hy = hi(y);
  const ly = lo(y);
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;

  if ((iy | ly) === 0) return 1; // y = ±0
  if (
    ix > 0x7ff00000 ||
    (ix === 0x7ff00000 && lx !== 0) ||
    iy > 0x7ff00000 ||
    (iy === 0x7ff00000 && ly !== 0)
  )
    return x + y; // NaN

  // yisint: 0 = keine ganze Zahl, 1 = ungerade, 2 = gerade (nur für x < 0 bestimmt)
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000)
      yisint = 2; // |y| >= 2^53
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        const j = ly >>> (52 - k);
        if ((j << (52 - k)) >>> 0 === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        const j = iy >> (20 - k);
        if (j << (20 - k) === iy) yisint = 2 - (j & 1);
      }
    }
  }

  // Sonderfälle von y
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y = ±inf
      if (((ix - 0x3ff00000) | lx) === 0) return y - y; // (±1)^±inf = NaN
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0; // (|x|>1)^±inf
      return hy < 0 ? -y : 0; // (|x|<1)^−,+inf
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x; // y = ±1
    if (hy === 0x40000000) return x * x; // y = 2
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x); // y = 0.5, x >= +0
  }

  let ax = Math.abs(x);
  // Sonderfälle von x
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax; // x = ±0, ±inf, ±1
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0)
        z = (z - z) / (z - z); // (−1)^nicht-ganzzahlig = NaN
      else if (yisint === 1) z = -z;
    }
    return z;
  }

  let n = (hx >> 31) + 1; // 0 für x < 0, 1 für x > 0
  if ((n | yisint) === 0) return (x - x) / (x - x); // (x<0)^(nicht ganzzahlig) = NaN

  let s = 1; // Vorzeichen des Ergebnisses
  if ((n | (yisint - 1)) === 0) s = -1; // (−)^(ungerade)

  let t1: number;
  let t2: number;
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      // |y| > 2^64: sicher Über-/Unterlauf
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY;
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY;
    }
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY;
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY;
    // |1 − x| <= 2^-20: log(x) über die Reihe x − x²/2 + x³/3 − x⁴/4
    const t = ax - 1;
    const w = t * t * (0.5 - t * (0.3333333333333333 - t * 0.25));
    const u = IVLN2_H * t;
    const v = t * IVLN2_L - w * IVLN2;
    t1 = withLo(u + v, 0);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    if (ix < 0x00100000) {
      // subnormal
      ax *= TWO53;
      n -= 53;
      ix = hi(ax);
    }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    ix = j | 0x3ff00000; // ix auf [1, 2) normieren
    let k: number;
    if (j <= 0x3988e)
      k = 0; // |x| < sqrt(3/2)
    else if (j < 0xbb67a)
      k = 1; // |x| < sqrt(3)
    else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    ax = withHi(ax, ix);

    // ss = s_h + s_l = (x − 1)/(x + 1) bzw. (x − 1.5)/(x + 1.5)
    const bp = BP[k] ?? 1;
    const u0 = ax - bp;
    const v0 = 1 / (ax + bp);
    const ss = u0 * v0;
    const sH = withLo(ss, 0);
    let tH = withHi(0, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
    let tL = ax - (tH - bp);
    const sL = v0 * (u0 - sH * tH - sH * tL);
    // log(ax)/ln2
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += sL * (sH + ss);
    s2 = sH * sH;
    tH = withLo(3 + s2 + r, 0);
    tL = r - (tH - 3 - s2);
    const u = sH * tH;
    const v = sL * tH + tL * ss;
    const pH = withLo(u + v, 0);
    const pL = v - (pH - u);
    const zH = CP_H * pH;
    const zL = CP_L * pH + pL * CP + (DP_L[k] ?? 0);
    const t = n;
    t1 = withLo(zH + zL + (DP_H[k] ?? 0) + t, 0);
    t2 = zL - (t1 - t - (DP_H[k] ?? 0) - zH);
  }

  // (y1 + y2)·(t1 + t2)
  const y1 = withLo(y, 0);
  const pL = (y - y1) * t1 + y * t2;
  let pH = y1 * t1;
  let z = pL + pH;
  let j = hi(z);
  let i = lo(z);
  if (j >= 0x40900000) {
    // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE;
    if (pL + OVT > z - pH) return s * HUGE * HUGE;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= −1075
    if (((j - (0xc090cc00 | 0)) | i) !== 0) return s * TINY * TINY;
    if (pL <= z - pH) return s * TINY * TINY;
  }

  // 2^(pH + pL)
  i = j & 0x7fffffff;
  let k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    // |z| > 0.5: z = n + r mit ganzem n
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = withHi(0, n & ~(0x000fffff >> k));
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    pH -= t;
  }
  let t = withLo(pL + pH, 0);
  const u = t * LG2_H;
  const v = (pL - (t - pH)) * LG2_ + t * LG2_L;
  z = u + v;
  const w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const r = (z * t1) / (t1 - 2) - (w + z * w);
  z = 1 - (r - z);
  j = hi(z);
  j += n << 20;
  if (j >> 20 <= 0)
    z = scalbn(z, n); // subnormal
  else z = withHi(z, j);
  return s * z;
}
