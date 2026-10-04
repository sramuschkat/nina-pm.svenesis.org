/**
 * Laufsequenz des Prüfstands aus einer Beispielsequenz (`apps/nina-plugin/NinaPm.Nina/Samples`): Anweisungen im
 * Start-Bereich nach kurzem Typnamen entfernen. NINA 3.2 speichert „deaktiviert“ nicht (`Status` ist keine
 * JSON-Eigenschaft) – eine deaktivierte Anweisung wäre nach dem Laden wieder aktiv.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEQUENCE = 'nina-pm-bench';
const SAMPLES = fileURLToPath(
  new URL('../../../apps/nina-plugin/NinaPm.Nina/Samples/', import.meta.url),
);

export interface SequenceSpec {
  readonly from: string;
  readonly removeFromStart?: readonly string[];
  /** Globaler Trigger *Dither after Exposures* (NINA) mit diesem `AfterExposures` – vm-smoke prüft die Unterdrückung (NT-23). */
  readonly globalDither?: number;
  /**
   * Flat-Boxen am Baustein *NINA-PM Instructions* (AP-50): *Je Kombination* mit *Trained Flat Exposure* und
   * *Trained Dark Flat Exposure* (beide *Keep Panel Closed*), *Vor Flats* und *Nach Flats* leer. Die Anweisungen ohne `Items`:
   * NINA legt sie über seine Fabrik mit den Standard-Unterelementen an und füllt nur die genannten Eigenschaften.
   */
  readonly flats?: boolean;
}

interface SeqJson {
  $id: string;
  Items: { $values: { $type: string; Items?: { $values: { $type: string }[] } }[] };
  Triggers: { $values: unknown[] };
}

const T = (n: string) => `NINA.Sequencer.${n}, NINA.Sequencer`;
const COLLECTION = (item: string) =>
  `System.Collections.ObjectModel.ObservableCollection\`1[[NINA.Sequencer.${item}, NINA.Sequencer]], System.ObjectModel`;

/** Größte `$id` der Datei (neue Objekte bekommen fortlaufend höhere). */
function maxId(o: unknown): number {
  if (Array.isArray(o)) return Math.max(0, ...o.map(maxId));
  if (o && typeof o === 'object') {
    const own = Number((o as { $id?: string }).$id ?? 0);
    return Math.max(own, ...Object.values(o).map(maxId));
  }
  return 0;
}

/** NINA-Trigger *Dither after Exposures* mit seiner Anweisungsbox (Form wie die Trigger in den Beispielsequenzen). */
function ditherTrigger(firstId: number, parentId: string, afterExposures: number): unknown {
  const id = (k: number) => String(firstId + k);
  return {
    $id: id(0),
    $type: T('Trigger.Guider.DitherAfterExposures'),
    AfterExposures: afterExposures,
    Parent: { $ref: parentId },
    TriggerRunner: {
      $id: id(1),
      $type: T('Container.SequentialContainer'),
      Strategy: { $type: T('Container.ExecutionStrategy.SequentialStrategy') },
      Name: null,
      Conditions: { $id: id(2), $type: COLLECTION('Conditions.ISequenceCondition'), $values: [] },
      IsExpanded: true,
      Items: {
        $id: id(3),
        $type: COLLECTION('SequenceItem.ISequenceItem'),
        $values: [
          {
            $id: id(4),
            $type: T('SequenceItem.Guider.Dither'),
            Parent: { $ref: id(1) },
            ErrorBehavior: 0,
            Attempts: 1,
          },
        ],
      },
      Triggers: { $id: id(5), $type: COLLECTION('Trigger.ISequenceTrigger'), $values: [] },
      Parent: null,
      ErrorBehavior: 0,
      Attempts: 1,
    },
  };
}

export const shortType = (t: string): string => (t.split(',')[0] ?? '').split('.').pop() ?? '';

/** Eine leere oder gefüllte Box (SequentialContainer) wie der TriggerRunner der Beispielsequenzen. */
function box(
  firstId: number,
  items: (runnerId: string, nextId: number) => unknown[],
): { json: unknown; next: number } {
  const id = (k: number) => String(firstId + k);
  const values = items(id(0), firstId + 4);
  return {
    json: {
      $id: id(0),
      $type: T('Container.SequentialContainer'),
      Strategy: { $type: T('Container.ExecutionStrategy.SequentialStrategy') },
      Name: null,
      Conditions: { $id: id(1), $type: COLLECTION('Conditions.ISequenceCondition'), $values: [] },
      IsExpanded: true,
      Items: { $id: id(2), $type: COLLECTION('SequenceItem.ISequenceItem'), $values: values },
      Triggers: { $id: id(3), $type: COLLECTION('Trigger.ISequenceTrigger'), $values: [] },
      Parent: null,
      ErrorBehavior: 0,
      Attempts: 1,
    },
    next: firstId + 4 + values.length,
  };
}

/** Flat-Boxen an den Baustein *NINA-PM Instructions* hängen (siehe `SequenceSpec.flats`). */
function addFlatBoxes(seq: unknown, firstId: number): void {
  const find = (o: unknown): Record<string, unknown> | undefined => {
    if (Array.isArray(o)) return o.map(find).find(Boolean);
    if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (String(r.$type ?? '').startsWith('NinaPm.Nina.Sequencer.NinaPmContainer')) return r;
      return Object.values(r).map(find).find(Boolean);
    }
    return undefined;
  };
  const container = find(seq);
  if (!container) throw new Error('Sequenz ohne NINA-PM Instructions');
  const flatItem = (type: string, id: number, runner: string) => ({
    $id: String(id),
    $type: T(`SequenceItem.FlatDevice.${type}`),
    KeepPanelClosed: true,
    Parent: { $ref: runner },
    ErrorBehavior: 0,
    Attempts: 1,
  });
  const setup = box(firstId, () => []);
  const perCombination = box(setup.next, (runner, next) => [
    flatItem('TrainedFlatExposure', next, runner),
    flatItem('TrainedDarkFlatExposure', next + 1, runner),
  ]);
  const teardown = box(perCombination.next, () => []);
  container.FlatsSetupRunner = setup.json;
  container.FlatsRunner = perCombination.json;
  container.FlatsTeardownRunner = teardown.json;
}

/** Schreibt `<dir>/nina-pm-bench.json` und liefert den Pfad. */
export function benchSequence(r: { readonly sequence: SequenceSpec }, dir: string): string {
  const raw = readFileSync(join(SAMPLES, `${r.sequence.from}.json`), 'utf8').replace(/^\uFEFF/, '');
  const seq = JSON.parse(raw) as SeqJson;
  const start = seq.Items.$values.find((c) => c.$type.includes('StartAreaContainer'));
  if (!start?.Items) throw new Error(`${r.sequence.from}: Start-Bereich fehlt`);
  const remove = new Set(r.sequence.removeFromStart ?? []);
  start.Items.$values = start.Items.$values.filter((i) => !remove.has(shortType(i.$type)));
  if (r.sequence.globalDither !== undefined)
    seq.Triggers.$values.push(ditherTrigger(maxId(seq) + 1, seq.$id, r.sequence.globalDither));
  if (r.sequence.flats) addFlatBoxes(seq, maxId(seq) + 1);
  const path = join(dir, `${SEQUENCE}.json`);
  writeFileSync(path, JSON.stringify(seq, null, 2));
  return path;
}
