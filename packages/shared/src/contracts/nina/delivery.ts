/**
 * `GET /web/v1/rigs/{id}/delivery` – „An NINA ausgeliefert“ (S-41, FA-NIN-22, TK 7.2): genau die Ziele,
 * die `GET /nina/v1/targets` dem Plugin dieses Rigs jetzt liefert (`isDeliverable`, gleicher ETag), je
 * Ziel mit Einzelfeld/Mosaik, Koordinaten, Rotation, Stand und Fortschritt je Filter.
 */
import { z } from 'zod';
import { projectStatuses, projectTypes } from '../../generated/enums';
import { Angle, NightKey, Text, UtcInstant, Uuid } from './common';

export const NinaDeliveryFilter = z.object({
  filterId: Uuid.nullable(),
  filterShortName: Text,
  /** Bestätigte NINA-Zuordnung des Filterrads (NT-E1); `null` = NINA erhält den Filter nicht zugeordnet. */
  ninaFilterName: Text.nullable(),
  planned: z.number().int().min(0),
  accepted: z.number().int().min(0),
});

export const NinaDeliveryItem = z
  .object({
    id: Uuid,
    name: Text,
    targetName: Text.nullable(),
    projectType: z.enum(projectTypes),
    /** Ersteller (`app_user.id`) – Bild und Name auf der Karte (30.09.2026). */
    createdBy: Uuid,
    status: z.enum(projectStatuses),
    priority: z.number().int(),
    version: z.number().int().min(1),
    /** „Stand“: letzte Änderung des Projekts. */
    updatedAt: UtcInstant,
    panelCount: z.number().int().min(1),
    /** Projektzentrum (bei Mosaiken der Mittelpunkt, sonst das Feld). */
    raDeg: z.number().min(0).lt(360).nullable(),
    decDeg: z.number().min(-90).max(90).nullable(),
    rotationDeg: Angle.nullable(),
    filters: z.array(NinaDeliveryFilter),
  })
  .meta({ id: 'NinaDeliveryItem' });
export type NinaDeliveryItem = z.infer<typeof NinaDeliveryItem>;

export const NinaRigDelivery = z
  .object({
    rigId: Uuid,
    rigName: Text,
    /** `rig.nina_delivery_enabled = false` → leere Auslieferung mit diesem Hinweis. */
    deliveryEnabled: z.boolean(),
    night: NightKey,
    generatedAtUtc: UtcInstant,
    settingsVersion: z.number().int().min(0),
    targetsEtag: Text,
    items: z.array(NinaDeliveryItem),
  })
  .meta({ id: 'NinaRigDelivery' });
export type NinaRigDelivery = z.infer<typeof NinaRigDelivery>;
