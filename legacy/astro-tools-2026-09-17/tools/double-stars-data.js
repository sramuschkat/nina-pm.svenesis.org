#!/usr/bin/env node
/*
 * Double stars for the observing planner, from the Washington Double Star Catalog (Mason et al. 2001–, U.S. Naval
 * Observatory) as served by VizieR (B/wds/wds), positions resolved through SIMBAD (CDS, Strasbourg). Run from the site root:
 *
 *   node astro-tools/tools/double-stars-data.js <wds.tsv>
 *
 * where wds.tsv is the VizieR answer to
 *   https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=B/wds/wds&-out=WDS,Disc,Comp,Obs2,pa2,sep2,mag1,mag2,SpType,Notes,RAJ2000,DEJ2000&mag1=<6.5&mag2=<10&sep2=1.5..120&-out.max=unlimited&-sort=mag1
 *
 * Kept: pairs 1.5–60″ apart, companion to 9 mag and at most 4.5 mag fainter (for a primary of 2.5 mag or brighter up to
 * 9.6 mag and 7.5 mag fainter, so that Rigel and Polaris stay), last measured in 2000 or later, not flagged dubious (X),
 * no lower-case components; per system pairs with component A as primary first, then the brightest companion, the
 * brighter primary and the closer, and a further pair when its companion is new and its primary new or already a primary
 * (the Double Double ε1/ε2 Lyrae, σ Ori AB,D and AB,E). Each primary is looked up in
 * SIMBAD within 10″; a pair is dropped when no object there is within 1.5 mag of the WDS magnitude (a wrong WDS
 * position), else SIMBAD's position is used. Names come from astro-tools/js/star-catalog.js (proper name, Bayer letter),
 * the constellation from its boundaries. Writes astro-tools/data/doubles.json.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), SRC = process.argv[2];
if (!SRC) { console.error('usage: node astro-tools/tools/double-stars-data.js <wds.tsv>'); process.exit(1); }
const sandbox = { window: {} };
vm.createContext(sandbox);
['js/astro-core.js', 'js/star-catalog.js', 'js/sky-map.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox));
const S = sandbox.window.SvSky, MAP = sandbox.window.SvSkyMap, BOUNDS = MAP.boundsB1875(S.bounds);
const R = Math.PI / 180;
const sepAs = (a1, d1, a2, d2) => 2 * Math.asin(Math.sqrt(Math.sin((d2 - d1) * R / 2) ** 2 + Math.cos(d1 * R) * Math.cos(d2 * R) * Math.sin((a2 - a1) * R / 2) ** 2)) / R * 3600;
const hms = s => { const [h, m, x] = s.trim().split(/\s+/).map(Number); return (h + m / 60 + x / 3600) * 15; };
const dms = s => { const t = s.trim(), sg = t[0] === '-' ? -1 : 1, [d, m, x] = t.replace(/^[+-]/, '').split(/\s+/).map(Number); return sg * (d + m / 60 + x / 3600); };

const rows = fs.readFileSync(SRC, 'utf8').split('\n').filter(l => l && !l.startsWith('#')).slice(3).map(l => l.split('\t'));
const numOrNaN = v => (v || '').trim() === '' ? NaN : +v; /* a blank WDS field must not become 0 */
const cand = rows.map(f => ({ wds: f[0].trim(), disc: f[1].replace(/\s+/g, ' ').trim(), comp: f[2].trim(), obs: numOrNaN(f[3]), pa: numOrNaN(f[4]), sep: numOrNaN(f[5]), m1: numOrNaN(f[6]), m2: numOrNaN(f[7]), sp: f[8].trim(), notes: f[9].trim(), ra: hms(f[10]), dec: dms(f[11]) }))
  .filter(x => {
    const bright = x.m1 <= 2.5;
    return isFinite(x.ra) && isFinite(x.dec) && isFinite(x.pa) && isFinite(x.m1) && isFinite(x.m2) && isFinite(x.obs) && x.sep >= 1.5 && x.sep <= 60 && x.m2 <= (bright ? 9.6 : 9) && x.m2 - x.m1 <= (bright ? 7.5 : 4.5)
      && x.obs >= 2000 && !/X/.test(x.notes) && !/[a-z]/.test(x.comp.replace(/,/g, ''));
  });
/* Per system (WDS id): pairs whose primary is component A first, then the brightest companion, the brighter primary and
   the closer. A further pair of the same system stays when its companion is new and its primary is either new too or a
   primary already kept: ε1 and ε2 Lyrae (AB and CD) and σ Ori AB,D and AB,E share one WDS id each, and "one pair per
   system" had kept only one of them; a primary other than A had also won for ζ Cnc (BC) and ξ Sco. */
const parts = c => { c = c || 'AB'; const i = c.indexOf(','), p = i < 0 ? c[0] : c.slice(0, i), q = i < 0 ? c.slice(1) : c.slice(i + 1);
  return { p: p.replace(/[^A-Z]/g, '').split(''), q: q.replace(/[^A-Z]/g, '').split('') }; };
const bySys = {};
cand.forEach(x => (bySys[x.wds] = bySys[x.wds] || []).push(x));
const list = [];
Object.values(bySys).forEach(group => {
  group.sort((a, b) => (/^A/.test(a.comp || 'AB') ? 0 : 1) - (/^A/.test(b.comp || 'AB') ? 0 : 1) || a.m2 - b.m2 || a.m1 - b.m1 || a.sep - b.sep);
  const used = new Set(), prim = new Set();
  group.forEach(x => {
    const { p, q } = parts(x.comp);
    if (q.some(c => used.has(c)) || !(p.every(c => !used.has(c)) || p.every(c => prim.has(c)))) return;
    p.forEach(c => { used.add(c); prim.add(c); }); q.forEach(c => used.add(c)); list.push(x);
  });
});

async function simbad(batch, offset) {
  const script = ['output console=off script=off', 'format object f1 "%IDLIST(1)|%COO(d;A;ICRS)|%COO(d;D;ICRS)|%FLUXLIST(V;F)"', 'set radius 10s', 'set limit 200']
    .concat(...batch.map((x, i) => ['echodata ##' + (offset + i), 'query coo ' + x.ra.toFixed(5) + ' ' + (x.dec >= 0 ? '+' : '') + x.dec.toFixed(5)])).join('\n') + '\n';
  const res = await fetch('https://simbad.cds.unistra.fr/simbad/sim-script', { method: 'POST', body: new URLSearchParams({ script }) });
  const text = await res.text();
  if (!/##\d+/.test(text)) throw new Error('SIMBAD answered without results: ' + text.slice(0, 200));
  const out = {};
  let cur = null;
  text.split('\n').forEach(line => {
    const m = line.match(/^##(\d+)/);
    if (m) { cur = +m[1]; out[cur] = []; return; }
    const f = line.split('|');
    if (cur != null && f.length === 4 && isFinite(parseFloat(f[1]))) out[cur].push({ id: f[0].trim(), ra: parseFloat(f[1]), dec: parseFloat(f[2]), v: f[3].trim() === '' ? null : parseFloat(f[3]) });
  });
  return out;
}

(async () => {
  const found = {};
  for (let i = 0; i < list.length; i += 40) Object.assign(found, await simbad(list.slice(i, i + 40), i));
  const kept = [], dropped = [];
  list.forEach((x, i) => {
    const hits = (found[i] || []).filter(h => h.v != null && Math.abs(h.v - x.m1) <= 1.5).sort((a, b) => sepAs(a.ra, a.dec, x.ra, x.dec) - sepAs(b.ra, b.dec, x.ra, x.dec));
    if (!hits.length) { dropped.push(x.wds + ' ' + x.disc); return; }
    const h = hits[0];
    let star = null;
    S.stars.forEach(s => { if (Math.abs(s[1] - h.dec) > 0.03) return; const d = sepAs(s[0], s[1], h.ra, h.dec); if (d < 60 && Math.abs(s[2] - x.m1) < 1.2 && (!star || d < star.d)) star = { d, s }; });
    kept.push({ wds: x.wds, disc: x.disc, comp: x.comp === 'AB' ? '' : x.comp, ra: Math.round(h.ra * 1e5) / 1e5, dec: Math.round(h.dec * 1e5) / 1e5, m1: x.m1, m2: x.m2, sep: x.sep, pa: x.pa, obs: x.obs, sp: x.sp,
      name: star ? star.s[5] || '' : '', nameDe: star ? star.s[4] || '' : '', bayer: star ? star.s[6] || '' : '', con: MAP.constellationAt(BOUNDS, h.ra, h.dec) || '', simbad: h.id });
  });
  kept.sort((a, b) => a.m1 - b.m1);
  const doc = {
    source: 'Washington Double Star Catalog (Mason et al. 2001–, U.S. Naval Observatory) via VizieR B/wds/wds; positions from SIMBAD (CDS, Strasbourg)',
    made: 'astro-tools/tools/double-stars-data.js: pairs 1.5–60″, companion to 9 mag and ≤ 4.5 mag fainter (bright primaries: 9.6 mag, 7.5 mag), measured since 2000, primary A first, further pairs with a new companion, primary confirmed in SIMBAD',
    fields: ['wds', 'disc', 'comp', 'ra', 'dec', 'm1', 'm2', 'sep', 'pa', 'obs', 'sp', 'name', 'nameDe', 'bayer', 'con', 'simbad'],
    objects: kept.map(k => [k.wds, k.disc, k.comp, k.ra, k.dec, k.m1, k.m2, k.sep, k.pa, k.obs, k.sp, k.name, k.nameDe, k.bayer, k.con, k.simbad])
  };
  const file = path.join(ROOT, 'data', 'doubles.json');
  fs.writeFileSync(file, JSON.stringify(doc).replace(/\],\[/g, '],\n['));
  console.log(`data/doubles.json: ${kept.length} pairs kept, ${dropped.length} dropped (no SIMBAD star within 1.5 mag): ${dropped.slice(0, 12).join(', ')}${dropped.length > 12 ? ' …' : ''}; ${fs.statSync(file).size} bytes`);
  ['Albireo', 'Mizar', 'Castor', 'Almach', 'Izar', 'Rigel', 'Antares', 'Polaris', 'Cor Caroli', 'Algieba'].forEach(n => {
    const k = kept.find(y => y.name === n);
    console.log('  ' + n.padEnd(11), k ? `${k.disc} ${k.m1}/${k.m2} ${k.sep}″ PA ${k.pa} ${k.bayer} ${k.con} · SIMBAD ${k.simbad}` : '— not kept');
  });
})().catch(e => { console.error(e.message); process.exit(1); });
