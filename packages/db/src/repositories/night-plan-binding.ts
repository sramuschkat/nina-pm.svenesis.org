/**
 * Serverpläne an Sessions binden (TK 7.3, NT-09, NT-47; Analyse 07.10.2026). Jede Session hat ihre eigenen Revisionen
 * (`UNIQUE (session_id, revision)`); eine `nightPlanId` gehört aber genau einer Zeile. Startet nach einem Neustart vor der
 * Dämmerung eine neue Session mit derselben Eingabe (gleiche `nightPlanId`), erhält sie eine **Kopie** der Revision
 * (neue Zeilen-ID, `summary.sourceNightPlanId` = ausgelieferte ID) – sonst hätte sie keinen Plan (Soll leer, Bericht
 * sofort fällig). Aufnahmen und Ereignisse tragen weiter die ausgelieferte `nightPlanId`.
 * Mandantengebunden; nur innerhalb einer Transaktion des Aufrufers.
 */
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../types';

type Db = Kysely<Database> | Transaction<Database>;

/**
 * Revisionen der Session nach `created_at` (dann ID) neu durchzählen (1…n). Zwei Durchgänge über negative Zwischenwerte,
 * damit `UNIQUE (session_id, revision)` zwischendurch nicht verletzt wird; unveränderte Zeilen bleiben unberührt.
 */
export async function renumberSessionPlans(
  trx: Db,
  tenantId: string,
  sessionId: string,
): Promise<void> {
  const rows = await trx
    .selectFrom('nightPlan')
    .select(['id', 'revision'])
    .where('tenantId', '=', tenantId)
    .where('sessionId', '=', sessionId)
    .orderBy('createdAt')
    .orderBy('id')
    .execute();
  const changed = rows
    .map((r, i) => ({ id: r.id, revision: i + 1, was: Number(r.revision) }))
    .filter((r) => r.was !== r.revision);
  for (const pass of [-1, 1])
    for (const r of changed)
      await trx
        .updateTable('nightPlan')
        .set({ revision: pass * r.revision })
        .where('tenantId', '=', tenantId)
        .where('id', '=', r.id)
        .execute();
}

/** Letzte Revision der Session (nur Kennwerte, ohne Blöcke – eine Revision kann groß sein). */
export async function latestSessionPlan(trx: Db, tenantId: string, sessionId: string) {
  const row = await trx
    .selectFrom('nightPlan')
    .select([
      'id',
      'revision',
      'inputHash',
      sql<string | null>`summary->>'contentKey'`.as('contentKey'),
      sql<string | null>`summary->>'sourceNightPlanId'`.as('sourceNightPlanId'),
    ])
    .where('tenantId', '=', tenantId)
    .where('sessionId', '=', sessionId)
    .where('origin', '=', 'server_plan')
    .orderBy('revision', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row
    ? {
        ...row,
        revision: Number(row.revision),
        /** ID, die das Plugin kennt (bei einer Kopie die der Quelle). */
        deliveredId: row.sourceNightPlanId ?? row.id,
      }
    : undefined;
}

/**
 * Plan beim Anlegen der Session binden (`POST /sessions` mit `nightPlanId`):
 * - ungebunden → an die Session (vor der Session gerechneter Plan, NT-47);
 * - an eine **andere** Session gebunden (Neustart vor der Dämmerung, gleiche Eingabe) → Kopie für diese Session mit
 *   `created_at` = Sessionstart;
 * - beides nur, wenn die Session noch keine Revision mit derselben Eingabe hat.
 * Danach Revisionen nach Zeit neu zählen: offline angelegte Sessions haben schon Revisionen, die der Server unter der
 * gemeldeten `sessionId` gespeichert hat, bevor er die Session kannte.
 */
export async function bindPlanAtSessionStart(
  trx: Db,
  tenantId: string,
  rigId: string,
  planId: string,
  sessionId: string,
  startedAt: Date,
): Promise<void> {
  const plan = await trx
    .selectFrom('nightPlan')
    .selectAll()
    .where('tenantId', '=', tenantId)
    .where('rigId', '=', rigId)
    .where('id', '=', planId)
    .executeTakeFirst();
  if (!plan || plan.sessionId === sessionId) return;
  // Dieselbe Eingabe hat die Session schon (Kopie aus `savePlan`, solange sie unbekannt war): nichts doppelt binden.
  const same = await trx
    .selectFrom('nightPlan')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('sessionId', '=', sessionId)
    .where('inputHash', '=', plan.inputHash)
    .executeTakeFirst();
  if (same) return;
  if (plan.sessionId === null) {
    // Zwischenwert 0: Revision 1 der Session kann schon vergeben sein; `renumberSessionPlans` ordnet nach Zeit.
    await trx
      .updateTable('nightPlan')
      .set({ sessionId, revision: 0 })
      .where('tenantId', '=', tenantId)
      .where('id', '=', planId)
      .where('sessionId', 'is', null)
      .execute();
  } else {
    const summary = (
      typeof plan.summary === 'string' ? JSON.parse(plan.summary) : plan.summary
    ) as Record<string, unknown>;
    const createdAt =
      new Date(plan.createdAt).getTime() > startedAt.getTime() ? plan.createdAt : startedAt;
    await trx
      .insertInto('nightPlan')
      .values({
        id: crypto.randomUUID(),
        tenantId,
        rigId,
        night: plan.night,
        origin: plan.origin,
        sessionId,
        revision: 0,
        reason: plan.reason,
        engineVersion: plan.engineVersion,
        inputHash: plan.inputHash,
        summary: JSON.stringify({ ...summary, sourceNightPlanId: plan.id }),
        blocks: typeof plan.blocks === 'string' ? plan.blocks : JSON.stringify(plan.blocks),
        createdAt,
      })
      .execute();
  }
  await renumberSessionPlans(trx, tenantId, sessionId);
}
