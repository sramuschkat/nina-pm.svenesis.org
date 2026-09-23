/*
 * Shared scoring, colours and chart primitives of the weather pages: astro-weather and
 * astro-weather history. Everything in here is pure apart from stickyLabels() and cellPaint(),
 * which take their canvas as an argument.
 *
 * The point of the file is that both pages speak one visual language: the same blue ramp means
 * the same thing on both, and a change to a formula happens once. Loaded after astro-core.js
 * (it uses clamp from there) and before the page script.
 */
(function () {
  'use strict';
  var A = window.SvAstro;
  if (!A) return;
  var RAD = A.RAD, clamp = A.clamp;

  /* ------------------------------------------------------------------ *
   * Scores (0 = bad … 1 = good). Estimates — documented on the page.   *
   * ------------------------------------------------------------------ */
  function cloudScore(c) { return c == null ? null : clamp(1 - c / 100, 0, 1); }

  /* vector difference of two winds (speed, direction in degrees) */
  function windShear(s1, d1, s2, d2) {
    if (s1 == null || s2 == null || d1 == null || d2 == null) return null;
    var du = s1 * Math.sin(d1 * RAD) - s2 * Math.sin(d2 * RAD), dv = s1 * Math.cos(d1 * RAD) - s2 * Math.cos(d2 * RAD);
    return Math.sqrt(du * du + dv * dv);
  }

  /* Seeing from the wind profile: a fast jet stream, strong shear between about 1.5 and 10 km
     (850 and 250 hPa) and wind at the ground all mean turbulent air. The weights are an own
     estimate; the jet-only version called almost every hour at Starfront excellent. */
  function seeingScore(r) {
    if (r.jet == null) return null;
    var penalty = 0.45 * clamp((r.jet - 20) / 110, 0, 1) +
      0.35 * clamp(((r.shear == null ? 0 : r.shear) - 20) / 100, 0, 1) +
      0.20 * clamp(((r.wind_speed_10m || 0) - 8) / 25, 0, 1);
    return clamp(1 - penalty, 0, 1);
  }

  /* Transparency from aerosol optical depth (dust included), damped by high humidity at the ground
     and, gently, by a lot of water vapour in the air column, which absorbs little visible light. */
  function transparencyScore(aod, rh, pwv) {
    if (aod == null) return null;
    var s = clamp(1 - (aod - 0.05) / 0.45, 0, 1);
    if (rh != null && rh > 80) s *= clamp(1 - (rh - 80) / 40, 0.5, 1);
    if (pwv != null) s *= clamp(1 - (pwv - 25) / 150, 0.85, 1);
    return s;
  }

  /* Clouds dominate; seeing and transparency only shade a clear hour. A missing estimate hands its
     weight to the others instead of counting as average: after the aerosol forecast ends, clear
     hours would otherwise drop by about six points for no reason in the sky. */
  function overallScore(c, se, tr) {
    if (c == null) return null;
    var sum = 0.7, weight = 0.7;
    if (se != null) { sum += 0.15 * se; weight += 0.15; }
    if (tr != null) { sum += 0.15 * tr; weight += 0.15; }
    return clamp(c * c * sum / weight, 0, 1);
  }

  /* The rating bands. rating() itself stays in each page, because it reads that page's T.ratings;
     the cuts belong here so both pages band a score the same way.
     Index: 0 very poor, 1 poor, 2 average, 3 good, 4 excellent. */
  var RATING_CUTS = [0.25, 0.45, 0.65, 0.85];
  function ratingIndex(s) {
    if (s == null) return null;
    return s >= RATING_CUTS[3] ? 4 : s >= RATING_CUTS[2] ? 3 : s >= RATING_CUTS[1] ? 2 : s >= RATING_CUTS[0] ? 1 : 0;
  }

  /* ------------------------------------------------------------------ *
   * Colours                                                            *
   * ------------------------------------------------------------------ */
  var COL = {
    bg: '#10151c', label: '#0b0f14', grid: 'rgba(255,255,255,.06)', gridDay: 'rgba(255,255,255,.18)',
    text: '#9aa7b6', textBright: '#e4e9ef', sunLine: '#d9c24a', sunFill: 'rgba(200,170,50,.45)', moonLine: 'rgba(230,232,236,.85)',
    temp: '#e3a33b', dew: '#3fa9e6', now: '#e5484d', dayBar: '#1f6fd6', noData: '#262c34', seam: 'rgba(228,233,239,.55)'
  };

  function scoreColour(s) {
    if (s == null) return COL.noData;
    /* bad = pale grey-blue, good = saturated blue */
    var bad = [198, 208, 220], good = [30, 88, 190];
    var c = bad.map(function (b, i) { return Math.round(b + (good[i] - b) * s); });
    return 'rgb(' + c.join(',') + ')';
  }

  function windColour(v) {
    return v == null ? COL.noData : v <= 10 ? '#3fae4c' : v <= 20 ? '#8fbf2f' : v <= 30 ? '#d9b52b' : v <= 40 ? '#e07b2b' : '#d8433b';
  }

  /* overall rating as a traffic light, stops at the rating thresholds; k fades it into the
     neutral ground (0 = daylight, 1 = astronomical night) */
  var RATING_STOPS = [[0, [216, 67, 59]], [0.45, [224, 123, 43]], [0.65, [217, 181, 43]], [0.85, [63, 174, 76]], [1, [63, 174, 76]]];
  function ratingColour(s, k) {
    var base = [31, 37, 46], c = base;
    if (s != null && k > 0) {
      for (var i = 1; i < RATING_STOPS.length; i++) {
        if (s <= RATING_STOPS[i][0]) {
          var a = RATING_STOPS[i - 1], b = RATING_STOPS[i], f = (s - a[0]) / (b[0] - a[0]);
          c = a[1].map(function (v, j) { return v + (b[1][j] - v) * f; });
          break;
        }
      }
      c = base.map(function (v, j) { return Math.round(v + (c[j] - v) * k); });
    }
    return 'rgb(' + c.join(',') + ')';
  }

  /* WMO weather code as a symbol; a clear or mainly clear night shows the moon */
  var EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  function wxSymbol(code, night) {
    if (code == null) return '';
    if (code >= 95) return '⛈️';
    if (code >= 85 || (code >= 71 && code <= 77)) return '🌨️';
    if (code >= 61) return '🌧️';
    if (code >= 51) return night ? '🌧️' : '🌦️';
    if (code >= 45) return '🌫️';
    if (code === 3) return '☁️';
    if (code === 2) return night ? '☁️' : '⛅';
    if (code === 1) return night ? '🌙' : '🌤️';
    return night ? '🌙' : '☀️';
  }

  /* ------------------------------------------------------------------ *
   * Canvas primitives                                                  *
   * ------------------------------------------------------------------ */

  /* a copy of the label column that stays put while a chart scrolls sideways on narrow screens */
  function stickyLabels(wrap, canvas, width, height) {
    var lab = wrap.querySelector('canvas.aw-labels');
    if (!lab) {
      lab = document.createElement('canvas');
      lab.className = 'aw-labels';
      lab.setAttribute('aria-hidden', 'true');
      lab.style.cssText = 'position:sticky; left:0; display:block; z-index:1;';
      wrap.insertBefore(lab, canvas);
    }
    var dpr = window.devicePixelRatio || 1;
    lab.width = Math.round(width * dpr); lab.height = canvas.height;
    lab.style.width = width + 'px'; lab.style.height = height + 'px'; lab.style.marginBottom = -height + 'px';
    lab.getContext('2d').drawImage(canvas, 0, 0, lab.width, lab.height, 0, 0, lab.width, lab.height);
  }

  /* one cell of a value row: the score as the background, the text on top in whichever of the two
     ink colours reads on it. The 0.55 threshold is where the blue ramp gets too dark for dark ink. */
  function cellPaint(ctx, x, y, w, h, score, text) {
    ctx.fillStyle = scoreColour(score);
    ctx.fillRect(x, y, w, h);
    if (text == null || text === '') return;
    ctx.fillStyle = score != null && score > 0.55 ? '#fff' : '#1b2633';
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  }

  window.SvWx = {
    cloudScore: cloudScore, windShear: windShear, seeingScore: seeingScore,
    transparencyScore: transparencyScore, overallScore: overallScore,
    RATING_CUTS: RATING_CUTS, ratingIndex: ratingIndex,
    COL: COL, scoreColour: scoreColour, windColour: windColour,
    RATING_STOPS: RATING_STOPS, ratingColour: ratingColour,
    EMOJI_FONT: EMOJI_FONT, wxSymbol: wxSymbol,
    stickyLabels: stickyLabels, cellPaint: cellPaint
  };
})();
