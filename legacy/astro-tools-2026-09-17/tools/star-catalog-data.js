#!/usr/bin/env node
/*
 * Regenerates the star data of the observing planner. Put these files into one folder, then run
 *
 *   node astro-tools/tools/star-catalog-data.js <folder>
 *
 *   stars.6.json, stars.8.json, starnames.json, constellations.bounds.json
 *       from d3-celestial by Olaf Frohn (BSD 3-clause licence, https://github.com/ofrohn/d3-celestial/tree/master/data)
 *   hip2_pm.tsv
 *       proper motions and parallaxes of the Hipparcos new reduction (van Leeuwen 2007, VizieR I/311/hip2), fetched as
 *       https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/311/hip2&-out=HIP&-out=Plx&-out=pmRA&-out=pmDE&-out.max=unlimited&Hpmag=%3C9.3
 *
 * Writes
 *   astro-tools/js/star-catalog.js           stars down to 6.0 mag with IAU proper names and Bayer letters, their proper motions and
 *                                parallaxes, and the IAU constellation boundaries; constellation lines, label positions
 *                                and the Milky Way grid are carried over unchanged from the existing file
 *   astro-tools/data/stars-8.bin   the stars fainter than 6.0 down to 8.0 mag, which the page fetches when zoomed in:
 *                                12-byte header ("SVST", uint16 version 2, uint16 record size 12, uint32 count), then per
 *                                star, little-endian: RA uint16 (full circle), Dec int16 (±90° = ±32767), mag × 20 uint8,
 *                                B−V × 50 int8, pmRA·cos Dec int16 and pmDec int16 (mas per year), parallax uint16
 *                                (0.1 mas, 0 where unknown or not positive); sorted bright to faint
 *
 * The d3-celestial positions are J2000 at epoch 2000 (61 Cygni and Groombridge 1830 match the Hipparcos epoch-1991.25
 * positions moved by their proper motion to 2000 within 0.2″), so the page moves stars from 2000 to the night.
 *
 * Star names: names already in astro-tools/js/star-catalog.js keep their spelling (Arktur, Prokyon, Beteigeuze, Polarstern, Rigil
 * Kentaurus); other stars carry their IAU name in both languages, because the German names in starnames.json are uneven
 * (Svalocin, Untoter im Schwan, …). A name is given once only, to the brightest star carrying it.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..'), SRC = process.argv[2];
if (!SRC) { console.error('usage: node astro-tools/tools/star-catalog-data.js <folder with the data files listed at the top>'); process.exit(1); }
const read = f => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
const stars6 = read('stars.6.json').features, stars8 = read('stars.8.json').features, names = read('starnames.json');
const bounds = read('constellations.bounds.json').features;
const motion = {};
fs.readFileSync(path.join(SRC, 'hip2_pm.tsv'), 'utf8').split('\n').forEach(l => {
  const f = l.split('\t');
  if (f.length >= 4 && /^\s*\d+\s*$/.test(f[0])) motion[+f[0]] = { plx: parseFloat(f[1]), pmra: parseFloat(f[2]), pmde: parseFloat(f[3]) };
});

const catFile = path.join(ROOT, 'js', 'star-catalog.js'), catText = fs.readFileSync(catFile, 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(catText, sandbox);
const OLD = sandbox.window.SvSky;
const licenceAt = catText.indexOf(' * The licence of d3-celestial requires'), tailAt = catText.indexOf('\n  lines:');
if (!OLD || licenceAt < 0 || tailAt < 0) { console.error('js/star-catalog.js does not have the expected layout'); process.exit(1); }

const radec = f => { const c = f.geometry.coordinates; return [((c[0] % 360) + 360) % 360, c[1]]; };
const bvOf = f => { const v = parseFloat(f.properties.bv); return isFinite(v) ? v : null; };
const r3 = v => Math.round(v * 1000) / 1000;
const GREEK = /^[α-ω]/;
const mot = id => motion[id] || { plx: 0, pmra: 0, pmde: 0 };

/* ---------- astro-tools/js/star-catalog.js: stars to 6.0 mag ---------- */
const oldNamed = OLD.stars.filter(s => s[4]);
const used = new Set(), triples = [];
const sorted6 = stars6.filter(f => f.properties.mag <= 6).sort((a, b) => a.properties.mag - b.properties.mag);
const rows = sorted6.map(f => {
  const [ra, dec] = radec(f), mag = f.properties.mag, n = names[f.id] || {};
  /* matched within rounding (0.0015°) and by magnitude: the pair α Centauri lies only 0.006° apart */
  const old = oldNamed.find(s => Math.abs(s[0] - ra) < 0.0015 && Math.abs(s[1] - dec) < 0.0015 && s[2] === mag);
  let de = old ? old[4] : (n.name || ''), en = old ? old[5] : (n.name || '');
  if (en && used.has(en)) { de = ''; en = ''; } /* close pairs such as α Centauri: the name goes to the brighter one */
  if (en) used.add(en);
  const bayer = GREEK.test(n.bayer || '') ? n.bayer : '';
  const bv = bvOf(f), m = mot(f.id);
  triples.push(Math.round(m.pmra), Math.round(m.pmde), m.plx > 0 ? Math.round(m.plx * 10) / 10 : 0);
  const cells = [r3(ra), r3(dec), mag, (bv == null ? 0.6 : Math.round(bv * 10) / 10).toFixed(1)];
  if (en || bayer) cells.push(JSON.stringify(de), JSON.stringify(en));
  if (bayer) cells.push(JSON.stringify(bayer));
  return '    [' + cells.join(', ') + ']';
});
const missing = oldNamed.filter(s => !rows.some(r => r.includes(JSON.stringify(s[5]))));
if (missing.length) { console.error('names lost:', missing.map(s => s[5]).join(', ')); process.exit(1); }
const motionLines = [];
for (let i = 0; i < triples.length; i += 60) motionLines.push('    ' + triples.slice(i, i + 60).join(','));

const boundLines = bounds.map(b => {
  const ring = b.geometry.coordinates[0], flat = [];
  ring.forEach(c => flat.push(r3(((c[0] % 360) + 360) % 360), r3(c[1])));
  return '    [' + JSON.stringify(b.id) + ', [' + flat.join(',') + ']]';
});

const header = `/*
 * Stars, constellation figures and boundaries for the observing planner (astro-tools/js/observing-planner.js, astro-tools/js/sky-map.js)
 *
 * Generated by astro-tools/tools/star-catalog-data.js from the data files of d3-celestial by Olaf Frohn
 * (https://github.com/ofrohn/d3-celestial): stars down to magnitude 6.0 from the XHIP compilation of Hipparcos data,
 * J2000 positions at epoch 2000 (spot-checked against SIMBAD), IAU star names and Bayer letters, constellation lines,
 * label positions after the IAU constellation charts and the IAU constellation boundaries; proper motions and parallaxes
 * from the Hipparcos new reduction (van Leeuwen 2007, VizieR I/311). The stars from 6.0 to 8.0 mag, from the same
 * sources, lie in astro-tools/data/stars-8.bin and are fetched when the star map is zoomed in. Reduced to arrays:
 *   stars:  [ra°, dec°, mag, B−V, name de, name en, Bayer letter] – bright to faint; names for every star with an IAU
 *           proper name (the page shows them by zoom level), German where the German name differs; the name fields
 *           and the Bayer letter are left out where a star has none
 *   motion: three numbers per star, in the order of stars: proper motion in RA (times cos Dec) and in Dec in mas per
 *           year, parallax in mas (0 where unknown or not positive)
 *   bounds: [IAU abbreviation, [ra°, dec°, …]] – one closed ring per constellation (Serpens twice), J2000 corners of
 *           the boundaries the IAU drew along the parallels and hour circles of B1875
 *   lines:  { IAU abbreviation: [[ra°, dec°, ra°, dec°, …], …] } – polylines
 *   labels: [IAU abbreviation, ra°, dec°, rank 1–3, German name, Latin IAU name, English everyday name] – German names as in
 *           the German Wikipedia's list of constellations; the Latin IAU names, used in astronomy and in the US (Serpens keeps
 *           Caput and Cauda); English names after the Meaning column of the English Wikipedia's list of IAU constellations
 *   milkyWay: Milky Way outlines in five brightness steps (Milky Way Outline Catalog, Jose R. Vieira), filled into
 *             a 0.5° grid of J2000 RA/Dec: rows from Dec +90° southwards, columns from RA 0° eastwards,
 *             run-length coded as a letter a–f for step 0–5 followed by the length of the run
 *
`;
const out = header + catText.slice(licenceAt, catText.indexOf('*/', licenceAt) + 2) + '\nwindow.SvSky = {\n  stars: [\n' + rows.join(',\n') +
  '\n  ],\n  motion: [\n' + motionLines.join(',\n') + '\n  ],\n  bounds: [\n' + boundLines.join(',\n') + '\n  ],' + catText.slice(tailAt);
const check = { window: {} };
vm.runInNewContext(out, check);
if (JSON.stringify(check.window.SvSky.lines) !== JSON.stringify(OLD.lines) || JSON.stringify(check.window.SvSky.labels) !== JSON.stringify(OLD.labels) ||
  check.window.SvSky.milkyWay.rle !== OLD.milkyWay.rle) { console.error('lines, labels or Milky Way would change'); process.exit(1); }
if (check.window.SvSky.motion.length !== 3 * rows.length) { console.error('motion does not match the stars'); process.exit(1); }
fs.writeFileSync(catFile, out);

/* ---------- astro-tools/data/stars-8.bin: 6.0 to 8.0 mag ---------- */
const deep = stars8.filter(f => f.properties.mag > 6 && f.properties.mag <= 8).sort((a, b) => a.properties.mag - b.properties.mag);
const REC = 12, buf = Buffer.alloc(12 + REC * deep.length), i16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));
buf.write('SVST', 0, 'ascii'); buf.writeUInt16LE(2, 4); buf.writeUInt16LE(REC, 6); buf.writeUInt32LE(deep.length, 8);
deep.forEach((f, i) => {
  const [ra, dec] = radec(f), o = 12 + REC * i, bv = bvOf(f), m = mot(f.id);
  buf.writeUInt16LE(Math.round(ra / 360 * 65536) % 65536, o);
  buf.writeInt16LE(Math.round(dec / 90 * 32767), o + 2);
  buf.writeUInt8(Math.round(f.properties.mag * 20), o + 4);
  buf.writeInt8(Math.max(-128, Math.min(127, Math.round((bv == null ? 0.6 : bv) * 50))), o + 5);
  buf.writeInt16LE(i16(m.pmra), o + 6);
  buf.writeInt16LE(i16(m.pmde), o + 8);
  buf.writeUInt16LE(m.plx > 0 ? Math.min(65535, Math.round(m.plx * 10)) : 0, o + 10);
});
const binFile = path.join(ROOT, 'data', 'stars-8.bin');
fs.writeFileSync(binFile, buf);

const S = check.window.SvSky, named = S.stars.filter(s => s[5]).length, lettered = S.stars.filter(s => s[6]).length;
const noMotion = sorted6.filter(f => !motion[f.id]).length + deep.filter(f => !motion[f.id]).length;
console.log(`js/star-catalog.js: ${rows.length} stars to 6.0 mag, ${named} with names, ${lettered} with Bayer letters, ${bounds.length} boundary rings, ${fs.statSync(catFile).size} bytes`);
console.log(`data/stars-8.bin: ${deep.length} stars 6.0–8.0 mag, ${buf.length} bytes; stars without Hipparcos motion: ${noMotion}`);
