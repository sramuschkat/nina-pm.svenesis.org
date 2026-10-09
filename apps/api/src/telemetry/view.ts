/**
 * Zeitreihen der Rig-Telemetrie fürs Web (AP-67, FA-RIG-17): Rohwerte bzw. Stundenwerte → Spalten je Messgröße.
 * Rein: keine Uhr, keine Datenbank – der Handler liefert Zeilen und `now`.
 *
 * Mehr als `TELEMETRY_MAX_POINTS` Punkte werden in Zeitfenster verdichtet (Fensterbeginn als Zeitpunkt, Mittel nach
 * Anzahl gewichtet, Minimum des Minimums, Maximum des Maximums).
 */
import {
  heartbeatStates,
  nina,
  RigLive,
  TELEMETRY_MAX_POINTS,
  type TelemetrySeries,
} from '@nina-pm/shared';
import type { TelemetryStat } from '@nina-pm/db';

export interface StatPoint {
  readonly t: number;
  readonly stats: Readonly<Record<string, TelemetryStat>>;
}

const isoUtc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Rohwert als Punkt (je Messgröße n = 1). */
export function rawPoint(atUtc: Date, metrics: Readonly<Record<string, number>>): StatPoint {
  const stats: Record<string, TelemetryStat> = {};
  for (const [k, v] of Object.entries(metrics))
    if (typeof v === 'number' && Number.isFinite(v)) stats[k] = { min: v, avg: v, max: v, n: 1 };
  return { t: atUtc.getTime(), stats };
}

/** Punkte in Fenster von `stepMs` zusammenfassen (Fensterbeginn auf Vielfache von `stepMs` ab 1970). */
export function bucket(points: readonly StatPoint[], stepMs: number): StatPoint[] {
  const out = new Map<number, Map<string, { min: number; sum: number; max: number; n: number }>>();
  for (const p of points) {
    const t = Math.floor(p.t / stepMs) * stepMs;
    let b = out.get(t);
    if (!b) out.set(t, (b = new Map()));
    for (const [k, s] of Object.entries(p.stats)) {
      const a = b.get(k);
      if (a) {
        a.min = Math.min(a.min, s.min);
        a.max = Math.max(a.max, s.max);
        a.sum += s.avg * s.n;
        a.n += s.n;
      } else b.set(k, { min: s.min, sum: s.avg * s.n, max: s.max, n: s.n });
    }
  }
  return [...out.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({
      t,
      stats: Object.fromEntries(
        [...b.entries()].map(([k, a]) => [k, { min: a.min, avg: a.sum / a.n, max: a.max, n: a.n }]),
      ),
    }));
}

/** Fensterbreite, damit höchstens `TELEMETRY_MAX_POINTS` Punkte bleiben (Vielfaches von `unitMs`). */
export function stepFor(rangeMs: number, unitMs: number): number {
  return Math.max(unitMs, Math.ceil(rangeMs / TELEMETRY_MAX_POINTS / unitMs) * unitMs);
}

/** Spalten je Messgröße in der Reihenfolge von `TELEMETRY_METRICS`; Messgrößen ohne jeden Wert entfallen. */
export function seriesOf(
  source: nina.TelemetrySource,
  resolution: TelemetrySeries['resolution'],
  stepS: number,
  points: readonly StatPoint[],
  latest: { atUtc: Date; metrics: Record<string, number> } | null,
): TelemetrySeries {
  const series: TelemetrySeries['series'] = {};
  for (const key of Object.keys(nina.TELEMETRY_METRICS[source])) {
    if (!points.some((p) => p.stats[key])) continue;
    series[key] = {
      avg: points.map((p) => (p.stats[key] ? round(p.stats[key].avg) : null)),
      min: points.map((p) => (p.stats[key] ? round(p.stats[key].min) : null)),
      max: points.map((p) => (p.stats[key] ? round(p.stats[key].max) : null)),
    };
  }
  return {
    source,
    resolution,
    stepS,
    t: points.map((p) => isoUtc(p.t)),
    series,
    latest: latest ? { atUtc: isoUtc(latest.atUtc.getTime()), values: latest.metrics } : null,
  };
}

/** Eine NINA-Instanz mit ihrem zuletzt gespeicherten Heartbeat (`nina_instance.last_state`, jsonb – in PGlite als Text). */
export interface InstanceState {
  readonly id: string;
  readonly name: string;
  readonly lastState: unknown;
}

interface LastState {
  receivedAtUtc?: string;
  state?: string;
  pluginVersion?: string;
  camera?: unknown;
  filterWheel?: unknown;
  devices?: unknown;
  optics?: { focalLengthMm?: number | null; pixelSizeUm?: number | null } | null;
}

/**
 * „Rig jetzt“ (AP-70, FA-RIG-19): der jüngste Heartbeat unter den Instanzen des Rigs. Instanzen ohne Heartbeat (z. B. die
 * Telemetrie-Instanz, die nur Messwerte hochlädt) zählen nicht; ohne Heartbeat `null`. Felder, die ein älteres Plugin nicht
 * meldet, sind `null`.
 */
export function rigLive(instances: readonly InstanceState[]): RigLive | null {
  let best: { inst: InstanceState; st: LastState; at: number } | null = null;
  for (const inst of instances) {
    const raw =
      typeof inst.lastState === 'string' ? (JSON.parse(inst.lastState) as unknown) : inst.lastState;
    if (!raw || typeof raw !== 'object') continue;
    const st = raw as LastState;
    const at = st.receivedAtUtc ? Date.parse(st.receivedAtUtc) : NaN;
    if (!Number.isFinite(at)) continue;
    if (!best || at > best.at) best = { inst, st, at };
  }
  if (!best) return null;
  const { inst, st } = best;
  return RigLive.parse({
    instanceId: inst.id,
    instanceName: inst.name,
    receivedAtUtc: st.receivedAtUtc,
    state: (heartbeatStates as readonly string[]).includes(st.state ?? '') ? st.state : null,
    pluginVersion: st.pluginVersion ?? null,
    camera: st.camera ?? null,
    filterWheel: st.filterWheel ?? null,
    devices: st.devices ?? null,
    optics: st.optics ?? null,
    pixelScaleArcsecPx: pixelScale(st.optics),
  });
}

/** ″/px mit drei Nachkommastellen wie `imageScale` (geometry.md §1). */
function pixelScale(o: LastState['optics']): number | null {
  const f = o?.focalLengthMm;
  const px = o?.pixelSizeUm;
  if (!f || !px || f <= 0 || px <= 0) return null;
  return Math.round(((206.265 * px) / f) * 1000) / 1000;
}
