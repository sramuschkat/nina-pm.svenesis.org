/**
 * VM-Prüfstand gegen den echten Server (Stufe 2a): der lokale Stack (`local-stack.ts`, PGlite, echte Uhr, Takt wie
 * `tick-5min`) mit Szenarien, die eine Nacht über die **Daten** stauchen – Standort so gewählt, dass die Dunkelheit in
 * wenigen Minuten endet, Exoplanet mit eigener Ephemeride, Transit in ein paar Minuten. Das Plugin in der VM spricht
 * mit seinem Prüfstand-Token `npm_test`; der Prüfstand schreibt es auf das Token einer echt angelegten Instanz um.
 * **Nur lokal**, nie im Lambda-Bundle (kein Einstieg unter `src/handlers/`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EquipmentRepository,
  replaceExoCatalog,
  settleTransits,
  TRANSIT_SETTLE_GRACE_MS,
  type ExoCatalogRow,
} from '@nina-pm/db';
import {
  jdeFromUnix,
  jdFromUnix,
  jdUtcToBjdTdb,
  meridianTransitUtc,
  nightTimes,
  targetApparent,
} from '@nina-pm/engine';
import { discordCategoryOf } from '@nina-pm/shared';
import { startDiscordMock } from '../../../../tools/discord-mock/src/server';
import { clearExoCatalogCache } from '../exo/search';
import { noonNightKey, timeZoneTransitions } from '../lib/night-table';
import { createLocalStack, listenLocal, localSeed, type LocalStack } from '../local-stack';

export type RealScenario =
  'night-flats' | 'transit' | 'commands' | 'full-night' | 'network' | 'flip';

/** Plugin-Token im Prüfstand-Profil der VM (wie beim Test-Server). */
export const BENCH_TOKEN = 'npm_test';

/** Filterrad der VM (Sky Simulator), wie `tools/nina-test-server/rig.json`. */
const VM_WHEEL = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tools/nina-test-server/rig.json', import.meta.url)),
    'utf8',
  ),
) as { filters: { position: number; shortName: string; ninaFilterName: string }[] };

/** Auslesemodi der Kamera „Camera Sky Simulator for ALPACA“ in der VM (Advanced API, 05.10.2026). */
const VM_READOUT_MODES = ['normal1', 'normal2'];

type Body = Record<string, unknown>;
const id = () => crypto.randomUUID();
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** Sternzeit läuft 360,9856°/Tag: Minuten je Grad Stundenwinkel. */
const MIN_PER_DEG = 1440 / 360.98564736629;

/**
 * Meridian-Flip wie im NINA-Profil der VM (Advanced API, 05.10.2026): Rig und Profil gleich, sonst meldet der Heartbeat
 * `flip_timing_mismatch`. Flip-Dauer ohne Autofokus nach dem Flip (Slew + Zentrieren im Simulator).
 */
const VM_FLIP = { afterMin: 1, maxAfterMin: 5, pauseBeforeMin: 0, durationS: 120 };
/** Flip-relevante Codes der Einstellungsprüfung (`ninaSettingsMismatchCodes`): im Flip-Lauf darf keiner auftreten. */
const FLIP_MISMATCH_CODES = [
  'flip_trigger_missing',
  'flip_timing_mismatch',
  'recenter_after_flip_on',
  'mount_site_mismatch',
];

export interface RealServerOptions {
  readonly scenario: RealScenario;
  /** Port für die VM (wie der Test-Server, `cfg.testServerPort`). */
  readonly port: number;
  /** Breite des Standorts = Breite im NINA-Profil der VM (der Simulator rechnet damit). */
  readonly latDeg: number;
  readonly log: (message: string) => void;
}

export interface RealCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RealServer {
  /** Profilwerte für NINA (Standort wie der gewählte Standort, Flip wie das Rig, Montierung übernimmt den Standort). */
  readonly profile: Readonly<Record<string, string | number | boolean>>;
  readonly info: Readonly<Record<string, string | number>>;
  /** Aktion zur Laufzeit (Schritt `real` in der Laufdatei): `pause_running`, `refresh_targets`, `reset_plan`. */
  action(name: string): Promise<string>;
  /** Abgeschlossene Sessions des Rigs (Lauf endet danach). */
  completedSessions(): Promise<number>;
  /** Abschluss abwarten (Jobs `session_close`/`session_report`), dann prüfen. */
  report(): Promise<{ data: Body; checks: RealCheck[] }>;
  close(): void;
}

/** Ortszeit-Zone `Etc/GMT±h` passend zur Länge (Vorzeichen der Etc-Zonen ist umgekehrt). */
function etcZone(lonDeg: number): string {
  const h = Math.round(lonDeg / 15);
  if (h === 0) return 'Etc/GMT';
  return h > 0 ? `Etc/GMT-${String(h)}` : `Etc/GMT+${String(-h)}`;
}

/**
 * Länge, bei der die Dämmerung `twilight` (Aufwärtsdurchgang) ≈ `dawnMs` liegt und die Dunkelheit schon begonnen hat
 * (Abenddurchgang mindestens 60 min vor jetzt). Raster 0,25° ≈ 1 min.
 */
function solveLongitude(
  latDeg: number,
  nowMs: number,
  dawnMs: number,
  twilight: 'astronomical' | 'nautical',
): { lonDeg: number; timeZone: string; night: string; dawnUtc: number; duskUtc: number } {
  let best: {
    lonDeg: number;
    timeZone: string;
    night: string;
    dawnUtc: number;
    duskUtc: number;
  } | null = null;
  for (let lon = -179.75; lon < 180; lon += 0.25) {
    const timeZone = etcZone(lon);
    const night = noonNightKey(timeZone, nowMs);
    const t = nightTimes({
      site: { latDeg, lonDeg: lon },
      night,
      timeZoneTransitions: timeZoneTransitions(
        timeZone,
        nowMs - 3 * 86_400_000,
        nowMs + 3 * 86_400_000,
      ),
    });
    const c = t.twilight[twilight];
    if (c.startUtc === null || c.endUtc === null) continue;
    if (c.startUtc * 1000 > nowMs - 60 * MIN) continue;
    const diff = Math.abs(c.endUtc * 1000 - dawnMs);
    if (!best || diff < Math.abs(best.dawnUtc * 1000 - dawnMs))
      best = { lonDeg: lon, timeZone, night, dawnUtc: c.endUtc, duskUtc: c.startUtc };
  }
  if (!best) throw new Error('kein Standort mit passender Dämmerung gefunden');
  return best;
}

/** Ortssternzeit in Grad (GMST nach IAU 1982, für die Zielwahl genau genug). */
function lstDeg(nowMs: number, lonDeg: number): number {
  const d = jdFromUnix(nowMs / 1000) - 2451545.0;
  return (((280.46061837 + 360.98564736629 * d + lonDeg) % 360) + 360) % 360;
}

export async function startRealServer(opts: RealServerOptions): Promise<RealServer> {
  const discord = await startDiscordMock({ port: 0 });
  const stack: LocalStack = await createLocalStack({
    port: opts.port,
    authTestMode: true,
    discordMockUrl: discord.url,
    tickMs: MIN,
  });
  const tenantId = localSeed.tenant.id;
  const nowMs = Date.now();

  // Anmeldung als Owner (Test-Login wie die E2E-Läufe) und Web-Aufrufe über denselben Stack.
  const login = await stack.fetch(
    new Request('http://local/api/auth/test-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-npm-request': '1' },
      body: JSON.stringify({ identityFixture: 'owner' }),
    }),
  );
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const web = async <T = Body>(path: string, method = 'GET', body?: unknown) => {
    const res = await stack.fetch(
      new Request(`http://local/api/web/v1${path}`, {
        method,
        headers: {
          cookie,
          ...(method !== 'GET' ? { 'x-npm-request': '1' } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
    const text = await res.text();
    if (res.status >= 400) throw new Error(`${method} ${path} → ${String(res.status)} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  };

  // Rig A aus dem Seed: Standort, Filterrad wie die VM, Scheduler je Szenario.
  const rigs = (await web<{ items: Body[] }>('/rigs')).items;
  const rig = rigs.find((r) => String(r.name).startsWith('Rig A'));
  if (!rig) throw new Error('Rig A fehlt im Seed');
  const rigId = rig.id as string;
  const siteId = rig.siteId as string;
  const filters = (await web<{ items: { id: string; shortName: string }[] }>('/filters')).items;
  const filterId = (short: string) => {
    const f = filters.find((x) => x.shortName === short);
    if (!f) throw new Error(`Filter ${short} fehlt im Seed`);
    return f.id;
  };

  const s = opts.scenario;
  // Nachtende (astronomische Dämmerung, alle Projekte): Flats nach 25 min, Befehle und Flip 35 min, Transit 40 min
  // (Fenster endet nach 33 min). Danach schließt das Plugin die Session ab – der Lauf prüft Abschluss und Bericht.
  const dawnMs =
    nowMs + (s === 'night-flats' ? 25 : s === 'commands' || s === 'flip' ? 35 : 40) * MIN;
  const where = solveLongitude(opts.latDeg, nowMs, dawnMs, 'astronomical');
  const site = await web<Body>(`/sites/${siteId}`);
  await web(`/sites/${siteId}`, 'PUT', {
    name: site.name,
    pierName: site.pierName ?? null,
    observatoryType: site.observatoryType,
    latitudeDeg: opts.latDeg,
    longitudeDeg: where.lonDeg,
    elevationM: 200,
    bortleClass: site.bortleClass ?? null,
    timeZone: where.timeZone,
    weatherSafetyUrl: null,
    notes: 'VM-Prüfstand (Stufe 2a)',
  });
  await web(`/rigs/${rigId}/filter-wheel`, 'PUT', {
    slots: VM_WHEEL.filters.map((f) => ({
      position: f.position,
      filterId: filterId(f.shortName),
      ninaFilterName: f.ninaFilterName,
    })),
  });
  // Auslesemodi wie die Simulator-Kamera der VM (`normal1`, `normal2`): die Seed-Kamera kennt „High Gain“, das NINA in
  // der VM nicht – jeder Block entfiele mit `readout_mode_not_found` (Lauf 05.10.2026). Neue Zeilen erben den Standard.
  await stack.db
    .updateTable('camera')
    .set({
      readoutModes: JSON.stringify(VM_READOUT_MODES),
      defaultReadoutMode: VM_READOUT_MODES[0],
    })
    .where('tenantId', '=', tenantId)
    .where('id', '=', rig.cameraId as string)
    .execute();
  // Ohne Rotator wie das Rig in Starfront: der Sky Simulator dreht sein Bild nicht mit (ops/vm-bench.md).
  await stack.db
    .updateTable('rig')
    // Nachtbericht nach Discord an: im Seed aus, der Bericht-Job meldete sonst `rig_switch_off` (Lauf 05.10.2026).
    .set({ hasRotator: false, sessionReportDiscord: true })
    .where('tenantId', '=', tenantId)
    .where('id', '=', rigId)
    .execute();
  const eq = new EquipmentRepository(stack.db, { tenantId });
  await eq.updateScheduler(
    rigId,
    {
      ...(rig.scheduler as Parameters<EquipmentRepository['updateScheduler']>[1]),
      ditherEvery: s === 'full-night' ? 3 : 5,
      flatsEnabled: s === 'night-flats' || s === 'full-night',
      flatsSource: 'panel',
      flatsAutoMode: 'off',
      flatCount: 3,
      darkFlatsEnabled: true,
      darkFlatCount: 2,
      flipEnabled: true,
      flipAfterMeridianMin: VM_FLIP.afterMin,
      flipMaxAfterMeridianMin: VM_FLIP.maxAfterMin,
      flipPauseBeforeMeridianMin: VM_FLIP.pauseBeforeMin,
      flipDurationS: VM_FLIP.durationS,
    },
    new Date(),
  );
  // Discord-Kanal für den Nachtbericht: der lokale Seed legt keine Kanäle an – der Bericht-Job meldete `no_channel`
  // (Lauf real-transit 05.10.2026). Die Webhook-Adresse lenkt der lokale Stack auf die Nachbildung um.
  const now = new Date();
  await stack.db
    .insertInto('discordChannel')
    .values({
      tenantId,
      name: '#nachtberichte (Prüfstand)',
      webhookUrl: 'https://discord.com/api/webhooks/0/bench-local-only',
      categories: JSON.stringify([discordCategoryOf('session.report')]),
      eventFilter: JSON.stringify({}),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  const instance = await web<{ token: string }>('/nina-instances', 'POST', {
    id: id(),
    rigId,
    name: 'VM-Prüfstand',
  });

  // Ziele nahe dem Pol: aus jeder Länge hoch genug (min. Höhe 30°), Stundenwinkel +2 h (kein Meridiandurchgang).
  const lst = lstDeg(nowMs, where.lonDeg);
  // Freigabe wie in den API-Tests: der Seed-Owner darf eigene Projekte nicht selbst freigeben (adminSelfApproval aus).
  const approve = async (pid: string) => {
    await stack.db
      .updateTable('project')
      .set((eb) => ({
        approvalStatus: 'approved',
        status: 'active',
        rigId: eb.ref('requestedRigId'),
      }))
      .where('id', '=', pid)
      .execute();
  };
  /** Zeilen: Filter, Anzahl, optional Gain und Offset (wie die Ares-M in Starfront: 125/50). */
  const deepSky = async (
    name: string,
    raOffsetDeg: number,
    lines: [string, number, number?, number?][],
  ) => {
    const created = await web<{ id: string; panels: { id: string }[] }>('/projects', 'POST', {
      id: id(),
      name,
      rigId,
      targetName: name,
      raDeg: (((lst - 30 + raOffsetDeg) % 360) + 360) % 360,
      decDeg: 75,
    });
    const panelId = created.panels[0]?.id ?? '';
    const lineIds: string[] = [];
    for (const [short, count, gain, offset] of lines) {
      const lineId = id();
      await web(`/projects/${created.id}/lines`, 'POST', {
        id: lineId,
        panelId,
        filterId: filterId(short),
        exposureS: 30,
        plannedCount: count,
        moonMode: 'none',
        ...(gain !== undefined ? { gain } : {}),
        ...(offset !== undefined ? { offsetAdu: offset } : {}),
      });
      lineIds.push(lineId);
    }
    await approve(created.id);
    return { projectId: created.id, lineIds };
  };

  const info: Record<string, string | number> = {
    scenario: s,
    lonDeg: where.lonDeg,
    timeZone: where.timeZone,
    night: where.night,
    darknessEndUtc: iso(where.dawnUtc * 1000),
  };
  // Nautische Morgendämmerung des Standorts (Flats in Starfront erst danach, Box *Vor Flats*).
  const nautical = nightTimes({
    site: { latDeg: opts.latDeg, lonDeg: where.lonDeg },
    night: where.night,
    timeZoneTransitions: timeZoneTransitions(
      where.timeZone,
      nowMs - 3 * 86_400_000,
      nowMs + 3 * 86_400_000,
    ),
  }).twilight.nautical.endUtc;
  if (nautical !== null) info.nauticalDawnUtc = iso(nautical * 1000);
  const projects: { projectId: string; lineIds: string[] }[] = [];
  let transit: { projectId: string; observationId: string; windowEndUtc: string } | null = null;
  /** Pausiertes Projekt und Zeitpunkt (Aktion `pause_running`) für die Prüfung „Neuplanung nach Pausieren“. */
  let paused: { projectId: string; atMs: number } | null = null;
  /** Netzausfall (Aktionen `drop_network`/`restore_network`): Anfragen des Plugins laufen ins Leere. */
  let dropping = false;
  let sawStale: boolean | null = null;

  if (s === 'night-flats') {
    projects.push(
      await deepSky('Bench NGC A', 0, [
        ['L', 12],
        ['Ha', 12],
      ]),
    );
    projects.push(await deepSky('Bench NGC B', 20, [['L', 12]]));
  } else if (s === 'full-night') {
    // Typische Starfront-Nacht: vier Ziele, LRGB und SHO, Gain/Offset je Zeile, Dither alle 3, Flats mit Warten auf
    // die nautische Dämmerung.
    projects.push(
      await deepSky('Bench LRGB', 0, [
        ['L', 4, 125, 50],
        ['R', 4, 125, 50],
        ['G', 4, 125, 50],
        ['B', 4, 125, 50],
      ]),
    );
    projects.push(
      await deepSky('Bench SHO', 15, [
        ['Ha', 4, 125, 50],
        ['OIII', 4, 125, 50],
        ['SII', 4, 125, 50],
      ]),
    );
    projects.push(
      await deepSky('Bench L+Ha', 30, [
        ['L', 4],
        ['Ha', 4],
      ]),
    );
    projects.push(
      await deepSky('Bench RGB', 45, [
        ['R', 3, 125, 50],
        ['G', 3, 125, 50],
        ['B', 3, 125, 50],
      ]),
    );
  } else if (s === 'flip') {
    // Flip ohne Rotator wie Starfront: Meridian 10 min nach dem Start (Stundenwinkel −2,5°), ein Ziel bis zum Nachtende,
    // zwei Filter – Belichtungen vor und nach dem Flip, Filterwechsel über den Flip hinweg. RA J2000 um die Präzession
    // bis heute verschoben (bei Dec +75° ≈ 1°, sonst läge der Meridian ≈ 4 min später; Prüfung 05.10.2026).
    const goalRa = lst + 10 / MIN_PER_DEG;
    const shift =
      targetApparent({ raJ2000Deg: goalRa, decJ2000Deg: 75 }, jdeFromUnix(nowMs / 1000)).raDeg -
      goalRa;
    const raOffsetDeg = 30 + 10 / MIN_PER_DEG - (((shift + 540) % 360) - 180);
    projects.push(
      await deepSky('Bench Flip', raOffsetDeg, [
        ['L', 20, 125, 50],
        ['R', 20, 125, 50],
      ]),
    );
    const tM = meridianTransitUtc(
      { raJ2000Deg: (((lst - 30 + raOffsetDeg) % 360) + 360) % 360, decJ2000Deg: 75 },
      { latDeg: opts.latDeg, lonDeg: where.lonDeg },
      nowMs / 1000,
      nowMs / 1000 + 86_400,
    );
    if (tM === null) throw new Error('kein Meridiandurchgang für das Flip-Ziel');
    info.meridianUtc = iso(tM * 1000);
  } else if (s === 'network') {
    projects.push(await deepSky('Bench NGC A', 0, [['L', 20]]));
    projects.push(await deepSky('Bench NGC B', 20, [['Ha', 20]]));
  } else if (s === 'commands') {
    // Je ≈ 12 min Arbeit: zwei Blöcke in 35 min Restnacht (Mindestzeit je Ziel, profiles.ts).
    projects.push(await deepSky('Bench NGC A', 0, [['L', 24]]));
    projects.push(await deepSky('Bench NGC B', 20, [['Ha', 24]]));
  } else {
    projects.push(await deepSky('Bench NGC A', 0, [['L', 16]]));
    // Exoplanet: Transitmitte in 22 min, T14 = 12 min, ohne Grundlinie → Fenster ≈ jetzt + 11 … + 33 min.
    const ra = (((lst - 30 + 10) % 360) + 360) % 360;
    const tcMs = nowMs + 22 * MIN;
    const row: ExoCatalogRow = {
      planet: 'BENCH-1b',
      star: 'BENCH-1',
      disposition: null,
      raDeg: ra,
      decDeg: 75,
      magVJohnson: 14,
      magRCousins: null,
      magSdssG: null,
      magGaiaG: null,
      magTess: null,
      magBandUsed: 'V',
      teffK: 5500,
      distancePc: null,
      t0BjdTdb: jdUtcToBjdTdb(jdFromUnix(tcMs / 1000), ra, 75),
      t0SigmaD: 1e-5,
      periodD: 3.1,
      periodSigmaD: 1e-7,
      durationH: 0.2,
      durationEstimated: false,
      depthMmag: 15,
      depthRaw: 15,
      depthUnit: 'mmag',
      depthEstimated: false,
      rpOverRs: 0.12,
      aOverRs: 10,
      inclinationDeg: 89,
      planetRadiusRe: null,
      eqTempK: null,
      exoclockPriority: 'medium',
      oMinusCMin: 0,
    } as ExoCatalogRow;
    // Messband: > 13 mag → Luminanz (FA-EXO-08); der Seed-Filter L trägt kein Band, darum hier `lum`.
    await stack.db
      .updateTable('filter')
      .set({ photometricBand: 'lum' })
      .where('tenantId', '=', tenantId)
      .where('id', '=', filterId('L'))
      .execute();
    await replaceExoCatalog(stack.db, 'exoclock', [row], new Date());
    clearExoCatalogCache();
    const created = await web<{ projectId: string }>('/exo/projects', 'POST', {
      id: id(),
      rigId,
      catalog: 'exoclock',
      planet: 'BENCH-1b',
      exposureS: 30,
      twilight: 'astronomical',
    });
    await approve(created.projectId);
    await web(`/projects/${created.projectId}/exo`, 'PATCH', {
      baselineBeforeMin: 0,
      baselineAfterMin: 0,
    });
    const detail = await web<{ upcoming: { item: { transit: { n: number } } }[] }>(
      `/projects/${created.projectId}/exo`,
    );
    const epoch = detail.upcoming[0]?.item.transit.n;
    if (epoch === undefined) throw new Error('Transit BENCH-1b nicht in der Vorhersage');
    await web(`/projects/${created.projectId}/exo/lock`, 'POST', { epoch });
    const obs = await stack.db
      .selectFrom('transitObservation')
      .select(['id', 'windowStartUtc', 'windowEndUtc'])
      .where('projectId', '=', created.projectId)
      .where('status', '=', 'locked')
      .executeTakeFirstOrThrow();
    transit = {
      projectId: created.projectId,
      observationId: obs.id,
      windowEndUtc: new Date(obs.windowEndUtc).toISOString(),
    };
    info.transitWindow = `${new Date(obs.windowStartUtc).toISOString()} – ${transit.windowEndUtc}`;
  }

  // Token des Prüfstand-Profils auf die echte Instanz umschreiben.
  const fetchVm = (req: Request) => {
    // Netzausfall: das Plugin bekommt keine Antwort (Zeitüberschreitung wie beim Test-Server `drop_responses`).
    if (dropping && new URL(req.url).pathname.startsWith('/api/nina/'))
      return new Promise<Response>(() => undefined);
    if (req.headers.get('authorization') !== `Bearer ${BENCH_TOKEN}`) return stack.fetch(req);
    const headers = new Headers(req.headers);
    headers.set('authorization', `Bearer ${instance.token}`);
    return stack.fetch(new Request(req, { headers }));
  };
  const http = await listenLocal(fetchVm, opts.port, '0.0.0.0');
  opts.log(`Echter Server (${s}) auf Port ${String(opts.port)}: ${JSON.stringify(info)}`);

  const sessions = () =>
    stack.db
      .selectFrom('session')
      .select(['id', 'status', 'endedAt', 'outboxPending'])
      .where('tenantId', '=', tenantId)
      .where('rigId', '=', rigId)
      .execute();

  return {
    profile: {
      'AstrometrySettings-Latitude': opts.latDeg,
      'AstrometrySettings-Longitude': where.lonDeg,
      'AstrometrySettings-Elevation': 200,
      // Montierung übernimmt beim Verbinden den Standort des Profils: NINA flippt nach der Sternzeit der Montierung, der
      // Simulator stünde sonst in Starfront (`mount_site_mismatch`, Flip zur falschen Zeit).
      'TelescopeSettings-TelescopeLocationSyncDirection': 'TOTELESCOPE',
      'MeridianFlipSettings-MinutesAfterMeridian': VM_FLIP.afterMin,
      'MeridianFlipSettings-MaxMinutesAfterMeridian': VM_FLIP.maxAfterMin,
      'MeridianFlipSettings-PauseTimeBeforeMeridian': VM_FLIP.pauseBeforeMin,
      'MeridianFlipSettings-Recenter': false,
    },
    info,
    async action(name) {
      switch (name) {
        case 'pause_running': {
          // Projekt der zuletzt gemeldeten Aufnahme = laufender Block (Fall a: Ziel entfällt, Neuplanung).
          const last = await stack.db
            .selectFrom('capture')
            .select('projectId')
            .where('tenantId', '=', tenantId)
            .where('projectId', 'is not', null)
            .orderBy('capturedAt', 'desc')
            .executeTakeFirst();
          const pid = last?.projectId ?? projects[0]?.projectId;
          if (!pid) return 'kein Projekt';
          await web(`/projects/${pid}/status`, 'PUT', { status: 'on_hold' });
          paused = { projectId: pid, atMs: Date.now() };
          return `Projekt ${pid} pausiert`;
        }
        case 'drop_network':
          dropping = true;
          return 'Netz getrennt: Anfragen des Plugins bleiben ohne Antwort';
        case 'restore_network': {
          const before = (await sessions()).map((x) => x.status);
          sawStale = before.includes('stale');
          dropping = false;
          return `Netz zurück; Session-Status vorher ${JSON.stringify(before)}`;
        }
        case 'refresh_targets':
        case 'reset_plan': {
          const r = await web<{ commandIds: string[] }>(`/rigs/${rigId}/commands`, 'POST', {
            command: name,
          });
          return `Kommando ${name}: ${r.commandIds.join(',')}`;
        }
        default:
          throw new Error(`unbekannte Aktion ${name}`);
      }
    },
    async completedSessions() {
      return (await sessions()).filter((x) => x.status === 'completed' || x.status === 'aborted')
        .length;
    },
    async report() {
      // Abschluss und Bericht laufen über den Takt; einmal sofort anstoßen und bis 3 min warten.
      const jobsDone = async () => {
        const rows = await stack.db
          .selectFrom('job')
          .select(['kind', 'status'])
          .where('tenantId', '=', tenantId)
          .where('kind', 'in', ['session_close', 'session_report'])
          .execute();
        return rows;
      };
      for (let i = 0; i < 18; i += 1) {
        await stack.tick();
        const rows = await jobsDone();
        if (rows.length >= 2 && rows.every((r) => r.status === 'done')) break;
        await new Promise((r) => setTimeout(r, 10_000));
      }
      if (transit) {
        // Wertung nach Fensterende + 30 min (TRANSIT_SETTLE_GRACE_MS); im Lauf vorgezogen statt 30 min zu warten.
        await settleTransits(
          stack.db,
          new Date(Date.parse(transit.windowEndUtc) + TRANSIT_SETTLE_GRACE_MS + MIN),
        );
      }
      const list = await sessions();
      const lines = await stack.db
        .selectFrom('exposureLine')
        .select(['id', 'projectId', 'filterShortName', 'acquiredCount'])
        .where('tenantId', '=', tenantId)
        .where('projectId', 'in', [
          ...projects.map((p) => p.projectId),
          ...(transit ? [transit.projectId] : []),
        ])
        .execute();
      const captures = await stack.db
        .selectFrom('capture')
        .select([
          'exposureLineId',
          'projectId',
          'capturedAt',
          'filterShortName',
          'frameType',
          'result',
          'transitObservationId',
        ])
        .where('tenantId', '=', tenantId)
        .where(
          'sessionId',
          'in',
          list.length ? list.map((x) => x.id) : ['00000000-0000-0000-0000-000000000000'],
        )
        .execute();
      const flats = list.length
        ? await stack.db
            .selectFrom('flatCombination')
            .select(['filterShortName', 'status', 'flatsTaken', 'darkFlatsTaken'])
            .where(
              'sessionId',
              'in',
              list.map((x) => x.id),
            )
            .execute()
        : [];
      const plans = await stack.db
        .selectFrom('nightPlan')
        .select(['reason', 'createdAt'])
        .where('tenantId', '=', tenantId)
        .where('rigId', '=', rigId)
        .execute();
      const jobs = await jobsDone();
      const commands = await stack.db
        .selectFrom('command')
        .select(['kind', 'acknowledgedAt'])
        .where('tenantId', '=', tenantId)
        .execute();
      const observation = transit
        ? await stack.db
            .selectFrom('transitObservation')
            .select(['status', 'acquiredCount'])
            .where('id', '=', transit.observationId)
            .executeTakeFirst()
        : undefined;
      const events = list.length
        ? await stack.db
            .selectFrom('sessionEvent')
            .select(['kind', 'occurredAt', 'durationS', 'message'])
            .where('tenantId', '=', tenantId)
            .where(
              'sessionId',
              'in',
              list.map((x) => x.id),
            )
            .where('kind', 'in', ['flip', 'flip_settings_mismatch', 'flip_undetected'])
            .execute()
        : [];
      // Einstellungsprüfung des Heartbeats (NT-22): Alarm `alert.nina_settings_mismatch` mit Code-Liste.
      const mismatchCodes = [
        ...new Set(
          (
            await stack.db
              .selectFrom('notification')
              .select('payload')
              .where('tenantId', '=', tenantId)
              .where('kind', '=', 'alert.nina_settings_mismatch')
              .execute()
          ).flatMap((n) =>
            String((n.payload as { codes?: string } | null)?.codes ?? '')
              .split(',')
              .filter(Boolean),
          ),
        ),
      ].sort();
      const lights = captures.filter((c) => c.frameType === 'light' && c.result === 'saved');
      const data: Body = {
        info,
        sessions: list,
        plans: plans.map((p) => p.reason),
        lines,
        lights: lights.length,
        transitLights: lights.filter((c) => c.transitObservationId).length,
        flats,
        jobs,
        commands,
        transit: observation ?? null,
        flipEvents: events,
        settingsMismatch: mismatchCodes,
        discord: discord.calls.map((c) => c.path),
      };

      const checks: RealCheck[] = [];
      const check = (name: string, ok: boolean, detail: string) =>
        checks.push({ name, ok, detail });
      const done = list.filter((x) => x.status === 'completed');
      check('Session abgeschlossen', done.length >= 1, JSON.stringify(list.map((x) => x.status)));
      check(
        'Outbox leer beim Abschluss',
        done.every((x) => Number(x.outboxPending) === 0),
        JSON.stringify(done.map((x) => x.outboxPending)),
      );
      check('Aufnahmen gemeldet', lights.length > 0, `${String(lights.length)} Lights`);
      const counted = lines.reduce((n, l) => n + Number(l.acquiredCount), 0);
      check(
        'Zähler = gemeldete Lights',
        counted === lights.length,
        `Zeilen ${String(counted)}, Lights ${String(lights.length)}`,
      );
      check(
        'Abschluss- und Bericht-Job erledigt',
        jobs.length >= 2 && jobs.every((j) => j.status === 'done'),
        JSON.stringify(jobs),
      );
      check(
        'Discord-Meldung angekommen',
        discord.calls.length > 0,
        `${String(discord.calls.length)} Aufrufe`,
      );
      if (s === 'full-night') {
        const filters = [...new Set(lights.map((c) => c.filterShortName))].sort();
        check('Mehrere Filter belichtet', filters.length >= 4, filters.join(','));
        const flatFilters = new Set(
          flats.filter((f) => f.status === 'done').map((f) => f.filterShortName),
        );
        check(
          'Je belichtetem Filter eine Flat-Kombination done',
          filters.every((f) => flatFilters.has(f)),
          `${[...flatFilters].sort().join(',')} für ${filters.join(',')}`,
        );
        const firstFlat = captures
          .filter((c) => c.frameType === 'flat')
          .map((c) => new Date(c.capturedAt).getTime())
          .sort((a, b) => a - b)[0];
        const dawn =
          typeof info.nauticalDawnUtc === 'string' ? Date.parse(info.nauticalDawnUtc) : NaN;
        check(
          'Flats erst nach der nautischen Dämmerung (Wait for Time in Vor Flats)',
          firstFlat !== undefined && !Number.isNaN(dawn) && firstFlat >= dawn - 60_000,
          `erste Flat ${firstFlat ? iso(firstFlat) : '–'}, nautische Dämmerung ${String(info.nauticalDawnUtc ?? '–')}`,
        );
      }
      if (s === 'flip') {
        const meridianMs = Date.parse(String(info.meridianUtc));
        const flips = events.filter((e) => e.kind === 'flip');
        const flipMs = flips[0] ? new Date(flips[0].occurredAt).getTime() : NaN;
        check(
          'Flip gemeldet, keiner unerkannt',
          flips.length === 1 && !events.some((e) => e.kind !== 'flip'),
          JSON.stringify(
            events.map((e) => [e.kind, iso(new Date(e.occurredAt).getTime()), e.durationS]),
          ),
        );
        // NINA flippt zwischen Meridian + „Minuten nach“ und + „maximal“; gemeldet wird nach Flip und Zentrieren.
        check(
          'Flip nach dem Meridian im Flip-Fenster',
          flipMs >= meridianMs + (VM_FLIP.afterMin - 1) * MIN &&
            flipMs <= meridianMs + (VM_FLIP.maxAfterMin + 10) * MIN,
          `Meridian ${String(info.meridianUtc)}, Flip ${Number.isNaN(flipMs) ? '–' : iso(flipMs)}`,
        );
        const before = lights.filter((c) => new Date(c.capturedAt).getTime() < meridianMs);
        const after = lights.filter((c) => new Date(c.capturedAt).getTime() > flipMs);
        check(
          'Aufnahmen vor und nach dem Flip',
          before.length > 0 && after.length > 0,
          `vor ${String(before.length)}, nach ${String(after.length)}`,
        );
        const bad = mismatchCodes.filter((c) => FLIP_MISMATCH_CODES.includes(c));
        check(
          'Keine Flip- oder Standortwarnung der Einstellungsprüfung',
          bad.length === 0,
          `alle Codes: ${mismatchCodes.join(',') || '–'}`,
        );
      }
      if (s === 'network') {
        check(
          'Session während des Ausfalls verwaist (stale)',
          sawStale === true,
          `stale gesehen: ${String(sawStale)}`,
        );
      }
      if (s === 'night-flats') {
        check(
          'Flat-Kombinationen done',
          flats.length >= 2 && flats.every((f) => f.status === 'done'),
          JSON.stringify(flats),
        );
      }
      if (s === 'transit' && transit) {
        check(
          'Transit-Aufnahmen mit Beobachtung',
          lights.some((c) => c.transitObservationId === transit?.observationId),
          `${String(data.transitLights)} Transit-Lights`,
        );
        check(
          'Transit beobachtet',
          observation?.status === 'observed',
          JSON.stringify(observation ?? null),
        );
      }
      if (s === 'commands') {
        const reasons = plans.map((p) => p.reason);
        // Streng (Lauf 05.10.2026 zählte ein `refresh` aus anderem Grund): pausiert, danach neu geplant und das pausierte
        // Projekt ab 60 s nach dem Pausieren ohne Aufnahme (laufende Belichtung darf zu Ende gehen).
        const p = paused as { projectId: string; atMs: number } | null;
        const replanned = p ? plans.some((x) => new Date(x.createdAt).getTime() > p.atMs) : false;
        const lateLights = p
          ? lights.filter(
              (c) => c.projectId === p.projectId && new Date(c.capturedAt).getTime() > p.atMs + MIN,
            ).length
          : -1;
        check(
          'Neuplanung nach Pausieren',
          p !== null && replanned && lateLights === 0,
          p
            ? `neu geplant ${String(replanned)}, Aufnahmen des pausierten Projekts danach ${String(lateLights)}`
            : 'nicht pausiert',
        );
        check('Zurücksetzen per Kommando', reasons.includes('reset'), JSON.stringify(reasons));
        check(
          'Kommandos quittiert',
          commands.length >= 2 && commands.every((c) => c.acknowledgedAt !== null),
          JSON.stringify(commands),
        );
        check(
          'Fortsetzen nach NINA-Neustart',
          reasons.includes('resume') && list.length === 1,
          `${JSON.stringify(reasons)}, Sessions ${String(list.length)}`,
        );
      }
      return { data, checks };
    },
    close() {
      http.close();
      stack.close();
      void discord.close();
    },
  };
}
