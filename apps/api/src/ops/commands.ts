/**
 * Befehle der Lambda `ops-cli` (TK 5.4, iam.md §5, SV-17). Aufruf nur per `aws lambda invoke` mit Svens
 * Admin-Profil; keine Route, keine Function-URL. Nutzlast: `{"command": "<name>", …Argumente}`.
 * **Jeder** Aufruf schreibt eine Zeile `system_audit` mit Akteur `ops_cli` (SV-11); fachliche Befehle
 * zusätzlich ihre eigene Zeile aus dem Repository.
 */
import { randomUUID } from 'node:crypto';
import { ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import type { EquipmentRepository, TenantAdminRepository } from '@nina-pm/db';
import { seedEquipment, type SeedDemo } from '@nina-pm/db/seed';
import {
  DiscordUserId,
  INVITATION_DEFAULT_DAYS,
  INVITATION_MAX_DAYS,
  isProblemError,
  TenantKey,
  Uuid,
} from '@nina-pm/shared';
import { z } from 'zod';
import seedDemo from '../../../../docs/seed/seed-demo.json' with { type: 'json' };
import { invitationLink, isoUtc } from '../lib/format';

export interface SqsLike {
  send(command: ReceiveMessageCommand): Promise<{
    Messages?: { MessageId?: string; Body?: string; Attributes?: Record<string, string> }[];
  }>;
}

export interface OpsDeps {
  readonly sqs: SqsLike;
  readonly failureQueueUrl: string;
  /** Systemverwaltung mit Akteur `ops_cli` (DB-Rolle app_rw). */
  readonly admin: () => Promise<TenantAdminRepository>;
  /** Ausrüstung eines Mandanten (Seed, AP-09a); DB-Rolle app_rw. */
  readonly equipment: (tenantId: string) => Promise<EquipmentRepository>;
  /** Basis-URL für Einladungslinks, z. B. https://nina-pm.svenesis.org. */
  readonly appOrigin: string;
  readonly now?: () => Date;
}

export interface OpsResult {
  readonly ok: boolean;
  readonly command: string;
  readonly output: unknown;
}

const HELP = {
  help: 'Diese Übersicht.',
  'create-tenant':
    '{"command":"create-tenant","key":"test","name":"Test-Mandant","contact"?:"…"} – mit Built-in-Mondprofilen.',
  'create-invitation':
    '{"command":"create-invitation","tenant":"<key>","role":"owner|admin","discordId"?:"…","validDays"?:7} – Link nur in dieser Antwort.',
  'set-owner':
    '{"command":"set-owner","tenant":"<key>","member":"<app_user.id>"} – bisheriger Owner wird deaktiviert.',
  'grant-super-user':
    '{"command":"grant-super-user","discordId":"…"} – die Identität muss sich einmal angemeldet haben.',
  'block-identity':
    '{"command":"block-identity","discordId":"…","unblock"?:true} – Sperre beendet alle Sitzungen.',
  'revoke-sessions':
    '{"command":"revoke-sessions","identity":"<discordId|identity.id>"} – alle Sitzungen beenden.',
  seed: '{"command":"seed","tenant":"test"} – Demo-Daten: Built-in-Mondprofile und Ausrüstung aus seed-demo.json (idempotent; Projekte folgen mit AP-12a).',
  'list-failed-jobs':
    'Zeigt bis zu 10 Nachrichten aus nina-pm-worker-failures, ohne sie zu löschen.',
} as const;

type Command = keyof typeof HELP;

const Args = {
  'create-tenant': z.object({
    key: TenantKey.refine((k) => k !== 'system'),
    name: z.string().trim().min(1).max(120),
    contact: z.string().max(200).optional(),
  }),
  'create-invitation': z.object({
    tenant: TenantKey,
    role: z.enum(['owner', 'admin']),
    discordId: DiscordUserId.optional(),
    validDays: z.number().int().min(1).max(INVITATION_MAX_DAYS).default(INVITATION_DEFAULT_DAYS),
  }),
  'set-owner': z.object({ tenant: TenantKey, member: Uuid }),
  'grant-super-user': z.object({ discordId: DiscordUserId }),
  'block-identity': z.object({ discordId: DiscordUserId, unblock: z.boolean().default(false) }),
  'revoke-sessions': z.object({ identity: z.union([DiscordUserId, Uuid]) }),
  seed: z.object({ tenant: TenantKey }),
};

/** Argumente ohne Werte, die nicht ins Protokoll gehören (hier keine Geheimnisse, aber keine Links). */
function auditArgs(event: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'command'));
}

async function execute(
  command: Command,
  event: Record<string, unknown>,
  deps: OpsDeps,
  now: Date,
): Promise<unknown> {
  switch (command) {
    case 'help':
      return HELP;
    case 'list-failed-jobs': {
      // VisibilityTimeout 0: nur ansehen, die Nachrichten bleiben sofort wieder sichtbar.
      const res = await deps.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: deps.failureQueueUrl,
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 0,
          WaitTimeSeconds: 0,
          MessageSystemAttributeNames: ['SentTimestamp'],
        }),
      );
      const messages = (res.Messages ?? []).map((m) => ({
        id: m.MessageId,
        sentAt: m.Attributes?.SentTimestamp
          ? new Date(Number(m.Attributes.SentTimestamp)).toISOString()
          : undefined,
        body: m.Body && m.Body.length > 2000 ? `${m.Body.slice(0, 2000)} …` : m.Body,
      }));
      return { count: messages.length, messages };
    }
    case 'create-tenant': {
      const a = Args[command].parse(event);
      const t = await (
        await deps.admin()
      ).createTenant({ tenantKey: a.key, displayName: a.name, contact: a.contact }, now);
      return { id: t.id, tenantKey: t.tenantKey, ownerPending: true };
    }
    case 'create-invitation': {
      const a = Args[command].parse(event);
      const admin = await deps.admin();
      const tenant = await admin.tenantByKey(a.tenant);
      if (!tenant) return { error: 'tenant.not_found' };
      const inv = await admin.createInvitation(
        tenant.id,
        a.role,
        { id: randomUUID(), discordUserId: a.discordId, validDays: a.validDays },
        now,
      );
      return {
        invitationId: inv.id,
        role: inv.role,
        link: invitationLink(deps.appOrigin, inv.token),
        expiresAt: isoUtc(inv.expiresAt),
      };
    }
    case 'set-owner': {
      const a = Args[command].parse(event);
      const admin = await deps.admin();
      const tenant = await admin.tenantByKey(a.tenant);
      if (!tenant) return { error: 'tenant.not_found' };
      await admin.setOwner(tenant.id, a.member, now);
      return { tenantKey: a.tenant, ownerMemberId: a.member };
    }
    case 'grant-super-user': {
      const a = Args[command].parse(event);
      return { identityId: await (await deps.admin()).addSuperUser(a.discordId, now) };
    }
    case 'block-identity': {
      const a = Args[command].parse(event);
      const id = await (
        await deps.admin()
      ).setIdentityStatus({ discordUserId: a.discordId }, a.unblock ? 'active' : 'blocked', now);
      return { identityId: id, status: a.unblock ? 'active' : 'blocked' };
    }
    case 'revoke-sessions': {
      const a = Args[command].parse(event);
      const ref = /^\d+$/.test(a.identity) ? { discordUserId: a.identity } : { id: a.identity };
      return { revoked: await (await deps.admin()).revokeSessions(ref, now) };
    }
    case 'seed': {
      const a = Args[command].parse(event);
      const admin = await deps.admin();
      const tenant = await admin.tenantByKey(a.tenant);
      if (!tenant) return { error: 'tenant.not_found', hint: 'zuerst create-tenant' };
      const moonProfiles = await admin.ensureBuiltInMoonProfiles(tenant.id, now);
      const equipment = await seedEquipment(
        await deps.equipment(tenant.id),
        tenant.id,
        seedDemo as SeedDemo,
        now,
      );
      return {
        tenantKey: a.tenant,
        moonProfilesAdded: moonProfiles,
        equipment,
        pending:
          'Projekte seedet der Befehl ab AP-12a (Freigabe); Identitäten werden in prod nie angelegt (docs/seed/README.md).',
      };
    }
  }
}

export async function runOpsCommand(event: unknown, deps: OpsDeps): Promise<OpsResult> {
  const now = (deps.now ?? (() => new Date()))();
  const e = typeof event === 'object' && event !== null ? (event as Record<string, unknown>) : {};
  const command = typeof e.command === 'string' ? e.command : '';
  let result: OpsResult;
  if (!(command in HELP)) {
    result = { ok: false, command, output: { error: 'Unbekannter Befehl', commands: HELP } };
  } else {
    try {
      const output = await execute(command as Command, e, deps, now);
      const failed = typeof output === 'object' && output !== null && 'error' in output;
      result = { ok: !failed, command, output };
    } catch (error) {
      if (error instanceof z.ZodError) {
        result = {
          ok: false,
          command,
          output: {
            error: 'validation.failed',
            issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          },
        };
      } else if (isProblemError(error)) {
        result = { ok: false, command, output: { error: error.code } };
      } else {
        throw error;
      }
    }
  }
  // Jeder Aufruf steht im System-Audit (SV-11) – ohne Einladungslinks in den Details.
  await (
    await deps.admin()
  ).record(`ops.${command || 'unknown'}`, { ok: result.ok, args: auditArgs(e) }, now);
  return result;
}
