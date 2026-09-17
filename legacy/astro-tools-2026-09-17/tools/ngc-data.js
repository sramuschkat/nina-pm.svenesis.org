#!/usr/bin/env node
/*
 * Extra deep-sky objects for the zoomed-in star map, from three sources:
 *   - OpenNGC by Mattia Verga (https://github.com/mattiaverga/OpenNGC, CC BY-SA 4.0): NGC.csv and addendum.csv (database_files/)
 *   - the Sharpless catalogue of HII regions (Sharpless 1959, ApJS 4, 257; VizieR VII/20), fetched as sh2.tsv from
 *     https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=VII/20&-out.max=unlimited&-out.add=_RAJ2000,_DEJ2000&-out.all
 *     with position, type and identifiers of each region from SIMBAD (CDS) in sh2-simbad.txt, which this tool fetches from
 *     SIMBAD's sim-script service when the file is missing
 *   - the Caldwell numbers after the list in the English Wikipedia, saved as caldwell.wiki from
 *     https://en.wikipedia.org/w/index.php?title=Caldwell_catalogue&action=raw
 * Run from the site root:
 *
 *   node astro-tools/tools/ngc-data.js <OpenNGC folder> <Sharpless folder> <caldwell.wiki>
 *
 * Writes astro-tools/data/ngc.json, released under CC BY-SA 4.0 like OpenNGC (the file says so and names its sources):
 * every entry of OpenNGC with a position — galaxies of any brightness, clusters, nebulae, and the NGC and IC entries that
 * are single stars, double stars or asterisms ("Other") —, leaving out non-existent entries (listed in `nonexistent`),
 * duplicates (their designation goes onto the entry they repeat: NGC 2244 is found as NGC 2239) and every object that
 * astro-tools/js/dso-catalog.js already holds (matched by its NGC, IC, Messier, Barnard or Caldwell number); then the
 * Sharpless regions that are not there yet. A Sharpless region counts as there when the Caldwell list names it (Sh2-155 is
 * C 9), when SIMBAD lists one of the objects among its identifiers (Sh2-117: NGC 7000), or when one of the emission or
 * reflection nebulae or supernova remnants lies within a quarter of its diameter (at least 15′, 6′ below 10′ size: the 1900 positions are
 * rounded to whole minutes, and Sh2-30 lies 12′ from M20) and is 0.2 to 5 times as large (Sh2-281: M42, whose SIMBAD entry
 * names no NGC number) — then its designation is added to that object. A Caldwell number pointing at an OpenNGC duplicate
 * follows it (C 50: NGC 2244 → NGC 2239). Per object:
 * [name, RA°, Dec° (J2000), type, major axis ′, minor axis ′, position angle °, magnitude, common name, other designations,
 * Wikipedia] (the last field is written by ngc-wiki.js; run it and ngc-thumbnails.js after this tool)
 * — null where there is no value; other designations are Caldwell and Sharpless numbers. aliases: the other designations
 * of the catalogue's objects (NGC 224 → M31, C 30 → NGC 7331, Sh2-281 → M42). Types are mapped onto the planner's codes:
 * Gx, OC, GC, PN, EN, RN, DN, SNR, and St (star, nova), DS (double star), Ast (asterism or other).
 * Cross-references: other designations of each row (field 10) and of each catalogue object — `aka`, written into
 * astro-tools/js/dso-catalog.js by this tool — from OpenNGC's M, NGC, IC and Identifiers columns (Melotte, Collinder, LBN,
 * UGC, PGC, ESO, HD, HIP, WDS, Flamsteed and Bayer names), the Caldwell list, Sharpless, duplicates, `SAME` (objects
 * OpenNGC keeps twice, confirmed in SIMBAD) and the map's stars and double stars at the NGC and IC entries that are stars.
 * Nebulae and clusters without a size in OpenNGC get SIMBAD's (dims-simbad.txt in the Sharpless folder, fetched when missing).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const [SRC, SH2, CALDWELL] = process.argv.slice(2), ROOT = path.join(__dirname, '..');
if (!SRC || !SH2 || !CALDWELL) { console.error('usage: node astro-tools/tools/ngc-data.js <OpenNGC folder> <Sharpless folder> <caldwell.wiki>'); process.exit(1); }

function parse(file) {
  const lines = fs.readFileSync(path.join(SRC, file), 'utf8').split(/\r?\n/).filter(Boolean), head = lines.shift().split(';');
  return lines.map(l => { const f = l.split(';'), o = {}; head.forEach((h, i) => { o[h] = f[i] || ''; }); return o; });
}
const TYPE = { G: 'Gx', GPair: 'Gx', GTrpl: 'Gx', GGroup: 'Gx', OCl: 'OC', '*Ass': 'OC', GCl: 'GC', PN: 'PN', Neb: 'EN', HII: 'EN', EmN: 'EN', 'Cl+N': 'EN', RfN: 'RN', SNR: 'SNR', DrkN: 'DN', '*': 'St', Nova: 'St', '**': 'DS', Other: 'Ast' };
/* The same object under two designations where OpenNGC keeps both, confirmed in SIMBAD (September 2026: one main identifier
   for both). The tool prints catalogue objects with a row of their kind close by — look them up and add a line here. */
const SAME = { NGC5866: 'M102', IC4703: 'M16' };
/* sizes neither OpenNGC nor SIMBAD give for well-known objects (major, minor axis ′): the Coalsack is about 7° × 5° */
const SIZE_FIX = { C99: [420, 300] };
/* identifiers of stars (HD, HIP, WDS, Flamsteed and Bayer names) only for the entries that are stars: on a nebula they name its central star (IC 1396: HD 206267) */
const STAR_ID = /^(HD|HIP|WDS) |^\d+ [A-Z][a-z]{2}$|^[α-ω] /;
/* other designations taken from OpenNGC's Identifiers column, written as usual: PGC 000778 → PGC 778, SH 2-155 → Sh2-155,
   WDS J02518+5819A → WDS 02518+5819, Eps Ori → ε Ori. Caldwell numbers come from the Wikipedia list only (OpenNGC puts C 49
   on NGC 2238, the list on NGC 2237); survey identifiers (2MASX, SDSS, MCG, IRAS …) are left out */
const GREEK3 = { Alp: 'α', Alf: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Tet: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ',
  Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω' };
function crossId(raw) {
  const id = String(raw).trim().replace(/\s+/g, ' ');
  let m;
  if ((m = /^SH 2-0*(\d+)$/i.exec(id))) return 'Sh2-' + m[1];
  if ((m = /^(Mel|Cl|LBN|UGC|UGCA|PGC|HD|HIP) 0*(\d+)$/.exec(id))) return m[1] + ' ' + m[2];
  if ((m = /^ESO 0*(\d+)-0*(\d+)$/.exec(id))) return 'ESO ' + m[1] + '-' + m[2];
  if ((m = /^WDS J(\d{5}[+-]\d{4})/.exec(id))) return 'WDS ' + m[1];
  if (/^\d+ [A-Z][a-z]{2}$/.test(id)) return id;
  if ((m = /^([A-Z][a-z]{1,2}) ([A-Z][A-Za-z]{2})$/.exec(id)) && GREEK3[m[1]]) return GREEK3[m[1]] + ' ' + m[2];
  return null;
}
const idsOf = (list, own) => { const u = [...new Set(list.filter(Boolean))].filter(x => squashId(x) !== squashId(own)); return u.length ? u : null; };
const squashId = s => String(s).replace(/\s+/g, '').toUpperCase();
/* designations sorted by catalogue: Messier, NGC, IC, Caldwell, Sharpless, Barnard, Melotte, Collinder, LBN, UGC, PGC, ESO, WDS, HD, HIP, then star names */
const ORDER = ['M', 'NGC', 'IC', 'C', 'Sh2', 'B', 'Mel', 'Cl', 'LBN', 'UGC', 'UGCA', 'PGC', 'ESO', 'WDS', 'HD', 'HIP'];
function rankId(id) {
  const sh = /^Sh2-(\d+)/.exec(id), m = /^([A-Za-z]+) ?(\d+)?/.exec(id), p = sh ? 'Sh2' : m ? m[1] : '', i = ORDER.indexOf(p);
  return [i < 0 ? 99 : i, sh ? +sh[1] : m && m[2] ? +m[2] : 0];
}
const byRank = (a, b) => { const x = rankId(a), y = rankId(b); return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b); };
/* common names OpenNGC puts on the wrong entry (July 2026 release): the Cocoon Galaxy is NGC 4490, not NGC 4990 */
const COMMON_FIX = { NGC4990: null, NGC4490: 'Cocoon Galaxy' };
const num = v => { const x = parseFloat(v); return isFinite(x) ? x : null; };
function sexa(v, hours) {
  const m = v.match(/^([+-]?)(\d+):(\d+):([\d.]+)$/);
  if (!m) return null;
  const x = (+m[2] + m[3] / 60 + m[4] / 3600) * (hours ? 15 : 1);
  return m[1] === '-' ? -x : x;
}
/* "NGC0224" → "NGC 224", "IC0342" → "IC 342", "B033" → "B 33", "C009" → "C 9", other addendum names as given */
function nice(name) {
  const m = name.match(/^(NGC|IC|B|C)0*(\d+)\s*(.*)$/);
  return m ? `${m[1]} ${m[2]}${m[3] ? ' ' + m[3] : ''}` : name;
}
const squash = s => String(s).replace(/\s+/g, '').toUpperCase();
const R = Math.PI / 180;
const arcmin = (a, b) => Math.acos(Math.min(1, Math.sin(a.dec * R) * Math.sin(b.dec * R) + Math.cos(a.dec * R) * Math.cos(b.dec * R) * Math.cos((a.ra - b.ra) * R))) / R * 60;

/* the Caldwell list: rows of the sortable table, number and the designation column (NGC 188, NGC 869 & NGC 884, Sh2-155, Mel 25, -) */
function caldwell(file) {
  const t = fs.readFileSync(file, 'utf8'), tab = t.slice(t.indexOf('!Caldwell number'));
  const clean = s => s.replace(/\{\{hs\|\d+\}\}/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/''/g, '').replace(/<[^>]+>/g, ' ').replace(/\{\{[^}]*\}\}/g, '').trim();
  return tab.split(/\n\|-[^\n]*\n/).slice(1)
    .map(r => r.split('\n').filter(l => l.startsWith('|')).map(l => clean(l.replace(/^\|\s*(style="[^"]*"\|)?/, ''))))
    .filter(c => /^C\d+$/.test(c[0]))
    .map(c => ({ n: +c[0].slice(1), ids: c[1].split('&').map(s => s.trim()).filter(s => /^(NGC|IC|Sh2-|Mel)\s*\d/.test(s)) }));
}

(async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'dso-catalog.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'star-catalog.js'), 'utf8'), sandbox);
  const CAT = sandbox.window.SvDSO, have = new Map();
  /* SIMBAD names written with constellation or Greek abbreviations (Cyg Loop, lam Ori Molecular Ring) are left out */
  const ABBR = new Set(sandbox.window.SvSky.labels.map(l => l[0]).concat('alf bet gam del eps zet eta tet iot kap lam mu nu ksi omi pi rho sig tau ups phi chi psi ome'.split(' ')));
  CAT.forEach(o => have.set(squash(o.id), o.id));

  const CAL = caldwell(CALDWELL);
  if (CAL.length !== 109) throw new Error(`Caldwell list: ${CAL.length} entries, expected 109`);

  /* OpenNGC. aliases: the other designations of the catalogue's objects (NGC 224 → M 31), for the star map's search */
  const out = [], seen = new Set(), aliases = {}, dupOf = new Map(), dups = [], nonexistent = [];
  let skippedKnown = 0;
  for (const r of parse('NGC.csv').concat(parse('addendum.csv'))) {
    /* duplicates name the entry they repeat (NGC 2244 → NGC 2239): kept to place Caldwell numbers */
    if (r.Type === 'NonEx') { nonexistent.push(nice(r.Name)); continue; }
    if (r.Type === 'Dup') { const to = r.NGC ? 'NGC' + parseInt(r.NGC, 10) : r.IC ? 'IC' + parseInt(r.IC, 10) : r.M ? 'M' + parseInt(r.M, 10) : null; if (to) { dupOf.set(squash(nice(r.Name)), to); dups.push([nice(r.Name), to]); } }
    const type = TYPE[r.Type];
    if (!type) continue;
    const ra = sexa(r.RA, true), dec = sexa(r.Dec, false);
    if (ra == null || dec == null) continue;
    const name = nice(r.Name), key = squash(name);
    const alias = [key, r.M && 'M' + parseInt(r.M, 10), r.NGC && 'NGC' + parseInt(r.NGC, 10), r.IC && 'IC' + parseInt(r.IC, 10)].filter(Boolean);
    /* an addendum row of a Caldwell number (C014) carries no NGC number: the list's designations stand in (NGC 869) */
    const calRow = /^C\d+$/.test(key) ? CAL.find(c => c.n === +key.slice(1)) : null;
    if (calRow) calRow.ids.forEach(id => alias.push(squash(id)));
    if (SAME[key]) alias.push(squash(SAME[key]));
    const cross = [r.NGC && 'NGC ' + parseInt(r.NGC, 10), r.IC && 'IC ' + parseInt(r.IC, 10)].filter(Boolean).concat((r.Identifiers || '').split(',').map(crossId).filter(Boolean))
      .filter(id => ['St', 'DS', 'Ast'].includes(type) || !STAR_ID.test(id));
    const v = num(r['V-Mag']), b = num(r['B-Mag']), mag = v != null ? v : b != null ? Math.round((b - 0.8) * 10) / 10 : null;
    const known = alias.find(a => have.has(a));
    if (known) {
      const id = have.get(known);
      [name, r.M && 'M ' + parseInt(r.M, 10), r.NGC && 'NGC ' + parseInt(r.NGC, 10), r.IC && 'IC ' + parseInt(r.IC, 10)].filter(Boolean).concat(cross)
        .forEach(n => { if (squash(n) !== squash(id) && !have.has(squash(n))) aliases[n] = id; }); /* never another catalogue object's own name (M102 is not M101) */
      skippedKnown++;
      continue;
    }
    /* a Messier object outside the catalogue (M 40, M 73) goes by its Messier number, its own name becomes another designation */
    const rowName = r.M ? 'M ' + parseInt(r.M, 10) : name, rowKey = squash(rowName);
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    const maj = num(r.MajAx), mn = num(r.MinAx), pa = num(r.PosAng);
    const fixKey = squash(nice(r.Name)), common = fixKey in COMMON_FIX ? COMMON_FIX[fixKey] : (r['Common names'] || '').split(',')[0].trim() || null;
    out.push([rowName, Math.round(ra * 1e4) / 1e4, Math.round(dec * 1e4) / 1e4, type, maj, mn, pa, mag, common, idsOf((rowKey !== key && !/^M\d+$/.test(key) ? [name] : []).concat(cross), rowName)]);
  }

  /* where a designation can be found: the catalogue (directly or through an alias) or a row of the extract */
  const rowByKey = new Map();
  out.forEach(o => { rowByKey.set(squash(o[0]), o); (o[9] || []).forEach(x => rowByKey.set(squash(x), o)); });
  const catByKey = key => have.get(key) || (Object.keys(aliases).find(a => squash(a) === key) ? aliases[Object.keys(aliases).find(a => squash(a) === key)] : null);
  function addDesignation(key, label, viaDup) {
    const catId = catByKey(key);
    if (catId) { if (squash(catId) !== squash(label) && !have.has(squash(label))) aliases[label] = catId; return true; }
    const row = rowByKey.get(key);
    if (row) { if (squash(row[0]) !== squash(label)) (row[9] = row[9] || []).includes(label) || row[9].push(label); return true; }
    return !viaDup && dupOf.has(key) ? addDesignation(dupOf.get(key), label, true) : false;
  }

  /* Caldwell numbers onto catalogue objects and rows (the addendum's C rows carry theirs as their name) */
  const calMissing = [];
  CAL.forEach(c => {
    const label = 'C ' + c.n;
    let ok = rowByKey.has(squash(label)) || have.has(squash(label)) || !!aliases[label];
    c.ids.filter(id => /^(NGC|IC)/.test(id)).forEach(id => { if (addDesignation(squash(id), label)) ok = true; });
    if (!ok) calMissing.push(label + ' (' + c.ids.join(', ') + ')');
  });

  /* duplicates: their designation onto the entry they repeat */
  const dupMissing = [];
  dups.forEach(([label, to]) => { if (squash(label) !== squash(to) && !addDesignation(squash(to), label)) dupMissing.push(label + ' → ' + to); });

  /* Sharpless */
  const tsv = fs.readFileSync(path.join(SH2, 'sh2.tsv'), 'utf8').split(/\r?\n/), hi = tsv.findIndex(l => l.startsWith('_RAJ2000')), head = tsv[hi].split('\t');
  const SHR = tsv.slice(hi + 1).filter(l => /^\s*\d/.test(l)).map(l => { const f = l.split('\t'), o = {}; head.forEach((h, i) => { o[h] = (f[i] || '').trim(); }); return o; })
    .map(o => ({ n: +o.Sh2, ra: +o._RAJ2000, dec: +o._DEJ2000, diam: num(o.Diam) }));
  if (SHR.length !== 313) throw new Error(`sh2.tsv: ${SHR.length} regions, expected 313`);
  const simFile = path.join(SH2, 'sh2-simbad.txt');
  if (!fs.existsSync(simFile)) {
    const script = ['output console=off script=off', 'format object f1 "%MAIN_ID|%COO(d;A;ICRS)|%COO(d;D;ICRS)|%DIM|%OTYPE(S)|%IDLIST(M,NGC,IC,NAME)"']
      .concat(...SHR.map(s => ['echodata ##' + s.n, 'query id Sh2-' + s.n])).join('\n') + '\n';
    const res = await fetch('https://simbad.cds.unistra.fr/simbad/sim-script', { method: 'POST', body: new URLSearchParams({ script }) });
    fs.writeFileSync(simFile, await res.text());
  }
  const SIM = {};
  fs.readFileSync(simFile, 'utf8').split(/\n(?=##)/).forEach(block => {
    const m = /^##(\d+)\n([^\n]*)/.exec(block);
    if (!m || /error/i.test(m[2])) return;
    const p = m[2].split('|');
    SIM[m[1]] = { ra: num(p[1]), dec: num(p[2]), otype: (p[4] || '').trim(), ids: (p[5] || '').split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean) };
  });
  const calSh2 = {};
  CAL.forEach(c => c.ids.forEach(id => { const m = /^Sh2-(\d+)$/.exec(id); if (m) calSh2[m[1]] = 'C ' + c.n; }));
  const pool = CAT.map(o => ({ key: squash(o.id), ra: o.ra, dec: o.dec, t: o.t, s: o.s, cat: true }))
    .concat(out.map(o => ({ key: squash(o[0]), ra: o[1], dec: o[2], t: o[3], s: o[4], cat: false })));
  const NEBULA = new Set(['EN', 'RN', 'SNR']), SH_TYPE = { PlanetaryNeb: 'PN', SNRemnant: 'SNR', RefNeb: 'RN' };
  const merged = [], added = [];
  SHR.forEach(s => {
    const label = 'Sh2-' + s.n, sim = SIM[s.n], diam = s.diam || 1;
    let target = calSh2[s.n] ? squash(calSh2[s.n]) : null, how = target ? 'Caldwell list' : '';
    if (!target && sim) {
      const hit = sim.ids.map(squash).find(k => catByKey(k) || rowByKey.has(k));
      const p = hit && pool.find(x => x.key === squash(catByKey(hit) || hit));
      if (p && arcmin(s, p) <= Math.max(diam, 30)) { target = p.key; how = 'SIMBAD'; }
    }
    if (!target) {
      let best = null;
      pool.forEach(p => {
        if (!NEBULA.has(p.t) || !(p.s > 0)) return;
        const ratio = p.s / diam, d = arcmin(s, p);
        if (ratio < 0.2 || ratio > 5 || d > Math.max(diam / 4, diam >= 10 ? 15 : 6)) return; /* small regions keep 6′: Sh2-254 to 258 are neighbours of IC 2162, not parts */
        const score = d / diam + 0.3 * Math.abs(Math.log(ratio)) - (p.cat ? 0.1 : 0);
        if (!best || score < best.score) best = { p, score, d };
      });
      if (best) { target = best.p.key; how = `position, ${best.d.toFixed(1)}′`; }
    }
    if (target && addDesignation(target, label)) { merged.push(`${label} → ${catByKey(target) || rowByKey.get(target)[0]} (${how})`); return; }
    /* a region of its own: SIMBAD's position where it lies near the catalogue's (the 1900 positions are rounded to minutes) */
    const pos = sim && sim.ra != null && arcmin(s, sim) <= Math.max(diam / 4, 5) ? sim : s;
    const named = sim ? sim.ids.filter(i => /^NAME /.test(i)).map(i => i.slice(5)).find(i => /[a-z]/.test(i) && !i.split(/\s+/).some(w => ABBR.has(w))) : null;
    out.push([label, Math.round(pos.ra * 1e4) / 1e4, Math.round(pos.dec * 1e4) / 1e4, SH_TYPE[sim && sim.otype] || 'EN', s.diam, null, null, null, named || null, null]);
    added.push(label);
  });

  /* stars and double stars of the map at the NGC and IC entries that are stars: NGC 1990 is Alnilam, NGC 2142 a pair of the double star list */
  const STARS = sandbox.window.SvSky.stars, DBL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'doubles.json'), 'utf8')), df = k => DBL.fields.indexOf(k);
  const addId = (row, id) => { if (id && squash(id) !== squash(row[0]) && !(row[9] || []).includes(id)) (row[9] = row[9] || []).push(id); };
  let starIds = 0;
  out.filter(o => ['St', 'DS', 'Ast'].includes(o[3])).forEach(o => {
    STARS.forEach(s => { if (s[5] && Math.abs(s[1] - o[2]) < 0.005 && arcmin({ ra: s[0], dec: s[1] }, { ra: o[1], dec: o[2] }) <= 0.15) { addId(o, s[5]); starIds++; } });
    DBL.objects.forEach(p => { if (Math.abs(p[df('dec')] - o[2]) < 0.005 && arcmin({ ra: p[df('ra')], dec: p[df('dec')] }, { ra: o[1], dec: o[2] }) <= 0.15) { addId(o, 'WDS ' + p[df('wds')]); starIds++; } });
  });

  /* sizes from SIMBAD for nebulae and clusters without one in OpenNGC (the Coalsack got a 12′ picture of a 7° cloud);
     cached in <Sharpless folder>/dims-simbad.txt — delete the file to fetch again */
  const noSize = out.filter(o => o[4] == null && !['St', 'DS', 'Ast'].includes(o[3]));
  const dimFile = path.join(SH2, 'dims-simbad.txt');
  const simName = o => {
    const m = /^(Cl|Mel|H)0*(\d+)$/.exec(o[0]);
    if (m) return { Cl: 'Collinder', Mel: 'Melotte', H: 'Harvard' }[m[1]] + ' ' + m[2];
    if (/^C \d+$/.test(o[0])) return (o[9] || []).find(x => /^(Sh2-|Mel |Cl )/.test(x)) || (o[8] ? 'NAME ' + o[8] : o[0]);
    return o[0];
  };
  if (noSize.length && !fs.existsSync(dimFile)) {
    const script = ['output console=off script=off', 'format object f1 "%DIM"'].concat(...noSize.map(o => ['echodata ##' + o[0], 'query id ' + simName(o).replace(/^Sh2-/, 'SH 2-').replace(/^Mel /, 'Melotte ').replace(/^Cl /, 'Collinder ')])).join('\n') + '\n';
    const res = await fetch('https://simbad.cds.unistra.fr/simbad/sim-script', { method: 'POST', body: new URLSearchParams({ script }) });
    fs.writeFileSync(dimFile, await res.text());
  }
  const DIM = {};
  if (fs.existsSync(dimFile)) fs.readFileSync(dimFile, 'utf8').split(/\n(?=##)/).forEach(block => {
    const m = /^##([^\n]+)\n([^\n]*)/.exec(block);
    if (!m || /error/i.test(m[2])) return;
    const t = m[2].trim().split(/\s+/);
    DIM[m[1]] = { major: num(t[0]), minor: num(t[1]), pa: num(t[2]) };
  });
  let sized = 0;
  out.forEach(o => { const f = SIZE_FIX[squash(o[0])]; if (f && o[4] == null) { o[4] = f[0]; o[5] = f[1]; } });
  noSize.forEach(o => {
    const d = DIM[o[0]];
    if (!d || !(d.major > 0)) return;
    o[4] = Math.round(d.major * 100) / 100; sized++;
    if (d.minor > 0 && d.minor < d.major) { o[5] = Math.round(d.minor * 100) / 100; if (d.pa != null) o[6] = d.pa; }
  });

  out.forEach(o => { if (o[9]) o[9].sort(byRank); });

  /* the catalogue's other designations (aka), written into dso-catalog.js so that list, card and search show them without this file */
  const akaOf = {};
  Object.keys(aliases).forEach(n => { (akaOf[aliases[n]] = akaOf[aliases[n]] || []).push(n); });
  const catFile = path.join(ROOT, 'js', 'dso-catalog.js');
  let akaCount = 0;
  const catSrc = fs.readFileSync(catFile, 'utf8').replace(/^  \{"id": "([^"]+)".*\}(,?)$/gm, (line, id, comma) => {
    const body = line.replace(/, "aka": \[[^\]]*\]/, '').replace(/\}(,?)$/, '');
    const list = [...new Set(akaOf[id] || [])].filter(n => squash(n) !== squash(id)).sort(byRank);
    if (list.length) akaCount++;
    return body + (list.length ? ', "aka": [' + list.map(x => JSON.stringify(x)).join(', ') + ']' : '') + '}' + comma;
  });
  fs.writeFileSync(catFile, catSrc);

  /* catalogue objects with a row of their kind close by: candidates for SAME, to be checked in SIMBAD */
  const KIND = { Gx: 'g', EN: 'n', RN: 'n', DN: 'n', SNR: 'n', PN: 'p', OC: 'c', GC: 'c', St: 's', DS: 's', Ast: 's' }, neighbours = [];
  CAT.forEach(c => out.forEach(o => { if (KIND[o[3]] === KIND[c.t] && Math.abs(o[2] - c.dec) < 1 && arcmin(c, { ra: o[1], dec: o[2] }) <= Math.max(1.5, 0.15 * (c.s || 0))) neighbours.push(`${c.id} ~ ${o[0]}`); }));

  out.sort((a, b) => (a[7] == null ? 99 : a[7]) - (b[7] == null ? 99 : b[7]));
  const doc = {
    source: 'OpenNGC by Mattia Verga, https://github.com/mattiaverga/OpenNGC; Sharpless (1959), Catalogue of HII Regions, VizieR VII/20, with positions and identifiers from SIMBAD (CDS, Strasbourg); Caldwell numbers after the list in the English Wikipedia (article Caldwell catalogue, text under CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/)',
    licence: 'CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/ – this extract is shared under the same licence',
    made: 'astro-tools/tools/ngc-data.js: every OpenNGC entry with a position except non-existent entries and duplicates, and the Sharpless HII regions not already present, without the objects of astro-tools/js/dso-catalog.js; ids: other designations (Caldwell, Sharpless, duplicates, the NGC or IC name of a Messier row); aliases: the other designations of the catalogue objects; wiki: [de, en] article per row, added by ngc-wiki.js',
    fields: ['name', 'ra', 'dec', 'type', 'major', 'minor', 'pa', 'mag', 'common', 'ids'],
    objects: out,
    aliases,
    nonexistent
  };
  const file = path.join(ROOT, 'data', 'ngc.json');
  fs.writeFileSync(file, JSON.stringify(doc).replace(/\],\[/g, '],\n['));
  const byType = {};
  out.forEach(o => { byType[o[3]] = (byType[o[3]] || 0) + 1; });
  console.log(`data/ngc.json: ${out.length} objects ${JSON.stringify(byType)}, ${skippedKnown} left out as already in the catalogue (${Object.keys(aliases).length} aliases), ${fs.statSync(file).size} bytes`);
  console.log(`Sharpless: ${added.length} regions added, ${merged.length} merged into existing objects:\n  ` + merged.join('\n  '));
  console.log(`duplicates: ${dups.length - dupMissing.length} placed` + (dupMissing.length ? `, not placed: ${dupMissing.join(', ')}` : '') + `; non-existent entries left out: ${nonexistent.length}`);
  console.log(`cross-references: ${out.filter(o => o[9]).length} rows with other designations, ${starIds} star or double star names at star entries, ${akaCount} catalogue objects with aka in dso-catalog.js; sizes from SIMBAD for ${sized} of ${noSize.length} rows without one`);
  console.log(`catalogue objects with a row of their kind close by (check in SIMBAD, add to SAME when one object): ${neighbours.join(', ') || 'none'}`);
  console.log(calMissing.length ? `Caldwell numbers not placed: ${calMissing.join(', ')}` : 'Caldwell: all 109 numbers placed');
})().catch(e => { console.error(e); process.exit(1); });
