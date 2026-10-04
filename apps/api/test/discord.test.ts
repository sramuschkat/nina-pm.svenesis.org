/**
 * AP-60 (FA-DIS-01…05, FA-AUS-21, TK 7.7, SV-10; PGlite + tools/discord-mock):
 * - Webhook-URL nur schreibbar: fremder Host → `422 discord.webhook_invalid`, Antworten nur `webhookHint`
 * - Zustellung: Ereignis → Zeile `discord_delivery` + Job `discord_post`, Deduplizierung
 * - Mock-Webhook: 429 (`retry_after`), 5xx (Backoff, 5 Versuche), 404 (Kanal aus, Alarm an andere Kanäle)
 * - Host-Prüfung vor jedem Senden, keine Weiterleitung (302 → kein Folgeaufruf)
 * - Zeitangaben doppelt (NT-03) und Nachtbericht nach einer Fake-Plugin-Nacht inkl. „erneut senden“
 */
import { mockFetch, startDiscordMock, type DiscordMock } from '@nina-pm/discord-mock';
import { runFakeNight } from '@nina-pm/fake-plugin';
import { insertNotifications, JobQueue } from '@nina-pm/db';
import { COOKIE_NAMES } from '@nina-pm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { siteSpan, siteTime, tenantDateTime } from '../src/discord/format';
import { DISCORD_BACKOFF_MS, discordPostHandler } from '../src/discord/post-job';
import { discordTick } from '../src/discord/tick';
import { runJob, type JobRunnerDeps } from '../src/worker/jobs';
import { sessionReportHandler } from '../src/worker/session-jobs';
import { CAMERA, filterInput, rigInput, SCHEDULER, SITE, TELESCOPE } from './support/equipment';
import { createStack, ORIGIN_SECRET, type Stack } from './support/stack';

let s: Stack;
let mock: DiscordMock;
beforeAll(async () => {
  s = await createStack();
  mock = await startDiscordMock();
});
beforeEach(async () => {
  await s.reset();
  mock.reset();
  s.setDiscordFetch(mockFetch(mock));
});
afterAll(async () => {
  await mock.close();
  await s.close();
});

type Body = Record<string, unknown>;
const id = () => crypto.randomUUID();
const hook = (n: number, tail: string) =>
  `https://discord.com/api/webhooks/12345678901234567${n}/Tok-${tail}_secretpart`;

async function setup() {
  const tenantId = await s.seed.tenant('alpha');
  const ownerIdentity = await s.seed.identity({ mfaEnabled: true });
  const owner = await s.seed.member(ownerIdentity.id, tenantId, 'admin');
  await s.seed.owner(tenantId, owner);
  const userIdentity = await s.seed.identity({ mfaEnabled: true });
  const user = await s.seed.member(userIdentity.id, tenantId, 'user');
  const ownerCookies = {
    [COOKIE_NAMES.session]: await s.seed.session(ownerIdentity.id, tenantId, 'tenant'),
  };
  const userCookies = {
    [COOKIE_NAMES.session]: await s.seed.session(userIdentity.id, tenantId, 'tenant'),
  };
  const web = async (path: string, o: { method?: string; body?: unknown; as?: 'user' } = {}) => {
    const res = await s.request(`/api/web/v1${path}`, {
      ...(o.method ? { method: o.method } : {}),
      ...(o.body !== undefined ? { body: o.body } : {}),
      cookies: o.as === 'user' ? userCookies : ownerCookies,
    });
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : null) as Body };
  };
  const channel = async (name: string, categories: string[], url: string) => {
    const r = await web('/tenant/discord/channels', {
      method: 'POST',
      body: { name, webhookUrl: url, categories },
    });
    expect(r.status).toBe(201);
    return r.body;
  };
  const q = async <T>(text: string, params: unknown[] = []) =>
    (await s.pg.admin.query(text, params)).rows as T[];
  const jobs: JobRunnerDeps = {
    queue: () => Promise.resolve(new JobQueue(s.pg.db)),
    now: () => s.clock.now(),
    handlers: {
      discord_post: discordPostHandler({
        db: () => Promise.resolve(s.pg.db),
        fetch: mockFetch(mock),
        sleep: () => Promise.resolve(),
      }),
      session_report: sessionReportHandler({
        db: () => Promise.resolve(s.pg.db),
        enqueue: () => Promise.resolve(),
      }),
    },
  };
  const discordJobs = (channelId?: string) =>
    q<{ id: string; status: string; attempts: number; run_after: Date; input: Body }>(
      `SELECT id, status, attempts, run_after, input FROM job WHERE kind = 'discord_post'
       ${channelId ? "AND input->>'channelId' = $1" : ''} ORDER BY created_at, id`,
      channelId ? [channelId] : [],
    );
  const delivery = async (channelId: string) =>
    q<{ event_key: string; status: string; attempts: number; last_error: string | null }>(
      'SELECT event_key, status, attempts, last_error FROM discord_delivery WHERE channel_id = $1 ORDER BY created_at',
      [channelId],
    );
  const notify = (kind: 'submission.new' | 'alert.rig_busy', payload: Body = {}) =>
    insertNotifications(s.pg.db, {
      tenantId,
      recipients: [],
      kind,
      payload: { name: 'NGC 7000', subject: 'Rig A · 17./18.09. · PC', key: 'k1', ...payload },
      now: s.clock.now(),
    });
  return { tenantId, owner, user, web, channel, q, jobs, discordJobs, delivery, notify };
}

describe('Webhook-URL nur schreibbar (SV-10, FA-DIS-02)', () => {
  it('fremder Host → 422 discord.webhook_invalid; Antworten und Protokoll nur mit webhookHint', async () => {
    const t = await setup();
    for (const bad of [
      'https://evil.example/api/webhooks/1234567/abc',
      'https://discord.com.evil.io/api/webhooks/1234567/abc',
      'http://discord.com/api/webhooks/1234567/abc',
      'https://discord.com:8443/api/webhooks/1234567/abc',
      'https://user@discord.com/api/webhooks/1234567/abc',
      'https://discord.com/api/webhooks/1234567/abc?x=1',
      'https://discord.com/api/oauth2/token',
    ]) {
      const r = await t.web('/tenant/discord/channels', {
        method: 'POST',
        body: { name: '#x', webhookUrl: bad, categories: ['alerts'] },
      });
      expect(r.status, bad).toBe(422);
      expect(r.body.code).toBe('discord.webhook_invalid');
    }
    const url = hook(1, 'aaaa');
    const created = await t.web('/tenant/discord/channels', {
      method: 'POST',
      body: { name: '#np-alarme', webhookUrl: url, categories: ['alerts'] },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ webhookSet: true, webhookHint: 'part', enabled: true });
    expect(created.text).not.toContain('secretpart');
    expect(created.text).not.toContain('/api/webhooks');
    const views = [await t.web('/tenant/discord'), await t.web('/tenant/discord/channels')];
    for (const v of views) {
      expect(v.status).toBe(200);
      expect(v.text).not.toContain('secretpart');
    }
    // Neue URL per PATCH: geprüft, nur der Hinweis wechselt; das Protokoll nennt nie die URL.
    const id1 = created.body.id as string;
    const patched = await t.web(`/tenant/discord/channels/${id1}`, {
      method: 'PATCH',
      body: {
        expectedUpdatedAt: created.body.updatedAt,
        webhookUrl: 'https://discordapp.com/api/webhooks/99999/zzzz-WXYZ',
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.webhookHint).toBe('WXYZ');
    expect(patched.text).not.toContain('zzzz');
    const log = await t.q<{ diff: unknown }>(
      "SELECT diff FROM change_log WHERE entity = 'discord_channel'",
    );
    expect(log).toHaveLength(2);
    expect(JSON.stringify(log)).not.toMatch(/secretpart|zzzz|webhooks\//);
  });

  it('412 bei veraltetem Stand; Löschen; User → 403', async () => {
    const t = await setup();
    const c = await t.channel('#np-freigaben', ['approvals'], hook(2, 'bbbb'));
    const first = await t.web(`/tenant/discord/channels/${c.id as string}`, {
      method: 'PATCH',
      body: {
        expectedUpdatedAt: c.updatedAt,
        name: '#freigaben',
        eventFilter: { disabledEvents: ['submission.withdrawn'], showNames: false },
      },
    });
    expect(first.status).toBe(200);
    s.clock.advance(1000);
    const stale = await t.web(`/tenant/discord/channels/${c.id as string}`, {
      method: 'PATCH',
      body: { expectedUpdatedAt: c.updatedAt, enabled: false },
    });
    expect(stale.status).toBe(412);
    expect(stale.body.code).toBe('resource.version_conflict');
    expect((await t.web('/tenant/discord', { as: 'user' })).status).toBe(403);
    expect(
      (await t.web(`/tenant/discord/channels/${c.id as string}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect(((await t.web('/tenant/discord/channels')).body.items as unknown[]).length).toBe(0);
  });

  it('Server des Mandanten speichern (FA-DIS-01)', async () => {
    const t = await setup();
    const r = await t.web('/tenant/discord', {
      method: 'PUT',
      body: {
        guildName: 'Sternfreunde',
        guildId: '123456789012345678',
        inviteUrl: 'https://discord.gg/abcDEF',
      },
    });
    expect(r.status).toBe(200);
    expect((await t.web('/tenant/discord')).body.guild).toEqual({
      guildName: 'Sternfreunde',
      guildId: '123456789012345678',
      inviteUrl: 'https://discord.gg/abcDEF',
    });
    const bad = await t.web('/tenant/discord', {
      method: 'PUT',
      body: { guildName: 'x', guildId: null, inviteUrl: 'https://evil.example/invite' },
    });
    expect(bad.status).toBe(422);
  });
});

describe('Testnachricht (FA-DIS-05)', () => {
  it('sendet mit ?wait=true, username und allowed_mentions; 404 → 502 discord.test_failed', async () => {
    const t = await setup();
    const c = await t.channel('#np-alarme', ['alerts'], hook(3, 'cccc'));
    const ok = await t.web(`/tenant/discord/channels/${c.id as string}/test`, { method: 'POST' });
    expect(ok.status).toBe(200);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.query).toBe('?wait=true');
    expect(mock.calls[0]?.body).toMatchObject({
      username: 'Svenesis NINA-PM',
      allowed_mentions: { parse: [] },
      embeds: [expect.objectContaining({ title: 'Testnachricht' })],
    });
    mock.script({ status: 404, body: { message: 'Unknown Webhook', code: 10015 } });
    const failed = await t.web(`/tenant/discord/channels/${c.id as string}/test`, {
      method: 'POST',
    });
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe('discord.test_failed');
    const view = (await t.web('/tenant/discord/channels')).body.items as Body[];
    expect(view[0]).toMatchObject({ lastError: 'http_404', lastDeliveryAt: expect.any(String) });
  });
});

describe('Zustellung discord_post (TK 7.7)', () => {
  it('Ereignis → je passendem Kanal eine Zustellung; dedupliziert; Filter; gesendet', async () => {
    const t = await setup();
    const approvals = await t.channel('#np-freigaben', ['approvals'], hook(4, 'dddd'));
    const alerts = await t.channel('#np-alarme', ['alerts'], hook(5, 'eeee'));
    await t.notify('submission.new');
    await t.notify('submission.new'); // gleiches Ereignis (gleicher Zeitpunkt, Schlüssel) → einmal
    expect(await t.delivery(approvals.id as string)).toEqual([
      expect.objectContaining({ event_key: 'submission.new', status: 'pending' }),
    ]);
    expect(await t.delivery(alerts.id as string)).toEqual([]);
    expect(await t.discordJobs()).toHaveLength(1);
    expect(await discordTick(s.pg.db, t.jobs, s.clock.now())).toBe(1);
    expect(mock.calls).toHaveLength(1);
    const body = mock.calls[0]?.body as { embeds: Body[]; allowed_mentions: unknown };
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0]).toMatchObject({
      title: 'Neue Einreichung: NGC 7000',
      url: 'https://nina-pm.svenesis.org/projekte/warteschlange',
      color: 5793266,
      footer: { text: 'Mandant alpha · NINA-PM' },
    });
    expect(await t.delivery(approvals.id as string)).toEqual([
      expect.objectContaining({ status: 'sent' }),
    ]);
    // Abgewähltes Ereignis geht nicht in den Kanal.
    await t.web(`/tenant/discord/channels/${approvals.id as string}`, {
      method: 'PATCH',
      body: {
        expectedUpdatedAt: ((await t.web('/tenant/discord/channels')).body.items as Body[])[0]
          ?.updatedAt,
        eventFilter: { disabledEvents: ['submission.new'], showNames: true },
      },
    });
    s.clock.advance(60_000);
    await t.notify('submission.new');
    expect(await t.delivery(approvals.id as string)).toHaveLength(1);
  });

  it('429 mit kurzem retry_after: im selben Lauf erneut; langes retry_after: neuer Versuch später', async () => {
    const t = await setup();
    const c = await t.channel('#np-alarme', ['alerts'], hook(6, 'ffff'));
    mock.script({ status: 429, body: { retry_after: 0.4, global: false } });
    await t.notify('alert.rig_busy');
    await discordTick(s.pg.db, t.jobs, s.clock.now());
    expect(mock.calls).toHaveLength(2);
    expect(await t.delivery(c.id as string)).toEqual([expect.objectContaining({ status: 'sent' })]);

    mock.reset();
    mock.script({ status: 429, body: { retry_after: 60 } });
    s.clock.advance(60_000);
    await t.notify('alert.rig_busy');
    const [, job] = await t.discordJobs();
    expect(await runJob(t.jobs, job?.id as string)).toBe('retry');
    const [after] = await t.q<{ status: string; run_after: Date }>(
      'SELECT status, run_after FROM job WHERE id = $1',
      [job?.id],
    );
    expect(after?.status).toBe('pending');
    expect(new Date(after?.run_after as Date).getTime() - s.clock.now().getTime()).toBe(60_000);
    expect((await t.delivery(c.id as string))[1]).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'http_429',
    });
  });

  it('5xx: Backoff 30 s, 2 min, 10 min, 30 min, nach 5 Versuchen endgültig fehlgeschlagen; Kanal bleibt aktiv', async () => {
    const t = await setup();
    const c = await t.channel('#np-alarme', ['alerts'], hook(7, 'gggg'));
    mock.script(...Array.from({ length: 5 }, () => ({ status: 503 })));
    await t.notify('alert.rig_busy');
    const [job] = await t.discordJobs();
    const waits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const outcome = await runJob(t.jobs, job?.id as string);
      const [row] = await t.q<{ status: string; run_after: Date }>(
        'SELECT status, run_after FROM job WHERE id = $1',
        [job?.id],
      );
      if (i < 4) {
        expect(outcome).toBe('retry');
        waits.push(new Date(row?.run_after as Date).getTime() - s.clock.now().getTime());
      } else {
        expect(outcome).toBe('done');
        expect(row?.status).toBe('done');
      }
    }
    expect(waits).toEqual(DISCORD_BACKOFF_MS.slice(0, 4));
    expect(mock.calls).toHaveLength(5);
    expect(await t.delivery(c.id as string)).toEqual([
      expect.objectContaining({ status: 'failed', attempts: 5, last_error: 'http_503' }),
    ]);
    const [channel] = await t.q<{ enabled: boolean; last_error: string }>(
      'SELECT enabled, last_error FROM discord_channel WHERE id = $1',
      [c.id],
    );
    expect(channel).toEqual({ enabled: true, last_error: 'http_503' });
  });

  it('404: Kanal aus, Admins in der App benachrichtigt, Meldung nur an die anderen Alarm-Kanäle', async () => {
    const t = await setup();
    const a = await t.channel('#alarme-a', ['alerts'], hook(8, 'hhhh'));
    const b = await t.channel('#alarme-b', ['alerts'], hook(9, 'iiii'));
    await t.notify('alert.rig_busy');
    const [jobA] = await t.discordJobs(a.id as string);
    mock.script({ status: 404, body: { message: 'Unknown Webhook', code: 10015 } });
    await runJob(t.jobs, jobA?.id as string);
    const [channel] = await t.q<{ enabled: boolean; last_error: string }>(
      'SELECT enabled, last_error FROM discord_channel WHERE id = $1',
      [a.id],
    );
    expect(channel).toEqual({ enabled: false, last_error: 'http_404' });
    const notes = await t.q<{ kind: string; recipient_id: string }>(
      "SELECT kind, recipient_id FROM notification WHERE kind = 'alert.discord_channel_failed'",
    );
    expect(notes).toEqual([{ kind: 'alert.discord_channel_failed', recipient_id: t.owner }]);
    expect((await t.delivery(a.id as string)).map((d) => d.event_key)).toEqual(['rig.busy']);
    expect((await t.delivery(b.id as string)).map((d) => d.event_key)).toEqual([
      'rig.busy',
      'discord.channel_failed',
    ]);
    // Deaktivierter Kanal: keine neuen Zustellungen.
    s.clock.advance(60_000);
    await t.notify('alert.rig_busy');
    expect(await t.delivery(a.id as string)).toHaveLength(1);
  });

  it('Host-Prüfung vor jedem Senden: in der DB manipulierte URL wird nie aufgerufen', async () => {
    const t = await setup();
    const c = await t.channel('#np-alarme', ['alerts'], hook(1, 'jjjj'));
    await s.pg.admin.query(
      "UPDATE discord_channel SET webhook_url = 'https://evil.example/api/webhooks/1/x' WHERE id = $1",
      [c.id],
    );
    let foreign = 0;
    const jobs: JobRunnerDeps = {
      ...t.jobs,
      handlers: {
        discord_post: discordPostHandler({
          db: () => Promise.resolve(s.pg.db),
          fetch: (url, init) => {
            if (!url.startsWith('https://discord.com/')) foreign += 1;
            return mockFetch(mock)(url, init);
          },
        }),
      },
    };
    await t.notify('alert.rig_busy');
    await discordTick(s.pg.db, jobs, s.clock.now());
    expect(foreign).toBe(0);
    expect(mock.calls).toHaveLength(0);
    expect(await t.delivery(c.id as string)).toEqual([
      expect.objectContaining({ status: 'failed', last_error: 'webhook_invalid' }),
    ]);
    const [channel] = await t.q<{ enabled: boolean }>(
      'SELECT enabled FROM discord_channel WHERE id = $1',
      [c.id],
    );
    expect(channel?.enabled).toBe(false);
  });

  it('302 → keine Weiterleitung, Zustellung als Fehler', async () => {
    const t = await setup();
    const c = await t.channel('#np-alarme', ['alerts'], hook(2, 'kkkk'));
    mock.script({ status: 302, headers: { location: `${mock.url}/api/webhooks/42/elsewhere` } });
    await t.notify('alert.rig_busy');
    await discordTick(s.pg.db, t.jobs, s.clock.now());
    expect(mock.calls.map((x) => x.path)).toEqual([
      '/api/webhooks/123456789012345672/Tok-kkkk_secretpart',
    ]);
    expect(await t.delivery(c.id as string)).toEqual([
      expect.objectContaining({ status: 'failed', last_error: 'redirect' }),
    ]);
  });
});

describe('Zeitangaben (NT-03, ops/discord-embeds.md)', () => {
  it('Standortzeit mit Kürzel plus Discord-Zeitstempel', () => {
    expect(siteTime('2026-09-18T02:08:00Z', 'America/Chicago')).toBe(
      '21:08 CDT (<t:1789697280:t>)',
    );
    expect(siteSpan('2026-09-18T02:08:00Z', '2026-09-18T07:34:00Z', 'America/Chicago')).toBe(
      '21:08–02:34 CDT (<t:1789697280:t>–<t:1789716840:t>)',
    );
    expect(tenantDateTime('2026-09-18T16:00:00Z', 'Europe/Berlin')).toBe(
      '18.09. 18:00 MESZ (<t:1789747200:f>)',
    );
  });
});

describe('Nachtbericht (FA-AUS-21) nach einer Fake-Plugin-Nacht', () => {
  it('Session gestartet/beendet, Bericht in den Sessions-Kanal, Status sent; erneut senden', async () => {
    s.clock.set(new Date('2026-09-18T14:00:00Z'));
    const t = await setup();
    const eq = s.services.repositories({ tenantId: t.tenantId, memberId: t.owner }).equipment();
    const now = s.clock.now();
    const site = await eq.createSite(id(), SITE, now);
    const telescope = await eq.createTelescope(id(), TELESCOPE, now);
    const camera = await eq.createCamera(id(), CAMERA, now);
    const ha = await eq.createFilter(id(), filterInput('Ha'), now);
    const rig = await eq.createRig(id(), rigInput(site.id, telescope.id, camera.id), now);
    await eq.updateScheduler(rig.id, SCHEDULER, now);
    await eq.putFilterWheel(
      rig.id,
      { slots: [{ position: 1, filterId: ha.id, ninaFilterName: 'Ha 3nm' }] },
      now,
    );
    await s.pg.admin.query('UPDATE rig SET session_report_discord = true WHERE id = $1', [rig.id]);
    const created = await t.web('/projects', {
      method: 'POST',
      body: {
        id: id(),
        name: 'NGC 281',
        rigId: rig.id,
        targetName: 'NGC 281',
        raDeg: 13.2,
        decDeg: 56.6,
      },
    });
    const pid = created.body.id as string;
    const panelId = (created.body.panels as { id: string }[])[0]?.id as string;
    await t.web(`/projects/${pid}/lines`, {
      method: 'POST',
      body: {
        id: id(),
        panelId,
        filterId: ha.id,
        exposureS: 300,
        plannedCount: 40,
        moonMode: 'none',
      },
    });
    await s.pg.admin.query(
      "UPDATE project SET approval_status = 'approved', status = 'active', rig_id = requested_rig_id WHERE id = $1",
      [pid],
    );
    const sessions = await t.channel('#np-sessions', ['sessions'], hook(3, 'llll'));
    const token = (
      await t.web('/nina-instances', {
        method: 'POST',
        body: { id: id(), rigId: rig.id, name: 'PC' },
      })
    ).body.token as string;
    await runFakeNight({
      baseUrl: 'http://localhost',
      token,
      fetch: (url, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set('x-origin-verify', ORIGIN_SECRET);
        return Promise.resolve(s.app.request(url, { ...init, headers }));
      },
      hooks: {
        releaseLease: async (rigId) => {
          await t.web(`/rigs/${rigId}/lease/release`, { method: 'POST' });
        },
      },
    });
    for (const j of await t.q<{ id: string }>("SELECT id FROM job WHERE kind = 'session_report'"))
      await runJob(t.jobs, j.id);
    await discordTick(s.pg.db, t.jobs, s.clock.now());
    const titles = mock.calls.flatMap((c) =>
      (c.body as { embeds: { title: string }[] }).embeds.map((e) => e.title),
    );
    expect(titles).toEqual(
      expect.arrayContaining([
        'Session gestartet: Starfront – GT81 – Ares-M Pro',
        'Session beendet: Starfront – GT81 – Ares-M Pro',
        'Nachtbericht 18./19.09. – Starfront – GT81 – Ares-M Pro',
        'NGC 281',
      ]),
    );
    const report = mock.calls.find((c) =>
      (c.body as { embeds: { title: string }[] }).embeds[0]?.title.startsWith('Nachtbericht'),
    );
    const text = JSON.stringify(report?.body);
    expect(text).toMatch(/CDT \(<t:\d+:t>–<t:\d+:t>\)/);
    expect(text).not.toMatch(/\.fits|Bearer|"raDeg"|56\.6/);
    const reportStatus = await t.q<{ report_status: string }>(
      "SELECT report_status FROM session WHERE report_status <> 'none' ORDER BY started_at",
    );
    expect(reportStatus.map((r) => r.report_status)).toContain('sent');

    // Erneut senden (Admin): Zeile zurückgesetzt, neuer Job, Protokolleintrag.
    const [sent] = await t.q<{ object_id: string }>(
      "SELECT object_id FROM discord_delivery WHERE event_key = 'session.report' AND status = 'sent'",
    );
    const before = mock.calls.length;
    const resend = await t.web(`/sessions/${sent?.object_id as string}/report/resend`, {
      method: 'POST',
    });
    expect(resend.status).toBe(200);
    expect(resend.body).toEqual({ channels: 1 });
    expect(
      (
        await t.web(`/sessions/${sent?.object_id as string}/report/resend`, {
          method: 'POST',
          as: 'user',
        })
      ).status,
    ).toBe(403);
    await discordTick(s.pg.db, t.jobs, s.clock.now());
    expect(mock.calls.length).toBe(before + 1);
    expect(await t.q("SELECT 1 FROM change_log WHERE action = 'report_resend'")).toHaveLength(1);
    expect(sessions.id).toBeDefined();
  });
});
