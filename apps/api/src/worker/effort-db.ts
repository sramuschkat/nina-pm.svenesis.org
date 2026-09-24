/** Anbindung des Jobs `effort` an die Datenbank (Rolle `app_job`) und die Nacht-Tabelle des Servers. */
import {
  EffortRepository,
  effortSites,
  EquipmentRepository,
  JobRepository,
  ProjectRepository,
  siteNightRunDone,
  type OpenDatabase,
} from '@nina-pm/db';
import { siteNights } from '../lib/night-table';
import { rigView, moonProfileView } from '../routes/web-equipment';
import { projectView } from '../routes/web-projects';
import type { EffortDeps, EffortTickDeps } from './effort';

type Db = OpenDatabase['db'];

export function effortDbDeps(database: () => Promise<Db>): EffortDeps & EffortTickDeps {
  const repos = async (tenantId: string) => {
    const db = await database();
    const ctx = { tenantId };
    return {
      projects: () => new ProjectRepository(db, ctx),
      equipment: () => new EquipmentRepository(db, ctx),
      effort: () => new EffortRepository(db, ctx),
      job: new JobRepository(db, ctx),
    };
  };
  return {
    async load(tenantId, projectId) {
      const r = await repos(tenantId);
      const d = await r.projects().detail(projectId);
      if (!d) return null;
      const view = projectView(d);
      if (view.rigId === null) return null;
      const equipment = r.equipment();
      const rig = await equipment.rig(view.rigId);
      if (!rig) return null;
      const [site, profiles] = await Promise.all([
        equipment.site(rig.siteId),
        equipment.moonProfiles(),
      ]);
      if (!site) return null;
      return {
        project: view,
        version: d.project.version,
        rig: rigView(rig, undefined, undefined),
        site: {
          latitudeDeg: site.latitudeDeg,
          longitudeDeg: site.longitudeDeg,
          elevationM: site.elevationM,
          timeZone: site.timeZone,
        },
        moonProfiles: profiles.map(moonProfileView),
      };
    },
    nights: (site, now, count) => siteNights(site, now, undefined, count),
    save: async (tenantId, projectId, version, row) =>
      (await repos(tenantId)).effort().save(projectId, version, row),
    candidates: async (tenantId, siteId, now) =>
      (await repos(tenantId)).effort().candidates(siteId, now),
    enqueue: async (tenantId, input) => (await repos(tenantId)).job.enqueue(input),
    sites: async () => effortSites(await database()),
    runDone: async (tenantId, key) => siteNightRunDone(await database(), tenantId, key),
  };
}
