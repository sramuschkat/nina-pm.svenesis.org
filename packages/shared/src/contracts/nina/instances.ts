/**
 * NINA-Instanzen im Web (TK 5.6, 7.2; FA-SYN-01, SV-08): Token `npm_<base62(32 Bytes)>` wird einmalig
 * angezeigt, gespeichert werden nur SHA-256 und Präfix; Widerruf wirkt sofort.
 */
import { z } from 'zod';
import {
  blockedReasons,
  heartbeatStates,
  ninaCommands,
  ninaInstanceStatuses,
  ninaSettingsMismatchCodes,
} from '../../generated/enums';
import { Text, UtcInstant, Uuid } from './common';

/** Profil-Standort weicht vom Rig-Standort ab, ab dieser Differenz je Achse (≈ 1 km, wie NT-22). */
export const PROFILE_SITE_TOLERANCE_DEG = 0.01;

/** Letzter Heartbeat in Kurzform (S-42 „letzter Zustand“); der volle Inhalt steht in der Diagnose. */
export const NinaInstanceState = z
  .object({
    state: z.enum(heartbeatStates),
    blockedReason: z.enum(blockedReasons).nullable(),
    sessionId: Uuid.nullable(),
    receivedAtUtc: UtcInstant.nullable(),
    mismatchCodes: z.array(z.enum(ninaSettingsMismatchCodes)),
  })
  .meta({ id: 'NinaInstanceState' });

/** Lease des Rigs (FA-RIG-06) für *Session übernehmen* in S-42. */
export const RigLeaseView = z
  .object({
    activeSessionId: Uuid.nullable(),
    untilUtc: UtcInstant.nullable(),
    offlineUntilUtc: UtcInstant.nullable(),
  })
  .meta({ id: 'RigLeaseView' });

export const NinaInstanceView = z
  .object({
    id: Uuid,
    rigId: Uuid,
    name: Text,
    tokenPrefix: Text,
    status: z.enum(ninaInstanceStatuses),
    pluginVersion: Text.nullable(),
    engineVersion: Text.nullable(),
    lastSeenAt: UtcInstant.nullable(),
    settingsVersionFetched: z.number().int().nullable(),
    settingsFetchedAt: UtcInstant.nullable(),
    createdAt: UtcInstant,
    /** Rig mit aktueller Einstellungsversion (Übernahmestatus FA-SIM-09) und Standortzone (NT-03). */
    rigName: Text,
    rigSettingsVersion: z.number().int().min(0),
    siteTimeZone: Text,
    /** Standort des NINA-Profils aus dem Heartbeat; Abweichung > 0,01° vom Rig-Standort (FK S-42). */
    profileLocation: z.object({ latDeg: z.number(), lonDeg: z.number() }).nullable(),
    profileSiteMismatch: z.boolean(),
    lastState: NinaInstanceState.nullable(),
    lease: RigLeaseView.nullable(),
  })
  .meta({ id: 'NinaInstanceView' });
export type NinaInstanceView = z.infer<typeof NinaInstanceView>;

export const NinaInstanceCreate = z
  .strictObject({ id: Uuid, rigId: Uuid, name: z.string().trim().min(1).max(120) })
  .meta({ id: 'NinaInstanceCreate' });

export const NinaInstanceCreated = NinaInstanceView.extend({
  /** Einmalig angezeigt; danach nur noch `tokenPrefix` (SV-08). */
  token: z.string().regex(/^npm_[0-9A-Za-z]{43}$/),
}).meta({ id: 'NinaInstanceCreated' });

export const NinaInstanceQuery = z.object({ rigId: Uuid.optional() });

/** Ein Eintrag im Ringpuffer `nina_instance.last_calls` (FA-ADM-06), ohne Token und ohne Inhalte. */
export const NinaCallEntry = z
  .object({
    atUtc: UtcInstant,
    method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
    route: Text,
    status: z.number().int().min(100).max(599),
    code: Text.nullable(),
    durationMs: z.number().int().min(0),
  })
  .meta({ id: 'NinaCallEntry' });
export type NinaCallEntry = z.infer<typeof NinaCallEntry>;

/** Je Liste höchstens so viele Einträge (neueste zuerst). */
export const NINA_CALL_LOG_SIZE = 20;

/** `GET /web/v1/nina-instances/{id}/diagnostics` (FA-ADM-06): letzte Aufrufe, Fehler, Versionen. */
export const NinaInstanceDiagnostics = z
  .object({
    instance: NinaInstanceView,
    /** Letzte Aufrufe ohne erfolgreiche Heartbeats (die zeigen `lastSeenAt` und `lastState`). */
    calls: z.array(NinaCallEntry).max(NINA_CALL_LOG_SIZE),
    /** Letzte Antworten ≥ 400, auch Heartbeats und Anfragen mit widerrufenem Token. */
    errors: z.array(NinaCallEntry).max(NINA_CALL_LOG_SIZE),
    /** Letzter Heartbeat vollständig (Geräte, Trigger, Filterrad), wie gemeldet. */
    heartbeat: z.record(z.string(), z.unknown()).nullable(),
  })
  .meta({ id: 'NinaInstanceDiagnostics' });

/**
 * `POST /web/v1/rigs/{id}/commands` (TK 7.2/7.6, NIN5-14): Kommando an das Plugin aller aktiven Instanzen des Rigs –
 * `refresh_targets` (Ziele sofort neu laden, bei Änderung neu planen) bzw. `reset_plan` (wie *Zurücksetzen*). Zustellung
 * über die Heartbeat-Antwort, höchstens 10 min, genau einmal ausgeführt (Quittung `ackedCommandIds`).
 */
export const NinaRigCommand = z
  .strictObject({ command: z.enum(ninaCommands) })
  .meta({ id: 'NinaRigCommand' });

export const NinaRigCommandCreated = z
  .object({ commandIds: z.array(Uuid) })
  .meta({ id: 'NinaRigCommandCreated' });
