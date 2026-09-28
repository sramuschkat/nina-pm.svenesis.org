/**
 * Matrix (`specs/engine/allocation.md` §4; SE `BuildMatrix` 244–398, Prioritätsreihenfolge nach
 * `TargetInstructionSet.cs` 1048–1053). Produktiv zusätzlich: Blockfixkosten im MinChunk (A-16),
 * erwartete Blockzahl, Vorbelegung vergangener Slots bei Neuplanung (§5.3, A-10/A-11).
 */
import { SLOT_S, type Matrix, type NightSetup, type Row, type UnitProfile } from './model';

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `StringComparer.OrdinalIgnoreCase` (Großbuchstaben, dann ordinal). */
const ordinalIgnoreCase = (a: string, b: string) => ordinal(a.toUpperCase(), b.toUpperCase());

/** Prioritätsreihenfolge (§4 `UserPriorityIndex`): Priorität ↑ (0 zuletzt), Projekt, Panel, Eingabe. */
export function priorityOrder(profiles: readonly UnitProfile[], fullTieBreaks: boolean): number[] {
  const prio = (p: UnitProfile) => (p.priority === 0 ? Number.MAX_SAFE_INTEGER : p.priority);
  return profiles
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        prio(a.p) - prio(b.p) ||
        (fullTieBreaks
          ? ordinal(a.p.projectId, b.p.projectId)
          : ordinalIgnoreCase(a.p.projectId, b.p.projectId)) ||
        (fullTieBreaks
          ? (a.p.panelIndex ?? -1) - (b.p.panelIndex ?? -1)
          : (a.p.panelPos ?? -1) - (b.p.panelPos ?? -1)) ||
        a.i - b.i,
    )
    .map((x) => x.i);
}

export function buildMatrix(setup: NightSetup): Matrix {
  const sw = setup.switches;
  const n = setup.slots;
  const moonDown = setup.moonDown;
  const past = setup.past;
  const startSlot = past?.startSlot ?? 0;
  const order = priorityOrder(setup.profiles, sw.fullTieBreaks);
  const assignment = new Array<number>(n).fill(-1);
  const locked = new Array<boolean>(n).fill(false);

  const rows: Row[] = setup.profiles.map((prof, r): Row => {
    // Neuplanung: Slots vor startAtS sind nicht mehr nutzbar (§5.3).
    const canImage = prof.canImage.map((ok, s) => ok && s >= startSlot);
    const tierWorkSec = [...prof.tierWorkSec];
    const tierCount = prof.tiers.length > 0 ? prof.tiers.length : 1;
    const tierSafe = (t: number, s: number) => prof.tierSafe[t]?.[s] === true;
    const tierMoonUpSafeSlots = Array.from({ length: tierCount }, (_, t) => {
      let count = 0;
      for (let s = 0; s < n; s++) if (canImage[s] && !moonDown[s] && tierSafe(t, s)) count++;
      return count;
    });
    let first = -1;
    let last = -1;
    let total = 0;
    let moonDownSlots = 0;
    let peak = 0;
    for (let s = 0; s < n; s++) {
      if (!canImage[s]) continue;
      if (first < 0) first = s;
      last = s;
      total++;
      if (moonDown[s]) moonDownSlots++;
      if (prof.peakAltDeg > peak) peak = prof.peakAltDeg;
    }
    let remaining = 0;
    for (const w of tierWorkSec) remaining += w;
    let minChunkSec = prof.minTimeSec;
    if (sw.blockFixCost) {
      if (remaining + prof.fixSec < minChunkSec) minChunkSec = remaining + prof.fixSec;
    } else if (remaining > 0 && remaining < minChunkSec) minChunkSec = remaining;
    const usable = canImage.map((ok, s) => {
      if (!ok) return false;
      for (let t = 0; t < tierWorkSec.length; t++) {
        if ((tierWorkSec[t] ?? 0) <= 0) continue;
        // Mosaik mit Masken je Panel: ein eigenes sichtbares Panel mit sicherer Restarbeit (A-19).
        if (prof.perPanel ? tierSafe(t, s) : t === 0 || moonDown[s] || tierSafe(t, s)) return true;
      }
      return false;
    });
    let mdUsable = 0;
    let muUsable = 0;
    for (let s = 0; s < n; s++) {
      if (!usable[s]) continue;
      if (moonDown[s]) mdUsable++;
      else muUsable++;
    }
    const userPriorityIndex = order.indexOf(r);
    return {
      index: r,
      profile: { ...prof, canImage },
      tierWorkSec,
      tierMoonUpSafeSlots,
      usable,
      firstUsableSlot: first,
      lastUsableSlot: last,
      totalUsableSlots: total,
      moonDownSlots,
      minChunkSec,
      minChunkSlots: Math.ceil(minChunkSec / SLOT_S),
      isConstrained: total * 300 < minChunkSec * 2,
      peakAltitude: peak,
      userPriorityIndex: userPriorityIndex < 0 ? r : userPriorityIndex,
      nBlocks: 1 + (mdUsable > 0 && muUsable > 0 ? 1 : 0),
      pastSlots: 0,
      preFiltered: false,
      hasLockedWindow: false,
      transitConflict: false,
    };
  });

  // Vergangene Slots der Einheit zurechnen (existing), gesperrt (§5.3).
  if (past) {
    const rowOf = new Map(rows.map((r) => [r.profile.unitId, r]));
    const pastCount = new Map<number, number>();
    for (let s = 0; s < past.startSlot; s++) {
      const row = rowOf.get(past.byUnit[s] ?? '');
      if (!row) continue;
      assignment[s] = row.index;
      locked[s] = true;
      pastCount.set(row.index, (pastCount.get(row.index) ?? 0) + 1);
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row) rows[i] = { ...row, pastSlots: pastCount.get(i) ?? 0 };
    }
  }

  let firstUsable = -1;
  let lastUsable = -1;
  for (let s = 0; s < n; s++)
    if (rows.some((r) => r.profile.canImage[s] === true)) {
      if (firstUsable < 0) firstUsable = s;
      lastUsable = s;
    }

  return {
    setup,
    slots: n,
    moonDown,
    rows,
    assignment,
    locked,
    hint: new Array<'any'>(n).fill('any'),
    firstUsableSlot: firstUsable,
    lastUsableSlot: lastUsable,
    priorityOrder: order,
  };
}
