/**
 * NINA-Instanzen im Web (TK 5.6, 7.2; FA-SYN-01, SV-08): Token `npm_<base62(32 Bytes)>` wird einmalig
 * angezeigt, gespeichert werden nur SHA-256 und Präfix; Widerruf wirkt sofort.
 */
import { z } from 'zod';
import { ninaInstanceStatuses } from '../../generated/enums';
import { Text, UtcInstant, Uuid } from './common';

export const NinaInstanceView = z
  .object({
    id: Uuid,
    rigId: Uuid,
    name: Text,
    tokenPrefix: Text,
    status: z.enum(ninaInstanceStatuses),
    pluginVersion: Text.nullable(),
    engineVersion: Text.nullable(),
    lastSeenAt: UtcInstant.nullable(),
    settingsVersionFetched: z.number().int().nullable(),
    settingsFetchedAt: UtcInstant.nullable(),
    createdAt: UtcInstant,
  })
  .meta({ id: 'NinaInstanceView' });
export type NinaInstanceView = z.infer<typeof NinaInstanceView>;

export const NinaInstanceCreate = z
  .strictObject({ id: Uuid, rigId: Uuid, name: z.string().trim().min(1).max(120) })
  .meta({ id: 'NinaInstanceCreate' });

export const NinaInstanceCreated = NinaInstanceView.extend({
  /** Einmalig angezeigt; danach nur noch `tokenPrefix` (SV-08). */
  token: z.string().regex(/^npm_[0-9A-Za-z]{43}$/),
}).meta({ id: 'NinaInstanceCreated' });

export const NinaInstanceQuery = z.object({ rigId: Uuid.optional() });
