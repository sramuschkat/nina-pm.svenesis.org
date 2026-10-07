/** Anbindung der Jobs `multi_sim`/`impact` an Datenbank, Nacht-Tabelle und Wetter-Cache (Rolle `app_job`). */
import {
  ChangeRequestRepository,
  EquipmentRepository,
  NinaRigRepository,
  replaceForecast,
  latestWeather,
  ProjectRepository,
  type OpenDatabase,
} from '@nina-pm/db';
import type { JobResult, NightTransit, NightWeather } from '@nina-pm/shared';
import { isoUtc } from '../lib/format';
import { siteNights } from '../lib/night-table';
import { moonProfileView, rigView } from '../routes/web-equipment';
import { projectView } from '../routes/web-projects';
import { weatherView } from '../weather/view';
import type { ForecastDeps } from './forecast';
import type { MultiSimDeps } from './multi-sim';

type Db = OpenDatabase['db'];

export function multiSimDbDeps(
  database: () => Promise<Db>,
  putResult: (tenantId: string, jobId: string, result: JobResult) => Promise<string>,
): MultiSimDeps {
  return {
    async loadRig(tenantId, rigId) {
      const db = await database();
      const equipment = new EquipmentRepository(db, { tenantId });
      const rig = await equipment.rig(rigId);
      if (!rig) return null;
      const [site, profiles, list] = await Promise.all([
        equipment.site(rig.siteId),
        equipment.moonProfiles(),
        new ProjectRepository(db, { tenantId }).list({ admin: true, rigId }),
      ]);
      if (!site) return null;
      return {
        rig: rigView(rig, undefined, undefined),
        site: {
          id: site.id,
          latitudeDeg: site.latitudeDeg,
          longitudeDeg: site.longitudeDeg,
          elevationM: site.elevationM,
          timeZone: site.timeZone,
        },
        projects: list.map((d) => projectView(d)),
        moonProfiles: profiles.map(moonProfileView),
      };
    },
    async loadProject(tenantId, projectId) {
      const d = await new ProjectRepository(await database(), { tenantId }).detail(projectId);
      return d ? projectView(d) : null;
    },
    async loadChangeRequest(tenantId, id) {
      const db = await database();
      const row = await db
        .selectFrom('changeRequest')
        .select(['id', 'status'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst();
      if (row?.status !== 'open') return null;
      const r = await new ChangeRequestRepository(db, { tenantId }).byId(id);
      const d = await new ProjectRepository(db, { tenantId }).detail(r.row.projectId);
      return d ? { project: projectView(d), proposal: r.proposal } : null;
    },
    nights: (site, now, from, count) => siteNights(site, now, from, count),
    // Dieselbe Auswahl wie `POST /plan` (`deliverableByNight`): je Nacht und Projekt der früheste mit aktiver Zeile.
    async transits(tenantId, rigId, nights, now) {
      const seen = new Set<string>();
      const out: NightTransit[] = [];
      for (const t of await new NinaRigRepository(
        await database(),
        { tenantId },
        rigId,
      ).lockedTransits(nights, now)) {
        const key = `${t.night}:${t.projectId}`;
        if (t.lineId === null || seen.has(key)) continue;
        seen.add(key);
        out.push({
          night: t.night,
          projectId: t.projectId,
          observationId: t.observationId,
          lineId: t.lineId,
          windowStartUtc: isoUtc(t.windowStartUtc),
          windowEndUtc: isoUtc(t.windowEndUtc),
          lockedAtUtc: isoUtc(t.lockedAt),
        });
      }
      return out;
    },
    async weather(site, now) {
      const entry = await latestWeather(await database(), site.latitudeDeg, site.longitudeDeg);
      const out = new Map<string, NightWeather>();
      if (!entry) return out;
      for (const n of weatherView(site, entry, now).nights)
        out.set(n.night, { nightMean: n.nightMean, ratingIndex: n.ratingIndex });
      return out;
    },
    putResult,
  };
}

/** Anbindung des Jobs `forecast` (AP-33): Rigs des Standorts, Rig-Kontext wie `multi_sim`, Speichern. */
export function forecastDbDeps(database: () => Promise<Db>): ForecastDeps {
  const base = multiSimDbDeps(database, () => Promise.reject(new Error('kein Ergebnis')));
  return {
    loadRig: base.loadRig,
    nights: base.nights,
    ...(base.transits ? { transits: base.transits } : {}),
    async rigIdsOfSite(tenantId, siteId) {
      const rows = await (
        await database()
      )
        .selectFrom('rig')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('siteId', '=', siteId)
        .orderBy('id')
        .execute();
      return rows.map((r) => r.id);
    },
    replace: async (tenantId, rigId, rows, now) =>
      replaceForecast(await database(), tenantId, rigId, rows, now),
  };
}
