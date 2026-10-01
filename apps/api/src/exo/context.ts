/**
 * Rig-Kontext der Transitrechnung (AP-42): Standort, Teleskop, Kamera, Filterradbelegung (bestätigt bzw. nur
 * zugeordnet) und Kennwerte der Belichtungsempfehlung – gemeinsam für die Suche S-22 und den Reiter
 * *Exoplanet-Transit* im Projekt (FA-EXO-17). Dazu das Nachtfenster (FK 8.1) je Nacht-Schlüssel.
 */
import type { EquipmentRepository } from '@nina-pm/db';
import { nightTimes, type RigFilter } from '@nina-pm/engine';
import { buildNightTable } from '../lib/night-table';
import { exposureRig, type ExposureRig } from '@nina-pm/shared';

type Equipment = Pick<EquipmentRepository, 'rig' | 'site' | 'telescope' | 'camera' | 'filters'>;
export type RigRow = NonNullable<Awaited<ReturnType<EquipmentRepository['rig']>>>;
export type SiteRow = NonNullable<Awaited<ReturnType<EquipmentRepository['site']>>>;

export interface RigTransitContext {
  readonly rig: RigRow;
  readonly site: SiteRow;
  readonly apertureMm: number | null;
  /** Filter der bestätigten Filterradbelegung (FA-RIG-14, FA-EXO-08). */
  readonly rigFilters: RigFilter[];
  /** Web-Filter unbestätigter Plätze – nur für die Belichtungsempfehlung (transit.md §6). */
  readonly unconfirmedRigFilters: RigFilter[];
  readonly exposureRig: ExposureRig;
}

/** `undefined`, wenn Rig oder Standort im Mandanten fehlen (Aufrufer antwortet 404). */
export async function rigTransitContext(
  equipment: Equipment,
  rigId: string,
): Promise<RigTransitContext | undefined> {
  const rig = await equipment.rig(rigId);
  if (!rig) return undefined;
  const site = rig.siteId ? await equipment.site(rig.siteId) : undefined;
  if (!site) return undefined;
  const telescope = rig.telescopeId ? await equipment.telescope(rig.telescopeId) : undefined;
  const camera = rig.cameraId ? await equipment.camera(rig.cameraId) : undefined;
  const filters = await equipment.filters();
  const toRigFilter = (f: (typeof filters)[number]): RigFilter => ({
    id: f.id,
    shortName: f.shortName,
    photometricBand: f.photometricBand,
    filterType: f.filterType,
    centerWavelengthNm: f.centerWavelengthNm === null ? null : Number(f.centerWavelengthNm),
  });
  const slotFilters = (confirmed: boolean) =>
    rig.filterWheel
      .filter(
        (s) =>
          s.filterId !== null &&
          (s.ninaFilterName !== null && s.ninaConfirmedAt !== null) === confirmed,
      )
      .map((s) => filters.find((f) => f.id === s.filterId))
      .filter((f): f is NonNullable<typeof f> => f !== undefined)
      .map(toRigFilter);
  return {
    rig,
    site,
    apertureMm:
      telescope?.apertureMm === undefined || telescope.apertureMm === null
        ? null
        : Number(telescope.apertureMm),
    rigFilters: slotFilters(true),
    unconfirmedRigFilters: slotFilters(false),
    exposureRig: exposureRig({
      telescope,
      camera,
      site,
      downloadS: rig.overhead.downloadS,
      filters,
    }),
  };
}

/** Nachtfenster (FK 8.1) der Nächte ab `from`, in Unix-Sekunden. */
export function nightWindows(
  site: SiteRow,
  from: string,
  count: number,
): { night: string; startUtc: number; endUtc: number }[] {
  const table = buildNightTable(site, from, count);
  const transitions = table.timeZoneTransitions.map((z) => ({
    atUtc: Date.parse(z.atUtc) / 1000,
    utcOffsetMinutes: z.utcOffsetMinutes,
  }));
  return table.nights.map((n) => {
    const t = nightTimes({
      site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
      night: n.night,
      timeZoneTransitions: transitions,
    });
    return { night: n.night, startUtc: t.nightWindow.startUtc, endUtc: t.nightWindow.endUtc };
  });
}
