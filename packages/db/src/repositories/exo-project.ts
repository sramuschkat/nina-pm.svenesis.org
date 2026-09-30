/**
 * Exoplaneten-Projekte lesen (AP-42 Teil 2; FA-EXO-15/16/17): eigenes Projekt je Planet, Rig und Ersteller (OP-22),
 * Projekte anderer Mitglieder zum selben Planeten, `exo_project` mit Ephemeriden (aktiv + Historie). Geschrieben
 * wird im `ProjectRepository` (`createExoplanet`, `replaceEphemeris`), damit Projekt, Panel, Zeile und Verlauf in
 * einer Transaktion entstehen. Jede Abfrage ist mandantengebunden.
 */
import type { Selectable } from 'kysely';
import type { EphemerisTable, ExoProjectTable } from '../types';
import { TenantRepo } from './base';
import { exoDb } from './exo-catalog';

export type ExoProjectRow = Selectable<ExoProjectTable>;
export type EphemerisRow = Selectable<EphemerisTable>;

export interface ExoProjectOther {
  readonly projectId: string;
  readonly name: string;
  readonly createdByName: string;
  readonly rigName: string | null;
}

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class ExoProjectRepository extends TenantRepo {
  private get tenantId() {
    return this.ctx.tenantId;
  }

  /** Eigenes, nicht gelöschtes Exoplaneten-Projekt zu Planet und Rig (Rig oder Wunsch-Rig), sonst `undefined`. */
  async ownFor(planet: string, rigId: string): Promise<string | undefined> {
    const memberId = this.ctx.memberId;
    if (!memberId) return undefined;
    const row = await this.db
      .selectFrom('exoProject')
      .innerJoin('project', 'project.id', 'exoProject.projectId')
      .select('project.id')
      .where('exoProject.tenantId', '=', this.tenantId)
      .where('project.tenantId', '=', this.tenantId)
      .where('exoProject.planet', '=', planet)
      .where('project.createdBy', '=', memberId)
      .where('project.deletedAt', 'is', null)
      .where((eb) =>
        eb.or([eb('project.rigId', '=', rigId), eb('project.requestedRigId', '=', rigId)]),
      )
      .orderBy('project.createdAt')
      .executeTakeFirst();
    return row?.id;
  }

  async exoProject(projectId: string): Promise<ExoProjectRow | undefined> {
    const row = await this.db
      .selectFrom('exoProject')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .executeTakeFirst();
    return row ? { ...row, bufferSigma: Number(row.bufferSigma) } : undefined;
  }

  /** Alle Ephemeriden des Projekts, aktive zuerst, dann neueste zuerst. */
  async ephemerides(projectId: string): Promise<EphemerisRow[]> {
    const rows = await exoDb(this.db)
      .selectFrom('ephemeris')
      .selectAll()
      .where('tenantId', '=', this.tenantId)
      .where('projectId', '=', projectId)
      .orderBy('isActive', 'desc')
      .orderBy('createdAt', 'desc')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      ...r,
      t0BjdTdb: Number(r.t0BjdTdb),
      t0SigmaD: numOrNull(r.t0SigmaD),
      periodD: Number(r.periodD),
      periodSigmaD: numOrNull(r.periodSigmaD),
      durationH: numOrNull(r.durationH),
      oMinusCMin: numOrNull(r.oMinusCMin),
      depthMmag: numOrNull(r.depthMmag),
      rpOverRs: numOrNull(r.rpOverRs),
    }));
  }

  /** Nicht gelöschte Exoplaneten-Projekte anderer Mitglieder zum selben Planeten (FA-EXO-15, Hinweis). */
  async others(planet: string, exceptProjectId: string | null): Promise<ExoProjectOther[]> {
    const memberId = this.ctx.memberId ?? '';
    let q = this.db
      .selectFrom('exoProject')
      .innerJoin('project', 'project.id', 'exoProject.projectId')
      .leftJoin('appUser', (j) =>
        j.onRef('appUser.id', '=', 'project.createdBy').on('appUser.tenantId', '=', this.tenantId),
      )
      .leftJoin('rig', (j) =>
        j
          .on((eb) =>
            eb.or([
              eb('rig.id', '=', eb.ref('project.rigId')),
              eb.and([
                eb('project.rigId', 'is', null),
                eb('rig.id', '=', eb.ref('project.requestedRigId')),
              ]),
            ]),
          )
          .on('rig.tenantId', '=', this.tenantId),
      )
      .select([
        'project.id as projectId',
        'project.name',
        'appUser.displayName as createdByName',
        'rig.name as rigName',
      ])
      .where('exoProject.tenantId', '=', this.tenantId)
      .where('project.tenantId', '=', this.tenantId)
      .where('exoProject.planet', '=', planet)
      .where('project.createdBy', '!=', memberId)
      .where('project.deletedAt', 'is', null);
    if (exceptProjectId) q = q.where('project.id', '!=', exceptProjectId);
    const rows = await q.orderBy('project.createdAt').orderBy('project.id').execute();
    return rows.map((r) => ({
      projectId: r.projectId,
      name: r.name,
      createdByName: r.createdByName ?? '',
      rigName: r.rigName ?? null,
    }));
  }
}
