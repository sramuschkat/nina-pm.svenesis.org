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
