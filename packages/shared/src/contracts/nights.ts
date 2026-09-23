/** Nacht-Tabelle (NT-02, specs/engine/night.md §1). */
import { z } from 'zod';
import { NightKey, UtcInstant } from './common';

export const NightRowSchema = z
  .object({
    night: NightKey,
    noonStartUtc: UtcInstant,
    noonEndUtc: UtcInstant,
    nightWindowEndUtc: UtcInstant,
  })
  .meta({ id: 'NightRow' });

export const NightTableSchema = z.object({ nights: z.array(NightRowSchema).min(1).max(400) });
