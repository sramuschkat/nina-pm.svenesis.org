/**
 * Bausteine der NINA-API (TK 7.6, contracts/nina/README.md „Grenzen in den zod-Schemas“): Zeichenketten
 * ≤ 256 (Meldungen ≤ 2000), Winkel −360 … 360, Zahlen endlich, Zeiten ISO-8601 mit `Z`.
 */
import { z } from 'zod';
import { NightKey, UtcInstant, Uuid } from '../common';

export { NightKey, UtcInstant, Uuid };

export const Text = z.string().max(256);
export const Message = z.string().max(2000);
export const Angle = z.number().min(-360).max(360);
export const Seconds = z.number().min(0);
export const Version = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
  .max(64);
export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{1,64}$/);

/** `data` frei, serialisiert ≤ `maxBytes` und Tiefe ≤ 8 (SEC-52). */
export function boundedJson(maxBytes: number) {
  return z
    .record(z.string(), z.unknown())
    .refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= maxBytes, {
      message: `höchstens ${String(maxBytes)} Bytes`,
    })
    .refine((v) => depth(v) <= 8, { message: 'Tiefe höchstens 8' });
}

function depth(v: unknown): number {
  if (v === null || typeof v !== 'object') return 0;
  const children = Array.isArray(v) ? v : Object.values(v);
  return 1 + children.reduce<number>((m, c) => Math.max(m, depth(c)), 0);
}

export const Lease = z.object({ untilUtc: UtcInstant.nullable(), leaseLost: z.boolean() });
