/**
 * Fake-Plugin (TK 17, AP-14c): spielt eine komplette NINA-Nacht gegen `/api/nina/v1` – lokal gegen den
 * Test-Stack, nach jedem prod-Deploy gegen den Test-Mandanten (H-24).
 *
 * Ablauf: Bootstrap → Ziele (ETag, 304) → Session (idempotent) → Plan → Heartbeat → Aufnahmen (inkl.
 * Duplikate und unzugeordnet) → Neuplanung mit `tonight` → Ereignisse → Lease verloren (nur mit Hook
 * für die Admin-Freigabe) → Sessionende → Offline-Nachmeldung → Zählerprüfung.
 *
 * Das Token steht nur im `Authorization`-Header und erscheint nie in Meldungen oder im Bericht.
 */
import { currentNightRow } from '@nina-pm/shared';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface FakeNightOptions {
  /** Basis ohne `/api/nina/v1`, z. B. `https://nina-pm.svenesis.org` oder `http://localhost`. */
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: Fetch;
  /** Frische IDs; im Test deterministisch ersetzbar. */
  readonly newId?: () => string;
  readonly hooks?: {
    /** Admin-Freigabe der Lease (`POST /web/v1/rigs/{id}/lease/release`); ohne Hook entfällt der Schritt. */
    readonly releaseLease?: (rigId: string) => Promise<void>;
  };
}

export type StepStatus = 'ok' | 'failed' | 'skipped';

export interface FakeNightStep {
  readonly name: string;
  readonly status: StepStatus;
  readonly detail: string;
}

export interface FakeNightReport {
  readonly ok: boolean;
  readonly night: string | null;
  readonly steps: readonly FakeNightStep[];
  /** Neu gezählte Lights der geprüften Zeile (Soll) und tatsächliche Zunahme. */
  readonly counters: { readonly expected: number; readonly actual: number } | null;
}

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
  readonly etag: string | null;
}

/** Fehlerbeschreibung ohne Token und ohne Inhalte: Status und Problem-Code. */
const describe = (r: Reply) =>
  `Status ${String(r.status)}${typeof r.body?.code === 'string' ? ` (${r.body.code})` : ''}`;

class StepFailed extends Error {}

interface Line {
  readonly projectId: string;
  readonly panelId: string;
  readonly lineId: string;
  readonly filter: string;
  readonly ninaFilterName: string | null;
  readonly exposureS: number;
  readonly gain: number | null;
  readonly offset: number | null;
  readonly binning: number;
  readonly readoutMode: string | null;
  readonly readoutModeIndex: number | null;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly rotationDeg: number;
  readonly acquired: number;
  readonly planningNeed: number;
}

/**
 * Aktive Zeile eines ausgelieferten Deep-Sky-Projekts mit dem größten Planungsbedarf (so bleibt sie nach
 * den Aufnahmen der Nacht möglichst ausgeliefert); `null`, wenn nichts ausgeliefert wird.
 */
function firstLine(targets: Record<string, unknown> | null): Line | null {
  const projects = (targets?.projects ?? []) as {
    id: string;
    type: string;
    panels: {
      id: string;
      raDeg: number;
      decDeg: number;
      rotationDeg: number;
      lines: {
        id: string;
        enabled: boolean;
        filter: string;
        ninaFilterName: string | null;
        exposureS: number;
        gain: number | null;
        offset: number | null;
        binning: number;
        readoutMode: string | null;
        readoutModeIndex: number | null;
        counts: { acquired: number; planningNeed: number };
      }[];
    }[];
  }[];
  let best: Line | null = null;
  for (const p of projects) {
    if (p.type !== 'deep_sky') continue;
    for (const panel of p.panels)
      for (const l of panel.lines)
        if (l.enabled && (best === null || l.counts.planningNeed > best.planningNeed))
          best = {
            projectId: p.id,
            panelId: panel.id,
            lineId: l.id,
            filter: l.filter,
            ninaFilterName: l.ninaFilterName,
            exposureS: l.exposureS,
            gain: l.gain,
            offset: l.offset,
            binning: l.binning,
            readoutMode: l.readoutMode,
            readoutModeIndex: l.readoutModeIndex,
            raDeg: panel.raDeg,
            decDeg: panel.decDeg,
            rotationDeg: panel.rotationDeg,
            acquired: l.counts.acquired,
            planningNeed: l.counts.planningNeed,
          };
  }
  return best;
}

function acquiredOf(targets: Record<string, unknown> | null, lineId: string): number | null {
  for (const p of (targets?.projects ?? []) as {
    panels: { lines: { id: string; counts: { acquired: number } }[] }[];
  }[])
    for (const panel of p.panels)
      for (const l of panel.lines) if (l.id === lineId) return l.counts.acquired;
  return null;
}

const addSeconds = (iso: string, s: number) =>
  new Date(Date.parse(iso) + s * 1000).toISOString().replace(/\.000Z$/, 'Z');

export async function runFakeNight(options: FakeNightOptions): Promise<FakeNightReport> {
  const doFetch = options.fetch ?? fetch;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const base = `${options.baseUrl.replace(/\/$/, '')}/api/nina/v1`;
  const steps: FakeNightStep[] = [];
  let engineVersion = '';

  const call = async (
    path: string,
    o: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Reply> => {
    const res = await doFetch(`${base}${path}`, {
      method: o.method ?? 'GET',
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(engineVersion ? { 'x-npm-engine-version': engineVersion } : {}),
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...o.headers,
      },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    return { status: res.status, body, etag: res.headers.get('etag') };
  };
  const expectStatus = (r: Reply, ...ok: number[]) => {
    if (!ok.includes(r.status)) throw new StepFailed(describe(r));
    return r;
  };
  const step = async (name: string, fn: () => Promise<string | undefined>) => {
    try {
      steps.push({ name, status: 'ok', detail: (await fn()) ?? 'ok' });
      return true;
    } catch (error) {
      steps.push({
        name,
        status: 'failed',
        detail: error instanceof Error ? error.message : 'Fehler',
      });
      return false;
    }
  };
  const skip = (name: string, detail: string) => steps.push({ name, status: 'skipped', detail });
  const finish = (
    night: string | null,
    counters: FakeNightReport['counters'],
  ): FakeNightReport => ({
    ok: steps.every((s) => s.status !== 'failed'),
    night,
    steps,
    counters,
  });

  // 1. Bootstrap: Rig, Nacht-Tabelle, Serverzeit (NT-02, NT-05).
  let boot: Record<string, unknown> = {};
  let night = '';
  let now = '';
  let rigId = '';
  if (
    !(await step('Bootstrap', async () => {
      boot = expectStatus(await call('/bootstrap'), 200).body ?? {};
      now = String(boot.serverTimeUtc);
      engineVersion = String(
        (boot.server as { engineVersion?: string } | undefined)?.engineVersion,
      );
      rigId = String((boot.rig as { id?: string } | undefined)?.id);
      night = currentNightRow({ nights: boot.nights as never[] }, now).night;
      return `Nacht ${night}, Rig ${rigId}`;
    }))
  )
    return finish(null, null);

  // 2. Ziele mit ETag; derselbe ETag → 304 (NT-19).
  let targets: Record<string, unknown> | null = null;
  let etag = '';
  await step('Ziele und ETag', async () => {
    const r = expectStatus(await call('/targets'), 200);
    targets = r.body;
    etag = r.etag ?? '';
    if (!etag) throw new StepFailed('ETag fehlt');
    const again = await call('/targets', { headers: { 'if-none-match': etag } });
    if (again.status !== 304)
      throw new StepFailed(
        `If-None-Match ${etag}: ${describe(again)} statt 304 (ETag jetzt ${again.etag ?? '–'})`,
      );
    return `${String((targets?.projects as unknown[] | undefined)?.length ?? 0)} Ziele`;
  });
  const line = firstLine(targets);

  // 3. Session anlegen, zweimal mit derselben ID (idempotent, TK 5.6).
  const sessionId = newId();
  const sessionBody = {
    id: sessionId,
    night,
    nightPlanId: null,
    startedAtUtc: now,
    offline: false,
  };
  if (
    !(await step('Session und Lease', async () => {
      expectStatus(await call('/sessions', { method: 'POST', body: sessionBody }), 201);
      expectStatus(await call('/sessions', { method: 'POST', body: sessionBody }), 200);
      return `Session ${sessionId}`;
    }))
  )
    return finish(night, null);

  // 4. Erster Plan der Nacht.
  let nightPlanId: string | null = null;
  let blockId: string | null = null;
  await step('Plan (initial)', async () => {
    const r = expectStatus(
      await call('/plan', {
        method: 'POST',
        body: { night, reason: 'initial', sessionId, tonight: { lastAutofocusUtc: null } },
      }),
      200,
    );
    nightPlanId = String(r.body?.nightPlanId);
    const blocks = (r.body?.blocks ?? []) as { id: string; projectId: string }[];
    blockId = blocks.find((b) => b.projectId === line?.projectId)?.id ?? null;
    return `Revision ${String(r.body?.revision)}, ${String(blocks.length)} Blöcke`;
  });

  const heartbeat = (state: string, extra: Record<string, unknown> = {}) =>
    call('/heartbeat', {
      method: 'POST',
      body: { state, pluginVersion: '1.0.0', engineVersion, ...extra },
    });
  await step('Heartbeat (Lease gehalten)', async () => {
    const r = expectStatus(await heartbeat('running', { sessionId }), 200);
    const lease = r.body?.lease as { leaseLost?: boolean } | null;
    if (lease?.leaseLost !== false) throw new StepFailed('Lease nicht gehalten');
    return undefined;
  });

  // 5. Aufnahmen: Lights der ersten Zeile, dasselbe Paket noch einmal (Duplikate), eine unzugeordnete.
  const light = (at: string, over: Record<string, unknown> = {}) => ({
    id: newId(),
    frameType: 'light',
    capturedAtUtc: at,
    exposureMidUtc: at,
    night,
    nightPlanId,
    blockId,
    projectId: line?.projectId ?? null,
    panelId: line?.panelId ?? null,
    exposureLineId: line?.lineId ?? null,
    filterShortName: line?.filter ?? 'L',
    filterActual: line?.ninaFilterName ?? line?.filter ?? 'L',
    exposureS: line?.exposureS ?? 60,
    gain: line?.gain ?? null,
    offset: line?.offset ?? null,
    binning: line?.binning ?? 1,
    readoutMode: line?.readoutMode ?? null,
    readoutModeIndex: line?.readoutModeIndex ?? null,
    raDeg: line?.raDeg ?? 10,
    decDeg: line?.decDeg ?? 41,
    rotationDeg: line?.rotationDeg ?? 0,
    pierSide: 'west',
    rotatorMechDeg: 0,
    bonus: false,
    temperatureDeviation: false,
    result: 'saved',
    fileName: 'fake-plugin.fits',
    // Optionale NINA-Metriken (AP-62) wie aus NINAs Sternanalyse.
    metrics: { hfr: 2.1, stars: 380, meanAdu: 1500 },
    ...over,
  });
  const upload = async (sid: string, list: unknown[]) =>
    (
      expectStatus(
        await call(`/sessions/${sid}/captures`, { method: 'POST', body: { captures: list } }),
        200,
      ).body?.results ?? []
    ).valueOf() as { id: string; status: string }[];
  let expected = 0;
  const countAccepted = (results: { status: string }[]) =>
    results.filter((r) => r.status === 'accepted').length;
  // Die dritte Aufnahme weicht ab: Kühlung außer Toleranz und andere Belichtungszeit (NT-E2, NT-E3) –
  // gespeichert und gezählt, im Session-Detail mit beiden Kennzeichen.
  const lights = line
    ? [1, 2, 3].map((i) =>
        light(
          addSeconds(now, 60 * i),
          i === 3 ? { temperatureDeviation: true, exposureS: line.exposureS + 30 } : {},
        ),
      )
    : [];
  await step('Aufnahmen, Duplikate, unzugeordnet', async () => {
    const unassigned = light(addSeconds(now, 240), {
      blockId: null,
      projectId: null,
      panelId: null,
      exposureLineId: null,
      assignment: 'unassigned',
    });
    const first = await upload(sessionId, [...lights, unassigned]);
    const accepted = countAccepted(first.filter((r) => r.id !== unassigned.id));
    if (accepted !== lights.length)
      throw new StepFailed(`${String(accepted)} von ${String(lights.length)} Lights angenommen`);
    expected += accepted;
    const u = first.find((r) => r.id === unassigned.id)?.status;
    if (u !== 'unassigned') throw new StepFailed(`unzugeordnet: ${String(u)}`);
    if (lights.length > 0) {
      const dupes = await upload(sessionId, lights);
      if (!dupes.every((r) => r.status === 'duplicate'))
        throw new StepFailed('Duplikate nicht erkannt');
    }
    return line
      ? `${String(accepted)} angenommen, ${String(lights.length)} Duplikate, 1 unzugeordnet`
      : 'keine ausgelieferten Ziele – nur unzugeordnet';
  });

  await step('ETag unverändert nach Aufnahmen (NT-19)', async () => {
    const r = await call('/targets', { headers: { 'if-none-match': etag } });
    if (r.status !== 304)
      throw new StepFailed(
        `${describe(r)} statt 304 (ETag vorher ${etag}, jetzt ${r.etag ?? '–'})`,
      );
    return undefined;
  });

  // 6. Neuplanung mit dem Stand der Nacht (`tonight`, FA-SIM-05).
  await step('Neuplanung mit tonight', async () => {
    const exposed = line ? { [line.projectId]: lights.length * line.exposureS } : {};
    const r = expectStatus(
      await call('/plan', {
        method: 'POST',
        body: {
          night,
          reason: 'refresh',
          sessionId,
          startAtUtc: addSeconds(now, 300),
          pendingCaptures: [],
          targetsEtag: etag,
          tonight: {
            pastBlocks: line
              ? [{ unitId: line.projectId, fromUtc: now, toUtc: addSeconds(now, 240) }]
              : [],
            exposedSecByUnit: exposed,
            lastAutofocusUtc: now,
            filterCycle: [],
            flipDoneByPanel: {},
            currentUnitId: null,
          },
        },
      }),
      200,
    );
    return `Revision ${String(r.body?.revision)}`;
  });

  await step('Ereignisse', async () => {
    const events = [
      { id: newId(), occurredAtUtc: now, kind: 'plan_built', nightPlanId },
      { id: newId(), occurredAtUtc: addSeconds(now, 250), kind: 'af' },
    ];
    expectStatus(
      await call(`/sessions/${sessionId}/events`, { method: 'POST', body: { events } }),
      200,
      204,
    );
    return `${String(events.length)} Ereignisse`;
  });

  // 7. Lease verloren: nur mit Admin-Freigabe (Hook); Aufnahmen danach werden gespeichert (TK 5.6).
  const release = options.hooks?.releaseLease;
  if (release) {
    await step('Lease verloren', async () => {
      await release(rigId);
      const r = expectStatus(await heartbeat('running', { sessionId }), 200);
      if ((r.body?.lease as { leaseLost?: boolean } | null)?.leaseLost !== true)
        throw new StepFailed('leaseLost nicht gemeldet');
      if (line) {
        const after = await upload(sessionId, [light(addSeconds(now, 360))]);
        if (countAccepted(after) !== 1)
          throw new StepFailed('Aufnahme nach Lease-Verlust nicht angenommen');
        expected += 1;
      }
      return 'leaseLost: true, Aufnahme danach gespeichert';
    });
  } else {
    skip('Lease verloren', 'ohne Admin-Freigabe (Hook) nicht auslösbar');
  }

  await step('Sessionende', async () => {
    expectStatus(
      await call(`/sessions/${sessionId}`, {
        method: 'PATCH',
        body: { status: 'completed', endedAtUtc: addSeconds(now, 600), outboxPending: 0 },
      }),
      200,
    );
    return undefined;
  });

  // 8. Offline-Nachmeldung: Session ohne Lease, Aufnahme angenommen (FA-NIN-04).
  await step('Offline-Nachmeldung', async () => {
    const offlineId = newId();
    expectStatus(
      await call('/sessions', {
        method: 'POST',
        body: {
          id: offlineId,
          night,
          nightPlanId: null,
          startedAtUtc: addSeconds(now, -60),
          offline: true,
        },
      }),
      201,
    );
    if (line) {
      const r = await upload(offlineId, [light(addSeconds(now, 30), { nightPlanId: null })]);
      if (countAccepted(r) !== 1) throw new StepFailed('Offline-Aufnahme nicht angenommen');
      expected += 1;
    }
    expectStatus(
      await call(`/sessions/${offlineId}`, {
        method: 'PATCH',
        body: { status: 'completed', endedAtUtc: addSeconds(now, 120), outboxPending: 0 },
      }),
      200,
    );
    return `Session ${offlineId}`;
  });

  await step('Heartbeat nach Nachtende', async () => {
    expectStatus(await heartbeat('idle'), 200);
    return undefined;
  });

  // 9. Zähler: neu gezählt = angenommene Lights, Duplikate und Unzugeordnete nicht (FA-SYN-05).
  let counters: FakeNightReport['counters'] = null;
  const r9 = line ? await call('/targets') : null;
  const after = line && r9?.status === 200 ? acquiredOf(r9.body, line.lineId) : null;
  if (line && after === null && r9?.status === 200 && line.planningNeed <= expected) {
    // Die Nacht hat die Zeile fertig gemacht: sie wird nicht mehr ausgeliefert (FA-PRJ-12).
    skip(
      'Zähler',
      `Zeile ${line.lineId} in dieser Nacht fertig geworden – Testprojekt mit größerem Soll anlegen`,
    );
  } else if (line) {
    await step('Zähler', async () => {
      const r = expectStatus(r9 as Reply, 200);
      const now2 = acquiredOf(r.body, line.lineId);
      if (now2 === null) throw new StepFailed('Zeile nicht mehr ausgeliefert');
      counters = { expected, actual: now2 - line.acquired };
      if (counters.actual !== expected)
        throw new StepFailed(
          `Zunahme ${String(counters.actual)} statt ${String(expected)} (Zeile ${line.lineId})`,
        );
      return `+${String(expected)} auf Zeile ${line.lineId}`;
    });
  } else {
    skip('Zähler', 'keine ausgelieferten Ziele im Rig');
  }
  return finish(night, counters);
}

/** Bericht zeilenweise ausgeben (Konsole von `pnpm fake-plugin` und `pnpm deploy:prod`). */
export function printReport(report: FakeNightReport, log: (line: string) => void = console.log) {
  const mark: Record<StepStatus, string> = { ok: '✓', failed: '✗', skipped: '–' };
  for (const s of report.steps) log(`  ${mark[s.status]} ${s.name}: ${s.detail}`);
  log(report.ok ? '  Fake-Plugin-Nacht grün.' : '  Fake-Plugin-Nacht rot.');
}
