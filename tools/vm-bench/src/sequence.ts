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
}

interface SeqJson {
  Items: { $values: { $type: string; Items?: { $values: { $type: string }[] } }[] };
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
  const path = join(dir, `${SEQUENCE}.json`);
  writeFileSync(path, JSON.stringify(seq, null, 2));
  return path;
}
