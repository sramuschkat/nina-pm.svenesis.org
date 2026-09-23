#!/usr/bin/env node
/*
 * Thumbnails for the info card of the star map's further objects: one 128 × 128 px JPEG per row of astro-tools/data/ngc.json
 * in astro-tools/img/ngc/ (file name from ngcThumb() in sky-map.js: lower case, letters and digits only), cut from the
 * Digitized Sky Survey (DSS2, colour) with the hips2fits service of CDS Strasbourg. The field of view is 2.5 × the object's
 * size between 4′ and 10°; without a size 6′ for galaxies and stars, 12′ otherwise. Existing files are kept unless --force
 * is given; --prune deletes images of rows that no longer exist. Four requests run at a time.
 *
 * With --large it cuts 320 × 320 px images into astro-tools/img/ngc-l/ instead (ngcThumbL()), only for the rows that join the
 * imaging list (imagingCandidate() in sky-map.js), with the catalogue thumbnails' field (1.8 × the size, 12′ to 5°) for the
 * gallery and the hover preview; --prune there removes images of rows that are no candidates any more.
 *
 *   node astro-tools/tools/ngc-thumbnails.js [--large] [--force] [--prune]
 *
 * tools/ is not deployed; the images are (30-day tier of deploy.sh). Credit on the page: DSS and hips2fits (CDS).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), large = process.argv.includes('--large'), OUT = path.join(ROOT, 'img', large ? 'ngc-l' : 'ngc');
const force = process.argv.includes('--force'), prune = process.argv.includes('--prune');
const sandbox = { window: {}, console };
for (const f of ['js/astro-core.js', 'js/dso-catalog.js', 'js/star-catalog.js', 'js/sky-map.js']) vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
const MAP = sandbox.window.SvSkyMap;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ngc.json'), 'utf8')).objects.filter(r => !large || MAP.imagingCandidate(r));
const fileOf = row => path.join(ROOT, (large ? MAP.ngcThumbL : MAP.ngcThumb)(row[0]));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const names = new Set(rows.map(r => path.basename(fileOf(r))));
  if (names.size !== rows.length) throw new Error(`file names not unique: ${rows.length} rows, ${names.size} names`);
  if (prune) fs.readdirSync(OUT).filter(f => !names.has(f)).forEach(f => fs.unlinkSync(path.join(OUT, f)));
  const todo = rows.filter(r => force || !fs.existsSync(fileOf(r)));
  let made = 0, next = 0;
  const failed = [];
  async function worker() {
    while (next < todo.length) {
      const row = todo[next++], size = row[4], small = ['Gx', 'St', 'DS'].includes(row[3]);
      const fov = large ? Math.min(300, Math.max(12, size * 1.8)) / 60 : Math.min(600, Math.max(4, size ? size * 2.5 : small ? 6 : 12)) / 60;
      const url = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&width=' + (large ? 320 : 128) + '&height=' + (large ? 320 : 128) + '&projection=TAN&coordsys=icrs&format=jpg' +
        `&fov=${fov.toFixed(4)}&ra=${row[1]}&dec=${row[2]}`;
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'svenesis.org observing planner thumbnails' } });
          const buf = Buffer.from(await res.arrayBuffer());
          if (!res.ok || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('HTTP ' + res.status);
          fs.writeFileSync(fileOf(row), buf); ok = true; made++;
        } catch (e) { if (attempt === 2) failed.push(row[0] + ' (' + e.message + ')'); else await sleep(3000 * (attempt + 1)); }
      }
      if ((made + failed.length) % 500 === 0) console.log(`${made + failed.length} / ${todo.length}`);
      await sleep(150); /* be gentle with the service */
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`made ${made}, kept ${rows.length - todo.length}, failed ${failed.length}${failed.length ? ': ' + failed.slice(0, 30).join(', ') : ''}`);
  if (failed.length) process.exitCode = 1;
})();
