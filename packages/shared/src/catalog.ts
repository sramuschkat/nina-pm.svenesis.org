/**
 * Bezeichnungen im Objektkatalog (specs/catalog/dso-import.md §3; AP-20): Vergleichsform, Katalogkürzel,
 * Anzeigename und Anzeigegruppe – dieselbe Regel für Import, API und Oberfläche.
 */
import { dsoObjectTypeGroups } from './generated/enums';
import type { DsoTypeGroup } from './contracts/catalog';

/** Vergleichsform: ohne Leerzeichen, ohne Groß-/Kleinschreibung (§3 Nr. 5). */
export const squeezeDesignation = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** Katalogkürzel einer Bezeichnung (`NGC 224` → `NGC`, `Sh2-155` → `Sh`); Trivialnamen → `null`. */
export const designationPrefix = (designation: string) =>
  /^([A-Za-z]+)(?:2-|\s)(?=[\dJ+-])/.exec(designation)?.[1] ?? null;

const NAME_ORDER = ['M', 'NGC', 'IC', 'C', 'Sh'];

/** Rang für die Reihenfolge Messier → NGC → IC → Caldwell → Sharpless → sonstige → Trivialnamen. */
export function designationRank(name: string): number {
  const p = designationPrefix(name);
  if (p === null) return 100;
  const i = NAME_ORDER.indexOf(p);
  return i >= 0 ? i : 50;
}

/** Anzeigename: erste Bezeichnung in der Reihenfolge Messier → NGC → IC → Caldwell → Sharpless → sonstige. */
export function dsoDisplayName(primaryId: string, names: readonly string[]): string {
  return (
    [primaryId, ...names]
      .filter((n) => designationPrefix(n) !== null)
      .sort((a, b) => designationRank(a) - designationRank(b))[0] ?? primaryId
  );
}

export function dsoTypeGroup(objectType: string): DsoTypeGroup {
  return ((dsoObjectTypeGroups as Record<string, string>)[objectType] ?? 'other') as DsoTypeGroup;
}

/**
 * Dateiname der Katalogbilder aus der normalisierten `primary_id` (dso-import.md §2, T-KAT-12):
 * Kleinbuchstaben, nur Buchstaben und Ziffern (`NGC 224` → `ngc224`, `Sh2-129` → `sh2129`).
 */
export const catalogImageKey = (primaryId: string) =>
  primaryId.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Kopierte Katalogbilder unter `catalog/img/…` (H-11): 128 px je Zeile, 320 px wo vorhanden. */
export const catalogImagePaths = (primaryId: string) => ({
  small: `/catalog/img/ngc/${catalogImageKey(primaryId)}.jpg`,
  large: `/catalog/img/ngc-l/${catalogImageKey(primaryId)}.jpg`,
});

/**
 * Wikipedia-Titel einer Katalogzeile je Sprache (`[de, en]`, dso-import.md §2, FA-FRM-14): Artikeltitel,
 * `1` = der Artikel trägt die Bezeichnung selbst (`wikiDesignation(primaryId)`), `0` = kein Artikel.
 */
export type WikiTitle = string | 0 | 1;
export type WikipediaEntry = readonly [de: WikiTitle, en: WikiTitle];

const WIKI_PREFIX: Readonly<Record<string, string>> = {
  Cl: 'Collinder',
  Mel: 'Melotte',
  H: 'Harvard',
  C: 'Caldwell',
  M: 'Messier',
};

/**
 * Bezeichnung, wie Wikipedia sie schreibt (`M 31` → `Messier 31`, `C 41` → `Caldwell 41`, `NGC 224` bleibt,
 * `Sh2-155` bleibt). Nach `ngcWikiQuery` in `legacy/astro-tools-2026-09-21/js/sky-map.js`.
 */
export function wikiDesignation(id: string): string {
  const s = id.trim();
  if (/^Sh2-\d+$/.test(s)) return s;
  const m = /^([A-Za-z]+) ?0*(\d.*)$/.exec(s);
  return m?.[1] && m[2] ? `${WIKI_PREFIX[m[1]] ?? m[1]} ${m[2]}` : s;
}

/**
 * Wikipedia-Link einer Katalogzeile wie im Beobachtungsplaner der Vorlage (`ngcWikiLink`): der Artikel in
 * der Sprache der Oberfläche, sonst der der anderen Sprache, sonst die Suche nach der Bezeichnung.
 */
export function wikipediaLink(
  entry: WikipediaEntry | undefined,
  primaryId: string,
  displayName: string,
  lang: 'de' | 'en',
): { href: string; lang: 'de' | 'en'; search: boolean } {
  const other = lang === 'de' ? 'en' : 'de';
  const title = (v: WikiTitle | undefined) =>
    v === 1 ? wikiDesignation(primaryId) : typeof v === 'string' && v !== '' ? v : null;
  const url = (l: 'de' | 'en', path: string) => `https://${l}.wikipedia.org/wiki/${path}`;
  const article = (l: 'de' | 'en', t: string) => url(l, encodeURIComponent(t.replace(/ /g, '_')));
  const own = title(entry?.[lang === 'de' ? 0 : 1]);
  if (own) return { href: article(lang, own), lang, search: false };
  const alt = title(entry?.[lang === 'de' ? 1 : 0]);
  if (alt) return { href: article(other, alt), lang: other, search: false };
  return {
    href: url(lang, `Special:Search?search=${encodeURIComponent(wikiDesignation(displayName))}`),
    lang,
    search: true,
  };
}

/** Die 88 IAU-Sternbilder: Kürzel → lateinischer Name (Eigenname, nicht übersetzt). */
export const IAU_CONSTELLATION_NAMES = {
  And: 'Andromeda',
  Ant: 'Antlia',
  Aps: 'Apus',
  Aqr: 'Aquarius',
  Aql: 'Aquila',
  Ara: 'Ara',
  Ari: 'Aries',
  Aur: 'Auriga',
  Boo: 'Bootes',
  Cae: 'Caelum',
  Cam: 'Camelopardalis',
  Cnc: 'Cancer',
  CVn: 'Canes Venatici',
  CMa: 'Canis Major',
  CMi: 'Canis Minor',
  Cap: 'Capricornus',
  Car: 'Carina',
  Cas: 'Cassiopeia',
  Cen: 'Centaurus',
  Cep: 'Cepheus',
  Cet: 'Cetus',
  Cha: 'Chamaeleon',
  Cir: 'Circinus',
  Col: 'Columba',
  Com: 'Coma Berenices',
  CrA: 'Corona Australis',
  CrB: 'Corona Borealis',
  Crv: 'Corvus',
  Crt: 'Crater',
  Cru: 'Crux',
  Cyg: 'Cygnus',
  Del: 'Delphinus',
  Dor: 'Dorado',
  Dra: 'Draco',
  Equ: 'Equuleus',
  Eri: 'Eridanus',
  For: 'Fornax',
  Gem: 'Gemini',
  Gru: 'Grus',
  Her: 'Hercules',
  Hor: 'Horologium',
  Hya: 'Hydra',
  Hyi: 'Hydrus',
  Ind: 'Indus',
  Lac: 'Lacerta',
  Leo: 'Leo',
  LMi: 'Leo Minor',
  Lep: 'Lepus',
  Lib: 'Libra',
  Lup: 'Lupus',
  Lyn: 'Lynx',
  Lyr: 'Lyra',
  Men: 'Mensa',
  Mic: 'Microscopium',
  Mon: 'Monoceros',
  Mus: 'Musca',
  Nor: 'Norma',
  Oct: 'Octans',
  Oph: 'Ophiuchus',
  Ori: 'Orion',
  Pav: 'Pavo',
  Peg: 'Pegasus',
  Per: 'Perseus',
  Phe: 'Phoenix',
  Pic: 'Pictor',
  Psc: 'Pisces',
  PsA: 'Piscis Austrinus',
  Pup: 'Puppis',
  Pyx: 'Pyxis',
  Ret: 'Reticulum',
  Sge: 'Sagitta',
  Sgr: 'Sagittarius',
  Sco: 'Scorpius',
  Scl: 'Sculptor',
  Sct: 'Scutum',
  Ser: 'Serpens',
  Sex: 'Sextans',
  Tau: 'Taurus',
  Tel: 'Telescopium',
  Tri: 'Triangulum',
  TrA: 'Triangulum Australe',
  Tuc: 'Tucana',
  UMa: 'Ursa Major',
  UMi: 'Ursa Minor',
  Vel: 'Vela',
  Vir: 'Virgo',
  Vol: 'Volans',
  Vul: 'Vulpecula',
} as const;
export type IauConstellation = keyof typeof IAU_CONSTELLATION_NAMES;
export const IAU_CONSTELLATIONS = Object.keys(IAU_CONSTELLATION_NAMES) as IauConstellation[];
