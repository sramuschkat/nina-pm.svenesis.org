/*
 * Shared astronomy, time-zone and password helpers for the astronomy tools on svenesis.org:
 * the astro weather page (astro-tools/js/astro-weather.js) and the observing planner (astro-tools/js/observing-planner.js).
 * Vanilla JS, exposed as window.SvAstro.
 *
 * Sun: Meeus, Astronomical Algorithms ch. 25 (apparent position, within 0.01° of USNO). Moon: main periodic terms after
 * Meeus with topocentric parallax; rise and set agree with USNO to within a minute. Planets: JPL
 * Keplerian elements (1800–2050) and Mallama & Hilton 2018 magnitudes, checked against JPL Horizons.
 */
(function () {
  'use strict';

  var RAD = Math.PI / 180;
  var OBL = RAD * 23.4397;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ------------------------------------------------------------------ *
   * Sun and moon                                                       *
   * ------------------------------------------------------------------ */
  function toDays(ms) { return ms / 86400000 - 0.5 + 2440588 - 2451545; }
  /* ecliptic to equatorial with an obliquity eps (radians; the fixed OBL where none is given) */
  function rightAscension(l, b, eps) { var e = eps == null ? OBL : eps; return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)); }
  function declination(l, b, eps) { var e = eps == null ? OBL : eps; return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)); }
  /* Nutation in longitude and obliquity and the obliquity of date (Meeus ch. 22, the short series: 0.5″ and 0.1″), for
     days d since J2000. Moon, planets and comets are turned into apparent RA/Dec of date with it, as the sun already is:
     the fixed obliquity and the missing nutation put the moon 6–28″ beside the sun and shifted eclipse contacts by up to
     a minute. */
  function nutation(d) {
    var T = d / 36525, Om = RAD * (125.04452 - 1934.136261 * T), L = RAD * (280.4665 + 36000.7698 * T), Lp = RAD * (218.3165 + 481267.8813 * T);
    var dpsi = (-17.20 * Math.sin(Om) - 1.32 * Math.sin(2 * L) - 0.23 * Math.sin(2 * Lp) + 0.21 * Math.sin(2 * Om)) / 3600 * RAD;
    var deps = (9.20 * Math.cos(Om) + 0.57 * Math.cos(2 * L) + 0.10 * Math.cos(2 * Lp) - 0.09 * Math.cos(2 * Om)) / 3600 * RAD;
    var eps0 = RAD * (23.4392911 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T);
    return { dpsi: dpsi, deps: deps, eps0: eps0, eps: eps0 + deps };
  }
  /* A star's mean RA/Dec of date (radians) made apparent like the moon and planets: nutation (Meeus 23.1) and annual
     aberration (Meeus 23.2, circular orbit), together up to about 40″. Used by the occultations in sky-events.js and by
     the star map when zoomed in, so that a star and the moon meet on the map when the table says they do */
  function aberrate(ra0, dec0, ms) {
    var d = toDays(ms), L = sunCoords(d).lam, nu = nutation(d), eps = nu.eps, k = 20.49552 / 3600 * RAD;
    var ra = ra0 + (Math.cos(eps) + Math.sin(eps) * Math.sin(ra0) * Math.tan(dec0)) * nu.dpsi - Math.cos(ra0) * Math.tan(dec0) * nu.deps;
    var dec = dec0 + Math.sin(eps) * Math.cos(ra0) * nu.dpsi + Math.sin(ra0) * nu.deps;
    return { ra: ra - k * (Math.cos(ra) * Math.cos(L) * Math.cos(eps) + Math.sin(ra) * Math.sin(L)) / Math.cos(dec),
      dec: dec - k * (Math.cos(L) * Math.cos(eps) * (Math.tan(eps) * Math.cos(dec) - Math.sin(ra) * Math.sin(dec)) + Math.cos(ra) * Math.sin(dec) * Math.sin(L)) };
  }
  function altitudeOf(H, phi, dec) { return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)); }
  /* local mean sidereal time (radians) for days since J2000 and east longitude in degrees */
  function localSidereal(d, lon) { return RAD * (280.46061837 + 360.98564736629 * d) + RAD * lon; }

  /* Apparent sun after Meeus ch. 25, with nutation in longitude and aberration. The earlier low-precision set
     was up to 0.2° off in position (checked against the USNO navigation service); this one stays within 0.01°. */
  function sunCoords(d) {
    var T = d / 36525, M = RAD * (357.52911 + 35999.05029 * T - 0.0001537 * T * T);
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    var om = RAD * (125.04 - 1934.136 * T), lam = RAD * (280.46646 + 36000.76983 * T + 0.0003032 * T * T + C - 0.00569 - 0.00478 * Math.sin(om));
    var eps = RAD * (23.439291 - 0.0130042 * T + 0.00256 * Math.cos(om));
    var e = 0.016708634 - 0.000042037 * T, r = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(M + RAD * C)); /* distance in AU (Meeus 25.5) */
    return { ra: Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec: Math.asin(Math.sin(eps) * Math.sin(lam)), lam: lam, r: r };
  }

  /* The moon after Meeus, Astronomical Algorithms, chapter 47: the 60 terms of table 47.A for longitude and distance and
     the 30 largest of 47.B for latitude, with the corrections for Venus, Jupiter and the Earth's flattening. Against JPL
     Horizons within 0.01° (verify-planner); the six main terms used before were up to 0.37° off, which put the zoomed-in
     moon photo half its diameter beside its place and moonrise up to two minutes off. UT stands in for TT (ΔT ≈ 69 s,
     0.01° of lunar motion); no nutation. Columns: D, M, M′, F, longitude (1e-6°), distance (m) / latitude (1e-6°). */
  var MOON_LR = [
    [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149], [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210], [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
    [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056], [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
    [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
    [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
    [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897], [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
    [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117], [4, -1, 0, 0, 520, -1571],
    [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
    [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752]];
  var MOON_B = [
    [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833]];
  function moonCoords(d) {
    var T = d / 36525, T2 = T * T;
    var Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2, D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2;
    var M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2, Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2;
    var F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T2, E = 1 - 0.002516 * T - 0.0000074 * T2;
    var A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T, sl = 0, sr = 0, sb = 0, i, row, arg, ef;
    for (i = 0; i < MOON_LR.length; i++) {
      row = MOON_LR[i]; arg = RAD * (row[0] * D + row[1] * M + row[2] * Mp + row[3] * F); ef = row[1] === 0 ? 1 : row[1] === 1 || row[1] === -1 ? E : E * E;
      sl += row[4] * ef * Math.sin(arg); sr += row[5] * ef * Math.cos(arg);
    }
    for (i = 0; i < MOON_B.length; i++) {
      row = MOON_B[i]; arg = RAD * (row[0] * D + row[1] * M + row[2] * Mp + row[3] * F); ef = row[1] === 0 ? 1 : row[1] === 1 || row[1] === -1 ? E : E * E;
      sb += row[4] * ef * Math.sin(arg);
    }
    sl += 3958 * Math.sin(RAD * A1) + 1962 * Math.sin(RAD * (Lp - F)) + 318 * Math.sin(RAD * A2);
    sb += -2235 * Math.sin(RAD * Lp) + 382 * Math.sin(RAD * A3) + 175 * Math.sin(RAD * (A1 - F)) + 175 * Math.sin(RAD * (A1 + F)) + 127 * Math.sin(RAD * (Lp - Mp)) - 115 * Math.sin(RAD * (Lp + Mp));
    var nu = nutation(d), l = RAD * (Lp + sl / 1e6) + nu.dpsi, b = RAD * sb / 1e6, dist = 385000.56 + sr / 1000; /* apparent: nutation, true obliquity of date */
    return { ra: rightAscension(l, b, nu.eps), dec: declination(l, b, nu.eps), dist: dist, lam: l, beta: b };
  }

  /* The observer on the reference ellipsoid as a vector from the Earth's centre in the equatorial frame of date (km;
     Meeus, chapters 11 and 40): ρ cos φ′ turned to the local sidereal time, ρ sin φ′ towards the pole. The Earth turns by
     UT, so ms is UT here. */
  function observerVector(ms, lat, lon) {
    var u = Math.atan(0.99664719 * Math.tan(lat * RAD)), th = localSidereal(toDays(ms), lon), R = 6378.14;
    var rc = R * Math.cos(u), rs = R * 0.99664719 * Math.sin(u);
    return [rc * Math.cos(th), rc * Math.sin(th), rs];
  }
  /* A geocentric place (RA/Dec of date in radians, distance in km) seen from the place: the geocentric vector less the
     observer's. Returns the topocentric RA/Dec and distance. */
  function topocentric(ra, dec, distKm, ms, lat, lon) {
    var o = observerVector(ms, lat, lon);
    var x = distKm * Math.cos(dec) * Math.cos(ra) - o[0], y = distKm * Math.cos(dec) * Math.sin(ra) - o[1], z = distKm * Math.sin(dec) - o[2];
    var dist = Math.sqrt(x * x + y * y + z * z);
    return { ra: Math.atan2(y, x), dec: Math.asin(z / dist), dist: dist };
  }
  /* The moon seen from a place on the Earth: for occultations and eclipses, where the parallax of up to a degree decides
     whether and when the moon covers a star or the sun. dtSec (optional, ΔT) takes the moon at TT = UT + dtSec while the
     Earth turns by UT: without it an occultation comes about a minute late. The sun's parallax (up to 8.8″) matters for
     solar eclipses as well; sky-events.js takes it through topocentric() with the distance from sunCoords(). */
  function moonTopocentric(ms, lat, lon, dtSec) {
    var m = moonCoords(toDays(ms + (dtSec || 0) * 1000));
    return topocentric(m.ra, m.dec, m.dist, ms, lat, lon);
  }

  function sunAltitude(ms, lat, lon) {
    var d = toDays(ms), c = sunCoords(d);
    return altitudeOf(localSidereal(d, lon) - c.ra, RAD * lat, c.dec) / RAD;
  }

  /* Topocentric altitude, corrected for parallax */
  function moonAltitude(ms, lat, lon) {
    var d = toDays(ms), c = moonCoords(d);
    var h = altitudeOf(localSidereal(d, lon) - c.ra, RAD * lat, c.dec);
    return (h - Math.asin(6378.14 / c.dist) * Math.cos(h)) / RAD;
  }

  /* fraction: 0 new … 1 full; phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter */
  function moonIllumination(ms) {
    var d = toDays(ms), s = sunCoords(d), m = moonCoords(d), sunDist = 149598000;
    var phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    var inc = Math.atan2(sunDist * Math.sin(phi), m.dist - sunDist * Math.cos(phi));
    var angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
  }

  /* ------------------------------------------------------------------ *
   * Planets                                                            *
   * ------------------------------------------------------------------ */
  /* Keplerian elements and their rates per century (JPL, "Approximate Positions of the Major Planets",
     table 1, valid 1800–2050), J2000 ecliptic, precessed to the date in longitude. Checked against
     JPL Horizons: altitude and azimuth within about 0.1°. The Earth is the Earth–Moon barycentre. */
  var EARTH_EL = [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]];
  var PLANETS = [
    { id: 'mercury', el: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]] },
    { id: 'venus', el: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]] },
    { id: 'mars', el: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]] },
    { id: 'jupiter', el: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]] },
    { id: 'saturn', el: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]] },
    { id: 'uranus', el: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]] },
    { id: 'neptune', el: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]] }
  ];

  function heliocentric(el, T) {
    var v = el[0].map(function (x, k) { return x + el[1][k] * T; });
    var a = v[0], e = v[1], I = RAD * v[2], w = RAD * (v[4] - v[5]), O = RAD * v[5];
    var M = RAD * ((((v[3] - v[4]) % 360) + 540) % 360 - 180), E = M + e * Math.sin(M);
    for (var k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); /* Kepler's equation */
    var xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    var cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
    return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      sw * sI * xp + cw * sI * yp];
  }

  function planetCoords(planet, ms) {
    var T = toDays(ms) / 36525, E = heliocentric(EARTH_EL, T), P = heliocentric(planet.el, T);
    var x = P[0] - E[0], y = P[1] - E[1], z = P[2] - E[2];
    var dist = Math.sqrt(x * x + y * y + z * z), r = Math.sqrt(P[0] * P[0] + P[1] * P[1] + P[2] * P[2]), R = Math.sqrt(E[0] * E[0] + E[1] * E[1] + E[2] * E[2]);
    var lam = Math.atan2(y, x) + RAD * 1.396971 * T, beta = Math.atan2(z, Math.sqrt(x * x + y * y)); /* precession in longitude J2000 → date */
    var phase = Math.acos(clamp((r * r + dist * dist - R * R) / (2 * r * dist), -1, 1)) / RAD;
    var nu = nutation(T * 36525); /* apparent RA/Dec of date like sun and moon; lam stays the mean longitude for the magnitude */
    return { ra: rightAscension(lam + nu.dpsi, beta, nu.eps), dec: declination(lam + nu.dpsi, beta, nu.eps), lam: lam, beta: beta, dist: dist, r: r, phase: phase, T: T };
  }

  /* apparent magnitude from distances and phase angle (Mallama & Hilton 2018, the model behind JPL Horizons;
     the older Meeus formulas were up to 0.9 mag off for Mercury and 0.3 mag for Saturn) */
  function planetMagnitude(id, c) {
    var k = 5 * Math.log(c.r * c.dist) / Math.LN10, a = c.phase;
    if (id === 'mercury') return -0.613 + k + a * (6.3280e-2 + a * (-1.6336e-3 + a * (3.3644e-5 + a * (-3.4265e-7 + a * (1.6893e-9 - a * 3.0334e-12)))));
    if (id === 'venus') return a < 163.7 ? -4.384 + k + a * (-1.044e-3 + a * (3.687e-4 + a * (-2.814e-6 + a * 8.938e-9))) : 236.05828 + k + a * (-2.81914 + a * 8.39034e-3);
    if (id === 'mars') return a <= 50 ? -1.601 + k + a * (2.267e-2 - a * 1.302e-4) : -0.367 + k + a * (-2.573e-2 + a * 3.445e-4);
    if (id === 'jupiter') return -9.395 + k + a * (-3.7e-4 + a * 6.16e-4);
    if (id === 'uranus') return -7.110 + k + a * (6.587e-3 + a * 1.045e-4); /* without the small term for the sub-Earth latitude */
    if (id === 'neptune') return -7.00 + k; /* the phase angle stays below 2°, where the paper applies no phase term */
    /* Saturn: the rings brighten it the more they are tilted towards the Earth (ring tilt B) */
    var ir = RAD * (28.075216 - 0.012998 * c.T), Or = RAD * (169.508470 + 1.394681 * c.T);
    var sB = Math.abs(Math.sin(ir) * Math.cos(c.beta) * Math.sin(c.lam - Or) - Math.cos(ir) * Math.sin(c.beta));
    return -8.914 + k - 1.825 * sB + 0.026 * a - 0.378 * sB * Math.exp(-2.25 * a);
  }

  /* A comet from osculating elements as the JPL Small-Body Database gives them (q in AU, e, i, om = node, w =
     argument of perihelion in degrees for the ecliptic J2000, tp = time of perihelion as Julian date). Two-body
     motion with the universal-variable form of Kepler's equation, which covers ellipses, parabolas and hyperbolas
     alike; one light-time step. Returns RA/Dec of date, distances from sun and Earth (AU) and the total magnitude
     M1 + 5 log Δ + K1 log r. Planetary perturbations are left out, so positions drift slowly away from the
     elements' epoch. */
  function cometCoords(c, ms) {
    var T = toDays(ms) / 36525, E = heliocentric(EARTH_EL, T), k = 0.01720209895, sqmu = k, mu = k * k;
    function stumpC(z) { return z > 1e-6 ? (1 - Math.cos(Math.sqrt(z))) / z : z < -1e-6 ? (Math.cosh(Math.sqrt(-z)) - 1) / -z : 0.5 - z / 24; }
    function stumpS(z) {
      if (z > 1e-6) { var sz = Math.sqrt(z); return (sz - Math.sin(sz)) / (sz * sz * sz); }
      if (z < -1e-6) { var sn = Math.sqrt(-z); return (Math.sinh(sn) - sn) / (sn * sn * sn); }
      return 1 / 6 - z / 120;
    }
    function helio(dt) {
      /* Kepler's equation in the universal variable chi: sqmu·|t| = e·chi³·S(z) + q·chi grows steadily with chi, and as the
         first term is never negative, the root lies between 0 and sqmu·|t|/q. Newton alone, started at that upper end,
         bounced between aphelion and perihelion for ellipses far from perihelion (210P 52 AU away instead of 3.3 on single
         days); every step now stays inside the bracket, else it halves it. The time from perihelion is odd in chi. */
      var q = c.q, e = c.e, alpha = (1 - e) / q, target = sqmu * Math.abs(dt), lo = 0, hi = target / q, chi = hi;
      for (var n = 0; n < 200 && hi - lo > 1e-13 * (1 + hi); n++) {
        var z = alpha * chi * chi, F = e * chi * chi * chi * stumpS(z) + q * chi - target;
        if (F <= 0) lo = chi; else hi = chi; /* an overflow (NaN, Infinity) counts as too far */
        var next = chi - F / (e * chi * chi * stumpC(z) + q);
        if (!(next > lo && next < hi)) next = (lo + hi) / 2;
        if (Math.abs(next - chi) < 1e-14 * (1 + chi)) { chi = next; break; }
        chi = next;
      }
      if (dt < 0) chi = -chi;
      var z2 = alpha * chi * chi, x = (1 - chi * chi * stumpC(z2) / q) * q, y = (dt - chi * chi * chi * stumpS(z2) / sqmu) * Math.sqrt(mu * (1 + e) / q);
      var O = RAD * c.om, w = RAD * c.w, i = RAD * c.i, cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
      return [(cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y, (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y, sw * si * x + cw * si * y];
    }
    var dt = toDays(ms) + 2451545 - c.tp, P = helio(dt), G = [P[0] - E[0], P[1] - E[1], P[2] - E[2]];
    P = helio(dt - Math.sqrt(G[0] * G[0] + G[1] * G[1] + G[2] * G[2]) * 0.0057755183); /* light time */
    G = [P[0] - E[0], P[1] - E[1], P[2] - E[2]];
    var dist = Math.sqrt(G[0] * G[0] + G[1] * G[1] + G[2] * G[2]), r = Math.sqrt(P[0] * P[0] + P[1] * P[1] + P[2] * P[2]);
    var lam = Math.atan2(G[1], G[0]) + RAD * 1.396971 * T, beta = Math.atan2(G[2], Math.sqrt(G[0] * G[0] + G[1] * G[1]));
    var nu = nutation(T * 36525);
    return { ra: rightAscension(lam + nu.dpsi, beta, nu.eps), dec: declination(lam + nu.dpsi, beta, nu.eps), r: r, dist: dist, mag: c.M1 + 5 * Math.log(dist) / Math.LN10 + c.K1 * Math.log(r) / Math.LN10 };
  }

  /* altitude and azimuth (degrees, azimuth from north through east) for right ascension / declination in radians */
  function horizontalOf(ra, dec, ms, lat, lon) {
    var H = localSidereal(toDays(ms), lon) - ra, phi = RAD * lat;
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / RAD + 180;
    return { alt: altitudeOf(H, phi, dec) / RAD, az: ((az % 360) + 360) % 360 };
  }

  function sunHorizontal(ms, lat, lon) {
    var d = toDays(ms), c = sunCoords(d), H = localSidereal(d, lon) - c.ra, phi = RAD * lat;
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)) / RAD + 180;
    return { alt: altitudeOf(H, phi, c.dec) / RAD, az: ((az % 360) + 360) % 360 };
  }

  var BODIES = ['moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
  var BODY_COL = { moon: '#ecebe2', mercury: '#b4b2a9', venus: '#fac775', mars: '#f0997b', jupiter: '#f1efe8', saturn: '#ef9f27', uranus: '#9fd8d3', neptune: '#8ea8f5' };

  /* altitude and azimuth of the moon or a planet at a moment (Unix seconds); the moon keeps its
     parallax-corrected altitude and brings its illuminated fraction, planets their magnitude */
  function bodyAt(id, sec, lat, lon) {
    var ms = sec * 1000;
    if (id === 'moon') {
      var m = moonCoords(toDays(ms)), hm = horizontalOf(m.ra, m.dec, ms, lat, lon);
      hm.alt = moonAltitude(ms, lat, lon);
      hm.illum = moonIllumination(ms).fraction;
      return hm;
    }
    var p = PLANETS.filter(function (x) { return x.id === id; })[0], c = planetCoords(p, ms), h = horizontalOf(c.ra, c.dec, ms, lat, lon);
    h.mag = planetMagnitude(id, c);
    return h;
  }

  /* Rigorous precession (Meeus, Astronomical Algorithms, 21.4; IAU 1976 angles). The first-order formulas used before
     divided by tan(Dec) and were up to 0.016° off near the pole (Polaris) and useless on it. precAngles() once per
     epoch; precessRig() J2000 degrees to that epoch in radians, toJ2000() back to J2000 degrees. */
  function precAngles(ms) {
    var T = toDays(ms) / 36525, s = RAD / 3600;
    return { zeta: (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * s, z: (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * s,
      theta: (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * s };
  }
  function precessRig(raDeg, decDeg, p) {
    var a = raDeg * RAD + p.zeta, d = decDeg * RAD, cd = Math.cos(d), sd = Math.sin(d), ct = Math.cos(p.theta), st = Math.sin(p.theta);
    return { ra: Math.atan2(cd * Math.sin(a), ct * cd * Math.cos(a) - st * sd) + p.z, dec: Math.asin(clamp(st * cd * Math.cos(a) + ct * sd, -1, 1)) };
  }
  function toJ2000(ra, dec, p) {
    var a = ra - p.z, cd = Math.cos(dec), sd = Math.sin(dec), ct = Math.cos(p.theta), st = Math.sin(p.theta);
    return { ra: ((Math.atan2(cd * Math.sin(a), ct * cd * Math.cos(a) + st * sd) - p.zeta) / RAD % 360 + 360) % 360, dec: Math.asin(clamp(-st * cd * Math.cos(a) + ct * sd, -1, 1)) / RAD };
  }
  /* J2000 right ascension and declination (degrees) precessed to a date (ms), returned in radians */
  function precessJ2000(raDeg, decDeg, ms) { return precessRig(raDeg, decDeg, precAngles(ms)); }

  /* Atmospheric refraction at 10 °C and 1010 hPa, in degrees: refract() lifts a true altitude to the apparent one
     (Sæmundsson), unrefract() takes an apparent altitude back (Bennett; Meeus, chapter 16). About 34′ at the horizon,
     1′ at 45°. Below −1° the lift fades out, where nothing is shown anyway. For drawing only: rise and set keep their
     −0.567° and −0.833°, which already contain it. */
  function refract(alt) {
    if (alt < -2) return alt;
    var h = Math.max(alt, -1);
    return alt + 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD) / 60 * clamp(alt + 2, 0, 1);
  }
  function unrefract(alt) {
    if (alt < -2) return alt;
    var h = Math.max(alt, -1), t = alt - 1 / Math.tan((h + 7.31 / (h + 4.4)) * RAD) / 60 * clamp(alt + 2, 0, 1);
    /* below 5° (apparent) Newton turns Bennett's value into the exact inverse of refract(): the two formulas differ there, most
       where both fade out below the horizon (0.4° apart); higher up they agree within 2″ */
    for (var i = 0; alt < 5 && i < 6; i++) {
      var g = refract(t) - alt, dg = (refract(t + 1e-4) - refract(t - 1e-4)) / 2e-4;
      if (Math.abs(g) < 1e-10 || !(dg > 0.05)) break;
      t -= g / dg;
    }
    return t;
  }

  /* ------------------------------------------------------------------ *
   * Events and nights                                                  *
   * ------------------------------------------------------------------ */
  /* times at which fn(t) crosses level, interpolated between samples */
  function crossings(fn, t0, t1, step, level) {
    var out = [], prev = fn(t0) - level;
    for (var t = t0 + step; t <= t1; t += step) {
      var cur = fn(t) - level;
      if ((prev < 0) !== (cur < 0)) out.push({ t: Math.round(t - step + step * prev / (prev - cur)), rising: cur > 0 });
      prev = cur;
    }
    return out;
  }

  var TWI = ['#5d80a8', '#3e5c82', '#28415f', '#18283b', '#0b1119']; /* day, civil, nautical, astronomical, night */
  function twilightClass(alt) { return alt > -0.833 ? 0 : alt > -6 ? 1 : alt > -12 ? 2 : alt > -18 ? 3 : 4; }

  /* The part of a window (Unix seconds) in which fn stays below a level: from a setting crossing, or from the start if it
     is below already, to the next rising crossing or the end. Near the poles the sun can dip below a level twice in one
     noon-to-noon window, or start or end the window dark; then the stretch holding the window's middle counts, else the
     longest. Requiring a setting and then a rising crossing reported no darkness at all there. */
  function belowInterval(fn, start, end, step, level) {
    var cr = crossings(fn, start, end, step, level), spans = [], from = fn(start) < level ? start : null, mid = (start + end) / 2, best = null;
    cr.forEach(function (c) { if (!c.rising) from = c.t; else if (from != null) { spans.push([from, c.t]); from = null; } });
    if (from != null) spans.push([from, end]);
    spans.forEach(function (r) { if (r[0] <= mid && r[1] >= mid) best = r; });
    if (!best) spans.forEach(function (r) { if (!best || r[1] - r[0] > best[1] - best[0]) best = r; });
    return best;
  }

  /* One night, local noon to noon: astronomical darkness from the exact −18° crossings (dark throughout
     in a polar night), and the parts of it with the moon's upper limb below the horizon. */
  function darkness(key, lat, lon, off) {
    var st = { evening: fromLocal(key * 86400 + 43200, off), next: fromLocal((key + 1) * 86400 + 43200, off), from: null, to: null, moonFree: [], moonFreeSec: 0 };
    var sunFn = function (sec) { return sunAltitude(sec * 1000, lat, lon); }, dark = belowInterval(sunFn, st.evening, st.next, 60, -18);
    st.from = dark ? dark[0] : null;
    st.to = dark ? dark[1] : null;
    if (st.from == null) return st;
    var moonFn = function (sec) { return moonAltitude(sec * 1000, lat, lon); };
    var edges = [st.from].concat(crossings(moonFn, st.from, st.to, 60, -0.833).map(function (c) { return c.t; }), [st.to]);
    for (var e = 0; e < edges.length - 1; e++) {
      if (edges[e + 1] > edges[e] && moonFn((edges[e] + edges[e + 1]) / 2) < -0.833) {
        st.moonFree.push([edges[e], edges[e + 1]]);
        st.moonFreeSec += edges[e + 1] - edges[e];
      }
    }
    return st;
  }

  /* ------------------------------------------------------------------ *
   * Local time                                                         *
   * ------------------------------------------------------------------ */
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* UTC offset (seconds) of a time zone at a given moment, as a function. One fixed offset is an hour
     off for everything after a daylight-saving switch; the IANA zone lets the browser work it out per
     moment. An unknown zone falls back to the fixed offset. */
  function offsetFn(zone, fallback) {
    var fmt = null, cache = {};
    try {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch (e) { fmt = null; }
    return function (sec) {
      if (!fmt) return fallback;
      var k = Math.floor(sec / 1800); /* zones switch on full or half hours */
      if (cache[k] == null) {
        var p = {};
        fmt.formatToParts(new Date(k * 1800000)).forEach(function (x) { p[x.type] = x.value; });
        cache[k] = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) / 1000 - k * 1800) / 60) * 60;
      }
      return cache[k];
    };
  }

  function localDate(sec, offAt) { return new Date((sec + offAt(sec)) * 1000); }
  /* rounded to the nearest minute, as almanacs such as USNO's give their times */
  function hhmm(sec, offAt) { var d = localDate(Math.round(sec / 60) * 60, offAt); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  /* the moment (Unix seconds) of a local wall-clock time given as seconds since the local epoch */
  function fromLocal(localSec, offAt) { return localSec - offAt(localSec - offAt(localSec)); }
  /* a night belongs to the evening it starts on: its key is the local day number of the noon before */
  function nightKeyOf(sec, offAt) { return Math.floor((sec + offAt(sec) - 43200) / 86400); }

  /* ------------------------------------------------------------------ *
   * Drawing                                                            *
   * ------------------------------------------------------------------ */
  function drawMoonIcon(ctx, x, y, r, phase, fraction) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = '#2a3038';
    ctx.fill();
    if (fraction < 0.01) return;
    var waxing = phase < 0.5, rx = Math.abs(Math.cos(2 * Math.PI * phase)) * r, crescent = fraction < 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
    if (waxing === crescent) ctx.ellipse(x, y, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
    else ctx.ellipse(x, y, rx, r, 0, Math.PI / 2, 3 * Math.PI / 2, false);
    ctx.fillStyle = '#ecebe2';
    ctx.fill();
  }

  /* moon in its real phase: drawn as a waxing shape lit towards +x, then turned so the lit side faces the sun */
  function drawLitMoon(ctx, cx, cy, r, fraction, angle) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    drawMoonIcon(ctx, 0, 0, r, Math.acos(clamp(1 - 2 * fraction, -1, 1)) / (2 * Math.PI), fraction);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * Password gate for custom coordinates                               *
   * ------------------------------------------------------------------ */
  /* A gate, not security: only a salted SHA-256 is kept here, so the password cannot be read off the
     code, but the check runs in the browser. New password: replace PW_HASH with the hex SHA-256 of
     PW_SALT + password. Resolves to true / false, or null where the browser cannot hash. */
  var PW_SALT = 'svenesis-astro-weather:', PW_HASH = 'd62f673d03a0d5102588d18d768343e29dc0e2ec54c09849a63ed6d88bb9dead';

  function checkPassword(pw) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(PW_SALT + pw)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('') === PW_HASH;
    });
  }

  window.SvAstro = {
    RAD: RAD, clamp: clamp, toDays: toDays,
    sunCoords: sunCoords, moonCoords: moonCoords, observerVector: observerVector, topocentric: topocentric, moonTopocentric: moonTopocentric, nutation: nutation, aberrate: aberrate, cometCoords: cometCoords, sunAltitude: sunAltitude, moonAltitude: moonAltitude, moonIllumination: moonIllumination,
    PLANETS: PLANETS, planetCoords: planetCoords, planetMagnitude: planetMagnitude, horizontalOf: horizontalOf, sunHorizontal: sunHorizontal,
    BODIES: BODIES, BODY_COL: BODY_COL, bodyAt: bodyAt, precessJ2000: precessJ2000,
    precAngles: precAngles, precessRig: precessRig, toJ2000: toJ2000, refract: refract, unrefract: unrefract,
    crossings: crossings, belowInterval: belowInterval, TWI: TWI, twilightClass: twilightClass, darkness: darkness,
    pad: pad, offsetFn: offsetFn, localDate: localDate, hhmm: hhmm, fromLocal: fromLocal, nightKeyOf: nightKeyOf,
    drawMoonIcon: drawMoonIcon, drawLitMoon: drawLitMoon, checkPassword: checkPassword
  };
})();
