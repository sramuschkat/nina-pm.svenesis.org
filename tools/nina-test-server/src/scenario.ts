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
  /** Binning aller Zeilen des Blocks (P-35); Standard 1. */
  readonly binning?: number;
  /** Gain und Offset aller Zeilen des Blocks (P-35); Standard `null` (Kamera-Standard). */
  readonly gain?: number;
  readonly offset?: number;
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
  readonly flats?: {
    readonly enabled: boolean;
    readonly source?: 'panel' | 'sky';
    /** Auto-Flats je Projekt (AP-50b); Standard aus. */
    readonly auto?: {
      readonly mode: 'off' | 'once_per_project' | 'time_based';
      readonly intervalDays: number;
    };
    /** Flats und Dark-Flats je Kombination (Rig); Standard wie das Beispiel (20). VM-Läufe: 5. */
    readonly count?: number;
    /**
     * Schon vorhandene Flats je Projektname (`project`) beim Start – wie aus früheren Nächten (P-38 auf der VM ohne
     * zweite Nacht). `ageDays` = Alter der Flats (Standard 2).
     */
    readonly onRecord?: Readonly<
      Record<
        string,
        readonly {
          readonly filter: string;
          readonly mechDeg?: number;
          readonly gain?: number;
          readonly offset?: number;
          readonly binning?: number;
          readonly readoutModeIndex?: number;
          readonly ageDays?: number;
        }[]
      >
    >;
  };
  /** Weitere NINA-Instanzen am gleichen Rig (Szenario `lease`): zusätzliche Tokens `npm_test2`, … */
  readonly extraInstances?: number;
  /** Echte Nachttabelle Starfront ohne relative Nachtmarken (Szenario `current-night`, P-29). */
  readonly realNight?: boolean;
  /** Zweite Nacht planbar (Szenario `multi-night`, P-23): Pläne der Folgenacht 24 h später. */
  readonly multiNight?: boolean;
  /**
   * Abstand der Nächte in Minuten statt 24 h (VM-Lauf `vm-multi-night`, AP-52): zwei Nächte in einer Stunde. Das
   * Nachtfenster endet 1 min nach `sessionEndInMin`, die Folgenacht beginnt 1 min vor ihrem Start; der Abstand muss
   * mindestens `sessionEndInMin` + 2 sein.
   */
  readonly nightSpacingMin?: number;
  /**
   * Dämmerungen je Nacht (AP-52, *NINA-PM Warten auf Zeit*): Abenddurchgang in Minuten relativ zum Start der jeweiligen
   * Nacht (Nacht n = Serverstart + n · 24 h). Standard bürgerlich −40, nautisch −20, astronomisch 0 – in der ersten Nacht
   * also schon vorbei, in der zweiten 24 h später.
   */
  readonly twilightInMin?: {
    readonly civil?: number;
    readonly nautical?: number;
    readonly astronomical?: number;
  };
  /**
   * `targets.deliveryNights` (Tagesschleife, FA-NIN-07): Anzahl auslieferbarer Projekte je Nacht ab der aktuellen
   * (höchstens 3). Standard: alle Szenario-Projekte in der aktuellen Nacht, mit `multiNight` auch in den folgenden, sonst 0.
   */
  readonly deliveryProjects?: readonly number[];
  readonly timeline?: readonly TimelineAction[];
  /**
   * Overhead- und Flip-Werte des Rigs statt `TEST_SCHEDULER` (Starfront-Szenarien, gemessen 03.10.2026):
   * `pauseBeforeMin > 0` stoppt die Belichtungen vor `tM − pause` und wartet bis zum Flip (flip-rotation.md §2, limitEnd).
   */
  readonly scheduler?: {
    readonly afterMin?: number;
    readonly maxAfterMin?: number;
    readonly pauseBeforeMin?: number;
    readonly flipDurationS?: number;
    readonly slewCenterS?: number;
    readonly filterChangeS?: number;
    readonly ditherSettleS?: number;
    readonly downloadS?: number;
  };
  /** Rig-Abweichungen gegenüber dem Vertragsbeispiel (AP-16f, P-08): Rotator vorhanden, Toleranz, Block bei Winkelabweichung überspringen. */
  readonly rig?: {
    readonly rotatorPresent?: boolean;
    readonly rotatorToleranceDeg?: number;
    readonly skipOnRotationMismatch?: boolean;
  };
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
