/*
 * Sky events for the observing planner (astro-tools/js/observing-planner.js), computed in the browser:
 *   - satellite passes from TLEs with SGP4, near-Earth branch (orbital period under 225 minutes), after Vallado,
 *     Crawford, Hujsak & Kelso 2006, "Revisiting Spacetrack Report #3" (AIAA 2006-6753), WGS-72 constants;
 *     checked against the verification cases published with that paper
 *   - look angles, the Earth's shadow and an estimated magnitude for a pass
 *   - the major meteor showers, close encounters of moon, planets and bright stars, and comets of a night
 * Data (TLEs, comet elements) come from astro-tools/data/sky-events.json, written by astro-tools/tools/sky-events-data.js.
 * Exposed as window.SvSkyEvents; needs astro-tools/js/astro-core.js for the sun only (satellite visibility).
 */
(function () {
  'use strict';

  var TWO_PI = 2 * Math.PI, DEG = Math.PI / 180;
  /* WGS-72, the constants the TLEs are fitted with */
  var RE = 6378.135, MU = 398600.8, XKE = 60 / Math.sqrt(RE * RE * RE / MU), J2 = 0.001082616, J3 = -0.00000253881, J4 = -0.00000165597;
  var J3OJ2 = J3 / J2, X2O3 = 2 / 3;

  /* ------------------------------------------------------------------ *
   * TLE and SGP4                                                       *
   * ------------------------------------------------------------------ */
  /* TLE numbers with an implied decimal point and exponent, e.g. " 28098-4" = 0.28098e-4 */
  function tleExp(s) {
    s = s.trim();
    if (!s) return 0;
    var sign = 1;
    if (s[0] === '-' || s[0] === '+') { sign = s[0] === '-' ? -1 : 1; s = s.slice(1); }
    var m = s.match(/^(\d+)([-+]\d)$/);
    return m ? sign * parseFloat('0.' + m[1]) * Math.pow(10, +m[2]) : sign * parseFloat('0.' + s);
  }

  function parseTle(line1, line2) {
    var yy = +line1.substring(18, 20), year = yy < 57 ? 2000 + yy : 1900 + yy;
    return {
      id: line1.substring(2, 7).trim(),
      epochMs: Date.UTC(year, 0, 1) + (parseFloat(line1.substring(20, 32)) - 1) * 86400000,
      bstar: tleExp(line1.substring(53, 61)),
      inclo: parseFloat(line2.substring(8, 16)) * DEG,
      nodeo: parseFloat(line2.substring(17, 25)) * DEG,
      ecco: parseFloat('0.' + line2.substring(26, 33).trim()),
      argpo: parseFloat(line2.substring(34, 42)) * DEG,
      mo: parseFloat(line2.substring(43, 51)) * DEG,
      no: parseFloat(line2.substring(52, 63)) * TWO_PI / 1440 /* rev/day → rad/min */
    };
  }

  /* initialisation (sgp4init with initl), near-Earth only; returns null for deep-space orbits */
  function sgp4init(tle) {
    var s = { bstar: tle.bstar, ecco: tle.ecco, argpo: tle.argpo, inclo: tle.inclo, mo: tle.mo, nodeo: tle.nodeo, epochMs: tle.epochMs };
    var eccsq = s.ecco * s.ecco, omeosq = 1 - eccsq, rteosq = Math.sqrt(omeosq), cosio = Math.cos(s.inclo), cosio2 = cosio * cosio;
    var ak = Math.pow(XKE / tle.no, X2O3), d1 = 0.75 * J2 * (3 * cosio2 - 1) / (rteosq * omeosq), del = d1 / (ak * ak);
    var adel = ak * (1 - del * del - del * (1 / 3 + 134 * del * del / 81));
    del = d1 / (adel * adel);
    s.no_unkozai = tle.no / (1 + del);
    if (TWO_PI / s.no_unkozai >= 225) return null; /* deep space: not needed for the stations and Hubble */
    var ao = Math.pow(XKE / s.no_unkozai, X2O3), sinio = Math.sin(s.inclo), po = ao * omeosq, con42 = 1 - 5 * cosio2;
    s.con41 = -con42 - cosio2 - cosio2;
    var posq = po * po, rp = ao * (1 - s.ecco);
    var ss = 78 / RE + 1, qzms2t = Math.pow((120 - 78) / RE, 4);
    s.isimp = rp < 220 / RE + 1 ? 1 : 0;
    var sfour = ss, qzms24 = qzms2t, perige = (rp - 1) * RE;
    if (perige < 156) {
      sfour = perige - 78;
      if (perige < 98) sfour = 20;
      qzms24 = Math.pow((120 - sfour) / RE, 4);
      sfour = sfour / RE + 1;
    }
    var pinvsq = 1 / posq, tsi = 1 / (ao - sfour);
    s.eta = ao * s.ecco * tsi;
    var etasq = s.eta * s.eta, eeta = s.ecco * s.eta, psisq = Math.abs(1 - etasq);
    var coef = qzms24 * Math.pow(tsi, 4), coef1 = coef / Math.pow(psisq, 3.5);
    var cc2 = coef1 * s.no_unkozai * (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) + 0.375 * J2 * tsi / psisq * s.con41 * (8 + 3 * etasq * (8 + etasq)));
    s.cc1 = s.bstar * cc2;
    var cc3 = s.ecco > 1e-4 ? -2 * coef * tsi * J3OJ2 * s.no_unkozai * sinio / s.ecco : 0;
    s.x1mth2 = 1 - cosio2;
    s.cc4 = 2 * s.no_unkozai * coef1 * ao * omeosq * (s.eta * (2 + 0.5 * etasq) + s.ecco * (0.5 + 2 * etasq) - J2 * tsi / (ao * psisq) *
      (-3 * s.con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) + 0.75 * s.x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * s.argpo)));
    s.cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
    var cosio4 = cosio2 * cosio2, temp1 = 1.5 * J2 * pinvsq * s.no_unkozai, temp2 = 0.5 * temp1 * J2 * pinvsq, temp3 = -0.46875 * J4 * pinvsq * pinvsq * s.no_unkozai;
    s.mdot = s.no_unkozai + 0.5 * temp1 * rteosq * s.con41 + 0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
    s.argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) + temp3 * (3 - 36 * cosio2 + 49 * cosio4);
    var xhdot1 = -temp1 * cosio;
    s.nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
    s.omgcof = s.bstar * cc3 * Math.cos(s.argpo);
    s.xmcof = s.ecco > 1e-4 ? -X2O3 * coef * s.bstar / eeta : 0;
    s.nodecf = 3.5 * omeosq * xhdot1 * s.cc1;
    s.t2cof = 1.5 * s.cc1;
    s.xlcof = -0.25 * J3OJ2 * sinio * (3 + 5 * cosio) / (Math.abs(cosio + 1) > 1.5e-12 ? 1 + cosio : 1.5e-12);
    s.aycof = -0.5 * J3OJ2 * sinio;
    var delmotemp = 1 + s.eta * Math.cos(s.mo);
    s.delmo = delmotemp * delmotemp * delmotemp;
    s.sinmao = Math.sin(s.mo);
    s.x7thm1 = 7 * cosio2 - 1;
    if (s.isimp !== 1) {
      var cc1sq = s.cc1 * s.cc1;
      s.d2 = 4 * ao * tsi * cc1sq;
      var temp = s.d2 * tsi * s.cc1 / 3;
      s.d3 = (17 * ao + sfour) * temp;
      s.d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * s.cc1;
      s.t3cof = s.d2 + 2 * cc1sq;
      s.t4cof = 0.25 * (3 * s.d3 + s.cc1 * (12 * s.d2 + 10 * cc1sq));
      s.t5cof = 0.2 * (3 * s.d4 + 12 * s.cc1 * s.d3 + 6 * s.d2 * s.d2 + 15 * cc1sq * (2 * s.d2 + cc1sq));
    }
    return s;
  }

  /* position (km) and velocity (km/s) in the TEME frame, minutes after the TLE epoch; null once the orbit is invalid */
  function sgp4(s, t) {
    var xmdf = s.mo + s.mdot * t, argpdf = s.argpo + s.argpdot * t, nodedf = s.nodeo + s.nodedot * t;
    var argpm = argpdf, mm = xmdf, t2 = t * t, nodem = nodedf + s.nodecf * t2;
    var tempa = 1 - s.cc1 * t, tempe = s.bstar * s.cc4 * t, templ = s.t2cof * t2;
    if (s.isimp !== 1) {
      var delomg = s.omgcof * t, delmtemp = 1 + s.eta * Math.cos(xmdf);
      var delm = s.xmcof * (delmtemp * delmtemp * delmtemp - s.delmo), tmp = delomg + delm;
      mm = xmdf + tmp;
      argpm = argpdf - tmp;
      var t3 = t2 * t, t4 = t3 * t;
      tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
      tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
      templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
    }
    var nm = s.no_unkozai, em = s.ecco, inclm = s.inclo;
    if (nm <= 0) return null;
    var am = Math.pow(XKE / nm, X2O3) * tempa * tempa;
    nm = XKE / Math.pow(am, 1.5);
    em = em - tempe;
    if (em >= 1 || em < -0.001) return null;
    if (em < 1e-6) em = 1e-6;
    mm = mm + s.no_unkozai * templ;
    var xlm = mm + argpm + nodem;
    nodem = nodem % TWO_PI;
    argpm = argpm % TWO_PI;
    xlm = xlm % TWO_PI;
    mm = (xlm - argpm - nodem) % TWO_PI;
    var sinip = Math.sin(inclm), cosip = Math.cos(inclm), ep = em, argpp = argpm, nodep = nodem, mp = mm, xincp = inclm;
    var axnl = ep * Math.cos(argpp), temp = 1 / (am * (1 - ep * ep));
    var aynl = ep * Math.sin(argpp) + temp * s.aycof, xl = mp + argpp + nodep + temp * s.xlcof * axnl;
    /* Kepler's equation for the modified eccentric anomaly */
    var u = (xl - nodep) % TWO_PI, eo1 = u, tem5 = 9999.9, ktr = 1, sineo1 = 0, coseo1 = 0;
    while (Math.abs(tem5) >= 1e-12 && ktr <= 10) {
      sineo1 = Math.sin(eo1);
      coseo1 = Math.cos(eo1);
      tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
      tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
      if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
      eo1 = eo1 + tem5;
      ktr++;
    }
    /* short-period periodics */
    var ecose = axnl * coseo1 + aynl * sineo1, esine = axnl * sineo1 - aynl * coseo1;
    var el2 = axnl * axnl + aynl * aynl, pl = am * (1 - el2);
    if (pl < 0) return null;
    var rl = am * (1 - ecose), rdotl = Math.sqrt(am) * esine / rl, rvdotl = Math.sqrt(pl) / rl, betal = Math.sqrt(1 - el2);
    temp = esine / (1 + betal);
    var sinu = am / rl * (sineo1 - aynl - axnl * temp), cosu = am / rl * (coseo1 - axnl + aynl * temp);
    var su = Math.atan2(sinu, cosu), sin2u = (cosu + cosu) * sinu, cos2u = 1 - 2 * sinu * sinu;
    temp = 1 / pl;
    var temp1 = 0.5 * J2 * temp, temp2 = temp1 * temp;
    var mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
    su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
    var xnode = nodep + 1.5 * temp2 * cosip * sin2u, xinc = xincp + 1.5 * temp2 * cosip * sinip * cos2u;
    var mvt = rdotl - nm * temp1 * s.x1mth2 * sin2u / XKE, rvdot = rvdotl + nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41) / XKE;
    var sinsu = Math.sin(su), cossu = Math.cos(su), snod = Math.sin(xnode), cnod = Math.cos(xnode), sini = Math.sin(xinc), cosi = Math.cos(xinc);
    var xmx = -snod * cosi, xmy = cnod * cosi;
    var ux = xmx * sinsu + cnod * cossu, uy = xmy * sinsu + snod * cossu, uz = sini * sinsu;
    var vx = xmx * cossu - cnod * sinsu, vy = xmy * cossu - snod * sinsu, vz = sini * cossu;
    if (mrt < 1) return null; /* below the surface: decayed */
    var vkmps = RE * XKE / 60;
    return {
      r: [mrt * ux * RE, mrt * uy * RE, mrt * uz * RE],
      v: [(mvt * ux + rvdot * vx) * vkmps, (mvt * uy + rvdot * vy) * vkmps, (mvt * uz + rvdot * vz) * vkmps]
    };
  }

  /* ------------------------------------------------------------------ *
   * Look angles, shadow and brightness                                 *
   * ------------------------------------------------------------------ */
  /* Greenwich mean sidereal time (IAU 1982, as used with TEME), radians */
  function gmst(ms) {
    var t = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
    var sec = -6.2e-6 * t * t * t + 0.093104 * t * t + (876600 * 3600 + 8640184.812866) * t + 67310.54841;
    return ((sec * DEG / 240) % TWO_PI + TWO_PI) % TWO_PI;
  }

  /* observer on the WGS-84 ellipsoid at sea level, km, Earth-fixed */
  function observerEcef(lat, lon) {
    var a = 6378.137, e2 = 0.00669437999014, phi = lat * DEG, lam = lon * DEG;
    var n = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
    return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)];
  }

  /* diffuse sphere: brightness at phase angle b relative to full illumination */
  function phaseFunction(b) { return (Math.sin(b) + (Math.PI - b) * Math.cos(b)) / Math.PI; }

  /* Altitude, azimuth, range, sunlight and estimated magnitude of a satellite for an observer at a moment.
     stdMag is the brightness at 1000 km with half the disc lit (phase angle 90°). */
  function satelliteLook(rec, ms, lat, lon, stdMag) {
    var pv = sgp4(rec, (ms - rec.epochMs) / 60000);
    if (!pv) return null;
    var th = gmst(ms), c = Math.cos(th), sn = Math.sin(th), r = pv.r;
    var obs = observerEcef(lat, lon), phi = lat * DEG, lam = lon * DEG;
    /* satellite into the Earth-fixed frame, then south–east–zenith at the observer */
    var xe = c * r[0] + sn * r[1], ye = -sn * r[0] + c * r[1], ze = r[2];
    var dx = xe - obs[0], dy = ye - obs[1], dz = ze - obs[2];
    var south = Math.sin(phi) * Math.cos(lam) * dx + Math.sin(phi) * Math.sin(lam) * dy - Math.cos(phi) * dz;
    var east = -Math.sin(lam) * dx + Math.cos(lam) * dy;
    var zen = Math.cos(phi) * Math.cos(lam) * dx + Math.cos(phi) * Math.sin(lam) * dy + Math.sin(phi) * dz;
    var range = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var look = { alt: Math.asin(zen / range) / DEG, az: (Math.atan2(east, -south) / DEG + 360) % 360, range: range, lit: true, mag: null };
    var A = window.SvAstro;
    if (A) {
      /* the sun as a direction in the same (TEME ≈ true-of-date) frame; cylindrical Earth shadow */
      var sc = A.sunCoords(A.toDays(ms)), sun = [Math.cos(sc.dec) * Math.cos(sc.ra), Math.cos(sc.dec) * Math.sin(sc.ra), Math.sin(sc.dec)];
      var along = r[0] * sun[0] + r[1] * sun[1] + r[2] * sun[2];
      var px = r[0] - along * sun[0], py = r[1] - along * sun[1], pz = r[2] - along * sun[2];
      look.lit = along > 0 || Math.sqrt(px * px + py * py + pz * pz) > RE;
      if (stdMag != null) {
        /* observer back into TEME for the phase angle at the satellite */
        var ox = c * obs[0] - sn * obs[1], oy = sn * obs[0] + c * obs[1], oz = obs[2];
        var tx = ox - r[0], ty = oy - r[1], tz = oz - r[2], tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        var beta = Math.acos(Math.max(-1, Math.min(1, (tx * sun[0] + ty * sun[1] + tz * sun[2]) / tl)));
        look.mag = stdMag + 5 * Math.log(range / 1000) / Math.LN10 - 2.5 * Math.log(Math.max(phaseFunction(beta), 1e-4) * Math.PI) / Math.LN10;
      }
    }
    return look;
  }

  /* Visible passes between two moments (Unix seconds): above 10°, sunlit, with the sun at least 6° below the
     horizon, for at least a minute. Sampled every 20 seconds; each pass keeps its track for drawing. */
  function satellitePasses(sat, start, end, lat, lon) {
    var A = window.SvAstro, rec = sgp4init(parseTle(sat.tle1, sat.tle2)), passes = [], cur = null, step = 20;
    if (!rec || !A) return passes;
    function seen(t) {
      if (A.sunAltitude(t * 1000, lat, lon) >= -6) return false;
      var lk = satelliteLook(rec, t * 1000, lat, lon, sat.std);
      return !!(lk && lk.alt > 10 && lk.lit);
    }
    /* the samples lie 20 s apart: the true first or last visible second lies between a visible and an invisible one */
    function edge(inside, outside) {
      for (var i = 0; i < 6; i++) { var m = (inside + outside) / 2; if (seen(m)) inside = m; else outside = m; }
      return Math.round(inside);
    }
    for (var t = start; t <= end + step; t += step) {
      var look = t <= end && A.sunAltitude(t * 1000, lat, lon) < -6 ? satelliteLook(rec, t * 1000, lat, lon, sat.std) : null;
      var visible = look && look.alt > 10 && look.lit;
      if (visible) {
        if (!cur) cur = { name: sat.name, id: sat.id, start: t, track: [], max: null, faded: false };
        cur.track.push({ t: t, alt: look.alt, az: look.az, mag: look.mag });
        if (!cur.max || look.alt > cur.max.alt) cur.max = { t: t, alt: look.alt, az: look.az, mag: look.mag };
        if (look.mag != null && (cur.brightest == null || look.mag < cur.brightest)) cur.brightest = look.mag; /* 0.0 mag is a value, not a gap */
      } else if (cur) {
        var last = cur.track[cur.track.length - 1].t;
        if (cur.start - step >= start) cur.start = edge(cur.start, cur.start - step);
        cur.end = Math.min(t, end) > last ? edge(last, Math.min(t, end)) : last;
        cur.faded = !!(look && look.alt > 10 && !look.lit); /* vanished into the Earth's shadow */
        if (cur.end - cur.start >= 60) passes.push(cur); /* a glimpse of under a minute is not worth listing */
        cur = null;
      }
    }
    return passes;
  }

  /* ------------------------------------------------------------------ *
   * Meteor showers, encounters and comets of a night                   *
   * ------------------------------------------------------------------ */
  /* The major showers after the International Meteor Organization's calendar (dates for 2026, taken from the English
     Wikipedia's list of meteor showers). Activity and peak as solar longitudes in degrees, so that they hold for every
     year; radiant at the peak (J2000, degrees; its drift over the activity period is left out); v in km/s; ZHR. */
  var SHOWERS = [
    { key: 'QUA', en: 'Quadrantids', de: 'Quadrantiden', start: 276.5, peak: 283.15, end: 291.8, ra: 229.5, dec: 49, v: 41, zhr: 80, r: 2.1 },
    { key: 'LYR', en: 'Lyrids', de: 'Lyriden', start: 24.1, peak: 32.32, end: 39.7, ra: 271.5, dec: 34, v: 49, zhr: 18, r: 2.1 },
    { key: 'ETA', en: 'Eta Aquariids', de: 'Eta-Aquariiden', start: 29, peak: 45.5, end: 66.7, ra: 337.5, dec: -1, v: 66, zhr: 50, r: 2.4 },
    { key: 'SDA', en: 'Southern Delta Aquariids', de: 'Südliche Delta-Aquariiden', start: 109.7, peak: 128, end: 149.9, ra: 340.5, dec: -16, v: 41, zhr: 25, r: 2.5 },
    { key: 'CAP', en: 'Alpha Capricornids', de: 'Alpha-Capricorniden', start: 101.1, peak: 128, end: 142.2, ra: 307.5, dec: -10, v: 23, zhr: 5, r: 2.5 },
    { key: 'PER', en: 'Perseids', de: 'Perseiden', start: 114.5, peak: 140, end: 150.9, ra: 48, dec: 58, v: 59, zhr: 100, r: 2.2 },
    { key: 'DRA', en: 'October Draconids', de: 'Oktober-Draconiden', start: 192.8, peak: 195.4, end: 196.7, ra: 262.5, dec: 54, v: 20, zhr: 5, r: 2.6 },
    { key: 'ORI', en: 'Orionids', de: 'Orioniden', start: 188.8, peak: 208, end: 224.6, ra: 94.5, dec: 16, v: 66, zhr: 20, r: 2.5 },
    { key: 'STA', en: 'Southern Taurids', de: 'Südliche Tauriden', start: 177.1, peak: 223, end: 237.7, ra: 52.5, dec: 15, v: 27, zhr: 7, r: 2.3 },
    { key: 'NTA', en: 'Northern Taurids', de: 'Nördliche Tauriden', start: 206.6, peak: 230, end: 257.9, ra: 58.5, dec: 22, v: 29, zhr: 5, r: 2.3 },
    { key: 'LEO', en: 'Leonids', de: 'Leoniden', start: 223.6, peak: 235.27, end: 247.8, ra: 151.5, dec: 22, v: 71, zhr: 15, r: 2.5 },
    { key: 'PUP', en: 'Puppid-Velids', de: 'Puppid-Veliden', start: 248.8, peak: 255, end: 263, ra: 123, dec: -45, v: 44, zhr: 10, r: 2.9 },
    { key: 'GEM', en: 'Geminids', de: 'Geminiden', start: 251.8, peak: 262.2, end: 268.1, ra: 112.5, dec: 33, v: 35, zhr: 150, r: 2.6 },
    { key: 'URS', en: 'Ursids', de: 'Ursiden', start: 265, peak: 270.7, end: 274.2, ra: 217.5, dec: 76, v: 33, zhr: 10, r: 3.0 },
    { key: 'ACE', en: 'Alpha Centaurids', de: 'Alpha-Centauriden', start: 311.1, peak: 319.4, end: 331.4, ra: 211.5, dec: -58, v: 58, zhr: 6, r: 2.0 }
  ];

  function lamDiff(a, b) { return ((a - b + 540) % 360) - 180; }

  /* The sun's longitude for the J2000 equinox, the frame of the IMO's solar longitudes: the apparent longitude of date less
     the precession since 2000 (0.37° in 2026, which put every peak and activity edge about nine hours early) */
  function solarLongitude2000(ms) {
    var A = window.SvAstro, d = A.toDays(ms), lam = A.sunCoords(d).lam / DEG - 1.396971 * d / 36525;
    return ((lam % 360) + 360) % 360;
  }

  /* Showers active in a night, with the radiant's altitude through the dark hours: nautical darkness, or twilight where
     the sun does not sink below −12°. Where it does not even get that dark, a shower is still listed, without radiant.
     The expected rate is meteorRate()'s; no rough one here (a ZHR × sin(altitude) that ignored the distance from the peak,
     the moon and the sky was carried along unused until September 2026). */
  function showersTonight(samples, lat, lon) {
    var A = window.SvAstro, dark = samples.filter(function (row) { return row.sun.alt < -12; });
    if (!dark.length) dark = samples.filter(function (row) { return row.sun.alt < -6; });
    var ref = dark.length ? dark : samples;
    if (!ref.length) return [];
    var mid = ref[Math.floor(ref.length / 2)].t * 1000, lam = solarLongitude2000(mid);
    return SHOWERS.filter(function (sh) { return lamDiff(lam, sh.start) >= 0 && lamDiff(sh.end, lam) >= 0; }).map(function (sh) {
      var pc = A.precessJ2000(sh.ra, sh.dec, mid), best = null, from = null;
      dark.forEach(function (row) {
        var h = A.horizontalOf(pc.ra, pc.dec, row.t * 1000, lat, lon);
        if (!best || h.alt > best.alt) best = { t: row.t, alt: h.alt, az: h.az };
        if (from === null && h.alt >= 30) from = row.t;
      });
      var days = lamDiff(sh.peak, lam) / 0.9856;
      return { shower: sh, daysToPeak: days, best: best, from: from };
    }).sort(function (a, b) { return Math.abs(a.daysToPeak) - Math.abs(b.daysToPeak); });
  }

  /* Close pairs during the night (sun below −6°, both at least 10° high): planets with each other (under 5°), the moon
     with planets, bright stars and the Pleiades (under 5°), planets with bright stars (under 3°). Separations from the
     directions in the sky, the moon's with its topocentric altitude. */
  function encounters(samples, lat, lon, stars, extra) {
    var A = window.SvAstro, found = {}, rows = samples.filter(function (row) { return row.sun.alt < -6; });
    var planets = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];
    function vec(h) { var a = h.alt * DEG, z = h.az * DEG; return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)]; }
    function sep(p, q) { var u = vec(p), v = vec(q); return Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) / DEG; }
    /* the direction between two bodies: a circular mean, so that 350° and 10° give north, not south */
    function midAz(p, q) { return (Math.atan2(Math.sin(p * DEG) + Math.sin(q * DEG), Math.cos(p * DEG) + Math.cos(q * DEG)) / DEG + 360) % 360; }
    var fixed = stars.concat(extra || []).map(function (s) { return { key: s.key, name: s.name, kind: s.kind, pc: A.precessJ2000(s.ra, s.dec, rows.length ? rows[0].t * 1000 : 0) }; });
    rows.forEach(function (row) {
      var bodies = {};
      planets.concat(['moon']).forEach(function (id) { bodies[id] = row[id]; });
      function consider(key, a, b, limit, what) {
        if (a.alt < 10 || b.alt < 10) return;
        var d = sep(a, b);
        if (d > limit) return;
        if (!found[key] || d < found[key].sep) found[key] = { key: key, what: what, sep: d, t: row.t, alt: Math.min(a.alt, b.alt), az: midAz(a.az, b.az) };
      }
      for (var i = 0; i < planets.length; i++) for (var j = i + 1; j < planets.length; j++) {
        consider(planets[i] + '-' + planets[j], bodies[planets[i]], bodies[planets[j]], 5, { a: planets[i], b: planets[j] });
      }
      planets.forEach(function (id) { consider('moon-' + id, bodies.moon, bodies[id], 5, { a: 'moon', b: id }); });
      fixed.forEach(function (f) {
        var h = A.horizontalOf(f.pc.ra, f.pc.dec, row.t * 1000, lat, lon);
        consider('moon-' + f.key, bodies.moon, h, 5, { a: 'moon', star: f });
        if (f.kind === 'star') planets.forEach(function (id) { consider(id + '-' + f.key, bodies[id], h, 3, { a: id, star: f }); });
      });
    });
    return Object.keys(found).map(function (k) { return found[k]; }).sort(function (a, b) { return a.t - b.t; });
  }

  /* Comets brighter than magnitude 12 that stand at least 10° high while the sun is below −6°: bright comets close to
     the sun are often only seen in twilight. */
  function cometsTonight(comets, samples, lat, lon) {
    var A = window.SvAstro, rows = samples.filter(function (row) { return row.sun.alt < -6; });
    return (comets || []).map(function (c) {
      var best = null;
      rows.forEach(function (row) {
        var p = A.cometCoords(c, row.t * 1000), h = A.horizontalOf(p.ra, p.dec, row.t * 1000, lat, lon);
        if (h.alt >= 10 && (!best || h.alt > best.alt)) best = { t: row.t, alt: h.alt, az: h.az, mag: p.mag, r: p.r, dist: p.dist, ra: p.ra, dec: p.dec };
      });
      return best && best.mag <= 12 ? { comet: c, best: best } : null;
    }).filter(Boolean).sort(function (a, b) { return a.best.mag - b.best.mag; });
  }

  /* ------------------------------------------------------------------ *
   * Helpers for the events below                                        *
   * ------------------------------------------------------------------ */
  /* ΔT = TT − UT, about 69 s around 2026. The core's formulas take the moment they are given as TT. Where seconds matter
     (occultations, local solar eclipses, transits, Jupiter's moons) moon, sun and moons are taken at UT + ΔT while the
     Earth turns by UT; the geocentric lunar eclipses subtract ΔT from what they find. Without it a lunar occultation came
     about 1.5 minutes late against the RASC Observer's Handbook. */
  var DELTA_T = 69;
  /* angular distance of two RA/Dec points, radians in and out; the haversine form stays exact for tiny distances */
  function angSep(ra1, dec1, ra2, dec2) {
    var s1 = Math.sin((dec2 - dec1) / 2), s2 = Math.sin((ra2 - ra1) / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(s1 * s1 + Math.cos(dec1) * Math.cos(dec2) * s2 * s2)));
  }
  /* the same for two points given as altitude and azimuth in degrees, result in degrees */
  function sepAltAz(p, q) {
    var s1 = Math.sin((q.alt - p.alt) * DEG / 2), s2 = Math.sin((q.az - p.az) * DEG / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(s1 * s1 + Math.cos(p.alt * DEG) * Math.cos(q.alt * DEG) * s2 * s2))) / DEG;
  }
  /* position angle of point 2 seen from point 1 (radians, from north through east) */
  function posAngle(ra1, dec1, ra2, dec2) {
    return Math.atan2(Math.cos(dec2) * Math.sin(ra2 - ra1), Math.sin(dec2) * Math.cos(dec1) - Math.cos(dec2) * Math.sin(dec1) * Math.cos(ra2 - ra1));
  }
  /* a sign change of f between a and b, halved n times */
  function bisect(f, a, b, n) {
    var fa = f(a);
    for (var i = 0; i < n; i++) { var m = (a + b) / 2, fm = f(m); if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m; }
    return (a + b) / 2;
  }
  /* the minimum of a unimodal f between a and b, to tol */
  function goldenMin(f, a, b, tol) {
    var g = 0.3819660112501051, c = a + g * (b - a), d = b - g * (b - a), fc = f(c), fd = f(d);
    while (b - a > tol) {
      if (fc < fd) { b = d; d = c; fd = fc; c = a + g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = b - g * (b - a); fd = f(d); }
    }
    return (a + b) / 2;
  }
  /* a star's mean RA/Dec of date (radians) made apparent: the core's aberrate() (nutation and annual aberration), shared
     with the star map since September 2026 */
  function aberrate(ra0, dec0, ms) { return window.SvAstro.aberrate(ra0, dec0, ms); }

  /* ------------------------------------------------------------------ *
   * Occultations by the moon                                            *
   * ------------------------------------------------------------------ */
  /* Stars and planets the moon covers, seen from the place: disappearance and reappearance where the limb of the topocentric
     moon (moonTopocentric() in the core; its parallax of up to a degree decides here) passes the object's centre, with the
     limb dark or lit. The terminator meets the limb 90° from the bright-limb point at every phase, so the limb is dark
     wherever the contact's position angle lies more than 90° from the sun's — also a day after full moon, where the dark
     sliver is thin (until September 2026 the limb counted as lit from 97 % illumination, which made no geometric sense).
     targets: { name, mag, ra, dec } of date in radians, or { name, mag, planet } with a planet of A.PLANETS. Listed when
     the moon stands at least 2° high with the sun below −6° at one of the two moments. Times within about a minute
     (moon 0.01°). */
  function occultations(start, end, lat, lon, targets) {
    var A = window.SvAstro, coarse = [], out = [], midMs = (start + end) / 2 * 1000;
    for (var t = start; t <= end; t += 600) coarse.push({ t: t, m: A.moonTopocentric(t * 1000, lat, lon, DELTA_T) });
    function posOf(tg, t) {
      if (tg.planet) { var c = A.planetCoords(tg.planet, (t + DELTA_T) * 1000); return { ra: c.ra, dec: c.dec }; }
      return tg.app || (tg.app = aberrate(tg.ra, tg.dec, midMs));
    }
    function gap(tg, t) { var m = A.moonTopocentric(t * 1000, lat, lon, DELTA_T), p = posOf(tg, t); return angSep(m.ra, m.dec, p.ra, p.dec) - Math.asin(1737.4 / m.dist); }
    function look(tg, t) {
      var ms = t * 1000, m = A.moonTopocentric(ms, lat, lon, DELTA_T), h = A.horizontalOf(m.ra, m.dec, ms, lat, lon), sc = A.sunCoords(A.toDays(ms)), p = posOf(tg, t);
      var dark = Math.cos(posAngle(m.ra, m.dec, p.ra, p.dec) - posAngle(m.ra, m.dec, sc.ra, sc.dec)) < 0;
      return { t: t, alt: h.alt, az: h.az, ok: h.alt >= 2 && A.sunAltitude(ms, lat, lon) < -6, dark: dark };
    }
    targets.forEach(function (tg) {
      var near = null;
      coarse.forEach(function (c) { var p = posOf(tg, c.t), d = angSep(c.m.ra, c.m.dec, p.ra, p.dec); if (d < 1.2 * DEG && (!near || d < near.d)) near = { t: c.t, d: d }; });
      if (!near) return;
      var from = Math.max(start, near.t - 5400), to = Math.min(end, near.t + 5400), prev = gap(tg, from), tIn = null, tOut = null;
      var f = function (x) { return gap(tg, x); };
      for (var tt = from + 60; tt <= to; tt += 60) {
        var cur = gap(tg, tt);
        if (prev >= 0 && cur < 0) tIn = bisect(f, tt - 60, tt, 12);
        if (prev < 0 && cur >= 0) tOut = bisect(f, tt - 60, tt, 12);
        prev = cur;
      }
      if (tIn == null && tOut == null) return;
      var dis = tIn != null ? look(tg, tIn) : null, re = tOut != null ? look(tg, tOut) : null;
      if (!(dis && dis.ok) && !(re && re.ok)) return;
      out.push({ target: tg, dis: dis, re: re });
    });
    return out.sort(function (a, b) { return (a.dis || a.re).t - (b.dis || b.re).t; });
  }

  /* ------------------------------------------------------------------ *
   * Jupiter's moons: transits, shadows, occultations, eclipses          *
   * ------------------------------------------------------------------ */
  /* From the Galilean moons of window.SvSkyMap (Meeus ch. 44, lower accuracy; also seen from the sun): a moon in front of
     the disc (transit), its shadow on the disc (seen from the sun, the moon in front), behind the disc (occultation), in
     Jupiter's shadow (seen from the sun, the moon behind). Every start and end is found to about a second of that theory,
     which itself puts events within several minutes. The states are sampled on a 2-minute grid, so an event shorter than
     that (a grazing transit) can be missed. Listed when at least four minutes of it fall while Jupiter stands 8° high with
     the sun below −6°: three visible samples of the same grid. */
  var JUPITER_KINDS = ['transit', 'shadow', 'occultation', 'eclipse'];
  function jupiterEvents(start, end, lat, lon) {
    var A = window.SvAstro, M = window.SvSkyMap, out = [], k1 = 1 / (1 - 0.0649), step = 120;
    if (!M || !M.galileanMoons) return out;
    function states(t) {
      return M.galileanMoons((t + DELTA_T) * 1000).map(function (m) {
        var inE = m.X * m.X + m.Y * k1 * m.Y * k1 < 1, inS = m.Xs * m.Xs + m.Ys * k1 * m.Ys * k1 < 1;
        return [m.front && inE, m.frontSun && inS, !m.front && inE, !m.frontSun && inS];
      });
    }
    function edge(k, j, a, b) {
      var sa = states(a)[k][j];
      for (var i = 0; i < 7; i++) { var mid = (a + b) / 2; if (states(mid)[k][j] === sa) a = mid; else b = mid; }
      return (a + b) / 2;
    }
    function finish(k, j, from, to) {
      var a = from == null ? start : from, b = to == null ? end : to, vis = [];
      for (var t = a; t <= b; t += Math.min(step, Math.max(1, b - a))) {
        var jp = A.bodyAt('jupiter', t, lat, lon);
        if (jp.alt > 8 && A.sunAltitude(t * 1000, lat, lon) < -6) vis.push({ t: t, alt: jp.alt, az: jp.az });
        if (b - a < 1) break;
      }
      if (vis.length < 3) return; /* four minutes or more on the 2-minute grid */
      var mid = vis[Math.floor(vis.length / 2)];
      out.push({ moon: k, kind: JUPITER_KINDS[j], from: from, to: to, visFrom: vis[0].t, visTo: vis[vis.length - 1].t, t: mid.t, alt: mid.alt, az: mid.az });
    }
    var prev = states(start), open = {};
    for (var t = start + step; t <= end; t += step) {
      var cur = states(t);
      for (var k = 0; k < 4; k++) for (var j = 0; j < 4; j++) {
        if (cur[k][j] === prev[k][j]) continue;
        var te = edge(k, j, t - step, t), key = k + ',' + j;
        if (cur[k][j]) open[key] = { k: k, j: j, from: te };
        else { finish(k, j, open[key] ? open[key].from : null, te); delete open[key]; }
      }
      prev = cur;
    }
    for (k = 0; k < 4; k++) for (j = 0; j < 4; j++) {
      var kk = k + ',' + j;
      if (open[kk]) finish(k, j, open[kk].from, null);
      else if (prev[k][j] && states(start)[k][j]) finish(k, j, null, null); /* the whole night long */
    }
    return out.sort(function (a, b) { return a.visFrom - b.visFrom; });
  }

  /* ------------------------------------------------------------------ *
   * A satellite in front of the moon or the sun                         *
   * ------------------------------------------------------------------ */
  /* Closest approaches of a satellite (SGP4) to the moon (topocentric) or the sun within 1°, seen from the place, with the
     moon or sun at least 5° high: sampled every 20 s while the satellite is up, each dip refined to 0.02 s. transit when
     the separation is below the disc's radius; centreKm is how far the observer would roughly have to move for a central
     transit (separation × range); duration of a transit from the satellite's apparent speed. Times depend on how fresh the
     orbit is: within seconds for a few days old. */
  function satelliteTransits(sat, start, end, lat, lon) {
    var A = window.SvAstro, rec = sgp4init(parseTle(sat.tle1, sat.tle2)), out = [];
    if (!rec || !A) return out;
    function disc(which, t) {
      var ms = t * 1000;
      if (which === 'sun') { var sh = A.sunHorizontal(ms, lat, lon); return { alt: sh.alt, az: sh.az, r: 959.63 / 3600 / A.sunCoords(A.toDays(ms)).r }; }
      var m = A.moonTopocentric(ms, lat, lon, DELTA_T), h = A.horizontalOf(m.ra, m.dec, ms, lat, lon);
      return { alt: h.alt, az: h.az, r: Math.asin(1737.4 / m.dist) / DEG };
    }
    function sepAt(which, t) { var lk = satelliteLook(rec, t * 1000, lat, lon, null); return lk ? sepAltAz(lk, disc(which, t)) : 999; }
    ['moon', 'sun'].forEach(function (which) {
      var p2 = null, p1 = null;
      for (var t = start; t <= end; t += 20) {
        var lk = satelliteLook(rec, t * 1000, lat, lon, null), s = 999;
        if (lk && lk.alt > 0) { var dc = disc(which, t); if (dc.alt > 5) s = sepAltAz(lk, dc); }
        if (p1 && p2 && p1.s < 40 && p1.s <= p2.s && p1.s <= s) {
          var tm = goldenMin(function (x) { return sepAt(which, x); }, p1.t - 20, p1.t + 20, 0.02), sm = sepAt(which, tm);
          if (sm < 1) {
            var at = satelliteLook(rec, tm * 1000, lat, lon, null), d0 = disc(which, tm), la = satelliteLook(rec, (tm - 0.5) * 1000, lat, lon, null), lb = satelliteLook(rec, (tm + 0.5) * 1000, lat, lon, null);
            var speed = la && lb ? sepAltAz(la, lb) : 1;
            out.push({ name: sat.name, body: which, t: tm, sep: sm, radius: d0.r, alt: d0.alt, az: d0.az, range: at.range, centreKm: sm * DEG * at.range,
              transit: sm < d0.r, duration: sm < d0.r ? 2 * Math.sqrt(d0.r * d0.r - sm * sm) / Math.max(speed, 1e-6) : 0 });
          }
        }
        p2 = p1; p1 = { t: t, s: s };
      }
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  /* ------------------------------------------------------------------ *
   * The galactic centre                                                 *
   * ------------------------------------------------------------------ */
  /* Sgr A* (J2000): tonight's stretch at least 10° high in astronomical darkness (nautical where there is none) with its
     highest point and the moon there, and for the season the hours of such darkness with the centre up on the 15th of
     every month of that year */
  var GALACTIC_CENTRE = { ra: 266.41683, dec: -29.00781 };
  function galacticCentre(samples, lat, lon) {
    var A = window.SvAstro;
    if (!samples.length) return null;
    var pc = A.precessJ2000(GALACTIC_CENTRE.ra, GALACTIC_CENTRE.dec, samples[0].t * 1000), level = -18;
    var rows = samples.filter(function (r) { return r.sun.alt < -18; });
    if (!rows.length) { rows = samples.filter(function (r) { return r.sun.alt < -12; }); level = -12; }
    var up = rows.map(function (r) { var h = A.horizontalOf(pc.ra, pc.dec, r.t * 1000, lat, lon); return { t: r.t, alt: h.alt, az: h.az, moon: r.moon }; })
      .filter(function (x) { return x.alt >= 10; });
    var best = null;
    up.forEach(function (x) { if (!best || x.alt > best.alt) best = x; });
    var y = new Date(samples[0].t * 1000).getUTCFullYear(), months = [];
    for (var mo = 0; mo < 12; mo++) {
      var t0 = Date.UTC(y, mo, 15, 12) / 1000, pm = A.precessJ2000(GALACTIC_CENTRE.ra, GALACTIC_CENTRE.dec, t0 * 1000), hrs = 0;
      for (var tt = t0; tt < t0 + 86400; tt += 1200) if (A.sunAltitude(tt * 1000, lat, lon) < -18 && A.horizontalOf(pm.ra, pm.dec, tt * 1000, lat, lon).alt >= 10) hrs += 1 / 3;
      months.push(hrs);
    }
    return { tonight: best ? { from: up[0].t, to: up[up.length - 1].t, best: best, level: level, illum: best.moon.illum, moonSep: best.moon.alt > 0 ? sepAltAz(best, best.moon) : null } : null, months: months };
  }

  /* ------------------------------------------------------------------ *
   * Eclipses                                                            *
   * ------------------------------------------------------------------ */
  function elongationDeg(t) { var A = window.SvAstro, d = A.toDays(t * 1000); return (((A.moonCoords(d).lam - A.sunCoords(d).lam) / DEG) % 360 + 360) % 360; }
  /* the next new (target 0) or full moon (180) after t, seconds */
  function nextSyzygy(t, target) {
    function past(x) { return ((elongationDeg(x) - target) % 360 + 360) % 360; }
    var a = t, pa = past(a);
    for (var i = 0; i < 80; i++) {
      var b = a + 43200, pb = past(b);
      if (pb < pa) { for (var j = 0; j < 30; j++) { var m = (a + b) / 2; if (past(m) > 180) a = m; else b = m; } return (a + b) / 2; }
      a = b; pa = pb;
    }
    return null;
  }
  /* the moon against the Earth's shadow at t (geocentric, degrees): distance from the shadow's axis, the moon's radius and
     the umbra and penumbra at the moon, enlarged by 2 % for the atmosphere (Chauvenet, as in Meeus ch. 54) */
  function shadowAt(t) {
    var A = window.SvAstro, d = A.toDays(t * 1000), s = A.sunCoords(d), m = A.moonCoords(d);
    var pm = Math.asin(6378.14 / m.dist) / DEG, ps = 8.794 / 3600 / s.r, ss = 959.63 / 3600 / s.r;
    return { D: angSep(m.ra, m.dec, s.ra + Math.PI, -s.dec) / DEG, sm: Math.asin(1737.4 / m.dist) / DEG, ru: 1.02 * (0.998340 * pm - ss + ps), rp: 1.02 * (0.998340 * pm + ss + ps) };
  }
  /* Lunar eclipses from fromSec on, up to count of them seen at least partly from the place (moon up during the umbral
     phase, or the penumbral one for a penumbral eclipse), within maxYears. Greatest eclipse, magnitudes, contacts P1/U1/U2/U3/
     U4/P4 (null where there is none), all in UT seconds, and the part the place sees. */
  function lunarEclipses(fromSec, maxYears, count, lat, lon) {
    var A = window.SvAstro, out = [], t = fromSec, until = fromSec + maxYears * 365.25 * 86400;
    while (out.length < count && t < until) {
      var full = nextSyzygy(t, 180);
      if (full == null) break;
      t = full + 25 * 86400;
      var q = shadowAt(full);
      if (q.D > q.rp + q.sm + 0.5) continue;
      var tm = goldenMin(function (x) { return shadowAt(x).D; }, full - 6 * 3600, full + 6 * 3600, 2), s0 = shadowAt(tm);
      var pen = (s0.rp + s0.sm - s0.D) / (2 * s0.sm), umb = (s0.ru + s0.sm - s0.D) / (2 * s0.sm);
      if (pen <= 0) continue;
      var contact = function (radius) {
        var f = function (x) { var z = shadowAt(x); return z.D - radius(z); };
        return f(tm) >= 0 ? null : [bisect(f, tm - 5 * 3600, tm, 24), bisect(f, tm, tm + 5 * 3600, 24)];
      };
      var P = contact(function (z) { return z.rp + z.sm; }), U = umb > 0 ? contact(function (z) { return z.ru + z.sm; }) : null, TOT = umb >= 1 ? contact(function (z) { return z.ru - z.sm; }) : null;
      /* the contacts above are TT; the horizon turns by UT, so altitudes are taken ΔT earlier (0.25° of the moon's motion) */
      var dt = function (x) { return x == null ? null : x - DELTA_T; }, span = U || P, vis = [];
      for (var tt = span[0]; tt <= span[1]; tt += 300) if (A.moonAltitude(dt(tt) * 1000, lat, lon) > 0) vis.push(dt(tt));
      if (!vis.length) continue;
      out.push({ t: dt(tm), tt: tm, type: umb >= 1 ? 'total' : umb > 0 ? 'partial' : 'penumbral', umbral: umb, penumbral: pen,
        P1: dt(P[0]), U1: U ? dt(U[0]) : null, U2: TOT ? dt(TOT[0]) : null, U3: TOT ? dt(TOT[1]) : null, U4: U ? dt(U[1]) : null, P4: dt(P[1]),
        alt: A.moonAltitude(dt(tm) * 1000, lat, lon), visFrom: vis[0], visTo: vis[vis.length - 1], whole: vis.length > (span[1] - span[0]) / 300 });
    }
    return out;
  }
  /* Solar eclipses seen from the place, from fromSec on (count of them within maxYears): at every new moon close enough to
     the node, the topocentric moon against the topocentric sun; greatest eclipse at the place, magnitude (share of the
     sun's diameter covered), obscuration (share of its area), local type, contacts C1–C4 (C2/C3 only when central there)
     in UT seconds, the sun's altitude and the part above the horizon (UT; moon and sun at TT = UT + ΔT) */
  var AU_KM = 149597870.7;
  function solarEclipses(fromSec, maxYears, count, lat, lon) {
    var A = window.SvAstro, out = [], t = fromSec, until = fromSec + maxYears * 365.25 * 86400;
    function local(x) {
      /* the sun's parallax (up to 8.8″) is small next to the moon's, but near the edge of a path of totality it decides:
         with a geocentric sun the southern limit on 12 August 2026 ran 42 km too far south, and Madrid came out total */
      var ms = x * 1000, g = A.sunCoords(A.toDays(ms + DELTA_T * 1000)), s = A.topocentric(g.ra, g.dec, g.r * AU_KM, ms, lat, lon), m = A.moonTopocentric(ms, lat, lon, DELTA_T);
      return { sep: angSep(m.ra, m.dec, s.ra, s.dec) / DEG, ss: 959.63 / 3600 / (s.dist / AU_KM), sm: Math.asin(1737.4 / m.dist) / DEG };
    }
    while (out.length < count && t < until) {
      var nm = nextSyzygy(t, 0);
      if (nm == null) break;
      t = nm + 25 * 86400;
      var d = A.toDays(nm * 1000), gs = A.sunCoords(d), gm = A.moonCoords(d);
      if (angSep(gm.ra, gm.dec, gs.ra, gs.dec) / DEG > 1.8) continue;
      var tm = goldenMin(function (x) { return local(x).sep; }, nm - 5 * 3600, nm + 5 * 3600, 2), L = local(tm);
      if (L.sep >= L.sm + L.ss) continue;
      var f1 = function (x) { var z = local(x); return z.sep - (z.sm + z.ss); };
      var C1 = bisect(f1, tm - 4 * 3600, tm, 24), C4 = bisect(f1, tm, tm + 4 * 3600, 24), C2 = null, C3 = null, central = L.sep < Math.abs(L.sm - L.ss);
      if (central) {
        var f2 = function (x) { var z = local(x); return z.sep - Math.abs(z.sm - z.ss); };
        C2 = bisect(f2, C1, tm, 24); C3 = bisect(f2, tm, C4, 24);
      }
      var vis = [];
      for (var tt = C1; tt <= C4; tt += 120) if (A.sunHorizontal(tt * 1000, lat, lon).alt > -0.5) vis.push(tt);
      if (!vis.length) continue;
      var R = L.ss, r = L.sm, dd = L.sep, obsc;
      if (dd <= Math.abs(R - r)) obsc = Math.min(1, r * r / (R * R));
      else obsc = (r * r * Math.acos((dd * dd + r * r - R * R) / (2 * dd * r)) + R * R * Math.acos((dd * dd + R * R - r * r) / (2 * dd * R)) -
        0.5 * Math.sqrt(Math.max(0, (-dd + r + R) * (dd + r - R) * (dd - r + R) * (dd + r + R)))) / (Math.PI * R * R);
      var dt = function (x) { return x; }; /* already UT: the bodies are taken at TT above */
      out.push({ t: tm, tt: tm + DELTA_T, type: central ? (L.sm > L.ss ? 'total' : 'annular') : 'partial', magnitude: (L.sm + L.ss - L.sep) / (2 * L.ss), obscuration: obsc,
        C1: dt(C1), C2: dt(C2), C3: dt(C3), C4: dt(C4), alt: A.sunHorizontal(tm * 1000, lat, lon).alt, visFrom: dt(vis[0]), visTo: dt(vis[vis.length - 1]), whole: vis.length > (C4 - C1) / 120 });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Meteors per hour at the place, and a night for the season chart     *
   * ------------------------------------------------------------------ */
  /* A rough hourly rate for a shower in this night: the ZHR falls off from the peak to 1.5 at the activity edges (a straight
     line in log ZHR), times sin(radiant altitude), times r^(LM − 6.5) with the limiting magnitude lm of the sky, lowered
     by a bright high moon (up to 2.5 mag) and by nautical twilight. The highest such rate while the sun is below −12°. */
  function meteorRate(sh, samples, lat, lon, lm) {
    var A = window.SvAstro, rows = samples.filter(function (r) { return r.sun.alt < -12; });
    if (!rows.length) return null;
    var mid = rows[Math.floor(rows.length / 2)].t * 1000, dl = lamDiff(solarLongitude2000(mid), sh.peak);
    var edge = Math.max(dl < 0 ? lamDiff(sh.peak, sh.start) : lamDiff(sh.end, sh.peak), 0.1);
    var zhr = sh.zhr * Math.pow(10, -Math.log(sh.zhr / 1.5) / Math.LN10 * Math.min(1, Math.abs(dl) / edge));
    var pc = A.precessJ2000(sh.ra, sh.dec, mid), best = { hr: 0, t: null, alt: null };
    rows.forEach(function (row) {
      var h = A.horizontalOf(pc.ra, pc.dec, row.t * 1000, lat, lon).alt;
      if (h <= 0) return;
      var moonLoss = row.moon.alt > 0 ? 2.5 * row.moon.illum * Math.min(1, 1.5 * Math.sin(row.moon.alt * DEG)) : 0, twiLoss = row.sun.alt > -18 ? (row.sun.alt + 18) / 6 * 1.5 : 0;
      var hr = zhr * Math.sin(h * DEG) * Math.pow(sh.r || 2.5, lm - moonLoss - twiLoss - 6.5);
      if (hr > best.hr) best = { hr: hr, t: row.t, alt: h };
    });
    best.zhr = zhr;
    return best;
  }
  /* One night for an object's season chart: hours of astronomical darkness, of it with the moon down, with the object at
     least 30° high, and of that with the moon down; the object's highest point in darkness with the moon's distance there.
     altAz(sec) gives the object's altitude and azimuth in degrees; isMoon leaves the moon's own terms out. */
  function nightSummary(altAz, evening, next, lat, lon, step, isMoon) {
    var A = window.SvAstro, h = step / 3600, r = { dark: 0, darkMoonless: 0, above30: 0, above30Moonless: 0, maxAlt: null, maxT: null, moonSep: null, illum: 0 };
    for (var t = evening + step / 2; t < next; t += step) {
      var ms = t * 1000;
      if (A.sunAltitude(ms, lat, lon) >= -18) continue;
      var o = altAz(t), mc = A.moonCoords(A.toDays(ms)), mh = A.horizontalOf(mc.ra, mc.dec, ms, lat, lon);
      var moonAlt = mh.alt - Math.asin(6378.14 / mc.dist) / DEG * Math.cos(mh.alt * DEG), moonDown = !isMoon && moonAlt < -0.833;
      r.dark += h;
      if (moonDown) r.darkMoonless += h;
      if (o.alt >= 30) { r.above30 += h; if (moonDown) r.above30Moonless += h; }
      if (r.maxAlt == null || o.alt > r.maxAlt) { r.maxAlt = o.alt; r.maxT = t; r.moonSep = isMoon ? null : sepAltAz(o, { alt: moonAlt, az: mh.az }); }
    }
    r.illum = A.moonIllumination((evening + next) / 2 * 1000).fraction;
    return r;
  }

  window.SvSkyEvents = {
    parseTle: parseTle, sgp4init: sgp4init, sgp4: sgp4, gmst: gmst,
    satelliteLook: satelliteLook, satellitePasses: satellitePasses,
    SHOWERS: SHOWERS, solarLongitude2000: solarLongitude2000, showersTonight: showersTonight,
    occultations: occultations, jupiterEvents: jupiterEvents, JUPITER_KINDS: JUPITER_KINDS, satelliteTransits: satelliteTransits, galacticCentre: galacticCentre,
    GALACTIC_CENTRE: GALACTIC_CENTRE, lunarEclipses: lunarEclipses, solarEclipses: solarEclipses, nextSyzygy: nextSyzygy, meteorRate: meteorRate, nightSummary: nightSummary, DELTA_T: DELTA_T, encounters: encounters, cometsTonight: cometsTonight
  };
})();
