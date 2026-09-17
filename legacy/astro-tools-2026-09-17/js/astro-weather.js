/*
 * Astro weather chart for svenesis.org
 *
 * Draws a 7-day astronomical forecast on a <canvas>: sun and moon altitude,
 * cloud / seeing / transparency rows, wind, temperature and dew point.
 * Weather data from Open-Meteo, licensed CC BY 4.0: DWD ICON inside the ICON-EU
 * domain, NOAA GFS (with HRRR over North America) elsewhere, ECMWF IFS clouds as a
 * second opinion, CAMS aerosol. Nothing is requested before the visitor clicks "load".
 *
 * Sun, moon, time zones and the password check come from astro-tools/js/astro-core.js, shared with the
 * observing planner. Seeing and transparency are estimates, not measurements; the page says so.
 */
(function () {
  'use strict';

  var root = document.getElementById('aw-root');
  if (!root || !window.SvAstro) return;

  var LANG = document.documentElement.lang === 'en' ? 'en' : 'de';

  var T = {
    de: {
      loading: 'Vorhersage wird geladen …',
      loaded: 'Vorhersage für {name} geladen · {model} · Zeiten in Ortszeit ({utc})',
      srcIcon: 'Modell DWD ICON',
      srcGfs: 'Modell NOAA GFS/HRRR',
      srcGfsOnly: 'Modell NOAA GFS',
      error: 'Die Vorhersage konnte nicht geladen werden: ',
      badCoords: 'Bitte gültige Koordinaten eingeben (Breite −90 bis 90, Länge −180 bis 180).',
      pwWrong: 'Falsches Passwort.',
      pwNeeded: 'Eigene Koordinaten sind geschützt – bitte zuerst das Passwort eingeben.',
      mbTitle: 'Wetterkarte von meteoblue',
      mbNoLocation: 'Bitte zuerst einen Standort wählen oder die Vorhersage laden.',
      pwNoCrypto: 'Dieser Browser kann das Passwort nicht prüfen.',
      noAerosol: 'keine Daten',
      rows: { sun: 'Sonne', moon: 'Mond', overall: 'Gesamt', clouds: 'Wolken', clouds2: 'ECMWF', seeing: 'Seeing', transp: 'Transp.', wind: 'Wind', temp: 'Temp', dew: 'Taupunkt', night: 'Nacht Ø' },
      now: 'Jetzt',
      days: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
      daysLong: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
      ratings: ['Sehr schlecht', 'Schlecht', 'Mittel', 'Gut', 'Ausgezeichnet'],
      compass: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'],
      tipOverall: 'Gesamt',
      tipClouds: 'Wolken',
      tipClouds2: 'Wolken ECMWF',
      tipLayers: 'tief {l} · mittel {m} · hoch {h}',
      tipSeeing: 'Seeing (Schätzung)',
      tipJet: 'Jet {j} · Scherung {s} · Boden {g} km/h',
      tipPwv: 'Wasserdampf (Luftsäule)',
      tipDust: 'Staub',
      tipTransp: 'Transparenz (Schätzung)',
      tipWind: 'Wind',
      tipGusts: 'Böen',
      tipTemp: 'Temp',
      tipDew: 'Taupunkt',
      tipHum: 'Feuchte',
      tipSun: 'Sonne',
      tipMoon: 'Mond',
      sumNight: 'Nacht',
      sumDark: 'Astronomisch dunkel',
      sumOverall: 'Gesamt Ø',
      sumMoon: 'Mond',
      sumNoDark: 'keine astronomische Dunkelheit',
      sumPartial: 'nur {a} von {b} h mit Daten',
      sumMoonFree: 'Dunkel ohne Mond',
      sumMoonUp: 'Mond die ganze Zeit am Himmel',
      hours: 'h',
      lit: 'beleuchtet',
      dayNight: 'Nacht {a} → {b}',
      dayModel: 'Modell: {m} · stündliche Werte',
      modelThen: ', danach ',
      modelNames: { d2: 'ICON-D2 mit 2,2 km', eu: 'ICON-EU mit 7 km', global: 'ICON global mit rund 11 km', hrrr: 'HRRR (NOAA) mit 3 km', gfs: 'GFS (NOAA) mit rund 13 km' },
      dayEcmwf: ' · Zeile ECMWF: IFS mit 9 km zum Vergleich',
      dayPartial: ' · für diese Nacht liegen nur teilweise Daten vor',
      rowsDay: { wx: 'Wetter', twi: 'Dämmerung', alt: 'Höhe', overall: 'Gesamt %', clouds: 'Wolken %', clouds2: 'ECMWF %', low: 'tief', mid: 'mittel', high: 'hoch', seeing: 'Seeing %', transp: 'AOD', pwv: 'Wasserdampf mm', dust: 'Staub µg/m³', vis: 'Sicht km', precip: 'Regen %', wind: 'Wind', windtxt: 'km/h / Böen', temp: 'Temp', dew: 'Taupunkt', spread: 'Abstand', hum: 'Feuchte' },
      ev: { sunset: 'Sonnenuntergang', astroEnd: 'Beginn astronomische Nacht', astroStart: 'Ende astronomische Nacht', sunrise: 'Sonnenaufgang', moonrise: 'Mondaufgang', moonset: 'Monduntergang', noNight: 'keine astronomische Nacht', darkSpan: 'astronomisch dunkel {a}–{b} ({h} h)', moonFreeShort: ' · ohne Mond {h} h', moonFree: 'dunkel ohne Mond {t}', illum: 'Mond um Mitternacht {p} % beleuchtet' },
      tipVis: 'Sicht',
      tipPrecip: 'Regen',
      tipWx: 'Wetter',
      sumMoonTimes: 'Mond ↑ auf · ↓ unter',
      wx: { 0: 'Klar', 1: 'Überwiegend klar', 2: 'Teilweise bewölkt', 3: 'Bedeckt', 45: 'Nebel', 48: 'Nebel mit Reif', 51: 'Leichter Nieselregen', 53: 'Nieselregen', 55: 'Starker Nieselregen', 56: 'Gefrierender Nieselregen', 57: 'Starker gefrierender Nieselregen', 61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen', 66: 'Gefrierender Regen', 67: 'Starker gefrierender Regen', 71: 'Leichter Schneefall', 73: 'Schneefall', 75: 'Starker Schneefall', 77: 'Schneegriesel', 80: 'Leichte Regenschauer', 81: 'Regenschauer', 82: 'Heftige Regenschauer', 85: 'Schneeschauer', 86: 'Starke Schneeschauer', 95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Starkes Gewitter mit Hagel' }
    },
    en: {
      loading: 'Loading forecast …',
      loaded: 'Forecast for {name} loaded · {model} · times in local time ({utc})',
      srcIcon: 'model DWD ICON',
      srcGfs: 'model NOAA GFS/HRRR',
      srcGfsOnly: 'model NOAA GFS',
      error: 'The forecast could not be loaded: ',
      badCoords: 'Please enter valid coordinates (latitude −90 to 90, longitude −180 to 180).',
      pwWrong: 'Wrong password.',
      pwNeeded: 'Custom coordinates are protected – please enter the password first.',
      mbTitle: 'Weather map by meteoblue',
      mbNoLocation: 'Please choose a location or load the forecast first.',
      pwNoCrypto: 'This browser cannot check the password.',
      noAerosol: 'no data',
      rows: { sun: 'Sun', moon: 'Moon', overall: 'Overall', clouds: 'Clouds', clouds2: 'ECMWF', seeing: 'Seeing', transp: 'Transp.', wind: 'Wind', temp: 'Temp', dew: 'Dew', night: 'Night avg.' },
      now: 'Now',
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      daysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      ratings: ['Very poor', 'Poor', 'Average', 'Good', 'Excellent'],
      compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
      tipOverall: 'Overall',
      tipClouds: 'Clouds',
      tipClouds2: 'Clouds ECMWF',
      tipLayers: 'low {l} · mid {m} · high {h}',
      tipSeeing: 'Seeing (estimate)',
      tipJet: 'jet {j} · shear {s} · ground {g} km/h',
      tipPwv: 'Water vapour (air column)',
      tipDust: 'dust',
      tipTransp: 'Transparency (estimate)',
      tipWind: 'Wind',
      tipGusts: 'gusts',
      tipTemp: 'Temp',
      tipDew: 'Dew',
      tipHum: 'Hum',
      tipSun: 'Sun',
      tipMoon: 'Moon',
      sumNight: 'Night',
      sumDark: 'Astronomically dark',
      sumOverall: 'Overall avg.',
      sumMoon: 'Moon',
      sumNoDark: 'no astronomical darkness',
      sumPartial: 'only {a} of {b} h with data',
      sumMoonFree: 'Dark, moon down',
      sumMoonUp: 'moon up throughout',
      hours: 'h',
      lit: 'lit',
      dayNight: 'Night {a} → {b}',
      dayModel: 'Model: {m} · hourly values',
      modelThen: ', then ',
      modelNames: { d2: 'ICON-D2 at 2.2 km', eu: 'ICON-EU at 7 km', global: 'ICON global at about 11 km', hrrr: 'HRRR (NOAA) at 3 km', gfs: 'GFS (NOAA) at about 13 km' },
      dayEcmwf: ' · ECMWF row: IFS at 9 km for comparison',
      dayPartial: ' · data cover only part of this night',
      rowsDay: { wx: 'Weather', twi: 'Twilight', alt: 'Altitude', overall: 'Overall %', clouds: 'Clouds %', clouds2: 'ECMWF %', low: 'low', mid: 'mid', high: 'high', seeing: 'Seeing %', transp: 'AOD', pwv: 'Water vap. mm', dust: 'Dust µg/m³', vis: 'Vis. km', precip: 'Rain %', wind: 'Wind', windtxt: 'km/h / gusts', temp: 'Temp', dew: 'Dew', spread: 'Spread', hum: 'Hum.' },
      ev: { sunset: 'Sunset', astroEnd: 'Astronomical night begins', astroStart: 'Astronomical night ends', sunrise: 'Sunrise', moonrise: 'Moonrise', moonset: 'Moonset', noNight: 'no astronomical night', darkSpan: 'astronomically dark {a}–{b} ({h} h)', moonFreeShort: ' · moon down {h} h', moonFree: 'dark with the moon down {t}', illum: 'Moon {p} % lit at midnight' },
      tipVis: 'Visibility',
      tipPrecip: 'Rain',
      tipWx: 'Weather',
      sumMoonTimes: 'Moon ↑ rise · ↓ set',
      wx: { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Heavy freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light rain showers', 81: 'Rain showers', 82: 'Violent rain showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail' }
    }
  }[LANG];

  /* ------------------------------------------------------------------ *
   * Astronomy, local time and password check: astro-tools/js/astro-core.js         *
   * ------------------------------------------------------------------ */
  var A = window.SvAstro;
  var RAD = A.RAD, clamp = A.clamp, sunAltitude = A.sunAltitude, moonAltitude = A.moonAltitude, moonIllumination = A.moonIllumination,
    crossings = A.crossings, TWI = A.TWI, twilightClass = A.twilightClass, drawMoonIcon = A.drawMoonIcon,
    pad = A.pad, localDate = A.localDate, hhmm = A.hhmm, offsetFn = A.offsetFn, fromLocal = A.fromLocal, nightKeyOf = A.nightKeyOf;

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

  function rating(s) {
    if (s == null) return '–';
    return T.ratings[s >= 0.85 ? 4 : s >= 0.65 ? 3 : s >= 0.45 ? 2 : s >= 0.25 ? 1 : 0];
  }

  /* ------------------------------------------------------------------ *
   * Formatting                                                         *
   * ------------------------------------------------------------------ */
  function dayLabel(sec, offset) { var d = localDate(sec, offset); return T.days[d.getUTCDay()] + ' ' + pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.'; }
  function utcLabel(offset) {
    var h = offset / 3600, sign = h < 0 ? '−' : '+', a = Math.abs(h);
    return 'UTC' + sign + (a % 1 ? Math.floor(a) + ':' + pad(Math.round((a % 1) * 60)) : a);
  }
  function compass(deg) { return deg == null ? '' : T.compass[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }
  function temp(c, unit) { return c == null ? null : (unit === 'f' ? c * 9 / 5 + 32 : c); }
  function num(v, digits) { return v == null ? '–' : (digits ? v.toFixed(digits) : Math.round(v)).toString().replace('.', LANG === 'de' ? ',' : '.').replace('-', '\u2212'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ------------------------------------------------------------------ *
   * State and controls                                                 *
   * ------------------------------------------------------------------ */
  var el = {
    location: document.getElementById('aw-location'),
    lat: document.getElementById('aw-lat'),
    lon: document.getElementById('aw-lon'),
    unlock: document.getElementById('aw-unlock'),
    pw: document.getElementById('aw-pw'),
    pwOk: document.getElementById('aw-pw-ok'),
    pwCancel: document.getElementById('aw-pw-cancel'),
    pwMsg: document.getElementById('aw-pw-msg'),
    mbConsent: document.getElementById('aw-mb-consent'),
    mbLoad: document.getElementById('aw-mb-load'),
    mbMsg: document.getElementById('aw-mb-msg'),
    mbFrame: document.getElementById('aw-mb-frame'),
    mbLink: document.getElementById('aw-mb-link'),
    plannerLink: document.getElementById('aw-planner-link'),
    unitC: document.getElementById('aw-unit-c'),
    unitF: document.getElementById('aw-unit-f'),
    load: document.getElementById('aw-load'),
    status: document.getElementById('aw-status'),
    scroll: document.getElementById('aw-scroll'),
    wrap: document.getElementById('aw-chart-wrap'),
    canvas: document.getElementById('aw-canvas'),
    tip: document.getElementById('aw-tip'),
    summary: document.getElementById('aw-summary'),
    day: document.getElementById('aw-day'),
    dayPrev: document.getElementById('aw-day-prev'),
    dayNext: document.getElementById('aw-day-next'),
    dayLabel: document.getElementById('aw-day-label'),
    dayModel: document.getElementById('aw-day-model'),
    dayScroll: document.getElementById('aw-day-scroll'),
    dayWrap: document.getElementById('aw-day-wrap'),
    dayCanvas: document.getElementById('aw-day-canvas'),
    dayTip: document.getElementById('aw-day-tip'),
    dayEvents: document.getElementById('aw-day-events')
  };

  var state = { unit: 'c', data: null, layout: null, night: null, dayLayout: null, scrollNow: false, scrollDay: false, unlocked: false, lastPreset: null, loadAfterUnlock: false, statusBefore: null, mbOn: false };

  function locationName() {
    var opt = el.location.options[el.location.selectedIndex];
    return opt && opt.value !== 'custom' ? opt.textContent : num(parseFloat(el.lat.value), 3) + ', ' + num(parseFloat(el.lon.value), 3);
  }

  function setCoordsEditable(on) {
    [el.lat, el.lon].forEach(function (f) {
      f.readOnly = !on;
      f.style.background = on ? 'var(--white)' : 'rgba(26,42,58,.06)';
      f.style.cursor = on ? 'text' : 'default';
    });
  }

  function showUnlock() {
    el.unlock.hidden = false;
    el.pwMsg.textContent = '';
    el.pw.value = '';
    el.pw.focus();
  }

  /* custom coordinates sit behind a password (a gate, not security; see astro-tools/js/astro-core.js) */
  function tryUnlock() {
    A.checkPassword(el.pw.value).then(function (ok) {
      el.pw.value = '';
      if (ok === null) { el.pwMsg.textContent = T.pwNoCrypto; return; }
      if (!ok) { el.pwMsg.textContent = T.pwWrong; el.pw.focus(); return; }
      state.unlocked = true; /* until the page is reloaded: no storage, the site allows no new keys */
      el.unlock.hidden = true;
      el.location.value = 'custom';
      setCoordsEditable(true);
      el.lat.focus();
      el.lat.select();
      if (state.loadAfterUnlock) { state.loadAfterUnlock = false; load(); } /* the load that asked for the password */
    });
  }

  function cancelUnlock() {
    state.loadAfterUnlock = false;
    if (el.status.textContent === T.pwNeeded && state.statusBefore != null) el.status.textContent = state.statusBefore;
    el.unlock.hidden = true;
    el.pw.value = '';
    if (el.location.value === 'custom' && state.lastPreset) { el.location.value = state.lastPreset; applyPreset(); }
  }

  /* meteoblue weather map. The iframe sets meteoblue cookies (two of them for a year), so it is a
     two-click embed: nothing is requested before its own button, and it never shows coordinates that
     are still waiting for the password. meteoblue asks for its link to stay next to the widget. */
  var MB_BASE = LANG === 'en' ? 'https://www.meteoblue.com/en/weather/maps/' : 'https://www.meteoblue.com/de/wetter/maps/';

  function mbCoords() {
    if (el.location.value !== 'custom') { var p = el.location.value.split(','); return { lat: +p[0], lon: +p[1] }; }
    return state.data ? { lat: state.data.lat, lon: state.data.lon } : null;
  }

  /* meteoblue's coordinate slug is "31.547N-99.382E", west and south as negative numbers. A "W" or "S"
     suffix is not understood and silently centres the map on the visitor's IP location instead. */
  function mbSlug(c) { return c.lat.toFixed(3) + 'N' + c.lon.toFixed(3) + 'E'; }

  function updateMeteoblue() {
    var c = mbCoords();
    if (!c) return;
    var slug = mbSlug(c);
    el.mbLink.href = MB_BASE + slug + '?utm_source=weather_widget&utm_medium=linkus&utm_content=map&utm_campaign=Weather%2BWidget';
    if (!state.mbOn) return;
    /* parameters as in meteoblue's own embed code for this widget */
    var src = MB_BASE + 'widget/' + slug + '?windAnimation=0&gust=0&satellite=0&satellite=1&cloudsAndPrecipitation=0&cloudsAndPrecipitation=1' +
      '&temperature=0&temperature=1&sunshine=0&sunshine=1&extremeForecastIndex=0&geoloc=fixed&tempunit=' + (state.unit === 'f' ? 'F' : 'C') +
      '&windunit=km%252Fh&lengthunit=metric&zoom=6&autowidth=auto';
    var f = el.mbFrame.querySelector('iframe');
    if (!f) {
      f = document.createElement('iframe');
      f.title = T.mbTitle;
      f.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox');
      f.style.cssText = 'display:block; width:100%; height:500px; border:0; border-radius:var(--radius);';
      el.mbFrame.appendChild(f);
    }
    if (f.getAttribute('src') !== src) f.setAttribute('src', src);
  }

  function loadMeteoblue() {
    if (!mbCoords()) { el.mbMsg.textContent = T.mbNoLocation; return; }
    state.mbOn = true; /* for this page view only: reloading the page asks again */
    el.mbConsent.hidden = true;
    el.mbFrame.hidden = false;
    updateMeteoblue();
  }

  function applyPreset() {
    var v = el.location.value;
    if (v === 'custom') {
      if (state.unlocked) { setCoordsEditable(true); el.lat.focus(); } else showUnlock();
      return;
    }
    state.lastPreset = v;
    el.unlock.hidden = true;
    setCoordsEditable(false);
    var parts = v.split(',');
    el.lat.value = parts[0];
    el.lon.value = parts[1];
    updateMeteoblue();
    updatePlannerLink();
  }

  function setUnit(u, silent) {
    state.unit = u;
    el.unitC.setAttribute('aria-pressed', u === 'c');
    el.unitF.setAttribute('aria-pressed', u === 'f');
    el.unitC.style.opacity = u === 'c' ? '1' : '.55';
    el.unitF.style.opacity = u === 'f' ? '1' : '.55';
    if (!silent) syncUrl();
    if (state.data) render();
    updateMeteoblue();
  }

  /* the observing planner for the same location: planets, moon and the best objects of the night */
  function updatePlannerLink() {
    if (el.plannerLink) el.plannerLink.href = 'observing-planner_' + LANG + '.html?lat=' + encodeURIComponent(el.lat.value) + '&lon=' + encodeURIComponent(el.lon.value);
  }

  /* URL parameters instead of localStorage: the site allows no new storage keys. */
  function syncUrl() {
    if (!window.history || !history.replaceState) return;
    var p = new URLSearchParams(location.search);
    p.set('lat', el.lat.value);
    p.set('lon', el.lon.value);
    if (state.unit === 'f') p.set('unit', 'f'); else p.delete('unit');
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  }

  function readUrl() {
    var p = new URLSearchParams(location.search);
    var lat = parseFloat(p.get('lat')), lon = parseFloat(p.get('lon'));
    if (isFinite(lat) && isFinite(lon)) {
      el.lat.value = lat;
      el.lon.value = lon;
      var match = Array.prototype.find.call(el.location.options, function (o) {
        var q = o.value.split(',');
        return o.value !== 'custom' && Math.abs(parseFloat(q[0]) - lat) < 1e-4 && Math.abs(parseFloat(q[1]) - lon) < 1e-4;
      });
      el.location.value = match ? match.value : 'custom';
      if (match) state.lastPreset = match.value;
    } else {
      applyPreset();
    }
    if (p.get('unit') === 'f') state.unit = 'f';
  }

  el.location.addEventListener('change', applyPreset);
  /* coordinates from a link that match no preset show up locked; editing or loading them asks for the password */
  [el.lat, el.lon].forEach(function (f) {
    f.addEventListener('focus', function () { if (f.readOnly && el.location.value === 'custom' && !state.unlocked) showUnlock(); });
  });
  el.pwOk.addEventListener('click', tryUnlock);
  el.mbLoad.addEventListener('click', loadMeteoblue);
  el.pwCancel.addEventListener('click', cancelUnlock);
  el.pw.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); }
    if (e.key === 'Escape') cancelUnlock();
  });
  el.lat.addEventListener('input', function () { el.location.value = 'custom'; });
  el.lon.addEventListener('input', function () { el.location.value = 'custom'; });
  el.unitC.addEventListener('click', function () { setUnit('c'); });
  el.unitF.addEventListener('click', function () { setUnit('f'); });
  el.load.addEventListener('click', load);

  /* ------------------------------------------------------------------ *
   * Data                                                               *
   * ------------------------------------------------------------------ */
  var HOURLY = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'temperature_2m', 'dew_point_2m',
    'relative_humidity_2m', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'wind_speed_250hPa', 'wind_speed_500hPa',
    'visibility', 'precipitation', 'precipitation_probability', 'weather_code', 'wind_direction_250hPa', 'wind_speed_850hPa', 'wind_direction_850hPa',
    'surface_pressure', 'wind_direction_500hPa', 'wind_speed_700hPa', 'wind_direction_700hPa'];
  /* valid for the preceding hour, not the moment (Open-Meteo docs); everything else is instant */
  var PRECEDING = { wind_gusts_10m: true, precipitation: true, precipitation_probability: true };

  function getJson(url) {
    return fetch(url).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.error) throw new Error(j.reason || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function load() {
    if (el.location.value === 'custom' && !state.unlocked) {
      /* custom coordinates, typed or from a link, are only requested after the password */
      state.loadAfterUnlock = true;
      if (el.status.textContent !== T.pwNeeded) state.statusBefore = el.status.textContent; /* restored on cancel */
      el.status.textContent = T.pwNeeded;
      showUnlock();
      return;
    }
    var lat = parseFloat(el.lat.value), lon = parseFloat(el.lon.value);
    if (!(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
      el.status.textContent = T.badCoords;
      return;
    }
    syncUrl();
    updatePlannerLink();
    el.status.textContent = T.loading;
    el.load.disabled = true;
    var q = 'latitude=' + lat + '&longitude=' + lon + '&forecast_days=7&timeformat=unixtime';
    /* ICON inside the ICON-EU domain (D2 in Central Europe); elsewhere GFS, which Open-Meteo fills
       with HRRR over North America. Checked against airport cloud reports near Starfront over
       30 nights: ICON was clearly the weakest model there. */
    var source = lat >= 29.5 && lat <= 70.5 && lon >= -23.5 && lon <= 62.5 ? 'icon' : 'gfs';
    var weather = getJson('https://api.open-meteo.com/v1/' + (source === 'icon' ? 'dwd-icon' : 'gfs') + '?' + q +
      '&timezone=auto&wind_speed_unit=kmh&hourly=' + HOURLY.join(','));
    var aerosol = getJson('https://air-quality-api.open-meteo.com/v1/air-quality?' + q + '&timezone=auto&hourly=aerosol_optical_depth,dust')
      .catch(function () { return null; }); /* transparency is optional; the chart works without it */
    /* ECMWF clouds and water vapour as a second opinion. The same request brings the high-resolution
       nest, ICON-D2 or HRRR: an hour whose seamless temperature and cloud cover equal the nest's is a nest hour. */
    var compare = getJson('https://api.open-meteo.com/v1/forecast?' + q + '&timezone=auto' +
      '&hourly=cloud_cover,total_column_integrated_water_vapour,temperature_2m&models=ecmwf_ifs,' + (source === 'icon' ? 'icon_d2' : 'ncep_hrrr_conus'))
      .catch(function () { return null; }); /* optional as well */

    Promise.all([weather, aerosol, compare]).then(function (res) {
      var w = res[0], a = res[1], c = res[2] && res[2].hourly, h = w.hourly, aodByTime = {}, dustByTime = {}, ecByTime = {}, pwvByTime = {}, nestT = {}, nestC = {};
      var offAt = offsetFn(w.timezone, w.utc_offset_seconds);
      if (a && a.hourly) a.hourly.time.forEach(function (t, i) { aodByTime[t] = a.hourly.aerosol_optical_depth[i]; if (a.hourly.dust) dustByTime[t] = a.hourly.dust[i]; });
      if (c) {
        /* keys carry model suffixes only where both models have data; otherwise the one left is plain */
        var ec = c.cloud_cover_ecmwf_ifs || c.cloud_cover, pw = c.total_column_integrated_water_vapour_ecmwf_ifs || c.total_column_integrated_water_vapour;
        var nt = c.temperature_2m_icon_d2 || c.temperature_2m_ncep_hrrr_conus, nc = c.cloud_cover_icon_d2 || c.cloud_cover_ncep_hrrr_conus;
        c.time.forEach(function (t, i) {
          if (ec) ecByTime[t] = ec[i];
          if (pw) pwvByTime[t] = pw[i];
          if (nt && nc) { nestT[t] = nt[i]; nestC[t] = nc[i]; }
        });
      }
      var nestSeen = false, nestOver = false;
      var rows = h.time.map(function (t, i) {
        var r = { t: t };
        /* a preceding-hour value stamped t+1h describes the hour from t, the column it is drawn in */
        HOURLY.forEach(function (k) { r[k] = PRECEDING[k] ? (i + 1 < h.time.length ? h[k][i + 1] : null) : h[k][i]; });
        r.aod = aodByTime[t] == null ? null : aodByTime[t];
        r.dust = dustByTime[t] == null ? null : dustByTime[t];
        r.pwv = pwvByTime[t] == null ? null : pwvByTime[t];
        r.cloud_ecmwf = ecByTime[t] == null ? null : ecByTime[t];
        /* nest hours run from the start; once the seamless series has left the nest it does not return,
           so a chance match of temperature and cloud cover later on is not mistaken for one */
        var nestHere = nestT[t] != null && nestC[t] != null && r.temperature_2m != null &&
          Math.abs(nestT[t] - r.temperature_2m) < 0.05 && nestC[t] === r.cloud_cover;
        if (nestSeen && nestT[t] != null && !nestHere) nestOver = true;
        r.nest = nestHere && !nestOver;
        if (r.nest) nestSeen = true;
        var mid = (t + 1800) * 1000;
        r.sun = sunAltitude(mid, lat, lon);
        r.moon = moonAltitude(mid, lat, lon);
        r.illum = moonIllumination(mid);
        r.sClouds = cloudScore(r.cloud_cover);
        r.sClouds2 = cloudScore(r.cloud_ecmwf);
        r.jet = r.wind_speed_250hPa == null && r.wind_speed_500hPa == null ? null : Math.max(r.wind_speed_250hPa || 0, (r.wind_speed_500hPa || 0) * 1.3);
        /* lower end of the shear: 850 hPa (about 1.5 km), or the next level up where that lies in the terrain */
        var low = r.surface_pressure != null && r.surface_pressure < 900 ? (r.surface_pressure < 750 ? 500 : 700) : 850;
        r.shear = windShear(r.wind_speed_250hPa, r.wind_direction_250hPa, r['wind_speed_' + low + 'hPa'], r['wind_direction_' + low + 'hPa']);
        r.sSeeing = seeingScore(r);
        r.sTransp = transparencyScore(r.aod, r.relative_humidity_2m, r.pwv);
        r.sOverall = overallScore(r.sClouds, r.sSeeing, r.sTransp);
        return r;
      });
      state.data = { rows: rows, lat: lat, lon: lon, off: offAt, name: locationName(), source: source, index: {} };
      rows.forEach(function (r, i) { state.data.index[r.t] = i; });
      /* default: the night still running; once the sun is up in the morning, the coming night */
      var nowSec = Date.now() / 1000, keys = nightKeys();
      var nowKey = nightKeyOf(nowSec, offAt);
      if (localDate(nowSec, offAt).getUTCHours() < 12 && sunAltitude(nowSec * 1000, lat, lon) > -0.833) nowKey += 1;
      state.night = keys.indexOf(nowKey) >= 0 ? nowKey : keys[0];
      state.scrollNow = state.scrollDay = true;
      el.status.textContent = T.loaded.replace('{name}', state.data.name).replace('{model}', source === 'icon' ? T.srcIcon : rows.some(function (r) { return r.nest; }) ? T.srcGfs : T.srcGfsOnly)
        .replace('{utc}', utcLabel(offAt(rows[0].t)) + (offAt(rows[rows.length - 1].t) !== offAt(rows[0].t) ? ' → ' + utcLabel(offAt(rows[rows.length - 1].t)) : ''));
      render();
      updateMeteoblue();
    }).catch(function (err) {
      el.status.textContent = T.error + err.message;
    }).then(function () {
      el.load.disabled = false;
    });
  }

  /* ------------------------------------------------------------------ *
   * Drawing                                                            *
   * ------------------------------------------------------------------ */
  var COL = {
    bg: '#10151c', label: '#0b0f14', grid: 'rgba(255,255,255,.06)', gridDay: 'rgba(255,255,255,.18)',
    text: '#9aa7b6', textBright: '#e4e9ef', sunLine: '#d9c24a', sunFill: 'rgba(200,170,50,.45)', moonLine: 'rgba(230,232,236,.85)',
    temp: '#e3a33b', dew: '#3fa9e6', now: '#e5484d', dayBar: '#1f6fd6', noData: '#262c34'
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

  function spans(list, off) { return list.map(function (p) { return hhmm(p[0], off) + '–' + hhmm(p[1], off); }).join(' · '); }

  function render() {
    var d = state.data, rows = d.rows, n = rows.length, off = d.off, unit = state.unit;
    var LEFT = 72, RIGHT = 12;
    var colW = Math.max(4.5, (el.scroll.clientWidth - LEFT - RIGHT) / n); /* fits a desktop column, scrolls on phones */
    var W = Math.round(LEFT + RIGHT + colW * n);

    var y = 0, R = {};
    function band(key, h) { R[key] = [y, y + h]; y += h; }
    band('moons', 24); band('times', 26); band('sky', 50); band('ticks', 18);
    band('overall', 15); band('clouds', 15); band('clouds2', 15); band('seeing', 15); band('transp', 15); y += 8;
    band('wind', 36); band('temp', 84); band('days', 24); band('rating', 32);
    var H = y;

    var dpr = window.devicePixelRatio || 1, cv = el.canvas, ctx = cv.getContext('2d');
    el.wrap.style.width = W + 'px'; /* as wide as the chart, so the sticky label copy can travel all the way */
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.layout = { LEFT: LEFT, colW: colW, H: H, R: R };

    var t0 = rows[0].t, span = n * 3600;
    function xOf(sec) { return LEFT + (sec - t0) / 3600 * colW; }

    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);

    /* daylight tint behind everything above the day bar */
    rows.forEach(function (r, i) {
      var k = clamp((r.sun + 18) / 18, 0, 1);
      if (k > 0) { ctx.fillStyle = 'rgba(120,150,190,' + (0.10 * k) + ')'; ctx.fillRect(LEFT + i * colW, R.moons[0], colW + 0.5, R.temp[1]); }
    });

    ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';

    /* grid: hour ticks and day boundaries */
    rows.forEach(function (r, i) {
      var h = localDate(r.t, off).getUTCHours(), x = LEFT + i * colW;
      if (h % 6 === 0) {
        ctx.fillStyle = h === 0 ? COL.gridDay : COL.grid;
        ctx.fillRect(Math.round(x), R.sky[0], 1, R.temp[1] - R.sky[0]);
        ctx.fillStyle = COL.text; ctx.textAlign = 'center';
        ctx.fillText(pad(h), x, (R.ticks[0] + R.ticks[1]) / 2);
      }
    });

    /* weather symbols between the hour labels: the most severe code of the six hours around 03, 09, 15, 21 */
    ctx.font = '11px ' + EMOJI_FONT; ctx.textAlign = 'center';
    rows.forEach(function (r, i) {
      if (localDate(r.t, off).getUTCHours() % 6 !== 3) return;
      var worst = null;
      for (var k = Math.max(0, i - 3); k < Math.min(n, i + 3); k++) {
        if (rows[k].weather_code != null && (worst == null || rows[k].weather_code > worst)) worst = rows[k].weather_code;
      }
      ctx.fillText(wxSymbol(worst, r.sun < -0.833), LEFT + i * colW, (R.ticks[0] + R.ticks[1]) / 2 + 1);
    });
    ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';

    /* moon phase and illumination above each culmination, i.e. the top of the moon curve (10-minute steps) */
    var my = (R.moons[0] + R.moons[1]) / 2, prevAlt = null, climbing = false;
    for (var mt = t0; mt <= t0 + span; mt += 600) {
      var ma = moonAltitude(mt * 1000, d.lat, d.lon);
      if (prevAlt != null) {
        if (climbing && ma < prevAlt) {
          var tTop = mt - 600, il = moonIllumination(tTop * 1000), xm = xOf(tTop), roomRight = xm + 50 < W - RIGHT;
          drawMoonIcon(ctx, xm, my, 7, il.phase, il.fraction);
          ctx.fillStyle = COL.text; ctx.textAlign = roomRight ? 'left' : 'right';
          ctx.fillText(Math.round(il.fraction * 100) + ' %', roomRight ? xm + 11 : xm - 11, my);
        }
        climbing = ma > prevAlt;
      }
      prevAlt = ma;
    }

    /* sun and moon altitude, sampled every 15 minutes */
    var skyTop = R.sky[0] + 6, skyBottom = R.sky[1] - 4;
    function yAlt(a) { return skyBottom - clamp(a, 0, 90) / 90 * (skyBottom - skyTop); }
    var samples = [];
    for (var s = t0; s <= t0 + span; s += 900) samples.push(s);

    ctx.beginPath(); ctx.moveTo(xOf(t0), skyBottom);
    samples.forEach(function (s) { ctx.lineTo(xOf(s), yAlt(sunAltitude(s * 1000, d.lat, d.lon))); });
    ctx.lineTo(xOf(t0 + span), skyBottom); ctx.closePath();
    ctx.fillStyle = COL.sunFill; ctx.fill();
    ctx.beginPath();
    samples.forEach(function (s, i) { var yy = yAlt(sunAltitude(s * 1000, d.lat, d.lon)); if (i) ctx.lineTo(xOf(s), yy); else ctx.moveTo(xOf(s), yy); });
    ctx.strokeStyle = COL.sunLine; ctx.lineWidth = 1.2; ctx.stroke();

    ctx.beginPath();
    samples.forEach(function (s, i) { var yy = yAlt(moonAltitude(s * 1000, d.lat, d.lon)); if (i) ctx.lineTo(xOf(s), yy); else ctx.moveTo(xOf(s), yy); });
    ctx.strokeStyle = COL.moonLine; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(LEFT, skyBottom, W - LEFT - RIGHT, 1);

    /* rise and set times of sun and moon, each label centred on its moment, with a hairline down
       to the horizon so it can be checked against the curve. Sun centre and moon upper limb at
       −0.833°, the same definition as the night table and the detail chart. */
    function riseSet(fn, rowY, colour) {
      var lastRight = -1e9;
      crossings(fn, t0, t0 + span, 60, -0.833).forEach(function (c) {
        var x = xOf(c.t), txt = hhmm(c.t, off), tw = ctx.measureText(txt).width;
        ctx.globalAlpha = 0.45; ctx.fillStyle = colour; ctx.fillRect(Math.round(x), R.times[1], 1, skyBottom - R.times[1]); ctx.globalAlpha = 1;
        var xl = clamp(x, LEFT + tw / 2 + 1, W - RIGHT - tw / 2);
        if (xl - tw / 2 - 4 < lastRight) return; /* too close to the previous label: the line still marks it */
        ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.fillText(txt, xl, rowY);
        lastRight = xl + tw / 2;
      });
    }
    riseSet(function (sec) { return sunAltitude(sec * 1000, d.lat, d.lon); }, R.times[0] + 7, COL.sunLine);
    riseSet(function (sec) { return moonAltitude(sec * 1000, d.lat, d.lon); }, R.times[0] + 19, COL.moonLine);

    /* score rows */
    [['overall', 'sOverall'], ['clouds', 'sClouds'], ['clouds2', 'sClouds2'], ['seeing', 'sSeeing'], ['transp', 'sTransp']].forEach(function (pair) {
      var b = R[pair[0]];
      rows.forEach(function (r, i) { ctx.fillStyle = scoreColour(r[pair[1]]); ctx.fillRect(LEFT + i * colW, b[0] + 1, colW + 0.5, b[1] - b[0] - 2); });
    });

    /* wind: one marker every few hours so they never overlap */
    var step = Math.max(1, Math.ceil(22 / colW)), wy = R.wind[0] + 12;
    ctx.textAlign = 'center';
    rows.forEach(function (r, i) {
      if (i % step) return;
      var x = LEFT + (i + 0.5) * colW, v = r.wind_speed_10m;
      ctx.beginPath(); ctx.arc(x, wy, 8, 0, 2 * Math.PI); ctx.fillStyle = windColour(v); ctx.fill();
      if (r.wind_direction_10m != null) {
        var ang = (r.wind_direction_10m + 180) * RAD; /* arrow points where the wind blows to */
        ctx.save(); ctx.translate(x, wy); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(0, 5.5); ctx.lineTo(0, -5.5); ctx.moveTo(-2.8, -2.5); ctx.lineTo(0, -5.5); ctx.lineTo(2.8, -2.5);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = COL.text; ctx.fillText(num(v), x, R.wind[1] - 6);
    });

    /* temperature and dew point */
    var tv = [];
    rows.forEach(function (r) { tv.push(temp(r.temperature_2m, unit), temp(r.dew_point_2m, unit)); });
    tv = tv.filter(function (v) { return v != null; });
    var tMin = Math.min.apply(null, tv) - 2, tMax = Math.max.apply(null, tv) + 2;
    var ty0 = R.temp[0] + 10, ty1 = R.temp[1] - 8;
    function yT(v) { return ty1 - (v - tMin) / (tMax - tMin) * (ty1 - ty0); }
    [['temperature_2m', COL.temp], ['dew_point_2m', COL.dew]].forEach(function (pair) {
      ctx.beginPath();
      var started = false;
      rows.forEach(function (r, i) {
        var v = temp(r[pair[0]], unit); if (v == null) return;
        var x = LEFT + (i + 0.5) * colW;
        if (started) ctx.lineTo(x, yT(v)); else { ctx.moveTo(x, yT(v)); started = true; }
      });
      ctx.strokeStyle = pair[1]; ctx.lineWidth = 1.6; ctx.stroke();
    });

    /* daily extremes as labels */
    var byDay = {};
    rows.forEach(function (r, i) { var k = Math.floor((r.t + off(r.t)) / 86400); (byDay[k] = byDay[k] || []).push(i); });
    Object.keys(byDay).forEach(function (k) {
      var idx = byDay[k];
      function extreme(key, pick) {
        var best = null;
        idx.forEach(function (i) { var v = rows[i][key]; if (v != null && (best == null || pick(v, rows[best][key]))) best = i; });
        return best;
      }
      [[extreme('temperature_2m', function (a, b) { return a > b; }), 'temperature_2m', COL.temp, -8],
        [extreme('temperature_2m', function (a, b) { return a < b; }), 'temperature_2m', COL.temp, -8],
        [extreme('dew_point_2m', function (a, b) { return a < b; }), 'dew_point_2m', COL.dew, 9]].forEach(function (e) {
        if (e[0] == null) return;
        var v = temp(rows[e[0]][e[1]], unit), x = LEFT + (e[0] + 0.5) * colW;
        ctx.fillStyle = e[2]; ctx.textAlign = 'center';
        ctx.fillText(num(v) + '°', clamp(x, LEFT + 12, W - RIGHT - 12), clamp(yT(v) + e[3], R.temp[0] + 5, R.temp[1] - 4));
      });
    });

    /* day bar */
    ctx.fillStyle = COL.dayBar; ctx.fillRect(LEFT, R.days[0], W - LEFT - RIGHT, R.days[1] - R.days[0]);
    Object.keys(byDay).forEach(function (k) {
      var idx = byDay[k], x0 = LEFT + idx[0] * colW, x1 = LEFT + (idx[idx.length - 1] + 1) * colW;
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(Math.round(x0), R.days[0], 1, R.days[1] - R.days[0]);
      if (x1 - x0 > 60) {
        var dd = localDate(rows[idx[0]].t, off);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.fillText(T.daysLong[dd.getUTCDay()] + ' ' + pad(dd.getUTCDate()) + '.' + pad(dd.getUTCMonth() + 1) + '.', (x0 + x1) / 2, (R.days[0] + R.days[1]) / 2);
        ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';
      }
    });

    /* night rating under the day bar: the hourly overall score as a colour gradient, faded out by
       daylight, and each night's rating from the table over the middle of its darkness */
    var grad = ctx.createLinearGradient(LEFT, 0, LEFT + n * colW, 0);
    rows.forEach(function (r, i) { grad.addColorStop((i + 0.5) / n, ratingColour(r.sOverall, clamp((-r.sun - 12) / 6, 0, 1))); });
    ctx.fillStyle = grad; ctx.fillRect(LEFT, R.rating[0] + 17, n * colW, R.rating[1] - R.rating[0] - 20);
    var byNight = {}, ry = R.rating[0] + 9; /* text above the strip, so it never hides the gradient */
    rows.forEach(function (r) { var k = nightKeyOf(r.t, off); (byNight[k] = byNight[k] || []).push(r); });
    ctx.font = '600 10px system-ui, -apple-system, Segoe UI, sans-serif'; ctx.textAlign = 'center';
    Object.keys(byNight).forEach(function (k) {
      var st = nightStats(+k, byNight[k]);
      if (st.from == null || st.avg == null) return;
      var xc = (Math.max(LEFT, xOf(st.from)) + Math.min(LEFT + n * colW, xOf(st.to))) / 2;
      var pct = Math.round(st.avg * 100) + ' %', full = rating(st.avg) + ' ' + pct;
      var txt = ctx.measureText(full).width + 10 <= 22 * colW ? full : pct, tw = ctx.measureText(txt).width + 8;
      xc = clamp(xc, LEFT + tw / 2, LEFT + n * colW - tw / 2);
      ctx.fillStyle = ratingColour(st.avg, 1); ctx.fillText(txt, xc, ry);
    });
    ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';

    /* "now" marker */
    var nowSec = Date.now() / 1000;
    if (nowSec >= t0 && nowSec <= t0 + span) {
      var xn = xOf(nowSec), label = T.now + ' ' + hhmm(Math.round(nowSec), off);
      ctx.fillStyle = COL.now; ctx.fillRect(Math.round(xn), R.sky[0], 1.5, R.temp[1] - R.sky[0]);
      var lw = ctx.measureText(label).width + 8;
      var xl = clamp(xn, LEFT + lw / 2 + 2, W - RIGHT - lw / 2); /* keep the label clear of the label column */
      ctx.fillRect(xl - lw / 2, R.sky[0] + 1, lw, 13);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, xl, R.sky[0] + 7.5);
    }

    /* label column last, so it covers everything scrolled beneath it */
    ctx.fillStyle = COL.label; ctx.fillRect(0, 0, LEFT - 2, H);
    ctx.textAlign = 'right'; ctx.fillStyle = COL.text;
    var labels = [['times', T.rows.sun, -6, COL.sunLine], ['times', T.rows.moon, 6, COL.moonLine], ['overall', T.rows.overall], ['clouds', T.rows.clouds], ['clouds2', T.rows.clouds2],
      ['seeing', T.rows.seeing], ['transp', T.rows.transp], ['wind', T.rows.wind, -4], ['temp', T.rows.temp, -10, COL.temp], ['temp', T.rows.dew, 10, COL.dew], ['days', ''], ['rating', T.rows.night, 0]];
    labels.forEach(function (l) {
      ctx.fillStyle = l[3] || COL.text;
      ctx.fillText(l[1], LEFT - 8, (R[l[0]][0] + R[l[0]][1]) / 2 + (l[2] || 0));
    });

    stickyLabels(el.wrap, cv, LEFT - 2, H);
    /* after loading, bring "now" into view where the chart is wider than the screen */
    if (state.scrollNow) {
      state.scrollNow = false;
      if (nowSec >= t0 && nowSec <= t0 + span) el.scroll.scrollLeft = Math.max(0, xOf(nowSec) - LEFT - 12);
    }

    renderSummary();
    el.canvas.setAttribute('aria-label', el.status.textContent);
    renderDay();
  }

  /* ------------------------------------------------------------------ *
   * Tooltip                                                            *
   * ------------------------------------------------------------------ */
  /* which model delivered an hour: the nest where it matched, ICON global where ICON has no visibility */
  function modelId(r) {
    if (state.data.source === 'icon') return r.nest ? 'd2' : r.visibility != null ? 'eu' : 'global';
    return r.nest ? 'hrrr' : 'gfs';
  }
  function modelShort(r) { return { d2: 'ICON-D2', eu: 'ICON-EU', global: 'ICON global', hrrr: 'HRRR', gfs: 'GFS' }[modelId(r)]; }

  function tipHtml(i) {
    var d = state.data, r = d.rows[i], off = d.off, u = state.unit === 'f' ? '°F' : '°C';
    var lines = [
      '<strong>' + esc(dayLabel(r.t, off)) + ' ' + hhmm(r.t, off) + '</strong>',
      r.weather_code == null ? null : T.tipWx + ': ' + esc(T.wx[r.weather_code] || r.weather_code),
      T.tipOverall + ': ' + rating(r.sOverall) + (r.sOverall == null ? '' : ' (' + Math.round(r.sOverall * 100) + ' %)'),
      T.tipClouds + ' (' + modelShort(r) + '): ' + num(r.cloud_cover) + ' % · ' + T.tipLayers.replace('{l}', num(r.cloud_cover_low)).replace('{m}', num(r.cloud_cover_mid)).replace('{h}', num(r.cloud_cover_high)),
      r.cloud_ecmwf == null ? null : T.tipClouds2 + ': ' + num(r.cloud_ecmwf) + ' %',
      T.tipSeeing + ': ' + rating(r.sSeeing) + ' · ' + T.tipJet.replace('{j}', num(r.jet)).replace('{s}', num(r.shear)).replace('{g}', num(r.wind_speed_10m)),
      T.tipTransp + ': ' + (r.aod == null ? T.noAerosol : rating(r.sTransp) + ' (AOD ' + num(r.aod, 2) + (r.dust ? ' · ' + T.tipDust + ' ' + num(r.dust) + ' µg/m³' : '') + ')'),
      r.pwv == null ? null : T.tipPwv + ': ' + num(r.pwv) + ' mm',
      T.tipWind + ': ' + num(r.wind_speed_10m) + ' km/h ' + compass(r.wind_direction_10m) + ' · ' + T.tipGusts + ' ' + num(r.wind_gusts_10m),
      r.visibility == null ? null : T.tipVis + ': ' + num(r.visibility / 1000, r.visibility < 10000 ? 1 : 0) + ' km',
      r.precipitation_probability == null ? null : T.tipPrecip + ': ' + num(r.precipitation_probability) + ' % · ' + num(r.precipitation, 1) + ' mm',
      T.tipTemp + ' ' + num(temp(r.temperature_2m, state.unit)) + u + ' · ' + T.tipDew + ' ' + num(temp(r.dew_point_2m, state.unit)) + u + ' · ' + T.tipHum + ' ' + num(r.relative_humidity_2m) + ' %',
      T.tipSun + ' ' + num(r.sun) + '° · ' + T.tipMoon + ' ' + num(r.moon) + '° (' + Math.round(r.illum.fraction * 100) + ' % ' + T.lit + ')'
    ];
    return lines.filter(function (l) { return l != null; }).join('<br>');
  }

  function showTip(clientX, clientY) {
    if (!state.data || !state.layout) return;
    var rect = el.canvas.getBoundingClientRect(), L = state.layout;
    var x = clientX - rect.left, i = Math.floor((x - L.LEFT) / L.colW);
    if (x < L.LEFT || i < 0 || i >= state.data.rows.length) { el.tip.hidden = true; return; }
    el.tip.innerHTML = tipHtml(i);
    el.tip.hidden = false;
    var wrapRect = el.wrap.getBoundingClientRect(), tw = el.tip.offsetWidth, th = el.tip.offsetHeight;
    var left = clientX - wrapRect.left + 14, top = clientY - wrapRect.top + 14;
    var visibleRight = el.scroll.scrollLeft + el.scroll.clientWidth;
    if (left + tw > visibleRight) left = clientX - wrapRect.left - tw - 14;
    if (top + th > L.H) top = Math.max(0, L.H - th);
    el.tip.style.left = Math.max(el.scroll.scrollLeft, left) + 'px';
    el.tip.style.top = top + 'px';
  }

  el.canvas.addEventListener('mousemove', function (e) { showTip(e.clientX, e.clientY); });
  el.canvas.addEventListener('mouseleave', function () { el.tip.hidden = true; });
  el.canvas.addEventListener('click', function (e) { showTip(e.clientX, e.clientY); });

  /* ------------------------------------------------------------------ *
   * Night summary (also the text alternative to the chart)             *
   * ------------------------------------------------------------------ */
  /* darkness and dark-time-weighted overall score of one night (noon to noon), shared by the table
     and the week chart. Darkness comes from the exact −18° crossings, so half an hour of it in a
     summer night is not missed. */
  function nightStats(key, nightRows) {
    var d = state.data, st = A.darkness(key, d.lat, d.lon, d.off);
    st.avg = null;
    st.covered = 0;
    if (st.from == null) return st;
    var sum = 0;
    nightRows.forEach(function (r) {
      var part = Math.min(r.t + 3600, st.to) - Math.max(r.t, st.from); /* hourly scores weighted by how much of each hour is dark */
      if (part > 0 && r.sOverall != null) { sum += part * r.sOverall; st.covered += part; }
    });
    if (st.covered > 0) st.avg = sum / st.covered;
    return st;
  }

  function renderSummary() {
    var d = state.data, off = d.off, nights = {}, order = [];
    d.rows.forEach(function (r) {
      var key = nightKeyOf(r.t, off);
      if (!nights[key]) { nights[key] = []; order.push(key); }
      nights[key].push(r);
    });
    var items = order.map(function (key) {
      var st = nightStats(key, nights[key]), from = st.from, to = st.to;
      var it = { key: key, label: dayLabel(st.evening, off) + ' → ' + dayLabel(st.next, off), dark: T.sumNoDark, free: '–', overall: '–', moon: '–' };
      if (from != null) {
        it.dark = hhmm(from, off) + '–' + hhmm(to, off) + ' (' + num((to - from) / 3600, 1) + ' ' + T.hours + ')';
        it.free = st.moonFree.length ? spans(st.moonFree, off) + ' (' + num(st.moonFreeSec / 3600, 1) + ' ' + T.hours + ')' : T.sumMoonUp;
        if (st.avg != null) {
          it.overall = '<strong>' + rating(st.avg) + '</strong> (' + Math.round(st.avg * 100) + ' %)';
          if (st.covered < to - from - 900) {
            it.overall += '<br><span style="font-size:.78rem; color:var(--text-light);">' +
              esc(T.sumPartial.replace('{a}', num(st.covered / 3600, 1)).replace('{b}', num((to - from) / 3600, 1))) + '</span>';
          }
        }
        it.moon = Math.round(moonIllumination((from + to) / 2 * 1000).fraction * 100) + ' % ' + T.lit;
      }
      /* moonrise and moonset between noon and noon, same definition as the charts */
      it.moonTimes = crossings(function (sec) { return moonAltitude(sec * 1000, d.lat, d.lon); }, st.evening, st.next, 60, -0.833)
        .map(function (c) { return (c.rising ? '↑ ' : '↓ ') + hhmm(c.t, off); }).join(' · ') || '–';
      return it;
    });
    if (el.summary.clientWidth < 560) {
      /* narrow screens: one card per night instead of a table that has to be scrolled sideways */
      el.summary.innerHTML = '<div style="margin:1rem 0 0;">' + items.map(function (it) {
        var sel = it.key === state.night;
        function lab(k) { return '<span style="color:var(--text-light);">' + T[k] + ':</span> '; }
        return '<div data-night="' + it.key + '" style="cursor:pointer; margin:.5rem 0 0; padding:.6rem .75rem; border-radius:var(--radius); border:1px solid ' +
          (sel ? 'rgba(52,152,219,.55); background:rgba(52,152,219,.10);' : 'rgba(26,42,58,.12);') + '">' +
          '<div style="font-weight:600; color:var(--primary); margin:0 0 .3rem;">' + esc(it.label) + '</div>' +
          '<div style="font-size:.86rem; line-height:1.6;">' + lab('sumOverall') + it.overall + '<br>' + lab('sumDark') + it.dark + '<br>' +
          lab('sumMoonFree') + it.free + '<br>' + lab('sumMoon') + it.moon + ' · ' + it.moonTimes + '</div></div>';
      }).join('') + '</div>';
    } else {
      var html = '<table style="width:100%; min-width:760px; border-collapse:collapse; font-size:.88rem;"><thead><tr style="background:rgba(26,42,58,.06);">' +
        ['sumNight', 'sumDark', 'sumMoonFree', 'sumOverall', 'sumMoon', 'sumMoonTimes'].map(function (k) {
          return '<th style="text-align:left; padding:.45rem .6rem; font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--primary); border-bottom:1px solid rgba(26,42,58,.18);">' + T[k] + '</th>';
        }).join('') + '</tr></thead><tbody>';
      items.forEach(function (it, idx) {
        var cell = 'padding:.45rem .6rem; border-bottom:1px solid rgba(26,42,58,.07);';
        var shade = it.key === state.night ? ' background:rgba(52,152,219,.16);' : idx % 2 ? ' background:rgba(26,42,58,.028);' : '';
        html += '<tr data-night="' + it.key + '" style="cursor:pointer;">' +
          [esc(it.label), it.dark, it.free, it.overall, it.moon].map(function (v) { return '<td style="' + cell + shade + '">' + v + '</td>'; }).join('') +
          '<td style="' + cell + shade + ' white-space:nowrap;">' + it.moonTimes + '</td></tr>';
      });
      el.summary.innerHTML = '<div style="overflow-x:auto; -webkit-overflow-scrolling:touch; margin:1rem 0 0; border:1px solid rgba(26,42,58,.12); border-radius:var(--radius);">' + html + '</tbody></table></div>';
    }
    Array.prototype.forEach.call(el.summary.querySelectorAll('[data-night]'), function (row) {
      row.addEventListener('click', function () { selectNight(parseInt(row.getAttribute('data-night'), 10)); });
    });
  }

  /* ------------------------------------------------------------------ *
   * Night in detail: one night, noon to noon, hour by hour             *
   * ------------------------------------------------------------------ */
  function nightKeys() {
    var d = state.data, off = d.off, seen = {}, keys = [];
    d.rows.forEach(function (r) {
      var k = nightKeyOf(r.t, off);
      if (!seen[k]) { seen[k] = true; keys.push(k); }
    });
    return keys;
  }

  function renderDay() {
    var d = state.data;
    if (!d || state.night == null) return;
    var off = d.off, unit = state.unit, lat = d.lat, lon = d.lon, keys = nightKeys(), key = state.night;
    /* noon to noon in local time: 23 or 25 hours in a night with a daylight-saving switch */
    var start = fromLocal(key * 86400 + 43200, off), end = fromLocal((key + 1) * 86400 + 43200, off), nowSec = Date.now() / 1000;
    var nH = Math.round((end - start) / 3600), cols = [];
    for (var j = 0; j < nH; j++) { var ii = d.index[start + j * 3600]; cols.push(ii == null ? null : d.rows[ii]); }
    var have = cols.filter(Boolean);

    el.day.hidden = false;
    var pos = keys.indexOf(key);
    el.dayPrev.disabled = pos <= 0;
    el.dayNext.disabled = pos < 0 || pos >= keys.length - 1;
    el.dayPrev.style.opacity = el.dayPrev.disabled ? '.4' : '1';
    el.dayNext.style.opacity = el.dayNext.disabled ? '.4' : '1';
    var label = T.dayNight.replace('{a}', dayLabel(start, off)).replace('{b}', dayLabel(end, off));
    el.dayLabel.textContent = label;

    /* the models that delivered this night's hours, in order (Open-Meteo blends them) */
    var seq = [];
    have.forEach(function (r) { var m = modelId(r); if (seq[seq.length - 1] !== m) seq.push(m); });
    el.dayModel.textContent = (seq.length ? T.dayModel.replace('{m}', seq.map(function (m) { return T.modelNames[m]; }).join(T.modelThen)) : '') +
      (have.some(function (r) { return r.cloud_ecmwf != null; }) ? T.dayEcmwf : '') + (have.length < nH ? T.dayPartial : '');

    var LEFT = 104, RIGHT = 10;
    var colW = Math.max(34, (el.dayScroll.clientWidth - LEFT - RIGHT) / nH);
    var W = Math.round(LEFT + RIGHT + colW * nH);
    var y = 0, R = {};
    function band(k, h) { R[k] = [y, y + h]; y += h; }
    function mid(b) { return (b[0] + b[1]) / 2; }
    band('hours', 18); band('wx', 20); band('twi', 22); band('sunEv', 15); band('moonEv', 15); band('alt', 80); band('rating', 32); y += 2;
    ['overall', 'clouds', 'low', 'mid', 'high', 'clouds2', 'seeing', 'transp', 'pwv', 'dust', 'vis', 'precip'].forEach(function (k) { band(k, 19); });
    y += 6;
    band('wind', 26); band('windtxt', 17); band('temp', 17); band('dew', 17); band('spread', 17); band('hum', 17);
    var H = y + 4;

    var dpr = window.devicePixelRatio || 1, cv = el.dayCanvas, ctx = cv.getContext('2d');
    el.dayWrap.style.width = W + 'px';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.dayLayout = { LEFT: LEFT, colW: colW, H: H, cols: cols };
    function xOf(sec) { return LEFT + (sec - start) / 3600 * colW; }
    function sunAt(sec) { return sunAltitude(sec * 1000, lat, lon); }
    function moonAt(sec) { return moonAltitude(sec * 1000, lat, lon); }

    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';

    /* twilight band and a matching tint behind the altitude plot, every 5 minutes */
    var minSun = 90;
    for (var s = start; s < end; s += 300) {
      var alt = sunAt(s + 150), cls = twilightClass(alt), x0 = xOf(s), w5 = colW / 12 + 0.5;
      minSun = Math.min(minSun, alt);
      ctx.fillStyle = TWI[cls]; ctx.fillRect(x0, R.twi[0] + 2, w5, R.twi[1] - R.twi[0] - 4);
      if (cls < 4) { ctx.fillStyle = 'rgba(120,150,190,' + (0.035 * (4 - cls)) + ')'; ctx.fillRect(x0, R.alt[0], w5, R.alt[1] - R.alt[0]); }
    }

    /* hour grid */
    ctx.textAlign = 'center';
    for (var h = 0; h < nH; h++) {
      var xh = LEFT + h * colW, hr = localDate(start + h * 3600, off).getUTCHours();
      ctx.fillStyle = hr === 0 ? COL.gridDay : COL.grid;
      ctx.fillRect(Math.round(xh), R.twi[0], 1, R.hum[1] - R.twi[0]);
      ctx.fillStyle = COL.text; ctx.fillText(pad(hr), xh + colW / 2, mid(R.hours));
    }
    ctx.font = '13px ' + EMOJI_FONT;
    cols.forEach(function (r, i) {
      if (r && r.weather_code != null) ctx.fillText(wxSymbol(r.weather_code, r.sun < -0.833), LEFT + (i + 0.5) * colW, mid(R.wx) + 1);
    });
    ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';

    /* sun and moon as hills above the horizon, as in the week chart */
    var aTop = R.alt[0] + 6, aBot = R.alt[1] - 6;
    function yA(a) { return aBot - clamp(a, 0, 90) / 90 * (aBot - aTop); }
    [30, 60].forEach(function (a) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(LEFT, Math.round(yA(a)), W - LEFT - RIGHT, 1); });
    function hill(fn, fill, colour, dash) {
      ctx.beginPath(); ctx.moveTo(xOf(start), aBot);
      for (var s2 = start; s2 <= end; s2 += 300) ctx.lineTo(xOf(s2), yA(fn(s2)));
      ctx.lineTo(xOf(end), aBot); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      ctx.beginPath();
      var pen = false;
      for (var s3 = start; s3 <= end; s3 += 300) {
        var a = fn(s3);
        if (a <= 0) { pen = false; continue; }
        if (pen) ctx.lineTo(xOf(s3), yA(a)); else { ctx.moveTo(xOf(s3), yA(a)); pen = true; }
      }
      ctx.strokeStyle = colour; ctx.lineWidth = 1.6; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
    }
    hill(moonAt, 'rgba(230,232,236,.16)', COL.moonLine, [4, 3]);
    hill(sunAt, COL.sunFill, COL.sunLine);
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(LEFT, Math.round(aBot), W - LEFT - RIGHT, 1);
    ctx.fillStyle = COL.text; ctx.textAlign = 'left';
    ctx.fillText('30°', LEFT + 3, yA(30) - 6); ctx.fillText('60°', LEFT + 3, yA(60) - 6);

    /* moon phase above the top of the moon hill, if the moon culminates inside this window */
    var topT = null, topA = -90;
    for (var s4 = start; s4 <= end; s4 += 300) { var a4 = moonAt(s4); if (a4 > topA) { topA = a4; topT = s4; } }
    if (topA > 0 && topT > start && topT < end) {
      var ilTop = moonIllumination(topT * 1000), xTop = xOf(topT), yTop = Math.max(R.alt[0] + 8, yA(topA) - 12), roomR = xTop + 46 < W - RIGHT;
      drawMoonIcon(ctx, xTop, yTop, 6, ilTop.phase, ilTop.fraction);
      ctx.fillStyle = COL.textBright; ctx.textAlign = roomR ? 'left' : 'right';
      ctx.fillText(Math.round(ilTop.fraction * 100) + ' %', roomR ? xTop + 10 : xTop - 10, yTop);
    }

    /* rise and set times: sun and moon each in a row of their own, so neither hides the other.
       Sun centre and moon upper limb at −0.833° (refraction). All hairlines first, labels on top. */
    var ev = [], evRows = [
      { fn: sunAt, row: 'sunEv', c: COL.sunLine, up: 'sunrise', down: 'sunset' },
      { fn: moonAt, row: 'moonEv', c: COL.moonLine, up: 'moonrise', down: 'moonset' }];
    evRows.forEach(function (er) {
      er.list = crossings(er.fn, start, end, 60, -0.833);
      er.list.forEach(function (c) {
        ev.push({ t: c.t, k: c.rising ? er.up : er.down });
        ctx.globalAlpha = 0.6; ctx.fillStyle = er.c; ctx.fillRect(Math.round(xOf(c.t)), R[er.row][1], 1, R.alt[1] - R[er.row][1]); ctx.globalAlpha = 1;
      });
    });
    var astro = crossings(sunAt, start, end, 60, -18);
    astro.forEach(function (c) {
      ev.push({ t: c.t, k: c.rising ? 'astroStart' : 'astroEnd' });
      ctx.globalAlpha = 0.6; ctx.fillStyle = '#8fb3ff'; ctx.fillRect(Math.round(xOf(c.t)), R.twi[0], 1, R.alt[1] - R.twi[0]); ctx.globalAlpha = 1;
    });
    ev.sort(function (a, b) { return a.t - b.t; });
    ctx.textAlign = 'center';
    evRows.forEach(function (er) {
      var lastRight = -1e9;
      er.list.forEach(function (c) {
        var txt = hhmm(c.t, off), tw = ctx.measureText(txt).width + 6, xl = clamp(xOf(c.t), LEFT + tw / 2, W - RIGHT - tw / 2);
        if (xl - tw / 2 <= lastRight) return;
        ctx.fillStyle = er.c; ctx.fillText(txt, xl, mid(R[er.row])); lastRight = xl + tw / 2;
      });
    });

    /* astronomical darkness written into its stretch of the twilight band */
    var dusk = astro.filter(function (c) { return !c.rising; })[0];
    var dawn = dusk && astro.filter(function (c) { return c.rising && c.t > dusk.t; })[0];
    var darkTxt = null, darkX = null, stD = nightStats(key, have);
    if (dusk && dawn) {
      darkTxt = T.ev.darkSpan.replace('{a}', hhmm(dusk.t, off)).replace('{b}', hhmm(dawn.t, off)).replace('{h}', num((dawn.t - dusk.t) / 3600, 1));
      if (stD.moonFree.length) darkTxt += T.ev.moonFreeShort.replace('{h}', num(stD.moonFreeSec / 3600, 1));
      if (ctx.measureText(darkTxt).width + 12 > xOf(dawn.t) - xOf(dusk.t)) darkTxt = hhmm(dusk.t, off) + '–' + hhmm(dawn.t, off);
      darkX = (xOf(dusk.t) + xOf(dawn.t)) / 2;
    } else if (minSun > -18) {
      darkTxt = T.ev.noNight; darkX = (LEFT + W - RIGHT) / 2;
    }
    stD.moonFree.forEach(function (p) { ctx.fillStyle = '#8fb3ff'; ctx.fillRect(xOf(p[0]), R.twi[1] - 6, xOf(p[1]) - xOf(p[0]), 3); }); /* moon-free strip */
    if (darkTxt) { ctx.fillStyle = dusk && dawn ? '#cfe0ff' : COL.textBright; ctx.textAlign = 'center'; ctx.fillText(darkTxt, darkX, R.twi[0] + 9); }

    /* night rating, as under the week chart: the overall score as a colour gradient, faded out by daylight.
       Stops every 10 minutes, the score blended between hour centres and the fade taken from the sun at that moment. */
    var gradD = ctx.createLinearGradient(xOf(start), 0, xOf(end), 0);
    for (var gt = start; gt <= end; gt += 600) {
      var gp = (gt - start) / 3600 - 0.5, gi = Math.floor(gp), gf = clamp(gp - gi, 0, 1);
      var ga = cols[clamp(gi, 0, nH - 1)], gb = cols[clamp(gi + 1, 0, nH - 1)];
      var sa = ga ? ga.sOverall : null, sb = gb ? gb.sOverall : null;
      var sg = sa == null ? sb : sb == null ? sa : sa + (sb - sa) * gf;
      gradD.addColorStop((gt - start) / (end - start), ratingColour(sg, clamp((-sunAt(gt) - 12) / 6, 0, 1)));
    }
    ctx.fillStyle = gradD; ctx.fillRect(LEFT, R.rating[0] + 17, nH * colW, R.rating[1] - R.rating[0] - 20);
    var txtD = null, colD = COL.text;
    if (stD.avg != null) {
      txtD = rating(stD.avg) + ' ' + Math.round(stD.avg * 100) + ' %';
      if (stD.covered < stD.to - stD.from - 900) txtD += ' · ' + T.sumPartial.replace('{a}', num(stD.covered / 3600, 1)).replace('{b}', num((stD.to - stD.from) / 3600, 1));
      colD = ratingColour(stD.avg, 1);
    } else if (stD.from == null) {
      txtD = T.ev.noNight;
    }
    if (txtD) {
      ctx.font = '600 11px system-ui, -apple-system, Segoe UI, sans-serif';
      var twD = ctx.measureText(txtD).width, xcD = stD.from == null ? (LEFT + W - RIGHT) / 2 : (xOf(stD.from) + xOf(stD.to)) / 2;
      ctx.fillStyle = colD; ctx.textAlign = 'center';
      ctx.fillText(txtD, clamp(xcD, LEFT + twD / 2 + 2, W - RIGHT - twD / 2 - 2), R.rating[0] + 9);
      ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif';
    }

    /* value cells */
    function cellRow(k, valueFn, scoreFn, textFn) {
      cols.forEach(function (r, i) {
        var x = LEFT + i * colW, b = R[k], v = r ? valueFn(r) : null, sc = v == null ? null : scoreFn(v, r);
        ctx.fillStyle = scoreColour(sc); ctx.fillRect(x + 1, b[0] + 1, colW - 2, b[1] - b[0] - 2);
        if (v != null) {
          ctx.fillStyle = sc != null && sc > 0.55 ? '#fff' : '#1b2633'; ctx.textAlign = 'center';
          ctx.fillText(textFn(v), x + colW / 2, mid(b) + 0.5);
        }
      });
    }
    function same(v) { return v; }
    function pct100(v) { return Math.round(v * 100); }
    cellRow('overall', function (r) { return r.sOverall; }, same, pct100);
    cellRow('clouds', function (r) { return r.cloud_cover; }, cloudScore, num);
    cellRow('low', function (r) { return r.cloud_cover_low; }, cloudScore, num);
    cellRow('mid', function (r) { return r.cloud_cover_mid; }, cloudScore, num);
    cellRow('high', function (r) { return r.cloud_cover_high; }, cloudScore, num);
    cellRow('clouds2', function (r) { return r.cloud_ecmwf; }, cloudScore, num);
    cellRow('seeing', function (r) { return r.sSeeing; }, same, pct100);
    cellRow('transp', function (r) { return r.aod; }, function (v, r) { return r.sTransp; }, function (v) { return num(v, 2); });
    cellRow('pwv', function (r) { return r.pwv; }, function (v) { return clamp(1 - (v - 10) / 40, 0, 1); }, num); /* colour for reading only */
    cellRow('dust', function (r) { return r.dust; }, function (v) { return clamp(1 - v / 100, 0, 1); }, num);
    cellRow('vis', function (r) { return r.visibility; }, function (v) { return clamp((v / 1000 - 1) / 19, 0, 1); }, function (v) { return num(v / 1000, v < 10000 ? 1 : 0); });
    cellRow('precip', function (r) { return r.precipitation_probability; }, function (v) { return clamp(1 - v / 100, 0, 1); }, num);

    /* wind, temperature, dew point, spread, humidity */
    cols.forEach(function (r, i) {
      if (!r) return;
      var x = LEFT + (i + 0.5) * colW, wy = mid(R.wind), v = r.wind_speed_10m;
      ctx.beginPath(); ctx.arc(x, wy, 9, 0, 2 * Math.PI); ctx.fillStyle = windColour(v); ctx.fill();
      if (r.wind_direction_10m != null) {
        ctx.save(); ctx.translate(x, wy); ctx.rotate((r.wind_direction_10m + 180) * RAD);
        ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -6); ctx.moveTo(-3, -2.8); ctx.lineTo(0, -6); ctx.lineTo(3, -2.8);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore();
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = COL.text; ctx.fillText(num(v) + '/' + num(r.wind_gusts_10m), x, mid(R.windtxt));
      ctx.fillStyle = COL.temp; ctx.fillText(num(temp(r.temperature_2m, unit)) + '°', x, mid(R.temp));
      ctx.fillStyle = COL.dew; ctx.fillText(num(temp(r.dew_point_2m, unit)) + '°', x, mid(R.dew));
      if (r.temperature_2m != null && r.dew_point_2m != null) {
        var spread = r.temperature_2m - r.dew_point_2m;
        if (spread <= 4) { /* dew risk: red below 2 °C, orange below 4 °C */
          ctx.fillStyle = spread <= 2 ? 'rgba(216,67,59,.6)' : 'rgba(224,123,43,.38)';
          ctx.fillRect(x - colW / 2 + 1, R.spread[0] + 1, colW - 2, R.spread[1] - R.spread[0] - 2);
        }
        ctx.fillStyle = COL.textBright; ctx.fillText(num(unit === 'f' ? spread * 9 / 5 : spread, 1) + '°', x, mid(R.spread));
      }
      ctx.fillStyle = COL.text; ctx.fillText(num(r.relative_humidity_2m) + '%', x, mid(R.hum));
    });

    if (nowSec >= start && nowSec <= end) { ctx.fillStyle = COL.now; ctx.fillRect(Math.round(xOf(nowSec)), R.twi[0], 1.5, R.hum[1] - R.twi[0]); }

    /* label column */
    ctx.fillStyle = COL.label; ctx.fillRect(0, 0, LEFT - 2, H);
    ctx.textAlign = 'right';
    var RL = T.rowsDay;
    [['wx', RL.wx], ['twi', RL.twi], ['sunEv', T.rows.sun, COL.sunLine], ['moonEv', T.rows.moon, COL.moonLine], ['alt', RL.alt], ['rating', T.rows.night], ['overall', RL.overall], ['clouds', RL.clouds], ['low', RL.low], ['mid', RL.mid],
      ['high', RL.high], ['clouds2', RL.clouds2], ['seeing', RL.seeing], ['transp', RL.transp], ['pwv', RL.pwv], ['dust', RL.dust], ['vis', RL.vis], ['precip', RL.precip], ['wind', RL.wind], ['windtxt', RL.windtxt],
      ['temp', RL.temp + (unit === 'f' ? ' °F' : ' °C'), COL.temp], ['dew', RL.dew, COL.dew], ['spread', RL.spread], ['hum', RL.hum]].forEach(function (l) {
      ctx.fillStyle = l[2] || COL.text; ctx.fillText(l[1], LEFT - 8, mid(R[l[0]]));
    });
    stickyLabels(el.dayWrap, cv, LEFT - 2, H);
    /* a newly chosen night opens at sunset where the chart is wider than the screen */
    if (state.scrollDay) {
      state.scrollDay = false;
      var sunset = evRows[0].list.filter(function (c) { return !c.rising; })[0];
      el.dayScroll.scrollLeft = sunset ? Math.max(0, xOf(sunset.t) - LEFT - colW) : 0;
    }

    /* the same events as text: readable, and the canvas' text alternative */
    var parts = ev.map(function (e) { return T.ev[e.k] + ' ' + hhmm(e.t, off); });
    if (minSun > -18) parts.push(T.ev.noNight);
    if (stD.moonFree.length) parts.push(T.ev.moonFree.replace('{t}', spans(stD.moonFree, off)));
    parts.push(T.ev.illum.replace('{p}', Math.round(moonIllumination(fromLocal((key + 1) * 86400, off) * 1000).fraction * 100)));
    el.dayEvents.innerHTML = '<p style="margin:.6rem 0 0; font-size:.9rem; color:var(--text-light); line-height:1.6;">' + parts.map(esc).join(' · ') + '</p>';
    el.dayCanvas.setAttribute('aria-label', label + '. ' + parts.join(', '));
  }

  function showDayTip(clientX, clientY) {
    var L = state.dayLayout;
    if (!L) return;
    var rect = el.dayCanvas.getBoundingClientRect(), x = clientX - rect.left, i = Math.floor((x - L.LEFT) / L.colW);
    var r = x >= L.LEFT && i >= 0 && i < L.cols.length ? L.cols[i] : null;
    if (!r) { el.dayTip.hidden = true; return; }
    el.dayTip.innerHTML = tipHtml(state.data.index[r.t]);
    el.dayTip.hidden = false;
    var wrapRect = el.dayWrap.getBoundingClientRect(), tw = el.dayTip.offsetWidth, th = el.dayTip.offsetHeight;
    var left = clientX - wrapRect.left + 14, top = clientY - wrapRect.top + 14;
    if (left + tw > el.dayScroll.scrollLeft + el.dayScroll.clientWidth) left = clientX - wrapRect.left - tw - 14;
    if (top + th > L.H) top = Math.max(0, L.H - th);
    el.dayTip.style.left = Math.max(el.dayScroll.scrollLeft, left) + 'px';
    el.dayTip.style.top = top + 'px';
  }

  function selectNight(k) {
    state.night = k;
    state.scrollDay = true;
    renderSummary();
    renderDay();
  }

  function stepNight(dir) {
    var keys = nightKeys(), p = keys.indexOf(state.night) + dir;
    if (p >= 0 && p < keys.length) selectNight(keys[p]);
  }

  el.dayCanvas.addEventListener('mousemove', function (e) { showDayTip(e.clientX, e.clientY); });
  el.dayCanvas.addEventListener('mouseleave', function () { el.dayTip.hidden = true; });
  el.dayCanvas.addEventListener('click', function (e) { showDayTip(e.clientX, e.clientY); });
  el.dayPrev.addEventListener('click', function () { stepNight(-1); });
  el.dayNext.addEventListener('click', function () { stepNight(1); });
  /* touch: a tap beside a chart closes its tooltip, and so does scrolling it sideways */
  document.addEventListener('click', function (e) {
    if (e.target !== el.canvas) el.tip.hidden = true;
    if (e.target !== el.dayCanvas) el.dayTip.hidden = true;
  });
  el.scroll.addEventListener('scroll', function () { el.tip.hidden = true; });
  el.dayScroll.addEventListener('scroll', function () { el.dayTip.hidden = true; });

  /* re-layout on resize, keeping the horizontal scroll position proportional */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!state.data) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });

  readUrl();
  setCoordsEditable(false);
  updateMeteoblue(); /* only the link; the map itself waits for its button */
  updatePlannerLink();
  setUnit(state.unit, true); /* no URL rewrite on a plain page visit */
})();
