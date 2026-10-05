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
  'night-flats' | 'transit' | 'commands' | 'full-night' | 'network' | 'flip' | 'dst' | 'long-night';

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
/**
 * Lange Nacht: Meridian des Flip-Ziels so viele Minuten nach dem Start. Der Server legt den Block des Ziels ans Ende der
 * Nacht (≈ +3:10 … +4:30 h); mit 230 min liegt der Flip mitten darin (`real-check long-night`, 05.10.2026).
 */
const LONG_NIGHT_MERIDIAN_MIN = 230;
/** Starfront wie das Rig und der Plugin-Simulator (`NinaPm.Sim`, `profileLocation`). */
const STARFRONT = { latDeg: 31.5471, lonDeg: -99.3823, timeZone: 'America/Chicago' };
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
  /**
   * Virtuelle Uhr ab diesem Zeitpunkt (kopfloser Nachtlauf, `tools/nina-sim`): der Stack folgt dem Header
   * `x-npm-sim-now` des Plugin-Simulators (nie rückwärts) und führt `tick-5min` je 5 virtuelle Minuten aus.
   */
  readonly startMs?: number;
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

/** Nacht am echten Standort Starfront (Szenario `dst`): Nacht-Schlüssel und astronomische Dämmerung wie der Server. */
function starfrontNight(nowMs: number): {
  lonDeg: number;
  timeZone: string;
  night: string;
  dawnUtc: number;
  duskUtc: number;
} {
  const night = noonNightKey(STARFRONT.timeZone, nowMs);
  const t = nightTimes({
    site: { latDeg: STARFRONT.latDeg, lonDeg: STARFRONT.lonDeg },
    night,
    timeZoneTransitions: timeZoneTransitions(
      STARFRONT.timeZone,
      nowMs - 3 * 86_400_000,
      nowMs + 3 * 86_400_000,
    ),
  }).twilight.astronomical;
  if (t.startUtc === null || t.endUtc === null) throw new Error('Starfront ohne Dunkelheit');
  return {
    lonDeg: STARFRONT.lonDeg,
    timeZone: STARFRONT.timeZone,
    night,
    dawnUtc: t.endUtc,
    duskUtc: t.startUtc,
  };
}

/** Ortssternzeit in Grad (GMST nach IAU 1982, für die Zielwahl genau genug). */
function lstDeg(nowMs: number, lonDeg: number): number {
  const d = jdFromUnix(nowMs / 1000) - 2451545.0;
  return (((280.46061837 + 360.98564736629 * d + lonDeg) % 360) + 360) % 360;
}

export async function startRealServer(opts: RealServerOptions): Promise<RealServer> {
  const discord = await startDiscordMock({ port: 0 });
  const virtual = opts.startMs !== undefined;
  let simNowMs = opts.startMs ?? 0;
  let lastTickMs = simNowMs;
  const stack: LocalStack = await createLocalStack({
    port: opts.port,
    authTestMode: true,
    discordMockUrl: discord.url,
    ...(virtual ? { clock: () => new Date(simNowMs) } : { tickMs: MIN }),
  });
  const tenantId = localSeed.tenant.id;
  const nowMs = opts.startMs ?? Date.now();

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
  const latDeg = s === 'dst' ? STARFRONT.latDeg : opts.latDeg;
  // Nachtende (astronomische Dämmerung, alle Projekte): Flats nach 25 min, Befehle und Flip 35 min, Transit 40 min
  // (Fenster endet nach 33 min). Danach schließt das Plugin die Session ab – der Lauf prüft Abschluss und Bericht.
  // Lange Nacht (Lücke E): 4½ h Dunkelheit, über Nacht in der VM.
  const dawnMs =
    nowMs +
    (s === 'night-flats'
      ? 25
      : s === 'commands' || s === 'flip'
        ? 35
        : s === 'long-night'
          ? 270
          : 40) *
      MIN;
  const where =
    s === 'dst'
      ? starfrontNight(nowMs)
      : solveLongitude(opts.latDeg, nowMs, dawnMs, 'astronomical');
  const site = await web<Body>(`/sites/${siteId}`);
  await web(`/sites/${siteId}`, 'PUT', {
    name: site.name,
    pierName: site.pierName ?? null,
    observatoryType: site.observatoryType,
    latitudeDeg: latDeg,
    longitudeDeg: where.lonDeg,
    elevationM: 200,
    bortleClass: site.bortleClass ?? null,
    timeZone: where.timeZone,
    weatherSafetyUrl: null,
    notes: s === 'dst' ? 'Kopfloser Lauf Zeitumstellung (Starfront)' : 'VM-Prüfstand (Stufe 2a)',
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
      ditherEvery: s === 'full-night' || s === 'long-night' ? 3 : 5,
      flatsEnabled: s === 'night-flats' || s === 'full-night' || s === 'dst' || s === 'long-night',
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
    fixed?: { raDeg?: number; decDeg?: number; exposureS?: number },
  ) => {
    const created = await web<{ id: string; panels: { id: string }[] }>('/projects', 'POST', {
      id: id(),
      name,
      rigId,
      targetName: name,
      raDeg: fixed?.raDeg ?? (((lst - 30 + raOffsetDeg) % 360) + 360) % 360,
      decDeg: fixed?.decDeg ?? 75,
    });
    const panelId = created.panels[0]?.id ?? '';
    const lineIds: string[] = [];
    for (const [short, count, gain, offset] of lines) {
      const lineId = id();
      await web(`/projects/${created.id}/lines`, 'POST', {
        id: lineId,
        panelId,
        filterId: filterId(short),
        exposureS: fixed?.exposureS ?? 30,
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
    site: { latDeg, lonDeg: where.lonDeg },
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
  /** Stichprobe je Minute (echte Uhr): war eine Session je verwaist (`stale`)? Lange Nacht: darf nie vorkommen. */
  let staleSeenAt: string | null = null;

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
      { latDeg, lonDeg: where.lonDeg },
      nowMs / 1000,
      nowMs / 1000 + 86_400,
    );
    if (tM === null) throw new Error('kein Meridiandurchgang für das Flip-Ziel');
    info.meridianUtc = iso(tM * 1000);
  } else if (s === 'long-night') {
    // Lange Starfront-Nacht (Lücke E): sechs Ziele mit LRGB und SHO, 120 s, Gain/Offset 125/50, Dither alle 3. Fünf Ziele
    // stehen schon westlich des Meridians (Stundenwinkel +1 … +4 h, kein Flip); nur „Bench Flip“ kulminiert spät in
    // der Nacht und ist am längsten zu belichten (Flip ohne Rotator mitten im Block). Flats mit Panel nach der nautischen
    // Dämmerung.
    const long: [string, number, [string, number][]][] = [
      [
        'Bench LRGB',
        0,
        [
          ['L', 5],
          ['R', 5],
          ['G', 5],
          ['B', 5],
        ],
      ],
      [
        'Bench SHO',
        15,
        [
          ['Ha', 5],
          ['OIII', 5],
          ['SII', 5],
        ],
      ],
      [
        'Bench Flip',
        30 + LONG_NIGHT_MERIDIAN_MIN / MIN_PER_DEG,
        [
          ['L', 20],
          ['R', 20],
        ],
      ],
      [
        'Bench L+Ha',
        -15,
        [
          ['L', 6],
          ['Ha', 6],
        ],
      ],
      [
        'Bench RGB',
        -30,
        [
          ['R', 5],
          ['G', 5],
          ['B', 5],
        ],
      ],
      [
        'Bench NB',
        10,
        [
          ['Ha', 6],
          ['OIII', 6],
        ],
      ],
    ];
    for (const [name, raOffsetDeg, lines] of long)
      projects.push(
        await deepSky(
          name,
          raOffsetDeg,
          lines.map(([f, n]): [string, number, number, number] => [f, n, 125, 50]),
          { exposureS: 120 },
        ),
      );
  } else if (s === 'dst') {
    // Nacht 31.10./01.11.2026 in Starfront (CDT → CST um 02:00 = 07:00Z): echte Ziele von abends bis morgens, 300 s je
    // Aufnahme wie am Rig; M45 kulminiert ≈ 01:20 CDT, kurz vor der Umstellung (Flip in der doppelten Stunde).
    const targets: [string, number, number, [string, number][]][] = [
      [
        'NGC 7000',
        314.75,
        44.3,
        [
          ['Ha', 30],
          ['OIII', 30],
        ],
      ],
      [
        'M 31',
        10.68,
        41.27,
        [
          ['L', 30],
          ['R', 15],
          ['G', 15],
          ['B', 15],
        ],
      ],
      [
        'M 45',
        56.75,
        24.12,
        [
          ['L', 30],
          ['B', 15],
        ],
      ],
      [
        'M 42',
        83.82,
        -5.39,
        [
          ['Ha', 30],
          ['L', 15],
        ],
      ],
    ];
    for (const [name, raDeg, decDeg, lines] of targets)
      projects.push(
        await deepSky(
          name,
          0,
          lines.map(([f, n]): [string, number, number, number] => [f, n, 125, 50]),
          { raDeg, decDeg, exposureS: 300 },
        ),
      );
    const second = nightTimes({
      site: { latDeg, lonDeg: where.lonDeg },
      night: '2026-11-01',
      timeZoneTransitions: timeZoneTransitions(
        STARFRONT.timeZone,
        nowMs - 86_400_000,
        nowMs + 5 * 86_400_000,
      ),
    });
    if (second.twilight.nautical.startUtc !== null)
      info.nauticalDusk2Utc = iso(second.twilight.nautical.startUtc * 1000);
    if (second.twilight.astronomical.startUtc !== null)
      info.darknessStart2Utc = iso(second.twilight.astronomical.startUtc * 1000);
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
  const fetchVm = async (req: Request) => {
    // Kopfloser Lauf: Uhr des Simulators übernehmen (nie rückwärts), Takt `tick-5min` je 5 virtuelle Minuten.
    const sim = virtual ? Date.parse(req.headers.get('x-npm-sim-now') ?? '') : NaN;
    if (!Number.isNaN(sim) && sim > simNowMs) simNowMs = sim;
    if (virtual && simNowMs - lastTickMs >= 5 * MIN) {
      lastTickMs = simNowMs;
      await stack.tick();
    }
    // Netzausfall: das Plugin bekommt keine Antwort (Zeitüberschreitung wie beim Test-Server `drop_responses`).
    if (dropping && new URL(req.url).pathname.startsWith('/api/nina/'))
      return await new Promise<Response>(() => undefined);
    if (req.headers.get('authorization') !== `Bearer ${BENCH_TOKEN}`) return await stack.fetch(req);
    const headers = new Headers(req.headers);
    headers.set('authorization', `Bearer ${instance.token}`);
    return await stack.fetch(new Request(req, { headers }));
  };
  const http = await listenLocal(fetchVm, opts.port, '0.0.0.0');
  opts.log(`Echter Server (${s}) auf Port ${String(opts.port)}: ${JSON.stringify(info)}`);

  const sessions = () =>
    stack.db
      .selectFrom('session')
      .select(['id', 'status', 'endedAt', 'outboxPending', 'night'])
      .where('tenantId', '=', tenantId)
      .where('rigId', '=', rigId)
      .execute();
  const staleProbe = virtual
    ? undefined
    : setInterval(() => {
        void sessions()
          .then((rows) => {
            if (!staleSeenAt && rows.some((x) => x.status === 'stale'))
              staleSeenAt = iso(Date.now());
          })
          .catch(() => undefined);
      }, MIN).unref();

  return {
    profile: {
      'AstrometrySettings-Latitude': latDeg,
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
        // Virtuelle Uhr: eine Minute weiter statt zu warten.
        if (virtual) simNowMs += MIN;
        else await new Promise((r) => setTimeout(r, 10_000));
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
          'sessionId',
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
        .select(['reason', 'createdAt', 'night'])
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
        staleSeenAt,
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
      if (s === 'long-night') {
        const lit = new Set(lights.map((c) => c.projectId));
        check(
          'Mindestens fünf Ziele belichtet',
          lit.size >= 5,
          `${String(lit.size)} von ${String(projects.length)} Projekten`,
        );
        const flips = events.filter((e) => e.kind === 'flip');
        check(
          'Flip in der Nacht gemeldet, keiner unerkannt',
          flips.length >= 1 && !events.some((e) => e.kind === 'flip_undetected'),
          JSON.stringify(events.map((e) => [e.kind, iso(new Date(e.occurredAt).getTime())])),
        );
        check(
          'Session nie verwaist (Heartbeat die ganze Nacht)',
          staleSeenAt === null,
          staleSeenAt ? `stale um ${staleSeenAt}` : 'nie stale',
        );
        const errors = list.length
          ? await stack.db
              .selectFrom('sessionEvent')
              .select(['kind', 'message', 'occurredAt'])
              .where('tenantId', '=', tenantId)
              .where(
                'sessionId',
                'in',
                list.map((x) => x.id),
              )
              .where('kind', '=', 'error')
              .execute()
          : [];
        check(
          'Keine Fehler-Ereignisse des Plugins',
          errors.length === 0,
          JSON.stringify(errors.map((e) => e.message)),
        );
        check(
          'Neuplanungen in vernünftigem Maß (≤ 1 je 5 min)',
          plans.length <= 270 / 5 + 5,
          `${String(plans.length)} Pläne`,
        );
      }
      if (s === 'full-night' || s === 'long-night') {
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
      if (s === 'dst') {
        // Zeitumstellung CDT → CST am 01.11.2026 um 02:00 (07:00Z): Nacht-Schlüssel, Nachtende, Aufnahmen über die
        // doppelte Stunde, Beginn der zweiten Nacht in CST (Lücke D, 05.10.2026).
        const nights = [...new Set(list.map((x) => String(x.night)))].sort();
        check(
          'Zwei Nächte, je ein Nacht-Schlüssel, beide abgeschlossen',
          done.length === 2 && nights.join(',') === '2026-10-31,2026-11-01',
          `${JSON.stringify(list.map((x) => [x.night, x.status]))}`,
        );
        const planNights = [...new Set(plans.map((p) => String(p.night)))].sort();
        check(
          'Pläne nur für diese beiden Nächte',
          planNights.join(',') === '2026-10-31,2026-11-01',
          `${planNights.join(',')} (${String(plans.length)} Pläne)`,
        );
        const dstMs = Date.parse('2026-11-01T07:00:00Z');
        const times = lights
          .map((c) => new Date(c.capturedAt).getTime())
          .filter((t) => t >= dstMs - 90 * MIN && t <= dstMs + 90 * MIN)
          .sort((a, b) => a - b);
        const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t));
        const maxGap = Math.max(0, ...gaps);
        check(
          'Aufnahmen über die Umstellung (05:30–08:30Z) ohne Lücke über 25 min',
          times.length >= 12 && maxGap <= 25 * MIN,
          `${String(times.length)} Lights, größte Lücke ${String(Math.round(maxGap / MIN))} min`,
        );
        const byNight = (night: string) => {
          const ids = new Set(list.filter((x) => String(x.night) === night).map((x) => x.id));
          return captures.filter((c) => c.sessionId !== null && ids.has(c.sessionId));
        };
        const first = (rows: typeof captures, type: string) =>
          rows
            .filter((c) => c.frameType === type)
            .map((c) => new Date(c.capturedAt).getTime())
            .sort((a, b) => a - b);
        const end1 = where.dawnUtc * 1000;
        const lights1 = first(byNight('2026-10-31'), 'light');
        const flats1 = first(byNight('2026-10-31'), 'flat');
        const lastLight1 = lights1.at(-1);
        const firstFlat1 = flats1[0];
        check(
          'Nacht 1 endet mit der astronomischen Dämmerung in CST, danach Flats',
          lastLight1 !== undefined &&
            firstFlat1 !== undefined &&
            lastLight1 <= end1 + 6 * MIN &&
            firstFlat1 >= end1 - MIN &&
            firstFlat1 <= end1 + 30 * MIN,
          `Dämmerung ${iso(end1)}, letztes Light ${lastLight1 ? iso(lastLight1) : '–'}, erstes Flat ${firstFlat1 ? iso(firstFlat1) : '–'}`,
        );
        const start2 =
          typeof info.darknessStart2Utc === 'string' ? Date.parse(info.darknessStart2Utc) : NaN;
        const firstLight2 = first(byNight('2026-11-01'), 'light')[0];
        check(
          'Nacht 2 beginnt mit der Dunkelheit in CST',
          firstLight2 !== undefined &&
            firstLight2 >= start2 - MIN &&
            firstLight2 <= start2 + 30 * MIN,
          `Dunkelheit ${String(info.darknessStart2Utc ?? '–')}, erstes Light ${firstLight2 ? iso(firstLight2) : '–'}`,
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
      if (staleProbe) clearInterval(staleProbe);
      http.close();
      stack.close();
      void discord.close();
    },
  };
}
