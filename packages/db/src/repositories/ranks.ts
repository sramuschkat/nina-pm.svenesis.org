/**
 * Rangfolge beim Einreicher (FA-FRG-15, AP-32b): eingereichte Projekte und offene Änderungsanträge teilen
 * sich eine Rangfolge 1…n. Gelöschte Projekte und Anträge zu gelöschten Projekten zählen nicht.
 * Eigenes Modul, damit `project.ts` (Papierkorb) und `approval.ts` es ohne Zyklus nutzen.
 */
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../types';

type Tx = Transaction<Database>;

/**
 * Offene Änderungsanträge, die in der Rangfolge zählen: nur zu nicht gelöschten Projekten (ein Antrag zu
 * einem Projekt im Papierkorb ist unsichtbar und darf „n von m“ bzw. `setRanking` nicht blockieren).
 */
export function openRequests(db: Kysely<Database> | Tx, tenantId: string) {
  return db
    .selectFrom('changeRequest as c')
    .innerJoin('project as p', (j) =>
      j.onRef('p.id', '=', 'c.projectId').onRef('p.tenantId', '=', 'c.tenantId'),
    )
    .where('c.tenantId', '=', tenantId)
    .where('c.status', '=', 'open')
    .where('p.deletedAt', 'is', null);
}

/**
 * Wächter `app_user` für die Rangfolge beim Einreicher (rules/dsql.md): Zeilen aufsteigend nach ID in die
 * Konfliktprüfung nehmen, wenn die Einreicher erst in der Transaktion feststehen. Nur in `api`-Pfaden
 * (`app_rw`); `app_job` hat kein `UPDATE` auf `app_user` und damit kein `FOR UPDATE`.
 */
export async function lockSubmitters(db: Tx, tenantId: string, memberIds: readonly string[]) {
  for (const id of [...new Set(memberIds)].sort())
    await db
      .selectFrom('appUser')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .forUpdate()
      .execute();
}

/**
 * Rang 1…n der offenen Gegenstände eines Einreichers in bisheriger Reihenfolge (FA-FRG-15): eingereichte
 * Projekte und offene Änderungsanträge (AP-32b) teilen sich eine Rangfolge.
 */
export async function renumberRanks(db: Tx, tenantId: string, createdBy: string) {
  const projects = await db
    .selectFrom('project')
    .select(['id', 'submitterRank', 'createdAt'])
    .where('tenantId', '=', tenantId)
    .where('createdBy', '=', createdBy)
    .where('approvalStatus', '=', 'submitted')
    .where('deletedAt', 'is', null)
    .execute();
  const requests = await openRequests(db, tenantId)
    .select(['c.id', 'c.submitterRank', 'c.createdAt'])
    .where('c.requestedBy', '=', createdBy)
    .execute();
  const all = [
    ...projects.map((r) => ({ ...r, table: 'project' as const })),
    ...requests.map((r) => ({ ...r, table: 'changeRequest' as const })),
  ].sort(
    (a, b) =>
      (a.submitterRank ?? Number.MAX_SAFE_INTEGER) - (b.submitterRank ?? Number.MAX_SAFE_INTEGER) ||
      new Date(a.createdAt as unknown as string).getTime() -
        new Date(b.createdAt as unknown as string).getTime() ||
      (a.id < b.id ? -1 : 1),
  );
  for (const [i, r] of all.entries())
    if (r.submitterRank !== i + 1)
      await db
        .updateTable(r.table)
        .set({ submitterRank: i + 1 })
        .where('tenantId', '=', tenantId)
        .where('id', '=', r.id)
        .execute();
}

/** Nächster freier Rang eines Einreichers (Ende der gemeinsamen Rangfolge). */
export async function nextSubmitterRank(db: Tx, tenantId: string, createdBy: string) {
  const [p, c] = await Promise.all([
    db
      .selectFrom('project')
      .select((eb) => eb.fn.max('submitterRank').as('max'))
      .where('tenantId', '=', tenantId)
      .where('createdBy', '=', createdBy)
      .where('approvalStatus', '=', 'submitted')
      .where('deletedAt', 'is', null)
      .executeTakeFirst(),
    openRequests(db, tenantId)
      .select((eb) => eb.fn.max('c.submitterRank').as('max'))
      .where('c.requestedBy', '=', createdBy)
      .executeTakeFirst(),
  ]);
  return Math.max(Number(p?.max ?? 0), Number(c?.max ?? 0)) + 1;
}
