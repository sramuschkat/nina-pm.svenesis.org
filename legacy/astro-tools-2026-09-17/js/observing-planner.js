/*
 * Observing planner for svenesis.org
 *
 * For one location and one night: the moon, a star map with the constellations (astro-tools/js/sky-map.js), visibility bars for
 * moon and planets, a top list of deep-sky objects for imaging or for the eye, and the events of the night. Everything
 * is computed in the browser with astro-tools/js/astro-core.js, astro-tools/js/sky-events.js and the catalogues in astro-tools/js/dso-catalog.js and
 * astro-tools/js/star-catalog.js; data come from this server (astro-tools/data/sky-events.json, doubles.json, stars-8.bin, ngc.json), only the
 * sky photographs of the zoomed-in star map come from CDS, Strasbourg. The scores are the script's own estimates, and
 * the page says so.
 */
(function () {
  'use strict';

  var root = document.getElementById('op-root');
  if (!root || !window.SvAstro || !window.SvSkyMap) return;

  var A = window.SvAstro, CATALOG = window.SvDSO || [], SKY = window.SvSky || null;
  var LANG = document.documentElement.lang === 'en' ? 'en' : 'de';
  /* Constellation names from astro-tools/js/star-catalog.js, the same on the star map and in the list: the Latin names of the
     IAU, usual in astronomy and in the US, or the everyday names of the page's language. The German page starts
     with the German names, the English page with the Latin ones; a choice that differs travels in the URL. */
  var NAME_DEFAULT = LANG === 'de' ? 'local' : 'latin', CONS = { latin: {}, local: {} };
  if (SKY) SKY.labels.forEach(function (l) { CONS.latin[l[0]] = l[5].replace(/ (Caput|Cauda)$/, ''); CONS.local[l[0]] = LANG === 'de' ? l[4] : l[6]; });
  function consName(ab) { return CONS[state.names][ab] || ab; }
  var RAD = A.RAD, clamp = A.clamp, pad = A.pad, hhmmLoc = A.hhmm, localDate = A.localDate, fromLocal = A.fromLocal;
  var BODIES = A.BODIES, BODY_COL = A.BODY_COL, TWI = A.TWI;
  /* from the star map, set in the wiring below */
  var aimSkyMap, drawSkyMap, PHOTO_AUTO, PHOTO_FOV, prepareSky, skyTouch;

  var T = {
    de: {
      days: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
      compass: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'],
      badCoords: 'Bitte gültige Koordinaten eingeben (Breite −90 bis 90, Länge −180 bis 180).',
      statusPreset: 'Zeiten in Ortszeit von {name} ({zone})',
      statusCustom: 'Eigene Koordinaten · Zeiten in der gewählten Zeitzone {zone}',
      statusCustomHint: 'Eigene Koordinaten · Zeiten in der Zeitzone deines Browsers ({zone}) – weicht die des Standorts ab, bitte unter „Zeitzone“ wählen',
      lit: 'beleuchtet',
      plNames: { moon: 'Mond', mercury: 'Merkur', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptun' },
      view: 'Blick nach {c}, links {l}, rechts {r}',
      compassLong: ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'],
      plPhase: ['Tag', 'bürgerliche Dämmerung', 'nautische Dämmerung', 'astronomische Dämmerung', 'astronomisch dunkel'],
      plRise: 'Aufgang', plSet: 'Untergang', plTop: 'am besten', plDown: 'in dieser Nacht nicht über dem Horizont',
      plDayOnly: 'nur am Taghimmel über dem Horizont', plLow: 'nach Sonnenuntergang nur knapp über dem Horizont',
      types: { Gx: 'Galaxie', EN: 'Emissionsnebel', RN: 'Reflexionsnebel', DN: 'Dunkelnebel', PN: 'Planetarischer Nebel', SNR: 'Supernova-Überrest', GC: 'Kugelsternhaufen', OC: 'Offener Sternhaufen', DS: 'Doppelstern', St: 'Stern', Ast: 'Sterngruppe oder Sonstiges' },
      listPhoto: 'Für Fotos bewertet, für das Rig bei Starfront (GT81 mit Ares-M Pro, 1,69° Bildfeld, Schmalband bei Mond): Zeit in großer Höhe während der Dunkelheit, Mond, Helligkeit und wie das Objekt das Bildfeld füllt · {n} Objekte erreichen in dieser Nacht mindestens 20°',
      listVisual: 'Für das Auge bewertet: Helligkeit, Flächenhelligkeit, Höhe und Mond · {n} Objekte erreichen in dieser Nacht mindestens 20°',
      listExtraLoading: ' · die weiteren Kataloge werden geladen …',
      nautical: ' · keine astronomische Dunkelheit, gerechnet mit nautischer Dunkelheit',
      urban: ' · stadtnaher Standort: lichtschwache Galaxien und Nebel abgewertet',
      none: 'In dieser Nacht erreicht kein Objekt dieser Auswahl in der Dunkelheit 20° Höhe.',
      noDarkList: 'In dieser Nacht wird es nicht einmal nautisch dunkel – deshalb keine Liste.',
      head: { rank: '#', obj: 'Objekt', type: 'Typ · Sternbild · Größe', chart: 'Höhe in der Nacht', best: 'beste Zeit · Höhe · Mond', hours: 'über 30°', mag: 'Helligkeit', moon: 'Mond zur besten Zeit', size: 'Größe' },
      moonDown: 'unter dem Horizont', moonAt: '{d}° entfernt, {p} %',
      cardBest: 'am besten {t} in {a}° Höhe', cardHours: '{h} h über 30°', cardMag: '{m} mag',
      moTitle: '{phase} · {p} % beleuchtet · {age} Tage nach Neumond', moAria: 'Mondphase: {phase}, {p} % beleuchtet',
      moPhases: ['Neumond', 'Zunehmende Sichel', 'Erstes Viertel', 'Zunehmender Mond', 'Vollmond', 'Abnehmender Mond', 'Letztes Viertel', 'Abnehmende Sichel'],
      moPos: 'Um {t}', moPosUp: '{alt}° hoch im {dir}', moPosDown: 'unter dem Horizont',
      moRiseSet: 'Aufgang · Untergang', moRise: '↑ {t}', moSet: '↓ {t}', moAllNight: 'die ganze Nacht über dem Horizont', moNoNight: 'in der Nacht nicht über dem Horizont', moHours: '{h} h {m} min', moAbout: 'etwa {t}',
      calTodayMark: ' (heute)',
      months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
      calMarks: ['Neumond', 'Erstes Viertel (zunehmender Halbmond)', 'Vollmond', 'Letztes Viertel (abnehmender Halbmond)'], calShort: ['Neumond', 'zun. Halbmond', 'Vollmond', 'abn. Halbmond'],
      calAria: '{day}: {phase}, {p} % beleuchtet', calNote: 'Phase und beleuchteter Anteil jeweils um Mitternacht der Nacht ab diesem Abend; einen Tag anklicken wählt diese Nacht. Orange umrandet: heute.',
      imgAlt: '{id} im Digitized Sky Survey', imgField: 'Bildausschnitt {f}', showMap: 'In Sternkarte zeigen', listMore: 'Weitere {n} anzeigen', listLess: 'Weniger anzeigen', infoBestTime: 'Zur besten Zeit', showMapOn: 'In Sternkarte gewählt', barsNow: 'jetzt', barsMax: 'max. Höhe', barsMaxShort: 'max.', barsExtra: 'mag · %',
      evDoubles: 'Schöne Doppelsterne der Nacht', evNoDoubles: 'Kein Doppelstern der Liste steht in dieser Nacht im Dunkeln 25° hoch.', dblAperture: 'ab {d} mm', dblBinoc: 'Fernglas genügt', dblMags: '{a} / {b} mag',
      evDoublesNote: 'Aus dem Washington Double Star Catalog: Abstand und Positionswinkel der letzten Messung; die Öffnung ist eine grobe Faustregel (Dawes-Grenze, mehr bei großem Helligkeitsunterschied und unruhiger Luft). Gereiht nach Höhe, Helligkeit, Abstand und Farbkontrast.',
      evTransits: 'Raumstation vor Mond oder Sonne', evTransitMoon: '{s} vor dem Mond', evTransitSun: '{s} vor der Sonne', evTransitHit: 'Durchgang, {d} s', evTransitMiss: 'knapp daneben, {a} am Rand vorbei', evCentre: 'etwa {km} km entfernt',
      evNoTransit: 'Kein Durchgang und kein Vorbeigang unter 1° vor Mond oder Sonne zwischen diesem und dem nächsten Mittag.',
      evTransitNote: 'Zeiten auf wenige Sekunden je nach Alter der Bahndaten; die Zentrallinie ist nur wenige Kilometer breit – kurz vorher mit frischen Daten prüfen. Die Sonne nur mit geeignetem Sonnenfilter beobachten!',
      evOcc: 'Mondbedeckungen', evStarMag: 'Stern {m} mag', evLimbDark: 'am dunklen Rand', evLimbBright: 'am hellen Rand', evUnseen: '(nicht sichtbar)',
      evNoOcc: 'In dieser Nacht bedeckt der Mond hier keinen Stern bis 6 mag und keinen Planeten.',
      evOccNote: 'Zeiten für Sterne etwa ±1 Minute, für Planeten (Mittelpunkt) einige Minuten. Am hellen Mondrand gehen schwache Sterne im Mondlicht unter.',
      evJup: 'Jupitermonde', jupKinds: { transit: 'vor Jupiter', shadow: 'Schatten auf Jupiter', occultation: 'hinter Jupiter', eclipse: 'im Jupiterschatten' }, evBefore: 'vorher', evAfter: 'danach',
      evNoJup: 'In dieser Nacht keine sichtbaren Durchgänge, Schatten, Bedeckungen oder Verfinsterungen der großen Jupitermonde.',
      evJupNote: 'Nach Meeus, auf etwa 5 Minuten genau; „Sichtbar“: Jupiter mindestens 8° hoch, Sonne unter −6°.',
      evGc: 'Zentrum der Milchstraße', gcName: 'Sgr A* (Schütze)', evGcNone: 'in der Dunkelheit nicht 10° hoch', evGcNoSeason: 'hier nie 10° hoch bei Dunkelheit', evAllYear: 'ganzjährig', evMoonSep: '{d}° entfernt',
      evGcNote: '„Sichtbar“: mindestens 10° hoch in astronomischer Dunkelheit. Die Saison zählt die Monate, in denen das mindestens eine Stunde lang gelingt.',
      evRateVal: 'etwa {n}/h', evRateAt: 'um {t}', evRateNote: '„Erwartet“ ist eine grobe Schätzung für diesen Ort aus Radianthöhe, Himmel (Grenzgröße {lm} mag) und Mond.',
      evEcl: 'Die nächsten Finsternisse am Standort',
      eclLunar: { total: 'Totale Mondfinsternis', partial: 'Partielle Mondfinsternis', penumbral: 'Halbschatten-Mondfinsternis' },
      eclSolar: { total: 'Totale Sonnenfinsternis', annular: 'Ringförmige Sonnenfinsternis', partial: 'Partielle Sonnenfinsternis' },
      eclCentral: { total: 'total {a}–{b}', annular: 'ringförmig {a}–{b}' }, eclUmbra: 'Kernschatten {a}–{b}', eclPenumbra: 'Halbschatten {a}–{b}', eclTotal: 'total {a}–{b}',
      eclMag: 'Größe {m}', eclObsc: '{p} % der Sonne bedeckt', eclWhole: 'ganz sichtbar', eclPart: 'sichtbar {a}–{b}', eclAlt: 'beim Maximum {a}° hoch',
      evNoEcl: 'In den nächsten Jahren ist hier keine Finsternis zu sehen.',
      evEclNote: 'Zeiten etwa ±2 Minuten, ab der gewählten Nacht: bis zu drei Mondfinsternisse der nächsten 10 und drei Sonnenfinsternisse der nächsten 20 Jahre. Nie ohne geeigneten Sonnenfilter in eine Sonnenfinsternis sehen!',
      seasonBusy: 'wird berechnet …', tipDark: 'Dunkel', tipGood: 'Über 30°, mondfrei', tipMoon: 'Über 30°, mit Mond', tipAbove: 'Über 30°', tipMax: 'Größte Höhe', tipSep: 'Mondabstand', tipIllum: 'Mond beleuchtet',
      evSats: 'Überflüge von Raumstationen und Hubble', evMeet: 'Begegnungen am Himmel', evShowers: 'Meteorströme', evComets: 'Kometen',
      evHead: { dbl: 'Doppelstern', mags: 'Helligkeiten', sepPa: 'Abstand · Winkel', aperture: 'Öffnung', transit: 'Ereignis', tWhen: 'Zeitpunkt', result: 'Vorbeigang', centre: 'Zentrallinie', occ: 'Objekt', dis: 'Verschwindet', re: 'Taucht wieder auf', moonAt: 'Mond', jupEvent: 'Ereignis', times: 'Beginn–Ende', vis: 'Sichtbar', jupAlt: 'Jupiter', expect: 'Erwartet', gcWhen: 'Sichtbar', gcBest: 'Am höchsten', gcMoon: 'Mond', gcSeason: 'Saison', ecl: 'Finsternis', eclWhen: 'Maximum', eclPhase: 'Phasen', eclVis: 'Sichtbarkeit', sat: 'Objekt', time: 'Sichtbar', high: 'Höchster Punkt', mag: 'Helligkeit', path: 'Weg', pair: 'Begegnung', sep: 'Abstand', closest: 'Am engsten', dir: 'Richtung',
        shower: 'Strom', peak: 'Maximum', radiant: 'Radiant', zhr: 'Meteore/h', moon: 'Mond', comet: 'Komet', best: 'Am besten', dist: 'Entfernung' },
      evShadow: 'verschwindet im Erdschatten', evUpTo: 'bis {v}', evAbout: 'etwa {v}', evAu: '{v} AE', evPairName: '{a} und {b}',
      evZhrNote: 'Meteore pro Stunde am Maximum unter sehr dunklem Himmel; tatsächlich sieht man meist deutlich weniger.',
      evNoPass: 'In dieser Nacht keine sichtbaren Überflüge von ISS, Tiangong oder Hubble (über 10° Höhe, Sonne mindestens 6° unter dem Horizont).',
      evStale: 'Für diese Nacht gibt es keine verlässlichen Bahndaten: Stand {d}, Vorhersagen gelten etwa zwei Wochen.', evNone: 'In dieser Nacht gibt es keine dieser Ereignisse.', calDark: ', mondfreie Dunkelheit {d}', calBestMark: ', eine der drei besten Nächte des Monats', calBestKey: '★ die drei Nächte mit der längsten mondfreien Dunkelheit · getönt: Nächte ab Freitag und Samstag.', plCardBest: 'max. {alt}° um {t} · {dir}', plCardLit: '{p} % beleuchtet', plCardHidden: 'Nicht über 10° bei Nacht: {list}', calDarkKey: 'Grüner Balken: mondfreie astronomische Dunkelheit der Nacht (voll = die längste des Monats, mindestens 8 h).',
      evStaleSome: 'Ohne verlässliche Bahndaten für diese Nacht: {list} – Vorhersagen gelten etwa zwei Wochen.', evStaleItem: '{s} (Stand {d})',
      moPolarDay: 'die Sonne geht nicht unter – kein Nachthimmel', moDarkAll: 'durchgehend dunkel', gcNautical: ' (nautisch)',
      evGcNoteNautical: 'In dieser Nacht wird es nicht astronomisch dunkel: „Sichtbar“ zählt hier mindestens 10° Höhe in nautischer Dunkelheit (Sonne unter −12°). Die Saison zählt die Monate, in denen das in astronomischer Dunkelheit mindestens eine Stunde lang gelingt.',
      evNoMeet: 'In dieser Nacht keine engen Begegnungen von Mond, Planeten und hellen Sternen.',
      evPeakNow: 'in dieser Nacht', evPeakIn: 'in {d} Tagen', evPeakAgo: 'vor {d} Tagen', evPeakIn1: 'in 1 Tag', evPeakAgo1: 'vor 1 Tag',
      evRadFrom: 'ab {t} über 30°, am höchsten um {bt} in {alt}°', evRadLow: 'am höchsten um {bt} in nur {alt}°', evRadDown: 'in der Dunkelheit nicht über dem Horizont', evRadNoDark: 'in dieser Nacht wird es dafür nicht dunkel genug',
      evNoShower: 'In dieser Nacht ist keiner der großen Meteorströme aktiv.',
      evNoComet: 'In dieser Nacht steht kein Komet heller als etwa 12 mag in der Dämmerung oder Dunkelheit über 10°.',
      evCometsOld: 'Für diese Nacht sind die Kometendaten nicht vollständig: Stand {d}, erfasst sind Kometen mit Sonnennähe von etwa einem Jahr davor bis knapp zwei Jahre danach.',
      evCometNote: 'Kometenhelligkeiten sind Schätzungen und können um mehrere Größenklassen danebenliegen.',
      evData: 'Satellitenbahnen Stand {tle} · Kometenbahnen Stand {gen} · „In Sternkarte zeigen“ stellt Uhrzeit und Sternkarte darauf ein',
      evLoading: 'Bahndaten werden geladen …', evFailed: 'Die Bahndaten für Satelliten und Kometen konnten nicht geladen werden.',
      chartCap: 'Höhe über dem Horizont in dieser Nacht · grün: astronomisch dunkel · rote Fläche: Mond · rote Linie: Uhrzeit am Regler · violett: Meridian-Flip · Punkt: beste Zeit', chartNow: 'Uhrzeit {t}', chartFlip: 'Meridian-Flip {t}', chartMoon: 'Mond: Abstand · beleuchtet',
      chartAria: '{id}: Höhenverlauf in dieser Nacht, am höchsten {a}° um {t}', twiLetters: ['B', 'N', 'A'],
      smSub: 'Nacht {n} · {view}', ctxNight: 'Nacht {n}', ctxCustom: 'Eigene Koordinaten {lat}, {lon}', pcNote: ' · in Klammern: die Uhrzeit deines Geräts ({zone})', pcClock: '{t} bei dir',
      kc: { twilight: 'Dämmerung', dark: 'astronomisch dunkel', moon: 'Mond', moonUp: 'Mond am Himmel', alt: 'Höhe', slider: 'eingestellte Uhrzeit', flip: 'Meridian-Flip', best: 'beste Zeit', darkHours: 'Stunden Dunkelheit', moonless: 'über 30° ohne Mond', moonlit: 'über 30° mit Mond', moonAbove: 'Mond über 30°', maxAlt: 'größte Höhe', moonSep: 'Mondabstand', chosen: 'gewählte Nacht', today: 'heute', nowMark: 'jetzt', seasonScale: 'Balken in Stunden (rechts), Linien in Grad (links, Mondabstand halbiert)', clickNight: 'Klick wählt die Nacht', clickTime: 'Klick stellt die Uhrzeit', pcRow: 'untere Stundenzeile: Uhrzeit deines Geräts', rowLoc: 'Standort', rowPc: 'bei dir', day: 'Tag', civil: 'bürgerliche Dämmerung', nautical: 'nautische', astronomical: 'astronomische', moonAlt: 'Mondhöhe', tsCivil: 'bürg.', tsNaut: 'naut.', tsAstr: 'astr.', darkSpan: '{d} astronomisch dunkel', twiNote: 'bürg./naut./astr.: Sonne bei −6°/−12°/−18° (Ende der Dämmerung am Abend, Beginn am Morgen) · Klick stellt die Uhrzeit' }, smHelp: 'Ziehen oder Pfeile zum Drehen, +/−, Doppelklick oder Strg/⌘ + Mausrad zum Zoomen; hineingezoomt lässt sich die Karte auch nach oben und unten ziehen. Ein Klick auf einen Stern, einen Planeten oder ein Objekt öffnet seine Detailkarte unter den Schaltern.',
      smZoomed: '{f}° breit · Sterne bis {m} mag', smBelow: '{s} steht um {t} unter dem Horizont ({alt}°)', viewUp: ', Mitte in {a}° Höhe', smPhotoSrc: ' · Fotos: {s} (CDS)', smPhotoLoading: ' · Fotos laden …', smFullOn: '⛶ Vollbild', smFullOff: '✕ Vollbild beenden', infoCenter: 'Zentrieren', findCons: 'Sternbild', findNone: 'Nichts gefunden', findLoading: 'Suche wird geladen …', findMoved: 'Um diese Uhrzeit unter dem Horizont – die Uhrzeit steht jetzt auf {t}, dann steht es in der Dunkelheit am höchsten ({alt}°).', findMovedLight: 'Um diese Uhrzeit unter dem Horizont – die Uhrzeit steht jetzt auf {t}, dann steht es am höchsten ({alt}°); bei Dunkelheit steht es in dieser Nacht nicht über dem Horizont.', findNever: 'Steht in dieser Nacht nicht über dem Horizont.', galilean: ['Io', 'Europa', 'Ganymed', 'Kallisto'],
      infoClose: 'Info schließen', infoStar: 'Stern', infoDouble: 'Doppelstern', infoWds: 'Katalog (WDS)', infoSpec: 'Spektraltypen', infoPlanet: 'Planet', infoMoonKind: 'Erdmond', infoUnnamed: 'Stern ohne Eigennamen',
      infoMag: 'Helligkeit', infoColour: 'Farbe', colours: ['bläulich', 'weiß', 'gelblich weiß', 'gelb', 'orange', 'rötlich'],
      infoDist: 'Entfernung', infoLy: 'etwa {n} Lichtjahre', infoLyRough: 'etwa {n} Lichtjahre (unsicher)', infoLyFar: 'sehr weit – die Parallaxe ist zu klein zum Messen',
      infoAu: '{au} AE · {min} Lichtminuten', infoKm: '{km} km', infoSize: 'Scheinbarer Durchmesser', infoLit: 'Beleuchtet',
      infoCons: 'Sternbild', infoCoord: 'Koordinaten J2000', infoTransit: 'Höchster Stand', infoTransitVal: '{t} in {alt}°',
      infoUsable: 'Nutzbare Dunkelstunden über 30°', infoUsableSome: '{h} h, davon {m} h mondfrei', infoUsableMoonless: '{h} h, mondfrei', infoUsableMoon: '{h} h, alle mit Mond', infoUsableNone: 'keine', infoUsableNaut: '(nautisch dunkel)',
      infoPm: 'Eigenbewegung', infoPmVal: '{v}″ pro Jahr', infoObjSize: 'Größe', infoBest: 'Beste Zeit', infoWiki: 'Wikipedia', infoAlso: 'Weitere Bezeichnungen',
      cat: { title: 'Was die Suche kennt', live: 'live aus den Daten dieser Seite gezählt', loading: 'Die NGC- und IC-Daten werden geladen …', failed: 'Die NGC- und IC-Daten ließen sich nicht laden, gezählt ist nur der eigene Katalog.',
        head: ['Katalog', 'Suchbar', 'Hinweis'], complete: 'Vollständige Kataloge', cross: 'Weitere Katalognummern', crossNote: 'nur Objekte, die auch in NGC, IC oder OpenNGC stehen', stars: 'Sterne und Sonnensystem',
        of: '{n} von {t}', nonex: '{n} laut OpenNGC nicht existent', parts: '+ {n} Teilobjekte (A, B …)',
        names: { M: 'Messier', NGC: 'NGC', IC: 'IC', C: 'Caldwell', Sh2: 'Sharpless (HII-Regionen)', PGC: 'PGC (Galaxien)', UGC: 'UGC (Galaxien)', ESO: 'ESO/Uppsala', UGCA: 'UGCA', LBN: 'LBN (helle Nebel)', Mel: 'Melotte', Cl: 'Collinder', H: 'Harvard', MWSC: 'MWSC (Sternhaufen)', HCG: 'Hickson Compact Groups', B: 'Barnard (Dunkelwolken)', HD: 'HD (Sterneinträge)', HIP: 'HIP (Sterneinträge)', WDS: 'WDS (Doppelsterne)' },
        starNamed: 'Sterne mit Eigennamen', starBayer: 'Sterne mit Bayer-Buchstaben', cons: 'Sternbilder', bodies: 'Mond und Planeten', common: 'Allgemeinnamen (Orionnebel …)',
        not: 'Nicht über die Suche: die Doppelsterne der Nacht (nur in der Liste der besten Objekte), Satelliten und Kometen (unter Ereignisse der Nacht). Barnards Dunkelwolken fehlen weitgehend, weil OpenNGC diesen Katalog nicht führt.' },
      photoNote: 'Ab {f}° Bildbreite lädt die Sternkarte Himmelsfotos (Digitized Sky Survey, wahlweise Pan-STARRS oder 2MASS) vom CDS Straßburg nach; dabei wird deine IP-Adresse an das CDS übertragen. Abschalten mit „Himmelsfotos“ – mehr in der {link}.',
      photoNoteClick: 'Mit „Himmelsfotos“ lädt die Sternkarte ab {f}° Bildbreite Himmelsfotos (Digitized Sky Survey, wahlweise Pan-STARRS oder 2MASS) vom CDS Straßburg nach; erst dann wird deine IP-Adresse an das CDS übertragen – mehr in der {link}.',
      privacyText: 'Datenschutzerklärung', privacyHref: '../privacy/privacy_de.html',
      smHigh: 'Hoch am Himmel um {t}: {list}.',
      smNone: 'Um {t} steht keines der auffälligen Sternbilder hoch am Himmel.',
      smDay: ' Es ist Tag – die Sterne sind nicht zu sehen, die Karte zeigt, wo sie stehen.',
      smMilkyWay: 'Milchstraße', smEcliptic: 'Ekliptik', smZenith: 'Zenit'
    },
    en: {
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
      badCoords: 'Please enter valid coordinates (latitude −90 to 90, longitude −180 to 180).',
      statusPreset: 'Times in local time of {name} ({zone})',
      statusCustom: 'Custom coordinates · times in the chosen time zone {zone}',
      statusCustomHint: 'Custom coordinates · times in your browser’s time zone ({zone}) – if the location’s differs, please choose it under “Time zone”',
      lit: 'lit',
      plNames: { moon: 'Moon', mercury: 'Mercury', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune' },
      view: 'looking {c}, {l} on the left, {r} on the right',
      compassLong: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
      plPhase: ['day', 'civil twilight', 'nautical twilight', 'astronomical twilight', 'astronomically dark'],
      plRise: 'rises', plSet: 'sets', plTop: 'best', plDown: 'not above the horizon this night',
      plDayOnly: 'above the horizon only in daylight', plLow: 'only just above the horizon after sunset',
      types: { Gx: 'Galaxy', EN: 'Emission nebula', RN: 'Reflection nebula', DN: 'Dark nebula', PN: 'Planetary nebula', SNR: 'Supernova remnant', GC: 'Globular cluster', OC: 'Open cluster', DS: 'Double star', St: 'Star', Ast: 'Asterism or other' },
      listPhoto: 'Rated for imaging with the rig at Starfront (GT81 with Ares-M Pro, 1.69° field, narrowband under the moon): time high up in darkness, moon, brightness and how the object fills the field · {n} objects reach at least 20° this night',
      listVisual: 'Rated for the eye: brightness, surface brightness, altitude and moon · {n} objects reach at least 20° this night',
      listExtraLoading: ' · loading the further catalogues …',
      nautical: ' · no astronomical darkness, nautical darkness used',
      urban: ' · location near a city: faint galaxies and nebulae rated down',
      none: 'No object of this selection reaches 20° in darkness this night.',
      noDarkList: 'It does not even get nautically dark this night – so there is no list.',
      head: { rank: '#', obj: 'Object', type: 'type · constellation · size', chart: 'altitude tonight', best: 'best time · altitude · moon', hours: 'above 30°', mag: 'brightness', moon: 'moon at best time', size: 'size' },
      moonDown: 'below the horizon', moonAt: '{d}° away, {p} %',
      cardBest: 'best at {t}, {a}° high', cardHours: '{h} h above 30°', cardMag: '{m} mag',
      moTitle: '{phase} · {p} % lit · {age} days after new moon', moAria: 'Moon phase: {phase}, {p} % lit',
      moPhases: ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'],
      moPos: 'At {t}', moPosUp: '{alt}° up in the {dir}', moPosDown: 'below the horizon',
      moRiseSet: 'Rise · set', moRise: '↑ {t}', moSet: '↓ {t}', moAllNight: 'above the horizon all night', moNoNight: 'not above the horizon at night', moHours: '{h} h {m} min', moAbout: 'about {t}',
      calTodayMark: ' (today)',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      calMarks: ['New moon', 'First quarter (half moon)', 'Full moon', 'Last quarter (half moon)'], calShort: ['New', 'First qtr', 'Full', 'Last qtr'],
      calAria: '{day}: {phase}, {p} % lit', calNote: 'Phase and lit share at midnight of the night starting that evening; click a day to choose that night. Orange frame: today.',
      imgAlt: '{id} in the Digitized Sky Survey', imgField: 'field of view {f}', showMap: 'Show on star map', listMore: 'Show {n} more', listLess: 'Show fewer', infoBestTime: 'Go to best time', showMapOn: 'Selected on star map', barsNow: 'now', barsMax: 'max alt', barsMaxShort: 'max', barsExtra: 'mag · %',
      evDoubles: 'Attractive double stars of the night', evNoDoubles: 'No double star of the list stands 25° high in darkness this night.', dblAperture: 'from {d} mm', dblBinoc: 'binoculars will do', dblMags: '{a} / {b} mag',
      evDoublesNote: 'From the Washington Double Star Catalog: separation and position angle of the latest measurement; the aperture is a rough rule of thumb (Dawes limit, more for a large brightness difference and unsteady air). Ranked by altitude, brightness, separation and colour contrast.',
      evTransits: 'Space station in front of the moon or sun', evTransitMoon: '{s} in front of the moon', evTransitSun: '{s} in front of the sun', evTransitHit: 'transit, {d} s', evTransitMiss: 'near miss, {a} past the limb', evCentre: 'about {km} km away',
      evNoTransit: 'No transit and no pass within 1° of the moon or sun between this noon and the next.',
      evTransitNote: 'Times within a few seconds, depending on the age of the orbital data; the centre line is only a few kilometres wide – check with fresh data shortly before. Look at the sun only through a proper solar filter!',
      evOcc: 'Lunar occultations', evStarMag: 'star {m} mag', evLimbDark: 'at the dark limb', evLimbBright: 'at the bright limb', evUnseen: '(not visible)',
      evNoOcc: 'Seen from here, the moon covers no star down to magnitude 6 and no planet this night.',
      evOccNote: 'Times within about a minute for stars, a few minutes for planets (their centre). At the bright limb faint stars drown in moonlight.',
      evJup: 'Jupiter’s moons', jupKinds: { transit: 'in front of Jupiter', shadow: 'shadow on Jupiter', occultation: 'behind Jupiter', eclipse: 'in Jupiter’s shadow' }, evBefore: 'before', evAfter: 'after',
      evNoJup: 'No visible transits, shadows, occultations or eclipses of Jupiter’s large moons this night.',
      evJupNote: 'After Meeus, within about 5 minutes; “visible”: Jupiter at least 8° high, sun below −6°.',
      evGc: 'Centre of the Milky Way', gcName: 'Sgr A* (Sagittarius)', evGcNone: 'not 10° high in darkness', evGcNoSeason: 'never 10° high in darkness here', evAllYear: 'all year', evMoonSep: '{d}° away',
      evGcNote: '“Visible”: at least 10° high in astronomical darkness. The season counts the months in which that holds for at least an hour.',
      evRateVal: 'about {n}/h', evRateAt: 'at {t}', evRateNote: '“Expected” is a rough estimate for this place from the radiant’s altitude, the sky (limiting magnitude {lm}) and the moon.',
      evEcl: 'The next eclipses seen from here',
      eclLunar: { total: 'Total lunar eclipse', partial: 'Partial lunar eclipse', penumbral: 'Penumbral lunar eclipse' },
      eclSolar: { total: 'Total solar eclipse', annular: 'Annular solar eclipse', partial: 'Partial solar eclipse' },
      eclCentral: { total: 'total {a}–{b}', annular: 'annular {a}–{b}' }, eclUmbra: 'umbra {a}–{b}', eclPenumbra: 'penumbra {a}–{b}', eclTotal: 'total {a}–{b}',
      eclMag: 'magnitude {m}', eclObsc: '{p} % of the sun covered', eclWhole: 'fully visible', eclPart: 'visible {a}–{b}', eclAlt: '{a}° high at greatest',
      evNoEcl: 'No eclipse is visible from here in the coming years.',
      evEclNote: 'Times within about 2 minutes, from the chosen night on: up to three lunar eclipses of the next 10 and three solar eclipses of the next 20 years. Never look at a solar eclipse without a proper solar filter!',
      seasonBusy: 'computing …', tipDark: 'Dark', tipGood: 'Above 30°, moonless', tipMoon: 'Above 30°, moon up', tipAbove: 'Above 30°', tipMax: 'Highest', tipSep: 'Moon distance', tipIllum: 'Moon lit',
      evSats: 'Passes of space stations and Hubble', evMeet: 'Close encounters', evShowers: 'Meteor showers', evComets: 'Comets',
      evHead: { dbl: 'Double star', mags: 'Magnitudes', sepPa: 'Separation · angle', aperture: 'Aperture', transit: 'Event', tWhen: 'Time', result: 'Pass', centre: 'Centre line', occ: 'Object', dis: 'Disappears', re: 'Reappears', moonAt: 'Moon', jupEvent: 'Event', times: 'Start–end', vis: 'Visible', jupAlt: 'Jupiter', expect: 'Expected', gcWhen: 'Visible', gcBest: 'Highest', gcMoon: 'Moon', gcSeason: 'Season', ecl: 'Eclipse', eclWhen: 'Greatest', eclPhase: 'Phases', eclVis: 'Visibility', sat: 'Object', time: 'Visible', high: 'Highest point', mag: 'Brightness', path: 'Path', pair: 'Encounter', sep: 'Separation', closest: 'Closest', dir: 'Direction',
        shower: 'Shower', peak: 'Peak', radiant: 'Radiant', zhr: 'Meteors/h', moon: 'Moon', comet: 'Comet', best: 'Best', dist: 'Distance' },
      evShadow: 'fades into the Earth’s shadow', evUpTo: 'up to {v}', evAbout: 'about {v}', evAu: '{v} au', evPairName: '{a} and {b}',
      evZhrNote: 'Meteors per hour at the peak under a very dark sky; in practice you usually see far fewer.',
      evNoPass: 'No visible passes of the ISS, Tiangong or Hubble this night (above 10°, sun at least 6° below the horizon).',
      evStale: 'No reliable orbital data for this night: data from {d}, predictions hold for about two weeks.', evNone: 'None of these events this night.', calDark: ', moon-free darkness {d}', calBestMark: ', one of the three best nights of the month', calBestKey: '★ the three nights with the longest moon-free darkness · tinted: nights from Friday and Saturday.', plCardBest: 'max {alt}° at {t} · {dir}', plCardLit: '{p} % lit', plCardHidden: 'Not above 10° at night: {list}', calDarkKey: 'Green bar: the night\'s moon-free astronomical darkness (full = the month\'s longest, at least 8 h).',
      evStaleSome: 'No reliable orbital data for this night: {list} – predictions hold for about two weeks.', evStaleItem: '{s} (data from {d})',
      moPolarDay: 'the sun does not set – no night sky', moDarkAll: 'dark throughout', gcNautical: ' (nautical)',
      evGcNoteNautical: 'It does not get astronomically dark this night: “visible” here means at least 10° high in nautical darkness (sun below −12°). The season counts the months in which that holds for at least an hour in astronomical darkness.',
      evNoMeet: 'No close encounters of the moon, planets and bright stars this night.',
      evPeakNow: 'this night', evPeakIn: 'in {d} days', evPeakAgo: '{d} days ago', evPeakIn1: 'in 1 day', evPeakAgo1: '1 day ago',
      evRadFrom: 'above 30° from {t}, highest at {bt} at {alt}°', evRadLow: 'highest at {bt} at only {alt}°', evRadDown: 'not above the horizon in darkness', evRadNoDark: 'the sky does not get dark enough for it this night',
      evNoShower: 'None of the major meteor showers is active this night.',
      evNoComet: 'No comet brighter than about magnitude 12 stands above 10° in twilight or darkness this night.',
      evCometsOld: 'The comet data do not fully cover this night: as of {d}, they include comets with perihelion from about a year before to nearly two years after that date.',
      evCometNote: 'Comet magnitudes are estimates and can be off by several magnitudes.',
      evData: 'satellite orbits as of {tle} · comet orbits as of {gen} · “Show on star map” sets the time and the star map to it',
      evLoading: 'Loading orbital data …', evFailed: 'The orbital data for satellites and comets could not be loaded.',
      chartCap: 'altitude above the horizon this night · green: astronomically dark · red area: moon · red line: time on the slider · violet: meridian flip · dot: best time', chartNow: 'time {t}', chartFlip: 'meridian flip {t}', chartMoon: 'moon: distance · lit',
      chartAria: '{id}: altitude through this night, highest {a}° at {t}', twiLetters: ['C', 'N', 'A'],
      smSub: 'Night {n} · {view}', ctxNight: 'Night {n}', ctxCustom: 'Custom coordinates {lat}, {lon}', pcNote: ' · in brackets: your device’s time ({zone})', pcClock: '{t} your time',
      kc: { twilight: 'twilight', dark: 'astronomically dark', moon: 'moon', moonUp: 'moon up', alt: 'altitude', slider: 'chosen time', flip: 'meridian flip', best: 'best time', darkHours: 'hours of darkness', moonless: 'above 30° without moon', moonlit: 'above 30° with moon', moonAbove: 'moon above 30°', maxAlt: 'highest altitude', moonSep: 'distance to moon', chosen: 'chosen night', today: 'today', nowMark: 'now', seasonScale: 'bars in hours (right), lines in degrees (left, moon distance halved)', clickNight: 'click to choose a night', clickTime: 'click to set the time', pcRow: 'lower hour row: your device’s time', rowLoc: 'location', rowPc: 'your time', day: 'day', civil: 'civil twilight', nautical: 'nautical', astronomical: 'astronomical', moonAlt: 'moon altitude', tsCivil: 'civ.', tsNaut: 'naut.', tsAstr: 'astr.', darkSpan: '{d} astronomically dark', twiNote: 'civ./naut./astr.: sun at −6°/−12°/−18° (end of twilight in the evening, start in the morning) · click to set the time' }, smHelp: 'Drag or use the arrows to turn; +/−, double-click or Ctrl/⌘ + scroll wheel to zoom; zoomed in, the map can also be dragged up and down. Clicking a star, a planet or an object opens its card below the controls.',
      smZoomed: '{f}° wide · stars to {m} mag', smBelow: '{s} is below the horizon at {t} ({alt}°)', viewUp: ', middle at {a}° altitude', smPhotoSrc: ' · photos: {s} (CDS)', smPhotoLoading: ' · loading photos …', smFullOn: '⛶ Full screen', smFullOff: '✕ Exit full screen', infoCenter: 'Centre', findCons: 'Constellation', findNone: 'Nothing found', findLoading: 'Loading the search …', findMoved: 'Below the horizon at that time – the time is now set to {t}, its highest point in darkness ({alt}°).', findMovedLight: 'Below the horizon at that time – the time is now set to {t}, its highest point ({alt}°); it is not above the horizon while the sky is dark this night.', findNever: 'Does not rise above the horizon this night.', galilean: ['Io', 'Europa', 'Ganymede', 'Callisto'],
      infoClose: 'Close info', infoStar: 'Star', infoDouble: 'Double star', infoWds: 'Catalogue (WDS)', infoSpec: 'Spectral types', infoPlanet: 'Planet', infoMoonKind: 'Moon', infoUnnamed: 'Star without a proper name',
      infoMag: 'Brightness', infoColour: 'Colour', colours: ['bluish', 'white', 'yellowish white', 'yellow', 'orange', 'reddish'],
      infoDist: 'Distance', infoLy: 'about {n} light years', infoLyRough: 'about {n} light years (uncertain)', infoLyFar: 'very far – the parallax is too small to measure',
      infoAu: '{au} au · {min} light minutes', infoKm: '{km} km', infoSize: 'Apparent diameter', infoLit: 'Lit',
      infoCons: 'Constellation', infoCoord: 'Coordinates J2000', infoTransit: 'Highest', infoTransitVal: '{t} at {alt}°',
      infoUsable: 'Usable dark hours above 30°', infoUsableSome: '{h} h, {m} h of them moonless', infoUsableMoonless: '{h} h, moonless', infoUsableMoon: '{h} h, all with the moon up', infoUsableNone: 'none', infoUsableNaut: '(nautical darkness)',
      infoPm: 'Proper motion', infoPmVal: '{v}″ per year', infoObjSize: 'Size', infoBest: 'Best time', infoWiki: 'Wikipedia', infoAlso: 'Also known as',
      cat: { title: 'What the search knows', live: 'counted live from the data of this page', loading: 'Loading the NGC and IC data …', failed: 'The NGC and IC data could not be loaded, only the page’s own catalogue is counted.',
        head: ['Catalogue', 'Searchable', 'Note'], complete: 'Complete catalogues', cross: 'Further catalogue numbers', crossNote: 'only objects that are also in NGC, IC or OpenNGC', stars: 'Stars and solar system',
        of: '{n} of {t}', nonex: '{n} non-existent according to OpenNGC', parts: '+ {n} components (A, B …)',
        names: { M: 'Messier', NGC: 'NGC', IC: 'IC', C: 'Caldwell', Sh2: 'Sharpless (HII regions)', PGC: 'PGC (galaxies)', UGC: 'UGC (galaxies)', ESO: 'ESO/Uppsala', UGCA: 'UGCA', LBN: 'LBN (bright nebulae)', Mel: 'Melotte', Cl: 'Collinder', H: 'Harvard', MWSC: 'MWSC (star clusters)', HCG: 'Hickson Compact Groups', B: 'Barnard (dark nebulae)', HD: 'HD (star entries)', HIP: 'HIP (star entries)', WDS: 'WDS (double stars)' },
        starNamed: 'Stars with a proper name', starBayer: 'Stars with a Bayer letter', cons: 'Constellations', bodies: 'Moon and planets', common: 'Common names (Orion Nebula …)',
        not: 'Not found by the search: the double stars of the night (only in the list of the best objects), satellites and comets (under Events of the night). Barnard’s dark nebulae are largely missing, as OpenNGC does not include that catalogue.' },
      photoNote: 'From {f}° wide, the star map fetches sky photographs (Digitized Sky Survey, or Pan-STARRS or 2MASS if chosen) from CDS, Strasbourg; your IP address is transmitted to CDS. Switch them off with “Sky photos” – more in the {link}.',
      photoNoteClick: 'With “Sky photos” ticked, the star map fetches sky photographs (Digitized Sky Survey, or Pan-STARRS or 2MASS if chosen) from CDS, Strasbourg, from {f}° wide; only then is your IP address transmitted to CDS – more in the {link}.',
      privacyText: 'privacy policy', privacyHref: '../privacy/privacy_en.html',
      smHigh: 'High in the sky at {t}: {list}.',
      smNone: 'None of the prominent constellations stands high in the sky at {t}.',
      smDay: ' It is daytime – the stars cannot be seen; the map shows where they are.',
      smMilkyWay: 'Milky Way', smEcliptic: 'Ecliptic', smZenith: 'Zenith'
    }
  }[LANG];

  function num(v, digits) { return v == null ? '–' : (digits ? v.toFixed(digits) : Math.round(v)).toString().replace('.', LANG === 'de' ? ',' : '.').replace('-', '−'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* Two clocks: every displayed time is the location's (state.off). When the visitor's device runs on another UTC offset at
     that moment, its time follows in brackets, "21:35 (04:35)"; hhmmLoc() is the plain location time for tight canvas
     labels, pcTime() the device time or '' where both agree. The time slider always sets the location's time */
  function pcOff(sec) { return -new Date(sec * 1000).getTimezoneOffset() * 60; }
  function pcTime(sec) { return state.off && state.off(sec) !== pcOff(sec) ? hhmmLoc(sec, pcOff) : ''; }
  function pcDiffers(win) { return !!(win && state.off && (state.off(win.start) !== pcOff(win.start) || state.off(win.end) !== pcOff(win.end))); }
  function hhmm(sec, off) {
    var t = hhmmLoc(sec, off), p = off === state.off ? pcTime(sec) : '';
    return p ? t + ' (' + p + ')' : t;
  }
  function dayLabel(sec, off) { var d = localDate(sec, off); return T.days[d.getUTCDay()] + ' ' + pad(d.getUTCDate()) + '.' + pad(d.getUTCMonth() + 1) + '.'; }

  var FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';
  var COL = { bg: '#10151c', grid: 'rgba(255,255,255,.06)', text: '#9aa7b6', sunLine: '#d9c24a', now: '#e5484d', target: '#8fb3ff', meridian: '#c9a3ff' };

  var el = {
    location: document.getElementById('op-location'),
    lat: document.getElementById('op-lat'),
    lon: document.getElementById('op-lon'),
    date: document.getElementById('op-date'),
    prev: document.getElementById('op-prev'),
    next: document.getElementById('op-next'),
    status: document.getElementById('op-status'),
    tz: document.getElementById('op-tz'),
    tzWrap: document.getElementById('op-tz-wrap'),
    moon: document.getElementById('op-moon'),
    moonIcon: document.getElementById('op-moon-icon'),
    moonTitle: document.getElementById('op-moon-title'),
    nightStrip: document.getElementById('op-night-strip'),
    nightStripWrap: document.getElementById('op-night-strip-wrap'),
    nightStripKey: document.getElementById('op-night-strip-key'),
    context: document.getElementById('op-context'),
    navContext: document.getElementById('op-nav-context'),
    night: document.getElementById('op-night'),
    moonToggle: document.getElementById('op-moon-toggle'),
    plCards: document.getElementById('op-pl-cards'),
    plToggle: document.getElementById('op-pl-toggle'),
    plBody: document.getElementById('op-pl-body'),
    listToggle: document.getElementById('op-list-toggle'),
    listBody: document.getElementById('op-list-body'),
    calToggle: document.getElementById('op-moon-cal-toggle'),
    cal: document.getElementById('op-moon-cal'),
    calTitle: document.getElementById('op-cal-title'),
    calGrid: document.getElementById('op-cal-grid'),
    calNote: document.getElementById('op-cal-note'),
    calPrev: document.getElementById('op-cal-prev'),
    calNext: document.getElementById('op-cal-next'),
    calToday: document.getElementById('op-cal-today'),
    plBars: document.getElementById('op-pl-bars'),
    smSub: document.getElementById('op-sm-sub'),
    smHelpBtn: document.getElementById('op-sm-help-btn'),
    smHelp: document.getElementById('op-sm-help'),
    smCatBtn: document.getElementById('op-sm-cat-btn'),
    smCat: document.getElementById('op-sm-cat'),
    infoTabNight: document.getElementById('op-info-tab-night'),
    infoTabSeason: document.getElementById('op-info-tab-season'),
    infoNight: document.getElementById('op-info-night'),
    infoSeason: document.getElementById('op-info-season'),
    smTime: document.getElementById('op-sm-time'),
    smClock: document.getElementById('op-sm-clock'),
    smMap: document.getElementById('op-sm-map'),
    smLeft: document.getElementById('op-sm-left'),
    smRight: document.getElementById('op-sm-right'),
    smZoomIn: document.getElementById('op-sm-zoom-in'),
    smZoomOut: document.getElementById('op-sm-zoom-out'),
    smPhotos: document.getElementById('op-sm-photos'),
    smPhotoNote: document.getElementById('op-sm-photo-note'),
    smGrid: document.getElementById('op-sm-grid'),
    smBounds: document.getElementById('op-sm-bounds'),
    smInfo: document.getElementById('op-sm-info'),
    smWrap: document.getElementById('op-sm-wrap'),
    smFull: document.getElementById('op-sm-full'),
    smSurvey: document.getElementById('op-sm-survey'),
    smSearch: document.getElementById('op-sm-search'),
    smSearchList: document.getElementById('op-sm-search-list'),
    smSearchNote: document.getElementById('op-sm-search-note'),
    smRed: document.getElementById('op-sm-red'),
    smNames: document.getElementById('op-sm-names'),
    smLang: document.getElementById('op-sm-lang'),
    smInfoBody: document.getElementById('op-sm-info-body'),
    smInfoChart: document.getElementById('op-sm-info-chart'),
    smInfoKey: document.getElementById('op-sm-info-key'),
    smSeasonChart: document.getElementById('op-sm-season-chart'),
    smSeasonTip: document.getElementById('op-sm-season-tip'),
    smSeasonKey: document.getElementById('op-sm-season-key'),
    smSeasonSpans: document.querySelectorAll('input[name="op-season-span"]'),
    modePhoto: document.getElementById('op-mode-photo'),
    listExtra: document.getElementById('op-list-extra'),
    viewList: document.getElementById('op-view-list'),
    viewGallery: document.getElementById('op-view-gallery'),
    modeVisual: document.getElementById('op-mode-visual'),
    filter: document.getElementById('op-filter'),
    listSub: document.getElementById('op-list-sub'),
    list: document.getElementById('op-list'),
    events: document.getElementById('op-events'),
    evSub: document.getElementById('op-ev-sub')
  };

  var state = {
    ready: false, tzChosen: false,
    lat: null, lon: null, off: null, zone: '', sky: '', key: null, dark: null,
    calMonth: null, plWin: null, plT: null, plBarsLayout: null, pickedLayout: null, nightLabel: '', mode: 'photo', filter: 'all', target: null, listRes: null, listExtra: true, extraCands: null,
    smData: null, smHover: null, smHits: null, photos: null, smFov: null, smCAlt: null, smCMin: 0, smKv: 0, deepRaw: null, deepStars: null, deepState: '', smNames: true, smAz: null, smPlace: null, smK: 0, names: NAME_DEFAULT,
    seasonSpan: 91, eclCache: null, evData: null, evError: false, evView: null, passes: [], cometsNight: []
  };

  /* ------------------------------------------------------------------ *
   * Location and night                                                 *
   * ------------------------------------------------------------------ */
  /* The planner sends coordinates nowhere, so unlike the astro weather page it needs no password for custom ones:
     latitude and longitude are always editable, and typing into them switches the location to "custom". */
  /* Custom coordinates have no zone of their own: the visitor picks one of the browser's IANA zones, preset to the
     browser's zone and kept in the link as tz=… once chosen. Presets bring theirs as data-tz. */
  var BROWSER_ZONE = (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
  function validZone(z) { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (e) { return false; } }
  function fillZones(selected) {
    var zones = window.Intl && Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone').slice() : [];
    [BROWSER_ZONE, 'UTC', selected].forEach(function (z) { if (z && zones.indexOf(z) < 0) zones.push(z); });
    zones.sort();
    var now = Date.now() / 1000;
    el.tz.innerHTML = zones.map(function (z) {
      var o = A.offsetFn(z, 0)(now) / 60, a = Math.abs(o); /* the offset right now; the calculations take it per moment */
      return '<option value="' + esc(z) + '">' + esc(z.replace(/_/g, ' ')) + ' (UTC' + (o < 0 ? '−' : '+') + pad(Math.floor(a / 60)) + ':' + pad(a % 60) + ')</option>';
    }).join('');
    el.tz.value = selected;
  }

  function applyPreset() {
    var v = el.location.value;
    if (v === 'custom') { update(); el.lat.focus(); return; }
    var p = v.split(',');
    el.lat.value = p[0];
    el.lon.value = p[1];
    update();
  }

  /* URL parameters instead of localStorage: the site allows no new storage keys. */
  function syncUrl() {
    if (!window.history || !history.replaceState) return;
    var p = new URLSearchParams(location.search);
    /* the coordinates in use, not what is typed into the fields: a value update() refused must not reach the link */
    p.set('lat', state.lat != null ? String(state.lat) : el.lat.value);
    p.set('lon', state.lon != null ? String(state.lon) : el.lon.value);
    if (el.date.value) p.set('date', el.date.value);
    if (state.names !== NAME_DEFAULT) p.set('names', state.names); else p.delete('names');
    if (el.location.value === 'custom' && state.tzChosen) p.set('tz', el.tz.value); else p.delete('tz');
    if (state.photos !== PHOTO_AUTO) p.set('photos', state.photos ? '1' : '0'); else p.delete('photos');
    if (state.survey && state.survey !== 'dss') p.set('survey', state.survey); else p.delete('survey');
    /* the star map's view: direction, and once zoomed in the width and the middle's altitude, as precise as the width needs */
    var fov = state.smFov, dg = fov == null ? 1 : fov < 2 ? 3 : fov < 20 ? 2 : 1;
    if (state.smAz != null && (fov != null || Math.abs(state.smAz - 180) > 0.05)) p.set('az', state.smAz.toFixed(dg)); else p.delete('az');
    if (fov != null) { p.set('fov', fov.toFixed(fov < 1 ? 3 : 2)); if (state.smCAlt != null) p.set('alt', state.smCAlt.toFixed(dg)); else p.delete('alt'); }
    else { p.delete('fov'); p.delete('alt'); }
    if (state.red) p.set('red', '1'); else p.delete('red');
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  }

  function readUrl() {
    var p = new URLSearchParams(location.search), lat = parseFloat(p.get('lat')), lon = parseFloat(p.get('lon')), d = p.get('date');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) el.date.value = d;
    if (p.get('names') === 'latin' || p.get('names') === 'local') state.names = p.get('names');
    state.tzChosen = !!(p.get('tz') && validZone(p.get('tz')));
    fillZones(state.tzChosen ? p.get('tz') : BROWSER_ZONE);
    state.photos = p.get('photos') === '1' ? true : p.get('photos') === '0' ? false : PHOTO_AUTO;
    state.survey = { ps1: 'ps1', '2mass': '2mass' }[p.get('survey')] || 'dss';
    state.red = p.get('red') === '1';
    var vAz = parseFloat(p.get('az')), vFov = parseFloat(p.get('fov')), vAlt = parseFloat(p.get('alt'));
    state.smUrlView = isFinite(vAz) || isFinite(vFov) ? { az: isFinite(vAz) ? ((vAz % 360) + 360) % 360 : null,
      fov: isFinite(vFov) && vFov >= 0.2 && vFov < 160 ? vFov : null, alt: isFinite(vAlt) ? clamp(vAlt, -90, 90) : null } : null;
    if (isFinite(lat) && isFinite(lon)) {
      el.lat.value = lat;
      el.lon.value = lon;
      var match = Array.prototype.find.call(el.location.options, function (o) {
        var q = o.value.split(',');
        return o.value !== 'custom' && Math.abs(parseFloat(q[0]) - lat) < 1e-4 && Math.abs(parseFloat(q[1]) - lon) < 1e-4;
      });
      el.location.value = match ? match.value : 'custom';
    } else {
      var first = el.location.options[0], q = first.value.split(',');
      el.location.value = first.value;
      el.lat.value = q[0];
      el.lon.value = q[1];
    }
  }

  function dateOfKey(key) { var d = new Date(key * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }

  /* the night still running; once the sun is up in the morning, the coming night */
  function defaultKey() {
    var now = Date.now() / 1000, key = A.nightKeyOf(now, state.off);
    if (localDate(now, state.off).getUTCHours() < 12 && A.sunAltitude(now * 1000, state.lat, state.lon) > -0.833) key += 1;
    return key;
  }

  function update() {
    var lat = parseFloat(el.lat.value), lon = parseFloat(el.lon.value);
    if (!(isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { el.status.textContent = T.badCoords; return; }
    var opt = el.location.options[el.location.selectedIndex], custom = el.location.value === 'custom';
    /* presets carry their IANA zone; custom coordinates use the one chosen next to them */
    var zone = (custom ? el.tz.value : opt.getAttribute('data-tz')) || BROWSER_ZONE;
    el.tzWrap.style.display = custom ? 'flex' : 'none';
    state.lat = lat; state.lon = lon; state.zone = zone;
    state.off = A.offsetFn(zone, -new Date().getTimezoneOffset() * 60);
    state.sky = custom ? '' : (opt.getAttribute('data-sky') || '');
    if (!el.date.value) el.date.value = dateOfKey(defaultKey());
    var parts = el.date.value.split('-');
    state.key = Math.floor(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]) / 86400000);
    state.calMonth = { y: +parts[0], m: +parts[1] - 1 }; /* the calendar follows the chosen night */
    el.status.textContent = (custom ? (state.tzChosen ? T.statusCustom : T.statusCustomHint) : T.statusPreset.replace('{name}', opt.textContent)).replace('{zone}', zone);
    if (pcTime(Date.now() / 1000)) el.status.textContent += T.pcNote.replace('{zone}', BROWSER_ZONE); /* times carry the device's time in brackets */
    state.placeName = custom ? T.ctxCustom.replace('{lat}', num(lat, 3)).replace('{lon}', num(lon, 3)) : opt.textContent;
    renderContext();
    syncUrl();
    state.ready = true;
    renderNight();
    renderPlanets();
    renderMoonCal();
    renderList();
    renderEvents();
    /* a picked object that is not in this night's list is dropped; the star map shows the new night either way */
    if (state.target && state.listRes && !state.listRes.list.some(function (y) { return y.o.id === state.target; })) { state.target = null; drawList(); }
    drawSkyMap();
  }

  function stepNight(dir) {
    if (!el.date.value) return;
    var p = el.date.value.split('-');
    el.date.value = dateOfKey(Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000) + dir);
    update();
  }

  /* ------------------------------------------------------------------ *
   * The night                                                          *
   * ------------------------------------------------------------------ */
  /* the night's darkness and moon-free time, which star map, bars and list build on */
  function renderNight() {
    state.dark = A.darkness(state.key, state.lat, state.lon, state.off);
  }

  /* ------------------------------------------------------------------ *
   * The moon above the star map, at the slider's time                   *
   * ------------------------------------------------------------------ */
  var SYNODIC = 29.530589; /* days */
  /* the moon's elongation from the sun in ecliptic longitude, 0° new … 180° full: what defines the principal phases */
  function elongation(sec) {
    var d = A.toDays(sec * 1000);
    return ((A.moonCoords(d).lam - A.sunCoords(d).lam) / RAD % 360 + 360) % 360;
  }
  /* the next moment after sec at which the elongation reaches target (0 new moon, 180 full moon), to half a minute */
  function nextPhase(sec, target) {
    function past(t) { return ((elongation(t) - target) % 360 + 360) % 360; }
    var a = sec, pa = past(a);
    for (var i = 0; i < 130; i++) { /* 6-hour steps over a little more than a lunation */
      var b = a + 21600, pb = past(b);
      if (pb < pa) {
        while (b - a > 30) { var m = (a + b) / 2; if (past(m) > 180) a = m; else b = m; }
        return b;
      }
      a = b; pa = pb;
    }
    return null;
  }

  /* The moon's age in days: the time since the last new moon. Counting the elongation evenly (E / 360 · 29.53 d) was up
     to a day off, as the moon runs faster and slower along its orbit. The lunation found is kept while the time stays in it. */
  var lunation = null;
  function moonAge(t, E) {
    if (!lunation || !(t >= lunation[0] && t < lunation[1])) {
      var p = nextPhase(t - 30.2 * 86400, 0), n2 = null; /* the first new moon after that lies before t, a second one may too */
      while (p != null && (n2 = nextPhase(p + 86400, 0)) != null && n2 <= t) p = n2;
      lunation = p != null && p <= t ? [p, n2 != null && n2 > t ? n2 : t + 3600] : null;
    }
    return lunation ? (t - lunation[0]) / 86400 : E / 360 * SYNODIC;
  }

  /* phase names: the principal phases get a day either side, the phases in between the rest */
  function phaseIndex(E) { return E < 12 || E >= 348 ? 0 : E < 78 ? 1 : E < 102 ? 2 : E < 168 ? 3 : E < 192 ? 4 : E < 258 ? 5 : E < 282 ? 6 : 7; }

  /* The full local hours between two moments (Unix seconds), for time axes. Every time zone is a whole number of quarter
     hours off UTC, so a quarter-hour grid holds them, also in +5:30 or +5:45 and across a daylight-saving switch; full UTC
     hours put the ticks half an hour beside their labels there. */
  /* a legend of colour swatches (css/style.css .op-key): items [colour, 'box' | 'line' | 'dash' | 'dot', label], then a note */
  function keyHtml(items, note) {
    return items.map(function (k) { return '<span class="op-key-item"><i class="op-key-sw op-key-' + k[1] + '" style="color:' + k[0] + '"></i>' + esc(k[2]) + '</span>'; }).join('') +
      (note ? '<span class="op-key-note">' + esc(note) + '</span>' : '');
  }
  /* place and night under the title and small in the section navigation */
  function renderContext() {
    var txt = (state.placeName || '') + (state.nightLabel ? ' · ' + T.ctxNight.replace('{n}', state.nightLabel) : '');
    if (el.context) { el.context.textContent = txt; el.context.hidden = !txt; }
    if (el.navContext) el.navContext.textContent = txt;
  }

  function localHours(start, end, off) {
    var out = [];
    for (var q = Math.ceil(start / 900) * 900; q <= end; q += 900) if (localDate(q, off).getUTCMinutes() === 0) out.push(q);
    return out;
  }

  /* The night as a small chart in the night block (drawNightStrip(), from renderMoon()): the sky's colour by the sun's
     altitude as in the altitude charts — day, civil, nautical and astronomical twilight, green once astronomically dark —
     with the moon's altitude as a curve over it (0° at the bottom, 90° at the top, the area stronger the fuller the moon,
     its highest point labelled), faint lines at 30° and 60°, local full hours and the slider's time in red. Above it, in up
     to three label rows, sunset and sunrise, the ends and starts of civil, nautical and astronomical twilight (sun at −6°,
     −12°, −18°), moonrise and moonset and "now", each with a dashed line down through the chart. A click sets the time */
  function drawNightStrip(polarDay, darkAll) {
    var cv = el.nightStrip, win = state.plWin;
    if (!cv || !win || !win.samples) return;
    if (el.nightStripWrap) el.nightStripWrap.hidden = false;
    var W = cv.clientWidth || 600, dualT = pcDiffers(win), H = dualT ? 146 : 132, dpr = window.devicePixelRatio || 1, ctx = cv.getContext('2d'), off = state.off, lat = state.lat, lon = state.lon;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var span = win.end - win.start, step = W / (span / 600) + 0.6, CT = 40, CB = 112, CH = CB - CT;
    function xOf(sec) { return (sec - win.start) / span * W; }
    function yOf(alt) { return CB - clamp(alt, 0, 90) / 90 * CH; }
    /* sky */
    win.samples.forEach(function (row) { ctx.fillStyle = chartSky(row.sun.alt); ctx.fillRect(xOf(row.t), CT, step, CH); });
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    [30, 60].forEach(function (a) { ctx.beginPath(); ctx.moveTo(0, Math.round(yOf(a)) + 0.5); ctx.lineTo(W, Math.round(yOf(a)) + 0.5); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.font = '9px ' + FONT; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(228,233,239,.55)';
    [30, 60].forEach(function (a) { ctx.fillText(a + '°', W - 3, yOf(a) - 1); });
    /* the moon's altitude: area and line where it is up */
    var rows = win.samples, top = null, illum = 0;
    rows.forEach(function (row) { if (row.moon && row.moon.alt > 0 && (!top || row.moon.alt > top.moon.alt)) top = row; });
    if (top) {
      illum = top.moon.illum || 0;
      ctx.beginPath();
      rows.forEach(function (row, i) { var x = xOf(row.t), y = yOf(row.moon ? row.moon.alt : 0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.lineTo(xOf(rows[rows.length - 1].t), CB); ctx.lineTo(xOf(rows[0].t), CB); ctx.closePath();
      ctx.save(); ctx.beginPath(); ctx.rect(0, CT, W, CH); ctx.clip();
      ctx.beginPath();
      rows.forEach(function (row, i) { var x = xOf(row.t), y = yOf(row.moon ? row.moon.alt : 0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.lineTo(xOf(rows[rows.length - 1].t), CB); ctx.lineTo(xOf(rows[0].t), CB); ctx.closePath();
      ctx.fillStyle = 'rgba(245,215,110,' + (0.12 + 0.3 * illum).toFixed(2) + ')'; ctx.fill();
      ctx.beginPath();
      var pen = false;
      rows.forEach(function (row) {
        var alt = row.moon ? row.moon.alt : -1, x = xOf(row.t);
        if (alt <= 0) { pen = false; return; }
        if (pen) ctx.lineTo(x, yOf(alt)); else { ctx.moveTo(x, yOf(alt)); pen = true; }
      });
      ctx.strokeStyle = '#f5d76e'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      ctx.restore();
      var tx = xOf(top.t), ty = yOf(top.moon.alt), txt = '☾ ' + num(top.moon.alt) + '° · ' + Math.round(illum * 100) + ' %';
      ctx.font = '600 10px ' + FONT; ctx.textBaseline = 'bottom';
      var tw = ctx.measureText(txt).width, lx = clamp(tx, tw / 2 + 4, W - tw / 2 - 4), ly = Math.max(CT + 30, ty - 4); /* below the darkness dimension line */
      ctx.fillStyle = 'rgba(11,17,25,.55)'; ctx.fillRect(lx - tw / 2 - 3, ly - 11, tw + 6, 12);
      ctx.fillStyle = '#f5d76e'; ctx.textAlign = 'center'; ctx.fillText(txt, lx, ly);
    }
    /* the length of astronomical darkness as a dimension line along the top of the green stretch: end ticks, arrowheads
       and the duration on a green label in the middle (only the duration when the stretch is narrow) */
    var dkS = state.dark;
    if (dkS && dkS.from != null && !darkAll) {
      var x1 = clamp(xOf(dkS.from), 0, W), x2 = clamp(xOf(dkS.to), 0, W), ay = CT + 10;
      if (x2 - x1 > 24) {
        var mins = Math.round((dkS.to - dkS.from) / 60), dtxt = T.moHours.replace('{h}', Math.floor(mins / 60)).replace('{m}', mins % 60), dlabel = T.kc.darkSpan.replace('{d}', dtxt);
        ctx.strokeStyle = 'rgba(228,233,239,.9)'; ctx.fillStyle = 'rgba(228,233,239,.9)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x1 + 1, ay); ctx.lineTo(x2 - 1, ay); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1 + 0.5, ay - 5); ctx.lineTo(x1 + 0.5, ay + 5); ctx.moveTo(x2 - 0.5, ay - 5); ctx.lineTo(x2 - 0.5, ay + 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1 + 1, ay); ctx.lineTo(x1 + 7, ay - 3.5); ctx.lineTo(x1 + 7, ay + 3.5); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x2 - 1, ay); ctx.lineTo(x2 - 7, ay - 3.5); ctx.lineTo(x2 - 7, ay + 3.5); ctx.closePath(); ctx.fill();
        ctx.lineWidth = 1;
        ctx.font = '600 10px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var dw = ctx.measureText(dlabel).width;
        if (dw + 28 > x2 - x1) { dlabel = dtxt; dw = ctx.measureText(dlabel).width; }
        if (dw + 20 <= x2 - x1) {
          var dcx = (x1 + x2) / 2;
          ctx.fillStyle = '#0b3a2a'; ctx.fillRect(dcx - dw / 2 - 5, ay - 7, dw + 10, 14);
          ctx.fillStyle = '#e4e9ef'; ctx.fillText(dlabel, dcx, ay + 0.5);
        }
      }
    }
    /* no night sky, or darkness through the whole window */
    var centre = polarDay ? T.moPolarDay : darkAll ? T.moDarkAll : '';
    if (centre) { ctx.font = '600 11px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(228,233,239,.9)'; ctx.fillText(centre, W / 2, CT + CH / 2); }
    /* hours */
    ctx.font = '10px ' + FONT; ctx.textBaseline = 'top'; ctx.textAlign = 'center'; ctx.fillStyle = '#6b7785';
    var every = W / (span / 3600) < 30 ? 2 : 1, rowW = 0;
    if (dualT) { /* the two hour rows are named at the left; hour labels that would run into the names are left out */
      ctx.font = '600 10px ' + FONT; ctx.textAlign = 'left';
      rowW = Math.max(ctx.measureText(T.kc.rowLoc).width, ctx.measureText(T.kc.rowPc).width) + 8;
      ctx.fillStyle = '#6b7785'; ctx.fillText(T.kc.rowLoc, 0, CB + 5);
      ctx.fillStyle = '#9aa5b1'; ctx.fillText(T.kc.rowPc, 0, CB + 18);
      ctx.font = '10px ' + FONT; ctx.textAlign = 'center'; ctx.fillStyle = '#6b7785';
    }
    localHours(win.start, win.end, off).forEach(function (q) {
      var x = xOf(q), h = localDate(q, off).getUTCHours();
      ctx.fillRect(Math.round(x), CB, 1, 3);
      if (h % every === 0 && x - 7 > Math.max(1, rowW) && x < W - 8) ctx.fillText(pad(h), x, CB + 5);
    });
    if (dualT) { /* the visitor's device time as a second, lighter hour row */
      ctx.fillStyle = '#9aa5b1';
      localHours(win.start, win.end, pcOff).forEach(function (q) {
        var x = xOf(q), h = localDate(q, pcOff).getUTCHours();
        if (h % every === 0 && x - 7 > rowW && x < W - 8) ctx.fillText(pad(h), x, CB + 18);
      });
    }
    /* marks: sun, twilight boundaries, moon, now */
    var marks = [], sunFn = function (sec) { return A.sunAltitude(sec * 1000, lat, lon); };
    A.crossings(sunFn, win.start, win.end, 300, -0.833).forEach(function (c) { marks.push({ t: c.t, txt: (c.rising ? '☀↑ ' : '☀↓ ') + hhmmLoc(c.t, off), col: '#b86e00' }); });
    [[-6, T.kc.tsCivil, '#4f7db3'], [-12, T.kc.tsNaut, '#2f5b8f'], [-18, T.kc.tsAstr, '#1d3f66']].forEach(function (lv) {
      A.crossings(sunFn, win.start, win.end, 300, lv[0]).forEach(function (c) { marks.push({ t: c.t, txt: lv[1] + ' ' + hhmmLoc(c.t, off), col: lv[2], dash: true }); });
    });
    A.crossings(function (sec) { return A.moonAltitude(sec * 1000, lat, lon); }, win.start, win.end, 120, -0.833).forEach(function (c) {
      marks.push({ t: c.t, txt: (c.rising ? '☾↑ ' : '☾↓ ') + hhmmLoc(c.t, off), col: '#7a6418' });
    });
    var nowSec = Date.now() / 1000;
    if (nowSec >= win.start && nowSec <= win.end) marks.push({ t: nowSec, txt: T.kc.nowMark + ' ' + hhmmLoc(nowSec, off), col: '#2f80d1', dash: true });
    marks.sort(function (a, b) { return a.t - b.t; });
    var ends = [-1e9, -1e9, -1e9];
    ctx.font = '600 10px ' + FONT; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    marks.forEach(function (m) {
      var x = xOf(m.t), w = ctx.measureText(m.txt).width, cx = clamp(x, w / 2 + 1, W - w / 2 - 1), row = -1;
      for (var r = 0; r < 3 && row < 0; r++) if (cx - w / 2 > ends[r] + 6) row = r; /* the first row with room, else left out */
      if (row < 0) return;
      ends[row] = cx + w / 2;
      var y = 1 + row * 13;
      ctx.strokeStyle = m.col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.setLineDash(m.dash ? [3, 3] : [1, 2]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y + 11); ctx.lineTo(Math.round(x) + 0.5, CB); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = m.col; ctx.fillText(m.txt, cx, y);
    });
    ctx.fillStyle = '#e74c3c'; ctx.fillRect(Math.round(xOf(state.plT)) - 1, CT, 2, CH + 3);
    if (el.nightStripKey) el.nightStripKey.innerHTML = keyHtml([[chartSky(6), 'box', T.kc.day], [chartSky(-3), 'box', T.kc.civil], [chartSky(-9), 'box', T.kc.nautical], [chartSky(-15), 'box', T.kc.astronomical],
      ['#0b3a2a', 'box', T.kc.dark], ['#f5d76e', 'line', T.kc.moonAlt], ['#e74c3c', 'line', T.kc.slider]], T.kc.twiNote);
  }

  function renderMoon() {
    var win = state.plWin, dk = state.dark, t = state.plT;
    if (!el.moonTitle || !win) return;
    el.moon.style.display = 'flex'; /* hidden until a night is computed */
    var il = A.moonIllumination(t * 1000), E = elongation(t), pct = Math.round(il.fraction * 100);
    var k = phaseIndex(E);
    var cv = el.moonIcon, S = 30, dpr = window.devicePixelRatio || 1, ctx = cv.getContext('2d'); /* a small symbol beside the phase line */
    cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 2 * Math.PI); ctx.fill();
    if (state.lat < 0) { ctx.translate(S, 0); ctx.scale(-1, 1); } /* from the southern hemisphere the lit side is mirrored */
    A.drawMoonIcon(ctx, S / 2, S / 2, S / 2 - 2, il.phase, il.fraction);
    var phase = T.moPhases[k];
    cv.setAttribute('aria-label', T.moAria.replace('{phase}', phase).replace('{p}', pct));
    el.moonTitle.textContent = T.moTitle.replace('{phase}', phase).replace('{p}', pct).replace('{age}', num(moonAge(t, E), 1));
    /* since September 2026 the box has no key-figure tiles: darkness, twilight, the moon's altitude, rise and set are in the
       night chart. A polar day (no sunset in the window) and darkness over the whole window are said inside the chart */
    var polarDay = !win.samples.some(function (row) { return row.sun.alt < -0.833; });
    var darkAll = dk.from != null && dk.from <= dk.evening && dk.to >= dk.next;
    drawNightStrip(polarDay, darkAll);
  }

  /* The moon calendar under the moon box, opened by its button: one month, Monday first, every night with its phase at
     local midnight after that evening, the principal phases marked and listed with their rough time; a click on a day
     chooses that night. It follows the chosen night's month until the arrows turn it. */
  /* the calendar's moon-free darkness per night, per month and place (A.darkness(), about 1 ms a night) */
  var calDarkCache = null;
  function renderMoonCal() {
    if (!el.cal || el.cal.hidden || !state.calMonth) return;
    var off = state.off, y = state.calMonth.y, m = state.calMonth.m;
    var first = Date.UTC(y, m, 1) / 86400000, days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    /* the phases are searched over the month's nights, local noon of the 1st to local noon after the last day: every cell
       is a night (noon to noon), so a phase in the morning of the 1st belongs to the previous month's last night and would
       otherwise get no cell in either month (last quarter 1 Dec 2026 07:10 CET) */
    var start = fromLocal(first * 86400 + 43200, off), end = fromLocal((first + days) * 86400 + 43200, off);
    el.calTitle.textContent = T.months[m] + ' ' + y;
    /* today at the location: its cell gets an orange frame, and "Today" chooses that day (greyed out while it is chosen and shown) */
    var nowSec = Date.now() / 1000, today = Math.floor((nowSec + off(nowSec)) / 86400), nowLocal = localDate(nowSec, off);
    if (el.calToday) {
      var here = state.key === today && nowLocal.getUTCFullYear() === y && nowLocal.getUTCMonth() === m;
      el.calToday.disabled = here; el.calToday.style.opacity = here ? '.45' : '1'; el.calToday.style.cursor = here ? 'default' : 'pointer';
    }
    var marks = {}, list = [];
    [0, 90, 180, 270].forEach(function (target, q) {
      for (var t = start, n; (n = nextPhase(t, target)) != null && n < end; t = n + 86400) {
        marks[A.nightKeyOf(n, off)] = q; /* on the night that contains it, noon to noon, as every cell is the night from that evening: a last quarter at 02:50 belongs to the evening before */
        list.push({ q: q, t: n });
      }
    });
    list.sort(function (a, b) { return a.t - b.t; });
    var wide = el.calGrid.clientWidth >= 480, cells = [];
    var html = '<div style="display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:4px; text-align:center;">';
    [1, 2, 3, 4, 5, 6, 0].forEach(function (i) { html += '<div style="font-size:.7rem; color:var(--text-light);">' + esc(T.days[i]) + '</div>'; });
    for (var e = (new Date(first * 86400000).getUTCDay() + 6) % 7; e > 0; e--) html += '<div></div>';
    /* the green bar of each night is its moon-free astronomical darkness against the month's longest (at least 8 h, so
       that a month of short nights does not look full): a fixed 12 h saturated in a polar winter */
    var calKey = [y, m, state.lat, state.lon, state.zone].join('|'), freeSecs = {}, freeMax = 8 * 3600;
    if (!calDarkCache || calDarkCache.key !== calKey) calDarkCache = { key: calKey, map: {} };
    for (var dd = first; dd < first + days; dd++) {
      var dkc = calDarkCache.map[dd] || (calDarkCache.map[dd] = A.darkness(dd, state.lat, state.lon, off));
      freeSecs[dd] = dkc.from != null ? dkc.moonFreeSec || 0 : 0;
      freeMax = Math.max(freeMax, freeSecs[dd]);
    }
    /* the three nights with the longest moon-free darkness (at least an hour) get a star */
    var bestDays = Object.keys(freeSecs).map(Number).filter(function (k) { return freeSecs[k] >= 3600; })
      .sort(function (a, b) { return freeSecs[b] - freeSecs[a] || a - b; }).slice(0, 3);
    for (var d = first; d < first + days; d++) {
      var mid = fromLocal((d + 1) * 86400, off), il = A.moonIllumination(mid * 1000), pct = Math.round(il.fraction * 100), mk = marks[d], picked = d === state.key;
      var freeSec = freeSecs[d], isBest = bestDays.indexOf(d) >= 0, weekDay = new Date(d * 86400000).getUTCDay();
      var cellBg = weekDay === 5 || weekDay === 6 ? '#eef2f6' : 'var(--white)'; /* the nights from Friday and Saturday evening, lightly tinted */
      var freeText = T.moHours.replace('{h}', Math.floor(Math.round(freeSec / 60) / 60)).replace('{m}', Math.round(freeSec / 60) % 60);
      cells.push({ d: d, il: il });
      var aria = T.calAria.replace('{day}', dayLabel(fromLocal(d * 86400 + 43200, off), off)).replace('{phase}', T.moPhases[phaseIndex(elongation(mid))]).replace('{p}', pct) + (d === today ? T.calTodayMark : '') + T.calDark.replace('{d}', freeText) + (isBest ? T.calBestMark : '');
      html += '<button type="button" data-cal="' + d + '" aria-pressed="' + picked + '" aria-label="' + esc(aria) + '" style="display:flex; flex-direction:column; align-items:center; gap:2px; min-width:0; padding:.3rem .1rem; border-radius:6px; font:inherit; color:var(--text); cursor:pointer; border:1px solid ' +
        (picked ? '#3498db; background:rgba(52,152,219,.14);' : mk != null ? 'rgba(52,152,219,.6); background:' + cellBg + ';' : 'rgba(26,42,58,.1); background:' + cellBg + ';') + (d === today ? ' box-shadow:inset 0 0 0 2px #e67e22;' : '') + '">' +
        '<span style="font-size:.78rem; font-weight:' + (picked ? 700 : 600) + ';">' + (d - first + 1) + (isBest ? '<span class="op-cal-best" aria-hidden="true">★</span>' : '') + '</span>' +
        '<canvas data-moon="' + d + '" width="26" height="26" style="display:block; width:26px; height:26px;"></canvas>' +
        '<span style="font-size:.66rem; color:var(--text-light);">' + pct + ' %</span>' +
        '<span class="op-cal-dark" aria-hidden="true"><i style="width:' + Math.round(clamp(freeSec / freeMax, 0, 1) * 100) + '%;"></i></span>' +
        (mk != null && wide ? '<span style="font-size:.62rem; line-height:1.2; color:var(--accent);">' + esc(T.calShort[mk]) + '</span>' : '') + '</button>';
    }
    el.calGrid.innerHTML = html + '</div>';
    var dpr = window.devicePixelRatio || 1;
    cells.forEach(function (c) {
      var cv = el.calGrid.querySelector('canvas[data-moon="' + c.d + '"]'), ctx = cv.getContext('2d');
      cv.width = Math.round(26 * dpr); cv.height = Math.round(26 * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (state.lat < 0) { ctx.translate(26, 0); ctx.scale(-1, 1); } /* mirrored from the southern hemisphere, as in the box */
      A.drawMoonIcon(ctx, 13, 13, 12, c.il.phase, c.il.fraction);
    });
    Array.prototype.forEach.call(el.calGrid.querySelectorAll('button[data-cal]'), function (b) {
      b.addEventListener('click', function () { setCalOpen(false); el.date.value = dateOfKey(+b.getAttribute('data-cal')); update(); el.date.focus(); });
    });
    el.calNote.innerHTML = esc(list.map(function (x) { return T.calMarks[x.q] + ' ' + dayLabel(Math.round(x.t / 600) * 600, off) + ' ' + T.moAbout.replace('{t}', hhmm(Math.round(x.t / 600) * 600, off)); }).join(' · ')) +
      '<br>' + esc(T.calNote + ' ' + T.calDarkKey + ' ' + T.calBestKey);
  }

  /* The moon calendar opens as a popover under the date field (button "with moon phases" beside it) and closes on a chosen
     day, a click outside or Esc. It is moved sideways to stay on screen. */
  function setCalOpen(open) {
    if (!el.cal || !el.calToggle) return;
    el.cal.hidden = !open;
    el.calToggle.setAttribute('aria-expanded', String(open));
    if (!open) return;
    el.cal.style.left = '0px';
    renderMoonCal();
    var r = el.cal.getBoundingClientRect(), vw = document.documentElement.clientWidth, shift = Math.min(0, vw - 8 - r.right);
    if (r.left + shift < 8) shift = 8 - r.left;
    el.cal.style.left = shift + 'px';
  }

  function stepCalMonth(dir) {
    var c = state.calMonth;
    if (!c) return;
    var d = new Date(Date.UTC(c.y, c.m + dir, 1));
    state.calMonth = { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    renderMoonCal();
  }

  /* ------------------------------------------------------------------ *
   * Moon and planets: samples for the night and the visibility bars     *
   * ------------------------------------------------------------------ */
  /* an hour before sunset to an hour after sunrise, on full local hours; noon to noon without a sunset */
  function planetWindow() {
    var off = state.off, dk = state.dark;
    var cr = A.crossings(function (s) { return A.sunAltitude(s * 1000, state.lat, state.lon); }, dk.evening, dk.next, 60, -0.833);
    var set = cr.filter(function (c) { return !c.rising; })[0], rise = set && cr.filter(function (c) { return c.rising && c.t > set.t; })[0];
    if (!set || !rise) return { start: dk.evening, end: dk.next };
    function onHour(t, up) { var o = off(t), h = (t + o) / 3600; return (up ? Math.ceil(h) : Math.floor(h)) * 3600 - o; }
    return { start: onHour(set.t - 3600, false), end: onHour(rise.t + 3600, true) };
  }

  /* the best moment to look: highest while the sky is at least nautically dark, else after sunset;
     null when a body is only up in daylight */
  function bestSample(win, id) {
    function pick(limit) {
      var best = null;
      win.samples.forEach(function (row) {
        var b = row[id];
        if (row.sun.alt < limit && b.alt > 0 && (!best || b.alt > best.b.alt)) best = { t: row.t, b: b };
      });
      return best;
    }
    return pick(-6) || pick(-0.833);
  }

  /* Moon and planets as cards above the visibility bars: every body that climbs at least 10° at its best moment
     (bestSample(): highest with the sun below −6°, else after sunset), in its colour, with the time, direction and
     brightness there; a click selects it and moves time and map to that moment. The others are named in one line */
  function renderPlanetCards() {
    var box = el.plCards, win = state.plWin;
    if (!box || !win) return;
    var off = state.off, cards = [], hidden = [];
    BODIES.forEach(function (id) {
      var b = bestSample(win, id);
      if (!b || b.b.alt < 10) { hidden.push(T.plNames[id]); return; }
      var sub = id === 'moon' ? T.plCardLit.replace('{p}', Math.round((b.b.illum || 0) * 100)) : b.b.mag != null ? num(b.b.mag, 1) + ' mag' : '';
      cards.push('<button type="button" class="op-pl-card" data-body="' + id + '" style="--op-kind:' + BODY_COL[id] + ';"><span class="op-pl-dot" aria-hidden="true"></span>' +
        '<span class="op-pl-name">' + esc(T.plNames[id]) + '</span><span class="op-pl-best">' + esc(T.plCardBest.replace('{alt}', num(b.b.alt)).replace('{t}', hhmm(b.t, off)).replace('{dir}', T.compass[Math.round(b.b.az / 45) % 8])) + '</span>' +
        (sub ? '<span class="op-pl-sub">' + esc(sub) + '</span>' : '') + '</button>');
    });
    box.innerHTML = (cards.length ? '<div class="op-pl-grid">' + cards.join('') + '</div>' : '') + (hidden.length ? '<p class="op-pl-hidden">' + esc(T.plCardHidden.replace('{list}', hidden.join(', '))) + '</p>' : '');
    Array.prototype.forEach.call(box.querySelectorAll('button[data-body]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-body'), b = bestSample(state.plWin, id);
        if (!b) return;
        sky.setInfo({ kind: 'body', id: id }, true);
        aimSkyMap(b.b.az, A.refract(b.b.alt)); /* the map draws apparent altitudes */
        setPlanetTime(b.t, true);
        scrollBelowNav(document.getElementById('op-sec-map'));
      });
    });
  }

  function renderPlanets() {
    var lat = state.lat, lon = state.lon, off = state.off, win = planetWindow();
    win.samples = [];
    for (var s = win.start; s <= win.end; s += 600) { /* every 10 minutes, shared by star map, bars, charts and events */
      var row = { t: s, sun: A.sunHorizontal(s * 1000, lat, lon) };
      BODIES.forEach(function (id) { row[id] = A.bodyAt(id, s, lat, lon); });
      win.samples.push(row);
    }
    state.plWin = win;
    /* start at "now" inside the window, otherwise half an hour into astronomical darkness */
    var nowSec = Date.now() / 1000, dk = state.dark;
    var t0 = nowSec >= win.start && nowSec <= win.end ? nowSec : dk.from != null ? dk.from + 1800 : (win.start + win.end) / 2;
    state.plT = clamp(Math.round(t0 / 300) * 300, win.start, win.end);
    state.nightLabel = dayLabel(dk.evening, off) + ' → ' + dayLabel(dk.next, off);
    renderContext();
    el.smTime.min = win.start;
    el.smTime.max = win.end;
    el.smTime.value = state.plT;
    /* the star map looks south by default, and again after the location changes; a view from the link counts once, at the first night */
    var place = state.lat + ',' + state.lon;
    if (state.smAz == null || state.smPlace !== place) {
      var uv = state.smUrlView;
      state.smUrlView = null;
      state.smAz = uv && uv.az != null ? uv.az : 180;
      state.smPlace = place;
      state.smFov = uv && uv.fov != null ? uv.fov : null;
      state.smCAlt = state.smFov != null && uv.alt != null ? uv.alt : null;
      skyTouch();
    }
    prepareSky();
    planetText();
    drawPlanetBars();
    renderPlanetCards();
    renderMoon();
    drawSkyMap();
  }

  function drawPlanetBars() {
    var win = state.plWin, off = state.off, W = el.plBars.clientWidth || 600, narrow = W < 560;
    var dualB = pcDiffers(win), LEFT = 72, RIGHT = narrow ? 92 : 206, top = dualB ? 34 : 22, rowH = 22, H = top + BODIES.length * rowH + 6;
    var dpr = window.devicePixelRatio || 1, cv = el.plBars, ctx = cv.getContext('2d');
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var span = win.end - win.start, pw = W - LEFT - RIGHT;
    function xOf(sec) { return LEFT + (sec - win.start) / span * pw; }
    state.plBarsLayout = { LEFT: LEFT, pw: pw };
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif'; ctx.textBaseline = 'middle';
    /* twilight strip and hour labels */
    /* the same sky colours as the altitude charts: day, twilight in blues, green once it is astronomically dark */
    win.samples.forEach(function (row) { ctx.fillStyle = chartSky(row.sun.alt); ctx.fillRect(xOf(row.t), 2, pw / (span / 600) + 0.5, 6); });
    var every = pw / (span / 3600) < 34 ? 2 : 1;
    ctx.textAlign = 'center';
    for (var hsA = localHours(win.start, win.end, off), hiA = 0; hiA < hsA.length; hiA++) {
      var h = hsA[hiA];
      var hr = localDate(h, off).getUTCHours();
      if (hr % every) continue;
      ctx.fillStyle = COL.grid; ctx.fillRect(Math.round(xOf(h)), top - 4, 1, H - top);
      ctx.fillStyle = COL.text; ctx.fillText(pad(hr), xOf(h), 14);
    }
    if (dualB) { /* the visitor's device time as a second, lighter hour row */
      ctx.fillStyle = 'rgba(154,167,182,.65)';
      for (var hsP = localHours(win.start, win.end, pcOff), hiP = 0; hiP < hsP.length; hiP++) {
        var hrP = localDate(hsP[hiP], pcOff).getUTCHours();
        if (!(hrP % every)) ctx.fillText(pad(hrP), xOf(hsP[hiP]), 26);
      }
    }
    /* right-hand columns: altitude at the slider's time, highest altitude in the night, brightness (moon: lit share) */
    var base = LEFT + pw, colNow = base + (narrow ? 40 : 50), colMax = narrow ? W - 8 : base + 118, colExtra = W - 8;
    ctx.textAlign = 'right'; ctx.fillStyle = COL.text;
    ctx.fillText(T.barsNow, colNow, 14);
    ctx.fillText(narrow ? T.barsMaxShort : T.barsMax, colMax, 14);
    if (!narrow) ctx.fillText(T.barsExtra, colExtra, 14);
    BODIES.forEach(function (id, k) {
      var y = top + k * rowH;
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(LEFT, y + 6, pw, 10);
      win.samples.forEach(function (row, i) {
        var b = row[id];
        if (i < win.samples.length - 1 && b.alt > 0) {
          /* stronger the higher; weaker while the sky is still bright */
          ctx.globalAlpha = clamp(b.alt / 45, 0.25, 1) * clamp((-row.sun.alt - 6) / 6, 0.35, 1);
          ctx.fillStyle = BODY_COL[id]; ctx.fillRect(xOf(row.t), y + 6, pw / (span / 600) + 0.5, 10);
          ctx.globalAlpha = 1;
        }
      });
      var best = bestSample(win, id);
      ctx.textAlign = 'right'; ctx.fillStyle = BODY_COL[id]; ctx.fillText(T.plNames[id], LEFT - 8, y + 11);
      var nowB = A.bodyAt(id, state.plT, state.lat, state.lon);
      ctx.textAlign = 'right';
      ctx.font = '600 11px system-ui, -apple-system, Segoe UI, sans-serif'; ctx.fillStyle = nowB.alt > 0 ? '#e4e9ef' : COL.text;
      ctx.fillText(nowB.alt > 0 ? num(nowB.alt) + '°' : '–', colNow, y + 11);
      ctx.font = '10px system-ui, -apple-system, Segoe UI, sans-serif'; ctx.fillStyle = COL.text;
      ctx.fillText(!best || best.b.alt < 3 ? '–' : num(best.b.alt) + '°', colMax, y + 11);
      if (!narrow) ctx.fillText(id === 'moon' ? Math.round((best ? best.b.illum : nowB.illum) * 100) + ' %' : num((best ? best.b : nowB).mag, 1) + ' mag', colExtra, y + 11);
    });
    ctx.fillStyle = COL.now; ctx.fillRect(Math.round(xOf(state.plT)), top - 4, 2, H - top);
    alignSlider(LEFT, pw);
  }

  /* A range input puts its thumb centre at THUMB / 2 + share × (width − THUMB). Stretched over the bars' time axis plus
     half a thumb on each side, the thumb stands exactly on the red time lines of the bars and the picked object's chart. */
  var THUMB = 16; /* the thumb width in css/style.css, #op-sm-time */
  function alignSlider(LEFT, pw) {
    var s = el.smTime, win = state.plWin;
    if (state.smFull) { /* full screen: the bars lie hidden behind, there is nothing to line up with */
      var sh = win && win.end > win.start ? clamp((state.plT - win.start) / (win.end - win.start), 0, 1) : 0;
      s.style.flex = '1'; s.style.width = ''; s.style.marginLeft = '0px'; s.style.setProperty('--fill', (sh * 100).toFixed(2) + '%');
      return;
    }
    s.style.flex = 'none'; s.style.width = (pw + THUMB) + 'px'; s.style.marginLeft = '0px';
    var want = el.plBars.getBoundingClientRect().left + LEFT - THUMB / 2;
    s.style.marginLeft = (want - s.getBoundingClientRect().left) + 'px';
    var share = win && win.end > win.start ? clamp((state.plT - win.start) / (win.end - win.start), 0, 1) : 0;
    s.style.setProperty('--fill', ((THUMB / 2 + share * pw) / (pw + THUMB) * 100).toFixed(2) + '%');
  }

  /* rise, set and best time of each body: not shown on the page, but read out by screen readers from the bars */
  function planetText() {
    var off = state.off, win = state.plWin, lines = [];
    BODIES.forEach(function (id) {
      var cr = A.crossings(function (s) { return A.bodyAt(id, s, state.lat, state.lon).alt; }, win.start, win.end, 120, id === 'moon' ? -0.833 : -0.567);
      var best = bestSample(win, id), upAtAll = win.samples.some(function (row) { return row[id].alt > 0; });
      var bits = cr.map(function (c) { return (c.rising ? T.plRise : T.plSet) + ' ' + hhmm(c.t, off); });
      if (best) bits.splice(cr.filter(function (c) { return c.t < best.t; }).length, 0, T.plTop + ' ' + hhmm(best.t, off) + ' (' + num(best.b.alt) + '°)');
      var extra = id === 'moon' ? Math.round((best ? best.b.illum : A.moonIllumination(win.start * 1000).fraction) * 100) + ' % ' + T.lit : best ? num(best.b.mag, 1) + ' mag' : '';
      /* under 3° a body is lost in the horizon haze */
      lines.push('<strong>' + T.plNames[id] + ':</strong> ' + (best && best.b.alt >= 3 ? bits.concat(extra).join(' · ') : best ? T.plLow : upAtAll ? T.plDayOnly : T.plDown));
    });
    el.plBars.setAttribute('aria-label', lines.join('. ').replace(/<[^>]+>/g, ''));
  }

  function setPlanetTime(sec, exact) {
    var win = state.plWin;
    if (!win) return;
    state.plT = clamp(Math.round(sec / (exact ? 60 : 300)) * (exact ? 60 : 300), win.start, win.end); /* events keep their minute */
    el.smTime.value = state.plT;
    drawPlanetBars();
    drawSkyMap();
    renderMoon();
  }

  /* ------------------------------------------------------------------ *
   * Events of the night                                                *
   * ------------------------------------------------------------------ */
  /* boundaries at B1875 for naming the stars the moon covers, worked out once */
  var occBounds = null;
  function hhmmss(sec, off) {
    function f(o) { var d = localDate(Math.round(sec), o); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); }
    return f(off) + (off === state.off && pcTime(sec) ? ' (' + f(pcOff) + ')' : '');
  }
  /* months with at least an hour, as ranges ("Mar–Oct"), wrapping over the year's end */
  function seasonText(hours) {
    var on = hours.map(function (h) { return h >= 1; }), names = T.months.map(function (m) { return m.slice(0, 3); }), runs = [];
    if (!on.some(Boolean)) return '';
    if (on.every(Boolean)) return T.evAllYear;
    for (var i = 0; i < 12; i++) {
      if (!on[i] || on[(i + 11) % 12]) continue;
      var j = i;
      while (on[(j + 1) % 12]) j = (j + 1) % 12;
      runs.push(names[i] + (j !== i ? '–' + names[j] : ''));
    }
    return runs.join(', ');
  }

  /* ------------------------------------------------------------------ *
   * The info card's season chart: the selected object night by night   *
   * ------------------------------------------------------------------ */
  /* For 1, 3, 6 or 12 months around the chosen night (a quarter before it): per night the hours of astronomical darkness,
     above 30° without and with the moon, the highest altitude in darkness and the moon's distance there
     (SvSkyEvents.nightSummary()). Computed in chunks of 30 nights so the page stays responsive; the range stays while the
     chosen night lies inside it. A hover shows a night's values, a click chooses it. */
  var season = { id: '', key: '', first: 0, span: 0, nights: [], token: 0, width: 0, drawnSel: null, isMoon: false, layout: null };
  function drawSeason(inf, d) {
    var cv = el.smSeasonChart;
    if (!cv || !window.SvSkyEvents || !state.plWin) return;
    var lat = state.lat, lon = state.lon, off = state.off, span = state.seasonSpan;
    var id = [inf.kind, inf.id != null ? inf.id : inf.idx, d.title, lat, lon, state.zone].join('|');
    var first = id === season.id && span === season.span && state.key >= season.first && state.key < season.first + span ? season.first : state.key - Math.round(span * 0.25);
    var key = id + '|' + first + '|' + span;
    if (key === season.key) {
      if (Math.round(cv.clientWidth) !== season.width || season.drawnSel !== state.key) paintSeason();
      return;
    }
    season.id = id; season.key = key; season.first = first; season.span = span; season.nights = [];
    season.isMoon = inf.kind === 'body' && inf.id === 'moon';
    var token = ++season.token, step = span > 200 ? 1800 : span > 100 ? 1200 : 900, altAz, i = 0;
    if (d.chart.fixed) {
      var pc = A.precessJ2000(d.chart.fixed.ra, d.chart.fixed.dec, (first + span / 2) * 86400000);
      altAz = function (t) { return A.horizontalOf(pc.ra, pc.dec, t * 1000, lat, lon); };
    } else altAz = function (t) { return A.bodyAt(inf.id, t, lat, lon); };
    (function chunk() {
      if (token !== season.token) return;
      for (var n = 0; n < 30 && i < span; n++, i++) {
        var k = first + i, ev = fromLocal(k * 86400 + 43200, off), nx = fromLocal((k + 1) * 86400 + 43200, off);
        season.nights.push({ key: k, s: window.SvSkyEvents.nightSummary(altAz, ev, nx, lat, lon, step, season.isMoon) });
      }
      paintSeason();
      if (i < span) setTimeout(chunk, 0);
    })();
  }
  function paintSeason() {
    var cv = el.smSeasonChart, N = season.span, nights = season.nights;
    if (!cv || !N || !cv.clientWidth) return;
    var W = cv.clientWidth, H = cv.clientHeight || 170, dpr = window.devicePixelRatio || 1, ctx = cv.getContext('2d');
    season.width = Math.round(W); season.drawnSel = state.key;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var L = 30, R = 32, top = 8, bottom = 20, pw = W - L - R, ph = H - top - bottom, hMax = 12;
    nights.forEach(function (n) { hMax = Math.max(hMax, Math.ceil(n.s.dark)); });
    var bw = pw / N;
    function X(i) { return L + i * bw; }
    function Yh(h) { return top + ph - h / hMax * ph; }
    function Yd(a) { return top + ph - clamp(a, 0, 90) / 90 * ph; }
    ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1;
    [30, 60].forEach(function (a) { ctx.beginPath(); ctx.moveTo(L, Math.round(Yd(a)) + 0.5); ctx.lineTo(L + pw, Math.round(Yd(a)) + 0.5); ctx.stroke(); });
    ctx.font = '10px ' + FONT; ctx.textBaseline = 'middle';
    for (var i = 0; i < N; i++) { /* weeks (Mondays) for one month, else the first of each month */
      var dd = new Date((season.first + i) * 86400000);
      if (N <= 40 ? dd.getUTCDay() !== 1 : dd.getUTCDate() !== 1) continue;
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(Math.round(X(i)), top, 1, ph);
      ctx.fillStyle = COL.text; ctx.textAlign = 'left';
      ctx.fillText(N <= 40 ? pad(dd.getUTCDate()) + '.' + pad(dd.getUTCMonth() + 1) + '.' : T.months[dd.getUTCMonth()].slice(0, 3), X(i) + 3, H - 9);
    }
    nights.forEach(function (n, i) {
      var s = n.s, x = X(i), w = bw + 0.4;
      ctx.fillStyle = 'rgba(160,172,190,.28)'; ctx.fillRect(x, Yh(s.dark), w, Yh(0) - Yh(s.dark));
      if (season.isMoon) { ctx.fillStyle = 'rgba(242,163,76,.75)'; ctx.fillRect(x, Yh(s.above30), w, Yh(0) - Yh(s.above30)); return; }
      ctx.fillStyle = 'rgba(76,200,140,.8)'; ctx.fillRect(x, Yh(s.above30Moonless), w, Yh(0) - Yh(s.above30Moonless));
      if (s.above30 > s.above30Moonless) { ctx.fillStyle = 'rgba(229,72,77,.75)'; ctx.fillRect(x, Yh(s.above30), w, Yh(s.above30Moonless) - Yh(s.above30)); }
    });
    function line(get, colour, dash) {
      var started = false;
      ctx.beginPath();
      nights.forEach(function (n, i) {
        var v = get(n.s);
        if (v == null) { started = false; return; }
        if (started) ctx.lineTo(X(i) + bw / 2, Yd(v)); else { ctx.moveTo(X(i) + bw / 2, Yd(v)); started = true; }
      });
      ctx.strokeStyle = colour; ctx.lineWidth = 1.6; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
    }
    line(function (s) { return s.maxAlt; }, '#eef2f6');
    if (!season.isMoon) line(function (s) { return s.moonSep == null ? null : s.moonSep / 2; }, '#f5c26b', [4, 3]);
    var nowSec = Date.now() / 1000, today = Math.floor((nowSec + state.off(nowSec)) / 86400) - season.first, sel = state.key - season.first;
    if (today >= 0 && today < N) { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(today) + bw / 2, top); ctx.lineTo(X(today) + bw / 2, top + ph); ctx.stroke(); ctx.setLineDash([]); }
    if (sel >= 0 && sel < N) { ctx.fillStyle = COL.now; ctx.fillRect(X(sel) + bw / 2 - 1, top, 2, ph); }
    ctx.fillStyle = COL.text; ctx.textAlign = 'right';
    [0, 30, 60, 90].forEach(function (a) { ctx.fillText(a + '°', L - 4, clamp(Yd(a), top + 5, top + ph - 4)); });
    ctx.textAlign = 'left';
    [0, Math.round(hMax / 2), hMax].forEach(function (h) { ctx.fillText(h + ' h', L + pw + 4, clamp(Yh(h), top + 5, top + ph - 4)); });
    if (nights.length < N) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(228,233,239,.85)'; ctx.fillText(T.seasonBusy, L + pw / 2, top + 14); }
    season.layout = { L: L, bw: bw };
    if (el.smSeasonKey) el.smSeasonKey.innerHTML = keyHtml(season.isMoon
      ? [['rgba(160,172,190,.6)', 'box', T.kc.darkHours], ['rgba(242,163,76,.85)', 'box', T.kc.moonAbove], ['#eef2f6', 'line', T.kc.maxAlt], [COL.now, 'line', T.kc.chosen]]
      : [['rgba(160,172,190,.6)', 'box', T.kc.darkHours], ['rgba(76,200,140,.9)', 'box', T.kc.moonless], ['rgba(229,72,77,.85)', 'box', T.kc.moonlit], ['#eef2f6', 'line', T.kc.maxAlt], ['#f5c26b', 'dash', T.kc.moonSep], [COL.now, 'line', T.kc.chosen], ['rgba(255,255,255,.75)', 'dash', T.kc.today]],
      T.kc.seasonScale + ' · ' + T.kc.clickNight);
  }
  function seasonIndex(e) {
    var r = el.smSeasonChart.getBoundingClientRect(), ly = season.layout;
    if (!ly) return -1;
    var i = Math.floor((e.clientX - r.left - ly.L) / ly.bw);
    return i >= 0 && i < season.nights.length ? i : -1;
  }

  function renderEvents() {
    var E = window.SvSkyEvents, win = state.plWin, d = state.evData;
    if (!el.events || !E || !win) return;
    var lat = state.lat, lon = state.lon, off = state.off, H = T.evHead, groups = [], lead = null;
    function dir(az) { return T.compassLong[Math.round(az / 45) % 8]; }
    /* one table per kind of event: the first column is the name, every further cell is [text, optional grey second line];
       rows with an action (time and viewing direction) get a "Show on star map" button */
    /* a kind without rows is left out on the page, unless its empty text is a warning (`warn`: orbital or comet data too old) */
    function group(title, cols, rows, empty, note, warn) { groups.push({ title: title, cols: cols, rows: rows, empty: empty, note: note, warn: !!warn }); }
    function dateText(ms) { var dt = new Date(ms); return pad(dt.getUTCDate()) + '.' + pad(dt.getUTCMonth() + 1) + '.' + dt.getUTCFullYear(); }

    /* satellites */
    state.passes = [];
    state.cometsNight = [];
    if (!d) {
      lead = state.evError ? T.evFailed : T.evLoading;
    } else {
      /* a satellite whose orbit is older than a fortnight gets no passes and is named in the group's note (with the date
         of its data); only when every satellite is stale does the warning replace the empty text — one stale satellite
         used to vanish silently */
      var mid = (win.start + win.end) / 2, staleSats = [], newest = 0;
      d.satellites.forEach(function (sat) {
        var epoch = E.parseTle(sat.tle1, sat.tle2).epochMs;
        newest = Math.max(newest, epoch);
        if (Math.abs(mid * 1000 - epoch) > 14 * 86400000) { staleSats.push(T.evStaleItem.replace('{s}', sat.name).replace('{d}', dateText(epoch))); return; }
        state.passes = state.passes.concat(E.satellitePasses(sat, win.start, win.end, lat, lon));
      });
      state.passes.sort(function (a, b) { return a.start - b.start; });
      var allStale = staleSats.length > 0 && staleSats.length === d.satellites.length;
      var staleNote = allStale ? T.evStale.replace('{d}', dateText(newest)) : staleSats.length ? T.evStaleSome.replace('{list}', staleSats.join(', ')) : null; /* the same date as in the line below */
      group(T.evSats, [H.sat, H.time, H.high, H.mag, H.path], state.passes.map(function (p) {
        return { name: p.name, act: { t: p.max.t, az: p.max.az, alt: p.max.alt }, cells: [[hhmm(p.start, off) + '–' + hhmm(p.end, off)],
          [hhmm(p.max.t, off) + ' · ' + num(p.max.alt) + '°', dir(p.max.az)], [T.evUpTo.replace('{v}', num(p.brightest, 1) + ' mag')],
          [dir(p.track[0].az) + ' → ' + dir(p.track[p.track.length - 1].az), p.faded ? T.evShadow : '']] };
      }), allStale ? staleNote : staleNote ? T.evNoPass + ' ' + staleNote : T.evNoPass, allStale ? null : staleNote, !!staleNote);
      el.evSub.textContent = T.evData.replace('{tle}', dateText(newest)).replace('{gen}', dateText(Date.parse(d.generated)));
      /* space stations in front of the moon or the sun, from this noon to the next (the sun in daytime) */
      var dkn = state.dark, transits = [], fresh = 0;
      d.satellites.forEach(function (sat) {
        if (Math.abs(mid * 1000 - E.parseTle(sat.tle1, sat.tle2).epochMs) > 14 * 86400000) return;
        fresh++;
        transits = transits.concat(E.satelliteTransits(sat, dkn.evening, dkn.next, lat, lon));
      });
      transits.sort(function (a, b) { return a.t - b.t; });
      group(T.evTransits, [H.transit, H.tWhen, H.result, H.centre, H.dir], transits.map(function (x) {
        var inNight = x.t >= win.start && x.t <= win.end;
        return { name: (x.body === 'sun' ? T.evTransitSun : T.evTransitMoon).replace('{s}', x.name), act: x.body === 'moon' && inNight ? { t: x.t, az: x.az, alt: x.alt } : null,
          cells: [[hhmmss(x.t, off), dayLabel(x.t, off)], [x.transit ? T.evTransitHit.replace('{d}', num(x.duration, 1)) : T.evTransitMiss.replace('{a}', num((x.sep - x.radius) * 60, 1) + '′')],
            [T.evCentre.replace('{km}', num(x.centreKm, x.centreKm < 10 ? 1 : 0))], [num(x.alt) + '°', dir(x.az)]] };
      }), fresh ? T.evNoTransit : T.evStale.replace('{d}', dateText(newest)), T.evTransitNote, !fresh);
    }

    /* moon, planets, bright stars */
    var names = state.names === 'local' && LANG === 'de';
    var bright = SKY ? SKY.stars.filter(function (st) { return st[4] && st[2] <= 1.6; }).map(function (st) { return { key: st[5], name: names ? st[4] : st[5], ra: st[0], dec: st[1], kind: 'star' }; }) : [];
    var pleiades = CATALOG.filter(function (o) { return o.id === 'M45'; }).map(function (o) { return { key: 'M45', name: (o[LANG] || 'M45') + ' (M45)', ra: o.ra, dec: o.dec, kind: 'cluster' }; });
    group(T.evMeet, [H.pair, H.sep, H.closest, H.dir], E.encounters(win.samples, lat, lon, bright, pleiades).map(function (m) {
      return { name: T.evPairName.replace('{a}', T.plNames[m.what.a]).replace('{b}', m.what.b ? T.plNames[m.what.b] : m.what.star.name),
        act: { t: m.t, az: m.az, alt: m.alt }, cells: [[num(m.sep, 1) + '°'], [hhmm(m.t, off)], [dir(m.az)]] };
    }), T.evNoMeet);

    /* the moon covering stars down to 6 mag and planets */
    if (state.smData) {
      var bounds = occBounds || (occBounds = window.SvSkyMap && SKY && SKY.bounds ? window.SvSkyMap.boundsB1875(SKY.bounds) : null), midMs = (win.start + win.end) / 2 * 1000;
      var targets = state.smData.stars.filter(function (st) { return st.mag <= 6; }).map(function (st) {
        var ab = bounds ? window.SvSkyMap.constellationAt(bounds, st.ra0, st.dec0) : null;
        return { name: st.name || (st.bayer && ab ? st.bayer + ' ' + consName(ab) : T.evStarMag.replace('{m}', num(st.mag, 1)) + (ab ? ', ' + consName(ab) : '')), mag: st.mag, ra: st.ra, dec: st.dec };
      }).concat(A.PLANETS.map(function (p) { return { name: T.plNames[p.id], mag: A.planetMagnitude(p.id, A.planetCoords(p, midMs)), planet: p }; }));
      group(T.evOcc, [H.occ, H.dis, H.re, H.moonAt], E.occultations(win.start, win.end, lat, lon, targets).map(function (x) {
        var ev = x.dis && x.dis.ok ? x.dis : x.re;
        function side(s) { return !s ? ['–'] : [hhmm(s.t, off) + (s.ok ? '' : ' ' + T.evUnseen), s.dark ? T.evLimbDark : T.evLimbBright]; }
        return { name: x.target.name + ' (' + num(x.target.mag, 1) + ' mag)', act: { t: ev.t, az: ev.az, alt: ev.alt }, cells: [side(x.dis), side(x.re), [num(ev.alt) + '°', dir(ev.az)]] };
      }), T.evNoOcc, T.evOccNote);
    }

    /* transits, shadows, occultations and eclipses of Jupiter's large moons */
    group(T.evJup, [H.jupEvent, H.times, H.vis, H.jupAlt], E.jupiterEvents(win.start, win.end, lat, lon).map(function (x) {
      return { name: T.galilean[x.moon] + ' – ' + T.jupKinds[x.kind], act: { t: x.t, az: x.az, alt: x.alt },
        cells: [[(x.from != null ? hhmm(x.from, off) : T.evBefore) + '–' + (x.to != null ? hhmm(x.to, off) : T.evAfter)], [hhmm(x.visFrom, off) + '–' + hhmm(x.visTo, off)], [num(x.alt) + '°', dir(x.az)]] };
    }), T.evNoJup, T.evJupNote);

    /* meteor showers: a button only while the radiant is up */
    var moonNow = Math.round(win.samples[Math.floor(win.samples.length / 2)].moon.illum * 100);
    var lm = state.sky === 'urban' ? 4.5 : state.sky === 'dark' ? 6.5 : 6.0; /* limiting magnitude: the preset's sky class, else a rural sky */
    group(T.evShowers, [H.shower, H.peak, H.radiant, H.zhr, H.expect, H.moon], E.showersTonight(win.samples, lat, lon).map(function (x) {
      var rate = E.meteorRate(x.shower, win.samples, lat, lon, lm);
      var dd = Math.round(Math.abs(x.daysToPeak)), peak = dd < 1 ? T.evPeakNow : (x.daysToPeak > 0 ? (dd === 1 ? T.evPeakIn1 : T.evPeakIn) : (dd === 1 ? T.evPeakAgo1 : T.evPeakAgo)).replace('{d}', dd);
      var rad = !x.best ? T.evRadNoDark : x.best.alt <= 0 ? T.evRadDown : (x.from ? T.evRadFrom.replace('{t}', hhmm(x.from, off)) : T.evRadLow).replace('{bt}', hhmm(x.best.t, off)).replace('{alt}', num(x.best.alt));
      return { name: x.shower[LANG], act: x.best && x.best.alt > 0 ? { t: x.best.t, az: x.best.az, alt: x.best.alt } : null,
        cells: [[peak], [rad], [T.evUpTo.replace('{v}', x.shower.zhr)], rate && rate.t ? [T.evRateVal.replace('{n}', num(rate.hr)), T.evRateAt.replace('{t}', hhmm(rate.t, off))] : ['–'], [moonNow + ' %']] };
    }), T.evNoShower, T.evZhrNote + ' ' + T.evRateNote.replace('{lm}', num(lm, 1)));

    /* the centre of the Milky Way: tonight and the season */
    var gc = E.galacticCentre(win.samples, lat, lon);
    if (gc) {
      /* without astronomical darkness galacticCentre() falls back to nautical darkness (tn.level −12): the time is marked
         so and the note says it, since the season next to it only counts astronomical darkness */
      var tn = gc.tonight, season = seasonText(gc.months), gcNaut = tn && tn.level === -12;
      group(T.evGc, [H.sat, H.gcWhen, H.gcBest, H.gcMoon, H.gcSeason], [{ name: T.gcName, act: tn ? { t: tn.best.t, az: tn.best.az, alt: tn.best.alt } : null,
        cells: [[tn ? (tn.to > tn.from ? hhmm(tn.from, off) + '–' + hhmm(tn.to, off) : T.evRateAt.replace('{t}', hhmm(tn.from, off))) + (gcNaut ? T.gcNautical : '') : T.evGcNone], tn ? [hhmm(tn.best.t, off) + ' · ' + num(tn.best.alt) + '°', dir(tn.best.az)] : ['–'],
          [Math.round((tn ? tn.illum : win.samples[Math.floor(win.samples.length / 2)].moon.illum) * 100) + ' %', tn && tn.moonSep != null ? T.evMoonSep.replace('{d}', num(tn.moonSep)) : ''],
          [season || T.evGcNoSeason]] }], '', gcNaut ? T.evGcNoteNautical : T.evGcNote);
    }

    /* attractive double stars: the highest point in astronomical darkness (nautical where there is none, as in the list's
       listWindow()), at least 25° up; ranked by a rough appeal — altitude, a bright companion, a small brightness difference,
       not too close, colour contrast between a hot and a cool star, a proper name — twelve at most. The aperture follows the
       Dawes limit (116″ / D in mm), raised for a companion much fainter than its primary. The card under the map works out
       its own "highest" (sky-map.js infoStatic(): sun below −6°, else any time), which can differ from the table's. */
    if (state.doubles && state.doubles.objects) {
      var DF = state.doubles.fields, di = function (n) { return DF.indexOf(n); }, dRows = win.samples.filter(function (r) { return r.sun.alt < -18; });
      if (!dRows.length) dRows = win.samples.filter(function (r) { return r.sun.alt < -12; });
      var dMid = (win.start + win.end) / 2 * 1000, dLocal = state.names === 'local' && LANG === 'de';
      var hotStar = function (s) { return /^[OBA]/.test(s); }, coolStar = function (s) { return /^[KM]/.test(s); };
      /* The catalogue positions are epoch 2000 without proper motion (61 Cygni had moved 141″ by 2026). Where the primary is
         a star of the map — the same proper name, else within 60″ of the star catalogue's epoch-2000 position — its moved
         position (ra0/dec0 of state.smData, J2000 with proper motion) is used for the ring, the card and the altitude.
         The match is by catalogue index, worked out once per double-star file; the moved position is read per night. */
      if (!state.doubles.starIdx && SKY) state.doubles.starIdx = state.doubles.objects.map(function (o) {
        var ra = o[di('ra')], dec = o[di('dec')], name = String(o[di('name')] || '').toLowerCase(), found = -1, bestSep = 60 / 3600, cd = Math.cos(dec * RAD);
        SKY.stars.forEach(function (s, i) {
          if (name && String(s[5] || '').toLowerCase() === name) { found = i; bestSep = -1; return; }
          if (bestSep < 0 || Math.abs(s[1] - dec) > bestSep) return;
          var dra = Math.abs(s[0] - ra); if (dra > 180) dra = 360 - dra;
          var sep = Math.sqrt(dra * cd * dra * cd + (s[1] - dec) * (s[1] - dec));
          if (sep < bestSep) { bestSep = sep; found = i; }
        });
        return found;
      });
      var dblPos = function (o, k) {
        var i = state.doubles.starIdx ? state.doubles.starIdx[k] : -1, st = i >= 0 && state.smData && state.smData.byIdx ? state.smData.byIdx[i] : null;
        return st ? { ra: st.ra0, dec: st.dec0 } : { ra: o[di('ra')], dec: o[di('dec')] };
      };
      var doubles = state.doubles.objects.map(function (o, k) {
        var pos = dblPos(o, k), pc = A.precessJ2000(pos.ra, pos.dec, dMid), best = null, hours30 = 0;
        dRows.forEach(function (r) {
          var h = A.horizontalOf(pc.ra, pc.dec, r.t * 1000, lat, lon);
          if (h.alt >= 30) hours30 += 600 / 3600;
          if (!best || h.alt > best.alt) best = { t: r.t, alt: h.alt, az: h.az, row: r };
        });
        if (!best || best.alt < 25) return null;
        var m1 = o[di('m1')], m2 = o[di('m2')], dsep = o[di('sep')], sp = String(o[di('sp')] || '').split('+');
        var contrast = sp.length > 1 && ((hotStar(sp[0]) && coolStar(sp[1])) || (coolStar(sp[0]) && hotStar(sp[1]))) ? 1.2 : 1;
        var score = clamp((best.alt - 20) / 40, 0.1, 1) * Math.pow(0.8, Math.max(0, m2 - 5)) * Math.pow(0.85, Math.max(0, m2 - m1 - 1)) * (dsep >= 3 ? 1 : 0.75) * contrast * (o[di('name')] ? 1.25 : 1);
        return { o: o, pos: pos, best: best, hours30: hours30, score: score };
      }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
      /* The double stars are rows of the best objects of the night (drawList()), in the list's item shape: type DS, an id
         of their own (dbl:…), the moon at the best time, hours above 30°. They are ranked with the objects for the eye —
         the appeal above tops out near 1.5, so visual = appeal / 1.5 — and not for imaging, where only their own chip
         shows them. */
      state.dblItems = doubles.map(function (x) {
        var o = x.o, pos = x.pos, disc = o[di('disc')] + (o[di('comp')] ? ' ' + o[di('comp')] : ''), bayer = o[di('bayer')] ? o[di('bayer')] + ' ' + o[di('con')] : '';
        var name = o[di('name')] ? (dLocal && o[di('nameDe')] ? o[di('nameDe')] : o[di('name')]) : '';
        var title = name ? name + (bayer ? ' · ' + bayer : '') : bayer || disc + (o[di('con')] ? ' · ' + consName(o[di('con')]) : '');
        var dsep = o[di('sep')], need = 116 / dsep * (1 + 0.4 * Math.max(0, o[di('m2')] - o[di('m1')] - 1.5));
        var mm = [50, 60, 70, 80, 100, 125, 150, 200, 250, 300].filter(function (s) { return s >= need; })[0] || 300;
        var mags = T.dblMags.replace('{a}', num(o[di('m1')], 1)).replace('{b}', num(o[di('m2')], 1)), sepPa = num(dsep, 1) + '″ · ' + num(o[di('pa')]) + '°';
        var aperture = dsep >= 20 && o[di('m2')] <= 7 ? T.dblBinoc : T.dblAperture.replace('{d}', mm);
        var info = { kind: 'double', id: o[di('wds')] + ' ' + (o[di('comp')] || 'AB'), d: { ra: pos.ra, dec: pos.dec, title: title, wdsId: o[di('wds')], wds: o[di('wds')] + ' ' + disc,
          sp: o[di('sp')] || '', con: o[di('con')] || '', mags: mags, sepPa: sepPa, aperture: aperture } };
        /* Wikipedia: a search for the Bayer designation, else the SIMBAD identifier (61 Cygni, HD 21291), else the name */
        info.d.wiki = window.SvSkyMap.wikiUrl(LANG, null, window.SvSkyMap.starWikiQuery(LANG, { name: (LANG === 'de' && o[di('nameDe')]) || o[di('name')],
          bayer: o[di('bayer')], con: o[di('con')], simbad: o[di('simbad')] }));
        var mr = x.best.row.moon, b = x.best;
        var cosSep = Math.sin(b.alt * RAD) * Math.sin(mr.alt * RAD) + Math.cos(b.alt * RAD) * Math.cos(mr.alt * RAD) * Math.cos((b.az - mr.az) * RAD);
        return {
          o: { id: 'dbl:' + info.id, label: title, t: 'DS', c: o[di('con')] || '', ra: pos.ra, dec: pos.dec, m: o[di('m1')], wiki: info.d.wiki },
          best: { t: b.t, alt: b.alt, az: b.az, moonAlt: mr.alt, illum: mr.illum, sep: Math.acos(clamp(cosSep, -1, 1)) / RAD, moonPen: 0 },
          hours30: x.hours30, photo: 0, visual: clamp(x.score / 1.5, 0, 1),
          dbl: { info: info, target: { ra: pos.ra, dec: pos.dec, label: title }, mags: mags, sepPa: sepPa, aperture: aperture, disc: disc + (o[di('sp')] ? ' · ' + o[di('sp')] : '') }
        };
      });
      if (state.listRes) drawList();
    }

    /* comets */
    /* the comet data list comets with perihelion from 400 days before to 700 days after their download: nights far
       outside that span would silently miss comets */
    var generated = d ? Date.parse(d.generated) : 0, night = (win.start + win.end) / 2 * 1000;
    if (d && (night < generated - 180 * 86400000 || night > generated + 365 * 86400000)) {
      group(T.evComets, [], [], T.evCometsOld.replace('{d}', dateText(generated)), null, true);
    } else if (d) {
      state.cometsNight = E.cometsTonight(d.comets, win.samples, lat, lon);
      group(T.evComets, [H.comet, H.mag, H.best, H.dir, H.dist], state.cometsNight.map(function (c) {
        return { name: c.comet.name, act: { t: c.best.t, az: c.best.az, alt: c.best.alt }, cells: [[T.evAbout.replace('{v}', num(c.best.mag, 1) + ' mag')],
          [hhmm(c.best.t, off), num(c.best.alt) + '°'], [dir(c.best.az)], [T.evAu.replace('{v}', num(c.best.dist, 2))]] };
      }), T.evNoComet, T.evCometNote);
    }

    /* the next eclipses seen from here, from this night on. Cached per place and fortnight, searched from the fortnight's
       start and then filtered to what is still to come this night: searched from whichever night filled the cache first,
       stepping back inside the fortnight lost the eclipse of the night in between. Within 14 days there is at most one lunar
       and one solar eclipse, so four found leave three. */
    var dkE = state.dark, eBlock = Math.floor(dkE.evening / (14 * 86400)), eKey = [lat, lon, eBlock].join('|');
    if (!state.eclCache || state.eclCache.key !== eKey) state.eclCache = { key: eKey, lunar: E.lunarEclipses(eBlock * 14 * 86400, 10, 4, lat, lon), solar: E.solarEclipses(eBlock * 14 * 86400, 20, 4, lat, lon) };
    var eclKeep = function (list) { return list.filter(function (x) { return (x.visTo != null ? x.visTo : x.t) >= dkE.evening; }).slice(0, 3); };
    var eclipses = eclKeep(state.eclCache.lunar).map(function (x) { return { x: x, solar: false }; }).concat(eclKeep(state.eclCache.solar).map(function (x) { return { x: x, solar: true }; }))
      .sort(function (a, b) { return a.x.t - b.x.t; });
    group(T.evEcl, [H.ecl, H.eclWhen, H.eclPhase, H.eclVis], eclipses.map(function (e) {
      var x = e.x, fmt = function (s) { return s == null ? '–' : hhmm(s, off); }, when = dayLabel(x.t, off) + localDate(x.t, off).getUTCFullYear() + ', ' + fmt(x.t);
      var phases = e.solar ? [fmt(x.C1) + '–' + fmt(x.C4), x.C2 != null ? T.eclCentral[x.type].replace('{a}', fmt(x.C2)).replace('{b}', fmt(x.C3)) : '']
        : [x.U1 != null ? T.eclUmbra.replace('{a}', fmt(x.U1)).replace('{b}', fmt(x.U4)) : T.eclPenumbra.replace('{a}', fmt(x.P1)).replace('{b}', fmt(x.P4)), x.U2 != null ? T.eclTotal.replace('{a}', fmt(x.U2)).replace('{b}', fmt(x.U3)) : ''];
      var size = e.solar ? T.eclObsc.replace('{p}', Math.round(x.obscuration * 100)) : T.eclMag.replace('{m}', num(x.umbral > 0 ? x.umbral : x.penumbral, 2));
      var act = null;
      if (!e.solar) { var tv = x.alt > 0 ? x.t : x.visFrom, mb = A.bodyAt('moon', tv, lat, lon); act = { key: A.nightKeyOf(tv, off), t: tv, az: mb.az, alt: mb.alt }; }
      return { name: (e.solar ? T.eclSolar : T.eclLunar)[x.type], act: act,
        cells: [[when, size], phases, [x.whole ? T.eclWhole : T.eclPart.replace('{a}', fmt(x.visFrom)).replace('{b}', fmt(x.visTo)), T.eclAlt.replace('{a}', num(x.alt))]] };
    }), T.evNoEcl, T.evEclNote);

    state.evView = { lead: lead, groups: groups };
    drawEvents();
    drawSkyMap(); /* passes and comets of this night on the map */
  }

  /* scroll so that an element sits just below the site header and the sticky section navigation (scroll-margin alone
     left headings under them) */
  function scrollBelowNav(target) {
    if (!target) return;
    var header = document.querySelector('header'), nav = document.getElementById('op-nav');
    var y = target.getBoundingClientRect().top + window.pageYOffset - (header ? header.offsetHeight : 0) - (nav ? nav.offsetHeight : 0) - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  /* lays out what renderEvents() computed: tables, or cards below 640 px like the top list (again on resize) */
  function drawEvents() {
    var v = state.evView;
    if (!el.events || !v) return;
    state.evOpen = state.evOpen || {}; /* which kinds are open, by title, for this page view */
    var narrow = el.events.clientWidth < 640, acts = [], html = '';
    function button(act) {
      if (!act) return '';
      acts.push(act);
      return '<button type="button" class="op-show" data-ev="' + (acts.length - 1) + '">' + esc(T.showMap) + '</button>';
    }
    function cell(c, card) { return esc(c[0]) + (c[1] ? (card ? ' · ' : '<br>') + '<span style="color:var(--text-light);">' + esc(c[1]) + '</span>' : ''); }
    /* a symbol per kind (header, timeline; U+FE0E asks for the text form, not an emoji) and a time chip in front of each
       entry: the time when it falls into this night, else its day */
    var ICON = {}, win = state.plWin, off = state.off;
    [[T.evSats, '⌁'], [T.evTransits, '⊙'], [T.evMeet, '☌'], [T.evOcc, '◐'], [T.evJup, '♃'], [T.evShowers, '✧'], [T.evGc, '✺'], [T.evDoubles, '⁑'], [T.evComets, '☄'], [T.evEcl, '◑']]
      .forEach(function (p) { ICON[p[0]] = p[1] + '\uFE0E'; });
    function icon(g) { return ICON[g.title] ? '<span class="op-ev-ico" aria-hidden="true">' + ICON[g.title] + '</span>' : ''; }
    /* On a night with a daylight-saving switch the clock runs 02:59 → 02:00, so the times in the timeline and the chips
       carry the zone's abbreviation (MESZ/MEZ, CEST/CET from Intl; else the UTC offset); on every other night only hh:mm */
    var dst = win && off(win.start) !== off(win.end), zoneFmt = null;
    if (dst) try { zoneFmt = new Intl.DateTimeFormat(LANG === 'de' ? 'de' : 'en-GB', { timeZone: state.zone, timeZoneName: 'short' }); } catch (e) { zoneFmt = null; }
    function zoneAbbr(sec) {
      if (zoneFmt) {
        var p = zoneFmt.formatToParts(new Date(sec * 1000)).filter(function (x) { return x.type === 'timeZoneName'; })[0];
        if (p && p.value) return p.value;
      }
      var o = Math.round(off(sec) / 3600);
      return (o < 0 ? '−' : '+') + pad(Math.abs(o));
    }
    function nightTime(sec) { var p = pcTime(sec); return hhmmLoc(sec, off) + (dst ? ' ' + zoneAbbr(sec) : '') + (p ? ' (' + p + ')' : ''); }
    function timeChip(act) {
      if (!act || act.t == null) return '';
      return '<span class="op-ev-time">' + esc(win && act.t >= win.start && act.t <= win.end ? nightTime(act.t) : dayLabel(act.t, off)) + '</span>';
    }
    if (v.lead) html += '<p style="margin:0; font-size:.9rem; color:var(--text-light);">' + esc(v.lead) + '</p>';
    /* every kind is a <details> with its count (closed until opened, kept in state.evOpen) */
    var shown = 0;
    function oneGroup(g, gi) {
      if (!g.rows.length && !g.warn) return;
      shown++;
      var badge = '<span class="op-count' + (g.rows.length ? '' : ' op-count-warn') + '">' + (g.rows.length || '!') + '</span>';
      var first = g.rows[0], peek = first ? first.name + (first.cells[0] && first.cells[0][0] ? ' · ' + first.cells[0][0] : '') : ''; /* the first entry, shown while closed */
      html += '<details class="op-ev-group" data-ev-group="' + gi + '" data-title="' + esc(g.title) + '"' + (state.evOpen[g.title] ? ' open' : '') + '><summary>' + icon(g) + '<span class="op-ev-title">' + esc(g.title) + '</span>' + badge +
        (peek ? '<span class="op-ev-peek">' + esc(peek) + '</span>' : '') + '</summary><div class="op-ev-body">';
      if (!g.rows.length) { html += '<p style="margin:0; font-size:.9rem; color:var(--text-light);">' + esc(g.empty) + '</p></div></details>'; return; }
      if (narrow) {
        g.rows.forEach(function (r) {
          html += '<div style="margin:.45rem 0 0; padding:.55rem .75rem; border-radius:var(--radius); border:1px solid rgba(26,42,58,.12); font-size:.86rem; line-height:1.6;">' +
            '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:.2rem .6rem; margin-bottom:.1rem;">' + timeChip(r.act) + '<strong style="color:var(--primary);">' + esc(r.name) + '</strong>' + button(r.act) + '</div>' +
            r.cells.map(function (c, k) { return '<div><span style="color:var(--text-light);">' + esc(g.cols[k + 1]) + ':</span> ' + cell(c, true) + '</div>'; }).join('') + '</div>';
        });
      } else {
        html += '<div style="overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid rgba(26,42,58,.12); border-radius:var(--radius);"><table style="width:100%; border-collapse:collapse; font-size:.83rem;"><thead><tr style="background:rgba(26,42,58,.06);">' +
          g.cols.map(function (h) { return '<th style="text-align:left; padding:.45rem .4rem; font-size:.66rem; text-transform:uppercase; letter-spacing:.03em; color:var(--primary); border-bottom:1px solid rgba(26,42,58,.18); vertical-align:bottom;">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
        g.rows.forEach(function (r, i) {
          var td = function (s) { return '<td style="padding:.38rem .4rem; border-bottom:1px solid rgba(26,42,58,.07); vertical-align:top;' + (i % 2 ? ' background:rgba(26,42,58,.028);' : '') + '">' + s + '</td>'; };
          html += '<tr>' + td(timeChip(r.act) + '<strong>' + esc(r.name) + '</strong>' + (r.act ? '<div style="margin-top:.15rem;">' + button(r.act) + '</div>' : '')) +
            r.cells.map(function (c) { return td(cell(c)); }).join('') + '</tr>';
        });
        html += '</tbody></table></div>';
      }
      if (g.note) html += '<p style="margin:.3rem 0 0; font-size:.8rem; color:var(--text-light);">' + esc(g.note) + '</p>';
      html += '</div></details>';
    }
    v.groups.forEach(oneGroup);
    if (!shown && !v.lead) html += '<p style="margin:0; font-size:.9rem; color:var(--text-light);">' + esc(T.evNone) + '</p>';
    el.events.innerHTML = html;
    function eachIn(sel, fn) { Array.prototype.forEach.call(el.events.querySelectorAll(sel), fn); }
    eachIn('details[data-title]', function (d) {
      d.addEventListener('toggle', function () { state.evOpen[d.getAttribute('data-title')] = d.open; });
    });
    eachIn('button[data-ev]', function (b) {
      b.addEventListener('click', function () {
        var a = acts[+b.getAttribute('data-ev')];
        if (a.key != null && a.key !== state.key) { el.date.value = dateOfKey(a.key); update(); } /* an eclipse on another night */
        /* timeline items of sun and moon only set the time; the acts carry true altitudes, the map draws apparent ones */
        if (a.az != null) aimSkyMap(a.az, a.alt != null ? A.refract(a.alt) : a.alt);
        if (a.info) sky.setInfo(a.info, true); /* e.g. a double star's card under the map; this ends any other selection */
        state.evTarget = a.target || null; /* a fixed point such as a double star, ringed in red on the map */
        setPlanetTime(a.t, true);
        el.smMap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Deep-sky top list                                                  *
   * ------------------------------------------------------------------ */
  var GROUP = { Gx: 'galaxies', EN: 'nebulae', RN: 'nebulae', DN: 'nebulae', PN: 'nebulae', SNR: 'nebulae', GC: 'clusters', OC: 'clusters', St: 'stars', DS: 'stars', Ast: 'stars' };
  /* how much a bright moon hurts: faint diffuse light most, star clusters least */
  var MOON_SENS = { Gx: 1, RN: 1, DN: 1, EN: 0.8, SNR: 0.8, PN: 0.5, GC: 0.4, OC: 0.3 };
  /* imaging with the rig: emission nebulae, supernova remnants and planetary nebulae go through 4.5 nm Hα, OIII and SII filters,
     which the moon hardly touches; galaxies, reflection and dark nebulae and clusters need broadband and suffer as for the eye */
  var MOON_SENS_RIG = { Gx: 1, RN: 1, DN: 1, EN: 0.25, SNR: 0.3, PN: 0.3, GC: 0.4, OC: 0.3 };
  /* the eye without filters: faint glowing gas and dust are harder than their magnitude suggests */
  var EYE = { Gx: 1, PN: 1, GC: 1, OC: 1, EN: 0.85, RN: 0.8, SNR: 0.7, DN: 0.4 };
  /* near a city the sky background swallows faint diffuse objects first */
  var URBAN = { Gx: 0.55, RN: 0.55, DN: 0.55, SNR: 0.55, EN: 0.75, PN: 1, GC: 1, OC: 1 };

  /* astronomical darkness, or nautical darkness (sun below −12°) where there is none */
  function listWindow() {
    var dk = state.dark;
    if (dk.from != null) return { from: dk.from, to: dk.to, astro: true };
    var iv = A.belowInterval(function (s) { return A.sunAltitude(s * 1000, state.lat, state.lon); }, dk.evening, dk.next, 60, -12);
    return iv ? { from: iv[0], to: iv[1], astro: false } : null;
  }

  /* the further catalogues' candidates for the imaging list (SvSkyMap.imagingCandidate(): 3′ to 3°, galaxies to 12 mag …),
     shaped like catalogue entries once data/ngc.json is here; id ngc:<row> as map, search and card use it */
  var extraBounds = null;
  function prepareExtraCands() {
    var M = window.SvSkyMap, rows = state.ngcRaw;
    if (!rows || state.extraCands) return;
    extraBounds = extraBounds || M.boundsB1875(SKY.bounds);
    state.extraCands = [];
    rows.forEach(function (r0, i) {
      if (!M.imagingCandidate(r0)) return;
      var wl = M.ngcWikiLink(LANG, r0);
      state.extraCands.push({ id: 'ngc:' + i, label: r0[0] + (r0[8] ? ' · ' + r0[8] : ''), name: r0[0], ra: r0[1], dec: r0[2], t: r0[3], s: r0[4],
        q: r0[4] && r0[5] ? r0[5] / r0[4] : null, pa: r0[6], m: r0[7], c: M.constellationAt(extraBounds, r0[1], r0[2]) || '', aka: r0[9] || null,
        wiki: wl.url, wikiLang: wl.lang, thumb: M.ngcThumbL(r0[0]), extra: true });
    });
  }

  function computeObjects() {
    var win = listWindow();
    if (!win) return null;
    var lat = state.lat, lon = state.lon, step = 600, samples = [];
    for (var t = win.from; t <= win.to; t += step) {
      var ms = t * 1000, mc = A.moonCoords(A.toDays(ms));
      samples.push({ t: t, moonAlt: A.moonAltitude(ms, lat, lon), moonRa: mc.ra, moonDec: mc.dec, illum: A.moonIllumination(ms).fraction });
    }
    var midMs = (win.from + win.to) / 2 * 1000, darkHours = (win.to - win.from) / 3600;
    var list = CATALOG.concat(state.listExtra && state.extraCands ? state.extraCands : []).map(function (o) {
      var pc = A.precessJ2000(o.ra, o.dec, midMs), best = null, hours30 = 0, photo = 0;
      samples.forEach(function (s, i) {
        var alt = A.horizontalOf(pc.ra, pc.dec, s.t * 1000, lat, lon).alt;
        var sep = Math.acos(clamp(Math.sin(pc.dec) * Math.sin(s.moonDec) + Math.cos(pc.dec) * Math.cos(s.moonDec) * Math.cos(pc.ra - s.moonRa), -1, 1)) / RAD;
        /* the moon hurts when it is up, bright and close: fully within 10°, not at all beyond 90° */
        var moonPen = s.moonAlt > 0 ? s.illum * clamp(1 - (sep - 10) / 80, 0, 1) : 0;
        var dt = i < samples.length - 1 ? step / 3600 : 0;
        if (alt >= 30) hours30 += dt;
        /* the higher the better: nothing below 20°, full weight from 60°, where little air lies in between */
        photo += dt * clamp((alt - 20) / 40, 0, 1) * (1 - 0.85 * moonPen * MOON_SENS_RIG[o.t]);
        if (!best || alt > best.alt) best = { t: s.t, alt: alt, sep: sep, moonPen: moonPen, moonAlt: s.moonAlt, illum: s.illum };
      });
      var sky = state.sky === 'urban' ? URBAN[o.t] : 1;
      /* imaging with the rig (SvSkyMap.RIG): the moon-weighted share of the dark hours spent high up, times how well the object
         fills the 1.69° field (rigFraming(): tiny objects and mosaics rated down) */
      var sizeF = window.SvSkyMap.rigFraming(o.s);
      /* and how bright it is: full to 7 mag, half at 12 mag; 0.7 where no magnitude is known (Sharpless regions, many nebulae),
         so that a faint region without data does not outrank a showpiece of the same altitude */
      var brightF = o.m != null ? clamp(0.4 + 0.6 * (13 - o.m) / 6, 0.4, 1) : 0.7;
      var photoScore = clamp(photo / Math.max(darkHours, 1), 0, 1) * sky * sizeF * brightF;
      /* the eye: total brightness, surface brightness (magnitude per square arcminute), altitude and moon.
         A large galaxy counts with at most 30′, as the eye takes in its bright core rather than the faint halo;
         open clusters get no surface-brightness term, their light sits in single stars. */
      var size = clamp(o.s, 0.2, o.t === 'Gx' ? 30 : 180), sb = o.m + 2.5 * Math.log(size * size * (o.q || 1) * Math.PI / 4) / Math.LN10; /* an ellipse: π/4 · major · minor */
      var sbF = o.t === 'OC' ? 1 : clamp((16.5 - sb) / 4, 0.2, 1);
      var visualScore = Math.pow(clamp((13 - o.m) / 10, 0.05, 1), 0.6) * sbF * EYE[o.t] *
        clamp((best.alt - 10) / 50, 0, 1) * (1 - 0.9 * best.moonPen * MOON_SENS[o.t]) * sky;
      return { o: o, best: best, hours30: hours30, photo: photoScore, visual: o.extra ? 0 : visualScore }; /* the further catalogues join the imaging list only */
    }).filter(function (x) { return x.best && x.best.alt >= 20; });
    return { win: win, list: list };
  }

  function renderList() {
    state.listShown = 8; /* a new night starts short again */
    state.listRes = computeObjects();
    drawList();
  }

  function drawList() {
    var res = state.listRes, off = state.off, mode = state.mode, H = T.head, dbls = state.dblItems || [];
    if (!res) { el.listSub.textContent = ''; el.list.innerHTML = '<p style="margin:.5rem 0 0;">' + esc(T.noDarkList) + '</p>'; return; }
    /* the objects of this rating: the further catalogues' candidates only when rated for imaging */
    var pool = res.list.filter(function (x) { return mode === 'photo' || !x.o.extra; });
    if (el.listExtra) {
      el.listExtra.hidden = mode !== 'photo';
      el.listExtra.setAttribute('aria-pressed', String(!!state.listExtra));
      var extraCount = el.listExtra.querySelector('.op-count');
      if (extraCount) extraCount.textContent = state.listExtra && state.extraCands ? pool.filter(function (x) { return x.o.extra; }).length : '';
    }
    /* the filter chips: pressed state and how many of this night's objects each kind has */
    if (el.filter) Array.prototype.forEach.call(el.filter.querySelectorAll('[data-filter]'), function (b) {
      var f = b.getAttribute('data-filter'), c = b.querySelector('.op-count');
      b.setAttribute('aria-pressed', String(f === state.filter));
      if (c) c.textContent = f === 'all' ? pool.length + (mode === 'visual' ? dbls.length : 0) : f === 'doubles' ? dbls.length : pool.filter(function (x) { return GROUP[x.o.t] === f; }).length;
    });
    /* every object of the night that the filter keeps, ranked: the chip counts, the picked object and "show more" all refer
       to this same list (a cap of 15 once hid a pick chosen on the map or in the search, and the chips counted objects
       the list could not reach) */
    /* the double stars join "all" when rated for the eye and have their own chip in both modes */
    var items = (state.filter === 'doubles' ? dbls.slice() : pool.filter(function (x) { return state.filter === 'all' || GROUP[x.o.t] === state.filter; })
      .concat(state.filter === 'all' && mode === 'visual' ? dbls : []))
      .sort(function (a, b) { return b[mode] - a[mode] || b.visual - a.visual; });
    el.listSub.textContent = (mode === 'photo' ? T.listPhoto : T.listVisual).replace('{n}', pool.length) + (mode === 'photo' && state.listExtra && !state.extraCands ? T.listExtraLoading : '') + (res.win.astro ? '' : T.nautical) + (state.sky === 'urban' ? T.urban : '');
    if (!items.length) { el.list.innerHTML = '<p style="margin:.5rem 0 0;">' + esc(state.filter === 'doubles' ? T.evNoDoubles : T.none) + '</p>'; return; }
    /* the first eight and, when the pick ranks lower, that one row with its own rank; "show more" adds forty at a time
       (state.listShown, not stored). Opening the list down to the pick made it hundreds of rows long once the further
       catalogues joined, and rendering every row draws its altitude chart. */
    var all = items, total = all.length, pickAt = -1, LIST_SHORT = 8;
    all.forEach(function (x, i) { x.rank = i + 1; if (isPicked(x)) pickAt = i; });
    var shown = Math.min(total, Math.max(LIST_SHORT, state.listShown || LIST_SHORT));
    items = all.slice(0, shown).concat(pickAt >= shown ? [all[pickAt]] : []);
    function name(o) { return o.label || o.id + (o[LANG] ? ' · ' + o[LANG] : ''); }
    /* a deep-sky object is picked through state.target, a double star through its open card */
    function isPicked(x) { return x.dbl ? !!(state.smInfo && state.smInfo.kind === 'double' && state.smInfo.id === x.dbl.info.id) : x.o.id === state.target; }
    /* a double star has no survey thumbnail: two stars on a dark ground instead (css/style.css .op-dbl-thumb) */
    function dblThumb(px, fill) { return '<span class="op-dbl-thumb" aria-hidden="true"' + (fill ? '' : ' style="width:' + px + 'px; height:' + px + 'px;"') + '><i></i><i></i></span>'; }
    function metaText(x) {
      return x.dbl ? T.types.DS + ' · ' + consName(x.o.c) + ' · ' + x.dbl.mags + ' · ' + x.dbl.sepPa + ' · ' + x.dbl.aperture
        : T.types[x.o.t] + ' · ' + consName(x.o.c) + ' · ' + sizeText(x.o.s) + ' · ' + (x.o.m != null ? num(x.o.m, 1) + ' mag' : '–');
    }
    /* thumbnail from astro-tools/img/dso/ (astro-tools/tools/dso-thumbnails.js) and the Wikipedia article in the page's language */
    function thumb(o, px) {
      if (o.t === 'DS') return dblThumb(px);
      var field = clamp(o.s * 1.8, 12, 300); /* as cut by tools/dso-thumbnails.js */
      var caption = name(o) + ' · ' + T.imgField.replace('{f}', field < 60 ? num(field) + '′' : num(field / 60, 1) + '°');
      return '<img src="' + (o.thumb || 'img/dso/' + o.id.toLowerCase().replace(/\s+/g, '') + '.jpg') + '" width="' + px + '" height="' + px + '" loading="lazy" alt="' + esc(T.imgAlt.replace('{id}', o.name || o.id)) + '" data-caption="' + esc(caption) +
        '" style="display:block; flex:none; width:' + px + 'px; height:' + px + 'px; border-radius:6px; background:#10151c;">';
    }
    /* the catalogue's article title, or for a double star the prepared search link (o.wiki) */
    function wikiLink(o) {
      var title = LANG === 'de' ? o.wde : o.wen, href = title ? window.SvSkyMap.wikiUrl(LANG, title) : o.wiki;
      return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener" style="font-size:.78rem; font-weight:400; white-space:nowrap;">Wikipedia' + (o.wikiLang && o.wikiLang !== LANG ? ' (' + o.wikiLang.toUpperCase() + ')' : '') + '&nbsp;&#8599;</a>' : '';
    }
    function chartCanvas(x, wide) {
      var win = state.plWin, flip = win && transitIn(win, A.precessJ2000(x.o.ra, x.o.dec, (win.start + win.end) / 2 * 1000));
      var aria = T.chartAria.replace('{id}', name(x.o)).replace('{a}', num(x.best.alt)).replace('{t}', hhmm(x.best.t, off)) + (flip != null && flip !== false ? ', ' + T.chartFlip.replace('{t}', hhmm(flip, off)) : '');
      return '<canvas data-chart="' + esc(x.o.id) + '" role="img" aria-label="' + esc(aria) +
        '" style="display:block; width:' + (wide ? '100%' : '118px') + '; height:' + (wide ? '56px' : '40px') + '; border-radius:4px;' + (wide ? ' margin:.55rem 0 0;' : '') + '"></canvas>';
    }
    /* filled for the picked object, so that list and the chart under the star map point at each other */
    function mapButton(x) {
      var on = isPicked(x);
      return '<button type="button" class="op-show" data-show="' + esc(x.o.id) + '" aria-pressed="' + on + '">' + esc(on ? T.showMapOn : T.showMap) + '</button>';
    }
    function sizeText(s) { return s < 1 ? num(s * 60) + '″' : num(s) + '′'; }
    /* the same object in other catalogues (aka in dso-catalog.js, written by tools/ngc-data.js), the first four: = NGC 1976 · Sh2-281 */
    function akaText(o) { return o.aka && o.aka.length ? '= ' + o.aka.slice(0, 4).join(' · ') : ''; }
    function moonText(b) { return b.moonAlt > 0 ? T.moonAt.replace('{d}', num(b.sep)).replace('{p}', Math.round(b.illum * 100)) : T.moonDown; }
    var html;
    if (state.listView === 'gallery') {
      /* gallery (the view switch, state.listView): a tile per object with the large thumbnail, css/style.css .op-gal */
      html = '<div class="op-gal">' + items.map(function (x, i) {
        var picked = isPicked(x), b = x.best;
        return '<div class="op-gal-card' + (picked ? ' op-gal-picked' : '') + '" data-obj="' + esc(x.o.id) + '">' +
          '<div class="op-gal-img">' + (x.dbl ? dblThumb(0, true) : '<img src="' + (x.o.thumb || 'img/dso/' + x.o.id.toLowerCase().replace(/\s+/g, '') + '.jpg') + '" width="320" height="320" loading="lazy" alt="' + esc(T.imgAlt.replace('{id}', x.o.name || x.o.id)) + '">') + '<span class="op-gal-rank">' + x.rank + '</span></div>' +
          '<div class="op-gal-body"><div class="op-gal-name">' + esc(name(x.o)) + '</div>' +
          (akaText(x.o) ? '<div class="op-gal-meta">' + esc(akaText(x.o)) + '</div>' : '') +
          '<div class="op-gal-meta">' + esc(metaText(x)) + '</div>' +
          '<div class="op-gal-meta">' + esc(T.cardBest.replace('{t}', hhmm(b.t, off)).replace('{a}', num(b.alt)) + (mode === 'photo' ? ' · ' + T.cardHours.replace('{h}', num(x.hours30, 1)) : '')) + '<br>' + esc('☾ ' + moonText(b)) + '</div>' +
          chartCanvas(x, true) + '<div class="op-gal-actions">' + mapButton(x) + wikiLink(x.o) + '</div></div></div>';
      }).join('') + '</div>';
    } else if (el.list.clientWidth < 640) {
      /* narrow screens: one card per object */
      html = items.map(function (x, i) {
        var picked = isPicked(x), b = x.best;
        return '<div data-obj="' + esc(x.o.id) + '" style="margin:.5rem 0 0; padding:.6rem .75rem; border-radius:var(--radius); border:1px solid ' +
          (picked ? 'rgba(52,152,219,.55); background:rgba(52,152,219,.10);' : 'rgba(26,42,58,.12);') + '">' +
          '<div style="display:flex; gap:.7rem; align-items:flex-start;">' + thumb(x.o, 64) + '<div style="min-width:0; flex:1;">' +
          '<div style="font-weight:600; color:var(--primary);">' + x.rank + '. ' + esc(name(x.o)) + '</div>' +
          (akaText(x.o) ? '<div style="font-size:.78rem; color:var(--text-light);">' + esc(akaText(x.o)) + '</div>' : '') +
          '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:.25rem .6rem; margin:.1rem 0 .15rem;">' + wikiLink(x.o) + mapButton(x) + '</div>' +
          '<div style="font-size:.86rem; line-height:1.6;">' + esc(metaText(x)) + '<br>' +
          esc(T.cardBest.replace('{t}', hhmm(b.t, off)).replace('{a}', num(b.alt)) + (mode === 'photo' ? ' · ' + T.cardHours.replace('{h}', num(x.hours30, 1)) : '')) + '<br>' +
          esc(H.moon + ': ' + moonText(b)) + '</div></div></div>' + chartCanvas(x, true) + '</div>';
      }).join('');
    } else {
      /* the header row sticks under the site header and the section navigation (--op-head, --op-nav-h) */
      var th = function (s, right) { return '<th style="position:sticky; top:calc(var(--op-head, 64px) + var(--op-nav-h, 48px)); z-index:2; background:#eff1f3; text-align:' + (right ? 'right' : 'left') + '; padding:.45rem .4rem; font-size:.66rem; text-transform:uppercase; letter-spacing:.03em; color:var(--primary); border-bottom:1px solid rgba(26,42,58,.18); vertical-align:bottom;">' + esc(s) + '</th>'; };
      /* clip, not scroll: an overflow container would stop the sticky header (the table only shows from 640 px, cards below) */
      html = '<div style="border:1px solid rgba(26,42,58,.12); border-radius:var(--radius); overflow:hidden; overflow:clip;"><table style="width:100%; border-collapse:collapse; font-size:.83rem;"><thead><tr>' +
        th(H.rank) + th(H.obj) + th(H.type) + th(H.chart) + th(H.best) + th(mode === 'photo' ? H.hours : H.mag, true) + '</tr></thead><tbody>';
      items.forEach(function (x, i) {
        var picked = isPicked(x), b = x.best;
        var td = function (s, right, raw) { return '<td style="padding:.38rem .4rem; border-bottom:1px solid rgba(26,42,58,.07);' + (right ? ' text-align:right;' : '') + (picked ? ' background:rgba(52,152,219,.14);' : i % 2 ? ' background:rgba(26,42,58,.028);' : '') + '">' + (raw ? s : esc(s)) + '</td>'; };
        html += '<tr data-obj="' + esc(x.o.id) + '">' + td(String(x.rank)) + td('<div style="display:flex; gap:.45rem; align-items:center;">' + thumb(x.o, 40) + '<div><strong>' + esc(x.o.label || x.o.id) + '</strong>' + (x.o[LANG] ? ' · ' + esc(x.o[LANG]) : '') + (akaText(x.o) ? '<br><span style="font-size:.76rem; color:var(--text-light);">' + esc(akaText(x.o)) + '</span>' : '') + (x.dbl ? '<br><span style="font-size:.76rem; color:var(--text-light);">' + esc(x.dbl.disc) + '</span>' : '') + '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:.2rem .5rem; margin-top:.15rem;">' + wikiLink(x.o) + mapButton(x) + '</div></div></div>', false, true) +
          td(esc(T.types[x.o.t]) + '<br><span style="color:var(--text-light);">' + esc(x.dbl ? consName(x.o.c) + ' · ' + x.dbl.sepPa + ' · ' + x.dbl.aperture : consName(x.o.c) + ' · ' + sizeText(x.o.s)) + '</span>', false, true) + td(chartCanvas(x, false), false, true) +
          td(hhmm(b.t, off) + ' · ' + num(b.alt) + '°<br><span style="color:var(--text-light);">' + esc('☾ ' + moonText(b)) + '</span>', false, true) +
          td(mode === 'photo' ? num(x.hours30, 1) + ' h' : x.dbl ? x.dbl.mags : num(x.o.m, 1) + ' mag', true) + '</tr>';
      });
      html += '</tbody></table></div>';
    }
    if (items.some(function (x) { return x.dbl; })) html += '<p style="margin:.4rem 0 0; font-size:.78rem; line-height:1.5; color:var(--text-light);">' + esc(T.evDoublesNote) + '</p>';
    if (total > LIST_SHORT)
      html += '<div style="margin:.6rem 0 0; text-align:center;"><button type="button" class="op-tb-btn" data-list-more>' + esc(shown >= total ? T.listLess : T.listMore.replace('{n}', Math.min(40, total - shown))) + '</button></div>';
    el.list.innerHTML = html;
    var moreBtn = el.list.querySelector('[data-list-more]');
    if (moreBtn) moreBtn.addEventListener('click', function () { state.listShown = shown >= total ? LIST_SHORT : shown + 40; drawList(); });
    /* only the button shows an object on the star map; rows and cards themselves are not clickable */
    Array.prototype.forEach.call(el.list.querySelectorAll('button[data-show]'), function (b) {
      b.addEventListener('click', function () { showInMap(b.getAttribute('data-show')); });
    });
    hidePreview();
    Array.prototype.forEach.call(el.list.querySelectorAll('img[data-caption]'), function (img) {
      img.addEventListener('mouseenter', function () {
        showPreview(img, function (slot) {
          slot.innerHTML = '<img src="' + img.src + '" width="240" height="240" alt="" style="display:block; width:240px; height:240px; border-radius:6px;">';
        }, img.getAttribute('data-caption'), 240);
      });
      img.addEventListener('mouseleave', hidePreview);
    });
    Array.prototype.forEach.call(el.list.querySelectorAll('canvas[data-chart]'), function (cv) {
      var x = items.filter(function (y) { return y.o.id === cv.getAttribute('data-chart'); })[0];
      drawAltChart(cv, x, false);
      cv.addEventListener('mouseenter', function () {
        showPreview(cv, function (slot) {
          var big = document.createElement('canvas');
          big.style.cssText = 'display:block; width:520px; height:220px; border-radius:6px;';
          slot.appendChild(big);
          drawAltChart(big, x, true);
        }, name(x.o) + ' · ' + T.chartCap, 520);
      });
      cv.addEventListener('mouseleave', hidePreview);
    });
  }

  /* Hovering over a thumbnail or an altitude chart shows a larger version next to the list, with a caption: the image
     at 240 px (from the 320 px file, sharp on high-density screens), the chart at 520 px with axes and labels. Only with a
     mouse: on touch screens a preview would be left standing after a tap. */
  var preview = null;
  function showPreview(anchor, fill, caption, width) {
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (!preview) {
      preview = document.createElement('div');
      preview.setAttribute('aria-hidden', 'true');
      preview.style.cssText = 'position:fixed; z-index:60; pointer-events:none; padding:6px; background:#10151c; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.45); opacity:0; transform:scale(.9); transform-origin:left center; transition:opacity .12s ease, transform .12s ease;';
      preview.innerHTML = '<div></div><div style="margin:.35rem .1rem .1rem; font-size:.76rem; line-height:1.35; color:#e4e9ef;"></div>';
      document.body.appendChild(preview);
    }
    preview.firstChild.innerHTML = '';
    preview.lastChild.style.width = width + 'px';
    preview.lastChild.textContent = caption;
    fill(preview.firstChild);
    var r = anchor.getBoundingClientRect(), w = preview.offsetWidth, h = preview.offsetHeight, vw = window.innerWidth;
    var right = r.right + 12 + w <= vw, left = right ? r.right + 12 : r.left - 12 - w;
    if (left < 8) left = clamp(r.left + r.width / 2 - w / 2, 8, vw - w - 8); /* no room beside it: centred on it */
    preview.style.left = left + 'px';
    preview.style.top = clamp(r.top + r.height / 2 - h / 2, 8, window.innerHeight - h - 8) + 'px';
    preview.style.transformOrigin = right ? 'left center' : 'right center';
    preview.style.opacity = '1';
    preview.style.transform = 'scale(1)';
  }
  function hidePreview() {
    if (!preview) return;
    preview.style.opacity = '0';
    preview.style.transform = 'scale(.9)';
  }
  window.addEventListener('scroll', hidePreview, { passive: true });

  /* ------------------------------------------------------------------ *
   * Altitude chart per listed object                                   *
   * ------------------------------------------------------------------ */
  /* sky colour by the sun's altitude: day, twilight in blues, and green once it is astronomically dark */
  var CHART_SKY = [[6, [166, 140, 69]], [0, [93, 128, 168]], [-6, [62, 92, 130]], [-12, [31, 51, 80]], [-18, [14, 24, 36]]];
  function chartSky(alt) {
    if (alt <= -18) return '#0b3a2a';
    if (alt >= 6) return 'rgb(166,140,69)';
    for (var i = 0; i < CHART_SKY.length - 1; i++) {
      var a = CHART_SKY[i], b = CHART_SKY[i + 1];
      if (alt <= a[0] && alt >= b[0]) {
        var f = (a[0] - alt) / (a[0] - b[0]);
        return 'rgb(' + [0, 1, 2].map(function (k) { return Math.round(a[1][k] + (b[1][k] - a[1][k]) * f); }).join(',') + ')';
      }
    }
    return '#0b3a2a';
  }

  /* The meridian transit (upper culmination, hour angle 0) inside the chart window, or null: where a German equatorial
     mount has to flip. From the same sidereal time as horizontalOf(); pc is the object's position of date. */
  function transitIn(win, pc) {
    var lst = 280.46061837 + 360.98564736629 * A.toDays(win.start * 1000) + state.lon;
    var hourAngle = ((lst - pc.ra / RAD) % 360 + 360) % 360;
    var t = win.start + ((360 - hourAngle) % 360) / (360.98564736629 / 86400);
    return t <= win.end ? t : null;
  }

  /* where civil, nautical and astronomical twilight begin and end inside the chart window, found once per night */
  function chartTwilight(win) {
    if (!win.twilight) {
      win.twilight = [];
      [-6, -12, -18].forEach(function (level, k) {
        A.crossings(function (sec) { return A.sunAltitude(sec * 1000, state.lat, state.lon); }, win.start, win.end, 120, level)
          .forEach(function (c) { win.twilight.push({ t: c.t, k: k }); });
      });
    }
    return win.twilight;
  }

  /* The object's altitude over the night's window (an hour before sunset to an hour after sunrise, 10-minute
     samples with sun and moon): sky colour by twilight, the moon as a red area, 30° dashed, a dot at the best time.
     The large version adds axes, twilight letters, the slider's time and the moon's distance at the best time. */
  function drawAltChart(cv, x, big, margins) {
    var win = state.plWin, off = state.off;
    if (!win || !win.samples.length || !x) return;
    var W = cv.clientWidth || (big ? 520 : 140), H = cv.clientHeight || (big ? 220 : 44);
    var dpr = window.devicePixelRatio || 1, ctx = cv.getContext('2d');
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var L = big ? (margins ? margins.L : 34) : 0, R = big ? (margins ? margins.R : 10) : 0, top = big ? 10 : 0, bottom = big ? (pcDiffers(win) ? 34 : 22) : 0, pw = W - L - R, ph = H - top - bottom, span = win.end - win.start;
    var rows = win.samples, step = pw / Math.max(rows.length - 1, 1);
    function X(t) { return L + (t - win.start) / span * pw; }
    function Y(alt) { return top + ph - clamp(alt, 0, 90) / 90 * ph; }
    ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.rect(L, top, pw, ph); ctx.clip();
    rows.forEach(function (row) { ctx.fillStyle = chartSky(row.sun.alt); ctx.fillRect(X(row.t) - step / 2, top, step + 0.8, ph); });
    /* the moon, stronger the more of it is lit */
    var illum = rows[Math.floor(rows.length / 2)].moon.illum;
    ctx.beginPath(); ctx.moveTo(X(rows[0].t), Y(0));
    rows.forEach(function (row) { ctx.lineTo(X(row.t), Y(row.moon.alt)); });
    ctx.lineTo(X(rows[rows.length - 1].t), Y(0)); ctx.closePath();
    ctx.fillStyle = 'rgba(229,72,77,' + (0.18 + 0.4 * illum).toFixed(2) + ')'; ctx.fill();
    ctx.lineWidth = 1;
    if (big) {
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.beginPath(); ctx.moveTo(L, Math.round(Y(60)) + 0.5); ctx.lineTo(L + pw, Math.round(Y(60)) + 0.5); ctx.stroke();
      for (var hsB = localHours(win.start, win.end, off), hiB = 0; hiB < hsB.length; hiB++) {
        var hl = hsB[hiB];
        if (localDate(hl, off).getUTCHours() % 2) continue;
        ctx.beginPath(); ctx.moveTo(Math.round(X(hl)) + 0.5, top); ctx.lineTo(Math.round(X(hl)) + 0.5, top + ph); ctx.stroke();
      }
      if (state.dark && state.dark.from != null) { /* the astronomically dark window, dotted */
        ctx.strokeStyle = 'rgba(143,209,158,.75)'; ctx.setLineDash([2, 3]);
        [state.dark.from, state.dark.to].forEach(function (t) { ctx.beginPath(); ctx.moveTo(Math.round(X(t)) + 0.5, top); ctx.lineTo(Math.round(X(t)) + 0.5, top + ph); ctx.stroke(); });
        ctx.setLineDash([]);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(L, Math.round(Y(30)) + 0.5); ctx.lineTo(L + pw, Math.round(Y(30)) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    /* the object, precessed to the night */
    /* a fixed position (x.o, J2000) or, for moon and planets, an altitude function with the culmination worked out beforehand */
    var pc = x.o ? A.precessJ2000(x.o.ra, x.o.dec, (win.start + win.end) / 2 * 1000) : null, flip = pc ? transitIn(win, pc) : x.flip;
    if (flip != null) { /* the meridian flip, under the curve */
      ctx.strokeStyle = COL.meridian; ctx.lineWidth = big ? 1.5 : 1; ctx.setLineDash(big ? [5, 3] : [2, 2]);
      ctx.beginPath(); ctx.moveTo(Math.round(X(flip)) + 0.5, top); ctx.lineTo(Math.round(X(flip)) + 0.5, top + ph); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    rows.forEach(function (row, i) {
      var a = pc ? A.horizontalOf(pc.ra, pc.dec, row.t * 1000, state.lat, state.lon).alt : x.altAt(row.t);
      if (i) ctx.lineTo(X(row.t), Y(a)); else ctx.moveTo(X(row.t), Y(a));
    });
    ctx.strokeStyle = '#eef2f6'; ctx.lineWidth = big ? 2 : 1.4; ctx.stroke();
    if (x.best) { ctx.beginPath(); ctx.arc(X(x.best.t), Y(x.best.alt), big ? 4 : 2.6, 0, 2 * Math.PI); ctx.fillStyle = COL.target; ctx.fill(); }
    if (big) { ctx.fillStyle = COL.now; ctx.fillRect(Math.round(X(state.plT)), top, 1.5, ph); }
    ctx.restore();
    if (!big) return;
    ctx.font = '10px ' + FONT; ctx.textBaseline = 'middle'; ctx.fillStyle = COL.text;
    ctx.textAlign = 'right';
    [0, 30, 60, 90].forEach(function (a) { ctx.fillText(a + '°', L - 5, clamp(Y(a), top + 5, top + ph - 4)); });
    ctx.textAlign = 'center';
    var perHour = pw / (span / 3600), short = perHour < 20, every = perHour < 9 ? 4 : 2; /* narrow plots: "02" instead of "02:00" */
    for (var hsC = localHours(win.start, win.end, off), hiC = 0; hiC < hsC.length; hiC++) {
      var hh = hsC[hiC];
      var hr = localDate(hh, off).getUTCHours();
      if (!(hr % every)) ctx.fillText(pad(hr) + (short ? '' : ':00'), short ? X(hh) : clamp(X(hh), L + 14, L + pw - 14), bottom > 22 ? H - 22 : H - 10); /* short labels stay on their hour, as on the bars */
    }
    if (bottom > 22) { /* the visitor's device time as a second, lighter hour row */
      ctx.fillStyle = 'rgba(154,167,182,.7)';
      for (var hsD = localHours(win.start, win.end, pcOff), hiD = 0; hiD < hsD.length; hiD++) {
        var hrD = localDate(hsD[hiD], pcOff).getUTCHours();
        if (!(hrD % every)) ctx.fillText(pad(hrD) + (short ? '' : ':00'), short ? X(hsD[hiD]) : clamp(X(hsD[hiD]), L + 14, L + pw - 14), H - 9);
      }
      ctx.fillStyle = COL.text;
    }
    ctx.font = '600 10px ' + FONT; ctx.fillStyle = 'rgba(228,233,239,.8)';
    if (!short) chartTwilight(win).forEach(function (c) { ctx.fillText(T.twiLetters[c.k], X(c.t), top + ph - 8); });
    var side = margins && R >= 60, wide = side && R >= 150;
    var moonInfo = x.best && x.best.sep != null; /* not for the moon itself */
    if (!wide && moonInfo) {
      ctx.textAlign = 'right'; ctx.fillStyle = '#f5c26b';
      ctx.fillText('☽ ' + num(x.best.sep) + '° · ' + Math.round(x.best.illum * 100) + ' %', L + pw - 6, top + 10);
    }
    /* the red line is the time set on the slider: a label beside it, on the left near the right edge */
    var nowX = X(state.plT), nowText = T.chartNow.replace('{t}', hhmm(state.plT, off));
    var tagW = ctx.measureText(nowText).width + 8, tagX = nowX + 2 + tagW > L + pw ? nowX - 1 - tagW : nowX + 2;
    ctx.fillStyle = COL.now; ctx.fillRect(tagX, top + 20, tagW, 14);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(nowText, tagX + 4, top + 27);
    if (flip != null) { /* its own label, below the slider's */
      var flipText = T.chartFlip.replace('{t}', hhmmLoc(flip, off)), flipW = ctx.measureText(flipText).width + 8, flipX = X(flip) + 2 + flipW > L + pw ? X(flip) - 1 - flipW : X(flip) + 2;
      ctx.fillStyle = COL.meridian; ctx.fillRect(flipX, top + 38, flipW, 14);
      ctx.fillStyle = '#10151c'; ctx.fillText(flipText, flipX + 4, top + 45);
    }
    if (side) { /* beside the plot, below the bars' value columns: altitude at the slider's time, highest altitude, the moon */
      var nowAlt = pc ? A.horizontalOf(pc.ra, pc.dec, state.plT * 1000, state.lat, state.lon).alt : x.altAt(state.plT);
      var items = [[T.barsNow, nowAlt > 0 ? num(nowAlt) + '°' : '–', '#e4e9ef'],
        [wide ? T.barsMax : T.barsMaxShort, x.best ? num(x.best.alt) + '°' + (wide ? ' · ' + hhmmLoc(x.best.t, off) : '') : '–', '#e4e9ef']];
      if (wide && moonInfo) items.push([T.chartMoon, num(x.best.sep) + '° · ' + Math.round(x.best.illum * 100) + ' %', '#f5c26b']);
      ctx.textAlign = 'left';
      items.forEach(function (it, i) {
        var y0 = top + 6 + i * 36;
        ctx.font = '10px ' + FONT; ctx.fillStyle = COL.text; ctx.fillText(it[0], L + pw + 12, y0);
        ctx.font = '600 13px ' + FONT; ctx.fillStyle = it[2]; ctx.fillText(it[1], L + pw + 12, y0 + 15);
      });
    }
    return { L: L, pw: pw };
  }

  /* The altitude chart in the info card under the star map (#op-sm-info-chart), for whatever the card shows: a listed
     object with its best time from the list, anything else with its highest point in darkness (from infoStatic() in
     sky-map.js). Its time axis matches the visibility bars' and the slider's, so the red time lines stand on one vertical
     (not in full screen, where the card lies over the map). Redrawn only when subject, time, night or width change. */
  var infoChartKey = '';
  function drawInfoChart(inf, d) {
    var cv = el.smInfoChart;
    if (!cv || !inf || !d || !d.chart || !state.plWin) return;
    if (state.infoTab === 'season') { drawSeason(inf, d); return; } /* only the visible tab: a hidden canvas measures 0 px */
    var listed = inf.kind === 'dso' && state.listRes && state.listRes.list.filter(function (y) { return y.o.id === inf.id; })[0];
    var x = { o: d.chart.fixed, altAt: d.chart.altAt, flip: d.chart.flip, best: listed ? listed.best : d.chart.best };
    var m = null, lay = state.plBarsLayout, rb = el.plBars.getBoundingClientRect(), rc = cv.getBoundingClientRect();
    if (!state.smFull && lay && rb.width && rc.width) {
      var l = rb.left + lay.LEFT - rc.left, r = rc.right - (rb.left + lay.LEFT + lay.pw);
      if (l >= 30 && r >= 10) m = { L: l, R: r };
    }
    var key = [inf.kind, inf.id || inf.idx, d.title, state.plT, state.plWin.start, state.lat, state.lon, state.zone, Math.round(rc.width), m ? Math.round(m.L) + ',' + Math.round(m.R) : '', x.best ? x.best.t : ''].join('|');
    if (key === infoChartKey) return;
    infoChartKey = key;
    cv.setAttribute('aria-label', T.chartAria.replace('{id}', d.title).replace('{a}', x.best ? num(x.best.alt) : '–').replace('{t}', x.best ? hhmm(x.best.t, state.off) : '–'));
    state.pickedLayout = drawAltChart(cv, x, true, m) || null;
    if (el.smInfoKey) el.smInfoKey.innerHTML = keyHtml([[chartSky(-10), 'box', T.kc.twilight], ['#0b3a2a', 'box', T.kc.dark], ['rgba(229,72,77,.55)', 'box', T.kc.moon], ['#eef2f6', 'line', T.kc.alt], [COL.now, 'line', T.kc.slider], [COL.meridian, 'dash', T.kc.flip], [COL.target, 'dot', T.kc.best]], pcDiffers(state.plWin) ? T.kc.pcRow : '');
  }

  /* "Show on star map" in the list and "Go to best time" in the card: selects the object (the card with its altitude
     chart opens under the star map, the list marks it), turns the map towards it at its best time and brings the map into
     view. The card's × or selecting something else ends it. */
  function showInMap(id) {
    if (String(id).indexOf('dbl:') === 0) { /* a double star of the list: its card and red ring, as the events did */
      var dx = (state.dblItems || []).filter(function (y) { return y.o.id === id; })[0];
      if (!dx) return;
      sky.setInfo(dx.dbl.info, true);
      state.evTarget = dx.dbl.target;
      aimSkyMap(dx.best.az, A.refract(dx.best.alt));
      setPlanetTime(dx.best.t, true);
      drawList();
      (el.smWrap || el.smMap).scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    var x = state.listRes && state.listRes.list.filter(function (y) { return y.o.id === id; })[0];
    if (!x) return;
    state.target = id;
    state.smInfo = { kind: 'dso', id: id };
    drawList();
    var pc = A.precessJ2000(x.o.ra, x.o.dec, x.best.t * 1000);
    var hz = A.horizontalOf(pc.ra, pc.dec, x.best.t * 1000, state.lat, state.lon);
    aimSkyMap(hz.az, A.refract(hz.alt)); /* the map draws apparent altitudes */
    setPlanetTime(x.best.t);
    (el.smWrap || el.smMap).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setMode(m) {
    state.mode = m;
    if (m === 'photo' && state.listExtra && loadNgcData) loadNgcData(); /* the imaging list takes the further catalogues */
    [[el.modePhoto, 'photo'], [el.modeVisual, 'visual']].forEach(function (p) {
      p[0].setAttribute('aria-pressed', p[1] === m);
    });
    if (state.listRes !== null && state.ready) drawList();
  }

  /* ------------------------------------------------------------------ *
   * Wiring                                                             *
   * ------------------------------------------------------------------ */
  /* Section navigation (#op-nav): it sticks under the site header, whose height goes into --op-head for its top and the
     headings' scroll margin (css/style.css); a click scrolls smoothly without touching the link, the section in view is
     marked with aria-current. A div with role navigation: the site's nav rules (the mobile menu) would restyle a <nav> */
  (function () {
    var nav = document.getElementById('op-nav'), header = document.querySelector('header');
    if (!nav) return;
    var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#op-sec-"]'));
    var secs = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    function headHeight() {
      document.documentElement.style.setProperty('--op-head', (header ? header.offsetHeight : 0) + 'px');
      document.documentElement.style.setProperty('--op-nav-h', nav.offsetHeight + 'px'); /* the list's sticky table header sits below it */
    }
    function mark() {
      var line = (header ? header.offsetHeight : 0) + nav.offsetHeight + 40, cur = -1;
      secs.forEach(function (sec, i) { if (sec && sec.getBoundingClientRect().top <= line) cur = i; });
      links.forEach(function (a, i) { if (i === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    }
    links.forEach(function (a, i) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (secs[i] && secs[i].id === 'op-sec-planets') setPlanetsOpen(true); /* a jump there opens the folded section */
        if (secs[i] && secs[i].id === 'op-sec-list') setListOpen(true);
        scrollBelowNav(secs[i]);
      });
    });
    /* place and night at the right of the navigation lead back to the location and date fields */
    if (el.navContext) el.navContext.addEventListener('click', function (e) {
      e.preventDefault();
      scrollBelowNav(el.night);
      setTimeout(function () { if (el.location.focus) el.location.focus({ preventScroll: true }); }, 450);
    });
    headHeight(); mark();
    window.addEventListener('resize', function () { headHeight(); mark(); });
    window.addEventListener('scroll', mark, { passive: true });
  })();

  /* "Moon & planets" (cards and visibility bars) starts folded. Folded means height 0 and hidden, not display: none, so
     the bars keep their width: the time slider and the card's altitude chart line their time axis up with them */
  function setPlanetsOpen(open) {
    if (!el.plToggle || !el.plBody) return;
    el.plToggle.setAttribute('aria-expanded', String(open));
    el.plBody.classList.toggle('op-collapsed', !open);
    if (open && state.ready) { drawPlanetBars(); renderPlanetCards(); }
  }
  if (el.plToggle) el.plToggle.addEventListener('click', function () { setPlanetsOpen(el.plToggle.getAttribute('aria-expanded') !== 'true'); });
  /* "The best objects of the night" can be folded too and starts open; unfolding redraws the list, which picks table or
     cards from its width (0 while folded) */
  function setListOpen(open) {
    if (!el.listToggle || !el.listBody) return;
    el.listToggle.setAttribute('aria-expanded', String(open));
    el.listBody.classList.toggle('op-collapsed', !open);
    if (open && state.ready && state.listRes !== undefined) drawList();
  }
  if (el.listToggle) el.listToggle.addEventListener('click', function () { setListOpen(el.listToggle.getAttribute('aria-expanded') !== 'true'); });

  /* "Moon and darkness" folds away its tiles and the night strip (the phase line stays); not stored */
  if (el.moonToggle && el.night) el.moonToggle.addEventListener('click', function () {
    var open = el.moonToggle.getAttribute('aria-expanded') !== 'true';
    el.moonToggle.setAttribute('aria-expanded', String(open));
    el.night.classList.toggle('op-night-collapsed', !open);
    if (open && state.ready) renderMoon(); /* the strip was measured at 0 px while hidden */
  });

  /* the list as table (cards on narrow screens) or as a gallery of tiles; not stored */
  state.listView = 'list';
  [[el.viewList, 'list'], [el.viewGallery, 'gallery']].forEach(function (p) {
    if (!p[0]) return;
    p[0].addEventListener('click', function () {
      state.listView = p[1];
      el.viewList.setAttribute('aria-pressed', String(p[1] === 'list'));
      el.viewGallery.setAttribute('aria-pressed', String(p[1] === 'gallery'));
      if (state.listRes !== null && state.ready) drawList();
    });
  });
  /* the card's two views, this night's altitude chart or the nights over weeks and months; only the visible one is drawn */
  state.infoTab = 'night';
  [[el.infoTabNight, 'night'], [el.infoTabSeason, 'season']].forEach(function (p) {
    if (!p[0]) return;
    p[0].addEventListener('click', function () {
      state.infoTab = p[1];
      el.infoTabNight.setAttribute('aria-selected', String(p[1] === 'night'));
      el.infoTabSeason.setAttribute('aria-selected', String(p[1] === 'season'));
      el.infoNight.hidden = p[1] !== 'night';
      el.infoSeason.hidden = p[1] !== 'season';
      infoChartKey = '';
      drawSkyMap();
    });
  });
  /* the star map's operating hint behind the "?" at its heading */
  if (el.smHelpBtn && el.smHelp) {
    el.smHelp.textContent = T.smHelp;
    el.smHelpBtn.addEventListener('click', function () {
      var open = el.smHelp.hidden;
      el.smHelp.hidden = !open;
      el.smHelpBtn.setAttribute('aria-expanded', String(open));
    });
  }

  el.location.addEventListener('change', applyPreset);
  el.tz.addEventListener('change', function () { state.tzChosen = true; update(); });
  [el.lat, el.lon].forEach(function (f) {
    f.addEventListener('change', function () { el.location.value = 'custom'; update(); });
  });
  el.date.addEventListener('change', update);
  el.prev.addEventListener('click', function () { stepNight(-1); });
  el.next.addEventListener('click', function () { stepNight(1); });
  if (el.calToggle) {
    el.calToggle.addEventListener('click', function () { setCalOpen(el.cal.hidden); });
    document.addEventListener('pointerdown', function (e) {
      if (!el.cal.hidden && !el.cal.contains(e.target) && !el.calToggle.contains(e.target)) setCalOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.cal.hidden) { setCalOpen(false); el.calToggle.focus(); }
    });
    el.calPrev.addEventListener('click', function () { stepCalMonth(-1); });
    el.calNext.addEventListener('click', function () { stepCalMonth(1); });
    if (el.calToday) el.calToday.addEventListener('click', function () {
      /* today's date at the location, the cell with the orange frame: the night from this evening. (The page's own start,
         defaultKey(), keeps the night still running before sunrise; here "today" means the day the calendar marks.) */
      var nowSec = Date.now() / 1000;
      setCalOpen(false);
      el.date.value = dateOfKey(Math.floor((nowSec + state.off(nowSec)) / 86400));
      update();
      el.date.focus();
    });
  }
  el.smTime.addEventListener('input', function () { setPlanetTime(+el.smTime.value); });
  /* the slider moves in minutes, so that its thumb can match an event's exact minute; the keys still step five minutes */
  el.smTime.addEventListener('keydown', function (e) {
    var k = { ArrowLeft: -300, ArrowDown: -300, ArrowRight: 300, ArrowUp: 300, PageDown: -3600, PageUp: 3600 }[e.key];
    if (!k || !state.plWin) return;
    e.preventDefault();
    setPlanetTime(state.plT + k);
  });
  /* the star map (astro-tools/js/sky-map.js), created here, where everything it shares exists */
  var sky = window.SvSkyMap.create({ consName: consName, esc: esc, BODIES: BODIES, BODY_COL: BODY_COL, CATALOG: CATALOG, COL: COL, el: el,
    drawInfoChart: drawInfoChart, FONT: FONT, GROUP: GROUP, hhmm: hhmm, hhmmLoc: hhmmLoc, pcTime: pcTime, LANG: LANG, num: num, onPickChange: drawList, onNgcLoad: function () { prepareExtraCands(); if (state.ready) renderList(); }, pad: pad, listWindow: listWindow, showInMap: showInMap, SKY: SKY,
    setTime: setPlanetTime, state: state, syncUrl: syncUrl, T: T, TWI: TWI });
  aimSkyMap = sky.aimSkyMap;
  drawSkyMap = sky.drawSkyMap;
  PHOTO_AUTO = sky.PHOTO_AUTO;
  PHOTO_FOV = sky.PHOTO_FOV;
  prepareSky = sky.prepareSky;
  skyTouch = sky.skyTouch;
  var loadNgcData = sky.loadNgc;
  el.smNames.addEventListener('change', function () { state.smNames = el.smNames.checked; drawSkyMap(); });
  el.smLang.addEventListener('change', function () {
    state.names = el.smLang.value === 'latin' ? 'latin' : 'local';
    syncUrl();
    if (!state.ready) return;
    prepareSky(); /* the names are taken over there */
    renderEvents(); /* star names in the encounters; redraws the star map */
    drawList();
  });
  function pickedChartTime(e) {
    var win = state.plWin, r = el.smInfoChart.getBoundingClientRect();
    if (!win || !r.width) return;
    var P = state.pickedLayout || { L: 34, pw: r.width - 44 };
    setPlanetTime(win.start + clamp((e.clientX - r.left - P.L) / P.pw, 0, 1) * (win.end - win.start));
  }
  if (el.smSeasonChart) {
    el.smSeasonChart.addEventListener('pointermove', function (e) {
      var i = seasonIndex(e), tip = el.smSeasonTip;
      if (i < 0) { tip.hidden = true; return; }
      var n = season.nights[i], s = n.s, hrs = function (v) { return num(v, 1) + ' h'; };
      tip.innerHTML = '<strong>' + esc(dayLabel(fromLocal(n.key * 86400 + 43200, state.off), state.off) + new Date(n.key * 86400000).getUTCFullYear()) + '</strong>' +
        '<br>' + esc(T.tipDark) + ': ' + hrs(s.dark) +
        (season.isMoon ? '<br>' + esc(T.tipAbove) + ': ' + hrs(s.above30) : '<br>' + esc(T.tipGood) + ': ' + hrs(s.above30Moonless) + '<br>' + esc(T.tipMoon) + ': ' + hrs(s.above30 - s.above30Moonless)) +
        '<br>' + esc(T.tipMax) + ': ' + (s.maxAlt != null ? num(s.maxAlt) + '°' : '–') +
        (s.moonSep != null ? '<br>' + esc(T.tipSep) + ': ' + num(s.moonSep) + '°' : '') + '<br>' + esc(T.tipIllum) + ': ' + Math.round(s.illum * 100) + ' %';
      tip.hidden = false;
      var r = el.smSeasonChart.getBoundingClientRect(), x = e.clientX - r.left;
      tip.style.left = (x > r.width / 2 ? Math.max(0, x - tip.offsetWidth - 12) : x + 12) + 'px';
    });
    el.smSeasonChart.addEventListener('pointerleave', function () { el.smSeasonTip.hidden = true; });
    el.smSeasonChart.addEventListener('click', function (e) {
      var i = seasonIndex(e);
      if (i < 0) return;
      el.smSeasonTip.hidden = true;
      el.date.value = dateOfKey(season.nights[i].key);
      update();
    });
    Array.prototype.forEach.call(el.smSeasonSpans, function (r) {
      r.addEventListener('change', function () { if (r.checked) { state.seasonSpan = +r.value; drawSkyMap(); } });
    });
  }
  if (el.smInfoChart) { /* clicking or dragging in the card's chart sets the time */
    el.smInfoChart.addEventListener('pointerdown', pickedChartTime);
    el.smInfoChart.addEventListener('pointermove', function (e) { if (e.buttons === 1) pickedChartTime(e); });
  }
  function barsToTime(e) {
    var L = state.plBarsLayout, win = state.plWin;
    if (!L || !win) return;
    var x = e.clientX - el.plBars.getBoundingClientRect().left;
    setPlanetTime(win.start + clamp((x - L.LEFT) / L.pw, 0, 1) * (win.end - win.start));
  }
  el.plBars.addEventListener('pointerdown', barsToTime);
  el.plBars.addEventListener('pointermove', function (e) { if (e.buttons === 1) barsToTime(e); });
  el.modePhoto.addEventListener('click', function () { setMode('photo'); });
  el.modeVisual.addEventListener('click', function () { setMode('visual'); });
  /* the further catalogues in the imaging list (#op-list-extra, on by default, not stored): data/ngc.json is fetched for them */
  if (el.listExtra) el.listExtra.addEventListener('click', function () {
    state.listExtra = !state.listExtra;
    if (state.listExtra) loadNgcData();
    if (state.ready) renderList();
  });
  el.filter.addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.getAttribute('data-filter');
    if (state.ready) drawList();
  });
  if (el.nightStrip) {
    el.nightStrip.addEventListener('click', function (e) {
      var r = el.nightStrip.getBoundingClientRect(), win = state.plWin;
      if (win && r.width) setPlanetTime(win.start + (e.clientX - r.left) / r.width * (win.end - win.start));
    });
    window.addEventListener('resize', function () { if (state.ready) renderMoon(); });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!state.ready) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { drawPlanetBars(); drawSkyMap(); drawList(); drawEvents(); renderMoonCal(); }, 150);
  });

  readUrl();
  setMode('photo');
  state.smNames = el.smNames.checked; /* browsers may restore the box on reload */
  Array.prototype.forEach.call(el.smSeasonSpans, function (r) { if (r.checked && +r.value > 0) state.seasonSpan = +r.value; }); /* the radios too */
  el.smLang.value = state.names; /* the link decides, not a restored form */
  if (el.smPhotos) {
    el.smPhotos.checked = !!state.photos;
    if (el.smSurvey) el.smSurvey.value = state.survey;
    el.smPhotoNote.innerHTML = esc(T[PHOTO_AUTO ? 'photoNote' : 'photoNoteClick'].replace('{f}', PHOTO_FOV))
      .replace('{link}', '<a href="' + T.privacyHref + '">' + esc(T.privacyText) + '</a>');
  }
  /* satellite TLEs and comet elements, from this server only (astro-tools/tools/sky-events-data.js writes them) */
  if (window.fetch && window.SvSkyEvents && el.events) {
    fetch('data/sky-events.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { state.evData = data; if (state.ready) renderEvents(); })
      .catch(function () { state.evError = true; if (state.ready) renderEvents(); });
    /* double stars (astro-tools/tools/double-stars-data.js): a table of the night's attractive pairs once loaded */
    fetch('data/doubles.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { state.doubles = data; if (state.ready) renderEvents(); })
      .catch(function () { state.doubles = null; });
  }
  update();
})();
