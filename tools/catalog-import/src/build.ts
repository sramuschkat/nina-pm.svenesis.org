/**
 * Objektkatalog aus OpenNGC nach `docs/specs/catalog/dso-import.md` (AP-20; FA-FRM-01, FA-FRM-15, WS-E4,
 * WS-25…27): reine Funktion über die Dateiinhalte – `NGC.csv`, `addendum.csv` (Leitquelle für Koordinaten,
 * Typ, Sternbild, Größen, Positionswinkel, Helligkeiten) und der Website-Auszug (`data/ngc.json`,
 * `js/dso-catalog.js`, **nur** Namen, Aliase und – nach Entscheidung vom 25.09.2026 – die
 * Sharpless-Regionen, die OpenNGC nicht führt).
 *
 * Abweichungen bzw. Auslegungen (im PR begründet):
 * - Sharpless-Regionen ohne OpenNGC-Zeile kommen als eigene Zeilen aus dem Auszug (Quelle
 *   `sharpless:VII/20 …`, ohne Helligkeiten).
 * - Bezeichnungen des kuratierten Auszugs gehen vor OpenNGC-`Dup`-Zielen (M 102 = NGC 5866, T-KAT-09).
 * - Aliase des Auszugs, die selbst eine OpenNGC-Zeile sind (IC 4703 → M 16), führen die beiden Zeilen
 *   zusammen (§3 Nr. 3, T-KAT-07) statt verworfen zu werden.
 */
import {
  designationPrefix,
  designationRank,
  dsoCatalogPrefixes,
  dsoDisplayName,
  dsoObjectTypes,
  IAU_CONSTELLATIONS,
  squeezeDesignation,
  wikiDesignation,
  type WikiTitle,
  type WikipediaEntry,
} from '@nina-pm/shared';

export interface DsoRow {
  readonly primaryId: string;
  /** Weitere Bezeichnungen und Trivialnamen in der Reihenfolge M, NGC, IC, C, Sh2, sonstige, Namen. */
  readonly names: string[];
  readonly catalogs: string[];
  readonly objectType: string;
  readonly constellation: string | null;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly magV: number | null;
  readonly magB: number | null;
  readonly magBandUsed: 'V' | 'B' | null;
  readonly surfBrMagArcsec2: number | null;
  readonly sizeMajorArcmin: number | null;
  readonly sizeMinorArcmin: number | null;
  readonly positionAngleDeg: number | null;
  readonly source: string;
}

export interface CatalogBuild {
  readonly version: string;
  readonly fetchedAt: string;
  readonly counts: {
    readonly ngcCsv: number;
    readonly addendumCsv: number;
    readonly rows: number;
    readonly sharpless: number;
    readonly dup: number;
    readonly nonEx: number;
    readonly merged: number;
  };
  readonly rows: DsoRow[];
  /**
   * Wikipedia-Titel je `primary_id` aus dem Website-Auszug (`wde`/`wen` der kuratierten Objekte, sonst
   * Feld 10 von `ngc.json`); nur Zeilen mit mindestens einem Artikel. Nicht in `dso_object` (§2).
   */
  readonly wikipedia: Readonly<Record<string, WikipediaEntry>>;
  readonly nonexistent: string[];
  readonly merged: { readonly from: string; readonly into: string; readonly reason: string }[];
  readonly warnings: string[];
}

export interface CatalogInput {
  readonly ngcCsv: string;
  readonly addendumCsv: string;
  /** `data/ngc.json` des Website-Auszugs. */
  readonly extractJson: string;
  /** `js/dso-catalog.js` des Website-Auszugs. */
  readonly curatedJs: string;
  /** Release-Bezeichnung der OpenNGC-Auslieferung, z. B. `v20260501`. */
  readonly version: string;
  /** Abrufdatum `YYYY-MM-DD`. */
  readonly fetchedAt: string;
}

/** Die 88 IAU-Sternbilder (Kürzel). OpenNGC teilt Serpens in `Se1`/`Se2` – beides ist `Ser`. */
export { IAU_CONSTELLATIONS } from '@nina-pm/shared';

const REQUIRED_COLUMNS = [
  'Name',
  'Type',
  'RA',
  'Dec',
  'Const',
  'MajAx',
  'MinAx',
  'PosAng',
  'B-Mag',
  'V-Mag',
  'SurfBr',
  'Hubble',
  'Common names',
  'M',
  'NGC',
  'IC',
  'Identifiers',
] as const;

/** Weitere Bezeichnungen aus OpenNGC, die in `names` übernommen werden (Übersichtskataloge ohne Durchmusterungen). */
const KEPT_PREFIXES = new Set<string>([
  ...dsoCatalogPrefixes,
  'UGCA',
  'HCG',
  'Arp',
  'Abell',
  'vdB',
  'Ced',
  'Tr',
  'Stock',
  'King',
  'Berkeley',
  'Collinder',
  'MWSC',
  'H',
]);
/** Sternnummern nur an Sternen (T-KAT-09). */
const STAR_PREFIXES = new Set(['HD', 'HIP', 'WDS', 'TYC', 'SAO', 'BD', 'HR']);
const STAR_TYPES = new Set(['*', '**']);
const KNOWN_TYPES = new Set<string>(dsoObjectTypes);
/** Kurzcodes des Auszugs → OpenNGC-Typ (nur für die Sharpless-Zeilen des Auszugs). */
const EXTRACT_TYPE: Readonly<Record<string, string>> = {
  EN: 'HII',
  RN: 'RfN',
  DN: 'DrkN',
  SNR: 'SNR',
  PN: 'PN',
  Gx: 'G',
  GC: 'GCl',
  OC: 'OCl',
  St: '*',
  DS: '**',
  Ast: '*Ass',
};
/** Objektart für die Dublettenregel (gleiche Art, Abstand < 0,1′, §3 Nr. 3). */
const KIND: Readonly<Record<string, string>> = {
  G: 'g',
  GPair: 'g',
  GTrpl: 'g',
  GGroup: 'g',
  OCl: 'c',
  GCl: 'c',
  'Cl+N': 'c',
  PN: 'p',
  HII: 'n',
  EmN: 'n',
  Neb: 'n',
  RfN: 'n',
  DrkN: 'n',
  SNR: 'n',
  '*': 's',
  '**': 's',
  '*Ass': 's',
  Nova: 's',
  Other: 'o',
};

/** Vergleichsform einer Bezeichnung: ohne Leerzeichen, ohne Groß-/Kleinschreibung (§3 Nr. 5). */
export const squeeze = squeezeDesignation;

/**
 * Schreibweise normalisieren: Kürzel, ein Leerzeichen, Nummer ohne führende Nullen (`NGC0224` → `NGC 224`,
 * `ESO056-115` → `ESO 56-115`, `PGC 002557` → `PGC 2557`), Sharpless als `Sh2-155`, Komponenten
 * bleiben erhalten (`NGC 5866B`, `IC 80 NED01`).
 */
export function normalizeDesignation(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  const sh = /^SH ?2-0*(\d+)$/i.exec(s);
  if (sh) return `Sh2-${String(Number(sh[1]))}`;
  const m = /^([A-Za-z]+) ?0*(\d+)(.*)$/.exec(s);
  if (!m?.[1] || m[2] === undefined) return s;
  const prefix = m[1] === 'SH' ? 'Sh' : m[1];
  return `${prefix} ${m[2]}${m[3] ?? ''}`;
}

const prefixOf = designationPrefix;
/** Komponente (`NGC 5866B`, `IC 80 NED01`) – nie Bildkandidat, bei Mehrdeutigkeit nachrangig. */
export const isComponent = (id: string) => /(\d[A-Z]| NED\d+)$/.test(id);

function parseCsv(text: string, file: string): Record<string, string>[] {
  const [head = '', ...lines] = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const cols = head.split(';');
  const missing = REQUIRED_COLUMNS.filter((c) => !cols.includes(c));
  if (missing.length > 0) throw new Error(`${file}: Spalten fehlen: ${missing.join(', ')}`);
  return lines.map((line) => {
    const v = line.split(';');
    return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? '').trim()]));
  });
}

const num = (s: string): number | null => {
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function raToDeg(hms: string): number {
  const [h = '0', m = '0', s = '0'] = hms.split(':');
  const deg = 15 * (Number(h) + Number(m) / 60 + Number(s) / 3600);
  return deg >= 360 ? deg - 360 : deg;
}

export function decToDeg(dms: string): number {
  const neg = dms.trim().startsWith('-');
  const [d = '0', m = '0', s = '0'] = dms.replace(/^[+-]/, '').split(':');
  const v = Number(d) + Number(m) / 60 + Number(s) / 3600;
  return neg ? -v : v;
}

/** Großachsen-PA als Achsenrichtung in `[0, 180)`; ohne beide Achsen `null` (§2, T-KAT-03). */
export function axisPa(
  pa: number | null,
  major: number | null,
  minor: number | null,
): number | null {
  if (pa === null || major === null || minor === null) return null;
  const r = pa % 180;
  return r < 0 ? r + 180 : r;
}

const rank = designationRank;

/** Erste Bezeichnung in der Reihenfolge Messier → NGC → IC → Caldwell → Sharpless → sonstige (§3 Nr. 4). */
export function displayName(row: Pick<DsoRow, 'primaryId' | 'names'>): string {
  return dsoDisplayName(row.primaryId, row.names);
}

interface Mutable {
  primaryId: string;
  names: string[];
  objectType: string;
  constellation: string | null;
  raDeg: number;
  decDeg: number;
  magV: number | null;
  magB: number | null;
  surfBr: number | null;
  major: number | null;
  minor: number | null;
  pa: number | null;
  source: string;
}

const arcmin = (a: { raDeg: number; decDeg: number }, b: { raDeg: number; decDeg: number }) => {
  const dRa = (((b.raDeg - a.raDeg + 540) % 360) - 180) * Math.cos((a.decDeg * Math.PI) / 180);
  const dDec = b.decDeg - a.decDeg;
  return Math.sqrt(dRa * dRa + dDec * dDec) * 60;
};

export function buildCatalog(input: CatalogInput): CatalogBuild {
  const warnings: string[] = [];
  const warn = (w: string) => warnings.push(w);
  const ngc = parseCsv(input.ngcCsv, 'NGC.csv');
  const addendum = parseCsv(input.addendumCsv, 'addendum.csv');
  const rows = new Map<string, Mutable>();
  const nonexistent: string[] = [];
  const dups: { rec: Record<string, string>; file: string }[] = [];
  const merged: { from: string; into: string; reason: string }[] = [];

  const otherNames = (rec: Record<string, string>, type: string) => {
    const out: string[] = [];
    if (rec.M) out.push(`M ${String(Number(rec.M))}`);
    for (const n of (rec.NGC ?? '').split(',').filter(Boolean))
      out.push(normalizeDesignation(`NGC${n}`));
    for (const n of (rec.IC ?? '').split(',').filter(Boolean))
      out.push(normalizeDesignation(`IC${n}`));
    for (const id of (rec.Identifiers ?? '').split(',').filter(Boolean)) {
      const d = normalizeDesignation(id);
      const p = prefixOf(d);
      if (p === 'Sh') out.push(d);
      else if (p !== null && STAR_PREFIXES.has(p)) {
        if (STAR_TYPES.has(type)) out.push(d);
      } else if (p !== null && KEPT_PREFIXES.has(p)) out.push(d);
    }
    for (const c of (rec['Common names'] ?? '').split(',').filter(Boolean)) out.push(c.trim());
    return out;
  };

  const addRow = (rec: Record<string, string>, file: string) => {
    let type = rec.Type ?? '';
    const primaryId = normalizeDesignation(rec.Name ?? '');
    if (!KNOWN_TYPES.has(type)) {
      warn(`${primaryId}: unbekannter Typ ${type} → Other`);
      type = 'Other';
    }
    let constellation: string | null =
      rec.Const === 'Se1' || rec.Const === 'Se2' ? 'Ser' : (rec.Const ?? null);
    if (!(IAU_CONSTELLATIONS as readonly string[]).includes(constellation ?? '')) {
      warn(`${primaryId}: Sternbild ${String(rec.Const)} unbekannt → null`);
      constellation = null;
    }
    let major = num(rec.MajAx ?? '');
    let minor = num(rec.MinAx ?? '');
    if (major !== null && major <= 0) {
      warn(`${primaryId}: MajAx ${String(major)} ≤ 0 → null`);
      major = null;
    }
    if (major !== null && minor !== null && minor > major) {
      warn(`${primaryId}: MinAx > MajAx, getauscht`);
      [major, minor] = [minor, major];
    }
    if (rows.has(primaryId)) throw new Error(`Doppelte primary_id ${primaryId} (§3 Nr. 7)`);
    rows.set(primaryId, {
      primaryId,
      names: otherNames(rec, type),
      objectType: type,
      constellation,
      raDeg: raToDeg(rec.RA ?? ''),
      decDeg: decToDeg(rec.Dec ?? ''),
      magV: num(rec['V-Mag'] ?? ''),
      magB: num(rec['B-Mag'] ?? ''),
      surfBr: num(rec.SurfBr ?? ''),
      major,
      minor,
      pa: axisPa(num(rec.PosAng ?? ''), major, minor),
      source: `openngc:${file} ${input.version}`,
    });
  };

  for (const [list, file] of [
    [ngc, 'NGC.csv'],
    [addendum, 'addendum.csv'],
  ] as const) {
    for (const rec of list) {
      if (rec.Type === 'NonEx') nonexistent.push(normalizeDesignation(rec.Name ?? ''));
      else if (rec.Type === 'Dup') dups.push({ rec, file });
      else addRow(rec, file);
    }
  }

  // Index aller Bezeichnungen → primary_id.
  const index = new Map<string, string>();
  const reindex = () => {
    index.clear();
    for (const r of rows.values())
      for (const n of [r.primaryId, ...r.names])
        if (prefixOf(n) !== null && !index.has(squeeze(n))) index.set(squeeze(n), r.primaryId);
    for (const r of rows.values()) index.set(squeeze(r.primaryId), r.primaryId);
  };
  reindex();
  const find = (designation: string) => index.get(squeeze(normalizeDesignation(designation)));
  const mergeInto = (fromId: string, intoId: string, reason: string) => {
    const from = rows.get(fromId);
    const into = rows.get(intoId);
    if (!from || !into || fromId === intoId) return;
    into.names.push(from.primaryId, ...from.names);
    rows.delete(fromId);
    merged.push({ from: fromId, into: intoId, reason });
    for (const n of [from.primaryId, ...from.names])
      if (prefixOf(n) !== null) index.set(squeeze(n), intoId);
  };

  // Kuratierte Objekte (dso-catalog.js): Bezeichnung, aka, Trivialnamen – diese Zuordnungen gehen vor.
  const curatedText = input.curatedJs.replace(/^[\s\S]*?=\s*/, '').replace(/;\s*$/, '');
  const curated = JSON.parse(curatedText) as {
    id: string;
    ra: number;
    dec: number;
    t: string;
    aka?: string[];
    de?: string;
    en?: string;
    wde?: string;
    wen?: string;
  }[];
  // Wikipedia-Titel (Kandidaten in Vorrangfolge: kuratiert vor ngc.json); aufgelöst erst nach dem
  // Zusammenführen, damit der Titel an der verbleibenden Zeile hängt.
  const wikiCandidates: { target: string; name: string; w: readonly unknown[] }[] = [];
  const claimed = new Map<string, string>();
  const curatedRow = new Map<string, string>();
  for (const o of curated) {
    const ids = [o.id, ...(o.aka ?? [])];
    let target = ids.map((i) => find(i)).find((x) => x !== undefined);
    if (!target) {
      // Position des Auszugs: nächste OpenNGC-Zeile gleicher Art innerhalb 1′.
      const kind = KIND[EXTRACT_TYPE[o.t] ?? ''];
      let best: { id: string; d: number } | null = null;
      for (const r of rows.values()) {
        if (KIND[r.objectType] !== kind) continue;
        const d = arcmin({ raDeg: o.ra, decDeg: o.dec }, r);
        if (d < 1 && (!best || d < best.d)) best = { id: r.primaryId, d };
      }
      target = best?.id;
    }
    if (!target) {
      warn(`Auszug ${o.id}: keine OpenNGC-Zeile gefunden`);
      continue;
    }
    curatedRow.set(squeeze(normalizeDesignation(o.id)), target);
    wikiCandidates.push({ target, name: o.id, w: [o.wde ?? 0, o.wen ?? 0] });
    const row = rows.get(target) as Mutable;
    for (const i of ids) {
      const d = normalizeDesignation(i);
      const other = find(d);
      if (other && other !== target && squeeze(other) === squeeze(d))
        mergeInto(other, target, `Auszug: ${o.id} = ${d}`);
      else row.names.push(d);
      claimed.set(squeeze(d), target);
      index.set(squeeze(d), target);
    }
    for (const n of [o.de, o.en]) if (n) row.names.push(n);
  }

  // Zeilen des Auszugs (ngc.json): weitere Bezeichnungen und Trivialname; Sharpless-Regionen ohne
  // OpenNGC-Zeile als eigene Zeile (Entscheidung 25.09.2026).
  const extract = JSON.parse(input.extractJson) as {
    objects: [
      string,
      number,
      number,
      string,
      number | null,
      number | null,
      number | null,
      number | null,
      string | null,
      string[] | null,
      unknown,
    ][];
    aliases: Record<string, string>;
  };
  let sharpless = 0;
  for (const o of extract.objects) {
    const [name, ra, dec, t, major, minor, pa, , common, ids, wiki] = o;
    const target = find(name);
    if (Array.isArray(wiki))
      wikiCandidates.push({ target: target ?? normalizeDesignation(name), name, w: wiki });
    if (target) {
      const row = rows.get(target) as Mutable;
      for (const i of ids ?? []) {
        const d = normalizeDesignation(i);
        const p = prefixOf(d);
        if (p !== null && STAR_PREFIXES.has(p) && !STAR_TYPES.has(row.objectType)) continue;
        row.names.push(d);
      }
      if (common) row.names.push(common);
      continue;
    }
    const id = normalizeDesignation(name);
    if (!/^Sh2-\d+$/.test(id)) {
      warn(`Auszug ${name}: keine OpenNGC-Zeile`);
      continue;
    }
    const type = EXTRACT_TYPE[t] ?? 'Other';
    let a = major !== null && major > 0 ? major : null;
    let b = minor !== null && minor > 0 ? minor : null;
    if (a !== null && b !== null && b > a) [a, b] = [b, a];
    rows.set(id, {
      primaryId: id,
      names: [...(ids ?? []).map(normalizeDesignation), ...(common ? [common] : [])],
      objectType: type,
      constellation: null,
      raDeg: ra,
      decDeg: dec,
      magV: null,
      magB: null,
      surfBr: null,
      major: a,
      minor: b,
      pa: axisPa(pa, a, b),
      source: 'sharpless:VII/20 (Sharpless 1959, Positionen SIMBAD, Website-Auszug)',
    });
    index.set(squeeze(id), id);
    sharpless += 1;
  }

  // Aliase des Auszugs (Bezeichnung → kuratiertes Objekt). Ist die Bezeichnung selbst eine andere Zeile,
  // ist es dasselbe Himmelsobjekt (IC 4703 = M 16): zusammenführen (§3 Nr. 3).
  for (const [alias, catalogueId] of Object.entries(extract.aliases)) {
    const target = curatedRow.get(squeeze(normalizeDesignation(catalogueId))) ?? find(catalogueId);
    if (!target) {
      warn(`Alias ${alias} → ${catalogueId}: Ziel fehlt`);
      continue;
    }
    const d = normalizeDesignation(alias);
    const own = rows.has(d) ? d : undefined;
    if (own && own !== target) mergeInto(own, target, `Auszug: ${alias} → ${catalogueId}`);
    else rows.get(target)?.names.push(d);
    claimed.set(squeeze(d), target);
    index.set(squeeze(d), target);
  }

  // OpenNGC-Dubletten: Bezeichnung wird Alias des Ziels – außer der kuratierte Auszug ordnet sie anders zu.
  for (const { rec } of dups) {
    const d = normalizeDesignation(rec.Name ?? '');
    // Ziel aus Identifiers, ersatzweise NGC/IC/M (§3 Nr. 1).
    const candidates = [
      (rec.Identifiers ?? '').split(',').find(Boolean) ?? '',
      rec.NGC ? `NGC${rec.NGC.split(',')[0] ?? ''}` : '',
      rec.IC ? `IC${rec.IC.split(',')[0] ?? ''}` : '',
      rec.M ? `M${rec.M}` : '',
    ].filter(Boolean);
    const target = candidates.map((c) => find(c)).find((x) => x !== undefined);
    const claim = claimed.get(squeeze(d));
    if (claim && claim !== target) {
      warn(
        `Dup ${d}: OpenNGC-Ziel ${String(target)} widerspricht dem kuratierten Auszug (${claim}) – Auszug gilt`,
      );
      continue;
    }
    if (!target) {
      warn(`Dup ${d}: Ziel fehlt – verworfen`);
      continue;
    }
    rows.get(target)?.names.push(d);
    index.set(squeeze(d), target);
  }

  // Mehrfacheinträge: gleiche Art und Abstand < 0,1′ (§3 Nr. 3, Regel der Website: Auszug gegen Katalog)
  // – Raster nach Deklination.
  const byBand = new Map<number, Mutable[]>();
  for (const r of rows.values()) {
    const band = Math.floor(r.decDeg * 10);
    byBand.set(band, [...(byBand.get(band) ?? []), r]);
  }
  const sorted = [...rows.values()].sort(
    (a, b) =>
      rank(a.primaryId) - rank(b.primaryId) ||
      a.primaryId.localeCompare(b.primaryId, 'en', { numeric: true }),
  );
  for (const r of sorted) {
    if (!rows.has(r.primaryId)) continue;
    const band = Math.floor(r.decDeg * 10);
    for (const b of [band - 1, band, band + 1])
      for (const o of byBand.get(b) ?? []) {
        if (o === r || !rows.has(o.primaryId)) continue;
        if (KIND[o.objectType] !== KIND[r.objectType]) continue;
        // Nur Zeilen außerhalb von OpenNGC (Sharpless aus dem Auszug) – OpenNGC kennzeichnet eigene
        // Dubletten als `Dup`; nahe Paare dort (Komponenten, NGC 1674/1675) sind eigene Objekte.
        if (r.source.startsWith('openngc:') && o.source.startsWith('openngc:')) continue;
        if (arcmin(r, o) < 0.1) mergeInto(o.primaryId, r.primaryId, 'Abstand < 0,1′, gleiche Art');
      }
  }

  // Aufbereiten: Bezeichnungen normalisiert, ohne eigene primary_id, ohne Doppel, sortiert.
  const cleaned = new Map<string, string[]>();
  for (const r of rows.values()) {
    const seen = new Set([squeeze(r.primaryId)]);
    const names: string[] = [];
    for (const n of r.names) {
      const k = squeeze(n);
      if (!n || seen.has(k)) continue;
      seen.add(k);
      names.push(n);
    }
    cleaned.set(r.primaryId, names);
  }
  // Eine Bezeichnung an mehreren Zeilen (Komponenten, Doppelhaufen, Nebelkomplexe): OpenNGC führt das
  // 107-mal; die Bezeichnung bleibt an genau einer Zeile – eigene primary_id → kuratierter Auszug →
  // keine Komponente → erste Zeile –, an den übrigen entfällt sie mit Importwarnung (§3 Nr. 5).
  const holders = new Map<string, string[]>();
  for (const [id, names] of cleaned)
    for (const n of names)
      if (prefixOf(n) !== null) holders.set(squeeze(n), [...(holders.get(squeeze(n)) ?? []), id]);
  const primaryKeys = new Set([...rows.keys()].map(squeeze));
  for (const [key, ids] of holders) {
    if (ids.length < 2 && !primaryKeys.has(key)) continue;
    const ordered = [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const keep = primaryKeys.has(key)
      ? null
      : (ordered.find((id) => claimed.get(key) === id) ??
        ordered.find((id) => !isComponent(id)) ??
        ordered[0]);
    for (const id of ids) {
      if (id === keep) continue;
      const names = cleaned.get(id) as string[];
      const i = names.findIndex((n) => squeeze(n) === key);
      if (i >= 0) {
        warn(
          `Bezeichnung ${names[i] as string} an ${id} entfällt – gehört zu ${keep ?? [...rows.keys()].find((k) => squeeze(k) === key) ?? '?'}`,
        );
        names.splice(i, 1);
      }
    }
  }
  const unknownPrefixes = new Set<string>();
  const out: DsoRow[] = [];
  for (const r of [...rows.values()].sort((a, b) =>
    a.primaryId.localeCompare(b.primaryId, 'en', { numeric: true }),
  )) {
    const names = [...(cleaned.get(r.primaryId) ?? [])].sort(
      (a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true }),
    );
    const catalogs: string[] = [];
    for (const n of [r.primaryId, ...names]) {
      const raw = prefixOf(n);
      const p = raw === 'Sh' ? 'Sh2' : raw;
      if (p === null) continue;
      if ((dsoCatalogPrefixes as readonly string[]).includes(p)) {
        if (!catalogs.includes(p)) catalogs.push(p);
      } else unknownPrefixes.add(p);
    }
    out.push({
      primaryId: r.primaryId,
      names,
      catalogs,
      objectType: r.objectType,
      constellation: r.constellation,
      raDeg: r.raDeg,
      decDeg: r.decDeg,
      magV: r.magV,
      magB: r.magB,
      magBandUsed: r.magV !== null ? 'V' : r.magB !== null ? 'B' : null,
      surfBrMagArcsec2: r.surfBr,
      sizeMajorArcmin: r.major,
      sizeMinorArcmin: r.minor,
      positionAngleDeg: r.pa,
      source: r.source,
    });
  }
  for (const p of [...unknownPrefixes].sort())
    warn(`Katalogkürzel ${p} nicht in dsoCatalogPrefixes – nur in names, nicht in catalogs`);

  // Wikipedia-Titel: `1` heißt „Artikel unter der Bezeichnung der Auszugszeile“ – nach dem Zusammenführen
  // kann das eine andere als die primary_id sein, dann steht der Titel ausgeschrieben.
  const mergedInto = new Map(merged.map((m) => [m.from, m.into]));
  const resolve = (id: string) => {
    let x = id;
    for (let next = mergedInto.get(x); next !== undefined; next = mergedInto.get(x)) x = next;
    return x;
  };
  const slots = new Map<string, [string | null, string | null]>();
  for (const c of wikiCandidates) {
    const id = resolve(c.target);
    if (!rows.has(id)) continue;
    const slot = slots.get(id) ?? [null, null];
    for (const i of [0, 1] as const) {
      const v = c.w[i];
      const title =
        v === 1
          ? wikiDesignation(normalizeDesignation(c.name))
          : typeof v === 'string' && v.trim() !== ''
            ? v.trim()
            : null;
      if (v !== 0 && v !== 1 && typeof v !== 'string')
        warn(`Wikipedia ${c.name}: unbekannter Eintrag ${JSON.stringify(v)}`);
      slot[i] ??= title;
    }
    slots.set(id, slot);
  }
  const wikipedia: Record<string, WikipediaEntry> = {};
  for (const r of out) {
    const slot = slots.get(r.primaryId);
    if (!slot || (slot[0] === null && slot[1] === null)) continue;
    const own = wikiDesignation(r.primaryId);
    const enc = (t: string | null): WikiTitle => (t === null ? 0 : t === own ? 1 : t);
    wikipedia[r.primaryId] = [enc(slot[0]), enc(slot[1])];
  }

  return {
    version: input.version,
    fetchedAt: input.fetchedAt,
    counts: {
      ngcCsv: ngc.length,
      addendumCsv: addendum.length,
      rows: out.length,
      sharpless,
      dup: dups.length,
      nonEx: nonexistent.length,
      merged: merged.length,
    },
    rows: out,
    wikipedia,
    nonexistent: nonexistent.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    merged,
    warnings,
  };
}
