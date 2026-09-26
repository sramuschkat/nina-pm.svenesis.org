/**
 * Vorschaubilder der Projekte (AP-25; FA-PRJ-02, TK 12/13): Spalte `project.thumbnail_s3_key` (seit
 * Migration 0004). Der Job `thumbnail` (Rolle `app_job`) setzt den Schlüssel ohne Versionssprung – das
 * Bild ist abgeleitet und kein Bearbeitungsstand; `tick-hourly` findet Projekte ohne Bild.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../types';

/** Schlüssel am Projekt setzen (mandantengebunden, `version` und `updated_at` bleiben). */
export async function setProjectThumbnail(
  db: Kysely<Database>,
  tenantId: string,
  projectId: string,
  key: string | null,
): Promise<void> {
  await db
    .updateTable('project')
    .set({ thumbnailS3Key: key })
    .where('tenantId', '=', tenantId)
    .where('id', '=', projectId)
    .execute();
}

/** Liegt dieser Ausschnitt schon bei irgendeinem Projekt? Dann ist das Bild im Bucket, kein neuer Abruf. */
export async function thumbnailKeyInUse(db: Kysely<Database>, key: string): Promise<boolean> {
  const row = await db
    .selectFrom('project')
    .select('id')
    .where('thumbnailS3Key', '=', key)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

export interface ThumbnailCandidate {
  readonly tenantId: string;
  readonly projectId: string;
}

/** Projekte aktiver Mandanten mit Koordinaten und Rig, aber ohne Vorschaubild (älteste zuerst). */
export async function projectsWithoutThumbnail(
  db: Kysely<Database>,
  limit: number,
): Promise<ThumbnailCandidate[]> {
  const rows = await db
    .selectFrom('project as p')
    .innerJoin('tenant as t', 't.id', 'p.tenantId')
    .select(['p.tenantId', 'p.id'])
    .where('t.status', '=', 'active')
    .where('p.deletedAt', 'is', null)
    .where('p.raDeg', 'is not', null)
    .where('p.decDeg', 'is not', null)
    .where((eb) => eb.or([eb('p.rigId', 'is not', null), eb('p.requestedRigId', 'is not', null)]))
    .where('p.thumbnailS3Key', 'is', null)
    .orderBy('p.createdAt')
    .limit(limit)
    .execute();
  return rows.map((r) => ({ tenantId: r.tenantId, projectId: r.id }));
}
