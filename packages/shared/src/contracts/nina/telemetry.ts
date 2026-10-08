/**
 * `POST /nina/v1/telemetry` (AP-67, FA-RIG-15): Messpunkte der Rig-Skripte (Mini-PC über Core Temp, Powerbox über
 * Pegasus Unity) mit dem Token einer NINA-Instanz – Mandant und Rig kommen aus dem Token. ≤ 1.000 Messpunkte je
 * Anfrage (mehr → `413 telemetry.batch_too_large`); idempotent über (Rig, Quelle, Zeitpunkt). Messpunkte älter als
 * 7 Tage oder mehr als 5 min in der Zukunft zählen als `skipped` und blockieren den Rest nicht.
 */
import { z } from 'zod';
import { telemetrySources } from '../../generated/enums';
import { UtcInstant } from './common';

export const TELEMETRY_BATCH_MAX = 1000;
/** Ältester angenommener Messpunkt (die Skripte puffern 12 h; Reserve für längere Ausfälle). */
export const TELEMETRY_MAX_AGE_MS = 7 * 24 * 3600_000;
/** Uhrabweichung des Rig-PCs, die noch angenommen wird. */
export const TELEMETRY_MAX_FUTURE_MS = 5 * 60_000;

/** Messgrößen je Quelle mit Einheit und zulässigem Bereich (unbekannte Messgröße oder Wert außerhalb → `422`). */
export const TELEMETRY_METRICS = {
  pc: {
    cpuMaxC: { unit: '°C', min: -40, max: 150 },
    cpuAvgC: { unit: '°C', min: -40, max: 150 },
    loadPct: { unit: '%', min: 0, max: 100 },
    diskC: { unit: '°C', min: -40, max: 150 },
  },
  power_box: {
    airC: { unit: '°C', min: -60, max: 70 },
    dewPointC: { unit: '°C', min: -80, max: 60 },
    humidityPct: { unit: '%', min: 0, max: 100 },
    voltageV: { unit: 'V', min: 0, max: 30 },
    currentA: { unit: 'A', min: 0, max: 50 },
    dewHeater1Pct: { unit: '%', min: 0, max: 100 },
    dewHeater2Pct: { unit: '%', min: 0, max: 100 },
  },
} as const satisfies Record<
  (typeof telemetrySources)[number],
  Record<string, { unit: string; min: number; max: number }>
>;

export type TelemetrySource = keyof typeof TELEMETRY_METRICS;
export type TelemetryMetric<S extends TelemetrySource = TelemetrySource> =
  keyof (typeof TELEMETRY_METRICS)[S] & string;

/**
 * Messpunkt: Werte als Messgröße → Zahl. Welche Messgrößen erlaubt sind und in welchem Bereich, prüft der Stapel je
 * Quelle (`TELEMETRY_METRICS`) – im Schema bewusst ein einfaches Objekt, damit OpenAPI und der C#-Client des Plugins
 * keinen `oneOf` brauchen. Fehlt ein Wert, fehlt er (nie 0).
 */
export const NinaTelemetrySample = z
  .strictObject({
    atUtc: UtcInstant,
    values: z.record(z.string().max(32), z.number()),
  })
  .meta({ id: 'NinaTelemetrySample' });

export const NinaTelemetryBatch = z
  .strictObject({
    source: z.enum(telemetrySources),
    samples: z.array(NinaTelemetrySample).min(1).max(TELEMETRY_BATCH_MAX),
  })
  .superRefine((b, ctx) => {
    const metrics: Record<string, { min: number; max: number }> = TELEMETRY_METRICS[b.source];
    b.samples.forEach((s, i) => {
      const entries = Object.entries(s.values);
      if (entries.length === 0)
        ctx.addIssue({
          code: 'custom',
          path: ['samples', i, 'values'],
          message: 'mindestens ein Wert',
        });
      for (const [k, v] of entries) {
        const m = metrics[k];
        if (!m)
          ctx.addIssue({
            code: 'custom',
            path: ['samples', i, 'values', k],
            message: 'unbekannte Messgröße',
          });
        else if (!Number.isFinite(v) || v < m.min || v > m.max)
          ctx.addIssue({
            code: 'custom',
            path: ['samples', i, 'values', k],
            message: `außerhalb ${String(m.min)} … ${String(m.max)}`,
          });
      }
    });
  })
  .meta({ id: 'NinaTelemetryBatch' });
export type NinaTelemetryBatch = z.infer<typeof NinaTelemetryBatch>;

export const NinaTelemetryResults = z
  .object({
    accepted: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .meta({ id: 'NinaTelemetryResults' });
export type NinaTelemetryResults = z.infer<typeof NinaTelemetryResults>;
