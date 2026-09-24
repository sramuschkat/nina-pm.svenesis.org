/**
 * Protokolle lesen: System-Audit (FA-SU-09) – für Super User vollständig, für Admins eines Mandanten nur
 * die Super-User-Aktionen, die ihn betreffen (`GET /web/v1/audit/system`, `tenant.settings`).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../types';
import { TenantRepo } from './base';
import { decodeCursor, encodeCursor } from './notification';

export interface AuditPage {
  limit: number;
  cursor?: string | undefined;
}

export interface SystemAuditRow {
  id: string;
  actor: 'super_user' | 'ops_cli';
  actorName: string | null;
  tenantId: string | null;
  tenantKey: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

export async function listSystemAudit(
  db: Kysely<Database>,
  page: AuditPage & { tenantId?: string | undefined },
): Promise<{ items: SystemAuditRow[]; nextCursor: string | null }> {
  let q = db
    .selectFrom('systemAudit as a')
    .leftJoin('identity as i', 'i.id', 'a.superUserId')
    .leftJoin('tenant as t', 't.id', 'a.tenantId')
    .select([
      'a.id',
      'a.actor',
      sql<string | null>`coalesce(i.discord_global_name, i.discord_username)`.as('actorName'),
      'a.tenantId',
      't.tenantKey',
      'a.action',
      'a.details',
      'a.createdAt',
    ]);
  if (page.tenantId) q = q.where('a.tenantId', '=', page.tenantId);
  const cursor = page.cursor ? decodeCursor(page.cursor) : undefined;
  if (cursor) q = q.where(sql<boolean>`(a.created_at, a.id) < (${cursor.at}, ${cursor.id}::uuid)`);
  const rows = await q
    .orderBy('a.createdAt', 'desc')
    .orderBy('a.id', 'desc')
    .limit(page.limit + 1)
    .execute();
  const items = rows.slice(0, page.limit).map((r) => ({
    ...r,
    tenantKey: r.tenantKey ?? null,
    details: (typeof r.details === 'string' ? JSON.parse(r.details) : (r.details ?? {})) as Record<
      string,
      unknown
    >,
  }));
  const last = items.at(-1);
  return { items, nextCursor: rows.length > page.limit && last ? encodeCursor(last) : null };
}

export interface ChangeLogRow {
  id: string;
  entity: string;
  entityId: string;
  actorName: string | null;
  subjectName: string | null;
  action: string;
  diff: Record<string, unknown>;
  createdAt: Date;
}

const parseJson = (v: unknown) =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>;

export class AuditRepository extends TenantRepo {
  /** Super-User- und `ops-cli`-Aktionen, die den eigenen Mandanten betreffen (FA-SU-09). */
  systemAudit(page: AuditPage) {
    return listSystemAudit(this.db, { ...page, tenantId: this.ctx.tenantId });
  }

  /** Änderungsprotokoll des Mandanten (S-72, `change_log`), neueste zuerst, optional je Objektart. */
  async changes(
    page: AuditPage & { entity?: string | undefined },
  ): Promise<{ items: ChangeLogRow[]; nextCursor: string | null }> {
    let q = this.db
      .selectFrom('changeLog as l')
      .leftJoin('appUser as a', (j) =>
        j.onRef('a.id', '=', 'l.userId').onRef('a.tenantId', '=', 'l.tenantId'),
      )
      .leftJoin('appUser as s', (j) =>
        j
          .onRef('s.id', '=', 'l.entityId')
          .onRef('s.tenantId', '=', 'l.tenantId')
          .on('l.entity', '=', 'app_user'),
      )
      .select([
        'l.id',
        'l.entity',
        'l.entityId',
        'a.displayName as actorName',
        's.displayName as subjectName',
        'l.action',
        'l.diff',
        'l.createdAt',
      ])
      .where('l.tenantId', '=', this.ctx.tenantId);
    if (page.entity) q = q.where('l.entity', '=', page.entity);
    const cursor = page.cursor ? decodeCursor(page.cursor) : undefined;
    if (cursor)
      q = q.where(sql<boolean>`(l.created_at, l.id) < (${cursor.at}, ${cursor.id}::uuid)`);
    const rows = await q
      .orderBy('l.createdAt', 'desc')
      .orderBy('l.id', 'desc')
      .limit(page.limit + 1)
      .execute();
    const items = rows.slice(0, page.limit).map((r) => ({
      ...r,
      actorName: r.actorName ?? null,
      subjectName: r.subjectName ?? null,
      diff: parseJson(r.diff),
    }));
    const last = items.at(-1);
    return { items, nextCursor: rows.length > page.limit && last ? encodeCursor(last) : null };
  }
}

/** Öffentlicher Wartungshinweis (FA-SU-08): nur wenn aktiv, sonst `null`. */
export async function readMaintenanceBanner(
  db: Kysely<Database>,
): Promise<{ de: string; en: string } | null> {
  const row = await db
    .selectFrom('systemSetting')
    .select('value')
    .where('key', '=', 'maintenanceBanner')
    .executeTakeFirst();
  const v = (typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value) as
    { active?: boolean; textDe?: string; textEn?: string } | undefined;
  return v?.active && v.textDe && v.textEn ? { de: v.textDe, en: v.textEn } : null;
}
