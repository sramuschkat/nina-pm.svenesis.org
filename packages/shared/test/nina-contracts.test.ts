/**
 * NINA-API-Verträge (AP-14a, contracts/nina/README.md): jedes Beispiel validiert gegen sein zod-Schema.
 * Gekürzte IDs (`a91f…`) und Hashes (`sha256:9c1e…`) werden deterministisch ergänzt; dieselbe Kürzung
 * ergibt dieselbe UUID, damit Verweise zwischen den Dateien stimmen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { nina } from '../src';

const dir = fileURLToPath(new URL('../../../docs/contracts/nina/', import.meta.url));
const ids = new Map<string, string>();
const uuidFor = (short: string) => {
  let id = ids.get(short);
  if (!id) {
    const n = ids.size + 1;
    id = `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
    ids.set(short, id);
  }
  return id;
};

/** Ersetzt gekürzte Werte in allen Zeichenketten. */
export function expand(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^sha256:[0-9a-f]*…$/.test(value)) return `sha256:${'0'.repeat(64)}`;
    if (/^[0-9a-z-]+…$/i.test(value)) return uuidFor(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
  return value;
}

export const example = (name: string) =>
  expand(JSON.parse(readFileSync(`${dir}${name}.example.json`, 'utf8')));

const cases: [string, z.ZodType][] = [
  ['bootstrap.response', nina.NinaBootstrap],
  ['targets.response', nina.NinaTargets],
  ['plan.request', nina.NinaPlanRequest],
  ['plan.response', nina.NinaPlanResponse],
  ['session.create.request', nina.NinaSessionCreate],
  ['session.create.response', nina.NinaSessionCreated],
  ['session.patch.request', nina.NinaSessionPatch],
  ['session.patch.running', nina.NinaSessionPatch],
  ['session.patch.offline', nina.NinaSessionPatch],
  ['session.patch.response', nina.NinaSessionPatched],
  ['captures.request', nina.NinaCaptureBatch],
  ['events.request', nina.NinaEventBatch],
  ['heartbeat.request', nina.NinaHeartbeat],
  ['heartbeat.response', nina.NinaHeartbeatResponse],
];

describe('contracts/nina: Beispiele validieren gegen die Schemas', () => {
  it.each(cases)('%s', (name, schema) => {
    const r = schema.safeParse(example(name));
    expect(r.error?.issues ?? []).toEqual([]);
  });

  it('Grenzen: fileName bei saved Pflicht, 501 Aufnahmen und 201 Ereignisse abgelehnt, data ≤ 8 KiB', () => {
    const batch = example('captures.request') as { captures: Record<string, unknown>[] };
    const light = batch.captures[0] as Record<string, unknown>;
    const noFile = Object.fromEntries(Object.entries(light).filter(([k]) => k !== 'fileName'));
    expect(nina.NinaCaptureBatch.safeParse({ captures: [noFile] }).success).toBe(false);
    expect(
      nina.NinaCaptureBatch.safeParse({ captures: [{ ...noFile, result: 'aborted' }] }).success,
    ).toBe(true);
    expect(
      nina.NinaCaptureBatch.safeParse({ captures: Array.from({ length: 501 }, () => light) })
        .success,
    ).toBe(false);
    const ev = (example('events.request') as { events: Record<string, unknown>[] }).events[0];
    expect(
      nina.NinaEventBatch.safeParse({ events: Array.from({ length: 201 }, () => ev) }).success,
    ).toBe(false);
    expect(
      nina.NinaEventBatch.safeParse({ events: [{ ...ev, data: { blob: 'x'.repeat(9000) } }] })
        .success,
    ).toBe(false);
  });
});
