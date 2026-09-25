/**
 * Anwendungsmetriken im CloudWatch Embedded Metric Format (TK 16.1/16.2): eine JSON-Logzeile je Messung,
 * Namespace `NinaPm`, Dimension `service` = Funktionsname der Lambda. Die Alarme im Ops-Stack lesen genau
 * diese Metriken (z. B. `StaleRunningSessions`, CC-16). Reine Funktion – der Aufrufer schreibt die Zeile.
 */
export const METRIC_NAMESPACE = 'NinaPm';

export const APP_METRICS = {
  /** Laufende Sessions ohne Heartbeat > 10 min bei `offline_since IS NULL` (Pflichtalarm > 0). */
  staleRunningSessions: 'StaleRunningSessions',
  /** OCC-Wiederholungen in `withTx` (Alarm > 20 in 5 min über `api` und `worker`). */
  dsqlRetries: 'DsqlRetries',
} as const;

export interface EmfMetric {
  readonly name: string;
  readonly value: number;
  readonly unit?: 'Count' | 'Milliseconds' | 'None';
}

export function emfLine(
  service: string,
  timestampMs: number,
  metrics: readonly EmfMetric[],
): string {
  const doc: Record<string, unknown> = {
    _aws: {
      Timestamp: timestampMs,
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [['service']],
          Metrics: metrics.map((m) => ({ Name: m.name, Unit: m.unit ?? 'Count' })),
        },
      ],
    },
    service,
  };
  for (const m of metrics) doc[m.name] = m.value;
  return JSON.stringify(doc);
}
