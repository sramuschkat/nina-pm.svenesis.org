import type { TickTasks } from './dispatch';
import { pickupStaleJobs, type JobRunnerDeps } from './jobs';

export interface MaintenanceDeps {
  /** Abgelaufene Einladungen löschen (TK 13, `daily`); liefert die Anzahl. */
  readonly cleanupInvitations: () => Promise<number>;
  /** Speicherbedarf je Mandant messen (AP-07d, `daily`); liefert die Anzahl gemessener Mandanten. */
  readonly measureStorage?: () => Promise<number>;
  /** Offene Einreichungen nach `approvalDeadlineDays` verfallen lassen (AP-12a, `tick-hourly`). */
  readonly expireSubmissions?: () => Promise<number>;
  /** Aufwand-Kennzeichen je Standort und Nacht nach dem lokalen Mittag (AP-13e, NT-08, `tick-hourly`). */
  readonly effortSiteNights?: () => Promise<number>;
  /** Verwaiste Sessions, Metrik `StaleRunningSessions`, fällige Session-Jobs (AP-15, `tick-5min`). */
  readonly sessions?: () => Promise<unknown>;
  /** Zähler-Abgleich je Standort und Nacht nach dem lokalen Mittag (AP-15, NT-08, `tick-hourly`). */
  readonly reconcileSiteNights?: () => Promise<number>;
  /** Astro-Wetter je Standort aktiver Mandanten → `weather_cache` (AP-23, `tick-hourly`). */
  readonly weather?: () => Promise<number>;
}

/**
 * Aufgaben je Zeitplan (TK 13). Stand AP-04b: `tick-5min` übernimmt liegengebliebene Jobs (7.4),
 * `daily` räumt abgelaufene Einladungen auf und misst den Speicherbedarf je Mandant (AP-07d),
 * `tick-hourly` lässt überfällige Einreichungen verfallen (AP-12a) und startet je Standort einmal je Nacht
 * die Aufwand-Kennzeichen (AP-13e, NT-08) und den Zähler-Abgleich (AP-15); `tick-5min` markiert
 * verwaiste Sessions und legt fällige Session-Jobs an (AP-15). `tick-hourly` holt zuerst das Astro-Wetter
 * je Standort (AP-23).
 */
export function tickTasks(jobs: JobRunnerDeps, maintenance?: MaintenanceDeps): TickTasks {
  return {
    'tick-5min': [
      { name: 'job_pickup', run: async () => void (await pickupStaleJobs(jobs)) },
      ...(maintenance?.sessions
        ? [{ name: 'sessions', run: async () => void (await maintenance.sessions?.()) }]
        : []),
    ],
    'tick-hourly': [
      ...(maintenance?.weather
        ? [{ name: 'weather', run: async () => void (await maintenance.weather?.()) }]
        : []),
      ...(maintenance?.expireSubmissions
        ? [
            {
              name: 'submission_expiry',
              run: async () => void (await maintenance.expireSubmissions?.()),
            },
          ]
        : []),
      ...(maintenance?.effortSiteNights
        ? [
            {
              name: 'effort_site_nights',
              run: async () => void (await maintenance.effortSiteNights?.()),
            },
          ]
        : []),
      ...(maintenance?.reconcileSiteNights
        ? [
            {
              name: 'reconcile_site_nights',
              run: async () => void (await maintenance.reconcileSiteNights?.()),
            },
          ]
        : []),
    ],
    daily: maintenance
      ? [
          {
            name: 'invitation_cleanup',
            run: async () => void (await maintenance.cleanupInvitations()),
          },
          ...(maintenance.measureStorage
            ? [
                {
                  name: 'tenant_storage',
                  run: async () => void (await maintenance.measureStorage?.()),
                },
              ]
            : []),
        ]
      : [],
    weekly: [],
  };
}

/**
 * Speicherbedarf aller Mandanten messen: je Mandant Dateien auflisten und eine Zeile schreiben.
 * Ein Fehler bei einem Mandanten bricht die übrigen nicht ab (idempotent, nächster Lauf holt nach).
 */
export async function measureTenantStorage(deps: {
  tenantIds: () => Promise<string[]>;
  usage: (tenantId: string) => Promise<{ bytes: number; count: number }>;
  record: (tenantId: string, usage: { bytes: number; count: number }) => Promise<void>;
  onError?: (tenantId: string, error: unknown) => void;
}): Promise<number> {
  let measured = 0;
  for (const tenantId of await deps.tenantIds()) {
    try {
      await deps.record(tenantId, await deps.usage(tenantId));
      measured += 1;
    } catch (error) {
      deps.onError?.(tenantId, error);
    }
  }
  return measured;
}
