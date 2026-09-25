/**
 * Anwendungsmetriken der Lambdas als EMF-Zeilen (TK 16.1): direkt auf stdout, nicht über den Logger
 * (der sie einpacken würde). Dimension `service` = Funktionsname der Lambda.
 */
import { observeTxRetries } from '@nina-pm/db';
import { APP_METRICS, emfLine } from '@nina-pm/shared';

export function writeMetric(service: string, name: string, value: number, now = Date.now()) {
  process.stdout.write(`${emfLine(service, now, [{ name, value }])}\n`);
}

/** `DsqlRetries` je OCC-Wiederholung (Alarm `nina-pm-dsql-retries`, > 20 in 5 min). */
export function emitDsqlRetries(service: string) {
  observeTxRetries(() => writeMetric(service, APP_METRICS.dsqlRetries, 1));
}
