#!/usr/bin/env node
/*
 * Checks of the observing planner's calculations and data, without a browser:
 *
 *   node astro-tools/tools/verify-planner.js
 *
 * Run it after touching astro-tools/js/astro-core.js, astro-tools/js/sky-map.js, astro-tools/js/sky-events.js, the catalogues (astro-tools/tools/star-catalog-data.js),
 * the orbital data or the planner pages, and before a deploy. Every failure sets exit code 1; warnings (old orbital data)
 * do not. The reference values are fixed here: star positions from SIMBAD (ICRS, J2000), Uranus and Neptune from JPL
 * Horizons (apparent RA/Dec, geocentric), new and full moons from the U.S. Naval Observatory. Random tests use a fixed
 * seed, so every run checks the same points.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..'), R = Math.PI / 180;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0, failed = 0, warned = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}
function warn(name, detail) { warned++; console.log('  warn  ' + name + ' — ' + detail); }
function section(title) { console.log('\n' + title); }
let seed = 20260914;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
/* angular distance in degrees between two points given in degrees; the haversine form stays exact for tiny distances,
   where acos() cannot resolve less than about 0.004″ */
function sep(ra1, de1, ra2, de2) {
  const h = Math.pow(Math.sin((de2 - de1) * R / 2), 2) + Math.cos(de1 * R) * Math.cos(de2 * R) * Math.pow(Math.sin((ra2 - ra1) * R / 2), 2);
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / R;
}

/* ---------------------------------------------------------------- scripts */
section('Scripts');
const SCRIPTS = ['js/astro-core.js', 'js/dso-catalog.js', 'js/star-catalog.js', 'js/sky-events.js', 'js/sky-map.js', 'js/observing-planner.js'];
SCRIPTS.forEach(f => {
  try { new vm.Script(read(f), { filename: f }); check(f + ' parses', true); } catch (e) { check(f + ' parses', false, e.message); }
});
const sandbox = { window: {} };
vm.createContext(sandbox);
SCRIPTS.slice(0, 5).forEach(f => vm.runInContext(read(f), sandbox, { filename: f }));
const W = sandbox.window, A = W.SvAstro, SKY = W.SvSky, DSO = W.SvDSO, MAP = W.SvSkyMap, EV = W.SvSkyEvents;
check('globals SvAstro, SvSky, SvDSO, SvSkyEvents, SvSkyMap exist', !!(A && SKY && DSO && EV && MAP && MAP.create));

/* ---------------------------------------------------------------- pages */
section('Planner pages');
const pages = { de: read('observing-planner_de.html'), en: read('observing-planner_en.html') };
const WANT = ['main.js', 'cookie-consent.js', 'astro-core.js', 'dso-catalog.js', 'star-catalog.js', 'sky-events.js', 'sky-map.js', 'observing-planner.js'];
const idSets = {};
for (const lang of ['de', 'en']) {
  const got = [...pages[lang].matchAll(/<script src="(?:\.\.\/)?js\/([^"?]+)(?:\?v=[0-9a-f]+)?"/g)].map(m => m[1]);
  check(`script order (${lang})`, JSON.stringify(got) === JSON.stringify(WANT), got.join(', '));
  idSets[lang] = new Set([...pages[lang].matchAll(/\sid="(op-[^"]+)"/g)].map(m => m[1]));
}
const idDiff = [...idSets.de].filter(x => !idSets.en.has(x)).concat([...idSets.en].filter(x => !idSets.de.has(x)));
check('same op-* element ids in DE and EN', idDiff.length === 0, idSets.de.size + ' ids' + (idDiff.length ? '; differing: ' + idDiff.join(', ') : ''));
const usedIds = [...new Set([...(read('js/observing-planner.js') + read('js/sky-map.js')).matchAll(/getElementById\('(op-[^']+)'\)/g)].map(m => m[1]))];
const missingIds = usedIds.filter(x => !idSets.de.has(x));
{
  const out = require('child_process').spawnSync(process.execPath, [path.join(ROOT, '..', 'tools', 'asset-versions.js'), '--check'], { encoding: 'utf8' });
  check('every page links scripts and stylesheet with their current ?v= version (tools/asset-versions.js)', out.status === 0, (out.stdout || out.stderr).trim());
}
check('every element id the scripts look up exists', missingIds.length === 0, usedIds.length + ' looked up' + (missingIds.length ? '; missing: ' + missingIds.join(', ') : ''));

/* ---------------------------------------------------------------- HEALPix */
section('HEALPix for the sky photographs (js/sky-map.js)');
{
  let centre = 0, sub = 0, n = 0;
  for (let order = 3; order <= 9; order++) {
    const nside = 1 << order;
    for (let i = 0; i < 2000; i++) {
      const ra = rnd() * 360, dec = Math.asin(2 * rnd() - 1) / R, p = MAP.hpxPix(order, ra, dec), f = MAP.hpxXYF(order, p);
      const c = MAP.hpxLoc(f.face, (f.ix + 0.5) / nside, (f.iy + 0.5) / nside);
      if (MAP.hpxPix(order, c.ra, c.dec) !== p) centre++;
      const x = rnd(), y = rnd(), q = MAP.hpxLoc(f.face, (f.ix + x) / nside, (f.iy + y) / nside);
      const expect = f.face * 64 * nside * nside + MAP.hpxInterleave(f.ix * 8 + Math.floor(x * 8), f.iy * 8 + Math.floor(y * 8));
      if (MAP.hpxPix(order + 3, q.ra, q.dec) !== expect) sub++;
      n++;
    }
  }
  check('pixel centres map back to their pixel (orders 3–9)', centre === 0, `${n} points, ${centre} failures`);
  check('points inside a pixel fall into the right sub-pixel', sub === 0, `${n} points, ${sub} failures`);
}

/* ---------------------------------------------------------------- precession */
section('Precession');
{
  const ms = Date.UTC(2026, 8, 20), pa = MAP.precAngles(ms);
  let trip = 0, vsFirst = 0;
  for (let i = 0; i < 5000; i++) {
    const ra = rnd() * 360, dec = Math.asin(2 * rnd() - 1) / R, f = MAP.precessRig(ra, dec, pa), b = MAP.toJ2000(f.ra, f.dec, pa);
    trip = Math.max(trip, sep(ra, dec, b.ra, b.dec));
    { const o = A.precessJ2000(ra, dec, ms); vsFirst = Math.max(vsFirst, sep(f.ra / R, f.dec / R, o.ra / R, o.dec / R)); }
  }
  check('rigorous precession round trip', trip * 3600 < 1e-4, (trip * 3600).toExponential(2) + '″');
  check('precessJ2000() in the core is the rigorous rotation', vsFirst * 3600 < 1e-6, (vsFirst * 3600).toExponential(2) + '″');
  const pole = MAP.precessRig(0, 90, pa);
  check('the celestial pole stays finite (rigorous formula)', isFinite(pole.ra) && Math.abs(pole.dec / R - 89.85) < 0.01, 'Dec ' + (pole.dec / R).toFixed(4) + '°');
}

/* ---------------------------------------------------------------- refraction */
section('Refraction (js/astro-core.js)');
{
  const atHorizon = -A.unrefract(0) * 60, at45 = (A.refract(45) - 45) * 60;
  check('34′ at the apparent horizon (Bennett)', Math.abs(atHorizon - 34.5) < 0.3, atHorizon.toFixed(1) + '′');
  check('1′ at 45° (Sæmundsson)', Math.abs(at45 - 1.0) < 0.05, at45.toFixed(2) + '′');
  const trip = Math.max(...[0, 0.5, 2, 5, 10, 20, 45, 70, 89].map(h => Math.abs(A.unrefract(A.refract(h)) - h) * 3600));
  check('unrefract() undoes refract()', trip < 6, 'largest ' + trip.toFixed(1) + '″');
  check('no refraction below the horizon', A.refract(-5) === -5 && A.unrefract(-5) === -5);
}

/* ---------------------------------------------------------------- projection */
section('Star map projection (js/sky-map.js)');
for (const [Wd, Hd] of [[1000, 560], [400, 300]]) {
  const v = MAP.skyProjection(Wd, Hd, 180, null, null, 8);
  const hz = v.proj({ alt: 0, az: 180 }), zen = v.proj({ alt: 90, az: 0 });
  check(`${Wd} px: horizon straight ahead 34 px above the bottom`, Math.abs(hz.y - (Hd - 34)) < 0.5 && Math.abs(hz.x - Wd / 2) < 0.5, `y ${hz.y.toFixed(2)}`);
  if (v.fov === 160) check(`${Wd} px: zenith inside the whole view (160°; narrow screens show 120° and leave it out)`, !!zen && zen.y > 0 && zen.y < Hd, zen ? `y ${zen.y.toFixed(1)}` : 'behind');
  let trip = 0, edge = 0;
  for (let i = 0; i < 2000; i++) {
    const fov = 1.5 + rnd() * 150, vz = MAP.skyProjection(Wd, Hd, rnd() * 360, fov, rnd() * 90, 1.5), h = { alt: rnd() * 90, az: rnd() * 360 }, q = vz.proj(h);
    if (q) { const b = vz.unproj(q.x, q.y); trip = Math.max(trip, sep(h.az, h.alt, b.az / R, b.alt / R)); }
    const mid = vz.unproj(Wd / 2, Hd / 2), side = vz.unproj(Wd, Hd / 2);
    edge = Math.max(edge, Math.abs(sep(mid.az / R, mid.alt / R, side.az / R, side.alt / R) - vz.fov / 2));
  }
  check(`${Wd} px: unproj() inverts proj()`, trip * 3600 < 1e-4, (trip * 3600).toExponential(2) + '″');
  check(`${Wd} px: the view is exactly its width in degrees`, edge < 1e-6, 'largest error ' + edge.toExponential(2) + '°');
}
check('zoom stops at the minimum width', MAP.skyProjection(1000, 560, 0, 0.5, 40, 1.5).fov === 1.5);

/* ---------------------------------------------------------------- star data */
section('Star data (js/star-catalog.js, data/stars-8.bin)');
{
  const stars = SKY.stars;
  check('stars down to 6.0 mag, bright to faint', stars.length > 5000 && stars.every((s, i) => s[2] <= 6 && (i === 0 || s[2] >= stars[i - 1][2])), stars.length + ' stars');
  const byEn = {};
  stars.forEach(s => { if (s[5]) byEn[s[5]] = (byEn[s[5]] || []).concat([s]); });
  const dups = Object.keys(byEn).filter(k => byEn[k].length > 1);
  check('every star name given once', dups.length === 0, Object.keys(byEn).length + ' names' + (dups.length ? '; twice: ' + dups.join(', ') : ''));
  const german = { Arcturus: 'Arktur', Procyon: 'Prokyon', Betelgeuse: 'Beteigeuze', Polaris: 'Polarstern' };
  check('German spellings kept', Object.keys(german).every(en => byEn[en] && byEn[en][0][4] === german[en]));
  check('α Centauri pair named apart', !!(byEn['Rigil Kentaurus'] && byEn.Toliman));
  check('Bayer letters are Greek', stars.every(s => !s[6] || /^[α-ω]/.test(s[6])), stars.filter(s => s[6]).length + ' letters');
  const SIMBAD = { Sirius: [101.287155, -16.716116], Canopus: [95.987958, -52.695661], Arcturus: [213.9153, 19.182409], Vega: [279.234735, 38.783689],
    Betelgeuse: [88.792939, 7.407064], Polaris: [37.954561, 89.264109] };
  const worst = Object.keys(SIMBAD).map(n => [n, byEn[n] ? sep(byEn[n][0][0], byEn[n][0][1], SIMBAD[n][0], SIMBAD[n][1]) : 99]).sort((a, b) => b[1] - a[1])[0];
  check('bright star positions against SIMBAD', worst[1] < 0.01, `largest: ${worst[0]} ${(worst[1] * 3600).toFixed(1)}″`);
  check('constellation lines and labels', Object.keys(SKY.lines).length === 88 && SKY.labels.length === 89, `${Object.keys(SKY.lines).length} figures, ${SKY.labels.length} labels`);
  const mw = SKY.milkyWay, cells = [...mw.rle.matchAll(/[a-f](\d+)/g)].reduce((t, m) => t + +m[1], 0);
  check('Milky Way grid decodes to its size', cells === mw.w * mw.h, `${cells} of ${mw.w * mw.h} cells`);

  const bin = fs.readFileSync(path.join(ROOT, 'data/stars-8.bin')), n = bin.readUInt32LE(8), ver = bin.readUInt16LE(4), rec = ver >= 2 ? bin.readUInt16LE(6) : 6;
  let sorted = true, inRange = true;
  for (let i = 0, prev = 0; i < n; i++) {
    const o = 12 + rec * i, mag = bin.readUInt8(o + 4) / 20, dec = bin.readInt16LE(o + 2) / 32767 * 90;
    if (mag < prev) sorted = false;
    if (mag < 5.99 || mag > 8.01 || Math.abs(dec) > 90) inRange = false; /* magnitudes are stored in steps of 0.05 */
    prev = mag;
  }
  check('stars-8.bin header and size', bin.toString('ascii', 0, 4) === 'SVST' && ver === 2 && rec === 12 && bin.length === 12 + rec * n, `version ${ver}, ${n} stars, ${bin.length} bytes`);
  check('motion: three numbers per star', SKY.motion.length === 3 * stars.length);
  /* the positions are epoch 2000: 61 Cygni A moved back to 1991.25 must meet the Hipparcos new reduction (van Leeuwen 2007) */
  const ci = stars.findIndex(st => Math.abs(st[0] - 316.725) < 0.01 && Math.abs(st[1] - 38.749) < 0.01);
  const back = MAP.moved(stars[ci][0], stars[ci][1], SKY.motion[3 * ci], SKY.motion[3 * ci + 1], -8.75);
  const cygErr = sep(back[0], back[1], 316.71181137, 38.74149513) * 3600;
  check('proper motion from epoch 2000 (61 Cygni A against Hipparcos at 1991.25)', ci >= 0 && cygErr < 5, cygErr.toFixed(1) + '″');
  let pmMax = 0;
  for (let i = 0; i < n; i++) pmMax = Math.max(pmMax, Math.hypot(bin.readInt16LE(12 + rec * i + 6), bin.readInt16LE(12 + rec * i + 8)));
  check('stars-8.bin carries proper motions', pmMax > 3000 && pmMax < 32767, 'largest ' + (pmMax / 1000).toFixed(1) + '″/yr');
  check('stars-8.bin: 6–8 mag, bright to faint, valid declinations', sorted && inRange);
}

/* ---------------------------------------------------------------- constellation boundaries */
section('Constellation boundaries (js/star-catalog.js, js/sky-map.js)');
{
  const bnds = MAP.boundsB1875(SKY.bounds), abbr = new Set(SKY.bounds.map(b => b[0]));
  check('89 rings for the 88 constellations (Serpens twice)', SKY.bounds.length === 89 && abbr.size === 88);
  const KNOWN = [['Sirius', 101.287155, -16.716116, 'CMa'], ['Canopus', 95.987958, -52.695661, 'Car'], ['Arcturus', 213.9153, 19.182409, 'Boo'],
    ['Vega', 279.234735, 38.783689, 'Lyr'], ['Betelgeuse', 88.792939, 7.407064, 'Ori'], ['Polaris', 37.954561, 89.264109, 'UMi'],
    ['σ Octantis', 317.19536, -88.95650, 'Oct'], ['south pole', 0, -89.99, 'Oct'], ['Antares', 247.351915, -26.432003, 'Sco']];
  const wrong = KNOWN.filter(k => MAP.constellationAt(bnds, k[1], k[2]) !== k[3]).map(k => `${k[0]}: ${MAP.constellationAt(bnds, k[1], k[2])}`);
  check('known stars and the south pole fall into their constellation', wrong.length === 0, wrong.join(', ') || KNOWN.length + ' positions');
  const dsoWrong = DSO.filter(o => MAP.constellationAt(bnds, o.ra, o.dec) !== o.c).map(o => `${o.id} ${o.c}→${MAP.constellationAt(bnds, o.ra, o.dec)}`);
  check('every catalogue object lies in its catalogue constellation', dsoWrong.length === 0, dsoWrong.join(', ') || DSO.length + ' objects');
  let none = 0;
  for (let i = 0; i < 3000; i++) { if (!MAP.constellationAt(bnds, rnd() * 360, Math.asin(2 * rnd() - 1) / R)) none++; }
  check('every point of the sky lies in a constellation', none === 0, `3000 random points, ${none} without`);
}

/* ---------------------------------------------------------------- deep-sky catalogue */
section('Deep-sky catalogue (js/dso-catalog.js)');
{
  const ids = DSO.map(o => o.id), types = new Set(['Gx', 'EN', 'RN', 'DN', 'PN', 'SNR', 'GC', 'OC']);
  check('168 objects with unique ids', DSO.length === 168 && new Set(ids).size === DSO.length, DSO.length + ' objects');
  const bad = DSO.filter(o => !(o.ra >= 0 && o.ra < 360 && Math.abs(o.dec) <= 90 && types.has(o.t) && o.s > 0 && isFinite(o.m) && SKY.labels.some(l => l[0] === o.c)));
  check('coordinates, type, size, magnitude and constellation present', bad.length === 0, bad.map(o => o.id).join(', '));
  const noThumb = DSO.filter(o => !fs.existsSync(path.join(ROOT, 'img/dso', o.id.toLowerCase().replace(/\s+/g, '') + '.jpg')));
  check('a thumbnail for every object (img/dso/)', noThumb.length === 0, noThumb.map(o => o.id).join(', '));
  const badShape = DSO.filter(o => (o.q != null && !(o.q > 0 && o.q <= 1)) || (o.pa != null && !(o.pa >= 0 && o.pa < 180)) || (o.pa != null && o.q == null));
  check('axis ratios and position angles valid', badShape.length === 0, `${DSO.filter(o => o.pa != null).length} with a position angle` + (badShape.length ? '; bad: ' + badShape.map(o => o.id).join(', ') : ''));
  const noWiki = DSO.filter(o => !o.wde || !o.wen);
  check('German and English Wikipedia titles', noWiki.length === 0, noWiki.map(o => o.id).join(', '));
  /* Wikipedia links for everything else the info card shows: fixed titles for moon and planets, search links for stars,
     double stars and OpenNGC objects (sky-map.js wikiUrl(), starWikiQuery(), ngcWikiQuery()) */
  const noGen = SKY.labels.map(l => l[0]).filter(ab => !MAP.WIKI_GENITIVE[ab]);
  const noGreek = [...new Set(SKY.stars.filter(st => st[6]).map(st => st[6].charAt(0)))].filter(g => !MAP.WIKI_GREEK[g]);
  check('Latin genitives for all 88 constellations and names for every Bayer letter', noGen.length === 0 && noGreek.length === 0 && Object.keys(MAP.WIKI_GENITIVE).length === 88, noGen.concat(noGreek).join(', ') || '88 genitives');
  const noBody = ['moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].filter(id => !(MAP.BODY_WIKI[id] && MAP.BODY_WIKI[id][0] && MAP.BODY_WIKI[id][1]));
  check('Wikipedia titles for moon and planets', noBody.length === 0 && MAP.wikiUrl('de', 'Jupiter (Planet)') === 'https://de.wikipedia.org/wiki/Jupiter_(Planet)', noBody.join(', '));
  const wikiQ = [['en', { bayer: 'β1', con: 'Cyg', name: 'Albireo' }, 'Beta Cygni'], ['de', { bayer: 'ε', con: 'Boo' }, 'Epsilon Bootis'], ['en', { bayer: 'ε', con: 'Boo' }, 'Epsilon Boötis'],
    ['en', { simbad: '*  61 Cyg' }, '61 Cygni'], ['en', { simbad: 'HD  21291' }, 'HD 21291'], ['en', { simbad: '* mu.01 Cru' }, 'Mu Crucis'], ['de', { simbad: 'V* V336 Pup' }, 'V336 Puppis'],
    ['en', { simbad: 'BD+09  2882A' }, 'BD+09 2882'], ['en', { simbad: '* u Car' }, 'u Carinae'], ['en', { simbad: 'NAME HD 79416AB' }, 'HD 79416'], ['de', { simbad: '* b01 Car' }, 'b Carinae'],
    ['de', { name: 'Wega' }, 'Wega'], ['en', {}, '']];
  const badQ = wikiQ.filter(q => MAP.starWikiQuery(q[0], q[1]) !== q[2]).map(q => JSON.stringify(q[1]) + ' gives "' + MAP.starWikiQuery(q[0], q[1]) + '", want "' + q[2] + '"');
  const wikiN = [['NGC 292', 'NGC 292'], ['UGC05470', 'UGC 5470'], ['PGC000143', 'PGC 143'], ['Mel071', 'Melotte 71'], ['Cl399', 'Collinder 399'], ['C 41', 'Caldwell 41'], ['H05', 'Harvard 5'], ['ESO056-115', 'ESO 56-115'], ['Sh2-155', 'Sh2-155'], ['M 40', 'Messier 40']];
  const badN = wikiN.filter(q => MAP.ngcWikiQuery(q[0]) !== q[1]).map(q => q[0] + ' gives "' + MAP.ngcWikiQuery(q[0]) + '", want "' + q[1] + '"');
  check('Wikipedia search texts for stars, double stars and OpenNGC designations', badQ.length === 0 && badN.length === 0, badQ.concat(badN).join('; ') || (wikiQ.length + wikiN.length) + ' samples');
  const dblData = JSON.parse(read('data/doubles.json')), df = k => dblData.fields.indexOf(k);
  const dblNoLink = dblData.objects.filter(o => ['de', 'en'].some(lang => !MAP.starWikiQuery(lang, { name: o[df('name')], bayer: o[df('bayer')], con: o[df('con')], simbad: o[df('simbad')] })));
  const ngcData = JSON.parse(read('data/ngc.json')).objects, ngcNoLink = ngcData.filter(r => !/^([A-Za-z]+ \S|Sh2-\d+$)/.test(MAP.ngcWikiQuery(r[0])));
  check('every double star and every OpenNGC object gets a Wikipedia link', dblNoLink.length === 0 && ngcNoLink.length === 0,
    dblData.objects.length + ' pairs, ' + ngcData.length + ' OpenNGC objects' + (dblNoLink.length ? '; pairs without: ' + dblNoLink.slice(0, 5).map(o => o[df('wds')]).join(', ') : '') + (ngcNoLink.length ? '; OpenNGC without: ' + ngcNoLink.slice(0, 5).map(r => r[0]).join(', ') : ''));
}

/* ---------------------------------------------------------------- planets and moon */
section('Planets and moon (js/astro-core.js)');
{
  const HORIZONS = {
    uranus: [['2026-01-01T00:00:00Z', 55.73710, 19.50965, 5.646], ['2030-01-17T00:00:00Z', 73.74440, 22.63384, 5.572], ['2034-02-02T00:00:00Z', 92.82341, 23.68675, 5.515],
      ['2038-02-18T00:00:00Z', 112.47311, 22.33423, 5.467], ['2042-03-06T00:00:00Z', 131.94821, 18.57278, 5.427]],
    neptune: [['2026-01-01T00:00:00Z', 0.07761, -1.41861, 7.767], ['2030-01-17T00:00:00Z', 8.45737, 2.02873, 7.772], ['2034-02-02T00:00:00Z', 16.91549, 5.44932, 7.778],
      ['2038-02-18T00:00:00Z', 25.50989, 8.76676, 7.783], ['2042-03-06T00:00:00Z', 34.26185, 11.88881, 7.788]]
  };
  for (const id of Object.keys(HORIZONS)) {
    const p = A.PLANETS.find(x => x.id === id);
    let dPos = 0, dMag = 0;
    HORIZONS[id].forEach(([t, ra, dec, mag]) => {
      const c = A.planetCoords(p, Date.parse(t));
      dPos = Math.max(dPos, sep(c.ra / R, c.dec / R, ra, dec));
      dMag = Math.max(dMag, Math.abs(A.planetMagnitude(id, c) - mag));
    });
    check(`${id} against JPL Horizons`, dPos < 0.05 && dMag < 0.15, `position ${dPos.toFixed(3)}°, magnitude ${dMag.toFixed(2)} mag`);
  }
  /* new and full moon from the moon's and sun's ecliptic longitudes, as the planner finds them */
  const USNO = [['full', '2026-01-03T10:03:00Z'], ['new', '2026-01-18T19:52:00Z'], ['full', '2026-02-01T22:09:00Z'], ['new', '2026-02-17T12:01:00Z'],
    ['full', '2026-03-03T11:38:00Z'], ['new', '2026-03-19T01:23:00Z'], ['full', '2026-04-02T02:12:00Z'], ['new', '2026-04-17T11:52:00Z'],
    ['new', '2026-09-11T03:27:00Z'], ['full', '2026-09-26T16:49:00Z']];
  const elong = sec => { const d = A.toDays(sec * 1000); return ((A.moonCoords(d).lam - A.sunCoords(d).lam) / R % 360 + 360) % 360; };
  function nextPhase(sec, target) {
    const past = t => ((elong(t) - target) % 360 + 360) % 360;
    let a = sec, pa = past(a);
    for (let i = 0; i < 130; i++) {
      let b = a + 21600; const pb = past(b);
      if (pb < pa) { while (b - a > 30) { const m = (a + b) / 2; if (past(m) > 180) a = m; else b = m; } return b; }
      a = b; pa = pb;
    }
    return null;
  }
  const worst = Math.max(...USNO.map(([kind, t]) => { const truth = Date.parse(t) / 1000; return Math.abs(nextPhase(truth - 3 * 86400, kind === 'new' ? 0 : 180) - truth) / 60; }));
  check('new and full moons against USNO', worst < 30, `largest ${worst.toFixed(1)} min (the page rounds to 10 min and says "about")`);
}

/* ---------------------------------------------------------------- planets and moon in detail */
section('Planets and moon in detail (js/sky-map.js)');
{
  /* JPL Horizons, geocentric: Jupiter and its four large moons (RA, Dec), Saturn (RA, Dec, ObsSub-LAT planetographic,
     NP.ang), the Moon (ObsSub-LON, ObsSub-LAT, NP.ang) */
  const JUP = [['2026-09-20T00:00Z', 139.799627643, 16.229797402, [[139.782514609, 16.235610654], [139.834243225, 16.217761739], [139.860218554, 16.208931788], [139.755546311, 16.24462674]]],
    ['2026-10-05T05:00Z', 142.567232731, 15.402408231, [[142.592912197, 15.393151561], [142.583714754, 15.396759668], [142.631843144, 15.378884268], [142.593814597, 15.393029353]]],
    ['2026-10-17T09:00Z', 144.522598591, 14.801740239, [[144.535192204, 14.797051945], [144.487684192, 14.814429464], [144.520687738, 14.802520385], [144.636473932, 14.759779923]]]];
  const SAT = [['2026-09-20T00:00Z', 12.127135426, 2.273028626, -9.739151, 3.1337], ['2026-09-29T03:00Z', 11.489856004, 1.991068562, -9.353953, 3.1932],
    ['2026-10-08T06:00Z', 10.831956475, 1.708395494, -8.965377, 3.2544], ['2026-10-17T09:00Z', 10.183150203, 1.437888123, -8.591115, 3.3145]];
  const MOON = [['2026-09-20T00:00Z', 359.342805, 5.20982, 356.8255], ['2026-09-29T03:00Z', 356.766798, -6.21159, 341.0553],
    ['2026-10-08T06:00Z', 4.700019, 1.947924, 21.2563], ['2026-10-17T09:00Z', 359.094706, 4.966373, 356.6743]];
  const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  let wSat = 0;
  JUP.forEach(([t, ra, dec, moons]) => {
    const ms = Date.parse(t), c = A.planetCoords(A.PLANETS.find(x => x.id === 'jupiter'), ms), semi = Math.atan(71492 / (c.dist * 149597870.7)) / R;
    const P = MAP.planetAxis('jupiter', ra, dec).P, sP = Math.sin(P * R), cP = Math.cos(P * R);
    MAP.galileanMoons(ms).forEach((m, k) => {
      const east = -m.X * cP + m.Y * sP, north = m.X * sP + m.Y * cP;
      wSat = Math.max(wSat, sep(ra + east * semi / Math.cos(dec * R), dec + north * semi, moons[k][0], moons[k][1]) * 3600);
    });
  });
  check('Galilean moons against JPL Horizons', wSat < 6, `worst ${wSat.toFixed(1)}″`);
  /* in front of Jupiter a moon is nearer than the planet: it moves west (X grows) and, with the Earth north of Jupiter's
     equator (B = +3.05° on 1 January 2024), it lies south of the centre (Y < 0); tested near conjunction, |X| < 0.5 */
  let tested = 0, wrongSide = 0;
  for (let h = 0; h < 24 * 20; h++) {
    const ms = Date.parse('2024-01-01T00:00:00Z') + h * 3600000, now = MAP.galileanMoons(ms), later = MAP.galileanMoons(ms + 600000);
    now.forEach((m, k) => {
      if (Math.abs(m.X) > 0.5) return;
      tested++;
      if (m.front !== (later[k].X > m.X) || m.front !== (m.Y < 0)) wrongSide++;
    });
  }
  check('Galilean moons in front of or behind Jupiter', tested > 20 && wrongSide === 0, `${tested} conjunctions tested, ${wrongSide} on the wrong side`);
  let wB = 0, wP = 0;
  SAT.forEach(([, ra, dec, subLat, npAng]) => {
    const ax = MAP.planetAxis('saturn', ra, dec), graphic = Math.atan(Math.tan(ax.B * R) / Math.pow(1 - 0.09796, 2)) / R;
    wB = Math.max(wB, Math.abs(graphic - subLat)); wP = Math.max(wP, angDiff(ax.P, npAng));
  });
  check('Saturn ring tilt and pole angle against JPL Horizons', wB < 0.02 && wP < 0.1, `tilt ${wB.toFixed(3)}°, pole angle ${wP.toFixed(3)}°`);
  let wl = 0, wb = 0, wPm = 0;
  MOON.forEach(([t, subLon, subLat, npAng]) => {
    const lib = MAP.moonLibration(Date.parse(t));
    wl = Math.max(wl, angDiff(lib.l, subLon)); wb = Math.max(wb, Math.abs(lib.b - subLat)); wPm = Math.max(wPm, angDiff(lib.P, npAng));
  });
  check('Moon libration and axis angle against JPL Horizons', wl < 0.3 && wb < 0.3 && wPm < 0.3, `longitude ${wl.toFixed(2)}°, latitude ${wb.toFixed(2)}°, axis ${wPm.toFixed(2)}°`);
  check('Moon colour map present (img/moon-lroc-1k.jpg)', fs.existsSync(path.join(ROOT, 'img/moon-lroc-1k.jpg')));
}

/* ---------------------------------------------------------------- OpenNGC extract and surveys */
section('OpenNGC extract (data/ngc.json) and photo surveys');
{
  let ngc = null;
  try { ngc = JSON.parse(read('data/ngc.json')); } catch (e) { check('ngc.json reads', false, e.message); }
  if (ngc) {
    const types = new Set(['Gx', 'EN', 'RN', 'DN', 'PN', 'SNR', 'GC', 'OC', 'St', 'DS', 'Ast']), have = new Set(DSO.map(o => o.id.replace(/\s+/g, '').toUpperCase()));
    const bad = ngc.objects.filter(o => !(o.length === 11 && (o[9] === null || (Array.isArray(o[9]) && o[9].length > 0 && o[9].every(x => typeof x === 'string'))) && Array.isArray(o[10]) && o[10].length === 2 && o[10].every(v => v === 0 || v === 1 || (typeof v === 'string' && v)) && o[1] >= 0 && o[1] < 360 && Math.abs(o[2]) <= 90 && types.has(o[3])));
    check('objects well formed', ngc.objects.length > 13000 && bad.length === 0, `${ngc.objects.length} objects` + (bad.length ? `; bad: ${bad.slice(0, 5).map(o => o[0]).join(', ')}` : ''));
    const dup = ngc.objects.filter(o => have.has(o[0].replace(/\s+/g, '').toUpperCase()));
    check('no object of the catalogue repeated', dup.length === 0, dup.map(o => o[0]).join(', '));
    check('licence and sources named in the file', /OpenNGC/.test(ngc.source) && /Sharpless/.test(ngc.source) && /Caldwell/.test(ngc.source) && /CC BY-SA 4\.0/.test(ngc.licence));
    const catIds = new Set(DSO.map(o => o.id)), badAlias = Object.keys(ngc.aliases || {}).filter(n => !catIds.has(ngc.aliases[n]));
    check('aliases lead to catalogue objects (NGC 224 → M31)', ngc.aliases && ngc.aliases['NGC 224'] === 'M31' && badAlias.length === 0, `${Object.keys(ngc.aliases || {}).length} aliases` + (badAlias.length ? '; bad: ' + badAlias.join(', ') : ''));
    /* Sharpless regions and Caldwell numbers: every one findable, as a row, a row's other designation or a catalogue alias */
    const desig = new Map();
    DSO.forEach(o => desig.set(o.id, o.id));
    ngc.objects.forEach(o => { desig.set(o[0], o[0]); (o[9] || []).forEach(x => desig.set(x, o[0])); });
    Object.keys(ngc.aliases || {}).forEach(a => desig.set(a, ngc.aliases[a]));
    const sh2Missing = Array.from({ length: 313 }, (_, i) => 'Sh2-' + (i + 1)).filter(x => !desig.has(x));
    const calMissing = Array.from({ length: 109 }, (_, i) => 'C ' + (i + 1)).filter(x => !desig.has(x));
    check('all 313 Sharpless regions and all 109 Caldwell objects findable', sh2Missing.length === 0 && calMissing.length === 0,
      sh2Missing.concat(calMissing).slice(0, 10).join(', ') || ngc.objects.filter(o => /^Sh2-/.test(o[0])).length + ' regions of their own');
    const onObject = [['Sh2-281', 'M42'], ['Sh2-117', 'NGC 7000'], ['Sh2-49', 'M16'], ['Sh2-25', 'M8'], ['Sh2-30', 'M20'], ['Sh2-275', 'NGC 2237'], ['Sh2-131', 'IC 1396'],
      ['Sh2-155', 'C 9'], ['Sh2-244', 'M1'], ['C 30', 'NGC 7331'], ['C 14', 'NGC 869'], ['C 20', 'NGC 7000'], ['C 50', 'NGC 2239'], ['C 37', 'NGC 6882']];
    const ownRegions = ['Sh2-103', 'Sh2-129', 'Sh2-240', 'Sh2-276'];
    const badDesig = onObject.filter(p => desig.get(p[0]) !== p[1]).map(p => p[0] + ' on ' + desig.get(p[0]) + ', want ' + p[1])
      .concat(ownRegions.filter(a => desig.get(a) !== a).map(a => a + ' should be its own region'));
    check('Sharpless and Caldwell numbers on the right objects (Sh2-281 = M42, C 30 = NGC 7331; Cygnus Loop and Barnard\'s Loop of their own)', badDesig.length === 0, badDesig.join('; ') || (onObject.length + ownRegions.length) + ' cases');
    /* Messier, NGC and IC complete: every number findable (a row, a row's other designation, a catalogue object or alias);
       only the entries OpenNGC marks as non-existent may be missing */
    const sqz = x => String(x).replace(/\s+/g, '').toUpperCase(), findable = new Set([...desig.keys()].map(sqz)), gone = new Set((ngc.nonexistent || []).map(sqz));
    const lost = [].concat(Array.from({ length: 110 }, (_, i) => 'M ' + (i + 1)), Array.from({ length: 7840 }, (_, i) => 'NGC ' + (i + 1)), Array.from({ length: 5386 }, (_, i) => 'IC ' + (i + 1)))
      .filter(x => !findable.has(sqz(x)) && !gone.has(sqz(x)));
    check('every Messier, NGC and IC number findable (non-existent entries excepted)', lost.length === 0, lost.length ? lost.length + ' missing: ' + lost.slice(0, 12).join(', ') : `110 + 7840 + 5386, ${gone.size} non-existent`);
    const noThumbRow = ngc.objects.filter(o => !fs.existsSync(path.join(ROOT, MAP.ngcThumb(o[0]))));
    const thumbNames = new Set(ngc.objects.map(o => MAP.ngcThumb(o[0])));
    check('a DSS thumbnail for every row (img/ngc/, tools/ngc-thumbnails.js)', noThumbRow.length === 0 && thumbNames.size === ngc.objects.length,
      noThumbRow.length ? noThumbRow.length + ' missing: ' + noThumbRow.slice(0, 8).map(o => o[0]).join(', ') : ngc.objects.length + ' images');
    const withArticle = ngc.objects.filter(o => o[10] && (o[10][0] || o[10][1])).length, rowOf = n => ngc.objects.find(o => o[0] === n);
    const m40 = rowOf('M 40'), m73 = rowOf('M 73');
    check('Wikipedia articles resolved (tools/ngc-wiki.js), M 40 and M 73 in both languages', !!(m40 && m73 && m40[10] && m40[10][0] && m40[10][1] && m73[10][0] && m73[10][1]),
      `${withArticle} of ${ngc.objects.length} rows with an article in German or English, the others link the search`);
    const fbDe = MAP.ngcWikiLink('de', ['NGC 1', 0, 0, 'Gx', null, null, null, null, null, null, [0, 1]]), fbNone = MAP.ngcWikiLink('en', ['NGC 1', 0, 0, 'Gx', null, null, null, null, null, null, [0, 0]]);
    check('Wikipedia link falls back to the other language, then to the search', fbDe.lang === 'en' && fbDe.url === 'https://en.wikipedia.org/wiki/NGC_1' && fbNone.url === 'https://en.wikipedia.org/wiki/Special:Search?search=NGC%201');
    /* cross-references and the same object twice */
    const KINDS = { Gx: 'g', EN: 'n', RN: 'n', DN: 'n', SNR: 'n', PN: 'p', OC: 'c', GC: 'c', St: 's', DS: 's', Ast: 's' };
    const arcminOf = (a, b) => { const dRa = ((b.ra - a.ra + 540) % 360 - 180) * Math.cos(a.dec * Math.PI / 180), dDec = b.dec - a.dec; return Math.sqrt(dRa * dRa + dDec * dDec) * 60; };
    const twins = DSO.flatMap(o => ngc.objects.filter(r => KINDS[r[3]] === KINDS[o.t] && Math.abs(r[2] - o.dec) < 0.01 && arcminOf(o, { ra: r[1], dec: r[2] }) < 0.1).map(r => o.id + ' = ' + r[0]));
    check('no object twice: no row of the extract on a catalogue object of its kind (M102 = NGC 5866, M16 = IC 4703 as aliases)', twins.length === 0 && ngc.aliases['NGC 5866'] === 'M102' && ngc.aliases['IC 4703'] === 'M16', twins.join(', '));
    const m42 = DSO.find(o => o.id === 'M42'), n7000 = DSO.find(o => o.id === 'NGC 7000'), badAka = DSO.filter(o => o.aka && !(Array.isArray(o.aka) && o.aka.length && o.aka.every(x => typeof x === 'string')));
    check('other designations of catalogue objects (aka): M42 = NGC 1976, Sh2-281; NGC 7000 = C 20, Sh2-117', badAka.length === 0 && m42.aka && m42.aka.includes('NGC 1976') && m42.aka.includes('Sh2-281') && n7000.aka && n7000.aka.includes('C 20') && n7000.aka.includes('Sh2-117'),
      DSO.filter(o => o.aka).length + ' of ' + DSO.length + ' objects with other designations');
    const rowNamed = n => ngc.objects.find(o => o[0] === n) || [];
    const unnormal = ngc.objects.filter(o => (o[9] || []).some(x => /^(PGC|UGC|UGCA|HD|HIP|Mel|Cl|LBN|ESO) 0/.test(x) || /^SH 2/.test(x)));
    check('other designations of rows written as usual, stars named (NGC 1990 = Alnilam, M 73 = NGC 6994)', unnormal.length === 0 && (rowNamed('NGC 1990')[9] || []).includes('Alnilam') && (rowNamed('M 73')[9] || []).includes('NGC 6994'),
      unnormal.length ? 'not normalised: ' + unnormal.slice(0, 5).map(o => o[0]).join(', ') : ngc.objects.filter(o => o[9]).length + ' rows with other designations');
    check('wrong Wikipedia redirects refused (IC 380, IC 4, NGC 1848 in English)', (rowNamed('IC 380')[10] || [])[1] === 0 && (rowNamed('IC 4')[10] || [])[1] === 0 && (rowNamed('NGC 1848')[10] || [])[1] === 0);
    const b33 = DSO.find(o => o.id === 'B 33');
    check('Horsehead Nebula B 33 at SIMBAD\'s size (6′)', b33 && b33.s === 6);
    const catIdSet = new Set(DSO.map(o => o.id.replace(/\s+/g, '').toUpperCase()));
    const aliasOnCat = Object.keys(ngc.aliases).filter(a => catIdSet.has(a.replace(/\s+/g, '').toUpperCase()));
    const starIdOnNebula = DSO.filter(o => (o.aka || []).some(x => /^(HD|HIP|WDS) /.test(x))).map(o => o.id);
    check('no designation of a catalogue object attached to another one (M102 not on M101), no star numbers on nebulae (IC 1396)', aliasOnCat.length === 0 && starIdOnNebula.length === 0, aliasOnCat.concat(starIdOnNebula).join(', '));
    const cc = MAP.catalogCounts(DSO, ngc.objects, ngc.aliases, ngc.nonexistent, SKY.stars, SKY.labels);
    check('catalogue counts of the search info box: Messier 110, NGC and IC complete but for non-existent entries, Caldwell 109, Sharpless 313, 88 constellations',
      cc.M === 110 && cc.NGC + cc.nonexNGC === 7840 && cc.IC + cc.nonexIC === 5386 && cc.C === 109 && cc.Sh2 === 313 && cc.cons === 88 && cc.PGC > 10000,
      `NGC ${cc.NGC} + ${cc.NGCparts} components, IC ${cc.IC}, PGC ${cc.PGC}, UGC ${cc.UGC}, ESO ${cc.ESO}, stars ${cc.starNamed} named / ${cc.starBayer} Bayer`);
    /* the imaging list's further catalogues: candidates, their 320 px pictures and the framing for the rig */
    const cands = ngc.objects.filter(MAP.imagingCandidate);
    const noLarge = cands.filter(o => !fs.existsSync(path.join(ROOT, MAP.ngcThumbL(o[0]))));
    check('imaging candidates of the further catalogues, each with a 320 px thumbnail (img/ngc-l/, ngc-thumbnails.js --large)',
      cands.length > 800 && noLarge.length === 0 && !cands.some(o => ['St', 'DS', 'Ast'].includes(o[3]) || /^(NGC|IC) \d+ ?[A-Z]/.test(o[0]) || !(o[4] >= 3 && o[4] <= 180)),
      cands.length + ' candidates' + (noLarge.length ? ', ' + noLarge.length + ' without a picture: ' + noLarge.slice(0, 5).map(o => o[0]).join(', ') : ''));
    /* usable dark hours: 10-minute samples like the list, the last sample not counted; above 30° from 1 h to 4 h into the window, moon up from 3 h */
    const UH = MAP.usableHours(t => (t >= 3600 && t < 14400 ? 45 : 10), t => (t >= 10800 ? 20 : -5), 0, 8 * 3600);
    const UH0 = MAP.usableHours(() => 29.9, () => -5, 0, 8 * 3600);
    check('usable dark hours above 30° for the info card: 3 h, 2 h of them moonless', Math.abs(UH.hours - 3) < 1e-9 && Math.abs(UH.moonless - 2) < 1e-9 && UH0.hours === 0, JSON.stringify(UH));
    const RF = MAP.rigFraming;
    check('framing for the rig (1.69° field): tiny objects and mosaics rated down', RF(1) === 0.3 && Math.abs(RF(12) - 1) < 1e-9 && RF(30) === 1 && RF(90) === 1 && RF(150) < 1 && RF(150) > 0.45 && RF(500) === 0.45 && RF(null) === 0.6 && Math.abs(MAP.RIG.fovArcmin / 60 - 1.69) < 0.01);
  }
  {
    const K = MAP.searchKey, S = (q, name) => MAP.searchScore(K(q), [K(name)]);
    const cases = [[K('M 51'), 'm51'], [K('NGC 0891'), 'ngc891'], [K('alpha Lyr'), 'αlyr'], [K('Großer Bär'), K('großer bar')], [K('Beteigeuze'), 'beteigeuze'],
      [K('Caldwell 30'), 'c30'], [K('C 030'), 'c30'], [K('Sharpless 2-155'), 'sh2155'], [K('Sharpless 155'), 'sh2155'], [K('Sh 2-155'), 'sh2155']];
    check('search keys', cases.every(([a, b]) => a === b), cases.map(c => c[0]).join(', '));
    check('search results in natural order: M5 before M50, NGC 101 before NGC 1010, Ancha before Andromeda',
      MAP.naturalCompare('M5', 'M50') < 0 && MAP.naturalCompare('NGC 101', 'NGC 1010') < 0 && MAP.naturalCompare('NGC 9', 'NGC 10') < 0 && MAP.naturalCompare('Ancha', 'Andromeda') < 0 && MAP.naturalCompare('Antlia', 'Anwa Farkadain') < 0);
    check('search order: exact before prefix, M5 not taken for M51', S('m5', 'M5') === 0 && S('m5', 'M51') === 2 && S('whirl', 'Whirlpool') === 1 && S('pool', 'Whirlpool') === 3 && S('xy', 'Wega') === 9);
  }
  for (const lang of ['de', 'en']) {
    const p = pages[lang];
    check(`credits name OpenNGC, Sharpless, Caldwell, NASA SVS, Pan-STARRS and 2MASS (${lang})`, /OpenNGC[^<]*CC BY-SA 4\.0/.test(p) && /Sharpless 1959/.test(p) && /Caldwell/.test(p) && /Scientific Visualization Studio/.test(p) && /PS1 Science Consortium/.test(p) && /IPAC\/Caltech/.test(p));
    check(`licences and citations in the credits: the Wikipedia list under CC BY-SA 4.0, VizieR and SIMBAD cited (${lang})`,
      /Wikipedia[^<]*<a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/"/.test(p) && /10\.26093\/cds\/vizier/.test(p) && /SIMBAD[^<]*(Wenger|betrieben|operated)/.test(p));
    check(`survey choice dss, ps1, 2mass (${lang})`, ['dss', 'ps1', '2mass'].every(v => p.includes(`<option value="${v}"`)));
  }
}

/* ---------------------------------------------------------------- moon, comets, darkness, refraction, events */
section('Moon, comets, darkness, refraction and event details (js/astro-core.js, js/sky-events.js, js/sky-map.js)');
{
  /* the moon after Meeus chapter 47: the book's example 47.a (1992-04-12 0h, taken as UT) and JPL Horizons (ICRF RA/Dec) */
  /* Meeus example 47.a, apparent place (with nutation and the true obliquity): α 134.688470°, δ 13.768368°, λ 133.167265° */
  const ex = A.moonCoords(A.toDays((2448724.5 - 2440587.5) * 86400000)), exRa = (ex.ra / R + 360) % 360;
  check('moon: Meeus example 47.a (apparent place)', Math.abs(exRa - 134.688470) < 0.0006 && Math.abs(ex.dec / R - 13.768368) < 0.0006 && Math.abs(ex.dist - 368409.7) < 1,
    `α ${exRa.toFixed(6)}°, δ ${(ex.dec / R).toFixed(6)}°, ${ex.dist.toFixed(1)} km`);
  /* Meeus example 22.a, 1987 Apr 10 0h TD: Δψ −3.788″, Δε +9.443″, ε0 23°26′27.407″ (short series: 0.5″ and 0.1″) */
  const nu22 = A.nutation(A.toDays((2446895.5 - 2440587.5) * 86400000)), as = x => x / R * 3600;
  check('nutation and obliquity: Meeus example 22.a', Math.abs(as(nu22.dpsi) + 3.788) < 0.5 && Math.abs(as(nu22.deps) - 9.443) < 0.1 && Math.abs(as(nu22.eps0) - 84387.407) < 0.05,
    `Δψ ${as(nu22.dpsi).toFixed(3)}″, Δε ${as(nu22.deps).toFixed(3)}″, ε0 ${(as(nu22.eps0) - 84360).toFixed(3)}″ over 23°26′`);
  const HZ_MOON = [
    ['2026-09-20T00:00:00Z', 280.166075044, -27.134002192], ['2026-09-23T01:00:00Z', 318.649395283, -17.252354223],
    ['2026-09-26T02:00:00Z', 354.453591828, 0.062220232], ['2026-09-29T03:00:00Z', 32.865523463, 18.322695208],
    ['2026-10-02T04:00:00Z', 78.922684161, 27.871025964], ['2026-10-05T05:00:00Z', 126.028155779, 21.614942110],
    ['2026-10-08T06:00:00Z', 165.632746554, 4.573410770], ['2026-10-11T07:00:00Z', 201.714777977, -13.711326200],
    ['2026-10-14T08:00:00Z', 240.072186668, -25.768583056], ['2026-10-17T09:00:00Z', 280.656964544, -26.893190315]];
  let wMoon = 0;
  HZ_MOON.forEach(([t, ra, dec]) => {
    /* Horizons' times are UT, the theory takes TT: the moon is taken ΔT (69 s, 0.01° of its motion) later, so that the
       comparison measures the series, not ΔT. Apparent of date back to mean of date (nutation out, Meeus 23.1), then to
       J2000 against Horizons' astrometric ICRF place */
    const ms = Date.parse(t) + EV.DELTA_T * 1000, c = A.moonCoords(A.toDays(ms)), nu = A.nutation(A.toDays(ms)), e = nu.eps;
    const mRa = c.ra - ((Math.cos(e) + Math.sin(e) * Math.sin(c.ra) * Math.tan(c.dec)) * nu.dpsi - Math.cos(c.ra) * Math.tan(c.dec) * nu.deps), mDec = c.dec - (Math.sin(e) * Math.cos(c.ra) * nu.dpsi + Math.sin(c.ra) * nu.deps);
    const j = A.toJ2000(mRa, mDec, A.precAngles(ms));
    wMoon = Math.max(wMoon, sep(j.ra, j.dec, ra, dec));
  });
  check('moon position against JPL Horizons (at UT + ΔT)', wMoon < 0.01, `worst ${wMoon.toFixed(4)}° = ${(wMoon * 3600).toFixed(0)}″ (${HZ_MOON.length} dates; the six main terms were 0.10° off here, and without ΔT the series reads 0.016°)`);

  /* comets: Kepler's equation against an independent solution (bisection in the eccentric or hyperbolic anomaly) */
  const kGauss = 0.01720209895;
  function refR(c, dt) {
    let lo, hi, g;
    if (c.e < 1) { const a = c.q / (1 - c.e), M0 = kGauss / Math.pow(a, 1.5) * dt; g = E => E - c.e * Math.sin(E) - M0; lo = M0 - 2; hi = M0 + 2;
      for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (g(m) > 0) hi = m; else lo = m; } return a * (1 - c.e * Math.cos(lo)); }
    const a = c.q / (c.e - 1), M0 = kGauss / Math.pow(a, 1.5) * dt; g = H => c.e * Math.sinh(H) - H - M0; lo = -50; hi = 50;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (g(m) > 0) hi = m; else lo = m; } return a * (c.e * Math.cosh(lo) - 1);
  }
  const orbits = [{ name: 'Encke-like ellipse', q: 0.336, e: 0.8471, i: 11.8, om: 334, w: 187, tp: 2461297, M1: 10, K1: 10, span: 600 },
    { name: 'steep hyperbola', q: 0.05, e: 1.2, i: 30, om: 10, w: 20, tp: 2461297, M1: 10, K1: 10, span: 200 }];
  for (const c of orbits) {
    let worst = 0, bad = 0;
    for (let dt = -c.span; dt <= c.span; dt += 1.37) {
      const ms = (c.tp + dt - 2440587.5) * 86400000, got = A.cometCoords(c, ms);
      if (!isFinite(got.r) || !isFinite(got.ra)) { bad++; continue; }
      const d = Math.abs(got.r - refR(c, dt - got.dist * 0.0057755183)); /* the same light-time as the code */
      worst = Math.max(worst, d);
    }
    check(`comet solver: ${c.name}`, bad === 0 && worst < 1e-6, `largest difference in r ${worst.toExponential(1)} AU, ${bad} non-finite`);
  }

  /* darkness near the pole: latitude −85°, the sun highest at 15:00 UTC; the window starts dark and the sun dips twice */
  const off0 = () => 0;
  let polar = Infinity;
  for (let dd = 0; dd < 7; dd++) {
    const st = A.darkness(Math.floor(Date.UTC(2026, 4, 29) / 86400000) + dd, -85, -45, off0);
    polar = Math.min(polar, st.from == null ? 0 : (st.to - st.from) / 60);
  }
  check('astronomical darkness near the pole (−85°, 29 May – 4 June 2026)', polar > 900, `shortest ${polar.toFixed(0)} min`);

  let trip = 0;
  for (let h = -1.95; h <= 4.5; h += 0.01) trip = Math.max(trip, Math.abs(A.unrefract(A.refract(h)) - h));
  check('refraction round trip from −1.95° to 4.5° (exact inverse below 5° apparent; above, Bennett within 6″)', trip * 3600 < 0.5, `worst ${(trip * 3600).toFixed(3)}″`);

  check('a tall canvas is never tilted past the zenith', MAP.skyProjection(350, 700, 180, null, null, 0.2).c0 <= Math.PI / 2 + 1e-12,
    `${(MAP.skyProjection(350, 700, 180, null, null, 0.2).c0 / R).toFixed(2)}°`);
  const b1875 = MAP.precAngles(Date.UTC(1874, 11, 31, 18, 12)), bnd = MAP.boundsB1875(SKY.bounds);
  const inCep = MAP.toJ2000(30 * R, 87.8 * R, b1875), inUmi = MAP.toJ2000(30 * R, 88.2 * R, b1875);
  check('Cep/UMi boundary along the B1875 parallel of +88° round the pole', MAP.constellationAt(bnd, inCep.ra, inCep.dec) === 'Cep' && MAP.constellationAt(bnd, inUmi.ra, inUmi.dec) === 'UMi',
    `B1875 (30°, +87.8°) → ${MAP.constellationAt(bnd, inCep.ra, inCep.dec)}, (30°, +88.2°) → ${MAP.constellationAt(bnd, inUmi.ra, inUmi.dec)}`);

  /* the IMO's solar longitudes are J2000: at the March equinox 2026 (20 March 14:46 UTC) the apparent longitude is 0°,
     the J2000 one 0.37° less */
  const lamEq = EV.solarLongitude2000(Date.UTC(2026, 2, 20, 14, 46));
  check('solar longitude for J2000 at the March equinox 2026', Math.abs(lamEq - 359.634) < 0.02, `${lamEq.toFixed(3)}°`);
}

/* ---------------------------------------------------------------- eclipses, occultations, Jupiter's moons, meteors */
section('Eclipses, occultations, Jupiter\'s moons, meteor rates, season nights (js/sky-events.js)');
{
  /* lunar eclipses 2025–2030 against NASA's decade table (greatest eclipse in TD, umbral magnitude), searched from twelve places */
  const NASA_LE = [['2025-03-14T06:59:56', 1.178], ['2025-09-07T18:12:58', 1.362], ['2026-03-03T11:34:52', 1.151], ['2026-08-28T04:14:04', 0.930], ['2027-02-20T23:14:06', -0.057],
    ['2027-07-18T16:04:09', -1.068], ['2027-08-17T07:14:59', -0.525], ['2028-01-12T04:14:13', 0.066], ['2028-07-06T18:20:57', 0.389], ['2028-12-31T16:53:15', 1.246],
    ['2029-06-26T03:23:22', 1.844], ['2029-12-20T22:43:12', 1.117], ['2030-06-15T18:34:34', 0.502], ['2030-12-09T22:28:51', -0.163]];
  const leFound = {};
  for (const lon of [-150, -90, -30, 30, 90, 150]) for (const lat of [40, -30]) EV.lunarEclipses(Date.UTC(2025, 0, 1) / 1000, 6.2, 40, lat, lon).forEach(x => { leFound[new Date(x.tt * 1000).toISOString().slice(0, 10)] = x; });
  let leT = 0, leM = 0, leMiss = 0;
  NASA_LE.forEach(([t, mag]) => { const x = leFound[t.slice(0, 10)]; if (!x) { leMiss++; return; } leT = Math.max(leT, Math.abs(x.tt - Date.parse(t + 'Z') / 1000) / 60); leM = Math.max(leM, Math.abs(x.umbral - mag)); });
  check('lunar eclipses 2025–2030 against NASA', !leMiss && Object.keys(leFound).length === NASA_LE.length && leT < 3 && leM < 0.03,
    `${NASA_LE.length - leMiss} of ${NASA_LE.length}, ${Object.keys(leFound).length} found, greatest within ${leT.toFixed(1)} min, umbral magnitude within ${leM.toFixed(3)}`);

  /* the total solar eclipse of 8 April 2024: second and third contact at Dallas and Kerrville (NASA local circumstances) */
  const TOTALITY = [['Dallas', 32.7767, -96.7970, '18:40:44', '18:44:35'], ['Kerrville', 30.0474, -99.1403, '18:32:08', '18:36:32']];
  let seW = 0; const seBad = [];
  TOTALITY.forEach(([n, la, lo, c2, c3]) => {
    const x = EV.solarEclipses(Date.UTC(2024, 2, 20) / 1000, 1, 1, la, lo)[0];
    if (!x || x.type !== 'total') { seBad.push(n); return; }
    seW = Math.max(seW, Math.abs(x.C2 - Date.parse('2024-04-08T' + c2 + 'Z') / 1000), Math.abs(x.C3 - Date.parse('2024-04-08T' + c3 + 'Z') / 1000));
  });
  check('total solar eclipse of 8 April 2024 at Dallas and Kerrville', !seBad.length && seW < 60, seBad.length ? 'not total at ' + seBad.join(', ') : `second and third contact within ${seW.toFixed(0)} s (with a geocentric sun it was 51 s)`);
  /* the eclipse of 12 August 2026 ends at its southern limit about 34 km north of Madrid (partial there, 0.997), and Zaragoza
     is well inside; with a geocentric sun the limit lay 42 km too far south and Madrid came out total */
  const LIMIT = [['Madrid', 40.4168, -3.7038], ['Zaragoza', 41.6488, -0.8891]].map(([n, la, lo]) => { const x = EV.solarEclipses(Date.UTC(2026, 7, 1) / 1000, 1, 1, la, lo)[0]; return { n, type: x && x.type, mag: x ? x.magnitude : NaN }; });
  check('solar eclipse of 12 August 2026: partial at Madrid (magnitude 0.99–1.0, sun topocentric), total at Zaragoza', LIMIT[0].type === 'partial' && LIMIT[0].mag > 0.99 && LIMIT[0].mag < 1 && LIMIT[1].type === 'total',
    LIMIT.map(l => `${l.n} ${l.type} ${l.mag.toFixed(4)}`).join(', '));

  /* the occultation of Regulus on 3 February 2026 against the RASC Observer's Handbook (disappearance, reappearance, UT) */
  const ri = SKY.stars.findIndex(st => st[5] === 'Regulus'), rMs = Date.UTC(2026, 1, 3, 2);
  const rMoved = MAP.moved(SKY.stars[ri][0], SKY.stars[ri][1], SKY.motion[3 * ri], SKY.motion[3 * ri + 1], MAP.skyYears(rMs)), rPos = MAP.precessRig(rMoved[0], rMoved[1], MAP.precAngles(rMs));
  const RASC = [['Halifax', 44.6, -63.6, 120.2, 190.6], ['Montréal', 45.5, -73.6, 112.2, 178.6], ['Toronto', 43.7, -79.4, 108.7, 171.1]]; /* minutes after 0h UT */
  let ocW = 0; const ocBad = [];
  RASC.forEach(([n, la, lo, dm, rm]) => {
    const x = EV.occultations(Date.UTC(2026, 1, 3, 0) / 1000, Date.UTC(2026, 1, 3, 5) / 1000, la, lo, [{ name: 'Regulus', mag: 1.4, ra: rPos.ra, dec: rPos.dec }])[0];
    if (!x || !x.dis || !x.re) { ocBad.push(n); return; }
    const t0 = Date.UTC(2026, 1, 3) / 1000;
    ocW = Math.max(ocW, Math.abs(x.dis.t - t0 - dm * 60), Math.abs(x.re.t - t0 - rm * 60));
  });
  check('occultation of Regulus on 3 February 2026 against the RASC Observer\'s Handbook', !ocBad.length && ocW < 45, ocBad.length ? 'missing at ' + ocBad.join(', ') : `within ${ocW.toFixed(0)} s at Halifax, Montréal and Toronto`);
  /* dark or bright limb by geometry (the terminator meets the limb 90° from the bright-limb point at every phase): Jupiter on
     6 October 2026 at Toronto, a 20 % crescent, disappears at the bright and reappears at the dark limb as RASC prints (DB, RD);
     Regulus reappears 170° from the bright-limb point, so at the dark limb — RASC prints RB there, one day after full moon,
     where the dark sliver at the limb is about 30″ wide */
  const jOcc = EV.occultations(Date.UTC(2026, 9, 6, 7) / 1000, Date.UTC(2026, 9, 6, 11) / 1000, 43.7, -79.4, [{ name: 'Jupiter', mag: -1.7, planet: A.PLANETS.find(p => p.id === 'jupiter') }])[0];
  const rOcc = EV.occultations(Date.UTC(2026, 1, 3, 0) / 1000, Date.UTC(2026, 1, 3, 5) / 1000, 43.7, -79.4, [{ name: 'Regulus', mag: 1.4, ra: rPos.ra, dec: rPos.dec }])[0];
  const limb = x => x && x.dis && x.re ? (x.dis.dark ? 'DD' : 'DB') + ' ' + (x.re.dark ? 'RD' : 'RB') : 'missing';
  check('dark and bright limb at the occultations of Jupiter (RASC: DB, RD) and Regulus (geometry: DB, RD) at Toronto', limb(jOcc) === 'DB RD' && limb(rOcc) === 'DB RD', `Jupiter ${limb(jOcc)}, Regulus ${limb(rOcc)}`);

  /* Jupiter's moons, 20–23 September 2026, against Project Pluto's event list (UT) */
  const PLUTO = [['I Ecl start', '2026-09-20T14:22'], ['I Occ end', '2026-09-20T17:29'], ['II Sha start', '2026-09-21T01:44'], ['II Tra start', '2026-09-21T03:24'], ['II Sha end', '2026-09-21T04:37'],
    ['II Tra end', '2026-09-21T06:18'], ['I Sha start', '2026-09-21T11:43'], ['I Tra start', '2026-09-21T12:33'], ['I Sha end', '2026-09-21T14:00'], ['I Tra end', '2026-09-21T14:51'],
    ['III Sha start', '2026-09-22T01:38'], ['III Tra start', '2026-09-22T05:02'], ['III Sha end', '2026-09-22T05:16'], ['III Tra end', '2026-09-22T08:42'], ['I Ecl start', '2026-09-22T08:50'],
    ['I Occ end', '2026-09-22T11:59'], ['II Ecl start', '2026-09-22T20:51'], ['II Occ end', '2026-09-23T01:28']];
  const k1 = 1 / (1 - 0.0649), NM = ['I', 'II', 'III', 'IV'], KN = ['Tra', 'Sha', 'Occ', 'Ecl'], jOurs = {};
  const jStates = t => MAP.galileanMoons((t + EV.DELTA_T) * 1000).map(m => { const inE = m.X * m.X + (m.Y * k1) ** 2 < 1, inS = m.Xs * m.Xs + (m.Ys * k1) ** 2 < 1; return [m.front && inE, m.frontSun && inS, !m.front && inE, !m.frontSun && inS]; });
  let jPrev = jStates(Date.UTC(2026, 8, 20) / 1000);
  for (let t = Date.UTC(2026, 8, 20) / 1000 + 30; t <= Date.UTC(2026, 8, 23, 3) / 1000; t += 30) {
    const cur = jStates(t);
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) if (cur[k][j] !== jPrev[k][j]) { const key = NM[k] + ' ' + KN[j] + (cur[k][j] ? ' start' : ' end'); (jOurs[key] = jOurs[key] || []).push(t); }
    jPrev = cur;
  }
  let jW = 0, jMiss = 0;
  PLUTO.forEach(([ev, t]) => { const ref = Date.parse(t + 'Z') / 1000, c = (jOurs[ev] || []).map(x => Math.abs(x - ref)).sort((a, b) => a - b)[0]; if (c == null || c > 3600) jMiss++; else jW = Math.max(jW, c / 60); });
  const jList = EV.jupiterEvents(Date.UTC(2026, 8, 21, 1) / 1000, Date.UTC(2026, 8, 21, 11) / 1000, 31.5471, -99.3823);
  check('events of Jupiter\'s moons against Project Pluto', !jMiss && jW < 6 && Array.isArray(jList), `${PLUTO.length - jMiss} of ${PLUTO.length} within ${jW.toFixed(1)} min; ${jList.length} listed for Starfront on 21 September`);

  /* meteor rate, galactic centre and a season night at Starfront */
  const rows = [];
  for (let t = Date.UTC(2026, 7, 12, 0) / 1000; t <= Date.UTC(2026, 7, 12, 13) / 1000; t += 600) rows.push({ t: t, sun: A.sunHorizontal(t * 1000, 31.5471, -99.3823), moon: A.bodyAt('moon', t, 31.5471, -99.3823) });
  const per = EV.meteorRate(EV.SHOWERS.find(x => x.key === 'PER'), rows, 31.5471, -99.3823, 6.5), perCity = EV.meteorRate(EV.SHOWERS.find(x => x.key === 'PER'), rows, 31.5471, -99.3823, 4.5);
  check('Perseid rate at the 2026 peak: dozens per hour under a dark sky, far fewer in a city', per.hr > 40 && per.hr < 110 && perCity.hr < per.hr / 3, `${per.hr.toFixed(0)}/h dark, ${perCity.hr.toFixed(0)}/h city`);
  const gcS = EV.galacticCentre(rows, 31.5471, -99.3823);
  check('galactic centre season at Starfront: summer yes, December no', gcS.months[5] >= 4 && gcS.months[11] === 0, gcS.months.map(h => h.toFixed(1)).join(' '));
  const m31 = A.precessJ2000(10.6847, 41.2690, Date.UTC(2026, 9, 10)), night = EV.nightSummary(t => A.horizontalOf(m31.ra, m31.dec, t * 1000, 31.5471, -99.3823), Date.UTC(2026, 9, 10, 17) / 1000, Date.UTC(2026, 9, 11, 17) / 1000, 31.5471, -99.3823, 900, false);
  check('season night: M31 at Starfront, 10 October 2026 (new moon)', night.dark > 9 && night.dark < 11 && night.above30 > 8 && Math.abs(night.above30 - night.above30Moonless) < 0.01 && night.maxAlt > 75 && night.maxAlt < 85,
    `dark ${night.dark.toFixed(1)} h, above 30° ${night.above30.toFixed(1)} h, highest ${night.maxAlt.toFixed(1)}°`);
}

/* ---------------------------------------------------------------- double stars */
section('Double stars (data/doubles.json)');
{
  let dbl = null;
  try { dbl = JSON.parse(read('data/doubles.json')); } catch (e) { check('doubles.json reads', false, e.message); }
  if (dbl) {
    const F = dbl.fields, ix = n => F.indexOf(n), bad = dbl.objects.filter(o => !(o.length === F.length && o[ix('ra')] >= 0 && o[ix('ra')] < 360 && Math.abs(o[ix('dec')]) <= 90 && o[ix('sep')] >= 1.5 && o[ix('sep')] <= 60 && o[ix('pa')] >= 0 && o[ix('pa')] < 360 && o[ix('m2')] >= o[ix('m1')] - 0.5));
    check('pairs well formed (1.5–60″, position angle, magnitudes)', dbl.objects.length > 300 && !bad.length, `${dbl.objects.length} pairs` + (bad.length ? '; bad: ' + bad.slice(0, 5).map(o => o[0]).join(', ') : ''));
    const SHOW = { Albireo: [34.7, 54], Mizar: [14.4, 153], Castor: [5.4, 51], Izar: [2.9, 347], Rigel: [9.4, 204], Polaris: [18.4, 236] }, miss = [];
    Object.keys(SHOW).forEach(n => { const o = dbl.objects.find(x => x[ix('name')] === n); if (!o || Math.abs(o[ix('sep')] - SHOW[n][0]) > 1.5 || Math.abs(o[ix('pa')] - SHOW[n][1]) > 5) miss.push(n); });
    check('showpieces present with WDS separation and angle (Albireo, Mizar, Castor, Izar, Rigel, Polaris)', !miss.length, miss.length ? 'missing or off: ' + miss.join(', ') : '');
    let far = 0;
    dbl.objects.filter(o => o[ix('name')]).forEach(o => { const st = SKY.stars.find(x => x[5] === o[ix('name')]); if (!st || sep(st[0], st[1], o[ix('ra')], o[ix('dec')]) * 3600 > 60) far++; });
    check('named primaries within 60″ of the star catalogue', far === 0, `${dbl.objects.filter(o => o[ix('name')]).length} named, ${far} off`);
    check('source named in the file', /Washington Double Star/.test(dbl.source) && /SIMBAD/.test(dbl.source));
    /* several pairs per system: the Double Double keeps both pairs, primaries are component A where there is one */
    const pairOf = (w, c) => dbl.objects.find(o => o[0] === w && (o[ix('comp')] || 'AB') === c);
    check('ε Lyrae keeps both pairs (STF2382 AB, STF2383 CD) and σ Ori AB,D and AB,E', !!(pairOf('18443+3940', 'AB') && pairOf('18443+3940', 'CD') && pairOf('05387-0236', 'AB,D') && pairOf('05387-0236', 'AB,E')));
    const fainter = dbl.objects.filter(o => o[ix('m1')] > o[ix('m2')]);
    check('primary A where there is one (ζ Cnc AB,C, ξ Sco AC) and no primary fainter than its companion', !!(pairOf('08122+1739', 'AB,C') && pairOf('16044-1122', 'AC')) && !pairOf('08122+1739', 'BC') && !fainter.length,
      fainter.length ? 'fainter: ' + fainter.slice(0, 5).map(o => o[1]).join(', ') : '');
  }
}

/* ---------------------------------------------------------------- orbital data */
section('Orbital data (data/sky-events.json)');
{
  let data = null;
  try { data = JSON.parse(read('data/sky-events.json')); } catch (e) { check('sky-events.json reads', false, e.message); }
  if (data) {
    check('satellites and comets present', data.satellites.length >= 3 && Array.isArray(data.comets), `${data.satellites.length} satellites, ${data.comets.length} comets`);
    const newest = Math.max(...data.satellites.map(s => EV.parseTle(s.tle1, s.tle2).epochMs)), age = (Date.now() - newest) / 86400000;
    if (age > 14) warn('satellite orbits are old', `${age.toFixed(0)} days — run node astro-tools/tools/sky-events-data.js before deploying`);
    else check('satellite orbits fresh enough for pass predictions', true, `${age.toFixed(1)} days old`);
    /* pass edges to the second: one second before a pass's start and after its end the satellite is not visible */
    const lat = 31.547, lon = -99.382, from = Date.now() / 1000, to = from + 2 * 86400;
    let edges = 0, wrong = 0;
    data.satellites.slice(0, 2).forEach(sat => {
      const rec = EV.sgp4init(EV.parseTle(sat.tle1, sat.tle2));
      const seen = t => { if (A.sunAltitude(t * 1000, lat, lon) >= -6) return false; const lk = EV.satelliteLook(rec, t * 1000, lat, lon, sat.std); return !!(lk && lk.alt > 10 && lk.lit); };
      EV.satellitePasses(sat, from, to, lat, lon).forEach(ps => {
        if (ps.start > from + 20) { edges++; if (seen(ps.start - 1.5) || !seen(ps.start + 0.5)) wrong++; }
        if (ps.end < to - 20) { edges++; if (seen(ps.end + 1.5) || !seen(ps.end - 0.5)) wrong++; }
      });
    });
    check('satellite pass start and end to the second (Starfront, next two days)', wrong === 0, `${edges} edges, ${wrong} off`);
  }
}

/* ---------------------------------------------------------------- weather pages */
section('Weather pages (astro-weather, weather-history)');
{
  /* the shared scoring and colour module both weather pages build on */
  try { new vm.Script(read('js/weather-core.js'), { filename: 'js/weather-core.js' }); check('js/weather-core.js parses', true); }
  catch (e) { check('js/weather-core.js parses', false, e.message); }
  try { new vm.Script(read('js/weather-history.js'), { filename: 'js/weather-history.js' }); check('js/weather-history.js parses', true); }
  catch (e) { check('js/weather-history.js parses', false, e.message); }

  const wxBox = { window: { SvAstro: A } };
  vm.createContext(wxBox);
  vm.runInContext(read('js/weather-core.js'), wxBox, { filename: 'js/weather-core.js' });
  const WX = wxBox.window.SvWx;
  check('SvWx exports scoring, colours and the canvas primitives',
    !!(WX && WX.cloudScore && WX.overallScore && WX.scoreColour && WX.ratingColour && WX.stickyLabels && WX.cellPaint));
  if (WX) {
    /* the values astro-weather relied on before the extraction */
    check('cloudScore maps 0/50/100 % to 1/0.5/0',
      WX.cloudScore(0) === 1 && WX.cloudScore(50) === 0.5 && WX.cloudScore(100) === 0 && WX.cloudScore(null) === null);
    check('overallScore squares the cloud term and hands a missing estimate its weight over',
      Math.abs(WX.overallScore(1, null, null) - 1) < 1e-12 &&
      Math.abs(WX.overallScore(0.5, null, null) - 0.25) < 1e-12 &&
      Math.abs(WX.overallScore(1, 1, 1) - 1) < 1e-12 &&
      Math.abs(WX.overallScore(1, 0, 0) - 0.7) < 1e-12);
    check('rating cuts unchanged at 0.25 / 0.45 / 0.65 / 0.85',
      JSON.stringify(WX.RATING_CUTS) === '[0.25,0.45,0.65,0.85]' &&
      WX.ratingIndex(0.9) === 4 && WX.ratingIndex(0.7) === 3 && WX.ratingIndex(0.5) === 2 &&
      WX.ratingIndex(0.3) === 1 && WX.ratingIndex(0.1) === 0 && WX.ratingIndex(null) === null);
    check('scoreColour keeps the blue ramp and the no-data grey',
      WX.scoreColour(1) === 'rgb(30,88,190)' && WX.scoreColour(0) === 'rgb(198,208,220)' && WX.scoreColour(null) === WX.COL.noData);
  }

  /* both page pairs: script order, and the ids the scripts look up */
  const pageSets = [
    { name: 'astro-weather', prefix: 'aw', scripts: ['js/astro-weather.js'],
      want: ['main.js', 'cookie-consent.js', 'astro-core.js', 'weather-core.js', 'astro-weather.js'] },
    { name: 'weather-history', prefix: 'wh', scripts: ['js/weather-history.js'],
      want: ['main.js', 'cookie-consent.js', 'astro-core.js', 'weather-core.js', 'weather-history.js'] }
  ];
  for (const p of pageSets) {
    const ids = {};
    for (const lang of ['de', 'en']) {
      const html = read(p.name + '_' + lang + '.html');
      const got = [...html.matchAll(/<script src="(?:\.\.\/)?js\/([^"?]+)(?:\?v=[0-9a-f]+)?"/g)].map(m => m[1]);
      check(`script order, ${p.name} (${lang})`, JSON.stringify(got) === JSON.stringify(p.want), got.join(', '));
      check(`${p.name} (${lang}) loads the consent script`, /cookie-consent\.js/.test(html));
      ids[lang] = new Set([...html.matchAll(new RegExp('\\sid="(' + p.prefix + '-[^"]+)"', 'g'))].map(m => m[1]));
    }
    const diff = [...ids.de].filter(x => !ids.en.has(x)).concat([...ids.en].filter(x => !ids.de.has(x)));
    check(`same ${p.prefix}-* element ids in DE and EN, ${p.name}`, diff.length === 0,
      ids.de.size + ' ids' + (diff.length ? '; differing: ' + diff.join(', ') : ''));
    const used = [...new Set([...p.scripts.map(read).join('').matchAll(new RegExp("getElementById\\('(" + p.prefix + "-[^']+)'\\)", 'g'))].map(m => m[1]))];
    const missing = used.filter(x => !ids.de.has(x));
    check(`every element id ${p.name} looks up exists`, missing.length === 0,
      used.length + ' looked up' + (missing.length ? '; missing: ' + missing.join(', ') : ''));
  }
}

/* ---------------------------------------------------------------- forecast history */
section('Forecast history (js/weather-history.js)');
{
  const wh = read('js/weather-history.js');

  /* The page computes everything live in the browser; there is no generated file any more.
     The chain per lead is what the forecast page would have used: the finest model that still
     reaches that far. Short-range models drop out by themselves after about a day. */
  const WANT_CHAIN = {
    starfront: ['ncep_hrrr_conus', 'cmc_gem_seamless', 'ncep_gfs_global'],
    hannover: ['icon_d2', 'dmi_harmonie_arome_europe', 'icon_eu', 'icon_global'],
    andreasberg: ['icon_d2', 'dmi_harmonie_arome_europe', 'icon_eu', 'icon_global'],
    gaucin: ['icon_eu', 'icon_global']
  };
  const wrong = [];
  for (const key in WANT_CHAIN) {
    const m = wh.match(new RegExp("key: '" + key + "'[\\s\\S]*?chain: \\[([^\\]]*)\\]"));
    if (!m) { wrong.push(key + ': not in SITES'); continue; }
    const got = m[1].split(',').map(x => x.trim().replace(/'/g, ''));
    if (JSON.stringify(got) !== JSON.stringify(WANT_CHAIN[key])) wrong.push(`${key}: ${got.join(', ')}`);
  }
  /* Gaucín lies outside both fine-mesh domains — naming them there would be wrong */
  check('the model chain per location matches the forecast page', wrong.length === 0, wrong.join('; '));

  check('the archive is read one station at a time', /setTimeout\(r, 1100\)/.test(wh) && /429/.test(wh),
    'the ASOS archive answers 429 to parallel requests');
  check('nights are counted from the running night, not from a calendar date',
    /nightKeyOf\(nowSec, off\)/.test(wh) && /st\.to > nowSec/.test(wh));
  check('night means keep the 80 % darkness-coverage gate', /MIN_COVER = 0\.8/.test(wh));

  /* CLAUDE.md: every host the browser contacts has to stand in the privacy policy, with the page
     it loads on. This is the one rule that cannot be checked by looking at the page alone. */
  const HOSTS = ['previous-runs-api.open-meteo.com', 'mesonet.agron.iastate.edu'];
  const scripts = ['js/weather-history.js', 'js/astro-weather.js', 'js/observing-planner.js', 'js/sky-map.js']
    .map(f => read(f)).join('');
  const priv = { de: fs.readFileSync(path.join(ROOT, '..', 'privacy', 'privacy_de.html'), 'utf8'),
    en: fs.readFileSync(path.join(ROOT, '..', 'privacy', 'privacy_en.html'), 'utf8') };
  const undisclosed = [];
  for (const h of HOSTS) {
    if (!scripts.includes(h)) { undisclosed.push(h + ': not requested any more — drop it from this list'); continue; }
    for (const lang of ['de', 'en']) if (!priv[lang].includes(h)) undisclosed.push(h + ' missing from privacy_' + lang + '.html');
  }
  check('every third-party host the history page calls is named in the privacy policy', undisclosed.length === 0, undisclosed.join('; '));
}

console.log(`\n${passed} passed, ${failed} failed, ${warned} warnings`);
process.exitCode = failed ? 1 : 0;
