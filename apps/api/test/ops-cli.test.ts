/** ops-cli (TK 5.4, iam.md §5, SV-11/SV-17): Befehle gegen PGlite; jeder Aufruf schreibt system_audit mit Akteur ops_cli. */
import { ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { TenantAdminRepository } from '@nina-pm/db';
import { openPglite, type PgliteDatabase } from '@nina-pm/db/testing/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOpsCommand, type OpsDeps, type SqsLike } from '../src/ops/commands';

const queueUrl = 'https://sqs.eu-central-1.amazonaws.com/1/nina-pm-worker-failures';
let pg: PgliteDatabase;
let deps: OpsDeps;
let send: ReturnType<typeof vi.fn<SqsLike['send']>>;

beforeAll(async () => {
  pg = await openPglite();
});
afterAll(() => pg.close());

beforeEach(async () => {
  await pg.reset();
  send = vi.fn<SqsLike['send']>(() =>
    Promise.resolve({
      Messages: [
        {
          MessageId: 'm1',
          Body: '{"requestContext":{}}',
          Attributes: { SentTimestamp: '1790000000000' },
        },
      ],
    }),
  );
  deps = {
    sqs: { send },
    failureQueueUrl: queueUrl,
    admin: () => Promise.resolve(new TenantAdminRepository(pg.db, { kind: 'ops_cli' })),
    appOrigin: 'https://nina-pm.svenesis.org',
    now: () => new Date('2026-09-24T12:00:00Z'),
  };
});

const run = (event: object) => runOpsCommand(event, deps);
const audit = async () =>
  (
    await pg.admin.query(
      'SELECT actor, action, super_user_id FROM system_audit ORDER BY created_at, action',
    )
  ).rows;
const identity = async (discordUserId: string) => {
  const id = crypto.randomUUID();
  await pg.admin.query(
    'INSERT INTO identity (id, discord_user_id, discord_username) VALUES ($1, $2, $3)',
    [id, discordUserId, 'u'],
  );
  return id;
};

describe('ops-cli', () => {
  it('help listet alle Befehle aus TK 5.4', async () => {
    const res = await run({ command: 'help' });
    expect(res.ok).toBe(true);
    expect(Object.keys(res.output as object)).toEqual([
      'help',
      'create-tenant',
      'create-invitation',
      'set-owner',
      'grant-super-user',
      'block-identity',
      'revoke-sessions',
      'seed',
      'list-failed-jobs',
    ]);
  });

  it('unbekannter Befehl → ok: false mit Übersicht, trotzdem im Audit', async () => {
    expect(await run({ command: 'drop-database' })).toMatchObject({
      ok: false,
      command: 'drop-database',
    });
    expect(await audit()).toEqual([
      { actor: 'ops_cli', action: 'ops.drop-database', super_user_id: null },
    ]);
  });

  it('list-failed-jobs sieht Nachrichten nur an (VisibilityTimeout 0)', async () => {
    const res = await run({ command: 'list-failed-jobs' });
    expect(res.output).toMatchObject({
      count: 1,
      messages: [{ id: 'm1', sentAt: '2026-09-21T14:13:20.000Z' }],
    });
    const cmd = send.mock.calls[0]?.[0];
    expect(cmd).toBeInstanceOf(ReceiveMessageCommand);
    expect(cmd?.input).toMatchObject({
      QueueUrl: queueUrl,
      VisibilityTimeout: 0,
      MaxNumberOfMessages: 10,
    });
  });

  it('create-tenant → Mandant ohne Owner mit vier Built-in-Mondprofilen; doppelte ID → resource.in_use', async () => {
    const res = await run({ command: 'create-tenant', key: 'test', name: 'Test-Mandant' });
    expect(res).toMatchObject({ ok: true, output: { tenantKey: 'test', ownerPending: true } });
    const profiles = await pg.admin.query(
      'SELECT name, is_built_in FROM moon_profile ORDER BY name',
    );
    expect(profiles.rows.map((r) => r.name)).toEqual([
      'moonProfile.moderate',
      'moonProfile.none',
      'moonProfile.relaxed',
      'moonProfile.strict',
    ]);
    expect(await run({ command: 'create-tenant', key: 'test', name: 'x' })).toMatchObject({
      ok: false,
      output: { error: 'resource.in_use' },
    });
    expect(await run({ command: 'create-tenant', key: 'system', name: 'x' })).toMatchObject({
      ok: false,
      output: { error: 'validation.failed' },
    });
  });

  it('create-invitation → Link mit Token im Fragment; Owner-Einladung genau eine Nutzung', async () => {
    await run({ command: 'create-tenant', key: 'test', name: 'Test' });
    const res = await run({
      command: 'create-invitation',
      tenant: 'test',
      role: 'owner',
      discordId: '1513159531327262844',
    });
    expect(res.ok).toBe(true);
    expect((res.output as { link: string }).link).toMatch(
      /^https:\/\/nina-pm\.svenesis\.org\/einladung#[A-Za-z0-9_-]{43}$/,
    );
    const inv = await pg.admin.query(
      'SELECT role, max_uses, discord_user_id, created_by_super FROM invitation',
    );
    expect(inv.rows).toEqual([
      {
        role: 'owner',
        max_uses: 1,
        discord_user_id: '1513159531327262844',
        created_by_super: null,
      },
    ]);
    expect(JSON.stringify(await pg.admin.query('SELECT details FROM system_audit'))).not.toContain(
      'einladung#',
    );
  });

  it('set-owner, grant-super-user, block-identity, revoke-sessions', async () => {
    await run({ command: 'create-tenant', key: 'test', name: 'Test' });
    const tenant = (await pg.admin.query("SELECT id FROM tenant WHERE tenant_key = 'test'")).rows[0]
      ?.id as string;
    const idA = await identity('111111111111111111');
    const member = crypto.randomUUID();
    await pg.admin.query(
      "INSERT INTO app_user (id, tenant_id, identity_id, display_name, role) VALUES ($1, $2, $3, 'A', 'user')",
      [member, tenant, idA],
    );
    expect(await run({ command: 'set-owner', tenant: 'test', member })).toMatchObject({ ok: true });
    expect(
      (await pg.admin.query('SELECT owner_member_id FROM tenant WHERE id = $1', [tenant])).rows[0]
        ?.owner_member_id,
    ).toBe(member);
    expect(
      (await pg.admin.query('SELECT role FROM app_user WHERE id = $1', [member])).rows[0]?.role,
    ).toBe('admin');

    expect(await run({ command: 'grant-super-user', discordId: '999' })).toMatchObject({
      ok: false,
    });
    expect(
      await run({ command: 'grant-super-user', discordId: '222222222222222222' }),
    ).toMatchObject({ ok: false, output: { error: 'resource.not_found' } });
    await identity('222222222222222222');
    expect(
      await run({ command: 'grant-super-user', discordId: '222222222222222222' }),
    ).toMatchObject({ ok: true });

    await pg.admin.query(
      "INSERT INTO auth_session (session_hash, identity_id, context, expires_at) VALUES ('h1', $1, 'select', now() + interval '1 day')",
      [idA],
    );
    expect(await run({ command: 'revoke-sessions', identity: '111111111111111111' })).toMatchObject(
      { ok: true, output: { revoked: 1 } },
    );
    await pg.admin.query(
      "INSERT INTO auth_session (session_hash, identity_id, context, expires_at) VALUES ('h2', $1, 'select', now() + interval '1 day')",
      [idA],
    );
    expect(await run({ command: 'block-identity', discordId: '111111111111111111' })).toMatchObject(
      { ok: true, output: { status: 'blocked' } },
    );
    expect((await pg.admin.query('SELECT count(*)::int AS n FROM auth_session')).rows[0]?.n).toBe(
      0,
    );
    expect(
      await run({ command: 'block-identity', discordId: '111111111111111111', unblock: true }),
    ).toMatchObject({ output: { status: 'active' } });
  });

  it('seed ergänzt fehlende Built-in-Mondprofile idempotent', async () => {
    expect(await run({ command: 'seed', tenant: 'test' })).toMatchObject({
      ok: false,
      output: { error: 'tenant.not_found' },
    });
    await run({ command: 'create-tenant', key: 'test', name: 'Test' });
    await pg.admin.query("DELETE FROM moon_profile WHERE name = 'moonProfile.strict'");
    expect(await run({ command: 'seed', tenant: 'test' })).toMatchObject({
      ok: true,
      output: { moonProfilesAdded: 1 },
    });
    expect(await run({ command: 'seed', tenant: 'test' })).toMatchObject({
      output: { moonProfilesAdded: 0 },
    });
  });

  it('jeder Aufruf schreibt system_audit mit Akteur ops_cli (SV-11)', async () => {
    const commands = [
      { command: 'help' },
      { command: 'list-failed-jobs' },
      { command: 'create-tenant', key: 'test', name: 'Test' },
      { command: 'create-invitation', tenant: 'test', role: 'admin' },
      { command: 'seed', tenant: 'test' },
      { command: 'revoke-sessions', identity: '333333333333333333' },
    ];
    for (const c of commands) await run(c);
    const rows = await audit();
    expect(rows.every((r) => r.actor === 'ops_cli')).toBe(true);
    for (const c of commands)
      expect(
        rows.map((r) => r.action),
        c.command,
      ).toContain(`ops.${c.command}`);
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['tenant.create', 'invitation.create']),
    );
  });
});
