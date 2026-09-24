/**
 * `NotificationService.notify(kind, recipients, payload)` (AP-06b, FA-FRG-11): legt Benachrichtigungen in
 * der Anwendung an und bietet den Anknüpfungspunkt für die Discord-Zustellung (AP-60: `discord_post`-Jobs
 * je Kanal und Kategorie). Anwendungsfälle, die ohnehin in einer Transaktion schreiben (Rollen, Owner),
 * nutzen `insertNotifications` direkt in ihrer Transaktion – dieselbe Prüfung der Art.
 */
import { insertNotifications, type OpenDatabase } from '@nina-pm/db';
import type { NotificationKind } from '@nina-pm/shared';

export interface NotificationEvent {
  readonly tenantId: string;
  readonly kind: NotificationKind;
  readonly recipients: readonly string[];
  readonly payload: Record<string, unknown>;
  readonly projectId: string | null;
}

/** Discord-Hook-Punkt (R6, AP-60); bis dahin leer. */
export type NotificationHook = (event: NotificationEvent) => Promise<void>;

export interface NotificationService {
  notify(
    tenantId: string,
    kind: NotificationKind,
    recipients: readonly string[],
    payload?: Record<string, unknown>,
    options?: { projectId?: string | null; now?: Date },
  ): Promise<number>;
}

export function createNotificationService(
  db: OpenDatabase['db'],
  hooks: readonly NotificationHook[] = [],
): NotificationService {
  return {
    async notify(tenantId, kind, recipients, payload = {}, options = {}) {
      const count = await insertNotifications(db, {
        tenantId,
        recipients,
        kind,
        payload,
        projectId: options.projectId ?? null,
        now: options.now ?? new Date(),
      });
      if (count > 0) {
        const event: NotificationEvent = {
          tenantId,
          kind,
          recipients: [...new Set(recipients)],
          payload,
          projectId: options.projectId ?? null,
        };
        for (const hook of hooks) await hook(event);
      }
      return count;
    },
  };
}
