/**
 * `ops-cli export-setup` (Betrieb, nur Lesen): Aufbau des **Test-Mandanten** als JSON – Standorte, Teleskope,
 * Kameras, Filter, Mondprofile, Rigs (mit Filterrad und Scheduler), Projekte mit Panels, Zeilen, Bedingungen
 * und Zählern, NINA-Instanzen (ohne Token) und die Mengen der vorhandenen Auswertungsdaten. Grundlage für
 * passende Auswertungs-Demodaten. Keine Mitgliedsnamen, keine Geheimnisse (Tokens, Webhooks).
 */
import {
  EquipmentRepository,
  evaluationCounts,
  NinaInstanceRepository,
  ProjectRepository,
  type OpenDatabase,
} from '@nina-pm/db';
import { isoUtc } from '../lib/format';
import {
  cameraView,
  filterView,
  moonProfileView,
  rigView,
  siteView,
  telescopeView,
} from '../routes/web-equipment';
import { ninaInstanceView } from '../routes/web-nina-instances';
import { projectView } from '../routes/web-projects';

/** Nur der Test-Mandant (Entscheidung Sven, 26.09.2026). */
export const EXPORT_TENANT_KEY = 'test';
export const SETUP_EXPORT_VERSION = 1;

export async function runExportSetup(
  db: OpenDatabase['db'],
  tenant: { id: string; tenantKey: string; displayName: string },
  now: Date,
) {
  const eq = new EquipmentRepository(db, { tenantId: tenant.id });
  const [sites, telescopes, cameras, filters, moonProfiles, rigs, list, instances, counts] =
    await Promise.all([
      eq.sites(),
      eq.telescopes(),
      eq.cameras(),
      eq.filters(),
      eq.moonProfiles(),
      eq.rigs(),
      new ProjectRepository(db, { tenantId: tenant.id }).list({
        admin: true,
        deleted: false,
        mine: false,
        favorites: false,
      }),
      new NinaInstanceRepository(db, { tenantId: tenant.id }).list(),
      evaluationCounts(db, tenant.id),
    ]);
  const telescopeOf = new Map(telescopes.map((t) => [t.id, t]));
  const cameraOf = new Map(cameras.map((c) => [c.id, c]));
  return {
    version: SETUP_EXPORT_VERSION,
    exportedAt: isoUtc(now),
    tenant: { id: tenant.id, key: tenant.tenantKey, name: tenant.displayName },
    sites: sites.map(siteView),
    telescopes: telescopes.map(telescopeView),
    cameras: cameras.map(cameraView),
    filters: filters.map(filterView),
    moonProfiles: moonProfiles.map(moonProfileView),
    rigs: rigs.map((r) => rigView(r, telescopeOf.get(r.telescopeId), cameraOf.get(r.cameraId))),
    projects: list.map((d) => projectView(d)),
    ninaInstances: instances.map((i) => {
      const v = ninaInstanceView(i);
      return {
        id: v.id,
        name: v.name,
        rigId: v.rigId,
        status: v.status,
        pluginVersion: v.pluginVersion,
        lastSeenAt: v.lastSeenAt,
      };
    }),
    evaluation: counts,
  };
}
