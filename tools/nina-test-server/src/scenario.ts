/**
 * Szenarien des Test-Servers (execution.md §9, ops/plugin-test-protocol.md): JSON unter `scenarios/<name>.json`,
 * alle Zeiten relativ zum Start des Servers bzw. zum Abruf des Plans („jetzt“). Ein Szenario beschreibt Blöcke,
 * Nachtmarken und optionale Aktionen auf einer Zeitleiste – der Server baut daraus Bootstrap, Targets und Plan.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ScenarioBlock {
  readonly kind?: 'regular' | 'transit';
  /** Beginn in Minuten nach „jetzt“ (negativ: Block hat schon begonnen, Szenario `delay`); ohne Angabe 1 min nach dem vorherigen Block (erster Block: 2 min). */
  readonly startInMin?: number;
  /** Dauer in Minuten (Transit: Länge des Beobachtungsfensters). */
  readonly durationMin: number;
  /** Kurznamen der Filter im Wechsel (rig.json), Standard `L`. */
  readonly filters?: readonly string[];
  readonly exposureS?: number;
  /** Meridian des Ziels n Minuten nach „jetzt“ → Flip im Block (Ziel-RA nach NT-35). */
  readonly meridianInMin?: number;
  readonly decDeg?: number;
  readonly rotationDeg?: number;
  /** Dauer des Zentrierens im Plan (Szenario `delay`: bewusst zu kurz, damit der Ablauf in Verzug gerät). */
  readonly slewCenterS?: number;
  /** Mosaik: Projekt mit so vielen Panels, je Panel ein Block (Szenario `mosaic-flip`). */
  readonly panel?: number;
  /** Projektname (Blöcke mit gleichem Namen gehören zum selben Projekt). */
  readonly project?: string;
  /** Plan-Dither nach jeder n-ten Belichtung (P-28: 3). */
  readonly ditherEvery?: number;
  /** Auslesemodus aller Zeilen des Blocks (P-19: Name, den die Kamera nicht kennt); Standard `null`. */
  readonly readoutMode?: string;
}

export interface TimelineAction {
  readonly atMin: number;
  readonly action: string;
  readonly seconds?: number;
}

export interface Scenario {
  readonly name: string;
  readonly description: string;
  /** Protokolle aus ops/plugin-test-protocol.md, die das Szenario nutzen. */
  readonly protocols: readonly string[];
  readonly blocks: readonly ScenarioBlock[];
  /** Ende der (genutzten) Dunkelheit in Minuten nach „jetzt“; Standard: letzter Block + 60 min. */
  readonly darknessEndInMin?: number;
  /** Nachtende (`sessionEndUtc`) in Minuten nach „jetzt“; Standard: Dunkelheitsende + 60 min. */
  readonly sessionEndInMin?: number;
  readonly flats?: { readonly enabled: boolean; readonly source?: 'panel' | 'sky' };
  /** Weitere NINA-Instanzen am gleichen Rig (Szenario `lease`): zusätzliche Tokens `npm_test2`, … */
  readonly extraInstances?: number;
  /** Echte Nachttabelle Starfront ohne relative Nachtmarken (Szenario `current-night`, P-29). */
  readonly realNight?: boolean;
  /** Zweite Nacht planbar (Szenario `multi-night`, P-23): Pläne der Folgenacht 24 h später. */
  readonly multiNight?: boolean;
  readonly timeline?: readonly TimelineAction[];
}

const dir = fileURLToPath(new URL('../scenarios/', import.meta.url));

export const SCENARIO_NAMES = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .sort();

export function loadScenario(name: string): Scenario {
  if (!SCENARIO_NAMES.includes(name))
    throw new Error(`Szenario „${name}“ unbekannt – vorhanden: ${SCENARIO_NAMES.join(', ')}`);
  const s = JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8')) as Scenario;
  if (s.name !== name) throw new Error(`scenarios/${name}.json: name = ${s.name}`);
  return s;
}

export interface RigConfig {
  readonly site: {
    readonly name: string;
    readonly latDeg: number;
    readonly lonDeg: number;
    readonly elevationM: number;
    readonly timeZone: string;
  };
  readonly filters: readonly {
    readonly position: number;
    readonly shortName: string;
    readonly name: string;
    readonly ninaFilterName: string;
  }[];
}

export function loadRig(path = fileURLToPath(new URL('../rig.json', import.meta.url))): RigConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as RigConfig;
}
