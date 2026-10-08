/**
 * Rig-Telemetrie im Web (AP-67, FA-RIG-17, S-43): `GET /web/v1/rigs/{id}/telemetry?from=&to=` liefert je Quelle die
 * Zeitreihen spaltenweise. Bis 3 Tage und innerhalb der 90 Tage Rohwerte kommen die Rohwerte (auf höchstens
 * `TELEMETRY_MAX_POINTS` Punkte je Reihe verdichtet), sonst die Stundenwerte. Messgrößen und Einheiten:
 * `nina.TELEMETRY_METRICS`.
 */
import { z } from 'zod';
import { telemetrySources } from '../generated/enums';
import { UtcInstant, Uuid } from './common';

/** Rohwerte bleiben 90 Tage, danach nur Stundenwerte (Entscheidung Sven 08.10.2026). */
export const TELEMETRY_RAW_RETENTION_DAYS = 90;
/** Bis zu dieser Spanne liest das Web die Rohwerte. */
export const TELEMETRY_RAW_RANGE_DAYS = 3;
/** Längster Zeitraum einer Abfrage. */
export const TELEMETRY_MAX_RANGE_DAYS = 400;
/** Höchstens so viele Punkte je Reihe (darüber werden Rohwerte in Zeitfenster verdichtet). */
export const TELEMETRY_MAX_POINTS = 1500;

export const TelemetryQuery = z.object({ from: UtcInstant, to: UtcInstant });

const Column = z.array(z.number().nullable());

export const TelemetrySeries = z
  .object({
    source: z.enum(telemetrySources),
    /** `raw`: aus den Rohwerten (ggf. in Fenster von `stepS` verdichtet); `hourly`: aus den Stundenwerten. */
    resolution: z.enum(['raw', 'hourly']),
    /** Abstand der Punkte in Sekunden; bei unverdichteten Rohwerten der Messtakt der Quelle (0 = unregelmäßig). */
    stepS: z.number().int().min(0),
    /** Zeitpunkt je Punkt (Fensterbeginn bei verdichteten Werten). */
    t: z.array(UtcInstant),
    /** Je Messgröße Mittel, Minimum und Maximum je Punkt; `null` = kein Wert in diesem Punkt. */
    series: z.record(z.string(), z.object({ avg: Column, min: Column, max: Column })),
    /** Jüngster Messpunkt der Quelle überhaupt (auch außerhalb des Zeitraums); `null` = nie empfangen. */
    latest: z.object({ atUtc: UtcInstant, values: z.record(z.string(), z.number()) }).nullable(),
  })
  .meta({ id: 'TelemetrySeries' });
export type TelemetrySeries = z.infer<typeof TelemetrySeries>;

export const TelemetryView = z
  .object({
    rigId: Uuid,
    from: UtcInstant,
    to: UtcInstant,
    sources: z.array(TelemetrySeries),
  })
  .meta({ id: 'TelemetryView' });
export type TelemetryView = z.infer<typeof TelemetryView>;
