/**
 * Ausrüstungs-Seed (AP-09a; docs/seed/seed-demo.json): Standorte, Teleskope, Kameras, Filter und Rigs
 * samt Scheduler-Einstellungen und (unbestätigter) Filterradbelegung. Läuft über das
 * `EquipmentRepository` und die zod-Eingaben – der Seed wird also wie jede Anlage geprüft. IDs sind je
 * Mandant stabil (Hash aus Mandant und Seed-Schlüssel), ein zweiter Lauf ändert nichts.
 * Built-in-Mondprofile legt jeder neue Mandant selbst an (FA-MON-02), nicht dieser Seed.
 */
import { createHash } from 'node:crypto';
import {
  CameraInput,
  FilterInput,
  ProblemError,
  RigInput,
  SchedulerSettings,
  SiteInput,
  TelescopeInput,
} from '@nina-pm/shared';
import type { EquipmentRepository } from './repositories/equipment';

type Obj = Record<string, unknown>;

export interface SeedEquipment {
  readonly sites?: readonly Obj[];
  readonly telescopes?: readonly Obj[];
  readonly cameras?: readonly Obj[];
  readonly filters?: readonly Obj[];
  readonly rigs?: readonly Obj[];
}

export interface SeedEquipmentResult {
  readonly sites: number;
  readonly telescopes: number;
  readonly cameras: number;
  readonly filters: number;
  readonly rigs: number;
  readonly notes: string[];
}

/** Stabile UUID (Version 8) je Mandant und Seed-Schlüssel. */
export function seedObjectId(kind: string, tenantId: string, key: string): string {
  const h = createHash('sha256').update(`${kind}:${tenantId}:${key}`).digest('hex');
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});
const str = (v: unknown) => String(v);

function schedulerOf(s: Obj) {
  const flats = obj(s.flats);
  const darkFlats = obj(flats.darkFlats);
  const flip = obj(s.meridianFlip);
  const dither = obj(s.dither);
  const filterSwitch = obj(s.filterSwitch);
  return SchedulerSettings.parse({
    strategy: s.strategy,
    playback: s.playback,
    sortChain: s.sortChain,
    bonusEnabled: obj(s.bonus).enabled ?? false,
    overshootPct: s.overshootPct ?? 0,
    mosaicPanelsIndependent: s.mosaicPanelsIndependent ?? true,
    ditherEnabled: dither.enabled ?? true,
    ditherEvery: dither.every ?? 1,
    filterSwitchEnabled: filterSwitch.enabled ?? false,
    filterSwitchEvery: filterSwitch.every ?? 10,
    filterSwitchTolerancePct: filterSwitch.tolerancePct ?? 50,
    flatsEnabled: flats.enabled ?? false,
    flatsFullSet: flats.fullSet ?? false,
    flatCount: flats.count ?? 20,
    darkFlatsEnabled: darkFlats.enabled ?? true,
    darkFlatCount: darkFlats.count ?? null,
    flatsSource: flats.source ?? 'panel',
    flipEnabled: flip.enabled ?? true,
    flipAfterMeridianMin: flip.afterMin ?? 5,
    flipMaxAfterMeridianMin: flip.maxAfterMin ?? 15,
    flipPauseBeforeMeridianMin: flip.pauseBeforeMin ?? 0,
    flipDurationS: flip.durationS ?? 240,
    overhead: s.overhead ?? {},
  });
}

/** Spielt die Ausrüstung eines Seeds in den Mandanten des Repositorys ein (idempotent). */
export async function seedEquipment(
  repo: EquipmentRepository,
  tenantId: string,
  seed: SeedEquipment,
  now: Date,
): Promise<SeedEquipmentResult> {
  const notes: string[] = [];
  const ids = new Map<string, string>();
  const idOf = (kind: string, key: string) => {
    const id = seedObjectId(kind, tenantId, key);
    ids.set(`${kind}:${key}`, id);
    return id;
  };
  const ref = (kind: string, key: unknown) => {
    const id = ids.get(`${kind}:${str(key)}`);
    if (!id) throw new Error(`Seed: ${kind} ${str(key)} fehlt`);
    return id;
  };
  /** Namenskonflikt mit einem vorhandenen, nicht geseedeten Objekt: überspringen, nicht abbrechen. */
  const tolerant = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      return 1;
    } catch (error) {
      if (error instanceof ProblemError && error.code === 'validation.failed') {
        notes.push(`${label}: übersprungen (${error.errors?.map((e) => e.path).join(', ') ?? ''})`);
        return 0;
      }
      throw error;
    }
  };

  let sites = 0;
  for (const s of seed.sites ?? []) {
    const input = SiteInput.parse({
      name: s.name,
      observatoryType: s.observatoryType,
      latitudeDeg: s.latDeg,
      longitudeDeg: s.lonDeg,
      elevationM: s.elevationM,
      bortleClass: s.bortle ?? null,
      timeZone: s.timeZone,
    });
    sites += await tolerant(`Standort ${input.name}`, () =>
      repo.createSite(idOf('site', str(s.id)), input, now),
    );
  }

  let telescopes = 0;
  for (const t of seed.telescopes ?? []) {
    const input = TelescopeInput.parse({
      name: t.name,
      opticalDesign: t.opticalDesign,
      apertureMm: t.apertureMm,
      focalLengthMm: t.focalLengthMm,
      reducerFactor: t.reducerFactor,
    });
    telescopes += await tolerant(`Teleskop ${input.name}`, () =>
      repo.createTelescope(idOf('telescope', str(t.id)), input, now),
    );
  }

  let cameras = 0;
  for (const c of seed.cameras ?? []) {
    const presets = (Array.isArray(c.gainPresets) ? c.gainPresets : []).map(obj);
    const readoutModes = Array.isArray(c.readoutModes) ? c.readoutModes : ['Default'];
    const input = CameraInput.parse({
      name: c.name,
      widthPx: c.widthPx,
      heightPx: c.heightPx,
      pixelSizeUm: c.pixelSizeUm,
      isColor: c.mono === false,
      defaultGain: presets[0]?.gain ?? null,
      defaultOffset: presets[0]?.offset ?? null,
      gainModes: presets.map((p) => ({ name: p.name, gain: p.gain })),
      readoutModes,
      defaultReadoutMode: readoutModes[0],
    });
    cameras += await tolerant(`Kamera ${input.name}`, () =>
      repo.createCamera(idOf('camera', str(c.id)), input, now),
    );
  }

  let filters = 0;
  for (const f of seed.filters ?? []) {
    const input = FilterInput.parse({
      shortName: f.shortName,
      fullName: f.name ?? '',
      filterType: f.type,
      bandwidthNm: f.bandwidthNm ?? null,
      centerWavelengthNm: f.centerNm ?? null,
      colorHex: f.color ?? '#CCCCCC',
    });
    filters += await tolerant(`Filter ${input.shortName}`, () =>
      repo.createFilter(idOf('filter', input.shortName), input, now),
    );
  }

  let rigs = 0;
  for (const r of seed.rigs ?? []) {
    const scheduler = obj(r.scheduler);
    const rotator = obj(scheduler.rotator);
    const input = RigInput.parse({
      name: r.name,
      siteId: ref('site', r.siteId),
      telescopeId: ref('telescope', r.telescopeId),
      cameraId: ref('camera', r.cameraId),
      showInPlanning: r.showInPlanning,
      ninaDeliveryEnabled: r.ninaDeliveryEnabled,
      defaultRotationDeg: r.defaultRotationDeg ?? null,
      hasRotator: r.hasRotator,
      rotationToleranceDeg: rotator.toleranceDeg ?? 5,
      skipOnRotationMismatch: rotator.skipOnMismatch ?? false,
    });
    const id = idOf('rig', str(r.id));
    if (await repo.rig(id)) continue;
    const created = await tolerant(`Rig ${input.name}`, async () => {
      await repo.createRig(id, input, now);
      await repo.updateScheduler(id, schedulerOf(scheduler), now);
      // Belegung aus dem Seed, NINA-Namen bewusst unbestätigt: das bestätigt ein Admin in S-10.
      const wheel = Array.isArray(r.filterWheel) ? r.filterWheel.map(str) : [];
      if (wheel.length > 0)
        await repo.putFilterWheel(
          id,
          {
            slots: wheel.map((shortName, i) => ({
              position: i + 1,
              filterId: ref('filter', shortName),
              ninaFilterName: null,
            })),
          },
          now,
        );
    });
    rigs += created;
  }

  return { sites, telescopes, cameras, filters, rigs, notes };
}
