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
  const path = join(dir, `${SEQUENCE}.json`);
  writeFileSync(path, JSON.stringify(seq, null, 2));
  return path;
}
