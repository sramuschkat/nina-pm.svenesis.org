/**
 * Discord ausgehend (S-71 Reiter Discord; FA-DIS-01…05, TK 7.2/7.7, SV-10): Server des Mandanten und
 * Kanäle mit Webhook. Die Webhook-URL ist **nur schreibbar** – keine Antwort enthält sie, nur
 * `webhookHint` (letzte 4 Zeichen). Host nur `discord.com`/`discordapp.com` (SSRF-Schutz).
 */
import { z } from 'zod';
import { discordCategories, discordEventKeys } from '../generated/enums';
import { UtcInstant, Uuid } from './common';

export type DiscordEventKey = (typeof discordEventKeys)[keyof typeof discordEventKeys][number];

/** Alle Ereignisschlüssel in der Reihenfolge der Kategorien (`enums.json discordEventKeys`). */
export const DISCORD_EVENT_KEYS = Object.values(discordEventKeys).flat() as DiscordEventKey[];

/** Kategorie eines Ereignisses (FA-DIS-03). */
export function discordCategoryOf(key: DiscordEventKey): (typeof discordCategories)[number] {
  for (const category of discordCategories)
    if ((discordEventKeys[category] as readonly string[]).includes(key)) return category;
  throw new Error(`Unbekannter Discord-Ereignisschlüssel ${key}`);
}

/** TK 7.2: `^https://(discord\.com|discordapp\.com)/api/webhooks/\d+/[\w-]+$`. */
export const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

/**
 * Prüft eine Webhook-URL beim Speichern **und vor jedem Senden** (FA-DIS-02): nur `https`, nur die beiden
 * Discord-Hosts, kein Port, keine Anmeldedaten, keine Abfrage, kein Fragment.
 */
export function isDiscordWebhookUrl(value: string | null | undefined): value is string {
  if (!value || value.length > 300 || !DISCORD_WEBHOOK_PATTERN.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'discord.com' || url.hostname === 'discordapp.com') &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

/** Letzte 4 Zeichen zur Anzeige (SV-10). */
export const webhookHint = (url: string) => url.slice(-4);

export const DiscordCategorySchema = z.enum(discordCategories);
export const DiscordEventKeySchema = z.enum(
  DISCORD_EVENT_KEYS as [DiscordEventKey, ...DiscordEventKey[]],
);

/**
 * Ereignisfilter je Kanal (FA-DIS-04): abgewählte Ereignisse (Standard: alle senden) und ob Anzeigenamen
 * von Mitgliedern genannt werden (Standard an).
 */
export const DiscordEventFilter = z
  .object({
    disabledEvents: z.array(DiscordEventKeySchema).max(40).default([]),
    showNames: z.boolean().default(true),
  })
  .strict()
  .meta({ id: 'DiscordEventFilter' });
export type DiscordEventFilter = z.output<typeof DiscordEventFilter>;

/** Gespeicherten Filter lesen; Ungültiges fällt auf den Standard zurück. */
export function effectiveEventFilter(stored: unknown): DiscordEventFilter {
  const r = DiscordEventFilter.safeParse(stored ?? {});
  return r.success ? r.data : { disabledEvents: [], showNames: true };
}

const ChannelName = z.string().trim().min(1).max(80);
const WebhookUrl = z.string().trim().max(300).meta({
  description: 'Nur schreibbar; Host discord.com/discordapp.com, sonst 422 discord.webhook_invalid',
});

export const DiscordChannelView = z
  .object({
    id: Uuid,
    name: z.string(),
    /** Webhook gesetzt; die URL selbst wird nie ausgeliefert (SV-10). */
    webhookSet: z.boolean(),
    /** Letzte 4 Zeichen der Webhook-URL; `null` ohne URL. */
    webhookHint: z.string().nullable(),
    categories: z.array(DiscordCategorySchema),
    eventFilter: DiscordEventFilter,
    enabled: z.boolean(),
    lastDeliveryAt: UtcInstant.nullable(),
    lastError: z.string().nullable(),
    lastErrorAt: UtcInstant.nullable(),
    updatedAt: UtcInstant,
  })
  .meta({ id: 'DiscordChannelView' });
export type DiscordChannelView = z.infer<typeof DiscordChannelView>;

export const DiscordChannelCreate = z
  .object({
    name: ChannelName,
    webhookUrl: WebhookUrl,
    categories: z.array(DiscordCategorySchema).min(1).max(3),
    eventFilter: DiscordEventFilter.optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .meta({ id: 'DiscordChannelCreate' });
export type DiscordChannelCreate = z.output<typeof DiscordChannelCreate>;

export const DiscordChannelPatch = z
  .object({
    /** Zuletzt gesehener Stand; weicht er ab → `412 resource.version_conflict`. */
    expectedUpdatedAt: UtcInstant,
    name: ChannelName.optional(),
    /** Neue Webhook-URL (ersetzt die alte); fehlt → unverändert. */
    webhookUrl: WebhookUrl.optional(),
    categories: z.array(DiscordCategorySchema).min(1).max(3).optional(),
    eventFilter: DiscordEventFilter.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .meta({ id: 'DiscordChannelPatch' });
export type DiscordChannelPatch = z.output<typeof DiscordChannelPatch>;

export const DiscordGuild = z
  .object({
    guildName: z.string().trim().max(100).nullable(),
    guildId: z
      .string()
      .regex(/^\d{5,25}$/)
      .nullable(),
    inviteUrl: z
      .string()
      .trim()
      .max(200)
      .regex(/^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/)
      .nullable(),
  })
  .strict()
  .meta({ id: 'DiscordGuild' });
export type DiscordGuild = z.infer<typeof DiscordGuild>;

export const DiscordSettingsView = z
  .object({ guild: DiscordGuild, channels: z.array(DiscordChannelView) })
  .meta({ id: 'DiscordSettingsView' });
export type DiscordSettingsView = z.infer<typeof DiscordSettingsView>;

export const DiscordChannelList = z
  .object({ items: z.array(DiscordChannelView) })
  .meta({ id: 'DiscordChannelList' });

/** Ergebnis der Testnachricht (FA-DIS-05); bei Fehler `502 discord.test_failed`. */
export const DiscordTestResult = z
  .object({ ok: z.literal(true), sentAt: UtcInstant })
  .meta({ id: 'DiscordTestResult' });

/** Nachtbericht erneut senden (FA-AUS-21): Anzahl Kanäle, an die er erneut geht. */
export const ReportResendResult = z
  .object({ channels: z.number().int() })
  .meta({ id: 'ReportResendResult' });
