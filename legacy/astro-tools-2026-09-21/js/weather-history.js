/*
 * Astro weather history: what the forecast said, and what came of it.
 *
 * Everything is computed in the browser, live. Two archives are read:
 *   - previous-runs-api.open-meteo.com — what each model forecast one to five days ahead, one
 *     request per location, about 90 KB
 *   - mesonet.agron.iastate.edu — the airports' hourly METAR cloud reports, the only real
 *     measurement here. That archive answers 429 to parallel requests, so the stations are
 *     fetched one after another and only when the visitor asks for them (see loadObs).
 * Both hosts are named in privacy/privacy_{de,en}.html.
 *
 * Sun, moon and the exact twilight crossings come from js/astro-core.js, the colours and the
 * cloud score from js/weather-core.js — the same ones the forecast page uses.
 */
(function () {
  'use strict';
  var root = document.getElementById('wh-root');
  if (!root || !window.SvAstro || !window.SvWx) return;

  var LANG = document.documentElement.lang === 'en' ? 'en' : 'de';

  var T = {
    de: {
      loadingFc: 'Alte Vorhersagen werden von Open-Meteo geladen …',
      failedFc: 'Die alten Vorhersagen konnten nicht von Open-Meteo geladen werden.',
      obsBtn: 'Flughafenmeldungen dazuladen',
      obsLoading: 'Wird geladen, das dauert ein paar Sekunden …',
      obsFailed: 'Ging nicht — nochmal versuchen',
      obsHint: 'Die Flughafenmeldungen liegen in einem Uni-Archiv, das eine Station nach der anderen herausgibt. Deshalb kommen sie nur auf Knopfdruck.',
      status: '{n} Nächte · Analyse {an} · Flughafenmeldung aus {st} in {k} der {n} Nächte',
      statusNoObs: '{n} Nächte · Analyse {an} · in diesem Zeitraum keine durchgehende Flughafenmeldung',
      statusNoAsk: '{n} Nächte · Analyse {an} · soeben live von Open-Meteo geholt',
      caveats: [
        'Nachgespielt wird nur die Bewölkung. Das Vorhersagearchiv von Open-Meteo führt je Vorlaufzeit keine Wolkenschichten, keine Sicht, keine Höhenwinde und kein Aerosol — Seeing, Transparenz und damit die Gesamtnote der Vorhersageseite lassen sich nicht rekonstruieren.',
        'Es gibt keine eine Wirklichkeit: die Analysen von HRRR, ECMWF IFS und ERA5 weichen für denselben Zeitraum um 12,5 bis 16,5 Prozentpunkte voneinander ab — mehr als der hier gemessene Fehler der Ein-Tages-Vorhersage.',
        'Die Flughafenmeldung ist die einzige echte Messung hier, misst aber nur die unteren rund 3,7 km: Ein Ceilometer schießt einen Laserpuls nach oben, und was darüber steht, sieht es nicht. Wie groß der Unterschied ist, hängt vom Ort ab: über dem trockenen Texas ist er verschwindend, über Norddeutschland riesig — die Zeile unter der Bilanz nennt ihn für den gewählten Ort und Zeitraum. Für die Astrofotografie ist gerade diese hohe Bewölkung oft das Entscheidende.',
        'Meldet eine Station CAVOK, steht im Wetterbericht keine Wolkengruppe — das heißt: nichts unter 5000 Fuß und keine Gewitterwolken. Solche Stunden zählen hier als klar. Ohne das fielen an manchen Orten mehr als die Hälfte aller Stunden heraus, und zwar ausgerechnet die klaren.',
        'Eine Nacht bekommt nur dann eine Beobachtung, wenn eine Station über mindestens 80 % ihrer Dunkelheit gemeldet hat.'
      ],
      days: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
      lead: 'vor {n} Tagen', lead1: 'vor 1 Tag',
      truth: 'So war es', truthSub: 'Analyse im Rückblick',
      obs: 'Flughafen', obsSub: 'gemeldet',
      dev: 'Abweichung',
      devSub: '1 Tag vorher',
      scaleTitle: 'Bewölkung:',
      scaleClear: 'klar', scaleCloudy: 'bedeckt',
      tipNight: 'Nacht ab {d}',
      tipDark: 'Dunkelheit {a}–{b}',
      tipTruth: 'So war es', tipObs: 'Flughafen', tipLead: '{n} Tage vorher', tipLead1: '1 Tag vorher',
      colLead: 'Vorlauf', colModel: 'Modell', colErr: 'Mittlerer Fehler', colHit: 'Aussage getroffen', colN: 'Nächte',
      tableTitle: 'Die Bilanz über {n} Nächte',
      tableNote: '<strong>Mittlerer Fehler</strong>: um wie viele Prozentpunkte Bewölkung die Vorhersage im Schnitt danebenlag, gemessen an der Analyse. <strong>Aussage getroffen</strong>: wie oft Vorhersage und Wirklichkeit sich einig waren, ob die Nacht brauchbar wird — brauchbar heißt hier im Mittel unter 30 % bedeckt.',
      obsRow: 'Die beiden Bezugszeilen messen nicht dasselbe: Das Ceilometer am Flughafen sieht nur die unteren rund 3,7 km und liest deshalb im Mittel {e} Prozentpunkte klarer als die Gesamtbewölkung der Analyse ({n} Nächte). Der Unterschied ist mittelhohe und hohe Bewölkung — für die Astrofotografie oft genau das Entscheidende.',
      obsRowCloudier: 'Die beiden Bezugszeilen messen nicht dasselbe: Das Ceilometer am Flughafen sieht nur die unteren rund 3,7 km, liest hier aber im Mittel {e} Prozentpunkte bedeckter als die Analyse ({n} Nächte).',
      obsRowThin: 'Zur Einordnung fehlen hier die Flughafenmeldungen — nur {n} der {t} Nächte haben eine.',
      caveatTitle: 'Was diese Zahlen nicht sagen',
      none: 'Für diesen Standort liegen keine Nächte vor.'
    },
    en: {
      loadingFc: 'Loading the past forecasts from Open-Meteo …',
      failedFc: 'The past forecasts could not be loaded from Open-Meteo.',
      obsBtn: 'Add the airport reports',
      obsLoading: 'Loading, this takes a few seconds …',
      obsFailed: 'That did not work — try again',
      obsHint: 'The airport reports sit in a university archive that hands out one station at a time, which is why they only come on request.',
      status: '{n} nights · analysis {an} · airport report from {st} in {k} of the {n} nights',
      statusNoObs: '{n} nights · analysis {an} · no airport reported through a whole night in this period',
      statusNoAsk: '{n} nights · analysis {an} · fetched live from Open-Meteo just now',
      caveats: [
        'Only the cloud cover can be replayed. Per lead, Open-Meteo\u2019s forecast archive carries no cloud layers, no visibility, no upper-level winds and no aerosol, so seeing, transparency and with them the overall rating of the forecast page cannot be reconstructed.',
        'There is no single reality: the analyses of HRRR, ECMWF IFS and ERA5 differ from each other by 12.5 to 16.5 percentage points over the same period — more than the one-day forecast error measured here.',
        'The airport report is the only real measurement here, but it measures only the lowest 3.7 km or so: a ceilometer fires a laser pulse upwards and does not see what stands above it. How much that matters depends on the place: over dry Texas the gap all but vanishes, over northern Germany it is vast — the line under the balance gives it for the location and period chosen. For astrophotography it is often that high cloud which decides the night.',
        'Where a station reports CAVOK, the weather report carries no cloud group at all — meaning nothing below 5000 feet and no thunderclouds. Such hours count as clear here. Without that, more than half of all hours would drop out at some places, and precisely the clear ones.',
        'A night only gets an observation where a station reported through at least 80 per cent of its darkness.'
      ],
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      lead: '{n} days before', lead1: '1 day before',
      truth: 'What came', truthSub: 'analysis in hindsight',
      obs: 'Airport', obsSub: 'reported',
      dev: 'Deviation',
      devSub: '1 day before',
      scaleTitle: 'Cloud cover:',
      scaleClear: 'clear', scaleCloudy: 'overcast',
      tipNight: 'Night from {d}',
      tipDark: 'Darkness {a}–{b}',
      tipTruth: 'What came', tipObs: 'Airport', tipLead: '{n} days before', tipLead1: '1 day before',
      colLead: 'Lead', colModel: 'Model', colErr: 'Mean error', colHit: 'Verdict right', colN: 'Nights',
      tableTitle: 'The balance over {n} nights',
      tableNote: '<strong>Mean error</strong>: by how many percentage points of cloud cover the forecast was out on average, measured against the analysis. <strong>Verdict right</strong>: how often forecast and reality agreed on whether the night would be usable — usable meaning under 30 per cent cover on average.',
      obsRow: 'The two reference rows do not measure the same thing: the ceilometer at the airport sees only the lowest 3.7 km or so, and therefore reads on average {e} percentage points clearer than the analysis’s total cloud ({n} nights). The difference is mid and high cloud — often the very thing that decides an astrophoto.',
      obsRowCloudier: 'The two reference rows do not measure the same thing: the ceilometer at the airport sees only the lowest 3.7 km or so, yet here it reads on average {e} percentage points cloudier than the analysis ({n} nights).',
      obsRowThin: 'The airport reports cannot give scale here — only {n} of the {t} nights have one.',
      caveatTitle: 'What these numbers do not say',
      none: 'No nights are on record for this location.'
    }
  }[LANG];

  var A = window.SvAstro, X = window.SvWx;
  var pad = A.pad, localDate = A.localDate, hhmm = A.hhmm, offsetFn = A.offsetFn;
  var COL = X.COL, scoreColour = X.scoreColour, ratingColour = X.ratingColour,
    cloudScore = X.cloudScore, stickyLabels = X.stickyLabels, cellPaint = X.cellPaint;

  /* the model ids of the chain as the forecast page writes them */

  /* ------------------------------------------------------------------ *
   * Locations — the model chain of the forecast page, finest first      *
   * ------------------------------------------------------------------ */
  /* This is the chain astro-weather.js builds in CMP. Gaucín lies outside the ICON-D2 and the DMI
     HARMONIE domain — the API returns no key at all for them there, so its chain starts at ICON-EU
     and the lead rule below picks that up by itself. Keep in step when the forecast page changes. */
  var SITES = [
    { key: 'starfront', name: { de: 'Starfront, Rockwood (Texas)', en: 'Starfront, Rockwood (Texas)' },
      lat: 31.5471, lon: -99.3823, tz: 'America/Chicago',
      chain: ['ncep_hrrr_conus', 'cmc_gem_seamless', 'ncep_gfs_global'], stations: ['BWD', 'ABI', 'SJT'] },
    { key: 'hannover', name: { de: 'Volkssternwarte Hannover', en: 'Public Observatory Hannover' },
      lat: 52.36245, lon: 9.70556, tz: 'Europe/Berlin',
      chain: ['icon_d2', 'dmi_harmonie_arome_europe', 'icon_eu', 'icon_global'], stations: ['EDDV'] },
    { key: 'andreasberg', name: { de: 'Sternwarte Sankt Andreasberg', en: 'Sankt Andreasberg Observatory' },
      lat: 51.731854, lon: 10.525897, tz: 'Europe/Berlin',
      chain: ['icon_d2', 'dmi_harmonie_arome_europe', 'icon_eu', 'icon_global'], stations: ['EDVE', 'EDDK'] },
    /* Gibraltar (LXGB, not GIB in this archive) is the closest reporting airport, about 40 km */
    { key: 'gaucin', name: { de: 'Finca Olivar, Gaucín (Spanien)', en: 'Finca Olivar, Gaucín (Spain)' },
      lat: 36.51010, lon: -5.32962, tz: 'Europe/Madrid',
      chain: ['icon_eu', 'icon_global'], stations: ['LXGB', 'LEMG', 'LEGR', 'LEJR'] }
  ];

  var DAYS = 60, LEADS = [1, 2, 3, 4, 5];
  /* a night is only kept when this share of its darkness has data; without the gate four of six
     hours passed and single nights swung the average */
  var MIN_COVER = 0.8;
  /* METAR coverage codes as cloud cover in per cent: the middle of each octa range */
  var SKY = { CLR: 0, SKC: 0, NSC: 0, NCD: 0, FEW: 18.75, SCT: 43.75, BKN: 75, OVC: 100, VV: 100 };

  function getText(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  }

  /* ------------------------------------------------------------------ *
   * What each model said at each lead — one request per location        *
   * ------------------------------------------------------------------ */
  function loadForecasts(site) {
    var vars = ['cloud_cover'].concat(LEADS.map(function (l) { return 'cloud_cover_previous_day' + l; }));
    var u = 'https://previous-runs-api.open-meteo.com/v1/forecast?latitude=' + site.lat + '&longitude=' + site.lon +
      '&timezone=UTC&timeformat=unixtime&past_days=' + (DAYS + 1) + '&forecast_days=1&hourly=' + vars.join(',') +
      '&models=' + site.chain.join(',');
    /* the archive writes a bare nan where a model has no run at that lead, which is not valid JSON */
    return getText(u).then(function (txt) {
      var j = JSON.parse(txt.replace(/:nan/g, ':null'));
      if (j.error) throw new Error(j.reason);
      var out = {};
      site.chain.forEach(function (m) {
        [0].concat(LEADS).forEach(function (l) {
          var a = j.hourly['cloud_cover' + (l ? '_previous_day' + l : '') + '_' + m];
          if (!a || !a.some(function (v) { return v != null; })) return;
          var by = {};
          j.hourly.time.forEach(function (t, i) { if (a[i] != null) by[t] = a[i]; });
          (out[m] = out[m] || {})[l] = by;
        });
      });
      return out;
    });
  }

  /* The forecast page always draws the finest model that still reaches the hour. Applied to the
     past that is: for each lead the first model of the chain that has a run at all — the
     short-range models drop out by themselves, they never reach beyond about a day. */
  function chainByLead(site, fc) {
    var pick = {};
    [0].concat(LEADS).forEach(function (l) {
      pick[l] = null;
      for (var i = 0; i < site.chain.length && pick[l] == null; i++) {
        var m = site.chain[i];
        if (fc[m] && fc[m][l] && Object.keys(fc[m][l]).length) pick[l] = m;
      }
    });
    return pick;
  }

  /* ------------------------------------------------------------------ *
   * Observed cloud cover, per full hour (UTC), kept per station         *
   * ------------------------------------------------------------------ */
  /* Averaging two airports 80 km apart would smooth away exactly the overcast and clear extremes
     this page is about, so the stations stay separate. The archive answers 429 to parallel
     requests, hence one after another with a pause — which is why this only runs on request. */
  function loadObs(site, from, to) {
    var perStation = {}, coverage = [], i = 0;
    function ymd(d, n) { return 'year' + n + '=' + d.getUTCFullYear() + '&month' + n + '=' + (d.getUTCMonth() + 1) + '&day' + n + '=' + d.getUTCDate(); }
    function next() {
      if (i >= site.stations.length) return Promise.resolve({ perStation: perStation, coverage: coverage });
      var st = site.stations[i++];
      var u = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=' + st +
        '&data=skyc1&data=skyc2&data=skyc3&data=skyc4&data=metar&tz=UTC&format=onlycomma&missing=M&trace=T&direct=no&report_type=3&' +
        ymd(from, 1) + '&' + ymd(to, 2);
      return getText(u).then(function (csv) {
        var lines = csv.trim().split('\n'), head = lines.shift().split(',');
        var iT = head.indexOf('valid'), iM = head.indexOf('metar');
        var cols = ['skyc1', 'skyc2', 'skyc3', 'skyc4'].map(function (k) { return head.indexOf(k); }).filter(function (x) { return x >= 0; });
        var used = 0;
        lines.forEach(function (line) {
          var fld = line.split(','), t = Date.parse(fld[iT].replace(' ', 'T') + 'Z');
          if (!t) return;
          /* a report at :53 belongs to the following full hour, which is how the models are stamped */
          var hour = Math.round(t / 3600000) * 3600, cover = null;
          cols.forEach(function (c) {
            var v = SKY[(fld[c] || '').trim().toUpperCase()];
            if (v != null) cover = Math.max(cover == null ? -1 : cover, v);
          });
          /* CAVOK carries no cloud group at all, so the archive leaves skyc empty and the hour used
             to be dropped as missing — which threw away exactly the clearest hours. At Hannover that
             was 802 of 1440 hours. CAVOK means no cloud below 5000 ft and no CB, which for a row
             built from a ceilometer that sees to 3.7 km is a clear sky. The raw report is the last
             column, so slice/join survives a comma inside it. */
          if (cover == null && iM >= 0 && /\bCAVOK\b/.test(fld.slice(iM).join(','))) cover = 0;
          if (cover == null) return;
          (perStation[st] = perStation[st] || {})[hour] = cover;
          used++;
        });
        var span = Math.round((to - from) / 3600000) + 24;
        coverage.push({ id: st, used: used, span: span, cov: Math.round(100 * used / span) });
      }).catch(function () { /* one station short is not a reason to lose the rest */ })
        .then(function () { return new Promise(function (r) { setTimeout(r, 1100); }).then(next); });
    }
    return next();
  }

  /* ------------------------------------------------------------------ *
   * One night, one number                                               *
   * ------------------------------------------------------------------ */
  /* The mean over astronomical darkness, each hour weighted by how much of it is dark — the same
     weighting nightStats() in astro-weather.js uses for the rating, so the numbers compare. */
  function nightMean(series, from, to) {
    if (!series) return null;
    var sum = 0, covered = 0;
    for (var t = Math.floor(from / 3600) * 3600; t < to; t += 3600) {
      var part = Math.min(t + 3600, to) - Math.max(t, from);
      if (part <= 0 || series[t] == null) continue;
      sum += part * series[t];
      covered += part;
    }
    return covered >= (to - from) * MIN_COVER ? sum / covered : null;
  }

  function obsMean(perStation, from, to) {
    var each = [];
    for (var st in perStation) {
      var m = nightMean(perStation[st], from, to);
      if (m != null) each.push(m);
    }
    return each.length ? each.reduce(function (a, b) { return a + b; }, 0) / each.length : null;
  }

  var r1 = function (v) { return v == null ? null : Math.round(v * 10) / 10; };

  /* the nights of the window, newest last. The window is counted from the night that is running
     right now, never from a calendar date: a date turned into a night key lands a night early
     west of Greenwich. A night whose darkness has not ended yet has no outcome and is skipped. */
  function buildNights(site, fc, pick, obs) {
    var off = offsetFn(site.tz, 0), nowSec = Date.now() / 1000;
    var lastKey = A.nightKeyOf(nowSec, off), nights = [];
    for (var key = lastKey - (DAYS - 1); key <= lastKey; key++) {
      var st = A.darkness(key, site.lat, site.lon, off);
      if (st.from == null || st.to > nowSec) continue;
      var truth = nightMean(fc[pick[0]][0], st.from, st.to);
      if (truth == null) continue;
      nights.push({
        key: key, from: Math.round(st.from), to: Math.round(st.to),
        moonFree: Math.round(st.moonFreeSec),
        truth: r1(truth),
        obs: obs ? r1(obsMean(obs.perStation, st.from, st.to)) : null,
        fc: LEADS.map(function (l) {
          var m = pick[l];
          return m ? r1(nightMean(fc[m][l], st.from, st.to)) : null;
        })
      });
    }
    return nights;
  }

  var MODEL_NAME = {
    ncep_hrrr_conus: 'HRRR', ncep_gfs_global: 'GFS', ncep_nbm_conus: 'NBM',
    cmc_gem_seamless: 'GEM', ecmwf_ifs: 'ECMWF',
    icon_d2: 'ICON-D2', icon_eu: 'ICON-EU', icon_global: 'ICON global',
    dmi_harmonie_arome_europe: 'HARMONIE'
  };
  function modelName(id) { return MODEL_NAME[id] || id || '–'; }

  /* a night counts as usable when it averages under this much cloud */
  var USABLE = 30;

  var FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  var el = {
    location: document.getElementById('wh-location'),
    span: document.getElementById('wh-span'),
    status: document.getElementById('wh-status'),
    scroll: document.getElementById('wh-scroll'),
    wrap: document.getElementById('wh-chart-wrap'),
    canvas: document.getElementById('wh-canvas'),
    tip: document.getElementById('wh-tip'),
    scale: document.getElementById('wh-scale'),
    table: document.getElementById('wh-table'),
    caveats: document.getElementById('wh-caveats'),
    obsBtn: document.getElementById('wh-obs-btn'),
    obsRow: document.getElementById('wh-obs-row')
  };

  var state = { site: null, span: 14, layout: null, failed: false };

  function num(v, digits) {
    return v == null ? '–' : (digits ? v.toFixed(digits) : String(Math.round(v))).replace('.', LANG === 'de' ? ',' : '.');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function dayLabel(sec, off) { var d = localDate(sec, off); return T.days[d.getUTCDay()] + ' ' + pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.'; }
  function leadLabel(l) { return l === 1 ? T.lead1 : T.lead.replace('{n}', l); }

  /* ------------------------------------------------------------------ *
   * Statistics                                                         *
   * ------------------------------------------------------------------ */
  /* the nights the view covers, newest last, as the chart draws them */
  function nightsOf(site, span) {
    var all = site.nights.slice().sort(function (a, b) { return a.key - b.key; });
    return all.slice(Math.max(0, all.length - span));
  }

  /* mean absolute error and how often the usable/not-usable verdict held, per lead */
  function stats(nights, leads) {
    return leads.map(function (l, i) {
      var err = 0, n = 0, hit = 0;
      nights.forEach(function (x) {
        if (x.truth == null || x.fc[i] == null) return;
        err += Math.abs(x.truth - x.fc[i]);
        if ((x.truth < USABLE) === (x.fc[i] < USABLE)) hit++;
        n++;
      });
      return { lead: l, n: n, mae: n ? err / n : null, hit: n ? hit / n : null };
    });
  }

  /* How the airport reading sits against the analysis. The signed difference, not the absolute one:
     a ceilometer sees to about 3.7 km, the model reports the whole column, so the airport reads
     systematically clearer wherever there is mid or high cloud. That gap is the finding, not noise. */
  function analysisVsObs(nights) {
    var diff = 0, n = 0;
    nights.forEach(function (x) { if (x.truth != null && x.obs != null) { diff += x.truth - x.obs; n++; } });
    return { n: n, bias: n ? diff / n : null };
  }

  /* ------------------------------------------------------------------ *
   * The chart                                                          *
   * ------------------------------------------------------------------ */
  function render() {
    var site = state.site, cv = el.canvas, ctx = cv.getContext('2d');
    if (!site) return;
    var nights = nightsOf(site, state.span), n = nights.length;
    var leads = LEADS, off = offsetFn(site.tz, 0);
    if (!n) { el.status.textContent = T.none; cv.width = 0; cv.height = 0; el.table.innerHTML = ''; return; }

    var obsCount = nights.filter(function (x) { return x.obs != null; }).length, hasObs = obsCount > 0;
    renderStatus(nights, obsCount);

    var LEFT = 122, RIGHT = 12;
    var colW = Math.max(36, (el.scroll.clientWidth - LEFT - RIGHT) / n);
    var W = Math.round(LEFT + RIGHT + colW * n);

    var y = 0, R = {};
    function band(k, h) { R[k] = [y, y + h]; y += h; }
    function mid(b) { return (b[0] + b[1]) / 2; }
    band('days', 24);
    /* the leads run downwards towards the night: furthest out at the top */
    for (var li = leads.length - 1; li >= 0; li--) band('l' + leads[li], 26);
    y += 8;
    band('truth', 28);
    if (hasObs) band('obs', 26);
    y += 8;
    band('dev', 24);
    var H = y + 4;

    var dpr = window.devicePixelRatio || 1;
    el.wrap.style.width = W + 'px';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    state.layout = { LEFT: LEFT, colW: colW, H: H, R: R, nights: nights, hasObs: hasObs };

    /* night labels along the top, every other one where the columns get tight */
    ctx.font = '10px ' + FONT; ctx.textAlign = 'center';
    var step = colW < 52 ? (colW < 32 ? 4 : 2) : 1;
    nights.forEach(function (x, i) {
      if (i % step) return;
      var txt = dayLabel(x.from, off), cx = LEFT + (i + 0.5) * colW;
      /* a label that would reach under the sticky label column is left out rather than clipped */
      if (cx - ctx.measureText(txt).width / 2 < LEFT + 2) return;
      ctx.fillStyle = COL.text;
      ctx.fillText(txt, cx, mid(R.days));
    });

    /* one row per lead, then the two references */
    ctx.font = '11px ' + FONT;
    function valueRow(key, get) {
      var b = R[key];
      if (!b) return;
      nights.forEach(function (x, i) {
        var v = get(x);
        cellPaint(ctx, LEFT + i * colW + 1, b[0] + 1, colW - 2, b[1] - b[0] - 2, cloudScore(v), v == null ? '' : num(v));
      });
    }
    leads.forEach(function (l, i) { valueRow('l' + l, function (x) { return x.fc[i]; }); });
    valueRow('truth', function (x) { return x.truth; });
    if (hasObs) valueRow('obs', function (x) { return x.obs; });

    /* the deviation of the one-day forecast, as the traffic light of the forecast page:
       under 10 points green, from 40 red — and grey where a night has no pair */
    var db = R.dev;
    nights.forEach(function (x, i) {
      var d = x.truth == null || x.fc[0] == null ? null : Math.abs(x.truth - x.fc[0]);
      /* ratingColour only interpolates inside 0…1 — a value above it falls through its stops
         and comes back neutral grey, which made a perfect night look like a missing one */
      ctx.fillStyle = d == null ? COL.noData : ratingColour(Math.max(0, Math.min(1, 1 - (d - 5) / 35)), 1);
      ctx.fillRect(LEFT + i * colW + 1, db[0] + 4, colW - 2, db[1] - db[0] - 8);
      if (d != null && colW >= 30) {
        ctx.fillStyle = '#10151c'; ctx.font = '600 10px ' + FONT; ctx.textAlign = 'center';
        ctx.fillText(num(d), LEFT + (i + 0.5) * colW, mid(db));
      }
    });

    /* label column last, so it covers everything scrolled beneath it */
    ctx.fillStyle = COL.label; ctx.fillRect(0, 0, LEFT - 2, H);
    ctx.textAlign = 'right';
    function label(key, main, sub) {
      var b = R[key];
      if (!b) return;
      /* the sub-line is dropped rather than allowed to run out of the column */
      ctx.font = '9px ' + FONT;
      if (sub && ctx.measureText(sub).width > LEFT - 14) sub = null;
      ctx.fillStyle = COL.textBright; ctx.font = '11px ' + FONT;
      ctx.fillText(main, LEFT - 8, mid(b) - (sub ? 6 : 0));
      if (sub) { ctx.fillStyle = COL.text; ctx.font = '9px ' + FONT; ctx.fillText(sub, LEFT - 8, mid(b) + 6); }
    }
    leads.forEach(function (l) { label('l' + l, leadLabel(l), modelName(site.leadModel[l])); });
    label('truth', T.truth, modelName(site.leadModel[0]));
    if (hasObs) label('obs', T.obs, T.obsSub);
    label('dev', T.dev, T.devSub);

    stickyLabels(el.wrap, cv, LEFT - 2, H);
    cv.setAttribute('aria-label', el.status.textContent);
    renderScale();
    renderTable(nights, leads);
  }

  /* the legend: the same ramp as the forecast page, here read as cloud cover */
  function renderScale() {
    var steps = [0, 25, 50, 75, 100];
    el.scale.innerHTML = '<span>' + esc(T.scaleTitle) + '</span>' +
      '<span style="color:var(--text-light);">' + esc(T.scaleClear) + '</span>' +
      steps.map(function (c) {
        return '<span style="display:inline-flex; align-items:center; gap:.25rem;">' +
          '<span style="width:20px; height:10px; border-radius:2px; background:' + scoreColour(cloudScore(c)) + '; display:inline-block;"></span>' +
          num(c) + '&nbsp;%</span>';
      }).join('') +
      '<span style="color:var(--text-light);">' + esc(T.scaleCloudy) + '</span>';
    el.scale.hidden = false;
  }

  /* ------------------------------------------------------------------ *
   * The balance                                                        *
   * ------------------------------------------------------------------ */
  function renderTable(nights, leads) {
    var site = state.site, rows = stats(nights, leads), av = analysisVsObs(nights);
    var head = [T.colLead, T.colModel, T.colErr, T.colHit, T.colN];
    var cell = 'padding:.45rem .6rem; border-bottom:1px solid rgba(26,42,58,.07);';
    var html = '<h2 style="color:var(--primary); font-size:1.1rem; margin:1.5rem 0 .6rem;">' +
      esc(T.tableTitle.replace('{n}', nights.length)) + '</h2>';

    if (el.table.clientWidth && el.table.clientWidth < 560) {
      /* narrow screens: one card per lead instead of a table that has to be scrolled sideways */
      html += rows.map(function (r) {
        return '<div style="border:1px solid rgba(26,42,58,.12); border-radius:var(--radius); padding:.6rem .75rem; margin:0 0 .5rem;">' +
          '<div style="display:flex; justify-content:space-between; gap:.5rem;"><strong>' + esc(leadLabel(r.lead)) + '</strong>' +
          '<span style="color:var(--text-light); font-size:.85rem;">' + esc(modelName(site.leadModel[r.lead])) + '</span></div>' +
          '<div style="font-size:.9rem; margin-top:.2rem;">' + esc(T.colErr) + ': <strong>' + num(r.mae, 1) + '</strong>' +
          ' · ' + esc(T.colHit) + ': <strong>' + (r.hit == null ? '–' : num(r.hit * 100) + ' %') + '</strong>' +
          ' · ' + esc(T.colN) + ': ' + r.n + '</div></div>';
      }).join('');
    } else {
      html += '<div style="overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid rgba(26,42,58,.12); border-radius:var(--radius);">' +
        '<table style="width:100%; min-width:560px; border-collapse:collapse; font-size:.88rem;"><thead><tr style="background:rgba(26,42,58,.06);">' +
        head.map(function (h) {
          return '<th style="text-align:left; padding:.45rem .6rem; font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--primary); border-bottom:1px solid rgba(26,42,58,.18);">' + esc(h) + '</th>';
        }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (r, idx) {
        var shade = idx % 2 ? ' background:rgba(26,42,58,.028);' : '';
        html += '<tr style="' + shade + '">' +
          '<td style="' + cell + '"><strong>' + esc(leadLabel(r.lead)) + '</strong></td>' +
          '<td style="' + cell + ' color:var(--text-light);">' + esc(modelName(site.leadModel[r.lead])) + '</td>' +
          '<td style="' + cell + '">' + num(r.mae, 1) + '</td>' +
          '<td style="' + cell + '">' + (r.hit == null ? '–' : num(r.hit * 100) + ' %') + '</td>' +
          '<td style="' + cell + ' color:var(--text-light);">' + r.n + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '<p style="margin:.7rem 0 0; font-size:.85rem; color:var(--text-light);">' + T.tableNote + '</p>';
    html += '<p style="margin:.4rem 0 0; font-size:.85rem; color:var(--text-light);">' +
      esc(av.n >= 10
        ? (av.bias >= 0 ? T.obsRow : T.obsRowCloudier).replace('{e}', num(Math.abs(av.bias), 1)).replace('{n}', av.n)
        : T.obsRowThin.replace('{n}', av.n).replace('{t}', nights.length)) + '</p>';
    el.table.innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Tooltip                                                            *
   * ------------------------------------------------------------------ */
  function showTip(ev) {
    var L = state.layout, site = state.site;
    if (!L || !site) return;
    var r = el.canvas.getBoundingClientRect(), x = ev.clientX - r.left;
    var i = Math.floor((x - L.LEFT) / L.colW);
    if (i < 0 || i >= L.nights.length || x < L.LEFT) { el.tip.hidden = true; return; }
    var nt = L.nights[i], off = offsetFn(site.tz, 0), leads = LEADS;
    var lines = ['<strong>' + esc(T.tipNight.replace('{d}', dayLabel(nt.from, off))) + '</strong>',
      esc(T.tipDark.replace('{a}', hhmm(nt.from, off)).replace('{b}', hhmm(nt.to, off)))];
    leads.forEach(function (l, k) {
      if (nt.fc[k] == null) return;
      lines.push(esc((l === 1 ? T.tipLead1 : T.tipLead.replace('{n}', l)) + ' (' + modelName(site.leadModel[l]) + '): ') + num(nt.fc[k]) + ' %');
    });
    lines.push('<strong>' + esc(T.tipTruth) + ': ' + num(nt.truth) + ' %</strong>');
    if (nt.obs != null) lines.push(esc(T.tipObs) + ': ' + num(nt.obs) + ' %');
    el.tip.innerHTML = lines.join('<br>');
    el.tip.hidden = false;
    var wrapBox = el.wrap.getBoundingClientRect();
    var left = Math.min(Math.max(x - 60, 4), wrapBox.width - el.tip.offsetWidth - 4);
    el.tip.style.left = (wrapBox.left + window.scrollX + left) + 'px';
    el.tip.style.top = (r.top + window.scrollY + L.R.days[1] + 6) + 'px';
  }

  /* ------------------------------------------------------------------ *
   * Wiring                                                             *
   * ------------------------------------------------------------------ */
  /* what the chart actually drew, so the sentence and the picture cannot contradict each other */
  function renderStatus(nights, obsCount) {
    var site = state.site;
    var ids = (site.stations || []).map(function (s) { return s.id; }).join(', ');
    el.status.textContent = (obsCount ? T.status : site.stations.length ? T.statusNoObs : T.statusNoAsk)
      .replace(/\{n\}/g, nights.length)
      .replace('{an}', modelName(site.leadModel[0]))
      .replace('{st}', ids)
      .replace('{k}', obsCount);
  }

  /* ------------------------------------------------------------------ *
   * Loading                                                            *
   * ------------------------------------------------------------------ */
  /* One location at a time, cached for the page view: the forecasts come in one request, the
     airport reports only when asked for, because that archive needs one request per station
     with a pause between them. */
  var cache = {};

  /* The button and the sentence under it are one row, and once the reports are in, both go away
     together. Every path that changes the location has to come through here: leaving it out is how
     a half-finished button from the previous location ended up greyed out over the next one. */
  function setObsUi(rec, busy) {
    var done = !!(rec && rec.stations.length);
    el.obsRow.hidden = !rec || done;
    el.obsBtn.disabled = !!busy;
    el.obsBtn.textContent = busy ? T.obsLoading : T.obsBtn;
  }

  function loadSite(site) {
    if (cache[site.key]) { state.site = cache[site.key]; setObsUi(cache[site.key], false); render(); return; }
    el.status.textContent = T.loadingFc;
    el.table.innerHTML = '';
    el.canvas.width = 0; el.canvas.height = 0;
    setObsUi(null, false);
    loadForecasts(site).then(function (fc) {
      var pick = chainByLead(site, fc);
      if (!pick[0]) throw new Error('no analysis series');
      var rec = {
        key: site.key, name: site.name, lat: site.lat, lon: site.lon, tz: site.tz,
        chain: site.chain, leadModel: pick, stations: [], obsNights: 0,
        nights: buildNights(site, fc, pick, null), raw: fc, site: site
      };
      cache[site.key] = rec;
      state.site = rec;
      render();
      setObsUi(rec, false);
    }).catch(function () {
      state.failed = true;
      el.status.textContent = T.failedFc;
      setObsUi(null, false);
    });
  }

  function loadObservations() {
    var rec = state.site;
    if (!rec || rec.stations.length) return;
    var nights = rec.nights;
    if (!nights.length) return;
    setObsUi(rec, true);
    var from = new Date(nights[0].from * 1000), to = new Date();
    loadObs(rec.site, from, to).then(function (obs) {
      /* every station refused: leave the row up so it can be tried again, rather than pretending */
      if (!obs.coverage.length) throw new Error('no station answered');
      rec.stations = obs.coverage;
      rec.nights = buildNights(rec.site, rec.raw, rec.leadModel, obs);
      rec.obsNights = rec.nights.filter(function (n) { return n.obs != null; }).length;
      setObsUi(rec, false);
      render();
    }).catch(function () {
      el.obsBtn.disabled = false;
      el.obsBtn.textContent = T.obsFailed;
    });
  }

  function renderCaveats() {
    el.caveats.innerHTML = '<p style="margin:0 0 .5rem;"><strong>' + esc(T.caveatTitle) + '</strong></p>' +
      '<ul style="margin:0; padding-left:1.1rem; font-size:.88rem;">' +
      T.caveats.map(function (c) { return '<li style="margin:0 0 .35rem;">' + esc(c) + '</li>'; }).join('') + '</ul>';
  }

  function buildControls() {
    el.location.innerHTML = SITES.map(function (s) {
      return '<option value="' + esc(s.key) + '">' + esc(s.name[LANG] || s.name.de) + '</option>';
    }).join('');
    el.location.addEventListener('change', function () {
      loadSite(SITES.filter(function (s) { return s.key === el.location.value; })[0]);
    });

    el.span.innerHTML = [14, 30, 60].map(function (v) {
      return '<button type="button" class="btn" data-span="' + v + '" style="padding:.4rem .7rem; font-size:.85rem;">' + v + '</button>';
    }).join('');
    el.span.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-span]');
      if (!b) return;
      state.span = +b.getAttribute('data-span');
      markSpan();
      if (state.site) render();
    });
    markSpan();
    el.obsBtn.addEventListener('click', loadObservations);
  }

  function markSpan() {
    [].forEach.call(el.span.querySelectorAll('[data-span]'), function (b) {
      var on = +b.getAttribute('data-span') === state.span;
      b.style.opacity = on ? '1' : '.55';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  el.canvas.addEventListener('mousemove', showTip);
  el.canvas.addEventListener('mouseleave', function () { el.tip.hidden = true; });
  window.addEventListener('resize', function () { if (state.site) render(); });

  if (window.fetch && window.Promise) {
    buildControls();
    renderCaveats();
    loadSite(SITES[0]);
  } else {
    el.status.textContent = T.failedFc;
  }
})();
