/**
 * `ops-cli demo-evaluation` (Betrieb): Auswertungsdaten des **Test-Mandanten** löschen und 90 Nächte realistische
 * Auswertungsdaten erzeugen. Nur `tenant: "test"` – jeder andere Schlüssel scheitert an der Validierung.
 * Die Lambda hat 60 s; `pnpm demo:evaluation` ruft deshalb Schritte nacheinander auf:
 *
 * 1. `plan` – Probelauf: was gelöscht würde, Rigs, Demo-Projekte, Nächte (`to` = letzte Nacht für die Folgeaufrufe).
 * 2. `clear` – Auswertungsdaten stapelweise löschen, bis `done`.
 * 3. `projects` – fehlende Demo-Projekte anlegen und freigeben (feste IDs, wiederholbar).
 * 4. `nights` – Nächte `from … from + count − 1` schreiben (der Generator rechnet deterministisch alle Nächte).
 * 5. `finish` – Zähler je Standort aus den Aufnahmen (`reconcileSite`), Endstatus der Projekte, Aufwand neu.
 */
import {
  DemoEvaluationRepository,
  EquipmentRepository,
  NinaInstanceRepository,
  ProjectRepository,
  reconcileSite,
  type OpenDatabase,
} from '@nina-pm/db';
import { daysFromKey, EngineInputError, keyFromDays, moonAt, nightTimes } from '@nina-pm/engine';
import {
  currentNight,
  DEMO_PROJECT_MARK,
  DEMO_PROJECTS,
  demoEvaluation,
  demoFilterName,
  demoUuid,
  LineCreate,
  NightKey,
  ProjectCreate,
  Uuid,
  type DemoNightMeta,
  type DemoProject,
  type DemoRig,
} from '@nina-pm/shared';
import { z } from 'zod';
import { isoUtc } from '../lib/format';
import { siteNights, timeZoneTransitions } from '../lib/night-table';
import { projectView } from '../routes/web-projects';

/** Nur der Test-Mandant (Entscheidung Sven, 26.09.2026). */
export const DEMO_TENANT_KEY = 'test';
const TIME_BUDGET_MS = 40_000;

export const DemoEvaluationArgs = z.object({
  tenant: z.literal(DEMO_TENANT_KEY),
  step: z.enum(['plan', 'clear', 'projects', 'nights', 'finish']),
  /** Letzte Nacht (aus `plan`); ohne Angabe die Nacht vor der aktuellen Nacht des Standorts. */
  to: NightKey.optional(),
  nights: z.number().int().min(14).max(120).default(90),
  from: z.number().int().min(0).default(0),
  count: z.number().int().min(1).max(30).default(10),
  seed: z.string().min(1).max(40).default('demo-evaluation'),
  /**
   * Heutiger Stand der vorhandenen Projekte: akzeptierte Frames je Zeile (aus `plan`). Die Folgeschritte
   * bekommen ihn übergeben, weil `clear` die Aufnahmen löscht und `finish` die Zähler neu rechnet.
   */
  keep: z.record(Uuid, z.number().int().min(0)).optional(),
});

export interface DemoDeps {
  readonly db: OpenDatabase['db'];
  readonly tenantId: string;
  /** Anleger der Demo-Projekte (Owner des Mandanten). */
  readonly memberId: string;
}

const DAY_MS = 86_400_000;

/**
 * Aufbau aus dem Mandanten: das Rig mit den meisten freigegebenen, aktiven Projekten (sonst das erste) trägt
 * die Demo-Projekte; vorhandene Projekte behalten ihren Stand (`fixed`). Filter über `demoFilterName`.
 */
async function context(deps: DemoDeps, args: z.infer<typeof DemoEvaluationArgs>, now: Date) {
  const eq = new EquipmentRepository(deps.db, { tenantId: deps.tenantId });
  const [rigs, sites, filters, cameras, list, instances] = await Promise.all([
    eq.rigs(),
    eq.sites(),
    eq.filters(),
    eq.cameras(),
    new ProjectRepository(deps.db, { tenantId: deps.tenantId }).list({
      admin: true,
      deleted: false,
      approvalStatus: 'approved',
      mine: false,
      favorites: false,
    }),
    new NinaInstanceRepository(deps.db, { tenantId: deps.tenantId }).list(),
  ]);
  const siteOf = new Map(sites.map((s) => [s.id, s]));
  const usable = rigs.filter((r) => siteOf.has(r.siteId));
  const demoIds = new Set(DEMO_PROJECTS.map((d) => demoUuid(`${deps.tenantId}:${d.name}`)));
  const views = list.map((d) => projectView(d));
  const existing = views.filter(
    (p) =>
      p.status === 'active' &&
      !demoIds.has(p.id) &&
      p.rigId !== null &&
      usable.some((r) => r.id === p.rigId),
  );
  // Panel der angelegten Demo-Projekte (die Anlage vergibt die Panel-ID selbst).
  const panelOf = new Map(
    views.filter((p) => demoIds.has(p.id)).map((p) => [p.id, p.panels[0]?.id]),
  );
  const load = (id: string) => existing.filter((p) => p.rigId === id).length;
  const target = [...usable].sort((a, b) => load(b.id) - load(a.id))[0];
  const site = target ? siteOf.get(target.siteId) : undefined;
  if (!target || !site) return null;

  const last =
    args.to ??
    keyFromDays(daysFromKey(currentNight(siteNights(site, now, undefined, 2), isoUtc(now))) - 1);
  const nights = Array.from({ length: args.nights }, (_, i) =>
    keyFromDays(daysFromKey(last) - args.nights + 1 + i),
  );

  // Vorhandene Projekte: heutiger Stand je Zeile (übergeben oder aus den Zählern).
  const keep: Record<string, number> = {};
  const fixed: DemoProject[] = existing.map((p) => ({
    id: p.id,
    name: p.name,
    rigId: p.rigId as string,
    raDeg: p.raDeg ?? 0,
    decDeg: p.decDeg ?? 0,
    rotationDeg: p.rotationDeg,
    story: 'fixed',
    lines: p.panels
      .filter((panel) => panel.enabled)
      .flatMap((panel) =>
        panel.lines
          .filter((l) => l.enabled)
          .map((l) => {
            const n = args.keep ? (args.keep[l.id] ?? 0) : Math.max(0, l.counters.accepted);
            keep[l.id] = n;
            return {
              id: l.id,
              panelId: panel.id,
              filter: l.filterShortName,
              exposureS: l.exposureS,
              planned: n,
              gain: l.gain,
              offsetAdu: l.offsetAdu,
              binning: l.binning,
              readoutMode: l.readoutMode,
            };
          }),
      )
      .filter((l) => l.planned > 0),
  }));

  const camera = cameras.find((c) => c.id === target.cameraId);
  const shortNames = filters.map((f) => f.shortName);
  const demo: DemoProject[] = [];
  const missing: string[] = [];
  for (const d of DEMO_PROJECTS) {
    const lines = d.lines
      .map((l) => ({ ...l, filter: demoFilterName(l.filter, shortNames) }))
      .filter((l): l is typeof l & { filter: string } => l.filter !== null);
    if (lines.length < d.lines.length) {
      missing.push(d.name);
      continue;
    }
    const id = demoUuid(`${deps.tenantId}:${d.name}`);
    const panelId = panelOf.get(id) ?? demoUuid(`${id}:panel`);
    demo.push({
      id,
      name: d.name,
      rigId: target.id,
      raDeg: d.raDeg,
      decDeg: d.decDeg,
      rotationDeg: d.rotationDeg,
      story: d.story,
      lines: lines.map((l, i) => ({
        id: demoUuid(`${id}:line:${String(i)}:${l.filter}`),
        panelId,
        filter: l.filter,
        exposureS: l.exposureS,
        planned: l.planned,
        gain: camera?.defaultGain ?? null,
        offsetAdu: camera?.defaultOffset ?? null,
        binning: 1,
        readoutMode: camera?.defaultReadoutMode ?? null,
      })),
    });
  }

  // Dunkelheit je Standort und Nacht aus der Engine; ohne astronomische Dunkelheit (Sommer, hohe Breite)
  // die nautische.
  const rigIds = new Set([target.id, ...fixed.map((p) => p.rigId)]);
  const demoRigs: DemoRig[] = usable
    .filter((r) => rigIds.has(r.id))
    .map((r) => ({
      id: r.id,
      siteId: r.siteId,
      ninaInstanceId: instances.find((i) => i.rigId === r.id && i.status === 'active')?.id ?? null,
    }));
  const cache = new Map<string, DemoNightMeta>();
  const transitions = new Map(
    sites.map((s) => [
      s.id,
      timeZoneTransitions(
        s.timeZone,
        Date.parse(`${nights[0] ?? last}T00:00:00Z`) - 3 * DAY_MS,
        Date.parse(`${last}T00:00:00Z`) + 3 * DAY_MS,
      ),
    ]),
  );
  const meta = (siteId: string, night: string): DemoNightMeta => {
    const key = `${siteId}:${night}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const s = siteOf.get(siteId);
    let value: DemoNightMeta = { darkFromUtc: null, darkToUtc: null, moonIllumPct: 0 };
    if (s) {
      const geo = { latDeg: s.latitudeDeg, lonDeg: s.longitudeDeg };
      try {
        const t = nightTimes({
          site: geo,
          night,
          timeZoneTransitions: transitions.get(siteId) ?? [],
        });
        const dark = [t.twilight.astronomical, t.twilight.nautical].find(
          (c) => c.kind === 'normal' && c.startUtc !== null && c.endUtc !== null,
        );
        const from = dark?.startUtc ?? null;
        const to = dark?.endUtc ?? null;
        const mid =
          from !== null && to !== null ? (from + to) / 2 : (t.noonStartUtc + t.noonEndUtc) / 2;
        value = {
          darkFromUtc: from === null ? null : isoUtc(new Date(from * 1000)),
          darkToUtc: to === null ? null : isoUtc(new Date(to * 1000)),
          moonIllumPct: moonAt(mid, geo).illumPct,
        };
      } catch (error) {
        if (!(error instanceof EngineInputError)) throw error;
      }
    }
    cache.set(key, value);
    return value;
  };
  return {
    rig: target,
    rigs: demoRigs,
    fixed,
    demo,
    keep,
    missing,
    nights,
    meta,
  };
}

export async function runDemoEvaluation(
  deps: DemoDeps,
  raw: Record<string, unknown>,
  now: Date,
): Promise<unknown> {
  const args = DemoEvaluationArgs.parse(raw);
  const ctx = await context(deps, args, now);
  if (!ctx) return { error: 'demo.no_rig', hint: 'Test-Mandant ohne Rig mit Standort' };
  const all = [...ctx.fixed, ...ctx.demo];
  const repo = new DemoEvaluationRepository(deps.db, deps.tenantId);
  const generate = () =>
    demoEvaluation({
      seed: args.seed,
      idSalt: deps.tenantId,
      nights: ctx.nights,
      rigs: ctx.rigs,
      projects: all,
      meta: ctx.meta,
    });
  const deadline = Date.now() + TIME_BUDGET_MS;

  switch (args.step) {
    case 'plan': {
      const r = generate();
      return {
        dryRun: true,
        to: ctx.nights.at(-1),
        from: ctx.nights[0],
        nights: ctx.nights.length,
        rig: ctx.rig.name,
        deletes: await repo.counts(),
        keep: ctx.keep,
        existingProjects: ctx.fixed.map((p) => ({
          name: p.name,
          lines: p.lines.map((l) => `${l.filter} ${String(l.planned)}×${String(l.exposureS)} s`),
        })),
        demoProjects: ctx.demo.map((p) => ({
          name: p.name,
          story: p.story,
          lines: p.lines.map((l) => `${l.filter} ${String(l.planned)}×${String(l.exposureS)} s`),
        })),
        skippedProjects: ctx.missing,
        creates: r.summary,
      };
    }
    case 'clear':
      return repo.clear(deadline);
    case 'projects': {
      const projects = new ProjectRepository(deps.db, {
        tenantId: deps.tenantId,
        memberId: deps.memberId,
      });
      const filters = await new EquipmentRepository(deps.db, { tenantId: deps.tenantId }).filters();
      const filterId = new Map(filters.map((f) => [f.shortName, f.id]));
      let created = 0;
      for (const p of ctx.demo) {
        const d = DEMO_PROJECTS.find((x) => x.name === p.name);
        const existing = await projects.detail(p.id);
        if (!existing) {
          await projects.create(
            ProjectCreate.parse({
              id: p.id,
              name: p.name,
              rigId: p.rigId,
              targetName: d?.targetName ?? p.name,
              descriptionMd: DEMO_PROJECT_MARK,
              raDeg: p.raDeg,
              decDeg: p.decDeg,
              rotationDeg: p.rotationDeg,
            }),
            now,
          );
          created += 1;
        }
        const detail = await projects.detail(p.id);
        const panelId = detail?.panels[0]?.id;
        if (!detail || !panelId) continue;
        const have = new Set(detail.panels.flatMap((x) => x.lines.map((l) => l.id)));
        for (const l of p.lines) {
          const fid = filterId.get(l.filter);
          if (have.has(l.id) || !fid) continue;
          await projects.addLine(
            p.id,
            LineCreate.parse({
              id: l.id,
              panelId,
              filterId: fid,
              exposureS: l.exposureS,
              plannedCount: l.planned,
              gain: l.gain,
              offsetAdu: l.offsetAdu,
              binning: l.binning,
              readoutMode: l.readoutMode,
              moonMode: 'none',
            }),
            now,
          );
        }
      }
      await repo.approve(
        ctx.demo.map((p) => ({ id: p.id, rigId: p.rigId, status: 'active' })),
        now,
      );
      return { projects: ctx.demo.length, created };
    }
    case 'nights': {
      const r = generate();
      const part = r.nights.slice(args.from, args.from + args.count);
      const written = await repo.insertNights(part, now);
      return {
        from: part[0]?.night ?? null,
        to: part.at(-1)?.night ?? null,
        ...written,
        next: args.from + args.count < r.nights.length ? args.from + args.count : null,
      };
    }
    case 'finish': {
      const r = generate();
      const sites = [...new Set(ctx.rigs.map((x) => x.siteId))];
      const reconciled = [];
      for (const siteId of sites)
        reconciled.push(await reconcileSite(deps.db, deps.tenantId, siteId, now));
      await repo.finish(r.finalStatus, now);
      const nameOf = new Map(all.map((p) => [p.id, p.name]));
      return {
        reconciled,
        summary: r.summary,
        status: Object.fromEntries(
          [...r.finalStatus].map(([id, status]) => [nameOf.get(id) ?? id, status]),
        ),
      };
    }
  }
}
