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
  /**
   * In der Box *Vor Flats* NINAs *Wait for Time* mit Quelle *Nautical Dawn*: Flats erst nach der nautischen Dämmerung
   * (Regel in Starfront, 05.10.2026). Ist sie schon vorbei, wartet NINA nicht (Wartezeit 0).
   */
  readonly flatsBeforeWait?: 'nauticalDawn';
  /**
   * Sequenz „Mehrere Nächte“ (AP-52): Quelle und Versatz der Anweisung *NINA-PM Warten auf Zeit* (Quelle wie
   * `WaitSource`: `Time`, `CivilDusk`, `NauticalDusk`, `AstronomicalDusk`).
   */
  readonly waitForTime?: { readonly source: string; readonly offsetMinutes: number };
  /** Höchstzahl Nächte der *NINA-PM Tagesschleife* (AP-52). */
  readonly maxNights?: number;
  /**
   * Trigger-Box *NINA-PM vor jeder Belichtung* am Container „Ziel“ mit einer harmlosen Anweisung (*Wait for Time Span*
   * 1 s); das Plugin loggt je Lauf `TRIGGER type=BeforeExposureTrigger` (P-24).
   */
  readonly beforeExposureBox?: boolean;
}

type Obj = Record<string, unknown> & { $type?: string; $id?: string };

/** Alle Objekte mit `$type` in Tiefensuche. */
function objects(o: unknown, out: Obj[] = []): Obj[] {
  if (Array.isArray(o)) for (const v of o) objects(v, out);
  else if (o && typeof o === 'object') {
    if ((o as Obj).$type) out.push(o as Obj);
    for (const v of Object.values(o)) objects(v, out);
  }
  return out;
}

const values = (o: Obj, key: string) => (o[key] as { $values?: Obj[] } | undefined)?.$values ?? [];

/** Container mit der Bedingung *NINA-PM Tagesschleife* (Sequenz „Mehrere Nächte“). */
const dayLoop = (seq: unknown) =>
  objects(seq).find((o) =>
    values(o, 'Conditions').some((c) => shortType(c.$type ?? '') === 'DayLoopCondition'),
  );

/** Box *NINA-PM vor jeder Belichtung* mit *Wait for Time Span* 1 s (Form wie die Trigger in den Beispielsequenzen). */
function beforeExposureTrigger(firstId: number, parentId: string): unknown {
  const id = (k: number) => String(firstId + k);
  return {
    $id: id(0),
    $type: 'NinaPm.Nina.Sequencer.BeforeExposureTrigger, NinaPm.Nina',
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
            $type: T('SequenceItem.Utility.WaitForTimeSpan'),
            Time: 1,
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
    next: Math.max(firstId + 4, maxId(values) + 1),
  };
}

/**
 * *Trained Flat Exposure* bzw. *Trained Dark Flat Exposure* vollständig wie von NINA gespeichert: beide leeren beim
 * Laden ihre Unterelemente (`OnDeserializing` → `Items.Clear()`, VM-Lauf 04.10.2026: ohne `Items` „Index was out of
 * range“). Aufbau nach den Konstruktoren in NINA 3.2 (`NINA.Sequencer/SequenceItem/FlatDevice/Trained*.cs`):
 * Abdeckung zu, Licht an (Dark: aus), Filter, Helligkeit, Container mit Schleife und Belichtung, [Licht aus], Abdeckung auf.
 */
function flatInstruction(
  kind: 'flat' | 'dark',
  firstId: number,
  parentRef: string,
): { json: unknown; next: number } {
  let n = firstId;
  const next = () => String(n++);
  const self = next();
  const item = (type: string, extra: Record<string, unknown> = {}) => ({
    $id: next(),
    $type: T(`SequenceItem.${type}`),
    ...extra,
    Parent: { $ref: self },
    ErrorBehavior: 0,
    Attempts: 1,
  });
  const conditionsId = next();
  const itemsId = next();
  const triggersId = next();
  const head = [
    item('FlatDevice.CloseCover'),
    item('FlatDevice.ToggleLight', { OnOff: kind === 'flat' }),
    item('FilterWheel.SwitchFilter', { Filter: null }),
    item('FlatDevice.SetBrightness', { Brightness: 0 }),
  ];
  const inner = next();
  const imaging = {
    $id: inner,
    $type: T('Container.SequentialContainer'),
    Strategy: { $type: T('Container.ExecutionStrategy.SequentialStrategy') },
    Name: null,
    Conditions: {
      $id: next(),
      $type: COLLECTION('Conditions.ISequenceCondition'),
      $values: [
        {
          $id: next(),
          $type: T('Conditions.LoopCondition'),
          CompletedIterations: 0,
          Iterations: 1,
          Parent: { $ref: inner },
        },
      ],
    },
    IsExpanded: true,
    Items: {
      $id: next(),
      $type: COLLECTION('SequenceItem.ISequenceItem'),
      $values: [
        {
          $id: next(),
          $type: T('SequenceItem.Imaging.TakeExposure'),
          ExposureTime: 1,
          Gain: -1,
          Offset: -1,
          Binning: {
            $id: next(),
            $type: 'NINA.Core.Model.Equipment.BinningMode, NINA.Core',
            X: 1,
            Y: 1,
          },
          ImageType: kind === 'flat' ? 'FLAT' : 'DARK',
          ExposureCount: 0,
          Parent: { $ref: inner },
          ErrorBehavior: 0,
          Attempts: 1,
        },
      ],
    },
    Triggers: { $id: next(), $type: COLLECTION('Trigger.ISequenceTrigger'), $values: [] },
    Parent: { $ref: self },
    ErrorBehavior: 0,
    Attempts: 1,
  };
  const tail =
    kind === 'flat'
      ? [item('FlatDevice.ToggleLight', { OnOff: false }), item('FlatDevice.OpenCover')]
      : [item('FlatDevice.OpenCover')];
  return {
    json: {
      $id: self,
      $type: T(
        `SequenceItem.FlatDevice.${kind === 'flat' ? 'TrainedFlatExposure' : 'TrainedDarkFlatExposure'}`,
      ),
      Strategy: { $type: T('Container.ExecutionStrategy.SequentialStrategy') },
      // Kein `Name`: Container speichern ihren Namen, `null` überschriebe den Anzeigenamen der Vorlage
      // („Trained Flat Exposure“) – der Baustein stünde ohne Namen in der Flats-Box (05.10.2026).
      Conditions: {
        $id: conditionsId,
        $type: COLLECTION('Conditions.ISequenceCondition'),
        $values: [],
      },
      IsExpanded: false,
      Items: {
        $id: itemsId,
        $type: COLLECTION('SequenceItem.ISequenceItem'),
        $values: [...head, imaging, ...tail],
      },
      Triggers: { $id: triggersId, $type: COLLECTION('Trigger.ISequenceTrigger'), $values: [] },
      Parent: { $ref: parentRef },
      ErrorBehavior: 0,
      Attempts: 1,
      KeepPanelClosed: true,
    },
    next: n,
  };
}

/** Flat-Boxen an den Baustein *NINA-PM Instructions* hängen (siehe `SequenceSpec.flats`). */
function addFlatBoxes(seq: unknown, firstId: number, beforeWait?: 'nauticalDawn'): void {
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
  const setup = box(firstId, (runner, next) =>
    beforeWait === 'nauticalDawn'
      ? [
          {
            $id: String(next),
            $type: T('SequenceItem.Utility.WaitForTime'),
            Hours: 0,
            Minutes: 0,
            MinutesOffset: 0,
            Seconds: 0,
            SelectedProvider: { $type: T('Utility.DateTimeProvider.NauticalDawnProvider') },
            Parent: { $ref: runner },
            ErrorBehavior: 0,
            Attempts: 1,
          },
        ]
      : [],
  );
  const perCombination = box(setup.next, (runner, next) => {
    const flat = flatInstruction('flat', next, runner);
    const dark = flatInstruction('dark', flat.next, runner);
    return [flat.json, dark.json];
  });
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
  // „Mehrere Nächte“: der Start jeder Nacht steht in der Tagesschleife (vor der äußeren Schleife).
  const day = dayLoop(seq);
  if (day) {
    const items = day.Items as { $values: Obj[] };
    items.$values = items.$values.filter((i) => !remove.has(shortType(i.$type ?? '')));
    if (r.sequence.maxNights !== undefined)
      for (const c of values(day, 'Conditions'))
        if (shortType(c.$type ?? '') === 'DayLoopCondition') c.MaxNights = r.sequence.maxNights;
  }
  if (r.sequence.waitForTime)
    for (const w of objects(seq).filter(
      (o) => shortType(o.$type ?? '') === 'WaitForTimeInstruction',
    )) {
      w.Source = r.sequence.waitForTime.source;
      w.OffsetMinutes = r.sequence.waitForTime.offsetMinutes;
    }
  if (r.sequence.beforeExposureBox) {
    const ziel = objects(seq).find((o) => o.Name === 'Ziel');
    if (!ziel?.$id) throw new Error(`${r.sequence.from}: Container „Ziel“ fehlt`);
    values(ziel, 'Triggers').push(beforeExposureTrigger(maxId(seq) + 1, ziel.$id) as Obj);
  }
  if (r.sequence.globalDither !== undefined)
    seq.Triggers.$values.push(ditherTrigger(maxId(seq) + 1, seq.$id, r.sequence.globalDither));
  if (r.sequence.flats) addFlatBoxes(seq, maxId(seq) + 1, r.sequence.flatsBeforeWait);
  const path = join(dir, `${SEQUENCE}.json`);
  writeFileSync(path, JSON.stringify(seq, null, 2));
  return path;
}
