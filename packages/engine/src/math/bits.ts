/**
 * Zugriff auf die 32-Bit-Hälften einer IEEE-754-Doppelzahl (fdlibm `__HI`/`__LO`) – über eine
 * DataView mit fester Byte-Reihenfolge, damit Browser, Node und Jint dasselbe Ergebnis liefern.
 */
const view = new DataView(new ArrayBuffer(8));

/** Obere 32 Bit als vorzeichenbehaftete Ganzzahl (wie `int` in fdlibm). */
export function hi(x: number): number {
  view.setFloat64(0, x);
  return view.getInt32(0);
}

/** Untere 32 Bit ohne Vorzeichen (wie `unsigned` in fdlibm). */
export function lo(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(4);
}

export function fromWords(high: number, low: number): number {
  view.setInt32(0, high | 0);
  view.setUint32(4, low >>> 0);
  return view.getFloat64(0);
}

/** `SET_HIGH_WORD`. */
export function withHi(x: number, high: number): number {
  view.setFloat64(0, x);
  view.setInt32(0, high | 0);
  return view.getFloat64(0);
}

/** `SET_LOW_WORD`. */
export function withLo(x: number, low: number): number {
  view.setFloat64(0, x);
  view.setUint32(4, low >>> 0);
  return view.getFloat64(0);
}

/** `scalbn(x, n)` = x · 2ⁿ ohne Rundungsfehler im Normalbereich (musl/fdlibm). */
export function scalbn(x: number, n: number): number {
  let y = x;
  let e = n;
  if (e > 1023) {
    y *= 8.98846567431158e307; // 2^1023
    e -= 1023;
    if (e > 1023) {
      y *= 8.98846567431158e307;
      e -= 1023;
      if (e > 1023) e = 1023;
    }
  } else if (e < -1022) {
    // 2^-1022 · 2^53, damit das Zwischenergebnis nicht vorzeitig subnormal wird
    y *= 2.2250738585072014e-308 * 9007199254740992;
    e += 1022 - 53;
    if (e < -1022) {
      y *= 2.2250738585072014e-308 * 9007199254740992;
      e += 1022 - 53;
      if (e < -1022) e = -1022;
    }
  }
  return y * fromWords((0x3ff + e) << 20, 0);
}
