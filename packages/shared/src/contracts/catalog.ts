/**
 * Objektkatalog im Web (AP-20; FA-FRM-01, FA-FRM-15, S-21, S-82; specs/catalog/dso-import.md):
 * Suche und Filter über `dso_object`, Anzeigegruppe aus `dsoObjectTypeGroups`, Helligkeit mit Band,
 * Stand des Katalogs für S-82.
 */
import { z } from 'zod';
import { dsoCatalogPrefixes, dsoObjectTypes, twilight } from '../generated/enums';
import { NightKey, UtcInstant, Uuid } from './common';

export const DSO_TYPE_GROUPS = [
  'galaxy',
  'open_cluster',
  'globular_cluster',
  'planetary_nebula',
  'emission_nebula',
  'reflection_nebula',
  'dark_nebula',
  'supernova_remnant',
  'multiple_star',
  'other',
] as const;
export type DsoTypeGroup = (typeof DSO_TYPE_GROUPS)[number];

const optNumber = z.coerce.number().finite().optional();

export const DsoQuery = z.object({
  /** Bezeichnung oder Name; ohne Leerzeichen und Groß-/Kleinschreibung verglichen (FA-FRM-01). */
  q: z.string().trim().max(80).optional(),
  group: z.enum(DSO_TYPE_GROUPS).optional(),
  catalog: z.enum(dsoCatalogPrefixes).optional(),
  constellation: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
  /** Höchste Helligkeit (V, sonst B) in mag – kleiner = heller. */
  magMax: optNumber,
  surfBrMax: optNumber,
  sizeMinArcmin: optNumber,
  sizeMaxArcmin: optNumber,
  /** „Passt ins Bildfeld“: Großachse ≤ dieser Wert (Bildfeld des Rigs in Bogenminuten). */
  fitsFovArcmin: optNumber,
  /**
   * Nacht am Standort (FA-FRM-15, S-21): mit `siteId` rechnet die API je Treffer beste Zeit/Höhe,
   * Mondabstand und nutzbare Stunden (Engine, Slots wie der Scheduler); ohne `night` die laufende Nacht.
   */
  siteId: Uuid.optional(),
  night: NightKey.optional(),
  minAltDeg: z.coerce.number().min(0).max(90).default(30),
  twilight: z.enum(twilight).default('astronomical'),
  /** Mindestens so viele nutzbare Stunden (dunkel und über `minAltDeg`); nur mit `siteId`. */
  minUsableHours: z.coerce.number().min(0).max(24).optional(),
  sort: z.enum(['name', 'mag', 'size', 'usable', 'altitude']).default('name'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(20000).default(0),
});
export type DsoQuery = z.infer<typeof DsoQuery>;

export const DsoNight = z
  .object({
    visibility: z.enum(['never', 'circumpolar', 'normal']),
    /** Nutzbare Stunden: dunkel (Dämmerungsgrenze) und über der Mindesthöhe, 5-min-Slots. */
    usableHours: z.number(),
    /** Größte scheinbare Höhe im Nachtfenster, solange es dunkel ist (ohne Dunkelheit: im Fenster). */
    peakAltDeg: z.number().nullable(),
    peakUtc: UtcInstant.nullable(),
    /** Abstand zum Mond zur besten Zeit, Grad; `null` ohne Mond über dem Horizont. */
    moonSepDeg: z.number().nullable(),
  })
  .meta({ id: 'DsoNight' });
export type DsoNight = z.infer<typeof DsoNight>;

export const DsoView = z
  .object({
    id: Uuid,
    primaryId: z.string(),
    /** Messier → NGC → IC → Caldwell → Sharpless → sonstige (§3 Nr. 4). */
    displayName: z.string(),
    names: z.array(z.string()),
    catalogs: z.array(z.enum(dsoCatalogPrefixes)),
    objectType: z.enum(dsoObjectTypes),
    group: z.enum(DSO_TYPE_GROUPS),
    constellation: z.string().nullable(),
    raDeg: z.number(),
    decDeg: z.number(),
    magV: z.number().nullable(),
    magB: z.number().nullable(),
    magBandUsed: z.enum(['V', 'B']).nullable(),
    surfBrMagArcsec2: z.number().nullable(),
    sizeMajorArcmin: z.number().nullable(),
    sizeMinorArcmin: z.number().nullable(),
    positionAngleDeg: z.number().nullable(),
    source: z.string(),
    /** Nur mit `siteId` in der Anfrage. */
    night: DsoNight.nullable(),
  })
  .meta({ id: 'DsoView' });
export type DsoView = z.infer<typeof DsoView>;

export const DsoList = z
  .object({
    items: z.array(DsoView),
    total: z.number().int().min(0),
    /** Stand der Katalogdatei (Quellen-Hinweis, FA-ADM-07). */
    catalog: z.object({ version: z.string(), fetchedAt: NightKey }),
    /** Gerechnete Nacht (nur mit `siteId`): Nachtfenster und Mond. */
    night: z
      .object({
        night: NightKey,
        timeZone: z.string(),
        darkStartUtc: UtcInstant.nullable(),
        darkEndUtc: UtcInstant.nullable(),
        moonIllumPct: z.number().nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'DsoList' });
export type DsoList = z.infer<typeof DsoList>;

export const CatalogStatus = z
  .object({
    dso: z.object({
      version: z.string(),
      fetchedAt: z.string(),
      /** Quellzeilen je Datei der Version (T-KAT-10) und erwartete Zeilen in `dso_object`. */
      ngcCsvRows: z.number().int(),
      addendumCsvRows: z.number().int(),
      expectedRows: z.number().int(),
      sharplessRows: z.number().int(),
      warnings: z.number().int(),
      rows: z.number().int(),
      lastImportAt: UtcInstant.nullable(),
      sources: z.array(z.string()),
      lastJob: z
        .object({
          id: Uuid,
          status: z.enum(['pending', 'running', 'done', 'failed']),
          error: z.string().nullable(),
          createdAt: UtcInstant,
          finishedAt: UtcInstant.nullable(),
        })
        .nullable(),
    }),
  })
  .meta({ id: 'CatalogStatus' });
export type CatalogStatus = z.infer<typeof CatalogStatus>;
