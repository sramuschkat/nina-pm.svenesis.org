/*
 * Thumbnails for the observing planner's top list: one 320 × 320 px JPEG per object of astro-tools/js/dso-catalog.js in astro-tools/img/dso/,
 * cut from the Digitized Sky Survey (DSS2, colour) with the hips2fits service of CDS Strasbourg. The field of view
 * follows the object's size (1.8 × its size, between 12′ and 5°). Existing files are kept unless --force is given.
 *
 *   node astro-tools/tools/dso-thumbnails.js [--force]
 *
 * tools/ is not deployed; the images in astro-tools/img/dso/ are. Credit on the page: DSS (STScI/AURA, Caltech/Palomar,
 * UK Schmidt/AAO) and hips2fits (CDS).
 */
const fs = require('fs'), path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'js', 'dso-catalog.js'));
const OUT = path.join(__dirname, '..', 'img', 'dso'), force = process.argv.includes('--force');
const slug = id => id.toLowerCase().replace(/\s+/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let made = 0, kept = 0, failed = [];
  for (const o of window.SvDSO) {
    const file = path.join(OUT, slug(o.id) + '.jpg');
    if (!force && fs.existsSync(file)) { kept++; continue; }
    const fov = Math.min(300, Math.max(12, o.s * 1.8)) / 60;
    const url = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&width=320&height=320&projection=TAN&coordsys=icrs&format=jpg' +
      `&fov=${fov.toFixed(4)}&ra=${o.ra}&dec=${o.dec}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'svenesis.org observing planner thumbnails' } });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('HTTP ' + res.status);
      fs.writeFileSync(file, buf); made++;
    } catch (e) { failed.push(o.id + ' (' + e.message + ')'); }
    await sleep(400); /* be gentle with the service */
  }
  console.log(`made ${made}, kept ${kept}, failed ${failed.length}${failed.length ? ': ' + failed.join(', ') : ''}`);
})();
