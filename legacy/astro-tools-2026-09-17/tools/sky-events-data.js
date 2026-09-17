/*
 * Data for the observing planner's sky events: astro-tools/data/sky-events.json
 *   - TLEs of the ISS, the Chinese space station Tiangong and the Hubble Space Telescope from CelesTrak (NORAD data)
 *     with their intrinsic brightness (magnitude at 1000 km, half lit) as listed by Heavens-Above
 *   - comets from the JPL Small-Body Database whose perihelion lies between 400 days ago and 700 days ahead and which
 *     could get brighter than about magnitude 14
 * Satellite predictions are only reliable for one to two weeks after the TLE epoch: run this before each deploy,
 * at least every two weeks. The JSON sits in the no-cache tier of deploy.sh, so a deploy takes effect at once.
 *
 *   node astro-tools/tools/sky-events-data.js
 */
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'data', 'sky-events.json');
const UA = { headers: { 'User-Agent': 'svenesis.org observing planner data update' } };
const SATELLITES = [
  { id: 25544, name: 'ISS', std: -1.8 },
  { id: 48274, name: 'Tiangong', std: 0.0 },
  { id: 20580, name: 'Hubble', std: 2.2 }
];
(async () => {
  const satellites = [];
  for (const s of SATELLITES) {
    const txt = await (await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${s.id}&FORMAT=TLE`, UA)).text();
    const lines = txt.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
    const l1 = lines.find(l => l.startsWith('1 ')), l2 = lines.find(l => l.startsWith('2 '));
    if (!l1 || !l2) throw new Error('no TLE for ' + s.name);
    satellites.push({ id: s.id, name: s.name, std: s.std, tle1: l1, tle2: l2 });
  }
  const now = Date.now() / 86400000 + 2440587.5;
  const cdata = JSON.stringify({ AND: ['q|LT|5', `tp|RG|${(now - 400).toFixed(1)}|${(now + 700).toFixed(1)}`, 'M1|DF'] });
  const url = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=full_name,pdes,e,q,i,om,w,tp,epoch,M1,K1&sb-kind=c&sb-cdata=' + encodeURIComponent(cdata);
  const j = await (await fetch(url, UA)).json();
  const comets = j.data.map(r => Object.fromEntries(j.fields.map((f, k) => [f, r[k]])))
    .filter(c => c.M1 != null && c.K1 != null)
    .map(c => ({ name: c.full_name.trim(), e: +c.e, q: +c.q, i: +c.i, om: +c.om, w: +c.w, tp: +c.tp, epoch: +c.epoch, M1: +c.M1, K1: +c.K1 }))
    /* brightest it could become: at perihelion and as close to the Earth as that distance from the sun allows */
    .filter(c => c.M1 + 5 * Math.log10(Math.max(Math.abs(c.q - 1), 0.1)) + c.K1 * Math.log10(c.q) < 14)
    .sort((a, b) => a.tp - b.tp);
  const data = {
    generated: new Date().toISOString(),
    sources: { tle: 'CelesTrak (celestrak.org), NORAD two-line elements', magnitudes: 'Heavens-Above, intrinsic brightness', comets: 'JPL Small-Body Database (ssd-api.jpl.nasa.gov)' },
    satellites, comets
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${satellites.length} satellites, ${comets.length} comets (of ${j.count} in the date range)`);
  satellites.forEach(s => console.log('  ' + s.name.padEnd(9) + s.tle1.substring(18, 32)));
  comets.forEach(c => console.log('  ' + c.name.padEnd(34) + ' q ' + c.q.toFixed(2) + ' e ' + c.e.toFixed(4) + ' M1 ' + c.M1 + ' K1 ' + c.K1 + ' tp ' + new Date((c.tp - 2440587.5) * 86400000).toISOString().slice(0, 10)));
})();
