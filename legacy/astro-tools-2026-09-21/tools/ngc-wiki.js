#!/usr/bin/env node
/*
 * Wikipedia articles for the rows of astro-tools/data/ngc.json — run after ngc-data.js, from the site root:
 *
 *   node astro-tools/tools/ngc-wiki.js <cache folder>
 *
 * For each row and language (de, en) the candidates are, in this order: the designation as Wikipedia writes it
 * (ngcWikiQuery() of sky-map.js: NGC 1234, Messier 40, Melotte 71, Caldwell 9, Sh2-129), its other designations (NGC 6994
 * for M 73, Caldwell and Sharpless numbers, the duplicates' names) and, for English, its common name. Every candidate is
 * looked up once through the MediaWiki API (action=query with redirects and the disambiguation page property, 50 titles
 * a request) and cached in <cache folder>/wiki-de.json and wiki-en.json as text → article title, or null where there is
 * no article or only a disambiguation page. The first candidate with an article goes into the row's eleventh field
 * [de, en] — a common name only when the article it leads to is named like an astronomical object ("Eyes" led to the
 * article on the eye, "Little Gem" to a lettuce) —: 1 when it is the designation itself, the candidate text otherwise, 0 where that language has no article.
 * The page links the article in its own language, else the other language's, else Wikipedia's search. The catalogue's
 * own titles (wde/wen in dso-catalog.js) are checked the same way and reported.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const CACHE = process.argv[2], ROOT = path.join(__dirname, '..');
if (!CACHE) { console.error('usage: node astro-tools/tools/ngc-wiki.js <cache folder>'); process.exit(1); }
const sandbox = { window: {}, console };
for (const f of ['js/astro-core.js', 'js/dso-catalog.js', 'js/star-catalog.js', 'js/sky-map.js']) vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
const MAP = sandbox.window.SvSkyMap, CAT = sandbox.window.SvDSO, Q = MAP.ngcWikiQuery;
const UA = 'svenesis-observing-planner-build/1.0 (https://www.svenesis.org)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE = path.join(ROOT, 'data', 'ngc.json');
const ASTRO = /galax|nebula|cluster|cloud|dwarf|loop|star|group|ring|association|remnant|trio|quintet|sextet|pair|arc|(NGC|IC|Messier|Caldwell|Sh2|Collinder|Melotte|UGC|PGC|ESO|HD|Abell) ?\d/i;
/* redirects that lead to the wrong article: overview and constellation articles, and single cases checked by hand
   (September 2026: IC 380 led to "Ideal Conceal", NGC 6989 to the North America Nebula) */
const BLOCK_TITLE = /^(New General Catalogue|Index Catalogue|Messier-Katalog|Messier object|.+ \((constellation|Sternbild)\))$/;
const BLOCK_ROW = { en: ['IC 380', 'NGC 6989'] };

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const cache = {}, cacheFile = lang => path.join(CACHE, `wiki-${lang}.json`);
  for (const lang of ['de', 'en']) cache[lang] = fs.existsSync(cacheFile(lang)) ? JSON.parse(fs.readFileSync(cacheFile(lang), 'utf8')) : {};
  const candidates = (row, lang) => [...new Set([Q(row[0])].concat((row[9] || []).map(Q), lang === 'en' && row[8] ? [row[8]] : []).filter(Boolean))];

  async function lookup(lang, titles) {
    const todo = [...new Set(titles)].filter(t => !(t in cache[lang]));
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageprops&ppprop=disambiguation&titles=` + encodeURIComponent(batch.join('|'));
      let j = null;
      for (let attempt = 0; attempt < 4 && !j; attempt++) {
        try { const res = await fetch(url, { headers: { 'User-Agent': UA } }); if (res.ok) j = await res.json(); else await sleep(2000 * (attempt + 1)); } catch (e) { await sleep(2000 * (attempt + 1)); }
      }
      if (!j || !j.query) throw new Error(`${lang}: lookup failed at ${batch[0]}`);
      const norm = {}, redir = {}, pages = {};
      (j.query.normalized || []).forEach(n => { norm[n.from] = n.to; });
      (j.query.redirects || []).forEach(r => { redir[r.from] = r.to; });
      (j.query.pages || []).forEach(p => { pages[p.title] = p; });
      batch.forEach(t => {
        const n = norm[t] || t, to = redir[n] || n, p = pages[to];
        cache[lang][t] = p && !p.missing && !p.invalid && !(p.pageprops && 'disambiguation' in p.pageprops) ? to : null;
      });
      if (i % 1000 === 0) { fs.writeFileSync(cacheFile(lang), JSON.stringify(cache[lang])); console.log(`${lang}: ${Math.min(i + 50, todo.length)} / ${todo.length}`); }
      await sleep(150);
    }
    fs.writeFileSync(cacheFile(lang), JSON.stringify(cache[lang]));
  }

  const stats = {};
  for (const lang of ['de', 'en']) {
    await lookup(lang, doc.objects.flatMap(row => candidates(row, lang)).concat(CAT.map(o => lang === 'de' ? o.wde : o.wen)));
    const badCat = CAT.filter(o => !cache[lang][lang === 'de' ? o.wde : o.wen]).map(o => o.id + ' (' + (lang === 'de' ? o.wde : o.wen) + ')');
    console.log(`${lang}: catalogue titles without an article: ${badCat.length ? badCat.join(', ') : 'none'}`);
  }
  let lists = 0;
  doc.objects.forEach(row => {
    const w = ['de', 'en'].map(lang => {
      const own = new Set([row[0], Q(row[0])].concat(row[9] || [], (row[9] || []).map(Q)).map(x => String(x).replace(/\s+/g, '').toUpperCase()));
      /* a common name also not when its article carries another catalogue number: a wrong name in the source (NGC 4990) */
      const foreign = t => /^(NGC|IC|Messier|UGC|PGC|ESO) ?\d/.test(t) && !own.has(t.replace(/\s+/g, '').toUpperCase());
      const hit = candidates(row, lang).find(c => cache[lang][c] && !BLOCK_TITLE.test(cache[lang][c]) && !(BLOCK_ROW[lang] || []).includes(row[0]) && (c !== row[8] || (ASTRO.test(cache[lang][c]) && !foreign(cache[lang][c]))));
      if (hit && /^(Liste|List) /.test(cache[lang][hit])) lists++;
      return !hit ? 0 : hit === Q(row[0]) ? 1 : hit;
    });
    row[10] = w;
    const k = (w[0] ? 'de' : '') + (w[1] ? 'en' : '') || 'none';
    stats[k] = (stats[k] || 0) + 1;
  });
  if (!doc.fields.includes('wiki')) doc.fields.push('wiki');
  fs.writeFileSync(FILE, JSON.stringify(doc).replace(/\],\[/g, '],\n['));
  console.log(`data/ngc.json: Wikipedia articles ${JSON.stringify(stats)} (de and en, only de, only en, none), ${lists} of them list pages, ${fs.statSync(FILE).size} bytes`);
})().catch(e => { console.error(e); process.exit(1); });
