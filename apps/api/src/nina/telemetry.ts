/**
 * Rig-Telemetrie der Skripte am Rig (AP-67, FA-RIG-15): `POST /nina/v1/telemetry`. Mandant und Rig kommen aus dem
 * Token der NINA-Instanz. Messpunkte älter als 7 Tage oder mehr als 5 min in der Zukunft zählen als `skipped` – ein
 * alter Puffer blockiert die neueren Werte nicht.
 */
import { nina } from '@nina-pm/shared';
import type { NinaPrincipal } from '@nina-pm/db';
import type { ApiServices } from '../routes/services';

export async function ingestTelemetry(
  svc: ApiServices,
  p: NinaPrincipal,
  body: nina.NinaTelemetryBatch,
): Promise<nina.NinaTelemetryResults> {
  const now = svc.now();
  const oldest = now.getTime() - nina.TELEMETRY_MAX_AGE_MS;
  const newest = now.getTime() + nina.TELEMETRY_MAX_FUTURE_MS;
  // Doppelte Zeitpunkte in einem Stapel: der erste zählt (ON CONFLICT würde sonst innerhalb der Anweisung scheitern).
  const seen = new Set<number>();
  const samples: { atUtc: Date; metrics: Record<string, number> }[] = [];
  let skipped = 0;
  let duplicateInBatch = 0;
  for (const s of body.samples) {
    const t = Date.parse(s.atUtc);
    if (t < oldest || t > newest) {
      skipped += 1;
      continue;
    }
    if (seen.has(t)) {
      duplicateInBatch += 1;
      continue;
    }
    seen.add(t);
    samples.push({ atUtc: new Date(t), metrics: s.values });
  }
  const r = await svc
    .repositories({ tenantId: p.tenantId })
    .telemetry()
    .ingest(p.rigId, body.source, samples, now);
  return { accepted: r.accepted, duplicate: r.duplicate + duplicateInBatch, skipped };
}
