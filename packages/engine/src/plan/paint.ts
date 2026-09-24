/**
 * Zuteilung der Nacht auf Einheiten (`specs/engine/allocation.md` §5–7). Portiert aus dem
 * Astro-PM-NINA-Plugin (MIT, Commit 5dd621d, `Models/ScheduleEngine.cs`: PaintSlots 663–1001,
 * PaintSlotsGreedy 542–661, PreClaimFixedWindows 496–540, PaintPassFairShare 1069–1178,
 * EnforceMinimumAllocations 1180–1285, PruneSlivers 1287–1375, PaintChunks 1377–1433,
 * DefragmentSlots 1003–1067, DecrementWork 1455–1480). Die Abweichungen aus §10 hängen an den
 * Schaltern `CompatSwitches`; im Kompatibilitätsmodus verhält sich der Code wie das Original.
 */
import {
  rowHasLaWork,
  rowHasNonLaWork,
  rowLaWork,
  rowNonLaWork,
  rowTotalWork,
  SLOT_S,
  type Hint,
  type Matrix,
  type Row,
} from './model';
import { applySortChain, moonDownChain, sortGroups } from './sort-chain';
import type { SortChainKey } from './grid';

type Eligible = (row: Row, s: number) => boolean;

// ─── Hilfen ───────────────────────────────────────────────────────────────────────────────────────

function canImage(m: Matrix, r: Row | number, s: number): boolean {
  const row = typeof r === 'number' ? m.rows[r] : r;
  return row?.profile.canImage[s] === true;
}

/** Produktiv `UsableSlot` (A-6), Kompatibilität `CanImage`. */
function imageable(m: Matrix, row: Row, s: number): boolean {
  return m.setup.switches.usableSlotPasses ? row.usable[s] === true : canImage(m, row, s);
}

function assignedCount(m: Matrix, ri: number): number {
  let n = 0;
  for (const a of m.assignment) if (a === ri) n++;
  return n;
}

function runsOf(m: Matrix, ri: number): { start: number; length: number }[] {
  const runs: { start: number; length: number }[] = [];
  let start = -1;
  for (let s = 0; s <= m.slots; s++) {
    const match = s < m.slots && m.assignment[s] === ri;
    if (match && start < 0) start = s;
    else if (!match && start >= 0) {
      runs.push({ start, length: s - start });
      start = -1;
    }
  }
  return runs;
}

function zeroWork(row: Row): void {
  for (let t = 0; t < row.tierWorkSec.length; t++) row.tierWorkSec[t] = 0;
}

/** §7.7: `la` restriktivste Stufe zuerst, `nonLa` Stufe 0 zuerst, `any` proportional. */
export function decrementWork(row: Row, secIn: number, hint: Hint): void {
  const w = row.tierWorkSec;
  let sec = secIn;
  if (w.length === 0 || sec <= 0) return;
  if (hint === 'la') {
    for (let t = w.length - 1; t >= 0 && sec > 0; t--) {
      const use = Math.min(sec, w[t] ?? 0);
      w[t] = (w[t] ?? 0) - use;
      sec -= use;
    }
  } else if (hint === 'nonLa') {
    for (let t = 0; t < w.length && sec > 0; t++) {
      const use = Math.min(sec, w[t] ?? 0);
      w[t] = (w[t] ?? 0) - use;
      sec -= use;
    }
  } else {
    let total = 0;
    for (const x of w) total += x;
    if (total <= 0) return;
    const frac = Math.min(1.0, sec / total);
    for (let t = 0; t < w.length; t++) w[t] = (w[t] ?? 0) - (w[t] ?? 0) * frac;
  }
}

/** Mond-oben-Slots, in denen die Einheit Arbeit hat (SE 1486). */
function moonUpUsableSlotCount(m: Matrix, row: Row): number {
  let n = 0;
  for (let s = 0; s < m.slots; s++) if (!m.moonDown[s] && row.usable[s]) n++;
  return n;
}

/** §7.8: Arbeit, die heute nur bei Mond unten geht (SE 1499). */
function moonDownOnlyWorkSec(m: Matrix, row: Row): number {
  const tiers = row.profile.tiers;
  let hasMoonUp = false;
  for (let s = 0; s < m.slots && !hasMoonUp; s++)
    if (!m.moonDown[s] && canImage(m, row, s)) hasMoonUp = true;
  let sec = 0;
  for (let t = 1; t < row.tierWorkSec.length; t++) {
    const w = row.tierWorkSec[t] ?? 0;
    if (w <= 0) continue;
    const requiresMd = tiers[t]?.requiresMoonDown === true;
    const unsafeAllMoonUp = hasMoonUp && (row.tierMoonUpSafeSlots[t] ?? 0) === 0;
    if (requiresMd || unsafeAllMoonUp) sec += w;
  }
  return sec;
}

function hasUnpaintedSlots(m: Matrix, row: Row, moonDownOnly: boolean): boolean {
  for (let s = 0; s < m.slots; s++) {
    if (m.assignment[s] !== -1) continue;
    if (!canImage(m, row, s)) continue;
    if (moonDownOnly && !m.moonDown[s]) continue;
    return true;
  }
  return false;
}

function hasMoonSafeMoonUpSlots(m: Matrix, row: Row): boolean {
  for (let s = 0; s < m.slots; s++) if (!m.moonDown[s] && row.usable[s]) return true;
  return false;
}

// ─── Transit-Vorabbelegung (§7.1) ────────────────────────────────────────────────────────────────

function preClaimTransits(m: Matrix): void {
  const sw = m.setup.switches;
  const transitRows = m.rows.filter((r) => r.profile.transit !== null);
  // Produktiv nach `locked_at` (A-20), Kompatibilität Matrix-Reihenfolge (SE 508).
  if (sw.transitByLockedAt)
    transitRows.sort(
      (a, b) =>
        (a.profile.transit?.lockedAtS ?? 0) - (b.profile.transit?.lockedAtS ?? 0) ||
        a.index - b.index,
    );
  const lockedByTransit = (s: number) =>
    m.locked[s] === true && m.rows[m.assignment[s] ?? -1]?.profile.transit != null;
  for (const row of transitRows) {
    const t = row.profile.transit;
    if (!t) continue;
    const claim: number[] = [];
    let conflict = false;
    for (let s = 0; s < m.slots; s++) {
      const mid = s * SLOT_S + SLOT_S / 2;
      if (mid < t.startS) continue;
      if (mid >= t.endS) break;
      // Produktiv: jedes Überlappen mit einem schon gesperrten Transit ist ein Konflikt (A-20, ENG-14).
      if (sw.transitByLockedAt && lockedByTransit(s)) conflict = true;
      if (!canImage(m, row, s)) continue;
      if (m.assignment[s] !== -1) continue; // Kompatibilität: früheres Fenster gewinnt den Slot
      claim.push(s);
    }
    // Produktiv: Slew-/Zentrier-Vorlauf vor dem ersten gesperrten Slot mitsperren (NT-25).
    const lead: number[] = [];
    const first = claim[0];
    if (sw.transitByLockedAt && first !== undefined) {
      const seriesStart = Math.max(t.startS, first * SLOT_S);
      const from = seriesStart - m.setup.slewCenterS - 60;
      for (let s = 0; s < first; s++) {
        const a = s * SLOT_S;
        if (a + SLOT_S <= from || a >= seriesStart) continue;
        if (m.assignment[s] !== -1) {
          if (lockedByTransit(s)) conflict = true;
          continue;
        }
        lead.push(s);
      }
    }
    zeroWork(row);
    row.preFiltered = true;
    if (conflict) {
      row.transitConflict = true;
      continue;
    }
    for (const s of [...lead, ...claim]) {
      m.assignment[s] = row.index;
      m.locked[s] = true;
      m.hint[s] = 'any';
    }
    if (claim.length > 0) row.hasLockedWindow = true;
  }
}

// ─── Vorfilter ────────────────────────────────────────────────────────────────────────────────────

/**
 * Produktiv enthält MinChunk die Blockfixkosten (A-16); damit ein Restposten (`MinChunk = work + fix`)
 * nicht am eigenen `fix` scheitert, zählt `fix` zur erreichbaren Zeit, sobald Arbeit erreichbar ist.
 */
function prefilterFix(m: Matrix, row: Row, accessible: number): number {
  return m.setup.switches.blockFixCost && accessible > 0 ? row.profile.fixSec : 0;
}

/** Proportional (§5): erreichbare Arbeit < MinChunk → vorgefiltert (MoonSafe ≡ wahr). */
function prefilterProportional(m: Matrix): void {
  for (const row of m.rows) {
    let safeSlots = 0;
    const unsafeSlots = 0;
    for (let s = 0; s < m.slots; s++) if (canImage(m, row, s)) safeSlots++;
    const laInSafe = Math.min(rowLaWork(row), safeSlots * 300.0);
    const safeRemaining = Math.max(0, safeSlots * 300.0 - laInSafe);
    const nonLaInSafe = Math.min(rowNonLaWork(row), safeRemaining);
    const nonLaLeft = rowNonLaWork(row) - nonLaInSafe;
    const accessible = laInSafe + nonLaInSafe + Math.min(nonLaLeft, unsafeSlots * 300.0);
    if (accessible + prefilterFix(m, row, accessible) < row.minChunkSec) {
      zeroWork(row);
      row.preFiltered = true;
    }
  }
}

/** Manuelle Priorität (§6): stufenbewusst. */
function prefilterGreedy(m: Matrix): void {
  for (const row of m.rows) {
    let accessible = 0;
    for (let t = 0; t < row.tierWorkSec.length; t++) {
      let safe = 0;
      for (let s = 0; s < m.slots; s++) {
        if (!canImage(m, row, s)) continue;
        if (t === 0 || m.moonDown[s] || row.profile.tierSafe[t]?.[s] === true) safe++;
      }
      accessible += Math.min(row.tierWorkSec[t] ?? 0, safe * 300.0);
    }
    if (accessible + prefilterFix(m, row, accessible) < row.minChunkSec) {
      zeroWork(row);
      row.preFiltered = true;
    }
  }
}

// ─── paintChunks (§7.2) ───────────────────────────────────────────────────────────────────────────

function paintChunks(
  m: Matrix,
  row: Row,
  filter: (s: number) => boolean,
  hint: Hint,
  maxWorkSec: number,
): void {
  const ri = row.index;
  const quantized = m.setup.switches.quantizedBudgets;
  const runs: { start: number; length: number }[] = [];
  let start = -1;
  for (let s = 0; s < m.slots; s++) {
    if (filter(s)) {
      if (start < 0) start = s;
    } else if (start >= 0) {
      runs.push({ start, length: s - start });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, length: m.slots - start });
  const adjacent = (r: { start: number; length: number }) =>
    (r.start > 0 && m.assignment[r.start - 1] === ri) ||
    (r.start + r.length < m.slots && m.assignment[r.start + r.length] === ri);
  const adj = new Map(runs.map((r) => [r.start, adjacent(r)]));
  // Angrenzend zuerst, dann länger, dann früherer Start (A-9; Orakel-Patch Punkt 5).
  runs.sort((a, b) => {
    const aa = adj.get(a.start) === true;
    const ba = adj.get(b.start) === true;
    if (aa !== ba) return aa ? -1 : 1;
    return b.length - a.length || a.start - b.start;
  });

  let budget = maxWorkSec;
  for (const run of runs) {
    if (budget <= 0) break;
    if (!adjacent(run) && run.length < row.minChunkSlots) {
      if (assignedCount(m, ri) >= row.minChunkSlots) continue;
    }
    let slots: number;
    if (quantized) {
      // Budget ist ein Vielfaches von 300 s (A-27).
      slots = Math.min(run.length, Math.floor(budget / SLOT_S));
    } else {
      slots = Math.min(run.length, Math.ceil(budget / 300.0));
      if (
        slots < row.minChunkSlots &&
        run.length >= row.minChunkSlots &&
        maxWorkSec >= row.minChunkSec &&
        budget >= row.minChunkSec
      )
        slots = row.minChunkSlots;
    }
    for (let i = 0; i < slots && i < run.length; i++) {
      m.assignment[run.start + i] = ri;
      m.hint[run.start + i] = hint;
    }
    const painted = slots * 300.0;
    budget -= painted;
    decrementWork(row, painted, hint);
  }
}

// ─── fairShare (§5.1, §5.2) ───────────────────────────────────────────────────────────────────────

interface Unit {
  /** Mitglieder (Panel-Einheiten eines Projekts bei A-15, sonst eine Zeile). */
  readonly rows: readonly Row[];
}

/** Original: Budgets als Bruchzahlen (SE 1069–1178). */
function fairShareCompat(
  m: Matrix,
  sorted: readonly Row[],
  eligible: Eligible,
  hint: Hint,
  demandOf: (r: Row) => number,
): void {
  if (sorted.length === 0) return;
  const unique = new Set<number>();
  for (const row of sorted) for (let s = 0; s < m.slots; s++) if (eligible(row, s)) unique.add(s);
  const supply = unique.size * 300.0;
  if (supply <= 0) return;
  let totalDemand = 0;
  const demands = sorted.map((r) => {
    const d = Math.max(0, demandOf(r));
    totalDemand += d;
    return d;
  });
  if (totalDemand <= 0) return;
  const mins = sorted.map((r, i) =>
    assignedCount(m, r.index) >= r.minChunkSlots ? 0 : Math.min(r.minChunkSec, demands[i] ?? 0),
  );
  const budgets = new Array<number>(sorted.length).fill(0);
  const d = (i: number) => demands[i] ?? 0;
  const mn = (i: number) => mins[i] ?? 0;
  if (totalDemand <= supply) {
    for (let i = 0; i < sorted.length; i++) budgets[i] = d(i);
  } else {
    let totalMin = 0;
    for (const x of mins) totalMin += x;
    if (totalMin <= supply) {
      const excess = supply - totalMin;
      let excessDemand = 0;
      for (let i = 0; i < sorted.length; i++) excessDemand += Math.max(0, d(i) - mn(i));
      for (let i = 0; i < sorted.length; i++) {
        const extra = excessDemand > 0 ? (excess * Math.max(0, d(i) - mn(i))) / excessDemand : 0;
        budgets[i] = Math.min(d(i), mn(i) + extra);
      }
    } else {
      let remaining = supply;
      const selected: number[] = [];
      for (let i = 0; i < sorted.length; i++)
        if (remaining >= mn(i)) {
          selected.push(i);
          remaining -= mn(i);
        }
      if (selected.length === 0) {
        selected.push(0);
        remaining = Math.max(0, supply - mn(0));
      }
      let excessDemand = 0;
      for (const i of selected) excessDemand += Math.max(0, d(i) - mn(i));
      for (const i of selected) {
        const extra =
          excessDemand > 0 && remaining > 0
            ? (remaining * Math.max(0, d(i) - mn(i))) / excessDemand
            : 0;
        budgets[i] = Math.min(d(i), mn(i) + Math.max(0, extra));
      }
    }
  }
  sorted.forEach((row, i) => {
    const b = budgets[i] ?? 0;
    if (b <= 0) return;
    paintChunks(m, row, (s) => eligible(row, s), hint, b);
  });
}

/** Vergangene (gesperrte) Slots einer Zeile (§5.3). */
function pastSlotsOf(m: Matrix, ri: number): number {
  const past = m.setup.past;
  if (!past) return 0;
  let n = 0;
  for (let s = 0; s < past.startSlot; s++) if (m.assignment[s] === ri) n++;
  return n;
}

/** Vergangene Slots einer Einheit im selben Mond-Bereich (A-10). */
function pastIn(m: Matrix, rows: readonly Row[], moonDownSide: boolean | null): number {
  const past = m.setup.past;
  if (!past || !m.setup.switches.nightFairness) return 0;
  const ids = new Set(rows.map((r) => r.profile.unitId));
  let n = 0;
  for (let s = 0; s < past.startSlot; s++) {
    const u = past.byUnit[s];
    if (u === null || u === undefined || !ids.has(u)) continue;
    if (moonDownSide !== null && m.moonDown[s] !== moonDownSide) continue;
    n++;
  }
  return n * SLOT_S;
}

/** Bedarf inkl. Blockfixkosten für noch nicht angelegte Blöcke (A-16, Auslegung siehe PR AP-13b). */
function withFix(m: Matrix, row: Row, demand: number): number {
  if (demand <= 0 || !m.setup.switches.blockFixCost) return demand;
  const open = Math.max(0, row.nBlocks - runsOf(m, row.index).length);
  return demand + open * row.profile.fixSec;
}

/**
 * Produktiv (§5.1 mit §5.2): Gruppen je Projekt (A-15), Nachtfairness (A-10), Normierung,
 * Restangebot-Runde und Quantisierung (A-27); gemalt wird je Einheit mit ganzen Slots.
 */
export interface BudgetInput {
  /** Bedarf je Einheit/Gruppe in s (inkl. `fix`, ohne Vergangenes). */
  readonly demand: readonly number[];
  /** Vergangene Sekunden im selben Mond-Bereich (A-10). */
  readonly past: readonly number[];
  /** Bereits zugeteilte Slots (inkl. vergangener; für die Restangebot-Runde). */
  readonly existingSlots: readonly number[];
  /**
   * Zugeteilte Slots ohne vergangene (für `min_i`): Vergangenes geht schon über `supply'`/`d'` ein;
   * zählte es auch hier, verlöre nur die Einheit mit Vergangenheit ihre Mindestzeit und zwei gleiche
   * Ziele würden nach der Neuplanung ungleich (Auslegung A-10, siehe PR AP-13b).
   */
  readonly currentSlots: readonly number[];
  /** MinChunk in s (Gruppe: Minimum der Panels mit Arbeit). */
  readonly minChunk: readonly number[];
  /** Angebot in s (Slots · 300, ohne Vergangenes). */
  readonly supply: number;
}

/**
 * Budgets in ganzen Slots (§5.1 mit A-10 und A-27): `fairShare` mit `supply' = supply + Σ past`,
 * `d' = d + past`, dann `b = max(0, b' − past)`, normieren, Restangebot-Runde mit Deckel und
 * Mindestzeit (ENG5-10), quantisieren nach größtem Rest. Garantiert `Σ n_i · 300 ≤ supply`.
 */
export function budgetSlots(input: BudgetInput): number[] {
  const { demand, past, existingSlots, currentSlots, minChunk, supply: supplyNow } = input;
  const k = demand.length;
  const at = (a: readonly number[], i: number) => a[i] ?? 0;
  let supply = supplyNow;
  for (const p of past) supply += p;
  const d = demand.map((x, i) => x + at(past, i));
  let total = 0;
  for (const x of d) total += x;
  if (total <= 0 || supplyNow <= 0) return new Array<number>(k).fill(0);
  const minSlots = (i: number) => Math.ceil(at(minChunk, i) / SLOT_S);
  const mins = d.map((x, i) =>
    at(currentSlots, i) >= minSlots(i) ? 0 : Math.min(at(minChunk, i), x),
  );

  let b = new Array<number>(k).fill(0);
  if (total <= supply) b = [...d];
  else {
    let totalMin = 0;
    for (const x of mins) totalMin += x;
    if (totalMin <= supply) {
      const excess = supply - totalMin;
      let x = 0;
      for (let i = 0; i < k; i++) x += Math.max(0, at(d, i) - at(mins, i));
      for (let i = 0; i < k; i++)
        b[i] = Math.min(
          at(d, i),
          at(mins, i) + (x > 0 ? (excess * Math.max(0, at(d, i) - at(mins, i))) / x : 0),
        );
    } else {
      let rest = supply;
      const sel: number[] = [];
      for (let i = 0; i < k; i++)
        if (rest >= at(mins, i)) {
          sel.push(i);
          rest -= at(mins, i);
        }
      if (sel.length === 0) {
        sel.push(0);
        rest = Math.max(0, supply - at(mins, 0));
      }
      let x = 0;
      for (const i of sel) x += Math.max(0, at(d, i) - at(mins, i));
      for (const i of sel)
        b[i] = Math.min(
          at(d, i),
          at(mins, i) +
            Math.max(0, x > 0 && rest > 0 ? (rest * Math.max(0, at(d, i) - at(mins, i))) / x : 0),
        );
    }
  }
  // A-10: Vergangenes abziehen.
  b = b.map((x, i) => Math.max(0, x - at(past, i)));
  // A-27.1: normieren.
  let sumB = 0;
  for (const x of b) sumB += x;
  if (sumB > supplyNow) b = b.map((x) => (x * supplyNow) / sumB);
  // A-10: Restangebot-Runde mit Deckel und Mindestzeit; ein nicht vergebener Anteil geht an die
  // nächste Einheit der Sortierreihenfolge (ENG5-10), der Rest verfällt.
  sumB = 0;
  for (const x of b) sumB += x;
  const rest = supplyNow - sumB;
  if (rest > 0 && past.some((p) => p > 0)) {
    const takers = b.map((_, i) => i).filter((i) => at(b, i) > 0 || at(past, i) === 0);
    let want = 0;
    for (const i of takers) want += Math.max(0, at(demand, i) - at(b, i));
    if (want > 0) {
      let carry = 0;
      for (const i of takers) {
        const share = (rest * Math.max(0, at(demand, i) - at(b, i))) / want + carry;
        const next = Math.min(at(demand, i), at(b, i) + share);
        if (at(existingSlots, i) * SLOT_S + next < at(minChunk, i)) {
          carry = share;
          continue;
        }
        carry = share - (next - at(b, i));
        b[i] = next;
      }
    }
  }
  // A-27.3: quantisieren (größter Rest, Gleichstand Sortierreihenfolge).
  const n = b.map((x) => Math.floor(x / SLOT_S));
  let sumN = 0;
  for (const x of n) sumN += x;
  let fractional = 0;
  for (let i = 0; i < k; i++)
    fractional += Math.max(0, Math.ceil(Math.min(at(demand, i), at(b, i)) / SLOT_S) - at(n, i));
  let give = Math.max(0, Math.min(Math.floor(supplyNow / SLOT_S) - sumN, fractional));
  const remainder = (i: number) => at(b, i) / SLOT_S - at(n, i);
  const byRest = b.map((_, i) => i).sort((x, y) => remainder(y) - remainder(x) || x - y);
  for (const i of byRest) {
    if (give <= 0) break;
    if (at(n, i) < Math.ceil(at(demand, i) / SLOT_S) && remainder(i) > 0) {
      n[i] = at(n, i) + 1;
      give--;
    }
  }
  return n;
}

/**
 * A-15: Panel-Einheiten eines Projekts bilden eine Gruppe, geordnet nach den Gruppenschlüsseln.
 * Ohne Panel-Einheiten bleibt die Reihenfolge der Sortierkette.
 */
function groupUnits(m: Matrix, sorted: readonly Row[], chain: readonly SortChainKey[]): Unit[] {
  const sw = m.setup.switches;
  const groups: Row[][] = [];
  for (const row of sorted) {
    const group =
      sw.mosaicGroupCap && row.profile.panelIndex !== null
        ? groups.find(
            (g) =>
              g[0]?.profile.projectId === row.profile.projectId && g[0].profile.panelIndex !== null,
          )
        : undefined;
    if (group) group.push(row);
    else groups.push([row]);
  }
  if (groups.every((g) => g.length === 1)) return groups.map((rows) => ({ rows }));
  return sortGroups(groups, chain, sw.fullTieBreaks).map((rows) => ({ rows }));
}

function fairShareProductive(
  m: Matrix,
  sorted: readonly Row[],
  chain: readonly SortChainKey[],
  eligible: Eligible,
  hint: Hint,
  demandOf: (r: Row) => number,
  moonDownSide: boolean | null,
): void {
  if (sorted.length === 0) return;
  const units = groupUnits(m, sorted, chain);
  const unique = new Set<number>();
  for (const row of sorted) for (let s = 0; s < m.slots; s++) if (eligible(row, s)) unique.add(s);
  const supplyNow = unique.size * SLOT_S;
  if (supplyNow <= 0) return;

  const demand = units.map((u) =>
    u.rows.reduce((sum, r) => sum + Math.max(0, withFix(m, r, demandOf(r))), 0),
  );
  const minChunk = units.map((u) => {
    const ws = u.rows.filter((r) => rowTotalWork(r) > 0);
    return ws.length === 0 ? 0 : Math.min(...ws.map((r) => r.minChunkSec));
  });
  const nSlots = budgetSlots({
    demand,
    past: units.map((u) => pastIn(m, u.rows, moonDownSide)),
    existingSlots: units.map((u) => u.rows.reduce((sum, r) => sum + assignedCount(m, r.index), 0)),
    currentSlots: units.map((u) =>
      u.rows.reduce((sum, r) => sum + assignedCount(m, r.index) - pastSlotsOf(m, r.index), 0),
    ),
    minChunk,
    supply: supplyNow,
  });
  units.forEach((u, i) => {
    const budget = (nSlots[i] ?? 0) * SLOT_S;
    if (budget <= 0) return;
    if (u.rows.length === 1) {
      const row = u.rows[0] as Row;
      paintChunks(m, row, (s) => eligible(row, s), hint, budget);
      return;
    }
    for (const [row, sec] of splitGroupBudget(m, u.rows, budget, demandOf, eligible))
      paintChunks(m, row, (s) => eligible(row, s), hint, sec);
  });
}

/**
 * A-15 Budget-Aufteilung einer Mosaik-Gruppe nach `d_panel` (größter Rest zuerst, Gleichstand
 * Panel-Index); Anteile unter MinChunk gehen an die übrigen; bleibt keiner, erhält das erste Panel
 * mit `eligible` `min(b_P, d_panel)`.
 */
function splitGroupBudget(
  m: Matrix,
  rows: readonly Row[],
  budget: number,
  demandOf: (r: Row) => number,
  eligible: Eligible,
): [Row, number][] {
  const byIndex = [...rows].sort(
    (a, b) => (a.profile.panelIndex ?? 0) - (b.profile.panelIndex ?? 0),
  );
  let active = byIndex.filter((r) => withFix(m, r, demandOf(r)) > 0);
  const slots = Math.floor(budget / SLOT_S);
  for (;;) {
    const d = active.map((r) => withFix(m, r, demandOf(r)));
    let total = 0;
    for (const x of d) total += x;
    if (active.length === 0 || total <= 0) break;
    const raw = d.map((x) => (slots * x) / total);
    const share = raw.map((x) => Math.floor(x));
    let left = slots;
    for (const x of share) left -= x;
    const order = raw
      .map((x, i) => ({ i, r: x - Math.floor(x) }))
      .sort(
        (a, b) =>
          b.r - a.r ||
          (active[a.i]?.profile.panelIndex ?? 0) - (active[b.i]?.profile.panelIndex ?? 0),
      );
    for (const o of order) {
      if (left <= 0) break;
      share[o.i] = (share[o.i] ?? 0) + 1;
      left--;
    }
    const tooSmall = active.filter((r, i) => (share[i] ?? 0) * SLOT_S < r.minChunkSec);
    if (tooSmall.length === 0)
      return active.map((r, i) => [r, (share[i] ?? 0) * SLOT_S] as [Row, number]);
    active = active.filter((r) => !tooSmall.includes(r));
  }
  const first = byIndex.find((r) => {
    for (let s = 0; s < m.slots; s++) if (eligible(r, s)) return true;
    return false;
  });
  if (!first) return [];
  const own = Math.floor(Math.min(budget, withFix(m, first, demandOf(first))) / SLOT_S) * SLOT_S;
  return own > 0 ? [[first, own]] : [];
}

function fairShare(
  m: Matrix,
  sorted: readonly Row[],
  chain: readonly SortChainKey[],
  eligible: Eligible,
  hint: Hint,
  demandOf: (r: Row) => number,
  moonDownSide: boolean | null,
): void {
  if (m.setup.switches.quantizedBudgets)
    fairShareProductive(m, sorted, chain, eligible, hint, demandOf, moonDownSide);
  else fairShareCompat(m, sorted, eligible, hint, demandOf);
}

// ─── Nacharbeiten (§7.3–7.6) ─────────────────────────────────────────────────────────────────────

/** Hat die Einheit nach Abgabe von Slot `s` noch einen zusammenhängenden Lauf ≥ MinChunkSlots? */
function keepsContiguousRun(m: Matrix, victim: number, s: number): boolean {
  const need = m.rows[victim]?.minChunkSlots ?? 0;
  let cur = 0;
  for (let k = 0; k < m.slots; k++) {
    cur = k !== s && m.assignment[k] === victim ? cur + 1 : 0;
    if (cur >= need) return true;
  }
  return false;
}

function enforceMinimum(m: Matrix): void {
  const sw = m.setup.switches;
  for (let r = 0; r < m.rows.length; r++) {
    const row = m.rows[r] as Row;
    if (row.hasLockedWindow) continue;
    let assigned = 0;
    let first = -1;
    let last = -1;
    for (let s = 0; s < m.slots; s++)
      if (m.assignment[s] === r) {
        assigned++;
        if (first < 0) first = s;
        last = s;
      }
    if (assigned === 0 || assigned >= row.minChunkSlots) continue;
    const needed = row.minChunkSlots - assigned;
    let extended = 0;
    for (let s = last + 1; s < m.slots && extended < needed; s++) {
      if (m.assignment[s] !== -1) break;
      if (!imageable(m, row, s)) break;
      m.assignment[s] = r;
      m.hint[s] = 'any';
      extended++;
    }
    for (let s = first - 1; s >= 0 && extended < needed; s--) {
      if (m.assignment[s] !== -1) break;
      if (!imageable(m, row, s)) break;
      m.assignment[s] = r;
      m.hint[s] = 'any';
      extended++;
    }
    if (assigned + extended < row.minChunkSlots) {
      let needed2 = row.minChunkSlots - assigned - extended;
      const counts = new Array<number>(m.rows.length).fill(0);
      for (const a of m.assignment) if (a >= 0) counts[a] = (counts[a] ?? 0) + 1;
      const canBorrowFrom = (victim: number, s: number) => {
        if (victim < 0 || victim === r) return false;
        // Produktiv: zusammenhängender Lauf ≥ MinChunkSlots bleibt (§7.3), Original: Gesamtzahl.
        if (sw.usableSlotPasses) return keepsContiguousRun(m, victim, s);
        return (counts[victim] ?? 0) - 1 >= (m.rows[victim]?.minChunkSlots ?? 0);
      };
      const tryTake = (s: number): boolean => {
        if (m.locked[s]) return false;
        if (!imageable(m, row, s)) return false;
        const victim = m.assignment[s] ?? -1;
        if (victim === r) return false;
        if (victim >= 0) {
          if (!canBorrowFrom(victim, s)) return false;
          counts[victim] = (counts[victim] ?? 0) - 1;
        }
        m.assignment[s] = r;
        m.hint[s] = 'any';
        counts[r] = (counts[r] ?? 0) + 1;
        needed2--;
        extended++;
        return true;
      };
      const runs = runsOf(m, r)
        .map((x) => ({ start: x.start, end: x.start + x.length - 1 }))
        .map((x, i) => ({ ...x, i }))
        .sort((a, b) => b.end - b.start - (a.end - a.start) || a.i - b.i);
      for (const run of runs) {
        for (let s = run.end + 1; s < m.slots && needed2 > 0; s++) if (!tryTake(s)) break;
        for (let s = run.start - 1; s >= 0 && needed2 > 0; s--) if (!tryTake(s)) break;
        if (needed2 <= 0) break;
      }
    }
    if (assigned + extended < row.minChunkSlots)
      for (let s = 0; s < m.slots; s++)
        if (m.assignment[s] === r && !m.locked[s]) m.assignment[s] = -1;
  }
}

function pruneSlivers(m: Matrix): void {
  const neighborCoversRun = (start: number, len: number, self: number) => {
    const before = start - 1 >= 0 ? (m.assignment[start - 1] ?? -1) : -1;
    const after = start + len < m.slots ? (m.assignment[start + len] ?? -1) : -1;
    for (const t of [before, after]) {
      if (t < 0 || t === self) continue;
      let all = true;
      for (let s = start; s < start + len; s++)
        if (!canImage(m, t, s)) {
          all = false;
          break;
        }
      if (all) return true;
    }
    return false;
  };
  for (let r = 0; r < m.rows.length; r++) {
    const runs = runsOf(m, r);
    if (runs.length < 2) continue;
    const minChunk = m.rows[r]?.minChunkSlots ?? 0;
    if (!runs.some((x) => x.length >= minChunk)) continue;
    for (const run of runs) {
      if (run.length >= minChunk) continue;
      let lockedRun = false;
      for (let s = run.start; s < run.start + run.length; s++)
        if (m.locked[s]) {
          lockedRun = true;
          break;
        }
      if (lockedRun) continue;
      let adjacentToGood = false;
      for (const good of runs) {
        if (good.length < minChunk) continue;
        const gapStart = good.start < run.start ? good.start + good.length : run.start + run.length;
        const gapEnd = good.start < run.start ? run.start : good.start;
        let separated = false;
        for (let g = gapStart; g < gapEnd; g++) {
          const a = m.assignment[g] ?? -1;
          if (a >= 0 && a !== r) {
            separated = true;
            break;
          }
        }
        if (!separated) {
          adjacentToGood = true;
          break;
        }
      }
      if (!adjacentToGood) {
        const foldMax = Math.max(2, Math.floor(minChunk / 4));
        if (run.length > foldMax || !neighborCoversRun(run.start, run.length, r)) continue;
      }
      let canAbsorb = false;
      const before = run.start - 1;
      const after = run.start + run.length;
      const bAdj = before >= 0 ? (m.assignment[before] ?? -1) : -1;
      if (bAdj >= 0 && bAdj !== r && canImage(m, bAdj, run.start)) canAbsorb = true;
      const aAdj = after < m.slots ? (m.assignment[after] ?? -1) : -1;
      if (!canAbsorb && aAdj >= 0 && aAdj !== r && canImage(m, aAdj, run.start + run.length - 1))
        canAbsorb = true;
      if (!canAbsorb) continue;
      for (let s = run.start; s < run.start + run.length; s++) {
        m.assignment[s] = -1;
        m.hint[s] = 'any';
      }
    }
  }
}

/** §7.5 in einer Vorwärts-, dann einer Rückwärtsschleife (kaskadierend). */
function gapFill(m: Matrix): void {
  for (let s = 1; s < m.slots; s++) {
    const prev = m.assignment[s - 1] ?? -1;
    if (m.assignment[s] !== -1 || prev < 0 || m.locked[s - 1]) continue;
    const row = m.rows[prev] as Row;
    if (imageable(m, row, s)) {
      m.assignment[s] = prev;
      m.hint[s] = m.hint[s - 1] ?? 'any';
    }
  }
  for (let s = m.slots - 2; s >= 0; s--) {
    const next = m.assignment[s + 1] ?? -1;
    if (m.assignment[s] !== -1 || next < 0 || m.locked[s + 1]) continue;
    const row = m.rows[next] as Row;
    if (imageable(m, row, s)) {
      m.assignment[s] = next;
      m.hint[s] = m.hint[s + 1] ?? 'any';
    }
  }
}

function defragment(m: Matrix): void {
  let changed = true;
  let iterations = 0;
  while (changed && iterations++ < 20) {
    changed = false;
    const blocks: { target: number; start: number; end: number }[] = [];
    let cur = -2;
    let bStart = 0;
    for (let s = 0; s <= m.slots; s++) {
      const t = s < m.slots ? (m.assignment[s] ?? -1) : -2;
      if (t !== cur) {
        if (cur >= 0) blocks.push({ target: cur, start: bStart, end: s - 1 });
        cur = t;
        bStart = s;
      }
    }
    for (let i = 0; i + 2 < blocks.length; i++) {
      const a1 = blocks[i] as (typeof blocks)[number];
      const b = blocks[i + 1] as (typeof blocks)[number];
      const a2 = blocks[i + 2] as (typeof blocks)[number];
      if (a1.target !== a2.target) continue;
      if (a1.target < 0 || b.target < 0) continue;
      if (a1.end + 1 !== b.start) continue;
      if (b.end + 1 !== a2.start) continue;
      let touchesLocked = false;
      for (let s = b.start; s <= a2.end && !touchesLocked; s++)
        if (m.locked[s]) touchesLocked = true;
      if (touchesLocked) continue;
      const rowA = m.rows[a1.target] as Row;
      const rowB = m.rows[b.target] as Row;
      let canSwap = true;
      for (let s = b.start; s <= b.end && canSwap; s++) if (!rowA.usable[s]) canSwap = false;
      for (let s = a2.start; s <= a2.end && canSwap; s++) if (!rowB.usable[s]) canSwap = false;
      if (!canSwap) continue;
      const bLen = b.end - b.start + 1;
      const a2Len = a2.end - a2.start + 1;
      for (let s = b.start; s < b.start + a2Len; s++) m.assignment[s] = a1.target;
      for (let s = b.start + a2Len; s < b.start + a2Len + bLen; s++) m.assignment[s] = b.target;
      changed = true;
      break;
    }
  }
}

function finish(m: Matrix): void {
  enforceMinimum(m);
  stage(m, 'enforceMinimum');
  pruneSlivers(m);
  stage(m, 'pruneSlivers');
  if (m.setup.bonusEnabled) {
    gapFill(m);
    stage(m, 'gapFill');
  }
  defragment(m);
  stage(m, 'defragment');
  pruneSlivers(m);
  stage(m, 'pruneSlivers');
  gapFill(m); // absorb, immer
  stage(m, 'absorb');
}

// ─── Strategien ──────────────────────────────────────────────────────────────────────────────────

/**
 * Pass 3a mit Mosaik-Gruppen (A-15): Reserve je Projekt (`accessible_P`) im Fenster der Gruppe,
 * verteilt wie in `fairShare` auf die Panels.
 */
function settingSoonGroups(
  m: Matrix,
  groups: readonly Unit[],
  accessible: ReadonlyMap<number, number>,
  muFree: (row: Row, s: number) => boolean,
): void {
  const acc = (u: Unit) => u.rows.reduce((sum, r) => sum + (accessible.get(r.index) ?? 0), 0);
  const first = (u: Unit) => Math.min(...u.rows.map((r) => r.firstUsableSlot));
  const last = (u: Unit) => Math.max(...u.rows.map((r) => r.lastUsableSlot));
  const free = (u: Unit, s: number) => u.rows.some((r) => muFree(r, s));
  let nightLastMu = -1;
  for (let s = 0; s < m.slots; s++) {
    if (m.moonDown[s] || m.assignment[s] !== -1) continue;
    if (groups.some((g) => g.rows.some((r) => r.usable[s])) && s > nightLastMu) nightLastMu = s;
  }
  const pos = new Map(groups.map((g, i) => [g, i]));
  const settingSoon = groups
    .filter((g) => last(g) >= 0 && last(g) < nightLastMu - 6)
    .sort((a, b) => last(a) - last(b) || acc(b) - acc(a) || (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
  for (const g of settingSoon) {
    const a = acc(g);
    if (a <= 0) continue;
    const [f, l] = [first(g), last(g)];
    let w = 0;
    for (let s = Math.max(0, f); s <= l && s < m.slots; s++) if (free(g, s)) w++;
    if (w === 0) continue;
    let demandIn = 0;
    for (const o of groups) {
      if (last(o) < f || first(o) > l) continue;
      let oSlots = 0;
      for (let s = Math.max(0, f); s <= l && s < m.slots; s++) if (free(o, s)) oSlots++;
      demandIn += Math.min(Math.max(0, acc(o)), oSlots * SLOT_S);
    }
    if (demandIn <= 0) continue;
    const reserve = Math.min(Math.ceil(a / SLOT_S), Math.floor((w * a) / demandIn), w);
    if (reserve <= 0) continue;
    const inWindow = (row: Row, s: number) => muFree(row, s) && s >= f && s <= l;
    const parts: [Row, number][] =
      g.rows.length === 1
        ? [[g.rows[0] as Row, reserve * SLOT_S]]
        : splitGroupBudget(
            m,
            g.rows,
            reserve * SLOT_S,
            (r) => accessible.get(r.index) ?? 0,
            inWindow,
          );
    for (const [row, sec] of parts) paintChunks(m, row, (s) => inWindow(row, s), 'nonLa', sec);
  }
}

function passHint(m: Matrix, s: number): Hint {
  return m.moonDown[s] ? 'la' : 'any';
}

function paintProportional(m: Matrix): void {
  const sw = m.setup.switches;
  const chain = m.setup.sortChain;
  const mdChain = moonDownChain(chain);
  const sort = (rows: readonly Row[], c: typeof chain) => applySortChain(rows, c, sw.fullTieBreaks);
  preClaimTransits(m);
  prefilterProportional(m);
  stage(m, 'preClaim');

  // Pass 0: exklusive Slots.
  const active = m.rows.filter((r) => !r.preFiltered && rowTotalWork(r) > 0);
  for (let s = 0; s < m.slots; s++) {
    if (m.assignment[s] !== -1) continue;
    let sole = -1;
    let multiple = false;
    for (const row of active) {
      if (!imageable(m, row, s)) continue;
      if (sole < 0) sole = row.index;
      else {
        multiple = true;
        break;
      }
    }
    if (sole >= 0 && !multiple) {
      m.assignment[s] = sole;
      const hint = passHint(m, s);
      m.hint[s] = hint;
      decrementWork(m.rows[sole] as Row, 300.0, hint);
    }
  }

  stage(m, 'pass0');
  // Pass 0b: zu kurze Anker verlängern.
  for (const row of m.rows) {
    if (row.preFiltered || row.minChunkSlots <= 0) continue;
    for (const run of runsOf(m, row.index)) {
      if (run.length >= row.minChunkSlots) continue;
      const needed = row.minChunkSlots - run.length;
      let extended = 0;
      for (let e = run.start + run.length; e < m.slots && extended < needed; e++) {
        if (m.assignment[e] !== -1 || !imageable(m, row, e)) break;
        const hint = passHint(m, e);
        m.assignment[e] = row.index;
        m.hint[e] = hint;
        decrementWork(row, 300.0, hint);
        extended++;
      }
      for (let e = run.start - 1; e >= 0 && extended < needed; e--) {
        if (m.assignment[e] !== -1 || !imageable(m, row, e)) break;
        const hint = passHint(m, e);
        m.assignment[e] = row.index;
        m.hint[e] = hint;
        decrementWork(row, 300.0, hint);
        extended++;
      }
    }
  }

  stage(m, 'pass0b');
  const mdEligible: Eligible = (row, s) =>
    m.moonDown[s] === true && canImage(m, row, s) && m.assignment[s] === -1;

  // Pass 1a: nur-mondlos-Arbeit.
  {
    const demand = new Map<number, number>();
    for (const r of m.rows) {
      if (r.preFiltered || !rowHasLaWork(r) || r.moonDownSlots <= 0) continue;
      const d = moonDownOnlyWorkSec(m, r);
      if (d > 0) demand.set(r.index, d);
    }
    const candidates = m.rows.filter((r) => demand.has(r.index));
    fairShare(
      m,
      sort(candidates, mdChain),
      mdChain,
      mdEligible,
      'la',
      (r) => demand.get(r.index) ?? 0,
      true,
    );
  }
  stage(m, 'pass1a');
  // Pass 1b: übrige LA-Arbeit auf Mond-unten-Slots, erst exklusiv, dann flexibel.
  {
    const candidates = m.rows.filter(
      (r) =>
        !r.preFiltered && rowHasLaWork(r) && r.moonDownSlots > 0 && hasUnpaintedSlots(m, r, true),
    );
    const sorted = sort(candidates, mdChain);
    const exclusive = sorted.filter((r) => moonUpUsableSlotCount(m, r) < r.minChunkSlots);
    const flexible = sorted.filter((r) => moonUpUsableSlotCount(m, r) >= r.minChunkSlots);
    const total = (r: Row) => rowLaWork(r) + rowNonLaWork(r);
    fairShare(m, exclusive, mdChain, mdEligible, 'la', total, true);
    fairShare(m, flexible, mdChain, mdEligible, 'la', total, true);
  }
  stage(m, 'pass1b');
  // Pass 2: übrige Mond-unten-Slots.
  {
    const candidates = m.rows.filter(
      (r) => !r.preFiltered && rowHasNonLaWork(r) && hasUnpaintedSlots(m, r, true),
    );
    fairShare(m, sort(candidates, chain), chain, mdEligible, 'any', (r) => rowTotalWork(r), true);
  }
  stage(m, 'pass2');
  // Pass 3: Mond-oben-Slots, mit 3a für früh untergehende Einheiten.
  {
    const candidates = m.rows.filter(
      (r) =>
        !r.preFiltered &&
        (rowHasNonLaWork(r) || (rowHasLaWork(r) && hasMoonSafeMoonUpSlots(m, r))) &&
        hasUnpaintedSlots(m, r, false),
    );
    const sorted = sort(candidates, chain);
    const accessibleOf = () => {
      const acc = new Map<number, number>();
      for (const row of sorted) {
        let free = 0;
        for (let s = 0; s < m.slots; s++)
          if (!m.moonDown[s] && row.usable[s] && m.assignment[s] === -1) free++;
        acc.set(row.index, rowNonLaWork(row) + Math.min(rowLaWork(row), free * 300.0));
      }
      return acc;
    };
    let accessible = accessibleOf();
    const muFree = (row: Row, s: number) =>
      !m.moonDown[s] && row.usable[s] === true && m.assignment[s] === -1;
    // Pass 3a; produktiv mit Mosaik-Gruppen je Projekt (A-15).
    const groups = groupUnits(m, sorted, chain);
    if (groups.some((g) => g.rows.length > 1)) settingSoonGroups(m, groups, accessible, muFree);
    else {
      let nightLastMu = -1;
      for (let s = 0; s < m.slots; s++) {
        if (m.moonDown[s] || m.assignment[s] !== -1) continue;
        if (sorted.some((rr) => rr.usable[s]) && s > nightLastMu) nightLastMu = s;
      }
      const pos = new Map(sorted.map((r, i) => [r.index, i]));
      const settingSoon = sorted
        .filter((r) => r.lastUsableSlot >= 0 && r.lastUsableSlot < nightLastMu - 6)
        .sort(
          (a, b) =>
            a.lastUsableSlot - b.lastUsableSlot ||
            (accessible.get(b.index) ?? 0) - (accessible.get(a.index) ?? 0) ||
            (pos.get(a.index) ?? 0) - (pos.get(b.index) ?? 0),
        );
      for (const r of settingSoon) {
        const acc = accessible.get(r.index) ?? 0;
        if (acc <= 0) continue;
        let w = 0;
        for (let s = r.firstUsableSlot; s >= 0 && s <= r.lastUsableSlot && s < m.slots; s++)
          if (muFree(r, s)) w++;
        if (w === 0) continue;
        let demandIn = 0;
        for (const o of sorted) {
          if (o.lastUsableSlot < r.firstUsableSlot || o.firstUsableSlot > r.lastUsableSlot)
            continue;
          let oSlots = 0;
          for (let s = r.firstUsableSlot; s >= 0 && s <= r.lastUsableSlot && s < m.slots; s++)
            if (muFree(o, s)) oSlots++;
          demandIn += Math.min(Math.max(0, accessible.get(o.index) ?? 0), oSlots * 300.0);
        }
        if (demandIn <= 0) continue;
        const capWork = Math.ceil(acc / 300.0);
        const capShare = Math.floor((w * acc) / demandIn);
        const reserve = Math.min(Math.min(capWork, capShare), w);
        if (reserve <= 0) continue;
        paintChunks(
          m,
          r,
          (s) => muFree(r, s) && s >= r.firstUsableSlot && s <= r.lastUsableSlot,
          'nonLa',
          reserve * 300.0,
        );
      }
    }
    stage(m, 'pass3a');
    // A-14: `accessible` nach 3a neu berechnen (Original: Stand vor 3a).
    if (sw.accessibleAfter3a) accessible = accessibleOf();
    fairShare(
      m,
      sorted,
      chain,
      (row, s) => muFree(row, s),
      'nonLa',
      (r) => accessible.get(r.index) ?? 0,
      false,
    );
  }
  stage(m, 'pass3');
  finish(m);
}

function paintGreedy(m: Matrix): void {
  preClaimTransits(m);
  prefilterGreedy(m);
  stage(m, 'preClaim');
  for (const idx of m.priorityOrder) {
    const row = m.rows[idx];
    if (!row || row.preFiltered || rowTotalWork(row) <= 0) continue;
    const ri = row.index;
    // Phase A: Stufen, die heute nur bei Mond unten gehen.
    for (let t = row.tierWorkSec.length - 1; t >= 1; t--) {
      if ((row.tierWorkSec[t] ?? 0) <= 0) continue;
      const moonDownOnly = (row.tierMoonUpSafeSlots[t] ?? 0) === 0;
      if (!moonDownOnly) continue;
      let budget = row.tierWorkSec[t] ?? 0;
      for (let s = 0; s < m.slots && budget > 0; s++) {
        if (!m.moonDown[s] || m.assignment[s] !== -1 || !canImage(m, row, s)) continue;
        m.assignment[s] = ri;
        m.hint[s] = 'la';
        row.tierWorkSec[t] = Math.max(0, (row.tierWorkSec[t] ?? 0) - 300.0);
        budget -= 300.0;
      }
    }
    // Phase B: chronologisch, restriktivste sichere Stufe zuerst.
    for (let s = 0; s < m.slots; s++) {
      if (m.assignment[s] !== -1 || !canImage(m, row, s)) continue;
      if (rowTotalWork(row) <= 0) break;
      let best = -1;
      for (let t = row.tierWorkSec.length - 1; t >= 1; t--) {
        if ((row.tierWorkSec[t] ?? 0) <= 0) continue;
        if (m.moonDown[s] || row.profile.tierSafe[t]?.[s] === true) {
          best = t;
          break;
        }
      }
      if (best < 0 && row.tierWorkSec.length > 0 && (row.tierWorkSec[0] ?? 0) > 0) best = 0;
      if (best < 0) continue;
      m.assignment[s] = ri;
      m.hint[s] = best > 0 ? (m.moonDown[s] ? 'la' : 'nonLa') : 'any';
      row.tierWorkSec[best] = Math.max(0, (row.tierWorkSec[best] ?? 0) - 300.0);
    }
  }
  stage(m, 'greedy');
  finish(m);
}

/** Beobachter je Schritt (Erklärungen der Soll-Pläne, Diagnose); ändert nichts. */
export type PaintStage = (stage: string, assignment: readonly number[]) => void;

const observers = new WeakMap<Matrix, PaintStage>();

/** Malt die Nacht (§5 bzw. §6 samt Nacharbeiten §7) in `m.assignment`. */
export function paint(m: Matrix, onStage?: PaintStage): void {
  if (m.firstUsableSlot < 0) return;
  if (onStage) observers.set(m, onStage);
  if (m.setup.strategy === 'manual_priority') paintGreedy(m);
  else paintProportional(m);
}

function stage(m: Matrix, name: string): void {
  observers.get(m)?.(name, [...m.assignment]);
}
