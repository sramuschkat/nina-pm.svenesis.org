/**
 * Zwei-Zeilen-Bahnelemente (TLE) und SGP4, nur der erdnahe Zweig (Umlaufzeit unter 225 min), nach Vallado,
 * Crawford, Hujsak & Kelso 2006, „Revisiting Spacetrack Report #3“ (AIAA 2006-6753), WGS-72-Konstanten.
 * Portiert aus `legacy/astro-tools-2026-09-21/js/sky-events.js` (`tleExp`, `parseTle`, `sgp4init`, `sgp4`);
 * Epoche in Unix-Sekunden über `daysFromCivil` statt `Date.UTC`. Geprüft gegen die Verifikationsfälle der
 * Veröffentlichung (Test `sky-events.spec.ts`). Nur Anzeige („Ereignisse der Nacht“).
 */
import { atan2, cos, pow, sin } from '../../math';
import { RAD } from '../../astro/angles';
import { daysFromCivil } from '../../astro/time';

const TWO_PI = 2 * Math.PI;
/** WGS-72, die Konstanten, mit denen die TLE angepasst sind. */
export const WGS72_RADIUS_KM = 6378.135;
const MU = 398600.8;
const XKE = 60 / Math.sqrt((WGS72_RADIUS_KM * WGS72_RADIUS_KM * WGS72_RADIUS_KM) / MU);
const J2 = 0.001082616;
const J3 = -0.00000253881;
const J4 = -0.00000165597;
const J3OJ2 = J3 / J2;
const X2O3 = 2 / 3;

export interface TleElements {
  /** Katalognummer (NORAD) als Zeichenkette ohne führende Leerzeichen. */
  readonly id: string;
  /** Epoche der Elemente, Unix-Sekunden (UTC). */
  readonly epochUtc: number;
  readonly bstar: number;
  /** Winkel in Radiant, mittlere Bewegung in rad/min. */
  readonly inclo: number;
  readonly nodeo: number;
  readonly ecco: number;
  readonly argpo: number;
  readonly mo: number;
  readonly no: number;
}

/** TLE-Zahl mit gedachtem Dezimalpunkt und Exponent, z. B. „ 28098-4“ = 0,28098e-4. */
function tleExp(raw: string): number {
  let s = raw.trim();
  if (!s) return 0;
  let sign = 1;
  if (s.startsWith('-') || s.startsWith('+')) {
    sign = s.startsWith('-') ? -1 : 1;
    s = s.slice(1);
  }
  const m = /^(\d+)([-+]\d)$/.exec(s);
  return m
    ? sign * parseFloat(`0.${m[1] ?? ''}`) * pow(10, Number(m[2]))
    : sign * parseFloat(`0.${s}`);
}

/** Zwei TLE-Zeilen lesen (Spalten nach Spacetrack Report #3). */
export function parseTle(line1: string, line2: string): TleElements {
  const yy = Number(line1.substring(18, 20));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const dayOfYear = parseFloat(line1.substring(20, 32));
  return {
    id: line1.substring(2, 7).trim(),
    epochUtc: daysFromCivil(year, 1, 1) * 86400 + (dayOfYear - 1) * 86400,
    bstar: tleExp(line1.substring(53, 61)),
    inclo: parseFloat(line2.substring(8, 16)) * RAD,
    nodeo: parseFloat(line2.substring(17, 25)) * RAD,
    ecco: parseFloat(`0.${line2.substring(26, 33).trim()}`),
    argpo: parseFloat(line2.substring(34, 42)) * RAD,
    mo: parseFloat(line2.substring(43, 51)) * RAD,
    no: (parseFloat(line2.substring(52, 63)) * TWO_PI) / 1440, // Umläufe/Tag → rad/min
  };
}

/** Initialisierter SGP4-Zustand (`sgp4init` mit `initl`), erdnah. */
export interface Sgp4Record {
  readonly epochUtc: number;
  readonly bstar: number;
  readonly ecco: number;
  readonly argpo: number;
  readonly inclo: number;
  readonly mo: number;
  readonly nodeo: number;
  readonly noUnkozai: number;
  readonly isimp: boolean;
  readonly con41: number;
  readonly eta: number;
  readonly cc1: number;
  readonly cc4: number;
  readonly cc5: number;
  readonly x1mth2: number;
  readonly mdot: number;
  readonly argpdot: number;
  readonly nodedot: number;
  readonly omgcof: number;
  readonly xmcof: number;
  readonly nodecf: number;
  readonly t2cof: number;
  readonly xlcof: number;
  readonly aycof: number;
  readonly delmo: number;
  readonly sinmao: number;
  readonly x7thm1: number;
  readonly d2: number;
  readonly d3: number;
  readonly d4: number;
  readonly t3cof: number;
  readonly t4cof: number;
  readonly t5cof: number;
}

/** Initialisierung; `null` für Bahnen des Tiefraum-Zweigs (Umlaufzeit ≥ 225 min – nicht gebraucht). */
export function sgp4init(tle: TleElements): Sgp4Record | null {
  const { ecco, inclo, argpo, mo, bstar } = tle;
  const eccsq = ecco * ecco;
  const omeosq = 1 - eccsq;
  const rteosq = Math.sqrt(omeosq);
  const cosio = cos(inclo);
  const cosio2 = cosio * cosio;
  const ak = pow(XKE / tle.no, X2O3);
  const d1 = (0.75 * J2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  const noUnkozai = tle.no / (1 + del);
  if (TWO_PI / noUnkozai >= 225) return null;
  const ao = pow(XKE / noUnkozai, X2O3);
  const sinio = sin(inclo);
  const po = ao * omeosq;
  const con42 = 1 - 5 * cosio2;
  const con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1 - ecco);
  const ss = 78 / WGS72_RADIUS_KM + 1;
  const qzms2t = pow((120 - 78) / WGS72_RADIUS_KM, 4);
  const isimp = rp < 220 / WGS72_RADIUS_KM + 1;
  let sfour = ss;
  let qzms24 = qzms2t;
  const perige = (rp - 1) * WGS72_RADIUS_KM;
  if (perige < 156) {
    sfour = perige - 78;
    if (perige < 98) sfour = 20;
    qzms24 = pow((120 - sfour) / WGS72_RADIUS_KM, 4);
    sfour = sfour / WGS72_RADIUS_KM + 1;
  }
  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  const eta = ao * ecco * tsi;
  const etasq = eta * eta;
  const eeta = ecco * eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * pow(tsi, 4);
  const coef1 = coef / pow(psisq, 3.5);
  const cc2 =
    coef1 *
    noUnkozai *
    (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) +
      ((0.375 * J2 * tsi) / psisq) * con41 * (8 + 3 * etasq * (8 + etasq)));
  const cc1 = bstar * cc2;
  const cc3 = ecco > 1e-4 ? (-2 * coef * tsi * J3OJ2 * noUnkozai * sinio) / ecco : 0;
  const x1mth2 = 1 - cosio2;
  const cc4 =
    2 *
    noUnkozai *
    coef1 *
    ao *
    omeosq *
    (eta * (2 + 0.5 * etasq) +
      ecco * (0.5 + 2 * etasq) -
      ((J2 * tsi) / (ao * psisq)) *
        (-3 * con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) +
          0.75 * x1mth2 * (2 * etasq - eeta * (1 + etasq)) * cos(2 * argpo)));
  const cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * noUnkozai;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * noUnkozai;
  const mdot =
    noUnkozai +
    0.5 * temp1 * rteosq * con41 +
    0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  const argpdot =
    -0.5 * temp1 * con42 +
    0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) +
    temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  const nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
  const delmotemp = 1 + eta * cos(mo);
  let d2 = 0;
  let d3 = 0;
  let d4 = 0;
  let t3cof = 0;
  let t4cof = 0;
  let t5cof = 0;
  if (!isimp) {
    const cc1sq = cc1 * cc1;
    d2 = 4 * ao * tsi * cc1sq;
    const temp = (d2 * tsi * cc1) / 3;
    d3 = (17 * ao + sfour) * temp;
    d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * cc1;
    t3cof = d2 + 2 * cc1sq;
    t4cof = 0.25 * (3 * d3 + cc1 * (12 * d2 + 10 * cc1sq));
    t5cof = 0.2 * (3 * d4 + 12 * cc1 * d3 + 6 * d2 * d2 + 15 * cc1sq * (2 * d2 + cc1sq));
  }
  return {
    epochUtc: tle.epochUtc,
    bstar,
    ecco,
    argpo,
    inclo,
    mo,
    nodeo: tle.nodeo,
    noUnkozai,
    isimp,
    con41,
    eta,
    cc1,
    cc4,
    cc5,
    x1mth2,
    mdot,
    argpdot,
    nodedot,
    omgcof: bstar * cc3 * cos(argpo),
    xmcof: ecco > 1e-4 ? (-X2O3 * coef * bstar) / eeta : 0,
    nodecf: 3.5 * omeosq * xhdot1 * cc1,
    t2cof: 1.5 * cc1,
    xlcof:
      (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) /
      (Math.abs(cosio + 1) > 1.5e-12 ? 1 + cosio : 1.5e-12),
    aycof: -0.5 * J3OJ2 * sinio,
    delmo: delmotemp * delmotemp * delmotemp,
    sinmao: sin(mo),
    x7thm1: 7 * cosio2 - 1,
    d2,
    d3,
    d4,
    t3cof,
    t4cof,
    t5cof,
  };
}

/** Ort (km) und Geschwindigkeit (km/s) im TEME-System. */
export interface TemeState {
  readonly r: readonly [number, number, number];
  readonly v: readonly [number, number, number];
}

/** Zustand `tsinceMin` Minuten nach der Epoche; `null`, sobald die Bahn ungültig ist (zerfallen). */
export function sgp4(s: Sgp4Record, tsinceMin: number): TemeState | null {
  const t = tsinceMin;
  const xmdf = s.mo + s.mdot * t;
  const argpdf = s.argpo + s.argpdot * t;
  const nodedf = s.nodeo + s.nodedot * t;
  let argpm = argpdf;
  let mm = xmdf;
  const t2 = t * t;
  let nodem = nodedf + s.nodecf * t2;
  let tempa = 1 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;
  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delmtemp = 1 + s.eta * cos(xmdf);
    const delm = s.xmcof * (delmtemp * delmtemp * delmtemp - s.delmo);
    const tmp = delomg + delm;
    mm = xmdf + tmp;
    argpm = argpdf - tmp;
    const t3 = t2 * t;
    const t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe = tempe + s.bstar * s.cc5 * (sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }
  let nm = s.noUnkozai;
  let em = s.ecco;
  const inclm = s.inclo;
  if (nm <= 0) return null;
  const am = pow(XKE / nm, X2O3) * tempa * tempa;
  nm = XKE / pow(am, 1.5);
  em = em - tempe;
  if (em >= 1 || em < -0.001) return null;
  if (em < 1e-6) em = 1e-6;
  mm = mm + s.noUnkozai * templ;
  let xlm = mm + argpm + nodem;
  nodem = nodem % TWO_PI;
  argpm = argpm % TWO_PI;
  xlm = xlm % TWO_PI;
  mm = (xlm - argpm - nodem) % TWO_PI;
  const sinip = sin(inclm);
  const cosip = cos(inclm);
  const ep = em;
  const axnl = ep * cos(argpm);
  let temp = 1 / (am * (1 - ep * ep));
  const aynl = ep * sin(argpm) + temp * s.aycof;
  const xl = mm + argpm + nodem + temp * s.xlcof * axnl;
  // Kepler-Gleichung für die modifizierte exzentrische Anomalie
  const u = (xl - nodem) % TWO_PI;
  let eo1 = u;
  let tem5 = 9999.9;
  let ktr = 1;
  let sineo1 = 0;
  let coseo1 = 0;
  while (Math.abs(tem5) >= 1e-12 && ktr <= 10) {
    sineo1 = sin(eo1);
    coseo1 = cos(eo1);
    tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 = eo1 + tem5;
    ktr++;
  }
  // kurzperiodische Terme
  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) return null;
  const rl = am * (1 - ecose);
  const rdotl = (Math.sqrt(am) * esine) / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1 - el2);
  temp = esine / (1 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * temp);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * temp);
  let su = atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  temp = 1 / pl;
  const temp1 = 0.5 * J2 * temp;
  const temp2 = temp1 * temp;
  const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodem + 1.5 * temp2 * cosip * sin2u;
  const xinc = inclm + 1.5 * temp2 * cosip * sinip * cos2u;
  const mvt = rdotl - (nm * temp1 * s.x1mth2 * sin2u) / XKE;
  const rvdot = rvdotl + (nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41)) / XKE;
  const sinsu = sin(su);
  const cossu = cos(su);
  const snod = sin(xnode);
  const cnod = cos(xnode);
  const sini = sin(xinc);
  const cosi = cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;
  if (mrt < 1) return null; // unter der Oberfläche: zerfallen
  const vkmps = (WGS72_RADIUS_KM * XKE) / 60;
  return {
    r: [mrt * ux * WGS72_RADIUS_KM, mrt * uy * WGS72_RADIUS_KM, mrt * uz * WGS72_RADIUS_KM],
    v: [
      (mvt * ux + rvdot * vx) * vkmps,
      (mvt * uy + rvdot * vy) * vkmps,
      (mvt * uz + rvdot * vz) * vkmps,
    ],
  };
}
