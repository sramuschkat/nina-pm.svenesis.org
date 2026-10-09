/**
 * Vorgeschlagene Filter-Offsets (AP-72, FA-RIG-20): Autofokus-Läufe der letzten Nächte → `focusOffsets` (gemeinsame
 * Temperatursteigung), zugeordnet zu den Plätzen und Web-Filtern des Rigs und zu den Offsets, die NINA meldet.
 */
import { FOCUS_MIN_RUNS, focusOffsets, type FocusOffsetsView } from '@nina-pm/shared';
import { FOCUS_RUN_NIGHTS, type FocusRunRow } from '@nina-pm/db';

const dayMs = 86_400_000;

/** Was die Rechnung von der Filterradbelegung braucht (`EquipmentRepository.filterWheel`). */
export interface WheelInfo {
  readonly slots: readonly {
    position: number;
    filterId: string | null;
    ninaFilterName: string | null;
    reportedName: string | null;
  }[];
  readonly reported: {
    slots: readonly { position: number; name: string; focusOffset: number | null }[];
  } | null;
}

export function focusOffsetsView(
  rigId: string,
  toNight: string,
  runs: readonly FocusRunRow[],
  wheel: WheelInfo,
  filters: readonly { id: string; shortName: string }[],
): FocusOffsetsView {
  const shortOf = new Map(filters.map((f) => [f.id, f.shortName]));
  // NINA-Name → Platz und Web-Kurzname (bestätigte Zuordnung, sonst die Meldung des Plugins).
  const slotOf = new Map<string, { position: number; shortName: string | null }>();
  for (const s of wheel.slots) {
    const name = s.ninaFilterName ?? s.reportedName;
    if (name)
      slotOf.set(name, {
        position: s.position,
        shortName: s.filterId ? (shortOf.get(s.filterId) ?? null) : null,
      });
  }
  const ninaOffset = new Map((wheel.reported?.slots ?? []).map((s) => [s.name, s.focusOffset]));
  for (const s of wheel.reported?.slots ?? [])
    if (!slotOf.has(s.name)) slotOf.set(s.name, { position: s.position, shortName: null });
  const luminance =
    [...slotOf.entries()].find(([, v]) => v.shortName?.toUpperCase() === 'L')?.[0] ?? null;
  const result = focusOffsets(runs, luminance);
  const lastRun = new Map<string, string>();
  for (const r of runs) lastRun.set(r.filter, r.occurredAt);
  const reported = wheel.reported?.slots ?? [];
  return {
    rigId,
    fromNight: new Date(Date.parse(`${toNight}T00:00:00Z`) - (FOCUS_RUN_NIGHTS - 1) * dayMs)
      .toISOString()
      .slice(0, 10),
    toNight,
    minRuns: FOCUS_MIN_RUNS,
    totalRuns: result.totalRuns,
    reference: result.reference,
    slopePerC: result.slopePerC,
    referenceTemperatureC: result.referenceTemperatureC,
    ninaWithoutOffsets: reported.length > 1 && reported.every((s) => (s.focusOffset ?? 0) === 0),
    filters: result.filters
      .map((f) => ({
        filter: f.filter,
        shortName: slotOf.get(f.filter)?.shortName ?? null,
        position: slotOf.get(f.filter)?.position ?? null,
        runs: f.runs,
        positionAtRef: f.positionAtRef,
        offset: f.offset,
        scatter: f.scatter,
        ninaOffset: ninaOffset.get(f.filter) ?? null,
        lastRunAt: lastRun.get(f.filter) ?? null,
      }))
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || a.filter.localeCompare(b.filter)),
  };
}
