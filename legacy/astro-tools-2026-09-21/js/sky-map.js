/*
 * Star map of the observing planner for svenesis.org (astro-tools/observing-planner_{de,en}.html)
 *
 * The sky from the horizon to the zenith in a stereographic view that turns and zooms: stars from astro-tools/js/star-catalog.js
 * (and astro-tools/data/stars-8.bin when zoomed in), constellation lines and names, Milky Way, ecliptic, moon and
 * planets, the deep-sky objects of astro-tools/js/dso-catalog.js, satellite passes and comets, and from 45° wide the DSS2 colour
 * photographs of CDS, Strasbourg. Loaded after astro-tools/js/astro-core.js and before astro-tools/js/observing-planner.js, which creates the
 * map once with the state, elements, texts and helpers both share (window.SvSkyMap.create(env)) and gets back what it
 * calls. The pure helpers — HEALPix, precession, the projection, constellation boundaries, proper motion — also sit on window.SvSkyMap, for
 * astro-tools/tools/verify-planner.js.
 */
(function () {
  'use strict';

  var A = window.SvAstro;
  if (!A) return;
  var RAD = A.RAD, clamp = A.clamp;

  /* HEALPix, nested scheme, as HiPS lays out its tiles (Górski et al. 2005; checked in Node: 28 000 random points on
     orders 3–9 round-trip to their own pixel and fall into the right sub-pixel) */
  var HPX_JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4], HPX_JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];
  function hpxInterleave(ix, iy) { var p = 0; for (var b = 0; b < 16; b++) p += (((ix >> b) & 1) + ((iy >> b) & 1) * 2) * Math.pow(4, b); return p; }
  function hpxXYF(order, ipix) { /* pixel number to base face and position on it */
    var n2 = Math.pow(4, order), face = Math.floor(ipix / n2), r = ipix - face * n2, ix = 0, iy = 0;
    for (var b = 0; b < order; b++) { ix += (r % 2) * (1 << b); r = Math.floor(r / 2); iy += (r % 2) * (1 << b); r = Math.floor(r / 2); }
    return { face: face, ix: ix, iy: iy };
  }
  function hpxLoc(face, x, y) { /* continuous face coordinates (0–1) to J2000 RA/Dec in degrees */
    var jr = HPX_JRLL[face] - x - y, nr, z;
    if (jr < 1) { nr = jr; z = 1 - nr * nr / 3; } else if (jr > 3) { nr = 4 - jr; z = nr * nr / 3 - 1; } else { nr = 1; z = (2 - jr) * 2 / 3; }
    var t = HPX_JPLL[face] * nr + x - y;
    if (t < 0) t += 8;
    if (t >= 8) t -= 8;
    return { ra: nr < 1e-15 ? 0 : 45 * t / nr, dec: Math.asin(clamp(z, -1, 1)) / RAD };
  }
  function hpxPix(order, raDeg, decDeg) { /* J2000 RA/Dec in degrees to the pixel number */
    var nside = 1 << order, z = Math.sin(decDeg * RAD), za = Math.abs(z), tt = ((raDeg / 90) % 4 + 4) % 4, face, ix, iy;
    if (za <= 2 / 3) {
      var t1 = nside * (0.5 + tt), t2 = nside * z * 0.75, jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2), ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside);
      face = ifp === ifm ? (ifp | 4) : ifp < ifm ? ifp : ifm + 8;
      ix = jm & (nside - 1); iy = nside - (jp & (nside - 1)) - 1;
    } else {
      var ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt, tmp = nside * Math.sqrt(3 * (1 - za));
      var jp2 = Math.min(nside - 1, Math.floor(tp * tmp)), jm2 = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
      if (z >= 0) { face = ntt; ix = nside - jm2 - 1; iy = nside - jp2 - 1; } else { face = ntt + 8; ix = jp2; iy = jm2; }
    }
    return face * nside * nside + hpxInterleave(ix, iy);
  }

  /* rigorous precession, from astro-tools/js/astro-core.js */
  var precAngles = A.precAngles, precessRig = A.precessRig, toJ2000 = A.toJ2000;

  /* The IAU drew the constellation boundaries along the parallels and hour circles of B1875; astro-tools/js/star-catalog.js holds
     their corners at J2000. Taken back to B1875 the edges are straight in RA and Dec again, so the test whether a point
     lies in a constellation is exact there, and the drawn edges follow the true curves once filled in along B1875. */
  var B1875 = Date.UTC(1874, 11, 31, 18, 12); /* Besselian epoch 1875.0 */
  function wrap180(d) { return ((d % 360) + 540) % 360 - 180; }
  function boundsB1875(raw) {
    var p = precAngles(B1875);
    return raw.map(function (b) {
      var ring = [];
      for (var i = 0; i < b[1].length; i += 2) {
        var q = precessRig(b[1][i], b[1][i + 1], p);
        ring.push([(q.ra / RAD % 360 + 360) % 360, q.dec / RAD]);
      }
      var f = ring[0], l = ring[ring.length - 1];
      if (ring.length > 1 && Math.abs(wrap180(f[0] - l[0])) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) ring.pop();
      return { id: b[0], ring: dropStrays(ring) };
    });
  }
  /* The source subdivides a few long B1875 parallels with points placed at J2000, which land off the parallel once taken
     back to B1875 (round the pole in Cep and UMi by up to 0.45°, bending the edge and moving a sliver into the wrong
     constellation). Between two corners of one Dec, points that lie off it by under a degree and share their RA with
     neither neighbour (a real step has two corners on one hour circle) are dropped: exactly those six. */
  function dropStrays(ring) {
    var n = ring.length, drop = {};
    for (var i = 0; i < n; i++) {
      for (var j = i + 2; j <= i + 6 && j < i + n; j++) {
        var a = ring[i], b = ring[j % n], ok = Math.abs(a[1] - b[1]) <= 0.01;
        for (var k = i + 1; ok && k < j; k++) {
          var pt = ring[k % n], pr = ring[(k - 1) % n], nx = ring[(k + 1) % n], off = Math.abs(pt[1] - a[1]);
          ok = off >= 0.01 && off <= 1 && Math.abs(wrap180(pt[0] - pr[0])) >= 0.01 && Math.abs(wrap180(nx[0] - pt[0])) >= 0.01;
        }
        if (ok) { for (k = i + 1; k < j; k++) drop[k % n] = true; break; }
      }
    }
    return ring.filter(function (pt, idx) { return !drop[idx]; });
  }
  /* even-odd test along the hour circle northwards; a ring that winds once round the north pole counts the other way */
  function inRing(ring, ra, dec) {
    var cross = 0, turn = 0, sumDec = 0, n = ring.length;
    for (var i = 0; i < n; i++) {
      var a = ring[i], b = ring[(i + 1) % n], dl = wrap180(b[0] - a[0]), a1 = wrap180(a[0] - ra), a2 = a1 + dl;
      turn += dl; sumDec += a[1];
      if ((a1 <= 0 && a2 > 0) || (a2 <= 0 && a1 > 0)) {
        if (a[1] + (b[1] - a[1]) * (0 - a1) / (a2 - a1) > dec) cross++;
      }
    }
    var inside = cross % 2 === 1;
    return Math.abs(turn) > 180 && sumDec > 0 ? !inside : inside;
  }
  /* the IAU abbreviation of the constellation holding a J2000 position (degrees) */
  function constellationAt(bnds, raJ, decJ) {
    var q = precessRig(raJ, decJ, precAngles(B1875)), ra = (q.ra / RAD % 360 + 360) % 360, dec = q.dec / RAD;
    for (var i = 0; i < bnds.length; i++) if (inRing(bnds[i].ring, ra, dec)) return bnds[i].id;
    return null;
  }
  /* the boundary rings filled in every degree along B1875 and precessed to a date: [RA, Dec] in radians */
  function boundsSky(bnds, ms) {
    var p75 = precAngles(B1875), pn = precAngles(ms);
    return bnds.map(function (b) {
      var r = b.ring, pts = [];
      for (var i = 0; i < r.length; i++) {
        var a = r[i], c = r[(i + 1) % r.length], dl = wrap180(c[0] - a[0]), dd = c[1] - a[1];
        var n = Math.max(1, Math.ceil(Math.max(Math.abs(dl) * Math.cos(a[1] * RAD), Math.abs(dd))));
        for (var k = 0; k < n; k++) {
          var j = toJ2000((a[0] + dl * k / n) * RAD, (a[1] + dd * k / n) * RAD, p75), q = precessRig(j.ra, j.dec, pn);
          pts.push([q.ra, q.dec]);
        }
      }
      pts.push(pts[0]);
      return { id: b.id, pts: pts };
    });
  }
  /* years from J2000.0 to a moment, and a J2000 position (degrees) of epoch 2000 moved along its proper motion (mas per
     year, the RA part already times cos Dec) */
  function skyYears(ms) { return (ms - Date.UTC(2000, 0, 1, 12)) / 31557600000; }
  function moved(ra, dec, pmra, pmde, years) {
    var cd = Math.cos(dec * RAD);
    return [ra + (cd > 1e-6 ? pmra / cd : 0) * years / 3.6e6, clamp(dec + pmde * years / 3.6e6, -90, 90)];
  }

  /* The star map's projection for a canvas size, as in a planetarium program: stereographic, `fov` degrees wide (at most
     160°, 120° on narrow screens, where the zenith still fits; `fovSet` when zoomed in, not below `fovMin`), centred on
     azimuth az0. Without a zoom (`fovSet` null) the middle is tilted so that the horizon straight ahead sits just above the bottom edge; zoomed in, the middle
     sits at `caltSet` degrees, which can go up to the zenith but not below that tilt. The horizon is a circle, shapes stay true. */
  function skyProjection(W, H, az0, fovSet, caltSet, fovMin) {
    var fovMax = W < 560 ? 120 : 160, fov = clamp(fovSet || fovMax, fovMin, fovMax), cy = H / 2;
    var k = W / 4 / Math.tan(fov * RAD / 4), cMin = Math.min(2 * Math.atan((H / 2 - 34) / (2 * k)), Math.PI / 2); /* a tall canvas would tilt past the zenith */
    var c0 = fovSet == null || caltSet == null ? cMin : clamp(caltSet * RAD, cMin, Math.PI / 2);
    var sc0 = Math.sin(c0), cc0 = Math.cos(c0), sa0 = Math.sin(az0 * RAD), ca0 = Math.cos(az0 * RAD);
    function proj(h) {
      var a = h.alt * RAD, z0 = h.az * RAD, ca = Math.cos(a), e = ca * Math.sin(z0), n = ca * Math.cos(z0), u = Math.sin(a);
      var fwdH = e * sa0 + n * ca0, z = cc0 * fwdH + sc0 * u;
      if (z < -0.9) return null; /* close to the point straight behind the viewer */
      return { x: W / 2 + 2 * k * (e * ca0 - n * sa0) / (1 + z), y: cy - 2 * k * (cc0 * u - sc0 * fwdH) / (1 + z) };
    }
    function unproj(x, y) { /* screen point back to altitude and azimuth (radians) */
      var X = x - W / 2, Y = cy - y, rho = Math.sqrt(X * X + Y * Y), ang = 2 * Math.atan(rho / (2 * k)), s = rho ? Math.sin(ang) / rho : 0;
      var r = X * s, up = Y * s, f = Math.cos(ang), fwdH = f * cc0 - up * sc0;
      return { alt: Math.asin(clamp(up * cc0 + f * sc0, -1, 1)), az: Math.atan2(r * ca0 + fwdH * sa0, -r * sa0 + fwdH * ca0) };
    }
    return { fov: fov, fovMax: fovMax, k: k, c0: c0, cMin: cMin, sc0: sc0, cc0: cc0, proj: proj, unproj: unproj };
  }

  /* ------------------------------------------------------------------ *
   * Planets and moon in detail (pure; checked by astro-tools/tools/verify-planner.js against JPL Horizons)
   * ------------------------------------------------------------------ */
  function sinD(x) { return Math.sin(x * RAD); }
  function cosD(x) { return Math.cos(x * RAD); }
  /* north poles after the IAU rotation models (J2000 RA and Dec in degrees) and flattening */
  var PLANET_POLE = { mercury: [281.01, 61.41], venus: [272.76, 67.16], mars: [317.681, 52.887], jupiter: [268.0566, 64.4953], saturn: [40.589, 83.537], uranus: [257.311, -15.175], neptune: [299.36, 43.46] };
  var PLANET_FLAT = { jupiter: 0.0649, saturn: 0.0980, uranus: 0.0229, neptune: 0.0171 };
  /* position angle (degrees from north through east) of the point (ra2, dec2) seen from (ra1, dec1), all in degrees */
  function posAngle(ra1, dec1, ra2, dec2) {
    return (Math.atan2(cosD(dec2) * sinD(ra2 - ra1), sinD(dec2) * cosD(dec1) - cosD(dec2) * sinD(dec1) * cosD(ra2 - ra1)) / RAD + 360) % 360;
  }
  /* A planet's axis seen from the Earth, from its J2000 RA/Dec in degrees: P, the position angle of its north pole, and
     B, the planetocentric latitude of the Earth (for Saturn the tilt of the rings). Against JPL Horizons: P within 0.03°,
     B within 0.002° once turned into Horizons' planetographic latitude. */
  function planetAxis(id, raJ, decJ) {
    var p = PLANET_POLE[id];
    if (!p) return null;
    var u = [cosD(decJ) * cosD(raJ), cosD(decJ) * sinD(raJ), sinD(decJ)], n = [cosD(p[1]) * cosD(p[0]), cosD(p[1]) * sinD(p[0]), sinD(p[1])];
    return { P: posAngle(raJ, decJ, p[0], p[1]), B: Math.asin(clamp(-(u[0] * n[0] + u[1] * n[1] + u[2] * n[2]), -1, 1)) / RAD };
  }
  /* The Galilean satellites (Meeus, Astronomical Algorithms, chapter 44, lower accuracy): X towards the west and Y towards
     Jupiter's north, in Jupiter radii; front while between Jupiter and the Earth. Within 2.5″ of JPL Horizons. */
  function galileanMoons(ms) {
    var d = ms / 86400000 + 2440587.5 - 2451545.0;
    var V = 172.74 + 0.00111588 * d, M = 357.529 + 0.9856003 * d;
    var N = 20.020 + 0.0830853 * d + 0.329 * sinD(V), J = 66.115 + 0.9025179 * d - 0.329 * sinD(V);
    var Aa = 1.915 * sinD(M) + 0.020 * sinD(2 * M), B = 5.555 * sinD(N) + 0.168 * sinD(2 * N), K = J + Aa - B;
    var Rr = 1.00014 - 0.01671 * cosD(M) - 0.00014 * cosD(2 * M), r = 5.20872 - 0.25208 * cosD(N) - 0.00611 * cosD(2 * N);
    var Dl = Math.sqrt(r * r + Rr * Rr - 2 * r * Rr * cosD(K)), psi = Math.asin(Rr / Dl * sinD(K)) / RAD, dd = d - Dl / 173;
    var u1 = 163.8069 + 203.4058646 * dd + psi - B, u2 = 358.4140 + 101.2916335 * dd + psi - B, u3 = 5.7176 + 50.2345180 * dd + psi - B, u4 = 224.8092 + 21.4879800 * dd + psi - B;
    var G = 331.18 + 50.310482 * dd, H = 87.45 + 21.569231 * dd;
    var r1 = 5.9057 - 0.0244 * cosD(2 * (u1 - u2)), r2 = 9.3966 - 0.0882 * cosD(2 * (u2 - u3)), r3 = 14.9883 - 0.0216 * cosD(G), r4 = 26.3627 - 0.1939 * cosD(H);
    var c1 = 0.473 * sinD(2 * (u1 - u2)), c2 = 1.065 * sinD(2 * (u2 - u3)), c3 = 0.165 * sinD(G), c4 = 0.843 * sinD(H);
    var lam = 34.35 + 0.083091 * d + 0.329 * sinD(V) + B, Ds = 3.12 * sinD(lam + 42.8);
    var De = Ds - 2.22 * sinD(psi) * cosD(lam + 22) - 1.30 * (r - Dl) / Dl * sinD(lam - 100.5);
    return [[r1, u1 + c1], [r2, u2 + c2], [r3, u3 + c3], [r4, u4 + c4]].map(function (m) {
      /* u counts from the inferior conjunction: nearer than Jupiter (in front of it) while cos u > 0 */
      /* seen from the sun (for shadows on the disc and eclipses in Jupiter's shadow): without the phase angle psi, with Ds */
      var us = m[1] - psi;
      return { X: m[0] * sinD(m[1]), Y: -m[0] * cosD(m[1]) * sinD(De), front: cosD(m[1]) > 0, Xs: m[0] * sinD(us), Ys: -m[0] * cosD(us) * sinD(Ds), frontSun: cosD(us) > 0 };
    });
  }
  /* The Moon's optical libration in longitude l and latitude b and the position angle P of its axis (Meeus, chapter 53;
     geocentric, physical libration left out): within 0.1° of JPL Horizons */
  function moonLibration(ms) {
    var d = A.toDays(ms), T = d / 36525, mc = A.moonCoords(d), lam = mc.lam / RAD, bet = mc.beta / RAD;
    var Om = 125.0445479 - 1934.1362891 * T, F = 93.2720950 + 483202.0175233 * T, I = 1.54242, W = lam - Om;
    var Aang = Math.atan2(sinD(W) * cosD(bet) * cosD(I) - sinD(bet) * sinD(I), cosD(W) * cosD(bet)) / RAD;
    var l = ((Aang - F) % 360 + 540) % 360 - 180, b = Math.asin(clamp(-sinD(W) * cosD(bet) * sinD(I) - sinD(bet) * cosD(I), -1, 1)) / RAD;
    var eps = 23.4393 - 3.563e-7 * d, X = sinD(I) * sinD(Om), Y = sinD(I) * cosD(Om) * cosD(eps) - cosD(I) * sinD(eps), om = Math.atan2(X, Y) / RAD;
    return { l: l, b: b, P: Math.asin(clamp(Math.sqrt(X * X + Y * Y) * cosD(mc.ra / RAD - om) / cosD(b), -1, 1)) / RAD };
  }

  /* Search keys (pure; checked by verify-planner): lower case without accents, spaces or punctuation, ß as ss (it has no
     base letter and was dropped: "Großer Bär" became "groerbar", so "Grosser Bär" found nothing), Greek letter names
     turned into letters (alpha lyr → αlyr) and leading zeros of catalogue numbers dropped (NGC 0891 → ngc891) */
  var GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
    nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω' };
  var GREEK_RE = new RegExp('\\b(' + Object.keys(GREEK).join('|') + ')\\b', 'g');
  /* catalogue names written out: "Caldwell 30" is C 30, "Sharpless 155" and "Sharpless 2-155" are Sh2-155 */
  function searchKey(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/^\s*caldwell\b/, 'c').replace(/^\s*sharpless\s*(?:2\s*-\s*)?/, 'sh2-')
      .replace(GREEK_RE, function (m) { return GREEK[m]; }).replace(/[^a-z0-9α-ω]+/g, '').replace(/^(m|ngc|ic|b|c)0+(?=\d)/, '$1');
  }
  /* the keys of one name: its key, and with umlauts written out a second one (Bär → bar and baer), so that "Baer" finds too */
  var UMLAUT = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue' };
  function searchKeys(name) {
    var keys = [searchKey(name)], s = String(name).toLowerCase();
    if (/[äöü]/.test(s)) keys.push(searchKey(s.replace(/[äöü]/g, function (c) { return UMLAUT[c]; })));
    return keys;
  }
  /* names in the order a reader expects: letters alphabetically, numbers by value (M5 before M50, NGC 101 before NGC 1010) */
  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  /* Apparent places for the map. Stars, lines, deep-sky objects, photos and grid were mean places of date, while the sun,
     moon and planets are apparent ones (nutation and annual aberration, A.aberrate() in the core, together up to 40″):
     a star and the moon met on the map up to 40″ from where the occultation table said. A.aberrate() works out the sun
     and the nutation on every call (2.5 µs), too slow for the 36 000 faint stars each night, so the shift is taken exactly
     on a 10° grid and interpolated as an offset along the sky (within 0.3″ of A.aberrate() away from the poles, 0.3 µs a star).
     apparentAt(ms) returns the function (ra, dec radians of date) → { ra, dec } for that moment. */
  function apparentAt(ms) {
    var step = 10 * RAD, nr = 36, nd = 19, dx = new Float64Array(nr * nd), dy = new Float64Array(nr * nd);
    for (var j = 0; j < nd; j++) {
      for (var i = 0; i < nr; i++) {
        /* the pole rows are taken at ±89°: the first-order formulas of aberrate() divide by cos δ and drift within 0.1° of
           the pole (5″ at 89.99°), while the field itself hardly changes from 85° on */
        var ra = i * step, dec = -Math.PI / 2 + j * step, de = clamp(dec, -89 * RAD, 89 * RAD), a = A.aberrate(ra, de, ms), k = j * nr + i;
        dx[k] = (((a.ra - ra) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; dx[k] *= Math.cos(de); dy[k] = a.dec - de;
      }
    }
    return function (ra, dec) {
      var fr = ((ra / step) % nr + nr) % nr, fd = clamp((dec + Math.PI / 2) / step, 0, nd - 1 - 1e-9), i0 = Math.floor(fr), j0 = Math.floor(fd), tr = fr - i0, td = fd - j0;
      var i1 = (i0 + 1) % nr, k00 = j0 * nr + i0, k01 = j0 * nr + i1, k10 = k00 + nr, k11 = k01 + nr;
      var ox = (dx[k00] * (1 - tr) + dx[k01] * tr) * (1 - td) + (dx[k10] * (1 - tr) + dx[k11] * tr) * td;
      var oy = (dy[k00] * (1 - tr) + dy[k01] * tr) * (1 - td) + (dy[k10] * (1 - tr) + dy[k11] * tr) * td;
      return { ra: ra + ox / Math.max(Math.cos(dec), 1e-6), dec: dec + oy };
    };
  }
  /* how well a search key matches one of an entry's keys: 0 equal, 1 start, 2 start but the number goes on (m5 in m51),
     3 somewhere inside (from three characters), 9 not at all */
  function searchScore(q, keys) {
    var best = 9;
    keys.forEach(function (k) {
      if (!k || !q) return;
      var sc = k === q ? 0 : k.indexOf(q) === 0 ? (/\d$/.test(q) && /^\d/.test(k.slice(q.length)) ? 2 : 1) : q.length >= 3 && k.indexOf(q) > 0 ? 3 : 9;
      if (sc < best) best = sc;
    });
    return best;
  }

  /* Wikipedia links for the info card and the list (pure; checked by verify-planner). The catalogue carries article titles
     (wde/wen in dso-catalog.js); moon and planets have fixed titles; stars, double stars and OpenNGC objects get a link to
     Wikipedia's search with their designation, which opens the article directly where a title or redirect matches (Bayer
     designations spelt out with the Latin genitive, "Beta Cygni", are redirects in both languages) and the search results
     otherwise. A link loads nothing until it is clicked. Stars with neither a name nor a Bayer letter get none. */
  var BODY_WIKI = { moon: ['Mond', 'Moon'], mercury: ['Merkur (Planet)', 'Mercury (planet)'], venus: ['Venus (Planet)', 'Venus'],
    mars: ['Mars (Planet)', 'Mars'], jupiter: ['Jupiter (Planet)', 'Jupiter'], saturn: ['Saturn (Planet)', 'Saturn'],
    uranus: ['Uranus (Planet)', 'Uranus'], neptune: ['Neptun (Planet)', 'Neptune'] };
  var WIKI_GREEK = { 'α': 'Alpha', 'β': 'Beta', 'γ': 'Gamma', 'δ': 'Delta', 'ε': 'Epsilon', 'ζ': 'Zeta', 'η': 'Eta', 'θ': 'Theta', 'ι': 'Iota',
    'κ': 'Kappa', 'λ': 'Lambda', 'μ': 'Mu', 'ν': 'Nu', 'ξ': 'Xi', 'ο': 'Omicron', 'π': 'Pi', 'ρ': 'Rho', 'σ': 'Sigma', 'τ': 'Tau',
    'υ': 'Upsilon', 'φ': 'Phi', 'χ': 'Chi', 'ψ': 'Psi', 'ω': 'Omega' };
  /* SIMBAD's three-letter Greek abbreviations (* alf Cen, * mu. Vel) */
  var SIMBAD_GREEK = { alf: 'α', bet: 'β', gam: 'γ', del: 'δ', eps: 'ε', zet: 'ζ', eta: 'η', tet: 'θ', iot: 'ι', kap: 'κ', lam: 'λ', mu: 'μ',
    nu: 'ν', ksi: 'ξ', omi: 'ο', pi: 'π', rho: 'ρ', sig: 'σ', tau: 'τ', ups: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', ome: 'ω' };
  /* Latin genitives of the 88 IAU constellations (English Wikipedia spells Boötis, German Wikipedia Bootis) */
  var WIKI_GENITIVE = { And: 'Andromedae', Ant: 'Antliae', Aps: 'Apodis', Aqr: 'Aquarii', Aql: 'Aquilae', Ara: 'Arae', Ari: 'Arietis', Aur: 'Aurigae',
    Boo: 'Boötis', Cae: 'Caeli', Cam: 'Camelopardalis', Cnc: 'Cancri', CVn: 'Canum Venaticorum', CMa: 'Canis Majoris', CMi: 'Canis Minoris',
    Cap: 'Capricorni', Car: 'Carinae', Cas: 'Cassiopeiae', Cen: 'Centauri', Cep: 'Cephei', Cet: 'Ceti', Cha: 'Chamaeleontis', Cir: 'Circini',
    Col: 'Columbae', Com: 'Comae Berenices', CrA: 'Coronae Australis', CrB: 'Coronae Borealis', Crv: 'Corvi', Crt: 'Crateris', Cru: 'Crucis',
    Cyg: 'Cygni', Del: 'Delphini', Dor: 'Doradus', Dra: 'Draconis', Equ: 'Equulei', Eri: 'Eridani', For: 'Fornacis', Gem: 'Geminorum',
    Gru: 'Gruis', Her: 'Herculis', Hor: 'Horologii', Hya: 'Hydrae', Hyi: 'Hydri', Ind: 'Indi', Lac: 'Lacertae', Leo: 'Leonis', LMi: 'Leonis Minoris',
    Lep: 'Leporis', Lib: 'Librae', Lup: 'Lupi', Lyn: 'Lyncis', Lyr: 'Lyrae', Men: 'Mensae', Mic: 'Microscopii', Mon: 'Monocerotis', Mus: 'Muscae',
    Nor: 'Normae', Oct: 'Octantis', Oph: 'Ophiuchi', Ori: 'Orionis', Pav: 'Pavonis', Peg: 'Pegasi', Per: 'Persei', Phe: 'Phoenicis', Pic: 'Pictoris',
    Psc: 'Piscium', PsA: 'Piscis Austrini', Pup: 'Puppis', Pyx: 'Pyxidis', Ret: 'Reticuli', Sge: 'Sagittae', Sgr: 'Sagittarii', Sco: 'Scorpii',
    Scl: 'Sculptoris', Sct: 'Scuti', Ser: 'Serpentis', Sex: 'Sextantis', Tau: 'Tauri', Tel: 'Telescopii', Tri: 'Trianguli', TrA: 'Trianguli Australis',
    Tuc: 'Tucanae', UMa: 'Ursae Majoris', UMi: 'Ursae Minoris', Vel: 'Velorum', Vir: 'Virginis', Vol: 'Volantis', Vul: 'Vulpeculae' };
  function wikiUrl(lang, title, query) {
    var host = 'https://' + (lang === 'de' ? 'de' : 'en') + '.wikipedia.org/wiki/';
    return title ? host + encodeURIComponent(String(title).replace(/ /g, '_')) : query ? host + 'Special:Search?search=' + encodeURIComponent(query) : null;
  }
  function genitive(lang, con) { var g = WIKI_GENITIVE[con]; return g && lang === 'de' ? g.replace('ö', 'o') : g; }
  /* s: { name, bayer (α, α1), con (IAU abbreviation), simbad (the double stars' SIMBAD identifier) } → search text or '' */
  function starWikiQuery(lang, s) {
    var g = s.con && genitive(lang, s.con), letter = s.bayer ? WIKI_GREEK[String(s.bayer).charAt(0)] : null;
    if (letter && g) return letter + ' ' + g; /* the component number is left out: ε1 Lyrae is part of the article on ε Lyrae */
    var id = String(s.simbad || '').replace(/^NAME\s+/, '').replace(/\s+/g, ' ').trim(), m;
    if ((m = /^V?\* (\S+) ([A-Z][A-Za-z]{2})\b/.exec(id)) && genitive(lang, m[2])) {
      var tok = m[1].replace(/\./g, ''), gm = /^([a-z]+)\d*$/.exec(tok);
      if (gm && SIMBAD_GREEK[gm[1]]) return WIKI_GREEK[SIMBAD_GREEK[gm[1]]] + ' ' + genitive(lang, m[2]);
      if (gm && gm[1].length === 1) return gm[1] + ' ' + genitive(lang, m[2]); /* Latin letters: u Carinae */
      return tok.replace(/^0+(?=\d)/, '') + ' ' + genitive(lang, m[2]); /* Flamsteed numbers and variable stars: 61 Cygni, V336 Puppis */
    }
    if ((m = /^(HD|HR|HIP|SAO|BD|CD|CPD) ?([+-]?\d+) ?(\d*)/.exec(id))) return m[1] + (/^[+-]/.test(m[2]) ? '' : ' ') + m[2] + (m[3] ? ' ' + m[3] : ''); /* BD+09 2882, HD 21291 */
    return s.name || '';
  }
  /* an OpenNGC designation as Wikipedia writes it: NGC 292, UGC 5470, PGC 143, Collinder 399, Melotte 71, Harvard 5, Caldwell 41, ESO 56-115 */
  var NGC_PREFIX = { Cl: 'Collinder', Mel: 'Melotte', H: 'Harvard', C: 'Caldwell', M: 'Messier' };
  function ngcWikiQuery(id) {
    if (/^Sh2-\d+$/.test(String(id).trim())) return String(id).trim(); /* Sharpless regions: Wikipedia writes Sh2-155 */
    var m = /^([A-Za-z]+) ?0*(\d.*)$/.exec(String(id).trim());
    return m ? (NGC_PREFIX[m[1]] || m[1]) + ' ' + m[2] : String(id);
  }
  /* the Wikipedia link of an extract row: row[10] is [de, en], each 1 for the designation itself (ngcWikiQuery()), another
     title, or 0 where that language has no article (tools/ngc-wiki.js); the article in the page's language, else the other
     language's, else the search → { url, lang } */
  function ngcWikiLink(lang, row) {
    var w = row[10] || [0, 0], i = lang === 'de' ? 0 : 1, other = lang === 'de' ? 'en' : 'de';
    function title(v) { return v === 1 ? ngcWikiQuery(row[0]) : v || null; }
    if (title(w[i])) return { url: wikiUrl(lang, title(w[i])), lang: lang };
    if (title(w[1 - i])) return { url: wikiUrl(other, title(w[1 - i])), lang: other };
    return { url: wikiUrl(lang, null, ngcWikiQuery(row[0])), lang: lang };
  }
  /* the self-hosted DSS thumbnail of an extract row (tools/ngc-thumbnails.js): NGC 224 A → img/ngc/ngc224a.jpg, Sh2-129 → sh2129 */
  /* The imaging rig the photo rating is made for — the owner's at Starfront (astronomy/starfront_*.html): William Optics GT81
     with the 0.8× reducer (382 mm, f/4.7) and a Player One Ares-M Pro (IMX533 mono, 3008² px at 3.76 µm): 2.03″ per pixel,
     a field of 1.69° × 1.69°, LRGB plus Hα, OIII and SII through 4.5 nm filters */
  var RIG = { focal: 382.4, pixel: 3.76, px: 3008, fovArcmin: 101.5, scale: 2.03 };
  /* how well an object of s′ fills that field (pure; checked by verify-planner): 0.3 up to 2′ (a few dozen pixels), rising
     to 1 at 12′, 1 up to 90 % of the field, falling to 0.55 at 1.8 fields (a two-panel mosaic), 0.45 beyond; 0.6 without a size */
  function rigFraming(s) {
    var F = RIG.fovArcmin;
    if (!(s > 0)) return 0.6;
    if (s <= 2) return 0.3;
    if (s < 12) return 0.3 + 0.7 * Math.log(s / 2) / Math.log(6);
    if (s <= 0.9 * F) return 1;
    if (s <= 1.8 * F) return 1 - 0.45 * (s - 0.9 * F) / (0.9 * F);
    return 0.45;
  }
  /* the usable dark hours for imaging (pure; checked by verify-planner): the hours of the dark window (the list's, astronomical
     or else nautical) in which the object stands 30° or higher, and of those the hours with the moon below the horizon —
     sampled as the list samples its hours above 30° (computeObjects() in the planner: every 10 minutes from the window's
     start, each sample but the last counting 10 minutes), so that the card and the list give the same number */
  function usableHours(altAt, moonAltAt, from, to, step) {
    var r = { hours: 0, moonless: 0 }, h;
    step = step || 600; h = step / 3600;
    for (var t = from; t + step <= to; t += step) {
      if (altAt(t) < 30) continue;
      r.hours += h;
      if (moonAltAt(t) <= 0) r.moonless += h;
    }
    return r;
  }
  /* the rows of data/ngc.json that join the list of the best objects when rated for imaging (pure; tools/ngc-thumbnails.js
     --large cuts 320 px images for exactly these): a size from 3′ to 3°, no lettered component (NGC 6027 A), galaxies to
     12 mag, globular clusters to 10 mag, open clusters to 8 mag and from 5′, every nebula and supernova remnant (Sharpless
     regions have no magnitude); stars, double stars and asterisms never */
  function imagingCandidate(r0) {
    var t = r0[3], sz = r0[4], m = r0[7];
    if (!(sz >= 3 && sz <= 180) || /^(NGC|IC) \d+ ?[A-Z]/.test(r0[0])) return false;
    if (t === 'Gx') return m != null && m <= 12;
    if (t === 'GC') return m != null && m <= 10;
    if (t === 'OC') return m != null && m <= 8 && sz >= 5;
    return t === 'EN' || t === 'RN' || t === 'DN' || t === 'SNR' || t === 'PN';
  }
  function ngcThumbL(name) { return 'img/ngc-l/' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '') + '.jpg'; }
  /* How many objects of each catalogue the search can find (pure; the info box under the search field, checked by
     verify-planner): every designation of the catalogue (id, aka), of the extract rows (name, other designations) and the
     aliases, sorted by catalogue — Messier, NGC and IC with their numbers, NGC/IC components with letters apart —, the
     non-existent NGC and IC entries, and the stars with a proper name or Bayer letter and the constellations of the map */
  function designationOf(x) {
    var s = String(x).replace(/\s+/g, ' ').trim(), m;
    if ((m = /^M ?0*(\d+)$/.exec(s))) return ['M', +m[1]];
    if ((m = /^(NGC|IC) ?0*(\d+)$/.exec(s))) return [m[1], +m[2]];
    if ((m = /^(NGC|IC) ?0*(\d+) ?([A-Z].*)$/.exec(s))) return [m[1] + 'parts', s.replace(/\s+/g, '').toUpperCase()];
    if ((m = /^C ?0*(\d+)$/.exec(s))) return ['C', +m[1]];
    if ((m = /^Sh2-0*(\d+)$/.exec(s))) return ['Sh2', +m[1]];
    if ((m = /^B ?0*(\d+)$/.exec(s))) return ['B', +m[1]];
    if ((m = /^(UGCA|UGC|PGC|HIP|HCG|HD|LBN|MWSC|Mel|Cl|H|WDS) ?0*([\d+-]+)$/.exec(s))) return [m[1], m[2]];
    if ((m = /^ESO ?0*(\d+)-0*(\d+)$/.exec(s))) return ['ESO', m[1] + '-' + m[2]];
    return null;
  }
  function catalogCounts(catalog, rows, aliases, nonexistent, stars, labels) {
    var sets = {}, out = {};
    function add(x) { var d = x && designationOf(x); if (d) (sets[d[0]] = sets[d[0]] || {})[d[1]] = 1; }
    (catalog || []).forEach(function (o) { add(o.id); (o.aka || []).forEach(add); });
    (rows || []).forEach(function (r0) { add(r0[0]); (r0[9] || []).forEach(add); });
    Object.keys(aliases || {}).forEach(add);
    Object.keys(sets).forEach(function (k) { out[k] = Object.keys(sets[k]).length; });
    out.nonexNGC = (nonexistent || []).filter(function (x) { return /^NGC /.test(x); }).length;
    out.nonexIC = (nonexistent || []).filter(function (x) { return /^IC /.test(x); }).length;
    out.common = (catalog || []).filter(function (o) { return o.de || o.en; }).length + (rows || []).filter(function (r0) { return r0[8]; }).length;
    out.starNamed = (stars || []).filter(function (st) { return st[5]; }).length;
    out.starBayer = (stars || []).filter(function (st) { return st[6]; }).length;
    var cons = {};
    (labels || []).forEach(function (l) { cons[l[0]] = 1; });
    out.cons = Object.keys(cons).length;
    return out;
  }
  function ngcThumb(name) { return 'img/ngc/' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '') + '.jpg'; }

  /* the map itself, sharing the planner's state, elements, texts and helpers */
  function create(env) {
    var consName = env.consName, esc = env.esc, BODIES = env.BODIES, BODY_COL = env.BODY_COL, CATALOG = env.CATALOG, COL = env.COL, el = env.el,
      FONT = env.FONT, GROUP = env.GROUP, hhmm = env.hhmm, hhmmLoc = env.hhmmLoc || env.hhmm, pcTime = env.pcTime || function () { return ''; }, LANG = env.LANG, num = env.num, pad = env.pad,
      setTime = env.setTime, listWindow = env.listWindow, drawInfoChart = env.drawInfoChart, onPickChange = env.onPickChange, onNgcLoad = env.onNgcLoad, showInMap = env.showInMap, SKY = env.SKY, state = env.state, syncUrl = env.syncUrl, T = env.T, TWI = env.TWI;

    function targetObject() {
      if (!state.target) return null;
      if (String(state.target).indexOf('ngc:') === 0) return infoDso({ kind: 'dso', id: state.target }); /* a list pick from the further catalogues */
      return CATALOG.filter(function (o) { return o.id === state.target; })[0] || null;
    }

    /* the apparent place of a mean position of date ({ ra, dec } radians) from the night's field (apparentAt() in prepareSky()) */
    function app(p) { var f = state.smData && state.smData.app; return f ? f(p.ra, p.dec) : p; }
    /* a J2000 position (degrees) as the apparent place of date (radians): precessed, then nutation and aberration */
    function appJ(raDeg, decDeg, ms) { return app(precessRig(raDeg, decDeg, precAngles(ms))); }
    /* ΔT (TT − UT, seconds) as sky-events.js uses it for the occultations; sky-events.js loads before this script */
    function deltaT() { var E = window.SvSkyEvents; return E && E.DELTA_T != null ? E.DELTA_T : 69; }
    /* The moon seen from the place: topocentric RA/Dec of date (A.moonTopocentric(), the moon at TT = UT + ΔT as the
       occultations take it), refracted altitude and azimuth, distance in km. bodyAt() corrected only the altitude for
       parallax and stood up to 75″ beside the exact place — a third of the moon's radius, so a limb contact from the
       events table missed on the zoomed-in map; it is also cheaper (12 µs against 35 µs), so the map uses it at every zoom */
    function moonAt(ms) {
      var m = A.moonTopocentric(ms, state.lat, state.lon, deltaT()), h = A.horizontalOf(m.ra, m.dec, ms, state.lat, state.lon);
      return { ra: m.ra, dec: m.dec, dist: m.dist, alt: A.refract(h.alt), az: h.az };
    }
    /* refracted altitude and azimuth of the moon or a planet at a moment (ms); planets bring their magnitude */
    function bodyHor(id, ms) {
      if (id === 'moon') return moonAt(ms);
      var b = A.bodyAt(id, ms / 1000, state.lat, state.lon);
      b.alt = A.refract(b.alt);
      return b;
    }

    /* A label beside its point without covering other labels or points: to the right first, then left, above,
       below, and further out diagonally with a hairline back to the point. Labels that must show (moon, planets,
       a picked object) fall back to the first place when nothing is free; others are left out. `near` keeps a
       label to the four places next to its point. */
    function placeLabel(ctx, boxes, area, l, must, near) {
      ctx.font = l.font;
      var w = ctx.measureText(l.txt).width, g = l.r + 4, x = l.px, y = l.py, right = x + g, left = x - g - w, mid = x - w / 2;
      var spots = [[right, y], [left, y], [mid, y - l.r - 10], [mid, y + l.r + 10],
        [right, y - 15], [right, y + 15], [left, y - 15], [left, y + 15],
        [right + 8, y - 30], [right + 8, y + 30], [left - 8, y - 30], [left - 8, y + 30]].slice(0, near ? 4 : 12);
      function fit(sp) {
        var x0 = clamp(sp[0], 2, area.W - w - 2), y0 = clamp(sp[1], area.top, area.bottom);
        return { x0: x0, y: y0, b: [x0 - 2, y0 - 7, x0 + w + 2, y0 + 7] };
      }
      function free(b) { return !boxes.some(function (o) { return b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]; }); }
      var pick = null, idx = 0;
      for (var k = 0; k < spots.length && !pick; k++) { var f = fit(spots[k]); if (free(f.b)) { pick = f; idx = k; } }
      if (!pick) { if (!must) return false; pick = fit(spots[0]); }
      boxes.push(pick.b);
      if (idx >= 4) {
        var ax = pick.x0 > x ? pick.x0 - 2 : pick.x0 + w + 2, ay = pick.y, d = Math.sqrt((ax - x) * (ax - x) + (ay - y) * (ay - y)) || 1;
        ctx.beginPath(); ctx.moveTo(x + (ax - x) / d * (l.r + 1), y + (ay - y) / d * (l.r + 1)); ctx.lineTo(ax, ay);
        ctx.strokeStyle = l.c; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (l.back) { ctx.fillStyle = 'rgba(11,17,25,.78)'; ctx.fillRect(pick.x0 - 3, pick.y - 8, w + 6, 16); } /* readable over stars and lines */
      ctx.fillStyle = l.c; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(l.txt, pick.x0, pick.y);
      return true;
    }

    /* the ecliptic of date, where sun, moon and planets travel: RA and Dec (radians) every 3° of longitude */
    function eclipticPoints(ms) {
      var eps = RAD * (23.4393 - 3.563e-7 * A.toDays(ms)), pts = [];
      for (var l = 0; l <= 360; l += 3) { var L = l * RAD; pts.push([Math.atan2(Math.sin(L) * Math.cos(eps), Math.cos(L)), Math.asin(Math.sin(eps) * Math.sin(L))]); }
      return pts;
    }

    /* Where the moon's lit limb points: a small step from the moon along the great circle towards the sun, as
       altitude and azimuth, for the star map to project */
    function limbStep(moon, sun) {
      function vec(h) { var a = h.alt * RAD, z = h.az * RAD; return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)]; }
      var m = vec(moon), s = vec(sun), d = m[0] * s[0] + m[1] * s[1] + m[2] * s[2];
      var v = [m[0] + 0.01 * (s[0] - d * m[0]), m[1] + 0.01 * (s[1] - d * m[1]), m[2] + 0.01 * (s[2] - d * m[2])];
      return { alt: Math.asin(v[2] / Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])) / RAD, az: (Math.atan2(v[0], v[1]) / RAD + 360) % 360 };
    }

    /* ------------------------------------------------------------------ *
     * Constellations: the whole sky above the location as a round map    *
     * ------------------------------------------------------------------ */
    var SM = { frame: '#10151c', rim: 'rgba(228,233,239,.35)', rings: 'rgba(255,255,255,.08)', line: 'rgba(143,179,255,.42)', lineHi: 'rgba(190,212,255,.95)',
      con: 'rgba(160,188,236,.8)', conHi: '#e4e9ef', star: 'rgba(255,244,216,.85)', ecliptic: 'rgba(250,199,117,.65)', mwText: 'rgba(215,225,255,.72)',
      grid: 'rgba(120,196,255,.24)', gridText: 'rgba(150,210,255,.65)', bounds: 'rgba(255,196,120,.4)', info: '#5ce1e6',
      picked: '#ff4d4d', satellite: '#ffd166', comet: '#7ee0c3', compass: '#8fd19e', compassDim: 'rgba(143,209,158,.7)', ground: ['#4a4238', '#332d27', '#25211d', '#1c1916', '#171411'], text: 'rgba(228,233,239,.75)' };

    /* stars, lines and labels precessed to the night once, not on every redraw (radians) */
    function prepareSky() {
      if (!SKY) return;
      var ms = (state.plWin.start + state.plWin.end) / 2 * 1000, names = {}, pa = precAngles(ms), years = skyYears(ms), mot = SKY.motion || [], apf = apparentAt(ms);
      function pc(ra, dec) { var p = precessRig(ra, dec, pa); p = apf(p.ra, p.dec); return [p.ra, p.dec]; }
      var labels = SKY.labels.map(function (l) {
        var p = pc(l[1], l[2]), name = state.names === 'latin' ? l[5] : LANG === 'de' ? l[4] : l[6];
        names[l[0]] = name;
        return { id: l[0], ra: p[0], dec: p[1], rank: l[3], name: name, alt: -90 };
      });
      state.smData = {
        /* the catalogue runs bright to faint; drawn the other way round, bright stars end up on top */
        /* moved from epoch 2000 to the night along their proper motion, then precessed and made apparent (nutation and
           aberration at the night's middle, like the moon and planets; the shift changes by under 0.2″ over the night) */
        stars: SKY.stars.map(function (s, i) {
          var m = moved(s[0], s[1], mot[3 * i] || 0, mot[3 * i + 1] || 0, years), p0 = precessRig(m[0], m[1], pa), p = apf(p0.ra, p0.dec);
          return starVec({ ra: p.ra, dec: p.dec, ra0: m[0], dec0: m[1], mag: s[2], bv: s[3], plx: mot[3 * i + 2] || 0, pm: Math.sqrt(Math.pow(mot[3 * i] || 0, 2) + Math.pow(mot[3 * i + 1] || 0, 2)),
            name: s[5] ? (state.names === 'local' && LANG === 'de' ? s[4] : s[5]) : '', bayer: s[6] || '', idx: i });
        }).reverse(),
        lines: Object.keys(SKY.lines).map(function (id) {
          return { id: id, parts: SKY.lines[id].map(function (flat) { var pts = []; for (var i = 0; i < flat.length; i += 2) pts.push(pc(flat[i], flat[i + 1])); return pts; }) };
        }),
        labels: labels, names: names,
        bounds: SKY.bounds ? boundsSky(skyBounds(), ms).map(function (bd) { bd.pts = bd.pts.map(function (q) { var a = apf(q[0], q[1]); return [a.ra, a.dec]; }); return bd; }) : [],
        app: apf, /* the night's apparent-place field for everything precessed later (deep stars, OpenNGC, catalogue, photos, grid) */
        byIdx: {}
      };
      state.smData.stars.forEach(function (st) { state.smData.byIdx[st.idx] = st; });
      if (state.deepRaw) prepareDeepStars();
      if (state.ngcRaw) prepareNgc();
      if (state.smInfo && state.smInfo.kind === 'star' && !state.smData.byIdx[state.smInfo.idx]) state.smInfo = null;
    }

    /* the constellation boundaries at B1875, worked out once */
    var BOUNDS = null;
    function skyBounds() { return BOUNDS || (BOUNDS = SKY && SKY.bounds ? boundsB1875(SKY.bounds) : []); }

    /* a star's direction as a unit vector of date, for the quick test against the middle of the view */
    function starVec(o) {
      var cd = Math.cos(o.dec);
      o.x = cd * Math.cos(o.ra); o.y = cd * Math.sin(o.ra); o.z = Math.sin(o.dec);
      return o;
    }

    /* Stars from 6 to 8 mag for a zoomed-in view: astro-tools/data/stars-8.bin from this server (astro-tools/tools/star-catalog-data.js),
       fetched once, the first time the view asks for stars fainter than js/star-catalog.js holds. Header "SVST", version,
       count; then per star RA uint16 (full circle), Dec int16 (±90° = ±32767), magnitude × 20 uint8, B−V × 50 int8. */
    function loadDeepStars() {
      if (state.deepState || !window.fetch || !window.DataView) return;
      state.deepState = 'loading';
      fetch('data/stars-8.bin').then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(function (buf) {
        var dv = new DataView(buf);
        if (buf.byteLength < 12 || dv.getUint32(0, true) !== 0x54535653) throw new Error('format');
        /* version 1: 6 bytes per star; version 2 adds proper motion (int16, int16, mas per year) and parallax (uint16, 0.1 mas) */
        var ver = dv.getUint16(4, true), rec = ver >= 2 ? dv.getUint16(6, true) : 6, st = ver >= 2 ? 7 : 4;
        var n = Math.min(dv.getUint32(8, true), Math.floor((buf.byteLength - 12) / rec)), raw = new Float32Array(n * st);
        for (var i = 0, o = 12; i < n; i++, o += rec) {
          var b = i * st;
          raw[b] = dv.getUint16(o, true) / 65536 * 360;
          raw[b + 1] = dv.getInt16(o + 2, true) / 32767 * 90;
          raw[b + 2] = dv.getUint8(o + 4) / 20;
          raw[b + 3] = dv.getInt8(o + 5) / 50;
          if (st > 4) { raw[b + 4] = dv.getInt16(o + 6, true); raw[b + 5] = dv.getInt16(o + 8, true); raw[b + 6] = dv.getUint16(o + 10, true) / 10; }
        }
        state.deepRaw = raw;
        state.deepStride = st;
        state.deepState = 'ok';
        if (state.plWin) { prepareDeepStars(); drawSkyMap(); }
      }).catch(function () { state.deepState = 'failed'; }); /* the map then stays at 6 mag */
    }

    /* OpenNGC's further objects for a zoomed-in view: astro-tools/data/ngc.json from this server, fetched once */
    function loadNgc() {
      if (state.ngcState || !window.fetch) return;
      state.ngcState = 'loading';
      fetch('data/ngc.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
        state.ngcRaw = d.objects;
        state.ngcAliases = d.aliases || {};
        state.ngcNonexistent = d.nonexistent || [];
        state.ngcState = 'ok';
        if (el.smCat && !el.smCat.hidden) renderCatalogInfo(); /* the info box counts NGC and IC once they are here */
        if (onNgcLoad) onNgcLoad(); /* the planner adds the further catalogues to the imaging list */
        if (state.plWin) { prepareNgc(); drawSkyMap(); }
        if (el.smSearch && el.smSearch.value && !el.smSearchList.hidden) searchRender(); /* the open list gains the NGC/IC objects */
      }).catch(function () { state.ngcState = 'failed'; if (el.smCat && !el.smCat.hidden) renderCatalogInfo(); });
    }
    /* the info box "Welche Kataloge die Suche kennt" under the search field: counted live with catalogCounts() */
    function renderCatalogInfo() {
      var C = T.cat, loc = LANG === 'de' ? 'de-DE' : 'en-GB', fmt = function (v) { return Number(v || 0).toLocaleString(loc); };
      var k = catalogCounts(CATALOG, state.ngcRaw || [], state.ngcAliases || {}, state.ngcNonexistent || [], SKY.stars, SKY.labels);
      var of = function (n, t) { return C.of.replace('{n}', fmt(n)).replace('{t}', fmt(t)); };
      var row = function (name, val, note) { return '<tr><td>' + esc(name) + '</td><td class="op-cat-n">' + esc(val) + '</td><td>' + esc(note || '') + '</td></tr>'; };
      var group = function (title, note) { return '<tr class="op-cat-group"><th colspan="3">' + esc(title) + (note ? ' <span>· ' + esc(note) + '</span>' : '') + '</th></tr>'; };
      var ngcNote = function (nonex, parts) { return [nonex ? C.nonex.replace('{n}', fmt(nonex)) : '', parts ? C.parts.replace('{n}', fmt(parts)) : ''].filter(Boolean).join(' · '); };
      var some = function (keys) { return keys.filter(function (x) { return k[x]; }).map(function (x) { return row(C.names[x], fmt(k[x])); }).join(''); };
      var html = '<p><strong>' + esc(C.title) + '</strong> · ' + esc(C.live) + '</p>' +
        (state.ngcState === 'failed' ? '<p>' + esc(C.failed) + '</p>' : state.ngcState !== 'ok' ? '<p>' + esc(C.loading) + '</p>' : '') +
        '<div class="op-cat-wrap"><table class="op-cat-table"><thead><tr>' + C.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        group(C.complete) + row(C.names.M, of(k.M, 110)) + row(C.names.NGC, of(k.NGC, 7840), ngcNote(k.nonexNGC, k.NGCparts)) +
        row(C.names.IC, of(k.IC, 5386), ngcNote(k.nonexIC, k.ICparts)) + row(C.names.C, of(k.C, 109)) + row(C.names.Sh2, of(k.Sh2, 313)) +
        group(C.cross, C.crossNote) + some(['PGC', 'UGC', 'ESO', 'UGCA', 'LBN', 'Mel', 'Cl', 'H', 'MWSC', 'HCG', 'B', 'HD', 'HIP', 'WDS']) +
        group(C.stars) + row(C.starNamed, fmt(k.starNamed)) + row(C.starBayer, fmt(k.starBayer)) + row(C.cons, fmt(k.cons)) + row(C.bodies, fmt(BODIES.length)) + row(C.common, fmt(k.common)) +
        '</tbody></table></div><p class="op-cat-note">' + esc(C.not) + '</p>';
      el.smCat.innerHTML = html;
    }
    function prepareNgc() {
      var pa = precAngles((state.plWin.start + state.plWin.end) / 2 * 1000);
      state.ngc = state.ngcRaw.map(function (r0, i) { var p = app(precessRig(r0[1], r0[2], pa)); return starVec({ ra: p.ra, dec: p.dec, row: r0, idx: i }); });
    }

    /* the faint stars precessed to the night and made apparent, faint to bright like the main list */
    function prepareDeepStars() {
      var raw = state.deepRaw, st = state.deepStride || 4, ms = (state.plWin.start + state.plWin.end) / 2 * 1000, pa = precAngles(ms), years = skyYears(ms), out = [];
      for (var i = raw.length / st - 1; i >= 0; i--) {
        var o = i * st, m = st > 4 ? moved(raw[o], raw[o + 1], raw[o + 4], raw[o + 5], years) : [raw[o], raw[o + 1]], p = app(precessRig(m[0], m[1], pa));
        var star = starVec({ ra: p.ra, dec: p.dec, ra0: m[0], dec0: m[1], mag: raw[o + 2], bv: raw[o + 3], plx: st > 4 ? raw[o + 6] : 0,
          pm: st > 4 ? Math.sqrt(raw[o + 4] * raw[o + 4] + raw[o + 5] * raw[o + 5]) : 0, name: '', bayer: '', idx: 'd' + i });
        out.push(star);
        if (state.smData) state.smData.byIdx[star.idx] = star;
      }
      state.deepStars = out;
    }

    /* the Milky Way grid from astro-tools/js/star-catalog.js, decoded once: brightness step 0–5 per 0.5° cell */
    var MW = null;
    function milkyWay() {
      if (MW || !SKY || !SKY.milkyWay) return MW;
      var g = SKY.milkyWay, cells = new Uint8Array(g.w * g.h), i = 0, re = /([a-f])(\d+)/g, m;
      while ((m = re.exec(g.rle))) { var v = m[1].charCodeAt(0) - 97, n = +m[2]; if (v) cells.fill(v, i, i + n); i += n; }
      MW = { w: g.w, h: g.h, step: g.step, cells: cells };
      return MW;
    }

    /* brightness step at a sky position, blended between the four neighbouring cells */
    function mwSample(mw, ra, dec) {
      var fx = ra / mw.step - 0.5, fy = (90 - dec) / mw.step - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      function at(x, y) { return mw.cells[clamp(y, 0, mw.h - 1) * mw.w + ((x % mw.w) + mw.w) % mw.w]; }
      return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }

    /* Paints the Milky Way into a view: every 4 px cell is turned into altitude and azimuth (radians) by the view's
       own inverse projection, then into RA and Dec, and the brightness step read from the grid, which
       lies at J2000 – so the position is first taken back from the equinox of date. The small image is scaled up smoothly; the band fades in twilight and
       thins out towards the horizon haze; `dim` weakens it for a zoomed-in view, where the coarse grid would show and the
       band is no longer seen as such. Returns a bright, high place near the middle of the view for its name. */
    function paintMilkyWay(ctx, W, bottom, cls, ms, inverse, midY, dim) {
      var mw = milkyWay(), fade = [0, 0, 0.3, 0.7, 1][cls] * (dim == null ? 1 : dim);
      if (!mw || !fade) return null;
      var cell = 4, gw = Math.ceil(W / cell), gh = Math.ceil(bottom / cell), best = 1e9, spot = null;
      if (!state.mwCanvas) state.mwCanvas = document.createElement('canvas');
      var mc = state.mwCanvas;
      mc.width = gw; mc.height = gh;
      var mctx = mc.getContext('2d'), img = mctx.createImageData(gw, gh), px = img.data;
      var sp = Math.sin(state.lat * RAD), cp = Math.cos(state.lat * RAD), lst = RAD * (280.46061837 + 360.98564736629 * A.toDays(ms)) + RAD * state.lon;
      var pa = precAngles(ms); /* back from the equinox of date to J2000 */
      for (var gy = 0; gy < gh; gy++) {
        for (var gx = 0; gx < gw; gx++) {
          var x = (gx + 0.5) * cell, y = (gy + 0.5) * cell, h = inverse(x, y);
          if (!h) continue;
          var sa = Math.sin(h.alt), ca = Math.cos(h.alt), sd = sp * sa + cp * ca * Math.cos(h.az);
          var ha = Math.atan2(-Math.sin(h.az) * ca * cp, sa - sp * sd);
          var raD = lst - ha, decD = Math.asin(clamp(sd, -1, 1));
          var j0 = toJ2000(raD, decD, pa), v = mwSample(mw, j0.ra, j0.dec);
          if (!(v > 0)) continue;
          var o = (gy * gw + gx) * 4, altDeg = h.alt / RAD;
          px[o] = 205; px[o + 1] = 215; px[o + 2] = 255;
          px[o + 3] = Math.round((clamp(v, 0, 1) * 0.35 + clamp(v - 1, 0, 4) / 4 * 0.65) * clamp(altDeg / 15, 0.35, 1) * 255);
          if (v >= 3 && altDeg > 20) {
            var dist = Math.abs(x - W / 2) + Math.abs(y - midY);
            if (dist < best) { best = dist; spot = { x: x, y: y }; }
          }
        }
      }
      mctx.putImageData(img, 0, 0);
      ctx.globalAlpha = 0.3 * fade;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mc, 0, 0, gw * cell, gh * cell);
      ctx.globalAlpha = 1;
      return fade >= 0.5 ? spot : null;
    }

    function starColour(bv) { return bv < 0 ? '#cadcff' : bv < 0.4 ? '#eef2ff' : bv < 0.8 ? '#fff6e0' : bv < 1.3 ? '#ffe2b8' : '#ffc9a0'; }

    var SKY_FOV_MIN = 0.2, SKY_FOV_MIN_PHOTO = 0.2; /* 0.2° wide: the Jupiter system and the Moon's craters fill the view */
    function skyFovMin() { return state.photos ? SKY_FOV_MIN_PHOTO : SKY_FOV_MIN; }
    /* the projection for the map's current zoom and tilt */
    function skyView(W, H, az0) { return skyProjection(W, H, az0, state.smFov, state.smCAlt, skyFovMin()); }

    /* a direction given as altitude and azimuth (radians) at a moment, as a unit vector of date in RA/Dec */
    function eqVector(h, ms) {
      var sp = Math.sin(state.lat * RAD), cp = Math.cos(state.lat * RAD), lst = RAD * (280.46061837 + 360.98564736629 * A.toDays(ms) + state.lon);
      var sa = Math.sin(h.alt), ca = Math.cos(h.alt), sd = clamp(sp * sa + cp * ca * Math.cos(h.az), -1, 1);
      var ra = lst - Math.atan2(-Math.sin(h.az) * ca * cp, sa - sp * sd), cd = Math.sqrt(1 - sd * sd);
      return [cd * Math.cos(ra), cd * Math.sin(ra), sd];
    }

    /* ------------------------------------------------------------------ *
     * Sky photographs for the zoomed-in star map (HiPS tiles from CDS)    *
     * ------------------------------------------------------------------ */
    /* The DSS2 colour survey as HiPS tiles, fetched live from CDS, Strasbourg (alasky.cds.unistra.fr), without a referrer
       so that the page address with its coordinates is not passed on; tiles set no cookies. PHOTO_AUTO true loads them by
       itself once the view is PHOTO_FOV degrees wide or less (legitimate interest: the note under the map and the privacy
       policy say so, the "Sky photos" box switches them off, photos=0 in the link); false loads them only after the box
       is ticked (consent; photos=1). Self-hosting is no option: the survey is about 270 GB. */
    var PHOTO_AUTO = true, PHOTO_FOV = 45;
    /* the surveys on offer, all HiPS from CDS (state.survey, survey= in the link): DSS2 colour for the whole sky,
       Pan-STARRS DR1 much sharper north of Dec −30°, 2MASS in the near infrared */
    var SURVEYS = {
      dss: { url: 'https://alasky.cds.unistra.fr/DSS/DSSColor/', maxOrder: 9, label: 'DSS2' },
      ps1: { url: 'https://alasky.cds.unistra.fr/Pan-STARRS/DR1/color-z-zg-g/', maxOrder: 11, label: 'Pan-STARRS' },
      '2mass': { url: 'https://alasky.cds.unistra.fr/2MASS/Color/', maxOrder: 9, label: '2MASS' }
    };
    function survey() { return SURVEYS[state.survey] || SURVEYS.dss; }

    /* loaded tiles by "order/pixel"; a redraw follows each arrival, at most once a frame; the least recently used go */
    var photoCache = {}, photoCount = 0;
    function photoTile(order, ipix) {
      var sv = survey(), key = sv.url + order + '/' + ipix, t = photoCache[key];
      if (!t) {
        t = photoCache[key] = { img: new Image(), ok: false, bad: false, used: 0 };
        t.img.referrerPolicy = 'no-referrer';
        t.img.onload = function () { t.ok = true; photoSoon(); };
        t.img.onerror = function () { t.bad = true; };
        t.img.src = sv.url + 'Norder' + order + '/Dir' + Math.floor(ipix / 10000) * 10000 + '/Npix' + ipix + '.jpg';
        if (++photoCount > 400) photoPrune();
      }
      t.used = Date.now();
      return t;
    }
    function photoSoon() { drawSoon(); }
    /* Norder3/Allsky.jpg: all 768 order-3 tiles of the survey at 64 px in one image of 27 columns, fetched once with the
       first photos, so that a view shows a coarse photo at once while its sharp tiles arrive */
    var allskies = {};
    function photoAllsky() {
      var sv = survey(), allsky = allskies[sv.url];
      if (!allsky) {
        allsky = allskies[sv.url] = { img: new Image(), ok: false, cell: 64 };
        allsky.img.referrerPolicy = 'no-referrer';
        allsky.img.onload = function () { allsky.ok = true; allsky.cell = allsky.img.naturalWidth / 27; drawSoon(); };
        allsky.img.src = sv.url + 'Norder3/Allsky.jpg';
      }
      return allsky;
    }
    function photoPrune() {
      var keys = Object.keys(photoCache).sort(function (a, b) { return photoCache[a].used - photoCache[b].used; });
      keys.slice(0, keys.length - 300).forEach(function (k) { delete photoCache[k]; });
      photoCount = Object.keys(photoCache).length;
    }

    /* One triangle of a tile image mapped onto the screen: the affine map from three image points to three screen
       points, clipped to the triangle grown by half a pixel so that neighbours meet without hairline gaps. */
    function photoTri(ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2, bx0, by0, bx1, by1) { /* b…: the source's part of the image */
      var du1 = u1 - u0, dv1 = v1 - v0, du2 = u2 - u0, dv2 = v2 - v0, det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-9) return;
      var a = ((x1 - x0) * dv2 - (x2 - x0) * dv1) / det, c = (du1 * (x2 - x0) - du2 * (x1 - x0)) / det;
      var b = ((y1 - y0) * dv2 - (y2 - y0) * dv1) / det, d = (du1 * (y2 - y0) - du2 * (y1 - y0)) / det;
      var mx = (x0 + x1 + x2) / 3, my = (y0 + y1 + y2) / 3;
      function grow(x, y) { var dx = x - mx, dy = y - my, l = Math.sqrt(dx * dx + dy * dy) || 1; return [x + dx / l * 0.6, y + dy / l * 0.6]; }
      var g0 = grow(x0, y0), g1 = grow(x1, y1), g2 = grow(x2, y2);
      var su = Math.max(bx0, Math.floor(Math.min(u0, u1, u2)) - 1), sv = Math.max(by0, Math.floor(Math.min(v0, v1, v2)) - 1);
      var eu = Math.min(bx1, Math.ceil(Math.max(u0, u1, u2)) + 1), ev = Math.min(by1, Math.ceil(Math.max(v0, v1, v2)) + 1);
      if (eu <= su || ev <= sv) return;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath(); ctx.clip();
      ctx.transform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0);
      ctx.drawImage(img, su, sv, eu - su, ev - sv, su, sv, eu - su, ev - sv);
      ctx.restore();
    }

    /* Draws the photo layer into the star map (inside its horizon clip) and returns how many tiles showed and how many
       are still on their way. The tile order is chosen so that an image pixel is about a screen pixel; the tiles are
       found by sampling the view every 32 px. A tile still loading is stood in for by the nearest coarser one already
       there. Each tile is cut into a small grid whose corners go through precession and the map's projection. In a tile
       image, columns run along the face coordinate y and rows along x (as Aladin draws them). */
    function drawPhotos(ctx, W, H, view, ms, cls, hor, dpr) {
      /* the tile order after device pixels: on a Retina screen a CSS pixel is two image pixels, and the order chosen by CSS
         pixels left the photo at half the resolution the screen could show */
      var sv = survey(), degPx = view.fov / (W * (dpr || 1)), order = clamp(Math.ceil(Math.log(58.63 / 512 / degPx) / Math.LN2), 3, sv.maxOrder), nside = 1 << order;
      var need = {}, list = [], pa = precAngles(ms);
      for (var sy = 0; sy <= H + 31; sy += 32) {
        for (var sx = 0; sx <= W + 31; sx += 32) {
          var h = view.unproj(Math.min(sx, W - 1), Math.min(sy, H - 1));
          if (h.alt < -0.02) continue;
          h = { alt: A.unrefract(h.alt / RAD) * RAD, az: h.az }; /* the screen shows the refracted sky */
          var e = eqVector(h, ms), j = toJ2000(Math.atan2(e[1], e[0]), Math.asin(clamp(e[2], -1, 1)), pa), pix = hpxPix(order, j.ra, j.dec);
          if (!need[pix]) { need[pix] = true; list.push(pix); }
        }
      }
      var shown = 0, pending = 0, grid = order <= 4 ? 8 : order <= 6 ? 4 : 2, sky3 = photoAllsky();
      ctx.save();
      ctx.globalAlpha = [0.15, 0.35, 0.6, 0.85, 0.95][cls];
      ctx.globalCompositeOperation = 'screen'; /* the dark photo background keeps the sky's tint */
      list.forEach(function (pix) {
        var t = photoTile(order, pix), src = null, so = order, sp = pix;
        if (t.ok) src = { img: t.img, ox: 0, oy: 0, size: t.img.naturalWidth || 512 };
        else {
          if (!t.bad) pending++;
          for (so = order - 1, sp = Math.floor(pix / 4); so >= 3; so--, sp = Math.floor(sp / 4)) {
            var c = photoCache[sv.url + so + '/' + sp];
            if (c && c.ok) { src = { img: c.img, ox: 0, oy: 0, size: c.img.naturalWidth || 512 }; break; }
          }
          if (!src && sky3.ok) { so = 3; sp = Math.floor(pix / Math.pow(4, order - 3)); src = { img: sky3.img, ox: (sp % 27) * sky3.cell, oy: Math.floor(sp / 27) * sky3.cell, size: sky3.cell }; }
        }
        if (!src) return;
        var f = hpxXYF(order, pix), fs = hpxXYF(so, sp), ns = 1 << so, img = src.img, size = src.size;
        var pts = [];
        for (var a = 0; a <= grid; a++) {
          for (var b = 0; b <= grid; b++) {
            var X = (f.ix + a / grid) / nside, Y = (f.iy + b / grid) / nside, loc = hpxLoc(f.face, X, Y);
            var pd = app(precessRig(loc.ra, loc.dec, pa)), q = view.proj(hor(pd.ra, pd.dec));
            pts.push(q ? { x: q.x, y: q.y, u: (Y * ns - fs.iy) * size + src.ox, v: (X * ns - fs.ix) * size + src.oy } : null);
          }
        }
        for (var ga = 0; ga < grid; ga++) {
          for (var gb = 0; gb < grid; gb++) {
            var p00 = pts[ga * (grid + 1) + gb], p01 = pts[ga * (grid + 1) + gb + 1], p10 = pts[(ga + 1) * (grid + 1) + gb], p11 = pts[(ga + 1) * (grid + 1) + gb + 1];
            if (!p00 || !p01 || !p10 || !p11) continue;
            var minX = Math.min(p00.x, p01.x, p10.x, p11.x), maxX = Math.max(p00.x, p01.x, p10.x, p11.x), minY = Math.min(p00.y, p01.y, p10.y, p11.y), maxY = Math.max(p00.y, p01.y, p10.y, p11.y);
            if (maxX < 0 || minX > W || maxY < 0 || minY > H || maxX - minX > W * 2 || maxY - minY > H * 2) continue; /* off the view, or torn apart behind the viewer */
            photoTri(ctx, img, p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p00.u, p00.v, p10.u, p10.v, p11.u, p11.v, src.ox, src.oy, src.ox + size, src.oy + size);
            photoTri(ctx, img, p00.x, p00.y, p11.x, p11.y, p01.x, p01.y, p00.u, p00.v, p11.u, p11.v, p01.u, p01.v, src.ox, src.oy, src.ox + size, src.oy + size);
          }
        }
        shown++;
      });
      ctx.restore();
      return { shown: shown, pending: pending };
    }

    /* The Moon's colour map (astro-tools/img/moon-lroc-1k.jpg, LRO/LROC via NASA's Scientific Visualization Studio, CGI Moon
       Kit; equirectangular, 0° longitude in the middle), read into pixels once when first needed */
    var moonTex = null, moonCache = { key: '', canvas: null };
    function moonTexture() {
      if (!moonTex) {
        moonTex = { ok: false };
        var img = new Image();
        img.onload = function () {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          moonTex.data = g.getImageData(0, 0, c.width, c.height).data; moonTex.w = c.width; moonTex.h = c.height; moonTex.ok = true;
          drawSoon();
        };
        img.src = 'img/moon-lroc-1k.jpg';
      }
      return moonTex;
    }
    /* The Moon rendered into an S × S image: every pixel of the disc goes from the screen through the sky's north and east
       (fr, pixels per degree) to a point on the lunar sphere seen from the Earth, is turned by the axis angle P and the
       libration l, b into selenographic longitude and latitude and takes its colour from the map; lit where it faces the sun
       (phase angle i, bright limb towards position angle chi), the night side in faint earthshine. Lunar east lies on the
       sky's west side. Cached while nothing visible changes. */
    function moonImage(S, fr, semi, rp, lib, iPhase, chi) {
      var tex = moonTexture();
      if (!tex.ok) return null;
      var key = [S, Math.round(Math.atan2(fr.ny, fr.nx) * 300), Math.round(Math.atan2(fr.ey, fr.ex) * 300), (Math.sqrt(fr.nx * fr.nx + fr.ny * fr.ny) / Math.sqrt(fr.ex * fr.ex + fr.ey * fr.ey)).toFixed(3), lib.l.toFixed(1), lib.b.toFixed(1), lib.P.toFixed(1), iPhase.toFixed(1), chi.toFixed(1)].join('|');
      if (moonCache.key === key) return moonCache.canvas;
      var out = moonCache.canvas || (moonCache.canvas = document.createElement('canvas'));
      out.width = S; out.height = S;
      var g = out.getContext('2d'), im = g.createImageData(S, S), px = im.data, td = tex.data, tw = tex.w, th = tex.h;
      var k2 = 2 * rp / S, P = lib.P * RAD, cP = Math.cos(P), sP = Math.sin(P), bb = lib.b * RAD, cb = Math.cos(bb), sb = Math.sin(bb), ll = lib.l * RAD, cl = Math.cos(ll), sl = Math.sin(ll);
      var ir = iPhase * RAD, ch = chi * RAD, s0 = Math.sin(ir) * Math.sin(ch), s1 = Math.sin(ir) * Math.cos(ch), s2 = Math.cos(ir), inv = 1 / (fr.det * semi);
      for (var j = 0; j < S; j++) {
        for (var i = 0; i < S; i++) {
          var sx = (i + 0.5 - S / 2) * k2, sy = (j + 0.5 - S / 2) * k2;
          var xe = (sx * fr.ny - fr.nx * sy) * inv, yn = (fr.ex * sy - fr.ey * sx) * inv, rr = xe * xe + yn * yn;
          if (rr >= 1) continue;
          var z = Math.sqrt(1 - rr), lit = xe * s0 + yn * s1 + z * s2, shade = 0.06 + 1.0 * clamp(lit * 5, 0, 1);
          var yl = yn * cP + xe * sP, xl = xe * cP - yn * sP, X = z, Y = -xl, Z = yl;
          var x1 = X * cb - Z * sb, z1 = X * sb + Z * cb, x2 = x1 * cl - Y * sl, y2 = x1 * sl + Y * cl;
          var lon = Math.atan2(y2, x2), lat = Math.asin(clamp(z1, -1, 1));
          var tu = Math.floor((((lon / (2 * Math.PI) + 0.5) % 1) + 1) % 1 * tw), tv = Math.min(th - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * th)));
          var t = (tv * tw + tu) * 4, o = (j * S + i) * 4;
          px[o] = Math.min(255, td[t] * shade); px[o + 1] = Math.min(255, td[t + 1] * shade); px[o + 2] = Math.min(255, td[t + 2] * shade);
          px[o + 3] = rr > 0.97 ? Math.round(255 * clamp((1 - rr) / 0.03, 0, 1)) : 255;
        }
      }
      g.putImageData(im, 0, 0);
      moonCache.key = key;
      return out;
    }

    var DSO_COL = { galaxies: '#f2a38f', nebulae: '#b7e08f', clusters: '#f5d68a', stars: '#d9d2bd' };

    function drawSkyMap() {
      if (!SKY || !state.smData || !state.plWin) return;
      if (!!state.red !== document.documentElement.classList.contains('op-red')) applyRed();
      viewToUrl();
      var lat = state.lat, lon = state.lon, t = state.plT, off = state.off, ms = t * 1000, data = state.smData, hover = state.smHover, az0 = state.smAz;
      var W = el.smMap.clientWidth || 600, H = Math.round(clamp(W * 0.56, 300, 560)), cy;
      if (state.smFull && el.smWrap) H = fullHeight(); /* full screen: all the height the controls leave */
      cy = H / 2;
      var dpr = window.devicePixelRatio || 1, cv = el.smMap, ctx = cv.getContext('2d');
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var small = W < 440, scale = clamp(W / 700, 0.75, 1.1);
      /* a width not narrower than this screen's whole view (a link from a wider screen, a window made narrower) is the whole view */
      if (state.smFov != null && state.smFov >= skyView(W, H, az0).fovMax - 1e-6) { state.smFov = null; state.smCAlt = null; skyTouch(); }
      var view = skyView(W, H, az0), k = view.k, sc0 = view.sc0, cc0 = view.cc0, proj = view.proj, unproj = view.unproj;
      var gain = Math.log(view.fovMax / view.fov) / Math.LN2; /* zoom steps: 0 for the whole view, 1 for every halving of the width */
      state.smK = k * Math.max(cc0, 0.2); /* a sideways drag moves the sky by the same amount around the middle of the view */
      state.smKv = k; state.smCMin = view.cMin / RAD;
      function inView(q, pad) { return !!q && q.x > -pad && q.x < W + pad && q.y > -pad && q.y < H + pad; }
      /* positions on the map are apparent ones: lifted by refraction (strongest at the horizon, about half a degree) */
      function hor(ra, dec) { var h = A.horizontalOf(ra, dec, ms, lat, lon); h.alt = A.refract(h.alt); return h; }
      function satPt(pt) { return { alt: A.refract(pt.alt), az: pt.az }; }
      var sun = A.sunHorizontal(ms, lat, lon), cls = A.twilightClass(sun.alt);
      sun.alt = A.refract(sun.alt);
      /* in twilight only the brighter stars remain; every halving of the field adds about a magnitude, to 6 mag from
         js/star-catalog.js and to 8 mag once astro-tools/data/stars-8.bin is loaded */
      var wantMag = [1.5, 2.5, 3.8, 4.6, 5.0][cls] + gain, limit = Math.min(wantMag, state.deepStars ? 8 : 6);
      if (wantMag > 6) loadDeepStars();
      var hits = { verts: [], stars: [], dso: [], all: [], bodies: [] }, boxes = [], dsoMarks = [], ngcMarks = [], gridLabels = [];
      var hx = W / 2, hy = cy - 2 * k * cc0 / sc0, hr = 2 * k / sc0; /* the horizon is a circle in this projection */

      ctx.fillStyle = SM.ground[cls]; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 2 * Math.PI); ctx.clip();
      var skyGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr); /* brighter towards the horizon */
      skyGrad.addColorStop(0, TWI[cls]); skyGrad.addColorStop(0.8, TWI[cls]); skyGrad.addColorStop(1, mixColour(TWI[cls], '#8fa6c4', 0.3));
      ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H);
      /* sky photographs once zoomed in (they carry the Milky Way themselves, so the painted band steps back) */
      var photoOn = !!state.photos && view.fov <= PHOTO_FOV + 1e-6;
      var mwLabel = paintMilkyWay(ctx, W, H, cls, ms, function (x, y) { var h = unproj(x, y); return h.alt < 0 ? null : { alt: A.unrefract(h.alt / RAD) * RAD, az: h.az }; }, cy, photoOn ? 0 : clamp(1 - gain * 0.3, 0.25, 1));
      /* over photos the drawn sky steps back: stars and symbols fainter, and in close views the stars are left to the photo */
      var photoInfo = photoOn ? drawPhotos(ctx, W, H, view, ms, cls, hor, dpr) : null, overPhoto = !!(photoInfo && photoInfo.shown), starDim = overPhoto ? (view.fov <= 5 ? 0 : 0.5) : 1;

      /* a line through horizontal positions, broken below the horizon where it could run behind the viewer */
      function stroke(hs, id) {
        ctx.beginPath();
        var pen = false, last = null;
        hs.forEach(function (h) {
          var q = h.alt < -15 ? null : proj(h);
          if (!q) { pen = false; last = null; return; }
          if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
          var hit = id && h.alt > 0 && inView(q, 0);
          if (hit) {
            hits.verts.push({ x: q.x, y: q.y, id: id });
            if (last) hits.verts.push({ x: (q.x + last.x) / 2, y: (q.y + last.y) / 2, id: id });
          }
          last = hit ? q : null;
        });
        ctx.stroke();
      }
      function onSky(pts) { return pts.map(function (p) { return hor(p[0], p[1]); }); }
      ctx.strokeStyle = SM.rings; ctx.lineWidth = 1;
      [30, 60].forEach(function (a) { var hs = []; for (var d = 0; d <= 360; d += 3) hs.push({ alt: a, az: d }); stroke(hs); });
      var eclH = onSky(eclipticPoints(ms));
      ctx.strokeStyle = SM.ecliptic; ctx.lineWidth = 1.3; ctx.setLineDash([6, 4]); stroke(eclH); ctx.setLineDash([]); ctx.lineWidth = 1;
      /* constellation lines always; the highlighted figure last, on top */
      [false, true].forEach(function (pass) {
        data.lines.forEach(function (c) {
          if (!!(hover && hover.con === c.id) !== pass) return;
          ctx.strokeStyle = pass ? SM.lineHi : SM.line; ctx.lineWidth = pass ? 1.8 : 1; ctx.globalAlpha = overPhoto && !pass ? 0.55 : 1;
          c.parts.forEach(function (pts) { stroke(onSky(pts), c.id); });
        });
      });
      ctx.lineWidth = 1; ctx.globalAlpha = 1;
      if (state.smBounds && data.bounds) { ctx.strokeStyle = SM.bounds; ctx.setLineDash([5, 4]); data.bounds.forEach(function (bd) { stroke(onSky(bd.pts)); }); ctx.setLineDash([]); }
      if (state.smGrid) drawGrid();

      /* The J2000 coordinate grid: parallels and hour circles, spaced by zoom (30° down to 1°, 2 h down to 5 min), only
         near the view once zoomed in, each labelled where it runs closest to the left (Dec) or bottom edge (RA). */
      function drawGrid() {
        var pa0 = precAngles(ms), mid = eqVector(unproj(W / 2, cy), ms), jm = toJ2000(Math.atan2(mid[1], mid[0]), Math.asin(clamp(mid[2], -1, 1)), pa0);
        var f = view.fov, step = f > 90 ? 30 : f > 40 ? 15 : f > 16 ? 5 : f > 6 ? 2 : f > 2.5 ? 1 : f > 1 ? 0.5 : 0.25;
        var stepRa = step >= 30 ? 30 : step >= 15 ? 15 : step >= 5 ? 5 : step >= 2 ? 2.5 : step >= 1 ? 1.25 : step >= 0.5 ? 0.5 : 0.25;
        var reach = f > 60 ? 180 : f * 0.75 + 5, d0 = Math.max(-90, jm.dec - reach), d1 = Math.min(90, jm.dec + reach), wide = f > 60 || Math.abs(jm.dec) + reach >= 88;
        function onGrid(pts) { return pts.map(function (pt) { var q = app(precessRig(pt[0], pt[1], pa0)); return hor(q.ra, q.dec); }); }
        ctx.strokeStyle = SM.grid; ctx.lineWidth = 1;
        for (var d = Math.ceil(d0 / step) * step; d <= d1 + 1e-9; d += step) {
          if (Math.abs(d) > 89.9) continue;
          var cosd = Math.max(Math.cos(d * RAD), 0.05), span = wide ? 180 : Math.min(180, reach / cosd), inc = Math.min(2, step / 2) / Math.max(cosd, 0.1), pts = [];
          for (var a = -span; a <= span + 1e-9; a += inc) pts.push([jm.ra + a, d]);
          var hs = onGrid(pts);
          stroke(hs);
          gridLabel(hs, (d > 0 ? '+' : d < 0 ? '−' : '') + num(Math.abs(d), step < 1 ? 2 : 0) + '°', 'dec');
        }
        var raSpan = wide ? 180 : Math.min(180, reach / Math.max(Math.cos(jm.dec * RAD), 0.05)), di = Math.min(2, step / 2);
        for (var r = Math.ceil((jm.ra - raSpan) / stepRa) * stepRa; r <= jm.ra + raSpan + 1e-9; r += stepRa) {
          var mpts = [];
          for (var dd = Math.max(-89.5, d0); dd <= Math.min(89.5, d1) + 1e-9; dd += di) mpts.push([r, dd]);
          var hm = onGrid(mpts);
          stroke(hm);
          gridLabel(hm, raLabel(r, stepRa), 'ra');
        }
      }
      function gridLabel(hs, txt, kind) {
        var best = null;
        hs.forEach(function (h) {
          if (h.alt < 2) return;
          var q = proj(h);
          if (!q || q.x < 6 || q.x > W - 40 || q.y < 26 || q.y > H - 14) return;
          var sc = kind === 'dec' ? q.x : -q.y;
          if (!best || sc < best.sc) best = { q: q, sc: sc };
        });
        if (best) gridLabels.push({ x: best.q.x + (kind === 'dec' ? 3 : 0), y: best.q.y - 7, txt: txt, align: kind === 'dec' ? 'left' : 'center' });
      }
      function raLabel(r, st) {
        var h = ((r % 360) + 360) % 360 / 15, hh = Math.floor(h + 1e-9), mm = Math.round((h - hh) * 60);
        if (mm === 60) { hh = (hh + 1) % 24; mm = 0; }
        return hh + 'h' + (st < 15 ? (mm < 10 ? '0' : '') + mm + 'm' : '');
      }
      /* the screen direction of a position angle (degrees from north through east) at a sky position of date */
      function skyAngle(pd, q, paDeg) {
        var dd = 0.2 * RAD, qn = proj(hor(pd.ra, pd.dec + dd)), qe = proj(hor(pd.ra + dd / Math.max(Math.cos(pd.dec), 0.02), pd.dec));
        if (!qn || !qe) return 0;
        var nx = qn.x - q.x, ny = qn.y - q.y, ex = qe.x - q.x, ey = qe.y - q.y, nl = Math.sqrt(nx * nx + ny * ny) || 1, el2 = Math.sqrt(ex * ex + ey * ey) || 1, pr = paDeg * RAD;
        return Math.atan2(ny / nl * Math.cos(pr) + ey / el2 * Math.sin(pr), nx / nl * Math.cos(pr) + ex / el2 * Math.sin(pr));
      }
      /* screen pixels per degree towards celestial north (n) and east (e) at a position of date (radians) */
      function skyFrame(raD, decD) {
        var dd = 0.02, q0 = proj(hor(raD, decD)), qn = proj(hor(raD, decD + dd * RAD)), qe = proj(hor(raD + dd * RAD / Math.max(Math.cos(decD), 0.02), decD));
        if (!q0 || !qn || !qe) return null;
        var fr = { nx: (qn.x - q0.x) / dd, ny: (qn.y - q0.y) / dd, ex: (qe.x - q0.x) / dd, ey: (qe.y - q0.y) / dd };
        fr.det = fr.ex * fr.ny - fr.nx * fr.ey; fr.scale = Math.sqrt(Math.abs(fr.det));
        return fr;
      }
      /* the lit part of a disc of radius r with its lit limb towards +x (fraction: lit share) */
      function phasePath(r, fraction) {
        var rx = Math.abs(2 * fraction - 1) * r;
        ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
        if (fraction < 0.5) ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
        else ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, 3 * Math.PI / 2, false);
        ctx.closePath();
      }
      /* A planet as a disc once it is bigger than its dot: turned to its pole and flattened; Jupiter with its belts and the
         four Galilean moons (behind or in front of the disc), Saturn with its rings at their tilt, Mercury, Venus and Mars
         in their phase. Returns the radius drawn, or 0 to leave the dot to the caller. */
      function drawPlanet(id, q, b, rDot) {
        var pl = A.PLANETS.filter(function (x) { return x.id === id; })[0], c = A.planetCoords(pl, ms), fr = skyFrame(c.ra, c.dec);
        if (!fr || !PLANET_RADIUS[id]) return 0;
        var semi = Math.atan(PLANET_RADIUS[id] / (c.dist * 149597870.7)) / RAD, rp = semi * fr.scale, disc = rp >= rDot * 0.9;
        var moons = id === 'jupiter' && semi * 26 * fr.scale > 8 ? galileanMoons(ms) : null;
        if (!disc && !moons) return 0;
        var cj = toJ2000(c.ra, c.dec, precAngles(ms)), ax = planetAxis(id, cj.ra, cj.dec), sP = Math.sin(ax.P * RAD), cP = Math.cos(ax.P * RAD);
        var rot = Math.atan2(sP * fr.ey + cP * fr.ny, sP * fr.ex + cP * fr.nx) + Math.PI / 2, flat = PLANET_FLAT[id] || 0;
        var body = { jupiter: '#e3cfaa', saturn: '#e6d29f', mars: '#d2744c', venus: '#f2e6c2', mercury: '#b9b1a4', uranus: '#a9dde0', neptune: '#7593e6' }[id];
        var names = T.galilean || ['Io', 'Europa', 'Ganymede', 'Callisto'];
        function moonPass(front) {
          (moons || []).forEach(function (m, i) {
            if (m.front !== front) return;
            if (!front && disc && m.X * m.X + Math.pow(m.Y / (1 - flat), 2) < 1) return; /* hidden behind Jupiter */
            var east = -m.X * cP + m.Y * sP, north = m.X * sP + m.Y * cP;
            var x = q.x + (east * fr.ex + north * fr.nx) * semi, y = q.y + (east * fr.ey + north * fr.ny) * semi;
            ctx.beginPath(); ctx.arc(x, y, Math.max(1.4 * scale, rp * 0.05), 0, 2 * Math.PI); ctx.fillStyle = '#eef2f6'; ctx.fill();
            bodyLabels.push({ px: x, py: y, r: 3, txt: names[i], c: 'rgba(238,242,246,.85)', font: '10px ' + FONT, must: false, near: true });
          });
        }
        moonPass(false);
        if (!disc) {
          ctx.beginPath(); ctx.arc(q.x, q.y, rDot, 0, 2 * Math.PI); ctx.fillStyle = BODY_COL[id]; ctx.fill();
          moonPass(true);
          return rDot;
        }
        var ry = rp * (1 - flat), near = ax.B >= 0 ? 1 : -1, phased = id === 'mercury' || id === 'venus' || id === 'mars';
        /* in the turned frame the pole points to −y; seen from above one pole, the near half of the rings lies on the other side */
        function ring(half) {
          if (id !== 'saturn') return;
          var sb = Math.max(Math.abs(Math.sin(ax.B * RAD)), 0.004);
          ctx.save();
          ctx.beginPath(); ctx.rect(-3 * rp, half > 0 ? 0 : -3 * rp, 6 * rp, 3 * rp); ctx.clip();
          ctx.beginPath(); ctx.ellipse(0, 0, 2.27 * rp, 2.27 * rp * sb, 0, 0, 2 * Math.PI); ctx.ellipse(0, 0, 1.53 * rp, 1.53 * rp * sb, 0, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(222,203,160,.88)'; ctx.fill('evenodd');
          ctx.beginPath(); ctx.ellipse(0, 0, 2.0 * rp, 2.0 * rp * sb, 0, 0, 2 * Math.PI); ctx.strokeStyle = 'rgba(40,34,26,.7)'; ctx.lineWidth = Math.max(0.6, rp * 0.05); ctx.stroke();
          ctx.restore();
        }
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(rot);
        ring(-near);
        ctx.beginPath(); ctx.ellipse(0, 0, rp, ry, 0, 0, 2 * Math.PI);
        if (phased) { ctx.save(); ctx.globalAlpha *= 0.16; ctx.fillStyle = body; ctx.fill(); ctx.restore(); } /* the night side, faint */
        else {
          ctx.save(); ctx.clip();
          ctx.fillStyle = body; ctx.fillRect(-rp, -ry, 2 * rp, 2 * ry);
          var belts = id === 'jupiter' ? [[-0.36, -0.13, 'rgba(160,112,72,.55)'], [0.1, 0.34, 'rgba(160,112,72,.6)'], [-1, -0.72, 'rgba(120,100,80,.35)'], [0.72, 1, 'rgba(120,100,80,.35)']]
            : id === 'saturn' ? [[-0.3, -0.15, 'rgba(190,160,100,.35)'], [-1, -0.7, 'rgba(140,130,110,.3)'], [0.7, 1, 'rgba(140,130,110,.3)']] : [];
          belts.forEach(function (bt) { ctx.fillStyle = bt[2]; ctx.fillRect(-rp, bt[0] * ry, 2 * rp, (bt[1] - bt[0]) * ry); });
          ctx.restore();
        }
        ring(near);
        ctx.restore();
        if (phased) {
          var qt = proj(limbStep(b, sun)), ang = qt ? Math.atan2(qt.y - q.y, qt.x - q.x) : 0;
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(ang); phasePath(rp, (1 + Math.cos(c.phase * RAD)) / 2); ctx.fillStyle = body; ctx.fill(); ctx.restore();
        }
        moonPass(true);
        return id === 'saturn' ? rp * 2.27 : rp; /* Saturn: taps and labels reach the edge of the rings */
      }
      /* the Moon as a photograph once it is at least 28 px across (drawMoonImage), at its topocentric place mc (moonAt():
         RA/Dec and distance from here, so its apparent radius is the one seen from the place); returns its radius or 0 */
      function drawMoonPhoto(q, mc) {
        var d = A.toDays(ms), fr = skyFrame(mc.ra, mc.dec);
        if (!fr) return 0;
        /* the square takes the longer axis: near the horizon refraction squashes the disc, and the mean scale cut its sides off */
        var semi = Math.atan(1737.4 / mc.dist) / RAD, rp = semi * Math.max(Math.sqrt(fr.ex * fr.ex + fr.ey * fr.ey), Math.sqrt(fr.nx * fr.nx + fr.ny * fr.ny));
        if (rp < 14) return 0;
        var sc = A.sunCoords(d), chi = posAngle(mc.ra / RAD, mc.dec / RAD, sc.ra / RAD, sc.dec / RAD);
        var iph = Math.acos(clamp(2 * A.moonIllumination(ms).fraction - 1, -1, 1)) / RAD;
        /* the image in device pixels, up to 512 (the texture is 1024 × 512, so 512 px across is all it can honestly give;
           the old cap of 256 left the 0.2°-wide moon scaled up sevenfold) */
        var img = moonImage(Math.min(512, Math.ceil(rp * 2 * dpr)), fr, semi, rp, moonLibration(ms), iph, chi);
        if (!img) return 0;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, q.x - rp, q.y - rp, 2 * rp, 2 * rp);
        return rp;
      }

      /* stars, bright ones on top; zoomed in, a quick test against the middle of the view spares the faint thousands
         outside it. Sizes follow the limit, so stars grow as the view closes in; the faintest fade in. Names by zoom:
         proper names down to 2.5 mag in the whole view and fainter the closer in, Greek letters from two zoom steps. */
      /* the cut reaches the corner (stereographic: 2·atan(ρ / 2k)) plus 6°; from the width alone it left the corners of a tall canvas empty */
      var cornerDeg = 2 * Math.atan(Math.sqrt(W * W / 4 + cy * cy) / (2 * k)) / RAD, cosCut = cornerDeg + 6 < 175 ? Math.cos((cornerDeg + 6) * RAD) : -2, midV = eqVector(unproj(W / 2, cy), ms);
      var nameMag = 2.5 + gain * 1.3, greekOn = gain >= 2;
      function drawStar(s) {
        if (s.mag > limit || s.x * midV[0] + s.y * midV[1] + s.z * midV[2] < cosCut) return;
        var h = hor(s.ra, s.dec);
        if (h.alt < 0) return;
        var q = proj(h);
        if (!inView(q, 4)) return;
        var r = clamp(0.5 + (limit + 0.5 - s.mag) * 0.45, 0.5, 3.8 + gain * 0.25) * scale;
        if (starDim) {
          ctx.globalAlpha = clamp((limit + 0.4 - s.mag) / 0.8, 0.35, 1) * (h.alt < 10 ? 0.55 : 1) * starDim; /* horizon haze; softer over photos */
          ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 2 * Math.PI); ctx.fillStyle = starColour(s.bv); ctx.fill();
        }
        hits.all.push({ x: q.x, y: q.y, s: s });
        var txt = s.name && s.mag <= nameMag ? s.name : greekOn && s.bayer ? s.bayer : '';
        if (txt) hits.stars.push({ x: q.x, y: q.y, r: r, name: txt, mag: s.mag, greek: txt === s.bayer });
      }
      if (limit > 6 && state.deepStars) state.deepStars.forEach(drawStar);
      data.stars.forEach(drawStar);
      ctx.globalAlpha = 1;

      /* the further deep-sky objects of OpenNGC (astro-tools/data/ngc.json, loaded on first need), fainter and thinner than
         the catalogue's: galaxies from 40° wide down to 8.5 mag, 1.5 mag fainter per halving of the width (to 16 mag; those
         without a magnitude count as 15.5), clusters and nebulae from about 28° wide, the NGC and IC entries that are stars,
         double stars or asterisms from three halvings as small circles; each opens its card */
      if (gain >= 1.5) loadNgc();
      if (gain >= 2 && state.ngc) {
        var magLim = Math.min(16, 8.5 + (gain - 2) * 1.5);
        state.ngc.forEach(function (o) {
          var r0 = o.row, isGx = r0[3] === 'Gx', isStar = GROUP[r0[3]] === 'stars', m0 = r0[7], mg = m0 != null ? m0 : 15.5;
          if (isStar ? gain < 3 : isGx ? !(mg <= magLim) : (gain < 2.5 && !(m0 != null && m0 <= magLim + 1))) return;
          if (o.x * midV[0] + o.y * midV[1] + o.z * midV[2] < cosCut) return;
          var h = hor(o.ra, o.dec);
          if (h.alt < 0) return;
          var q = proj(h);
          if (!inView(q, 20)) return;
          var grp = GROUP[r0[3]], c = DSO_COL[grp] || '#9fb3c4', r = isStar ? 3.5 : clamp((r0[4] || (isGx ? 1 : 3)) / 120 * RAD * k, 2.5, Math.max(W, H));
          var rMin = r0[4] && r0[5] ? Math.max(2, r * r0[5] / r0[4]) : isGx ? Math.max(2, r * 0.6) : r, rot = r0[6] != null && rMin < r ? skyAngle(o, q, r0[6]) : 0;
          ctx.globalAlpha = overPhoto ? 0.4 : h.alt < 10 ? 0.35 : 0.65; ctx.strokeStyle = c; ctx.lineWidth = 0.9;
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(rot);
          ctx.beginPath();
          if (isGx || r0[3] === 'PN') ctx.ellipse(0, 0, r, rMin, 0, 0, 2 * Math.PI);
          else if (grp === 'nebulae') ctx.rect(-r, -rMin, 2 * r, 2 * rMin);
          else ctx.arc(0, 0, r, 0, 2 * Math.PI);
          if (r0[3] === 'OC') ctx.setLineDash([2, 2]);
          ctx.restore();
          ctx.stroke(); ctx.setLineDash([]);
          ctx.globalAlpha = 1; ctx.lineWidth = 1;
          if (gain >= 3.5 || (m0 != null && m0 <= magLim - 2)) ngcMarks.push({ px: q.x, py: q.y, r: Math.min(r, 12), txt: gain >= 4.5 && r0[8] ? r0[0] + ' ' + r0[8] : r0[0], c: c });
          hits.dso.push({ x: q.x, y: q.y, r: r, id: 'ngc:' + o.idx, name: r0[0] + (r0[8] ? ' · ' + r0[8] : ''), pick: false });
        });
      }

      /* the deep-sky objects of the catalogue once zoomed in: a symbol after the type at about the object's size
         (galaxy ellipse, nebula square, cluster circle, dashed for open clusters, crossed for globulars and planetary
         nebulae), the picked object in red; objects in this night's list can be picked with a click */
      if (gain >= 1) {
        var listed = {};
        (state.listRes ? state.listRes.list : []).forEach(function (x) { listed[x.o.id] = true; });
        CATALOG.forEach(function (o) {
          var isPicked = o.id === state.target; /* in red at its size; its ring and label follow below */
          var pd = appJ(o.ra, o.dec, ms), h = hor(pd.ra, pd.dec);
          if (h.alt < 0) return;
          var q = proj(h);
          if (!inView(q, 30)) return;
          var r = clamp(o.s / 120 * RAD * k, 3.5, Math.max(W, H)), grp = GROUP[o.t], c = isPicked ? SM.picked : DSO_COL[grp];
          /* axis ratio and position angle from SIMBAD (q, pa in astro-tools/js/dso-catalog.js); galaxies without them stay a flat
             ellipse, nebulae without them a square */
          var rMin = o.q ? Math.max(2.5, r * o.q) : o.t === 'Gx' ? Math.max(2.5, r * 0.5) : r, rot = o.pa != null && rMin < r ? skyAngle(pd, q, o.pa) : 0;
          ctx.globalAlpha = isPicked ? 0.95 : overPhoto ? 0.5 : h.alt < 10 ? 0.5 : 0.9; ctx.strokeStyle = c; ctx.lineWidth = isPicked ? 1.6 : overPhoto ? 0.9 : 1.2;
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(rot);
          ctx.beginPath();
          if (o.t === 'Gx' || o.t === 'PN') ctx.ellipse(0, 0, r, rMin, 0, 0, 2 * Math.PI);
          else if (grp === 'nebulae') ctx.rect(-r, -rMin, 2 * r, 2 * rMin);
          else ctx.arc(0, 0, r, 0, 2 * Math.PI);
          if (o.t === 'OC') ctx.setLineDash([2, 2]);
          ctx.restore();
          ctx.stroke(); ctx.setLineDash([]);
          if (o.t === 'GC' || o.t === 'PN') {
            ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(rot);
            ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -rMin); ctx.lineTo(0, rMin);
            ctx.restore(); ctx.stroke();
          }
          ctx.globalAlpha = 1; ctx.lineWidth = 1;
          var full = o.id + (o[LANG] ? ' · ' + o[LANG] : '');
          if (!isPicked) dsoMarks.push({ px: q.x, py: q.y, r: Math.min(r, 14), txt: gain >= 2 && o[LANG] ? o.id + ' ' + o[LANG] : o.id, c: c }); /* large objects: the name near the middle */
          hits.dso.push({ x: q.x, y: q.y, r: r, id: o.id, name: full, pick: !!listed[o.id] });
        });
      }

      /* sun by day, moon in its phase, planets and the object picked in the list */
      var bodyLabels = [];
      var qs = sun.alt > -0.833 && proj(sun);
      if (qs) { ctx.beginPath(); ctx.arc(qs.x, qs.y, 9 * scale, 0, 2 * Math.PI); ctx.fillStyle = COL.sunLine; ctx.fill(); }
      BODIES.forEach(function (id) {
        var b = bodyHor(id, ms), q = b.alt > 0 && proj(b), r;
        /* the moon is drawn while any of its disc is in view: zoomed in on an occultation its centre lies well outside the
           canvas (0.3° wide, the disc 1500 px across), and the 10 px margin that suits the planets dropped the whole moon */
        var pad = id === 'moon' && q ? 10 + 1.2 * Math.atan(1737.4 / b.dist) * k : 10;
        if (!inView(q, pad)) return;
        ctx.globalAlpha = b.alt < 10 ? 0.55 : 1;
        if (id === 'moon') {
          r = 8 * scale;
          var mr = gain >= 2 ? drawMoonPhoto(q, b) : 0;
          if (mr) r = mr;
          else {
            var qt = proj(limbStep(b, sun)); /* the lit limb faces the sun */
            A.drawLitMoon(ctx, q.x, q.y, r, A.moonIllumination(ms).fraction, qt ? Math.atan2(qt.y - q.y, qt.x - q.x) : 0);
          }
        } else {
          r = clamp(4.2 - 0.7 * b.mag, 2.5, 7.5) * scale;
          var pr = gain >= 3 ? drawPlanet(id, q, b, r) : 0;
          if (pr) r = pr;
          else { ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 2 * Math.PI); ctx.fillStyle = BODY_COL[id]; ctx.fill(); }
        }
        ctx.globalAlpha = 1;
        /* a body found by the search carries its name on the red target label below; its own would lie on top of it.
           No label for a moon whose centre is off the canvas: it would be clamped to the edge */
        if (inView(q, 10) && !(state.evTarget && state.evTarget.body === id)) bodyLabels.push({ px: q.x, py: q.y, r: r, txt: T.plNames[id], c: BODY_COL[id] });
        hits.bodies.push({ x: q.x, y: q.y, r: r, id: id });
      });
      var obj = targetObject();
      if (obj) {
        var pc = appJ(obj.ra, obj.dec, ms), ho = hor(pc.ra, pc.dec), qo = ho.alt > 0 && proj(ho);
        if (inView(qo, 10)) {
          /* the picked object in red, with a soft halo so that it stands out against the Milky Way and the lines */
          ctx.beginPath(); ctx.arc(qo.x, qo.y, 11, 0, 2 * Math.PI); ctx.strokeStyle = 'rgba(255,77,77,.35)'; ctx.lineWidth = 4; ctx.stroke();
          ctx.beginPath(); ctx.arc(qo.x, qo.y, 7.5, 0, 2 * Math.PI); ctx.strokeStyle = SM.picked; ctx.lineWidth = 2.2; ctx.stroke(); ctx.lineWidth = 1;
          bodyLabels.push({ px: qo.x, py: qo.y, r: 12, txt: obj.id, c: SM.picked, font: '600 12px ' + FONT, back: true });
        }
      }
      /* a marked target (an event row with a fixed position such as a double star, or a search hit), ringed in red like a
         list pick: J2000 degrees, or for the moon and planets the body itself, which moves with the time */
      var evt = state.evTarget;
      if (evt) {
        var he, qe;
        if (evt.body) he = bodyHor(evt.body, ms);
        else { var pe = appJ(evt.ra, evt.dec, ms); he = hor(pe.ra, pe.dec); }
        qe = he.alt > 0 && proj(he);
        if (inView(qe, 10)) {
          ctx.beginPath(); ctx.arc(qe.x, qe.y, 11, 0, 2 * Math.PI); ctx.strokeStyle = 'rgba(255,77,77,.35)'; ctx.lineWidth = 4; ctx.stroke();
          ctx.beginPath(); ctx.arc(qe.x, qe.y, 7.5, 0, 2 * Math.PI); ctx.strokeStyle = SM.picked; ctx.lineWidth = 2.2; ctx.stroke(); ctx.lineWidth = 1;
          bodyLabels.push({ px: qe.x, py: qe.y, r: 12, txt: evt.label, c: SM.picked, font: '600 12px ' + FONT, back: true });
        }
      }
      /* a marked target (search hit, event row, list pick) below the horizon at this time: noted on the map further down */
      var below = evt ? (he.alt <= 0 ? { h: he, label: evt.label } : null) : obj && ho && ho.alt <= 0 ? { h: ho, label: obj.id } : null;
      /* satellite passes within a quarter of an hour of the chosen time: the visible track with an arrow, the start time
         as label and the satellite itself while the pass is on */
      (state.passes || []).forEach(function (p) {
        if (t < p.start - 900 || t > p.end + 900) return;
        var pen = false, last = null, prev = null;
        ctx.beginPath();
        p.track.forEach(function (pt) {
          var q = proj(satPt(pt));
          if (!q) { pen = false; return; }
          if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
          prev = last; last = q;
        });
        ctx.strokeStyle = SM.satellite; ctx.lineWidth = 1.6; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
        if (last && prev) {
          var ang = Math.atan2(last.y - prev.y, last.x - prev.x);
          ctx.beginPath(); ctx.moveTo(last.x, last.y);
          ctx.lineTo(last.x - 9 * Math.cos(ang - 0.4), last.y - 9 * Math.sin(ang - 0.4)); ctx.lineTo(last.x - 9 * Math.cos(ang + 0.4), last.y - 9 * Math.sin(ang + 0.4));
          ctx.closePath(); ctx.fillStyle = SM.satellite; ctx.fill();
        }
        var now = null;
        for (var kk = 0; kk + 1 < p.track.length; kk++) { /* not k: that is the projection's scale */
          var a0 = p.track[kk], a1 = p.track[kk + 1];
          if (t < a0.t || t > a1.t) continue;
          var f = (t - a0.t) / (a1.t - a0.t || 1), qd = proj(satPt({ alt: a0.alt + f * (a1.alt - a0.alt), az: a0.az + f * ((((a1.az - a0.az) + 540) % 360) - 180) }));
          if (qd) { ctx.beginPath(); ctx.arc(qd.x, qd.y, 4.5, 0, 2 * Math.PI); ctx.fillStyle = '#fff6d6'; ctx.fill(); ctx.strokeStyle = SM.satellite; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; now = qd; }
          break;
        }
        /* the name where the satellite is at the chosen time, or at its highest point; the times at both ends of the
           track. All on a dark backing: yellow alone gets lost among stars and constellation lines. */
        var tag = now || proj(satPt(p.max));
        if (inView(tag, 0)) bodyLabels.push({ px: tag.x, py: tag.y, r: 6, txt: p.name + (now ? '' : ' ' + hhmmLoc(p.max.t, off)), c: SM.satellite, font: '600 12px ' + FONT, back: true });
        /* where the track enters and leaves the map, with the time at that very point (not the pass's start and end,
           which may lie outside the view) */
        var inside = p.track.filter(function (pt) { return inView(proj(satPt(pt)), 0); });
        [inside[0], inside.length > 1 ? inside[inside.length - 1] : null].forEach(function (pt) {
          if (!pt) return;
          var qe = proj(satPt(pt));
          bodyLabels.push({ px: qe.x, py: qe.y, r: 3, txt: hhmmLoc(pt.t, off), c: SM.satellite, back: true, must: false, near: true });
        });
      });
      /* comets of the night: a soft head with a short tail pointing away from the sun */
      (state.cometsNight || []).forEach(function (cm) {
        var cp = A.cometCoords(cm.comet, ms), hc = hor(cp.ra, cp.dec), qc = hc.alt > 0 && proj(hc);
        if (!inView(qc, 10)) return;
        var qs2 = proj(limbStep(hc, sun));
        if (qs2) {
          var dx = qc.x - qs2.x, dy = qc.y - qs2.y, dl = Math.sqrt(dx * dx + dy * dy) || 1, tail = 16 * scale;
          var grad = ctx.createLinearGradient(qc.x, qc.y, qc.x + dx / dl * tail, qc.y + dy / dl * tail);
          grad.addColorStop(0, 'rgba(126,224,195,.8)'); grad.addColorStop(1, 'rgba(126,224,195,0)');
          ctx.strokeStyle = grad; ctx.lineWidth = 3 * scale; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(qc.x, qc.y); ctx.lineTo(qc.x + dx / dl * tail, qc.y + dy / dl * tail); ctx.stroke();
          ctx.lineWidth = 1; ctx.lineCap = 'butt';
        }
        var glow = ctx.createRadialGradient(qc.x, qc.y, 0, qc.x, qc.y, 6 * scale);
        glow.addColorStop(0, 'rgba(230,255,247,1)'); glow.addColorStop(0.4, 'rgba(126,224,195,.85)'); glow.addColorStop(1, 'rgba(126,224,195,0)');
        ctx.beginPath(); ctx.arc(qc.x, qc.y, 6 * scale, 0, 2 * Math.PI); ctx.fillStyle = glow; ctx.fill();
        bodyLabels.push({ px: qc.x, py: qc.y, r: 4, txt: cm.comet.name.replace(/\s*\(.*\)$/, ''), c: SM.comet });
      });
      /* the star, planet or object whose card is open, ringed in cyan */
      var iq = infoSkyPos(state.smInfo, ms, hor);
      iq = iq && iq.alt > 0 && proj(iq);
      if (inView(iq, 10)) { ctx.beginPath(); ctx.arc(iq.x, iq.y, 11, 0, 2 * Math.PI); ctx.strokeStyle = SM.info; ctx.lineWidth = 1.8; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
      ctx.restore();

      /* a low hill line along the horizon, tied to the azimuth so that it turns with the view */
      ctx.beginPath();
      var pen = false;
      for (var dh = 0; dh <= 360; dh += 2) {
        var ar = dh * RAD, hq = proj({ alt: Math.max(0.3, 1.3 + 0.9 * Math.sin(2 * ar + 0.5) + 0.6 * Math.sin(5 * ar + 1.3) + 0.35 * Math.sin(11 * ar + 2)), az: dh });
        if (hq) { if (pen) ctx.lineTo(hq.x, hq.y); else { ctx.moveTo(hq.x, hq.y); pen = true; } }
      }
      for (var dg = 360; dg >= 0; dg -= 2) { var gq = proj({ alt: -1, az: dg }); if (gq) ctx.lineTo(gq.x, gq.y); }
      ctx.closePath(); ctx.fillStyle = SM.ground[cls]; ctx.fill();

      /* labels by priority, none on top of another */
      ctx.textBaseline = 'middle';
      function label(txt, x, y, colour, font, align) {
        ctx.font = font;
        var w = ctx.measureText(txt).width, x0 = clamp(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, 2, W - w - 2), b = [x0 - 2, y - 7, x0 + w + 2, y + 7];
        if (boxes.some(function (o) { return b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]; })) return;
        boxes.push(b); ctx.fillStyle = colour; ctx.textAlign = 'left'; ctx.fillText(txt, x0, y);
      }
      var f10 = '10px ' + FONT, f11 = '11px ' + FONT, f12b = '600 12px ' + FONT, area = { W: W, top: 8, bottom: H - 8 };
      /* corner texts on a dark backing, so that no star runs through them */
      function backed(txt, x, y, align, colour) {
        ctx.font = f12b;
        var w = ctx.measureText(txt).width, x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
        ctx.fillStyle = 'rgba(11,17,25,.6)'; ctx.fillRect(x0 - 5, y - 9, w + 10, 18);
        label(txt, x, y, colour || '#e4e9ef', f12b, align);
      }
      backed(T.plPhase[cls], 10, 14);
      backed(hhmm(t, off), W - 10, 14, 'right');
      if (gain > 0.05) backed(T.smZoomed.replace('{f}', num(view.fov, view.fov < 2 ? 1 : 0)).replace('{m}', num(limit, 1)) + (photoInfo ? (photoInfo.pending ? T.smPhotoLoading : photoInfo.shown ? T.smPhotoSrc.replace('{s}', survey().label) : '') : ''), W - 10, 34, 'right');
      if (hover) backed([hover.con ? data.names[hover.con] : '', hover.star || '', hover.dso || ''].filter(Boolean).join(' · '), 10, 34);
      /* the marked target is below the horizon: a red wedge on the horizon in its direction (when that is in view) and the
         notice above it, else at the top of the map */
      if (below) {
        var bq = proj({ alt: 0, az: below.h.az }), btxt = T.smBelow.replace('{s}', below.label).replace('{t}', hhmm(t, off)).replace('{alt}', num(below.h.alt)), by = 34;
        if (inView(bq, 10) && bq.y < H) {
          ctx.beginPath(); ctx.moveTo(bq.x - 7, bq.y - 15); ctx.lineTo(bq.x + 7, bq.y - 15); ctx.lineTo(bq.x, bq.y - 3); ctx.closePath();
          ctx.fillStyle = SM.picked; ctx.fill();
          by = clamp(bq.y - 30, 34, H - 20);
        }
        ctx.font = f12b;
        var bw = ctx.measureText(btxt).width;
        backed(btxt, clamp(bq && inView(bq, 10) ? bq.x : W / 2, bw / 2 + 10, W - bw / 2 - 10), by, 'center', '#ff9a9a');
      }
      /* compass points on the ground just below the horizon, the zenith as a small cross */
      for (var ci = 0; ci < 8; ci++) {
        var cq = proj({ alt: 0, az: ci * 45 });
        if (cq && cq.x > 8 && cq.x < W - 8 && cq.y > 20 && cq.y < H) label(T.compass[ci], cq.x, Math.min(cq.y + 15, H - 9), ci % 2 ? SM.compassDim : SM.compass, ci % 2 ? f11 : f12b, 'center');
      }
      var zq = proj({ alt: 90, az: 0 });
      if (inView(zq, -12)) {
        ctx.fillStyle = SM.compass; ctx.fillRect(zq.x - 4, zq.y - 0.5, 9, 1); ctx.fillRect(zq.x - 0.5, zq.y - 4, 1, 9);
        label(T.smZenith, zq.x + 7, zq.y - 9, SM.compass, f10);
      }
      bodyLabels.forEach(function (b) { boxes.push([b.px - b.r, b.py - b.r, b.px + b.r, b.py + b.r]); }); /* no label over a body */
      bodyLabels.forEach(function (b) { b.font = b.font || f11; placeLabel(ctx, boxes, area, b, b.must !== false, b.near); });
      if (state.smNames) {
        /* names along the ecliptic, towards the left of the view, and on the Milky Way, where there is room */
        var eqPt = null, eqD = 1e9;
        eclH.forEach(function (h) {
          var q = h.alt > 8 && proj(h);
          if (inView(q, -30) && Math.abs(q.x - W * 0.22) < eqD) { eqD = Math.abs(q.x - W * 0.22); eqPt = q; }
        });
        if (eqPt) label(T.smEcliptic, eqPt.x, eqPt.y - 10, SM.ecliptic, 'italic ' + f10, 'center');
        if (mwLabel) label(T.smMilkyWay, mwLabel.x, mwLabel.y, SM.mwText, 'italic ' + f11, 'center');
      }
      var maxRank = Math.min(3, (small ? 1 : W < 560 ? 2 : 3) + Math.floor(gain)), placed = data.labels.map(function (c) {
        var h = hor(c.ra, c.dec);
        c.alt = h.alt;
        if (h.alt < 3) return null;
        var q = proj(h);
        if (!inView(q, -6)) return null;
        hits.verts.push({ x: q.x, y: q.y, id: c.id });
        return { c: c, q: q };
      }).filter(Boolean);
      placed.forEach(function (p) { if (hover && hover.con === p.c.id) label(p.c.name, p.q.x, p.q.y, SM.conHi, f12b, 'center'); });
      if (state.smNames) {
        dsoMarks.forEach(function (d) { placeLabel(ctx, boxes, area, { px: d.px, py: d.py, r: d.r, txt: d.txt, c: d.c, font: f10 }, false, true); });
        ngcMarks.forEach(function (d) { placeLabel(ctx, boxes, area, { px: d.px, py: d.py, r: d.r, txt: d.txt, c: d.c, font: f10 }, false, true); });
        hits.stars.slice().reverse().forEach(function (s) {
          if (small && !s.greek && s.mag > 1 + gain) return;
          placeLabel(ctx, boxes, area, { px: s.x, py: s.y, r: s.r, txt: s.name, c: s.greek ? 'rgba(255,244,216,.6)' : SM.star, font: s.greek ? 'italic ' + f10 : f10 }, false, true);
        });
        placed.forEach(function (p) { if (p.c.rank <= maxRank && !(hover && hover.con === p.c.id)) label(p.c.name, p.q.x, p.q.y, SM.con, f11, 'center'); });
      }
      gridLabels.forEach(function (g) { label(g.txt, g.x, g.y, SM.gridText, f10, g.align); });
      [30, 60].forEach(function (a) { /* altitude marks where the rings leave the left edge */
        for (var d = 0; d < 360; d += 1) {
          var q = proj({ alt: a, az: az0 - 180 + d });
          if (q && q.x >= 4 && q.x < W / 2 && q.y > 40 && q.y < H - 40) { label(a + '°', q.x + 3, q.y - 8, 'rgba(228,233,239,.5)', f10); break; }
        }
      });
      state.smHits = hits;

      var i = Math.round(az0 / 45) % 8;
      el.smSub.textContent = T.smSub.replace('{n}', state.nightLabel)
        .replace('{view}', T.view.replace('{c}', T.compassLong[i]).replace('{l}', T.compassLong[(i + 6) % 8]).replace('{r}', T.compassLong[(i + 2) % 8]) +
          (state.smFov != null ? T.viewUp.replace('{a}', num(view.c0 / RAD)) : ''));
      if (el.smZoomOut) { el.smZoomOut.disabled = state.smFov == null; el.smZoomIn.disabled = view.fov <= skyFovMin(); el.smZoomOut.style.opacity = el.smZoomOut.disabled ? '.45' : '1'; el.smZoomIn.style.opacity = el.smZoomIn.disabled ? '.45' : '1'; }
      /* in words: the prominent constellations high up at this moment, in any direction */
      var high = data.labels.filter(function (c) { return c.rank <= 2 && c.alt >= 40; })
        .sort(function (a, b) { return b.alt - a.alt; })
        .map(function (c) { return c.name; }).filter(function (n, j, arr) { return arr.indexOf(n) === j; }).slice(0, 8);
      var skyWords = (high.length ? T.smHigh.replace('{list}', high.join(', ')) : T.smNone).replace('{t}', hhmm(t, off)) + (cls === 0 ? T.smDay : ''); /* for screen readers only */
      var pcT = pcTime(t); /* the location's time the slider sets, and the visitor's device time below it where it differs */
      el.smClock.innerHTML = esc(hhmmLoc(t, off)) + (pcT ? '<small class="op-clock-pc">' + esc(T.pcClock.replace('{t}', pcT)) + '</small>' : '');
      el.smMap.setAttribute('aria-label', el.smSub.textContent + '. ' + skyWords);
      renderInfo();
    }

    /* ------------------------------------------------------------------ *
     * Info card for a star, planet, the moon or a deep-sky object         *
     * ------------------------------------------------------------------ */
    var PLANET_RADIUS = { mercury: 2440.5, venus: 6051.8, mars: 3396.2, jupiter: 71492, saturn: 60268, uranus: 25559, neptune: 24764 }; /* equatorial, km */
    function infoStar(inf) { return inf && inf.kind === 'star' && state.smData ? state.smData.byIdx[inf.idx] : null; }
    function infoDso(inf) {
      if (!inf || inf.kind !== 'dso') return null;
      if (String(inf.id).indexOf('ngc:') === 0) { /* an OpenNGC object, shaped like a catalogue entry */
        var r0 = state.ngcRaw && state.ngcRaw[+String(inf.id).slice(4)];
        return r0 ? { id: r0[0], ra: r0[1], dec: r0[2], t: r0[3], c: constellationAt(skyBounds(), r0[1], r0[2]) || '', m: r0[7], s: r0[4], q: r0[4] && r0[5] ? r0[5] / r0[4] : null, pa: r0[6], de: r0[8] || '', en: r0[8] || '', extra: true,
          ids: r0[9] || [], src: /^Sh2-/.test(r0[0]) ? 'Sharpless' : 'OpenNGC', row: r0 } : null;
      }
      return CATALOG.filter(function (o) { return o.id === inf.id; })[0];
    }
    /* the rows of the extract that are this star or pair — NGC and IC entries that turned out to be stars (NGC 1990 is
       Alnilam): within 0.15′ of its J2000 position, or carrying its WDS number */
    function rowTwins(raJ, decJ, wds) {
      var found = [];
      (state.ngcRaw || []).forEach(function (r0) {
        if (GROUP[r0[3]] !== 'stars') return;
        var byWds = wds && (r0[9] || []).indexOf('WDS ' + wds) >= 0;
        if (!byWds && Math.abs(r0[2] - decJ) > 0.01) return;
        var dRa = ((r0[1] - raJ + 540) % 360 - 180) * Math.cos(decJ * RAD), dDec = r0[2] - decJ;
        if (byWds || Math.sqrt(dRa * dRa + dDec * dDec) * 60 <= 0.15) found.push(r0[0]);
      });
      return found;
    }
    /* apparent altitude and azimuth of the card's subject at a moment (hor: the map's refracting conversion) */
    function infoSkyPos(inf, ms, hor) {
      if (!inf) return null;
      if (inf.kind === 'body') return bodyHor(inf.id, ms);
      if (inf.kind === 'double') { var dp = appJ(inf.d.ra, inf.d.dec, ms); return hor(dp.ra, dp.dec); }
      var s = infoStar(inf);
      if (s) return hor(s.ra, s.dec);
      var o = infoDso(inf);
      if (o) { var p = appJ(o.ra, o.dec, ms); return hor(p.ra, p.dec); }
      return null;
    }
    function raText(ra) {
      var h = ((ra % 360) + 360) % 360 / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m), ss = Math.round((m - mm) * 60);
      if (ss === 60) { ss = 0; mm++; }
      if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
      return hh + 'h ' + pad(mm) + 'm ' + pad(ss) + 's';
    }
    function decText(dec) {
      var a = Math.abs(dec), d = Math.floor(a), m = Math.round((a - d) * 60);
      if (m === 60) { m = 0; d++; }
      return (dec < 0 ? '−' : '+') + d + '° ' + pad(m) + '′';
    }
    function lightYears(plx) {
      if (!(plx > 1)) return T.infoLyFar;
      var ly = 3261.56 / plx, n = ly < 100 ? Math.round(ly) : Math.round(ly / 10) * 10;
      return (plx >= 5 ? T.infoLy : T.infoLyRough).replace('{n}', n.toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB'));
    }
    /* what does not change while the slider moves: worked out when the card opens or the night changes */
    var infoCache = null;
    function infoStatic(inf) {
      var win = state.plWin, mid = (win.start + win.end) / 2, msMid = mid * 1000, lat = state.lat, lon = state.lon;
      var out = { facts: [], level: -0.567, altAt: null, title: '', sub: '', pick: null, wiki: null, posAt: null };
      var s = infoStar(inf), o = infoDso(inf), dbl = inf.kind === 'double' ? inf.d : null;
      function cons(raJ, decJ) { var ab = constellationAt(skyBounds(), raJ, decJ); return ab ? consName(ab) : '–'; }
      if (s) {
        var sd = { ra: s.ra, dec: s.dec }, ab = constellationAt(skyBounds(), s.ra0, s.dec0);
        out.title = s.name || (s.bayer && ab ? s.bayer + ' ' + ab : T.infoUnnamed);
        var raw = typeof s.idx === 'number' ? SKY.stars[s.idx] : null; /* the stars from stars-8.bin carry no name or Bayer letter */
        if (raw) out.wiki = wikiUrl(LANG, null, starWikiQuery(LANG, { name: LANG === 'de' ? raw[4] || raw[5] : raw[5], bayer: raw[6], con: ab }));
        out.sub = T.infoStar;
        out.altAt = function (sec) { return A.horizontalOf(sd.ra, sd.dec, sec * 1000, lat, lon); };
        var bv = s.bv, cw = T.colours[bv < 0 ? 0 : bv < 0.3 ? 1 : bv < 0.6 ? 2 : bv < 1.0 ? 3 : bv < 1.4 ? 4 : 5];
        out.facts.push([T.infoMag, num(s.mag, 1) + ' mag'], [T.infoColour, cw + ' (B−V ' + num(bv, 1) + ')'], [T.infoDist, lightYears(s.plx)],
          [T.infoCons, ab ? consName(ab) : '–'], [T.infoCoord, raText(s.ra0) + ' · ' + decText(s.dec0)]);
        if (s.pm >= 500) out.facts.push([T.infoPm, T.infoPmVal.replace('{v}', num(s.pm / 1000, 1))]);
        var starTwins = rowTwins(s.ra0, s.dec0, null);
        if (starTwins.length) out.facts.push([T.infoAlso, starTwins.join(', ')]);
      } else if (o) {
        out.title = o.id + (o[LANG] ? ' · ' + o[LANG] : '');
        out.sub = T.types[o.t] + (o.extra ? ' · ' + o.src : '');
        var op = appJ(o.ra, o.dec, msMid);
        out.altAt = function (sec) { return A.horizontalOf(op.ra, op.dec, sec * 1000, lat, lon); };
        out.facts.push([T.infoMag, o.m != null ? num(o.m, 1) + ' mag' : '–'], [T.infoObjSize, o.s == null ? '–' : (o.s < 1 ? num(o.s * 60) + '″' : num(o.s, o.s < 10 ? 1 : 0) + '′') + (o.q && o.q < 1 ? ' × ' + (o.s * o.q < 1 ? num(o.s * o.q * 60) + '″' : num(o.s * o.q, o.s * o.q < 10 ? 1 : 0) + '′') : '')], [T.infoCons, o.c ? consName(o.c) : '–'],
          [T.infoCoord, raText(o.ra) + ' · ' + decText(o.dec)]);
        /* other designations (the same object in other catalogues): a row's field 10, a catalogue object's aka (tools/ngc-data.js) */
        var also = o.extra ? o.ids : (o.aka || []);
        if (also.length) out.facts.push([T.infoAlso, also.join(', ')]);
        var listId = o.extra ? inf.id : o.id, x = state.listRes && state.listRes.list.filter(function (y) { return y.o.id === listId; })[0]; /* list items of the further catalogues carry ngc:<row> */
        if (x) { out.facts.push([T.infoBest, T.infoTransitVal.replace('{t}', hhmm(x.best.t, state.off)).replace('{alt}', num(x.best.alt))]); out.pick = listId; }
        var wt = LANG === 'de' ? o.wde : o.wen;
        var wl = !wt && o.extra ? ngcWikiLink(LANG, o.row) : null;
        out.wiki = wt ? wikiUrl(LANG, wt) : wl ? wl.url : null;
        if (wl && wl.lang !== LANG) out.wikiLabel = T.infoWiki + ' (' + wl.lang.toUpperCase() + ')'; /* no article in the page's language */
      } else if (dbl) { /* a pair from the double star table (data/doubles.json), texts prepared by the planner */
        out.title = dbl.title;
        out.sub = T.infoDouble;
        out.wiki = dbl.wiki || null;
        var dq = appJ(dbl.ra, dbl.dec, msMid);
        out.altAt = function (sec) { return A.horizontalOf(dq.ra, dq.dec, sec * 1000, lat, lon); };
        out.facts.push([T.evHead.mags, dbl.mags], [T.evHead.sepPa, dbl.sepPa], [T.evHead.aperture, dbl.aperture], [T.infoWds, dbl.wds]);
        if (dbl.sp) out.facts.push([T.infoSpec, dbl.sp]);
        var pairTwins = rowTwins(dbl.ra, dbl.dec, dbl.wdsId);
        if (pairTwins.length) out.facts.push([T.infoAlso, pairTwins.join(', ')]);
        out.facts.push([T.infoCons, dbl.con ? consName(dbl.con) : '–'], [T.infoCoord, raText(dbl.ra) + ' · ' + decText(dbl.dec)]);
      } else if (inf.kind === 'body') {
        var id = inf.id;
        out.title = T.plNames[id];
        if (BODY_WIKI[id]) out.wiki = wikiUrl(LANG, BODY_WIKI[id][LANG === 'de' ? 0 : 1]);
        out.altAt = function (sec) { return A.bodyAt(id, sec, lat, lon); };
        /* a body's facts follow the slider (posAt, called by renderInfo() when the time changes): the moon moves half a
           degree an hour, so its constellation and coordinates at the night's middle were up to 3° off at the slider's time;
           lit share, distance and size go with them for the price of the same call */
        if (id === 'moon') {
          out.sub = T.infoMoonKind; out.level = -0.833;
          out.posAt = function (sec) {
            var ms = sec * 1000, mc = A.moonCoords(A.toDays(ms)), mj = toJ2000(mc.ra, mc.dec, precAngles(ms));
            return [[T.infoLit, Math.round(A.moonIllumination(ms).fraction * 100) + ' %'],
              [T.infoDist, T.infoKm.replace('{km}', (Math.round(mc.dist / 100) * 100).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB'))],
              [T.infoSize, num(2 * Math.atan(1737.4 / mc.dist) / RAD * 60, 1) + '′'], [T.infoCons, cons(mj.ra, mj.dec)], [T.infoCoord, raText(mj.ra) + ' · ' + decText(mj.dec)]];
          };
        } else {
          out.sub = T.infoPlanet;
          var pl = A.PLANETS.filter(function (x) { return x.id === id; })[0];
          out.posAt = function (sec) {
            var ms = sec * 1000, c = A.planetCoords(pl, ms), pj = toJ2000(c.ra, c.dec, precAngles(ms));
            var rows = [[T.infoMag, num(A.planetMagnitude(id, c), 1) + ' mag'],
              [T.infoDist, T.infoAu.replace('{au}', num(c.dist, 2)).replace('{min}', num(c.dist * 8.3167))],
              [T.infoSize, num(2 * Math.atan(PLANET_RADIUS[id] / (c.dist * 149597870.7)) / RAD * 3600, 1) + '″']];
            if (id === 'mercury' || id === 'venus' || id === 'mars') rows.push([T.infoLit, Math.round((1 + Math.cos(c.phase * RAD)) / 2 * 100) + ' %']);
            rows.push([T.infoCons, cons(pj.ra, pj.dec)], [T.infoCoord, raText(pj.ra) + ' · ' + decText(pj.dec)]);
            return rows;
          };
        }
      } else return null;
      /* the card's colour and symbol by kind: the deep-sky colours of the map, the planets' own, stars yellow, doubles orange */
      var grpInfo = o ? GROUP[o.t] : null;
      out.col = s ? '#f5d76e' : o ? (DSO_COL[grpInfo] || '#9fb3c4') : dbl ? '#ffb27a' : inf.id === 'moon' ? '#cfd8e2' : (BODY_COL[inf.id] || '#9fb3c4');
      out.icon = s ? '★' : o ? ({ galaxies: '◍', nebulae: '☁', clusters: '⁂', stars: '✦' }[grpInfo] || '◌') : dbl ? '⁑' : inf.id === 'moon' ? '☾' : '●';
      /* rise and set between sunset and sunrise, and the highest point while the sun is below −6° as in the visibility bars,
         else while it is down at all: the window runs an hour into the day on either side, which put Venus's "highest" into daylight */
      var f = function (sec) { return out.altAt(sec).alt; }, sunAt = function (sec) { return A.sunAltitude(sec * 1000, lat, lon); };
      var cr = A.crossings(f, win.start, win.end, 120, out.level).filter(function (c) { return sunAt(c.t) < -0.833; }), top = null, rows = [];
      for (var tt = win.start; tt <= win.end; tt += 300) rows.push({ t: tt, alt: f(tt), sun: sunAt(tt) });
      for (var li = 0, lims = [-6, -0.833]; li < lims.length && !top; li++) rows.forEach(function (x) { if (x.sun < lims[li] && (!top || x.alt > top.alt)) top = x; });
      /* for the card's altitude chart (drawInfoChart() in the planner): the fixed J2000 position or the moving body's
         altitude, the highest point in darkness with the moon's distance and lit share there, and for moon and planets
         the culmination as the peak of the samples (a parabola through the three around it) */
      out.thumb = o ? (o.extra ? ngcThumb(o.id) : 'img/dso/' + o.id.toLowerCase().replace(/\s+/g, '') + '.jpg') : '';
      out.chart = { fixed: s ? { ra: s.ra0, dec: s.dec0 } : o ? { ra: o.ra, dec: o.dec } : dbl ? { ra: dbl.ra, dec: dbl.dec } : null, altAt: function (sec) { return out.altAt(sec).alt; }, best: null, flip: null };
      if (top) {
        var mb = A.bodyAt('moon', top.t, lat, lon), tp = out.altAt(top.t), isMoon = inf.kind === 'body' && inf.id === 'moon';
        var cosSep = Math.sin(tp.alt * RAD) * Math.sin(mb.alt * RAD) + Math.cos(tp.alt * RAD) * Math.cos(mb.alt * RAD) * Math.cos((tp.az - mb.az) * RAD);
        out.chart.best = { t: top.t, alt: top.alt, sep: isMoon ? null : Math.acos(clamp(cosSep, -1, 1)) / RAD, illum: mb.illum };
      }
      for (var ri = 1; !out.chart.fixed && ri < rows.length - 1; ri++) {
        var a0 = rows[ri - 1].alt, a1 = rows[ri].alt, a2 = rows[ri + 1].alt, den = a0 - 2 * a1 + a2;
        if (a1 >= a0 && a1 > a2) { out.chart.flip = rows[ri].t + (den ? 150 * (a0 - a2) / den : 0); break; }
      }
      out.riseSet = cr.length ? cr.map(function (c) { return (c.rising ? T.moRise : T.moSet).replace('{t}', hhmm(c.t, state.off)); }).join(' · ') : f(mid) > out.level ? T.moAllNight : T.moNoNight;
      /* usable dark hours above 30° with the moonless share, as the list counts them; not for the moon itself */
      var lw = listWindow && !(inf.kind === 'body' && inf.id === 'moon') ? listWindow() : null;
      if (lw) {
        var uh = usableHours(f, function (sec) { return A.moonAltitude(sec * 1000, lat, lon); }, lw.from, lw.to);
        out.usable = (uh.hours < 0.05 ? T.infoUsableNone : (uh.moonless >= uh.hours - 0.01 ? T.infoUsableMoonless : uh.moonless < 0.05 ? T.infoUsableMoon : T.infoUsableSome)
          .replace('{h}', num(uh.hours, 1)).replace('{m}', num(uh.moonless, 1))) + (lw.astro ? '' : ' ' + T.infoUsableNaut);
      }
      out.transit = top && top.alt > 0 ? T.infoTransitVal.replace('{t}', hhmm(top.t, state.off)).replace('{alt}', num(top.alt)) : '–';
      return out;
    }
    /* The one selected object, shown in the card under the map with its altitude chart. A deep-sky object of this night's
       list is also the list's pick (red on the map, "✓" in the list); selecting anything else, or nothing, ends that pick. */
    function setInfo(inf, noDraw) {
      state.smInfo = inf;
      state.evTarget = null; /* a new selection, or none, ends an event's red ring */
      var listed = inf && inf.kind === 'dso' && state.listRes && state.listRes.list.some(function (y) { return y.o.id === inf.id; });
      var target = listed ? inf.id : null;
      if (target !== state.target) { state.target = target; if (onPickChange) onPickChange(); }
      if (!noDraw) drawSkyMap();
    }
    function renderInfo() {
      var box = el.smInfo, body = el.smInfoBody || box, inf = state.smInfo;
      if (!box) return;
      if (!inf || !state.plWin) { if (!box.hidden) { box.hidden = true; body.innerHTML = ''; } return; }
      var key = [inf.kind, inf.id || inf.idx, state.plWin.start, state.lat, state.lon, state.names, state.zone, state.listRes ? state.listRes.list.length : 0, state.ngcRaw ? 1 : 0].join('|');
      if (!infoCache || infoCache.key !== key) infoCache = { key: key, data: infoStatic(inf) };
      var d = infoCache.data;
      if (!d) { state.smInfo = null; box.hidden = true; return; }
      var now = d.altAt(state.plT), up = now.alt > -0.3, pos = now.alt > d.level ? T.moPosUp.replace('{alt}', num(Math.max(now.alt, 0))).replace('{dir}', T.compassLong[Math.round(now.az / 45) % 8]) : T.moPosDown;
      /* a body's facts at the slider's time, worked out again only when the time has changed (renderInfo() runs with every redraw) */
      if (d.posAt && infoCache.posT !== state.plT) { infoCache.posT = state.plT; infoCache.pos = d.posAt(state.plT); }
      var facts = [[T.moPos.replace('{t}', hhmm(state.plT, state.off)), pos], [T.moRiseSet, d.riseSet], [T.infoTransit, d.transit]].concat(d.usable ? [[T.infoUsable, d.usable]] : [], d.facts, d.posAt ? infoCache.pos : []);
      /* head with the subject's colour by kind (--op-kind, css/style.css .op-info), the facts as tiles like the night block */
      var html = '<div class="op-info-head">' +
        (d.thumb ? '<img class="op-info-thumb" src="' + esc(d.thumb) + '" width="64" height="64" alt="">' : '<span class="op-info-badge" aria-hidden="true">' + esc(d.icon || '•') + '</span>') +
        '<div style="flex:1; min-width:0;"><div class="op-info-kind">' + esc(d.sub) + '</div><div class="op-info-title">' + esc(d.title) + '</div></div>' +
        '<button type="button" class="op-info-close" data-info-close aria-label="' + esc(T.infoClose) + '">&times;</button></div>' +
        '<dl class="op-stats op-info-stats">' + facts.map(function (fct) { return '<div class="op-stat"><dt>' + esc(fct[0]) + '</dt><dd>' + esc(fct[1]) + '</dd></div>'; }).join('') + '</dl>' +
        (up || d.pick || d.wiki ? '<div class="op-info-actions">' +
          (up ? '<button type="button" class="op-tb-btn" data-info-center>' + esc(T.infoCenter) + '</button>' : '') +
          (d.pick ? '<button type="button" class="op-tb-btn" data-info-pick="' + esc(d.pick) + '">' + esc(T.infoBestTime) + '</button>' : '') +
          (d.wiki ? '<a href="' + esc(d.wiki) + '" target="_blank" rel="noopener" style="font-size:.82rem;">' + esc(d.wikiLabel || T.infoWiki) + '&nbsp;&#8599;</a>' : '') + '</div>' : '');
      box.style.setProperty('--op-kind', d.col || '#5ce1e6');
      if (box.hidden) box.hidden = false;
      if (body.innerHTML !== html) body.innerHTML = html;
      if (drawInfoChart) drawInfoChart(inf, d);
    }
    if (el.smInfo) {
      el.smInfo.addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest('[data-info-close]')) { setInfo(null); return; }
        if (t.closest('[data-info-center]')) { centerOnInfo(); return; }
        var p = t.closest('[data-info-pick]');
        if (p) showInMap(p.getAttribute('data-info-pick'));
      });
    }

    /* a colour between two #rrggbb colours */
    function mixColour(a, b, f) {
      function ch(hex, n) { return parseInt(hex.substr(1 + 2 * n, 2), 16); }
      return 'rgb(' + [0, 1, 2].map(function (n) { return Math.round(ch(a, n) + (ch(b, n) - ch(a, n)) * f); }).join(',') + ')';
    }

    /* a redraw at the next frame at most: dragging and pinching send more events than a slow screen can draw */
    var drawPending = false;
    function drawSoon() {
      if (drawPending) return;
      drawPending = true;
      requestAnimationFrame(function () { drawPending = false; drawSkyMap(); });
    }

    function turnSkyMap(az) {
      state.smAz = ((az % 360) + 360) % 360;
      drawSkyMap();
    }

    /* the deep-sky symbol under a pointer event, if any */
    function skyDsoAt(e) {
      var H = state.smHits, rect = el.smMap.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, best = null, bd = 1e9;
      ((H && H.dso) || []).forEach(function (o) { var q = Math.sqrt((o.x - x) * (o.x - x) + (o.y - y) * (o.y - y)); if (q < o.r + 10 && q < bd) { bd = q; best = o; } });
      return best;
    }

    /* Zoom by a factor about a point of the canvas (its middle without one), keeping the sky under that point in place.
       Back at the widest view the tilt returns to the default, with the horizon at the bottom. */
    function zoomSkyMap(factor, px, py) {
      var W = el.smMap.clientWidth || 600, H = el.smMap.clientHeight || 300, v0 = skyView(W, H, state.smAz);
      var fov = clamp(v0.fov / factor, skyFovMin(), v0.fovMax);
      if (Math.abs(fov - v0.fov) < 1e-6) return;
      if (px == null) { px = W / 2; py = H / 2; }
      var target = v0.unproj(px, py);
      if (fov >= v0.fovMax - 1e-6) { state.smFov = null; state.smCAlt = null; }
      else {
        if (state.smFov == null || state.smCAlt == null) state.smCAlt = v0.c0 / RAD;
        state.smFov = fov;
        /* the object picked in the list — or, without one, the marked target of a search or event row, else the card's
           subject — stays in the middle while above the horizon, whatever the zoom was started from; low down it can only
           go as far up as the horizon at the bottom edge allows (until September 2026 only the list pick was held, and
           the moon found by the search left the view after a few zoom steps) */
        var ho = !state.smLoose && zoomAnchor(state.plT * 1000);
        if (ho && ho.alt > 0) {
          state.smAz = ho.az;
          state.smCAlt = clamp(ho.alt, skyView(W, H, state.smAz).cMin / RAD, 90);
          px = null;
        }
        /* move the middle (azimuth, altitude) until the point under the pointer projects there again: Newton with a numerical
           Jacobian. Near the zenith that is only possible by turning the whole map (up is always the zenith; a point just
           beyond it needs the azimuth turned by 75–96°): where the solution misses by more than 2 px or would turn the map
           by more than 25°, the zoom goes about the middle instead, which neither jumps nor turns. */
        var azStart = state.smAz, caltStart = state.smCAlt, tgt = { alt: target.alt / RAD, az: target.az / RAD }, cMinD = skyProjection(W, H, state.smAz, fov, null, skyFovMin()).cMin / RAD;
        var projAt = function (az, calt) { return skyProjection(W, H, az, fov, calt, skyFovMin()).proj(tgt); };
        for (var i = 0; px != null && i < 8; i++) {
          var q = projAt(state.smAz, state.smCAlt);
          if (!q) break;
          var ex = q.x - px, ey = q.y - py;
          if (ex * ex + ey * ey < 0.04) break;
          var hd = 0.01, sa = state.smCAlt + hd > 90 ? -hd : hd, qa = projAt(state.smAz + hd, state.smCAlt), qc = projAt(state.smAz, state.smCAlt + sa);
          if (!qa || !qc) break;
          var j11 = (qa.x - q.x) / hd, j21 = (qa.y - q.y) / hd, j12 = (qc.x - q.x) / sa, j22 = (qc.y - q.y) / sa, det = j11 * j22 - j12 * j21;
          if (Math.abs(det) < 1e-9) break;
          state.smAz = ((state.smAz + clamp(-(j22 * ex - j12 * ey) / det, -30, 30)) % 360 + 360) % 360;
          state.smCAlt = clamp(state.smCAlt + clamp(-(j11 * ey - j21 * ex) / det, -30, 30), cMinD, 90);
        }
        if (px != null) {
          var qEnd = projAt(state.smAz, state.smCAlt), turn = Math.abs(((state.smAz - azStart) % 360 + 540) % 360 - 180) * Math.sin(state.smCAlt * RAD);
          if (!qEnd || Math.hypot(qEnd.x - px, qEnd.y - py) > 2 || turn > 25) { state.smAz = azStart; state.smCAlt = caltStart; }
        }
      }
      state.smHover = null; /* the highlight belonged to what was under the pointer before */
      skyTouch();
      drawSoon();
    }

    /* what zoom steps keep in the middle: refracted altitude and azimuth of the list pick, else of the marked target
       (state.evTarget: a body, or a fixed J2000 position), else of the card's subject; null without any */
    function zoomAnchor(ms) {
      function hor(ra, dec) { var h = A.horizontalOf(ra, dec, ms, state.lat, state.lon); h.alt = A.refract(h.alt); return h; }
      var obj = targetObject(), evt = state.evTarget, p;
      if (obj) { p = appJ(obj.ra, obj.dec, ms); return hor(p.ra, p.dec); }
      if (evt) { if (evt.body) return bodyHor(evt.body, ms); p = appJ(evt.ra, evt.dec, ms); return hor(p.ra, p.dec); }
      return infoSkyPos(state.smInfo, ms, hor);
    }

    /* the whole view lets vertical swipes scroll the page; zoomed in, a swipe pans the map instead */
    function skyTouch() { if (el.smMap) el.smMap.style.touchAction = state.smFov == null ? 'pan-y' : 'none'; }

    /* turn the star map towards a direction; zoomed in, it is also raised or lowered to it */
    function aimSkyMap(az, alt) {
      state.smLoose = false; /* zoom steps follow a list pick again */
      state.smAz = ((az % 360) + 360) % 360;
      if (state.smFov != null && alt != null) state.smCAlt = alt;
    }

    /* What a tap hits, in this order: the moon or a planet, the middle of a deep-sky symbol, a star within 12 px, anywhere
       inside a deep-sky symbol */
    function skyHitAt(e) {
      var H = state.smHits;
      if (!H) return null;
      var rect = el.smMap.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, best = null, bd = 1e9;
      function d2(p) { return (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); }
      (H.bodies || []).forEach(function (b) { var d = d2(b); if (d < (b.r + 10) * (b.r + 10) && d < bd) { bd = d; best = { kind: 'body', id: b.id }; } });
      if (best) return best;
      (H.dso || []).forEach(function (o) { var d = d2(o); if (d < 196 && d < bd) { bd = d; best = { kind: 'dso', id: o.id }; } });
      if (best) return best;
      /* among stars within 16 px the bright ones win: every magnitude brighter counts like 2 px closer */
      bd = 1e9;
      (H.all || []).forEach(function (p) {
        var d = d2(p);
        if (d > 256) return;
        var score = Math.sqrt(d) + 2 * p.s.mag;
        if (score < bd) { bd = score; best = { kind: 'star', idx: p.s.idx }; }
      });
      if (best) return best;
      var o = skyDsoAt(e);
      return o ? { kind: 'dso', id: o.id } : null;
    }

    /* the constellation (and bright star) nearest to the pointer is highlighted and named */
    function skyMapPointer(e) {
      var H = state.smHits;
      if (!H) return;
      var rect = el.smMap.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      function nearest(list, maxD) {
        var best = null, bd = maxD * maxD;
        list.forEach(function (p) { var d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < bd) { bd = d; best = p; } });
        return best;
      }
      var v = nearest(H.verts, 24), s = nearest(H.stars, 12), d = skyDsoAt(e), cur = state.smHover;
      var next = v || s || d ? { con: v ? v.id : null, star: s ? s.name : null, dso: d ? d.name : null } : null;
      function key(h) { return h ? h.con + '|' + h.star + '|' + h.dso : ''; }
      if (key(next) !== key(cur)) { state.smHover = next; drawSoon(); }
    }

    /* Drag to turn the star map (and, zoomed in, to raise or lower it); two fingers pinch to zoom. A tap without movement
       opens the card of the star, planet or deep-sky object under it, or else highlights like a mouse hover. */
    var smDrag = null, smTouches = {};
    function skyPinch() {
      var ids = Object.keys(smTouches);
      if (ids.length !== 2) return null;
      var a = smTouches[ids[0]], b = smTouches[ids[1]];
      return { d: Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    el.smMap.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') smTouches[e.pointerId] = { x: e.clientX, y: e.clientY };
      var two = skyPinch();
      if (two) { smDrag = { pinch: two.d }; return; }
      smDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, az: state.smAz, alt: state.smCAlt, moved: false };
      try { el.smMap.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    });
    el.smMap.addEventListener('pointermove', function (e) {
      if (smTouches[e.pointerId]) smTouches[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (smDrag && smDrag.pinch) {
        var two = skyPinch(), rect = el.smMap.getBoundingClientRect();
        if (two && two.d > 0) { zoomSkyMap(two.d / smDrag.pinch, two.x - rect.left, two.y - rect.top); smDrag.pinch = two.d; }
        return;
      }
      if (smDrag && smDrag.id === e.pointerId) {
        var dx = e.clientX - smDrag.x, dy = e.clientY - smDrag.y, zoomed = state.smFov != null;
        if (Math.abs(dx) > 4 || (zoomed && Math.abs(dy) > 4)) smDrag.moved = true;
        if (smDrag.moved && state.smK) {
          state.smHover = null; el.smMap.style.cursor = 'grabbing';
          state.smAz = (((smDrag.az - dx / state.smK / RAD) % 360) + 360) % 360;
          if (zoomed && smDrag.alt != null && state.smKv) state.smCAlt = clamp(smDrag.alt + dy / state.smKv / RAD, state.smCMin, 90);
          drawSoon();
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        skyMapPointer(e);
        el.smMap.style.cursor = skyHitAt(e) ? 'pointer' : 'grab';
      }
    });
    function endSkyDrag(e) {
      delete smTouches[e.pointerId];
      if (smDrag && smDrag.pinch) { if (!skyPinch()) smDrag = null; return; }
      if (!smDrag || smDrag.id !== e.pointerId) return;
      var tap = !smDrag.moved && e.type === 'pointerup';
      smDrag = null;
      el.smMap.style.cursor = 'grab';
      if (!tap) return;
      var hit = skyHitAt(e);
      if (hit) { state.smHover = null; setInfo(hit); return; }
      if (state.smInfo) setInfo(null);
      skyMapPointer(e);
    }
    el.smMap.addEventListener('pointerup', endSkyDrag);
    el.smMap.addEventListener('pointercancel', endSkyDrag); /* also when a touch turns into page scrolling */
    /* a tap keeps its highlight; only a mouse leaving the map clears it */
    el.smMap.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !smDrag && state.smHover) { state.smHover = null; drawSkyMap(); } });
    /* Ctrl/⌘ + wheel zooms (a trackpad pinch arrives the same way); the plain wheel keeps scrolling the page */
    el.smMap.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var rect = el.smMap.getBoundingClientRect(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomSkyMap(clamp(Math.exp(-dy * 0.01), 0.7, 1.4), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    el.smMap.addEventListener('dblclick', function (e) {
      var rect = el.smMap.getBoundingClientRect();
      zoomSkyMap(e.shiftKey ? 0.5 : 2, e.clientX - rect.left, e.clientY - rect.top);
    });
    el.smMap.addEventListener('keydown', function (e) {
      var step = state.smFov != null ? clamp(state.smFov / 8, 1, 5) : 5;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); turnSkyMap(state.smAz + (e.key === 'ArrowLeft' ? -step : step)); }
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && state.smFov != null) {
        e.preventDefault();
        state.smCAlt = clamp((state.smCAlt == null ? state.smCMin : state.smCAlt) + (e.key === 'ArrowUp' ? step : -step), state.smCMin, 90);
        drawSkyMap();
      }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomSkyMap(1.5); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomSkyMap(1 / 1.5); }
    });
    el.smLeft.addEventListener('click', function () { turnSkyMap(Math.ceil(state.smAz / 45 - 1) * 45); });
    el.smRight.addEventListener('click', function () { turnSkyMap(Math.floor(state.smAz / 45 + 1) * 45); });
    if (el.smZoomIn) {
      el.smZoomIn.addEventListener('click', function () { zoomSkyMap(1.5); });
      el.smZoomOut.addEventListener('click', function () { zoomSkyMap(1 / 1.5); });
    }
    if (el.smPhotos) el.smPhotos.addEventListener('change', function () { state.photos = el.smPhotos.checked; syncUrl(); drawSkyMap(); });
    /* grid and boundaries: off at first, not kept anywhere */
    state.smGrid = !!(el.smGrid && el.smGrid.checked); state.smBounds = !!(el.smBounds && el.smBounds.checked);
    if (el.smGrid) el.smGrid.addEventListener('change', function () { state.smGrid = el.smGrid.checked; drawSkyMap(); });
    if (el.smBounds) el.smBounds.addEventListener('change', function () { state.smBounds = el.smBounds.checked; drawSkyMap(); });
    if (el.smSurvey) el.smSurvey.addEventListener('change', function () { state.survey = el.smSurvey.value; syncUrl(); drawSkyMap(); });

    /* Centre the view on an apparent altitude and azimuth at a width; zoom steps then keep this view rather than jumping
       back to an object picked in the list */
    function centerSky(az, alt, fov) {
      var W = el.smMap.clientWidth || 600, H = el.smMap.clientHeight || 300;
      state.smFov = clamp(fov, skyFovMin(), skyView(W, H, az).fovMax * 0.98);
      state.smAz = ((az % 360) + 360) % 360;
      state.smCAlt = clamp(alt, skyView(W, H, state.smAz).cMin / RAD, 90);
      state.smLoose = true;
      state.smHover = null;
      skyTouch();
      drawSkyMap();
    }
    /* "Centre" in the info card: the card's subject to the middle, zooming in one step from the whole view */
    function centerOnInfo() {
      var ms = state.plT * 1000, p = infoSkyPos(state.smInfo, ms, function (ra, dec) { var h = A.horizontalOf(ra, dec, ms, state.lat, state.lon); h.alt = A.refract(h.alt); return h; });
      if (!p) return;
      var v = skyView(el.smMap.clientWidth || 600, el.smMap.clientHeight || 300, state.smAz);
      centerSky(p.az, p.alt, state.smFov != null ? v.fov : v.fovMax / 2);
    }

    /* ------------------------------------------------------------------ *
     * Search (#op-sm-search): the catalogue with OpenNGC's other designations of its objects, OpenNGC, stars with a name
     * or Bayer letter, moon and planets, constellations. The choice opens its card, is ringed in red and the map turns to it
     * without changing the width, like the table buttons;
     * below the horizon at the slider's time, the time moves to its highest point of the night.
     * ------------------------------------------------------------------ */
    var searchIdx = null, searchHits = [], searchActive = -1;
    /* German spellings the star data does not carry (German Wikipedia), for the search only: the map keeps its labels */
    var STAR_SPELLING = { Vega: 'Wega', Castor: 'Kastor' };
    function searchIndex() {
      var key = state.names + '|' + (state.ngcRaw ? 1 : 0);
      if (searchIdx && searchIdx.key === key) return searchIdx.list;
      var list = [], aliasOf = {}, al = state.ngcAliases || {};
      function add(names, label, sub, go, rank) {
        var keys = [], keyName = [];
        names.filter(Boolean).forEach(function (n) { searchKeys(n).forEach(function (k) { keys.push(k); keyName.push(n); }); });
        list.push({ keys: keys, keyName: keyName, label: label, sub: sub, go: go, rank: rank });
      }
      Object.keys(al).forEach(function (n) { (aliasOf[al[n]] = aliasOf[al[n]] || []).push(n); });
      BODIES.forEach(function (id, i) { add([T.plNames[id], id], T.plNames[id], id === 'moon' ? T.infoMoonKind : T.infoPlanet, { kind: 'body', id: id }, i); });
      SKY.stars.forEach(function (st, i) {
        if (!st[5] && !st[6]) return;
        var ab = st[6] ? constellationAt(skyBounds(), st[0], st[1]) : null, bayer = st[6] && ab ? st[6] + ' ' + ab : '';
        var name = st[5] ? (state.names === 'local' && LANG === 'de' ? st[4] : st[5]) : bayer;
        if (!name) return;
        add([st[4], st[5], STAR_SPELLING[st[5]], bayer], name, T.infoStar + (st[5] && bayer ? ' · ' + bayer : ''), { kind: 'star', idx: i }, 5 + st[2]);
      });
      SKY.labels.forEach(function (l) { add([l[0], l[4], l[5], l[6]], consName(l[0]), T.findCons, { kind: 'cons', ra: l[1], dec: l[2] }, 9); });
      CATALOG.forEach(function (o) {
        var nm = o[LANG], more = (o.aka || []).concat((aliasOf[o.id] || []).filter(function (a) { return (o.aka || []).indexOf(a) < 0; }));
        add([o.id, o.de, o.en].concat(more), o.id + (nm ? ' · ' + nm : ''), T.types[o.t] + (more.length ? ' · ' + more.slice(0, 4).join(', ') : ''), { kind: 'dso', id: o.id }, 10 + o.m);
      });
      (state.ngcRaw || []).forEach(function (r0, i) {
        var ids = r0[9] || [];
        /* also the designation written out as Wikipedia does (Cl399 → Collinder 399, M 40 → Messier 40) */
        add([r0[0], r0[8], ngcWikiQuery(r0[0])].concat(ids), r0[0] + (r0[8] ? ' · ' + r0[8] : ''), T.types[r0[3]] + ' · ' + (/^Sh2-/.test(r0[0]) ? 'Sharpless' : 'OpenNGC') + (ids.length ? ' · ' + ids.slice(0, 4).join(', ') : ''), { kind: 'dso', id: 'ngc:' + i }, 30 + (r0[7] == null ? 15 : r0[7]));
      });
      searchIdx = { key: key, list: list };
      return list;
    }
    /* how well an entry matches and through which of its names — the longest of the equally good ones, so a constellation
       shows Antlia rather than Ant (typing "An" finds Antlia, which the German page lists as Luftpumpe) */
    function searchMatch(q, e) {
      var best = 9, name = e.label;
      for (var i = 0; i < e.keys.length; i++) {
        var sc = searchScore(q, [e.keys[i]]), n = e.keyName[i];
        if (sc < best || (sc === best && n.length > name.length)) { best = sc; name = n; }
      }
      return { s: best, name: name };
    }
    /* the matched name for the hint, when neither the label nor the hint already shows it */
    function extraName(e, name) {
      var key = searchKey(name);
      return key && searchKey(e.label).indexOf(key) < 0 && searchKey(e.sub || '').indexOf(key) < 0 ? name : '';
    }
    function searchRender() {
      var q = searchKey(el.smSearch.value), ul = el.smSearchList;
      el.smSearchNote.hidden = true;
      if (q) loadNgc(); /* also when typing starts without a focus event (autofill, pasted text) */
      /* twelve hits: equal before start before inside (searchScore), then the matched names in natural order — M5 before
         M50 before M51, Ancha before Andromeda — as a reader completes what they typed; brightness only breaks a tie */
      var found = !q ? [] : searchIndex().map(function (e) { var m = searchMatch(q, e); return { e: e, s: m.s, name: m.name }; })
        .filter(function (x) { return x.s < 9; })
        .sort(function (a, b) { return a.s - b.s || naturalCompare(a.name, b.name) || a.e.rank - b.e.rank; }).slice(0, 12);
      searchHits = found.map(function (x) { return x.e; });
      searchActive = searchHits.length ? 0 : -1;
      ul.innerHTML = found.map(function (x, i) {
        var alias = extraName(x.e, x.name), sub = x.e.sub + (alias ? ' · ' + alias : '');
        return '<li role="option" id="op-sm-search-' + i + '" data-i="' + i + '"><span class="op-search-name">' + esc(x.e.label) + '</span> <small>' + esc(sub) + '</small></li>';
      }).join('') || (q ? '<li role="option" aria-disabled="true"><small>' + esc(state.ngcState === 'loading' ? T.findLoading : T.findNone) + '</small></li>' : '');
      ul.hidden = !q;
      el.smSearch.setAttribute('aria-expanded', String(!ul.hidden));
      searchMark();
    }
    function searchMark() {
      Array.prototype.forEach.call(el.smSearchList.children, function (li, i) { li.setAttribute('aria-selected', String(i === searchActive && !!searchHits[i])); });
      if (searchActive >= 0) el.smSearch.setAttribute('aria-activedescendant', 'op-sm-search-' + searchActive); else el.smSearch.removeAttribute('aria-activedescendant');
    }
    function searchClose() {
      if (!el.smSearchList) return;
      el.smSearchList.hidden = true;
      el.smSearch.setAttribute('aria-expanded', 'false');
      el.smSearch.removeAttribute('aria-activedescendant');
    }
    function searchGo(e) {
      if (!e || !state.plWin || !state.smData) return;
      searchClose();
      el.smSearch.value = e.label;
      var g = e.go, win = state.plWin, lat = state.lat, lon = state.lon, msMid = (win.start + win.end) / 2 * 1000, at, rd, mark = null;
      if (g.kind === 'body') {
        at = function (sec) { return bodyHor(g.id, sec * 1000); };
        mark = { body: g.id, label: e.label };
      } else {
        if (g.kind === 'star') { var st = state.smData.byIdx[g.idx]; if (!st) return; rd = { ra: st.ra, dec: st.dec }; mark = { ra: st.ra0, dec: st.dec0, label: e.label }; }
        else if (g.kind === 'cons') rd = appJ(g.ra, g.dec, msMid); /* a constellation is only turned to, not ringed */
        else { var o = infoDso({ kind: 'dso', id: g.id }); if (!o) return; rd = appJ(o.ra, o.dec, msMid); mark = { ra: o.ra, dec: o.dec, label: e.label }; }
        at = function (sec) { var h = A.horizontalOf(rd.ra, rd.dec, sec * 1000, lat, lon); return { alt: A.refract(h.alt), az: h.az }; };
      }
      var now = at(state.plT), note = '';
      if (now.alt < 1) {
        /* the highest point while the sun is below −12°, else below −6°, else at any time between sunset and sunrise */
        var top = null, samples = [], lightOnly = false;
        for (var tt = win.start; tt <= win.end; tt += 300) samples.push({ t: tt, alt: at(tt).alt, sun: A.sunAltitude(tt * 1000, lat, lon) });
        [-12, -6, 90].some(function (lim) {
          samples.forEach(function (x) { if (x.sun < lim && x.alt >= 1 && (!top || x.alt > top.alt)) top = x; });
          if (top) lightOnly = lim === 90;
          return !!top;
        });
        if (top) { setTime(top.t); now = at(state.plT); note = (lightOnly ? T.findMovedLight : T.findMoved).replace('{t}', hhmm(state.plT, state.off)).replace('{alt}', num(top.alt)); }
        else note = T.findNever;
      }
      setInfo(g.kind === 'cons' ? null : g.kind === 'star' ? { kind: 'star', idx: g.idx } : { kind: g.kind, id: g.id }, true);
      /* marked and turned to like the table buttons do it: a red ring (a deep-sky object of this night's list already is the
         red list pick), the map turned to it and, zoomed in, raised to it — the width stays as it is */
      state.evTarget = mark && !(g.kind === 'dso' && state.target === g.id) ? mark : null;
      el.smSearchNote.textContent = note;
      el.smSearchNote.hidden = !note;
      aimSkyMap(now.az, now.alt); /* also below the horizon: the map looks that way, and drawSkyMap() says it is not up */
      drawSkyMap();
    }
    if (el.smSearch && el.smSearchList && el.smSearchNote) {
      el.smSearch.addEventListener('input', searchRender);
      el.smSearch.addEventListener('focus', function () { loadNgc(); if (el.smSearch.value) searchRender(); });
      if (el.smCatBtn && el.smCat) el.smCatBtn.addEventListener('click', function () {
        var open = el.smCat.hidden;
        el.smCat.hidden = !open;
        el.smCatBtn.setAttribute('aria-expanded', String(open));
        if (open) { loadNgc(); renderCatalogInfo(); }
      });
      el.smSearch.addEventListener('keydown', function (e) {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') && el.smSearchList.hidden) {
          if (el.smSearch.value) { e.preventDefault(); searchRender(); } /* a closed list opens again rather than acting on old hits */
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!searchHits.length) return;
          e.preventDefault();
          searchActive = (searchActive + (e.key === 'ArrowDown' ? 1 : -1) + searchHits.length) % searchHits.length;
          searchMark();
          var li = el.smSearchList.children[searchActive];
          if (li) li.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (searchHits[searchActive]) { searchGo(searchHits[searchActive]); el.smSearch.blur(); }
        } else if (e.key === 'Escape' && !el.smSearchList.hidden) {
          e.preventDefault(); e.stopPropagation(); /* closes the list, not the full screen */
          searchClose();
        }
      });
      el.smSearch.addEventListener('blur', function () { setTimeout(searchClose, 150); });
      el.smSearchList.addEventListener('mousedown', function (e) { e.preventDefault(); }); /* the box keeps the focus */
      el.smSearchList.addEventListener('click', function (e) {
        var li = e.target.closest('[data-i]');
        if (li) { searchGo(searchHits[+li.getAttribute('data-i')]); el.smSearch.blur(); }
      });
    }

    /* Red light (#op-sm-red on the map's control pill, red=1 in the link): html.op-red in css/style.css darkens the page and
       turns it red with two blend layers (see there) */
    function applyRed() {
      document.documentElement.classList.toggle('op-red', !!state.red);
      if (el.smRed) el.smRed.setAttribute('aria-pressed', String(!!state.red));
    }
    if (el.smRed) el.smRed.addEventListener('click', function () { state.red = !state.red; applyRed(); syncUrl(); });

    /* The view (direction, altitude, width) goes into the link once it has rested for 400 ms: history.replaceState on every
       frame of a drag would be slow, and browsers throttle it */
    var viewKey = null, viewTimer = 0;
    function viewToUrl() {
      var key = [state.smAz, state.smFov, state.smCAlt].join('|');
      if (key === viewKey) return;
      viewKey = key; /* also after the first draw: the link may have been written before a view from it was applied */
      clearTimeout(viewTimer);
      viewTimer = setTimeout(syncUrl, 400);
    }

    /* Full screen for the map with its card, slider and controls (#op-sm-wrap): the Fullscreen API where there is one,
       and a fixed overlay in any case, which is all an iPhone gets. Esc, the button or leaving full screen ends it. */
    /* the canvas height that fills the screen: the visible children of the wrapper measured without the canvas (the
       wrapper's own scrollHeight is no use, as a fixed box it is at least the screen high) */
    function fullHeight() {
      var w = el.smWrap, cs = getComputedStyle(w), top = Infinity, bottom = -Infinity;
      Array.prototype.forEach.call(w.children, function (c) {
        var r = c.getBoundingClientRect();
        if (r.height) { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom + (parseFloat(getComputedStyle(c).marginBottom) || 0)); }
      });
      var rest = bottom > top ? bottom - top - el.smMap.offsetHeight : 0;
      return Math.max(260, Math.floor(window.innerHeight - rest - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - 2));
    }
    /* the full screen button is an icon on the map (css/style.css .op-map-ctrl); its words go to aria-label and title */
    var FS_ENTER = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', FS_EXIT = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function setFull(on) {
      if (!el.smWrap || !!state.smFull === on) return;
      state.smFull = on;
      if (on) {
        el.smWrap.classList.add('op-sm-full'); /* css/style.css: fixed over the screen, the info card over the map */
        document.documentElement.style.overflow = 'hidden';
        if (el.smWrap.requestFullscreen && !document.fullscreenElement) el.smWrap.requestFullscreen().catch(function () { /* the overlay stays */ });
      } else {
        el.smWrap.classList.remove('op-sm-full');
        document.documentElement.style.overflow = '';
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* already left */ });
      }
      if (el.smFull) {
        var fsLabel = (on ? T.smFullOff : T.smFullOn).replace(/^\S+\s+/, ''); /* the texts start with their symbol */
        el.smFull.innerHTML = on ? FS_EXIT : FS_ENTER; el.smFull.setAttribute('aria-label', fsLabel); el.smFull.title = fsLabel; el.smFull.setAttribute('aria-pressed', String(on));
      }
      window.dispatchEvent(new Event('resize')); /* bars, slider and lists follow the new width */
      drawSkyMap();
    }
    if (el.smFull) el.smFull.addEventListener('click', function () { setFull(!state.smFull); });
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && state.smFull) setFull(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.smFull) setFull(false); });

    return { aimSkyMap: aimSkyMap, drawSkyMap: drawSkyMap, PHOTO_AUTO: PHOTO_AUTO, PHOTO_FOV: PHOTO_FOV,
      prepareSky: prepareSky, skyTouch: skyTouch, setInfo: setInfo, loadNgc: loadNgc };
  }

  window.SvSkyMap = {
    create: create,
    hpxPix: hpxPix, hpxXYF: hpxXYF, hpxLoc: hpxLoc, hpxInterleave: hpxInterleave,
    precAngles: precAngles, precessRig: precessRig, toJ2000: toJ2000, skyProjection: skyProjection,
    boundsB1875: boundsB1875, constellationAt: constellationAt, moved: moved, skyYears: skyYears,
    posAngle: posAngle, planetAxis: planetAxis, galileanMoons: galileanMoons, moonLibration: moonLibration, searchKey: searchKey, searchKeys: searchKeys, searchScore: searchScore, naturalCompare: naturalCompare,
    apparentAt: apparentAt, wikiUrl: wikiUrl, starWikiQuery: starWikiQuery, ngcWikiQuery: ngcWikiQuery, ngcWikiLink: ngcWikiLink, ngcThumb: ngcThumb, ngcThumbL: ngcThumbL, catalogCounts: catalogCounts, imagingCandidate: imagingCandidate, rigFraming: rigFraming, usableHours: usableHours, RIG: RIG, BODY_WIKI: BODY_WIKI, WIKI_GENITIVE: WIKI_GENITIVE, WIKI_GREEK: WIKI_GREEK
  };
})();
