import { meridianTransitUtc } from '@nina-pm/engine';
import { nina } from '@nina-pm/shared';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { example } from '../src/examples';
import { SCENARIO_NAMES } from '../src/scenario';
import { createTestServer, DROP, type NinaTestServer, type TestResponse } from '../src/server';

type Json = Record<string, unknown>;

/** 18.09.2026 01:00 UTC = 17.09. 20:00 CDT: Nacht 2026-09-17 wie in den Vertragsbeispielen. */
const T0 = Date.parse('2026-09-18T01:00:00Z') / 1000;

function setup(name: string, start = T0) {
  let now = start;
  const server = createTestServer(name, () => now);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Json = {},
    token = 'npm_test',
  ) => {
    const r = await server.handle({
      method,
      path,
      body,
      headers: { authorization: `Bearer ${token}`, ...(headers as Record<string, string>) },
    });
    if (r === DROP) return r;
    expect(r.headers['x-npm-test']).toBe('1');
    expect(r.status).not.toBe(500);
    return r;
  };
  const ok = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = (await call(method, path, body, {}, token)) as TestResponse;
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    return r.body as Json;
  };
  return {
    server,
    call,
    ok,
    advance: (min: number) => (now += min * 60),
    now: () => now,
  };
}

const night = (s: NinaTestServer) => s.world.validNights()[0] as string;
const planRequest = (n: string) => ({
  ...example<Json>('plan.request'),
  night: n,
  startAtUtc: null,
});
const sessionCreate = (n: string, id = '0192a7c0-0000-7000-8000-000000000a01') => ({
  ...example<Json>('session.create.request'),
  id,
  night: n,
});
const heartbeat = (sessionId?: string) => ({ ...example<Json>('heartbeat.request'), sessionId });
/** Blöcke eines Plans (die Tests prüfen die Anzahl über die Erwartungen). */
const blocks = (plan: Json) => plan.blocks as [Json, Json, ...Json[]];
function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('Wert fehlt');
  return v;
}
const entriesOf = (plan: Json) => (plan.blocks as Json[]).flatMap((b) => b.entries as Json[]);
const P = '/api/nina/v1';

describe('NINA-Test-Server: jedes Szenario liefert vertragsgemäße Antworten', () => {
  it('kennt die 25 Szenarien aus ops/plugin-test-protocol.md', () => {
    expect(SCENARIO_NAMES).toEqual(
      [
        'auto-flats',
        'current-night',
        'delay',
        'filter-restored',
        'filters-readout',
        'flats',
        'flats-binning',
        'flip',
        'flip-no-rotator',
        'lease',
        'mosaic-flip',
        'multi-night',
        'night-end',
        'one-night',
        'replan',
        'replan-transit',
        'safety',
        'starfront-center-fails',
        'starfront-night',
        'starfront-night-untuned',
        'starfront-roof',
        'transit',
        'transit-flip',
        'vm-flip',
        'vm-smoke',
      ].sort(),
    );
  });

  for (const name of SCENARIO_NAMES)
    it(`${name}: Bootstrap, Targets und Plan bestehen die zod-Verträge`, async () => {
      const t = setup(name);
      expect(nina.NinaBootstrap.safeParse(await t.ok('GET', `${P}/bootstrap`)).success).toBe(true);
      expect(nina.NinaTargets.safeParse(await t.ok('GET', `${P}/targets`)).success).toBe(true);
      const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
      expect(nina.NinaPlanResponse.safeParse(plan).success).toBe(true);
      expect((plan.blocks as Json[]).length, name).toBeGreaterThan(0);
      for (const b of plan.blocks as Json[]) {
        const entries = b.entries as Json[];
        expect(entries[entries.length - 1]?.cmd).toBe('end');
        expect(entries.map((e) => e.seq)).toEqual(entries.map((_, i) => i + 1));
      }
    });
});

describe('Anmeldung, ETag und Nacht', () => {
  it('falsches Token → 401 nina.token_invalid als Problem Details', async () => {
    const t = setup('one-night');
    const r = (await t.call('GET', `${P}/bootstrap`, undefined, {}, 'npm_falsch')) as TestResponse;
    expect(r.status).toBe(401);
    expect(r.headers['content-type']).toBe('application/problem+json');
    expect(r.body).toMatchObject({ code: 'nina.token_invalid', status: 401 });
  });

  it('Bootstrap trägt Instanz, Rig, Standort Starfront und die Filter aus rig.json', async () => {
    const t = setup('one-night');
    const b = await t.ok('GET', `${P}/bootstrap`);
    const rig = b.rig as Json;
    expect((rig.site as Json).name).toBe('Starfront (Test)');
    expect((rig.filters as Json[]).map((f) => f.ninaFilterName)).toEqual([
      'LUMINANCE',
      'RED',
      'GREEN',
      'BLUE',
      'HA',
      'SII',
      'OIII',
    ]);
    expect(b.serverTimeUtc).toBe('2026-09-18T01:00:00Z');
  });

  it('targets mit passendem If-None-Match → 304; targets_change → neues ETag', async () => {
    const t = setup('replan');
    const r1 = (await t.call('GET', `${P}/targets`)) as TestResponse;
    const etag = r1.headers.etag ?? '';
    expect(
      ((await t.call('GET', `${P}/targets`, undefined, { 'if-none-match': etag })) as TestResponse)
        .status,
    ).toBe(304);
    t.server.apply('targets_change');
    const r2 = (await t.call('GET', `${P}/targets`, undefined, {
      'if-none-match': etag,
    })) as TestResponse;
    expect(r2.status).toBe(200);
    expect(r2.headers.etag).not.toBe(etag);
  });

  it('Plan und Session nur für die aktuelle oder folgende Nacht, sonst 422 nina.night_invalid', async () => {
    const t = setup('one-night');
    expect(t.server.world.validNights()).toEqual(['2026-09-17', '2026-09-18']);
    const r = (await t.call('POST', `${P}/plan`, planRequest('2026-09-15'))) as TestResponse;
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'nina.night_invalid' });
    const s = (await t.call('POST', `${P}/sessions`, sessionCreate('2026-09-19'))) as TestResponse;
    expect(s.body).toMatchObject({ code: 'nina.night_invalid' });
  });

  it('ungültige Anfrage → 422 validation.failed mit Pfaden', async () => {
    const t = setup('one-night');
    const r = (await t.call('POST', `${P}/plan`, { night: 'gestern' })) as TestResponse;
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'validation.failed' });
  });
});

describe('Session, Meldungen und Heartbeat', () => {
  it('Session anlegen (201, idempotent 200), Aufnahmen/Ereignisse mit Duplikaten, Abschluss, danach running → 409', async () => {
    const t = setup('one-night');
    const n = night(t.server);
    const create = sessionCreate(n);
    const r1 = (await t.call('POST', `${P}/sessions`, create)) as TestResponse;
    expect(r1.status).toBe(201);
    expect(nina.NinaSessionCreated.safeParse(r1.body).success).toBe(true);
    expect(((await t.call('POST', `${P}/sessions`, create)) as TestResponse).status).toBe(200);

    const id = create.id as string;
    const captures = example<Json>('captures.request');
    const c1 = await t.ok('POST', `${P}/sessions/${id}/captures`, captures);
    const c2 = await t.ok('POST', `${P}/sessions/${id}/captures`, captures);
    expect((c1.results as Json[]).every((r) => r.status === 'accepted')).toBe(true);
    expect((c2.results as Json[]).every((r) => r.status === 'duplicate')).toBe(true);
    const events = example<Json>('events.request');
    const e1 = await t.ok('POST', `${P}/sessions/${id}/events`, events);
    const e2 = await t.ok('POST', `${P}/sessions/${id}/events`, events);
    expect(e1.duplicate).toBe(0);
    expect(e2).toEqual({ accepted: 0, duplicate: e1.accepted });

    const hb = await t.ok('POST', `${P}/heartbeat`, heartbeat(id));
    expect(nina.NinaHeartbeatResponse.safeParse(hb).success).toBe(true);
    expect((hb.lease as Json).leaseLost).toBe(false);

    const done = await t.ok('PATCH', `${P}/sessions/${id}`, {
      ...example<Json>('session.patch.request'),
      outboxPending: 0,
    });
    expect(done).toMatchObject({ status: 'completed', reportStatus: 'pending' });
    const again = (await t.call(
      'PATCH',
      `${P}/sessions/${id}`,
      example<Json>('session.patch.running'),
    )) as TestResponse;
    expect(again.body).toMatchObject({ code: 'session.closed' });

    const report = t.server.report();
    expect((report.captures as Json[]).length).toBe((captures.captures as Json[]).length);
    expect((report.heartbeats as Json).count).toBe(1);
  });

  it('Meldungen an eine unbekannte Session → 409 session.unknown', async () => {
    const t = setup('one-night');
    const r = (await t.call(
      'POST',
      `${P}/sessions/0192a7c0-0000-7000-8000-00000000ffff/events`,
      example('events.request'),
    )) as TestResponse;
    expect(r.body).toMatchObject({ code: 'session.unknown' });
  });

  it('lease: zweite Instanz bekommt 409 session.rig_busy, solange die erste die Lease hält', async () => {
    const t = setup('lease');
    await t.ok('POST', `${P}/sessions`, sessionCreate(night(t.server)));
    const other = sessionCreate(night(t.server), '0192a7c0-0000-7000-8000-000000000a02');
    const r = (await t.call('POST', `${P}/sessions`, other, {}, 'npm_test2')) as TestResponse;
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'session.rig_busy' });
    t.advance(4); // Lease (3 min) ohne Heartbeat verfallen
    expect(
      ((await t.call('POST', `${P}/sessions`, other, {}, 'npm_test2')) as TestResponse).status,
    ).toBe(201);
  });

  it('rig_busy: POST /sessions und PATCH running → 409 session.rig_busy', async () => {
    const t = setup('lease');
    const create = sessionCreate(night(t.server));
    await t.ok('POST', `${P}/sessions`, create);
    t.server.apply('rig_busy');
    const patch = (await t.call(
      'PATCH',
      `${P}/sessions/${String(create.id)}`,
      example('session.patch.running'),
    )) as TestResponse;
    expect(patch.body).toMatchObject({ code: 'session.rig_busy' });
    const other = sessionCreate(night(t.server), '0192a7c0-0000-7000-8000-000000000a03');
    expect(((await t.call('POST', `${P}/sessions`, other)) as TestResponse).body).toMatchObject({
      code: 'session.rig_busy',
    });
  });

  it('lease_release: genau eine Heartbeat-Antwort mit leaseLost = true, danach wieder gehalten', async () => {
    const t = setup('lease');
    const create = sessionCreate(night(t.server));
    await t.ok('POST', `${P}/sessions`, create);
    t.server.apply('lease_release');
    const lost = await t.ok('POST', `${P}/heartbeat`, heartbeat(create.id as string));
    expect(lost.lease).toEqual({ untilUtc: null, leaseLost: true });
    const held = await t.ok('POST', `${P}/heartbeat`, heartbeat(create.id as string));
    expect((held.lease as Json).leaseLost).toBe(false);
  });

  it('revoke_token → 401 für alle weiteren Aufrufe; clear hebt es auf', async () => {
    const t = setup('one-night');
    t.server.apply('revoke_token');
    expect(((await t.call('GET', `${P}/bootstrap`)) as TestResponse).status).toBe(401);
    t.server.apply('clear');
    expect(((await t.call('GET', `${P}/bootstrap`)) as TestResponse).status).toBe(200);
  });

  it('drop_responses: keine Antwort; restore_responses: wieder normal', async () => {
    const t = setup('lease');
    t.server.apply('drop_responses');
    expect(await t.call('POST', `${P}/heartbeat`, heartbeat())).toBe(DROP);
    t.server.apply('restore_responses');
    expect(((await t.call('POST', `${P}/heartbeat`, heartbeat())) as TestResponse).status).toBe(
      200,
    );
  });

  it('clock_skew verschiebt serverTimeUtc in Bootstrap und Heartbeat um die Sekunden', async () => {
    const t = setup('one-night');
    t.server.apply('clock_skew', 90);
    expect((await t.ok('GET', `${P}/bootstrap`)).serverTimeUtc).toBe('2026-09-18T01:01:30Z');
    expect((await t.ok('POST', `${P}/heartbeat`, heartbeat())).serverTimeUtc).toBe(
      '2026-09-18T01:01:30Z',
    );
  });

  it('filter_wheel_changed: ein Platz trägt einen Namen, den das NINA-Profil nicht kennt', async () => {
    const t = setup('one-night');
    t.server.apply('filter_wheel_changed');
    const b = await t.ok('GET', `${P}/bootstrap`);
    expect(((b.rig as Json).filters as Json[])[0]?.ninaFilterName).toBe('LUMINANCE-ALT');
    const etag = (await t.ok('POST', `${P}/heartbeat`, heartbeat())).targetsEtag;
    t.server.apply('filter_wheel_restored');
    const restored = await t.ok('GET', `${P}/bootstrap`);
    expect(((restored.rig as Json).filters as Json[])[0]?.ninaFilterName).toBe('LUMINANCE');
    expect((await t.ok('POST', `${P}/heartbeat`, heartbeat())).targetsEtag).not.toBe(etag);
  });
});

describe('Nacht-Tabelle der relativen Szenarien', () => {
  it('die Nacht wechselt nicht mitten im Test, auch wenn das echte Nachtfenster endet', async () => {
    // Start 12:54Z (07:54 CDT): das echte Nachtfenster von 2026-10-01 endet 13:05Z.
    const start = Date.parse('2026-10-02T12:54:27Z') / 1000;
    const t = setup('one-night', start);
    const before = t.server.world.validNights()[0] as string;
    t.advance(60);
    expect(t.server.world.validNights()[0]).toBe(before);
    const b = await t.ok('GET', `${P}/bootstrap`);
    const nights = b.nights as Json[];
    const current = nights[0] as Json;
    expect(Date.parse(current.noonStartUtc as string) / 1000).toBe(start - 12 * 3600);
    expect(Date.parse(current.nightWindowEndUtc as string) / 1000).toBeGreaterThan(
      Date.parse(
        ((await t.ok('POST', `${P}/plan`, planRequest(before))) as Json).sessionEndUtc as string,
      ) / 1000,
    );
  });
});

describe('Pläne der Szenarien', () => {
  it('Blöcke beginnen 2 min nach dem Start, je 1 min Abstand', async () => {
    const t = setup('one-night');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    const [b1, b2] = blocks(plan);
    expect(b1.startUtc).toBe('2026-09-18T01:02:00Z');
    expect(b1.endUtc).toBe('2026-09-18T01:22:00Z');
    expect(b2.startUtc).toBe('2026-09-18T01:23:00Z');
  });

  it('one-night: Plan-Dither nach jeder 3. Belichtung', async () => {
    const t = setup('one-night');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    const cmds = (blocks(plan)[0].entries as Json[])
      .map((e) => e.cmd)
      .filter((c) => c === 'expose' || c === 'dither');
    expect(cmds.slice(0, 8)).toEqual([
      'expose',
      'expose',
      'expose',
      'dither',
      'expose',
      'expose',
      'expose',
      'dither',
    ]);
  });

  it('flip: Ziel kulminiert 8 min nach dem Start (NT-35), Flip-Eintrag nach afterMin', async () => {
    const t = setup('flip');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    const b = blocks(plan)[0];
    const tM = must(
      meridianTransitUtc(
        { raJ2000Deg: b.raDeg as number, decJ2000Deg: b.decDeg as number },
        { latDeg: 31.5471, lonDeg: -99.3823 },
        T0 - 3600,
        T0 + 3600,
      ),
    );
    expect(Math.abs(tM - (T0 + 8 * 60))).toBeLessThan(5);
    expect((b.meridianFlip as Json).plannedUtc).toBe('2026-09-18T01:09:00Z');
    const flip = must((b.entries as Json[]).find((e) => e.cmd === 'meridian_flip'));
    expect(Date.parse(flip.atUtc as string) / 1000).toBeGreaterThanOrEqual(T0 + 9 * 60);
  });

  it('mosaic-flip: Flip nur im Block von Panel 1, Panel 2 ohne Flip', async () => {
    const t = setup('mosaic-flip');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    const [p1, p2] = blocks(plan);
    expect(p1.panelId).not.toBe(p2.panelId);
    expect(p1.projectId).toBe(p2.projectId);
    expect(p1.meridianFlip).not.toBeNull();
    expect(p2.meridianFlip).toBeNull();
  });

  it('transit: Serie bis untilUtc im Fenster ab jetzt + 10 min, Vorlauf-Block mit einer 300-s-Belichtung', async () => {
    const t = setup('transit');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    const [pre, tr] = blocks(plan);
    expect(
      (pre.entries as Json[]).filter((e) => e.cmd === 'expose').map((e) => e.exposureS),
    ).toEqual([300]);
    expect(tr.kind).toBe('transit');
    expect(tr.transitObservationId).toBeTruthy();
    const series = must((tr.entries as Json[]).find((e) => e.cmd === 'expose_series'));
    expect(series.atUtc).toBe('2026-09-18T01:10:00Z');
    expect(series.untilUtc).toBe('2026-09-18T01:30:00Z');
  });

  it('transit-flip: Flip im Fenster ungeplant mit Lücke', async () => {
    const t = setup('transit-flip');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    const tr = must((plan.blocks as Json[]).find((b) => b.kind === 'transit'));
    expect(tr.meridianFlip).toMatchObject({ inTransitWindow: true, planned: false });
    expect((tr.entries as Json[]).some((e) => e.cmd === 'meridian_flip')).toBe(false);
  });

  it('replan-transit: Transit erst nach lock_transit; der laufende Block endet vor dem Vorlauf', async () => {
    const t = setup('replan-transit');
    const before = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    expect((before.blocks as Json[]).map((b) => b.kind)).toEqual(['regular']);
    expect(blocks(before)[0].endUtc).toBe('2026-09-18T01:47:00Z');
    t.advance(5);
    t.server.apply('lock_transit');
    const after = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    expect((after.blocks as Json[]).map((b) => b.kind)).toEqual(['regular', 'transit']);
    expect(blocks(after)[0].endUtc).toBe('2026-09-18T01:12:30Z');
  });

  it('replan: pause_project nimmt das laufende Projekt aus dem Plan', async () => {
    const t = setup('replan');
    t.advance(5);
    t.server.apply('pause_project');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    const targets = await t.ok('GET', `${P}/targets`);
    const paused = (targets.projects as Json[])
      .filter((p) => p.status === 'on_hold')
      .map((p) => p.id);
    expect(paused).toHaveLength(1);
    expect((plan.blocks as Json[]).every((b) => !paused.includes(b.projectId))).toBe(true);
  });

  it('skip_block: der laufende Block fehlt im nächsten Plan', async () => {
    const t = setup('replan');
    t.advance(5);
    t.server.apply('skip_block');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    expect(blocks(plan)[0].startUtc).toBe('2026-09-18T01:33:00Z');
  });

  it('delay: Block 1 begann vor 6 min – seine ersten Einträge liegen in der Vergangenheit', async () => {
    const t = setup('delay');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    const first = blocks(plan)[0];
    expect(first.startUtc).toBe('2026-09-18T00:54:00Z');
    expect(blocks(plan)[1].meridianFlip).not.toBeNull();
  });

  it('night-end: darknessEndUtc in 20 min, sessionEndUtc 30 min später, Flats aus', async () => {
    const t = setup('night-end');
    const plan = await t.ok('POST', `${P}/plan`, planRequest(night(t.server)));
    expect(plan.darknessEndUtc).toBe('2026-09-18T01:20:00Z');
    expect(plan.sessionEndUtc).toBe('2026-09-18T01:50:00Z');
    const b = await t.ok('GET', `${P}/bootstrap`);
    expect(JSON.stringify(b)).toContain('"flats":{"enabled":false');
    for (const e of entriesOf(plan).filter((x) => x.cmd === 'expose'))
      expect(Date.parse(e.atUtc as string) / 1000 + (e.exposureS as number)).toBeLessThanOrEqual(
        T0 + 20 * 60,
      );
  });

  it('multi-night: Plan der Folgenacht 24 h später', async () => {
    const t = setup('multi-night');
    const [n1, n2] = t.server.world.validNights();
    const p1 = await t.ok('POST', `${P}/plan`, planRequest(n1 as string));
    const p2 = await t.ok('POST', `${P}/plan`, planRequest(n2 as string));
    const s1 = Date.parse(blocks(p1)[0].startUtc as string);
    const s2 = Date.parse(blocks(p2)[0].startUtc as string);
    expect(s2 - s1).toBe(86_400_000);
  });

  it('current-night (P-29): Nacht-Schlüssel nach Standortzeit, Blöcke ab astronomischer Dunkelheit', async () => {
    const at = (iso: string) => setup('current-night', Date.parse(iso) / 1000);
    expect(night(at('2026-09-18T07:00:00Z').server)).toBe('2026-09-17'); // 02:00 CDT
    expect(night(at('2026-09-18T14:00:00Z').server)).toBe('2026-09-18'); // 09:00 CDT
    expect(night(at('2026-09-18T18:00:00Z').server)).toBe('2026-09-18'); // 13:00 CDT
    const t = at('2026-09-18T14:00:00Z');
    const plan = await t.ok('POST', `${P}/plan`, planRequest('2026-09-18'));
    const astroStart = Date.parse((plan.darkness as Json).astronomicalStartUtc as string);
    expect(Date.parse(blocks(plan)[0].startUtc as string)).toBe(astroStart + 120_000);
    expect(plan.darknessEndUtc).toBe((plan.darkness as Json).astronomicalEndUtc);
  });
});

describe('Steuerung über HTTP', () => {
  it('Server antwortet über HTTP mit X-NPM-Test, /test/actions und /test/report', async () => {
    const server = createTestServer('one-night');
    const http = await server.listen(0, '127.0.0.1');
    try {
      const base = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
      const r = await fetch(`${base}/api/nina/v1/bootstrap`, {
        headers: { authorization: 'Bearer npm_test' },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get('x-npm-test')).toBe('1');
      const bad = await fetch(`${base}/test/actions`, {
        method: 'POST',
        body: JSON.stringify({ action: 'kaputt' }),
      });
      expect(bad.status).toBe(422);
      const a = await fetch(`${base}/test/actions`, {
        method: 'POST',
        body: JSON.stringify({ action: 'targets_change' }),
      });
      expect(await a.json()).toEqual({ ok: true, action: 'targets_change' });
      const report = (await (await fetch(`${base}/test/report`)).json()) as Json;
      expect(report.scenario).toBe('one-night');
      expect((report.actions as Json[]).map((x) => x.action)).toEqual(['targets_change']);
    } finally {
      http.close();
    }
  });
});
