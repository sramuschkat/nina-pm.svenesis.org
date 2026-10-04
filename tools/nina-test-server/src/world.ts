/**
 * Die Testwelt (AP-16a, execution.md §9): aus Szenario, rig.json und der Uhr entstehen Bootstrap, Targets und Plan
 * im Vertragsformat (`packages/shared/src/contracts/nina`). Blöcke beginnen relativ zu „jetzt“ (erster Block nach
 * 2 min); ein Flip-Ziel steht so, dass seine **scheinbare** RA zur gewünschten Zeit kulminiert (NT-35, über
 * `meridianTransitUtc` der Engine). Ziel-RA ohne Flip: Meridian 60 min nach Blockende – kein Flip im Block.
 */
import { ENGINE_VERSION, meridianTransitUtc, nightTimes } from '@nina-pm/engine';
import { createHash, randomUUID } from 'node:crypto';
import {
  buildNightTable,
  noonNightKey,
  timeZoneTransitions,
} from '../../../apps/api/src/lib/night-table';
import { example, uuidFor } from './examples';
import type { RigConfig, Scenario, ScenarioBlock } from './scenario';

type Json = Record<string, unknown>;
const MIN = 60;
const iso = (sec: number) => new Date(Math.round(sec) * 1000).toISOString().replace('.000Z', 'Z');

/** Ablaufwerte des Test-Rigs (wie NINA auf dem Testrechner: Flip 1 / 5 min nach dem Meridian). */
export const TEST_SCHEDULER = {
  afterMin: 1,
  maxAfterMin: 5,
  pauseBeforeMin: 0,
  flipDurationS: 120,
  slewCenterS: 90,
  filterChangeS: 10,
  ditherSettleS: 15,
  downloadS: 3,
} as const;

export interface WorldState {
  /** Zähler für das Targets-ETag (ändert sich bei targets_change, pause_project, lock_transit, filter_wheel_changed). */
  targetsVersion: number;
  pausedProjects: Set<string>;
  transitLocked: boolean;
  filterWheelChanged: boolean;
  skippedBlocks: Set<string>;
  clockSkewS: number;
  planRevision: number;
}

export class TestWorld {
  /** Bezugszeit des Szenarios (Unix-Sekunden): Serverstart; `clear` lässt sie stehen. */
  epochS: number;

  constructor(
    readonly scenario: Scenario,
    readonly rig: RigConfig,
    readonly nowS: () => number,
    readonly state: WorldState,
  ) {
    this.epochS = Math.floor(nowS());
  }

  /** Overhead- und Flip-Werte: `TEST_SCHEDULER`, je Szenario überschreibbar (Starfront-Szenarien). */
  get sched() {
    return { ...TEST_SCHEDULER, ...this.scenario.scheduler };
  }

  get site() {
    return { latDeg: this.rig.site.latDeg, lonDeg: this.rig.site.lonDeg };
  }

  serverTimeS(): number {
    return this.nowS() + this.state.clockSkewS;
  }

  // ---- Nacht-Tabelle ------------------------------------------------------------------------------

  /**
   * Nacht-Tabelle. `current-night` (P-29): echte Tabelle des Standorts. Alle anderen Szenarien laufen relativ zum
   * Serverstart; ihre Nächte liegen deshalb um die Bezugszeit (Mittag = Bezugszeit ± 12 h, je Nacht + 24 h) und das
   * Nachtfenster der ersten endet frühestens 1 h nach dem Nachtende des Szenarios – sonst wechselte `currentNight`
   * mitten im Test, sobald das echte Nachtfenster endet (Lauf 02.10.2026: 13:05Z, neue Session mitten im Block).
   * Nacht-Schlüssel und `timeZoneTransitions` bleiben die echten.
   */
  nightTable() {
    const site = {
      latitudeDeg: this.rig.site.latDeg,
      longitudeDeg: this.rig.site.lonDeg,
      timeZone: this.rig.site.timeZone,
    };
    if (this.scenario.realNight) {
      return buildNightTable(site, noonNightKey(site.timeZone, this.serverTimeS() * 1000), 60);
    }
    const table = buildNightTable(site, noonNightKey(site.timeZone, this.epochS * 1000), 60);
    const span = this.sessionEndS() - this.epochS + 3600;
    const nights = table.nights.map((n, i) => {
      const noonStart = this.epochS - 12 * 3600 + i * 86_400;
      const windowEnd = Math.min(noonStart + 86_400, noonStart + 12 * 3600 + span);
      return {
        ...n,
        noonStartUtc: iso(noonStart),
        noonEndUtc: iso(noonStart + 86_400),
        nightWindowEndUtc: iso(windowEnd),
      };
    });
    return { ...table, nights };
  }

  /** Aktuelle und folgende Nacht (NT-01): nur diese nimmt der Server bei Plan und Session an. */
  validNights(): string[] {
    const t = this.nightTable();
    const now = this.serverTimeS() * 1000;
    const idx = t.nights.findIndex(
      (n) => Date.parse(n.noonStartUtc) <= now && now < Date.parse(n.noonEndUtc),
    );
    const i = Math.max(0, idx);
    const current = t.nights[i] && Date.parse(t.nights[i].nightWindowEndUtc) <= now ? i + 1 : i;
    return [t.nights[current]?.night, t.nights[current + 1]?.night].filter((n): n is string => !!n);
  }

  /** Echte Nachtzeiten der aktuellen Nacht (Szenario current-night, P-29). */
  realNight() {
    const night = this.validNights()[0] as string;
    const [y, m, d] = night.split('-').map(Number) as [number, number, number];
    const from = Date.UTC(y, m - 1, d) - 2 * 86_400_000;
    const transitions = timeZoneTransitions(this.rig.site.timeZone, from, from + 5 * 86_400_000);
    const t = nightTimes({ site: this.site, night, timeZoneTransitions: transitions });
    const astro = t.twilight.astronomical;
    return {
      night,
      windowStartS: t.nightWindow.startUtc,
      windowEndS: t.nightWindow.endUtc,
      darknessStartS: astro.startUtc ?? t.nightWindow.startUtc,
      darknessEndS: astro.endUtc ?? t.nightWindow.endUtc,
      twilight: t.twilight,
    };
  }

  // ---- Zeitplan der Blöcke --------------------------------------------------------------------------

  /** Blöcke mit absoluten Zeiten (Sekunden) ab der Bezugszeit (current-night: ab Beginn der Dunkelheit). */
  timeline() {
    const base = this.scenario.realNight
      ? Math.max(this.epochS, this.realNight().darknessStartS)
      : this.epochS;
    let cursor = base + 2 * MIN;
    return this.scenario.blocks.map((b, i) => {
      const start = b.startInMin !== undefined ? base + b.startInMin * MIN : cursor;
      const end = start + b.durationMin * MIN;
      cursor = end + MIN;
      return { ...b, index: i, kind: b.kind ?? 'regular', startS: start, endS: end };
    });
  }

  darknessEndS(): number {
    if (this.scenario.realNight) return this.realNight().darknessEndS;
    const blocks = this.timeline();
    const last = blocks.at(-1)?.endS ?? this.epochS + 2 * MIN;
    return this.scenario.darknessEndInMin !== undefined
      ? this.epochS + this.scenario.darknessEndInMin * MIN
      : last + 60 * MIN;
  }

  sessionEndS(): number {
    if (this.scenario.realNight) return this.realNight().windowEndS;
    return this.scenario.sessionEndInMin !== undefined
      ? this.epochS + this.scenario.sessionEndInMin * MIN
      : this.darknessEndS() + 60 * MIN;
  }

  /** J2000-RA, deren scheinbarer Ort zur Zeit `meridianS` kulminiert (NT-35). */
  raForMeridianAt(meridianS: number, decDeg: number): number {
    // Startwert: RA, die jetzt kulminiert, plus Sternzeit bis zum Ziel; dann zweimal nachziehen.
    let ra = 0;
    for (let i = 0; i < 4; i += 1) {
      const t = meridianTransitUtc(
        { raJ2000Deg: ra, decJ2000Deg: decDeg },
        this.site,
        meridianS - 86_400,
        meridianS + 86_400,
      );
      if (t === null) break;
      ra = (((ra + ((meridianS - t) / 3600) * 15.0410686) % 360) + 360) % 360;
    }
    return Math.round(ra * 1e4) / 1e4;
  }

  // ---- Projekte (Targets) ---------------------------------------------------------------------------

  /** Filterradbelegung aus rig.json (Plätze ab 1). */
  rigFilters() {
    return this.rig.filters;
  }

  filter(short: string) {
    const f = this.rig.filters.find((x) => x.shortName === short);
    if (!f) throw new Error(`Filter ${short} nicht in rig.json`);
    // filter_wheel_changed (P-32): ein Platz trägt einen Namen, den das NINA-Profil nicht (mehr) kennt.
    if (this.state.filterWheelChanged && f.position === 1)
      return { ...f, ninaFilterName: `${f.ninaFilterName}-ALT` };
    return f;
  }

  projectKey(b: ScenarioBlock & { index: number }) {
    return b.project ?? (b.kind === 'transit' ? `transit-${b.index}` : `projekt-${b.index}`);
  }

  projects() {
    const blocks = this.timeline();
    const byProject = new Map<string, typeof blocks>();
    for (const b of blocks)
      byProject.set(this.projectKey(b), [...(byProject.get(this.projectKey(b)) ?? []), b]);
    const template = example<Json>('targets.response');
    const [deepSky, exo] = template.projects as Json[];
    return [...byProject.entries()]
      .map(([key, list], pi) => {
        const first = list[0] as (typeof list)[number];
        const id = uuidFor(`project:${key}`);
        const base = structuredClone((first.kind === 'transit' ? exo : deepSky) as Json);
        const panels = [...new Set(list.map((b) => b.panel ?? 0))].map((panel) => {
          const b = list.find((x) => (x.panel ?? 0) === panel) as (typeof list)[number];
          const filters = b.filters ?? ['L'];
          const lines = filters.map((short, li) => {
            const f = this.filter(short);
            const template = structuredClone(
              ((base.panels as Json[])[0] as Json).lines as Json[],
            )[0] as Json;
            return {
              ...template,
              id: uuidFor(`line:${key}:${panel}:${short}`),
              order: li,
              filter: f.shortName,
              ninaFilterName: f.ninaFilterName,
              exposureS: b.exposureS ?? 60,
              gain: b.gain ?? null,
              offset: b.offset ?? null,
              binning: b.binning ?? 1,
              readoutMode: b.readoutMode ?? null,
              readoutModeIndex: null,
              moon: { mode: 'none' },
            };
          });
          const decDeg = b.decDeg ?? 20;
          const meridianS =
            b.meridianInMin !== undefined ? this.epochS + b.meridianInMin * MIN : b.endS + 60 * MIN;
          return {
            ...structuredClone((base.panels as Json[])[0] as Json),
            id: uuidFor(`panel:${key}:${panel}`),
            index: panel,
            label: list.length > 1 || panel > 0 ? `Panel ${String(panel + 1)}` : 'Main',
            raDeg: this.raForMeridianAt(meridianS, decDeg),
            decDeg,
            rotationDeg: b.rotationDeg ?? 0,
            lines,
          };
        });
        const project: Json = {
          ...base,
          id,
          version: this.state.targetsVersion,
          name: `Test ${key}`,
          status: this.state.pausedProjects.has(id) ? 'on_hold' : 'active',
          center: {
            raDeg: (panels[0] as Json).raDeg,
            decDeg: (panels[0] as Json).decDeg,
            rotationDeg: (panels[0] as Json).rotationDeg,
          },
          panels,
          target: { ...(base.target as Json), name: `Test ${key}` },
        };
        if (first.kind === 'transit') {
          const ex = structuredClone(base.exoplanet as Json);
          const obs = ex.observation as Json;
          obs.id = uuidFor(`observation:${key}`);
          obs.status =
            this.state.transitLocked || key !== 'replan-transit' ? 'locked' : 'requested';
          obs.night = this.validNights()[0];
          obs.windowStartUtc = iso(first.startS);
          obs.windowEndUtc = iso(first.endS);
          const span = first.endS - first.startS;
          obs.ingressUtc = iso(first.startS + span * 0.25);
          obs.midUtc = iso(first.startS + span * 0.5);
          obs.egressUtc = iso(first.startS + span * 0.75);
          project.exoplanet = ex;
        } else {
          project.exoplanet = null;
        }
        return { project, pi };
      })
      .map((x) => x.project);
  }

  targetsEtag(): string {
    return `"test-${String(this.state.targetsVersion)}"`;
  }

  targets(): Json {
    const t = example<Json>('targets.response');
    return {
      ...t,
      rigId: uuidFor('rig'),
      generatedAtUtc: iso(this.serverTimeS()),
      projects: this.projects(),
    };
  }

  // ---- Bootstrap ----------------------------------------------------------------------------------

  bootstrap(instanceName: string): Json {
    const b = example<Json>('bootstrap.response');
    const rig = b.rig as Json;
    const table = this.nightTable();
    const scheduler = structuredClone(rig.scheduler as Json);
    scheduler.meridianFlip = {
      enabled: true,
      afterMin: this.sched.afterMin,
      maxAfterMin: this.sched.maxAfterMin,
      pauseBeforeMin: this.sched.pauseBeforeMin,
      durationS: this.sched.flipDurationS,
    };
    scheduler.overhead = {
      ...(scheduler.overhead as Json),
      slewCenterS: this.sched.slewCenterS,
      filterChangeS: this.sched.filterChangeS,
      ditherSettleS: this.sched.ditherSettleS,
      downloadS: this.sched.downloadS,
    };
    scheduler.flats = {
      ...(scheduler.flats as Json),
      enabled: this.scenario.flats?.enabled ?? false,
      source: this.scenario.flats?.source ?? 'panel',
    };
    return {
      ...b,
      serverTimeUtc: iso(this.serverTimeS()),
      server: { engineVersion: ENGINE_VERSION, minPluginVersion: '0.1.0' },
      instance: { id: uuidFor(`instance:${instanceName}`), name: instanceName },
      tenant: { key: 'test', name: 'Test-Server', timeZone: this.rig.site.timeZone },
      rig: {
        ...rig,
        id: uuidFor('rig'),
        name: 'Test-Rig',
        site: {
          ...(rig.site as Json),
          name: this.rig.site.name,
          latDeg: this.rig.site.latDeg,
          lonDeg: this.rig.site.lonDeg,
          elevationM: this.rig.site.elevationM,
          timeZone: this.rig.site.timeZone,
        },
        filters: this.rig.filters.map((f) => ({ ...this.filter(f.shortName), color: '#c8c8c8' })),
        scheduler,
        rotator: {
          ...(rig.rotator as Json),
          ...(this.scenario.rig?.rotatorPresent !== undefined
            ? { present: this.scenario.rig.rotatorPresent }
            : {}),
          ...(this.scenario.rig?.rotatorToleranceDeg !== undefined
            ? { toleranceDeg: this.scenario.rig.rotatorToleranceDeg }
            : {}),
          ...(this.scenario.rig?.skipOnRotationMismatch !== undefined
            ? { skipOnMismatch: this.scenario.rig.skipOnRotationMismatch }
            : {}),
        },
      },
      tzdataVersion: table.tzdataVersion,
      nights: table.nights,
      timeZoneTransitions: table.timeZoneTransitions,
    };
  }

  // ---- Plan ---------------------------------------------------------------------------------------

  /** Plan für `night` (aktuelle Nacht; Folgenacht nur im Szenario multi-night, 24 h später). */
  plan(night: string, request: Json): Json {
    this.state.planRevision += 1;
    const nights = this.validNights();
    const shift = night === nights[1] && this.scenario.multiNight ? 86_400 : 0;
    const projects = this.projects();
    const projectOf = (b: { index: number } & ScenarioBlock) =>
      projects.find((p) => p.id === uuidFor(`project:${this.projectKey(b)}`));
    const included = this.timeline()
      .filter((b) => !this.state.skippedBlocks.has(uuidFor(`block:${String(b.index)}`)))
      .filter((b) => (projectOf(b)?.status ?? 'active') === 'active')
      // Transit erst mit `locked` (Szenario replan-transit: Aktion lock_transit, P-15b).
      .filter(
        (b) =>
          b.kind !== 'transit' ||
          ((projectOf(b)?.exoplanet as Json | null)?.observation as Json).status === 'locked',
      );
    const transits = included.filter((b) => b.kind === 'transit');
    const blocks = included
      .map((b) => {
        if (b.kind === 'transit') return b;
        // Ein Block, der in einen Transit (samt Vorlauf) hineinreicht, endet davor.
        const cut = transits
          .filter((t) => t.startS < b.endS && t.endS > b.startS)
          .map((t) => t.startS - (t.slewCenterS ?? this.sched.slewCenterS) - MIN);
        return cut.length ? { ...b, endS: Math.min(b.endS, ...cut) } : b;
      })
      .filter((b) => b.endS > b.startS && b.endS + shift > this.serverTimeS())
      .map((b) => this.block(b, projects, shift));
    const darknessEnd = this.darknessEndS() + shift;
    const sessionEnd = this.sessionEndS() + shift;
    const real = this.scenario.realNight ? this.realNight() : null;
    const start = (real ? real.windowStartS : this.epochS - 2 * 3600) + shift;
    const plannedFrames: Record<string, Record<string, number>> = {};
    for (const b of blocks)
      for (const e of b.entries as Json[])
        if (e.cmd === 'expose') {
          const p = (plannedFrames[b.projectId as string] ??= {});
          p[e.exposureLineId as string] = (p[e.exposureLineId as string] ?? 0) + 1;
        }
    return {
      nightPlanId: randomUUID(),
      engineVersion: ENGINE_VERSION,
      inputHash: `sha256:${createHash('sha256').update(JSON.stringify(request)).digest('hex')}`,
      night,
      revision: this.state.planRevision,
      startAtUtc: (request.startAtUtc as string | null | undefined) ?? null,
      nightWindow: { startUtc: iso(start), endUtc: iso(sessionEnd) },
      darkness: real
        ? realDarkness(real.twilight)
        : {
            civilStartUtc: iso(start + 1800),
            civilEndUtc: iso(darknessEnd + 1800),
            nauticalStartUtc: iso(start + 2700),
            nauticalEndUtc: iso(darknessEnd + 900),
            astronomicalStartUtc: iso(start + 3600),
            astronomicalEndUtc: iso(darknessEnd),
          },
      darknessEndUtc: iso(darknessEnd),
      flatsNotBeforeUtc: iso(Math.min(darknessEnd, sessionEnd)),
      flatsNotAfterUtc: this.scenario.flats?.source === 'sky' ? iso(sessionEnd) : null,
      sessionEndUtc: iso(sessionEnd),
      blocks,
      summary: { targets: new Set(blocks.map((b) => b.projectId)).size, plannedFrames },
      diagnostics: [],
      warnings: [],
    };
  }

  private block(
    b: ReturnType<TestWorld['timeline']>[number],
    projects: Json[],
    shift: number,
  ): Json {
    const key = this.projectKey(b);
    const project = projects.find((p) => p.id === uuidFor(`project:${key}`)) as Json;
    const panel = (project.panels as Json[]).find((p) => p.index === (b.panel ?? 0)) as Json;
    const lines = panel.lines as Json[];
    const startS = b.startS + shift;
    const endS = b.endS + shift;
    const entries: Json[] = [];
    let seq = 0;
    const add = (e: Json) => entries.push({ seq: ++seq, ...e });
    const exposure = (line: Json) => ({
      exposureLineId: line.id,
      filter: line.filter,
      exposureS: line.exposureS,
      gain: line.gain ?? null,
      offset: line.offset ?? null,
      binning: line.binning ?? 1,
      readoutMode: line.readoutMode ?? null,
      readoutModeIndex: null,
    });

    if (b.kind === 'transit') {
      const slew = b.slewCenterS ?? this.sched.slewCenterS;
      add({ cmd: 'slew_center', atUtc: iso(startS - slew - 60), durationS: slew });
      add({
        cmd: 'filter',
        atUtc: iso(startS - 60),
        durationS: this.sched.filterChangeS,
        filter: (lines[0] as Json).filter,
      });
      add({
        cmd: 'expose_series',
        atUtc: iso(startS),
        untilUtc: iso(endS),
        ...exposure(lines[0] as Json),
      });
      add({ cmd: 'end', atUtc: iso(endS) });
      const flip = this.flipFor(b, shift);
      return this.blockJson(
        b,
        project,
        panel,
        startS,
        endS,
        entries,
        flip && {
          ...flip,
          inTransitWindow: true,
          planned: false,
          gapStartUtc: flip.plannedUtc,
          gapDurationS: this.sched.flipDurationS + this.sched.slewCenterS,
        },
      );
    }

    let t = startS;
    const slew = b.slewCenterS ?? this.sched.slewCenterS;
    add({ cmd: 'slew_center', atUtc: iso(t), durationS: slew });
    t += slew;
    const flip = this.flipFor(b, shift);
    let flipped = !flip;
    let current: string | null = null;
    let n = 0;
    for (;;) {
      const line = lines[n % lines.length] as Json;
      const exp = line.exposureS as number;
      if (!flipped && flip && t >= Date.parse(flip.plannedUtc) / 1000) {
        add({ cmd: 'meridian_flip', atUtc: iso(t), durationS: this.sched.flipDurationS });
        t += this.sched.flipDurationS;
        add({ cmd: 'slew_center', atUtc: iso(t), durationS: slew });
        t += slew;
        flipped = true;
      }
      const filterS = current === line.filter ? 0 : this.sched.filterChangeS;
      // Pause vor dem Meridian (flip-rotation.md §2): keine Belichtung über limitEnd = tM − pause, warten bis flipAt.
      if (!flipped && flip && this.sched.pauseBeforeMin > 0) {
        const flipAt = Date.parse(flip.plannedUtc) / 1000;
        const limitEnd = flipAt - (this.sched.afterMin + this.sched.pauseBeforeMin) * MIN;
        if (t + filterS + exp + this.sched.downloadS > limitEnd) {
          if (flipAt + this.sched.flipDurationS > endS) break;
          if (t < flipAt) add({ cmd: 'wait', atUtc: iso(t), durationS: flipAt - t });
          t = Math.max(t, flipAt);
          continue;
        }
      }
      if (t + filterS + exp > endS) break;
      if (filterS > 0) {
        add({ cmd: 'filter', atUtc: iso(t), durationS: filterS, filter: line.filter });
        t += filterS;
        current = line.filter as string;
      }
      add({ cmd: 'expose', atUtc: iso(t), ...exposure(line), bonus: false, lastOfNight: false });
      t += exp + this.sched.downloadS;
      n += 1;
      if (b.ditherEvery && n % b.ditherEvery === 0 && t + this.sched.ditherSettleS < endS) {
        add({ cmd: 'dither', atUtc: iso(t), durationS: this.sched.ditherSettleS });
        t += this.sched.ditherSettleS;
      }
    }
    add({ cmd: 'end', atUtc: iso(Math.min(t, endS)) });
    return this.blockJson(b, project, panel, startS, endS, entries, flip);
  }

  /** Flip im Block, wenn der Meridian (plus afterMin) in den Block fällt (flip-rotation.md §2). */
  private flipFor(b: ReturnType<TestWorld['timeline']>[number], shift: number) {
    if (b.meridianInMin === undefined) return null;
    const tM = this.epochS + b.meridianInMin * MIN + shift;
    const planned = tM + this.sched.afterMin * MIN;
    // Meridian schon vor Blockbeginn überschritten (Mosaik-Panel 2, P-26): Montierung steht bereits ost.
    if (planned >= b.endS + shift || planned <= b.startS + shift) return null;
    return {
      waitStartUtc: null,
      plannedUtc: iso(planned),
      durationS: this.sched.flipDurationS,
      inTransitWindow: false,
      planned: true,
      gapStartUtc: null,
      gapDurationS: null,
    };
  }

  private blockJson(
    b: ReturnType<TestWorld['timeline']>[number],
    project: Json,
    panel: Json,
    startS: number,
    endS: number,
    entries: Json[],
    flip: Json | null,
  ): Json {
    return {
      id: uuidFor(`block:${String(b.index)}`),
      kind: b.kind,
      projectId: project.id,
      panelId: panel.id,
      ...(b.kind === 'transit'
        ? { transitObservationId: ((project.exoplanet as Json).observation as Json).id }
        : {}),
      startUtc: iso(startS),
      endUtc: iso(endS),
      twilightEndUtc: iso(this.darknessEndS()),
      raDeg: panel.raDeg,
      decDeg: panel.decDeg,
      rotationDeg: panel.rotationDeg,
      rotationMode: this.scenario.rig?.rotatorPresent === false ? 'fixed_camera' : 'rotator',
      meridianFlip: flip,
      entries,
    };
  }
}

export const freshState = (): WorldState => ({
  targetsVersion: 1,
  pausedProjects: new Set(),
  transitLocked: false,
  filterWheelChanged: false,
  skippedBlocks: new Set(),
  clockSkewS: 0,
  planRevision: 0,
});

type Twilight = ReturnType<TestWorld['realNight']>['twilight'];
const isoOrNull = (s: number | null) => (s === null ? null : iso(s));
function realDarkness(t: Twilight) {
  return {
    civilStartUtc: isoOrNull(t.civil.startUtc),
    civilEndUtc: isoOrNull(t.civil.endUtc),
    nauticalStartUtc: isoOrNull(t.nautical.startUtc),
    nauticalEndUtc: isoOrNull(t.nautical.endUtc),
    astronomicalStartUtc: isoOrNull(t.astronomical.startUtc),
    astronomicalEndUtc: isoOrNull(t.astronomical.endUtc),
  };
}
