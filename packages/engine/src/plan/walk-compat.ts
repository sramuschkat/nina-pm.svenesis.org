/**
 * Ablauf im Kompatibilitätsmodus (`specs/engine/allocation.md` §8–9 mit §11.1): originalgetreuer Port
 * von `ScheduleEngine.WalkToLog` (SE 1583–2069) und `SessionScheduler.PickExposureSet` (SS 464–765) des
 * Astro-PM-NINA-Plugins (MIT, Commit 5dd621d). Nur für den Vergleich mit dem Orakel: die Uhr läuft nur
 * um die Belichtungszeit, `pick` schreibt Zustand (auch bei Proben), Filterzyklus am Filternamen,
 * globales `lastEs`, Nachtende-Kulanz am letzten nutzbaren Slot. Einträge wie der Orakel-Adapter
 * (`tools/astropm-oracle/cs/GridAdapter.cs`).
 */
import { SLOT_S, type Matrix, type Row, type UnitLine } from './model';

export type CompatEntry =
  | {
      readonly atS: number;
      readonly cmd: 'slew_center';
      readonly unit: string;
      readonly panel: number | null;
    }
  | { readonly atS: number; readonly cmd: 'filter'; readonly filter: string }
  | {
      readonly atS: number;
      readonly cmd: 'expose';
      readonly line: string;
      readonly bonus: boolean;
      readonly lastOfNight: boolean;
    }
  | { readonly atS: number; readonly cmd: 'dither' }
  | { readonly atS: number; readonly cmd: 'wait'; readonly untilS: number };

export interface CompatWalkSettings {
  readonly ditherEnabled: boolean;
  readonly ditherEvery: number;
  readonly filterSwitchEnabled: boolean;
  readonly filterSwitchCount: number;
  readonly tolerance: number;
  readonly bonusEnabled: boolean;
  readonly overshootPct: number;
}

interface Candidate {
  readonly line: UnitLine;
  /** „P{pi+1}“ bei mehreren Panels im Projekt, sonst "". */
  readonly panelLabel: string;
  /** Position des Panels in der Panelliste des Projekts. */
  readonly panelPos: number;
  /** Position der Zeile im Panel. */
  readonly lineIdx: number;
  readonly remaining: number;
  readonly lunar: boolean;
}

interface Pick {
  readonly line: UnitLine;
  readonly panelLabel: string;
  readonly panelPos: number;
  readonly lineIdx: number;
}

interface Cycle {
  readonly filter: string;
  readonly panelLabel: string;
  readonly subs: number;
}

/** Zustand wie `ScheduleSessionState` (SS 64–160); Schlüssel je Zeile = Matrix-Zeile. */
class State {
  readonly emitted = new Map<number, number>();
  readonly cycle = new Map<number, Cycle>();
  /** Zeit je Panel: Schlüssel `${row}|${panelLabel}`. */
  readonly panelTime = new Map<string, number>();
  constructor(private readonly overshootFraction: number) {}

  private key(row: number, panelPos: number, lineIdx: number): number {
    return row * 10000 + panelPos * 100 + lineIdx;
  }

  overshootCap(line: UnitLine): number {
    const f = this.overshootFraction;
    return f > 0 ? Math.ceil(Math.max(0, line.planned) * f) : 0;
  }

  remaining(row: number, panelPos: number, lineIdx: number, line: UnitLine): number {
    if (!line.enabled) return 0;
    return (
      Math.max(0, line.planned + this.overshootCap(line) - line.accepted) -
      (this.emitted.get(this.key(row, panelPos, lineIdx)) ?? 0)
    );
  }

  record(row: number, panelPos: number, lineIdx: number): void {
    const k = this.key(row, panelPos, lineIdx);
    this.emitted.set(k, (this.emitted.get(k) ?? 0) + 1);
  }

  resetPanelTimes(row: number): void {
    const prefix = `${String(row)}|`;
    for (const k of [...this.panelTime.keys()].sort())
      if (k.startsWith(prefix)) this.panelTime.set(k, 0);
  }
}

export interface CompatWalkResult {
  readonly entries: CompatEntry[];
  readonly assignment: number[];
}

export function walkCompat(m: Matrix, settings: CompatWalkSettings): CompatWalkResult {
  const entries: CompatEntry[] = [];
  const assignment = m.assignment;
  if (m.firstUsableSlot < 0) return { entries, assignment };
  const n = m.slots;
  const moonAlt = m.setup.moonAltDeg;
  const state = new State(settings.overshootPct > 0 ? settings.overshootPct / 100.0 : 0);
  const projects = new Map(m.setup.projects.map((p) => [p.projectId, p.panels]));
  const panelsOf = (row: Row) => projects.get(row.profile.projectId) ?? [];
  const slotIndex = (t: number) => Math.min(n - 1, Math.max(0, Math.trunc(t / SLOT_S)));
  const fsFor = (row: Row) => settings.filterSwitchEnabled && row.profile.transit === null;
  const lineSafe = (line: UnitLine, s: number) => line.safe[s] === true;
  const isNoMoon = (row: Row, line: UnitLine) =>
    line.tier > 0 && row.profile.tiers[line.tier]?.requiresMoonDown === true;
  const restrictiveness = (row: Row, line: UnitLine) => {
    const tier = row.profile.tiers[line.tier];
    if (!tier || line.tier <= 0) return 0;
    return tier.requiresMoonDown ? Number.MAX_VALUE : tier.restrictiveness;
  };
  const startRemaining = (line: UnitLine) =>
    line.enabled ? Math.max(0, line.planned - line.accepted) : 0;

  function pick(
    row: Row,
    slotIdx: number,
    fsEnabled: boolean,
    allowed: number | null,
    includeCompleted: boolean,
    targetRemainingSec: number | null,
  ): Pick | null {
    const ri = row.index;
    const panels = panelsOf(row);
    const multi = panels.length > 1;
    const moonDown = (moonAlt[slotIdx] ?? 0) <= 0;
    const candidates: Candidate[] = [];
    panels.forEach((panel, pi) => {
      if (allowed !== null && allowed !== pi) return;
      const label = multi ? `P${String(pi + 1)}` : '';
      panel.lines.forEach((line, ei) => {
        if (line.exposureS <= 0 || !line.enabled) return;
        const rem = state.remaining(ri, pi, ei, line);
        if (rem <= 0 && !includeCompleted) return;
        const lunar = line.tier > 0;
        if (lunar && !lineSafe(line, slotIdx)) return;
        candidates.push({
          line,
          panelLabel: label,
          panelPos: pi,
          lineIdx: ei,
          remaining: rem,
          lunar,
        });
      });
    });
    if (candidates.length === 0) return null;

    const active = state.cycle.get(ri)?.panelLabel ?? null;
    let rotate = false;
    let forceOff = false;
    if (active !== null && multi) {
      const timeOnPanel = state.panelTime.get(`${String(ri)}|${active}`) ?? 0;
      const minTimeSec = row.profile.minTimeSec;
      const activeLa = moonDown && candidates.some((c) => c.panelLabel === active && c.lunar);
      const otherLa = moonDown && candidates.some((c) => c.panelLabel !== active && c.lunar);
      if (moonDown && !activeLa && otherLa) forceOff = true;
      if (timeOnPanel >= minTimeSec && candidates.some((c) => c.panelLabel !== active))
        rotate = true;
    }
    const anyLa = moonDown && candidates.some((c) => c.lunar);
    const moonUpButSafe = !moonDown && candidates.some((c) => c.lunar);
    let pool: Candidate[];
    const nonLaOr = (list: Candidate[]) => {
      const nonLa = list.filter((c) => !c.lunar);
      return nonLa.length > 0 ? nonLa : list;
    };
    if (anyLa) {
      pool = candidates.filter((c) => c.lunar);
      if (forceOff || rotate) {
        const other = pool.filter((c) => c.panelLabel !== active);
        if (other.length > 0) pool = other;
      } else if (active !== null) {
        const current = pool.filter((c) => c.panelLabel === active);
        if (current.length > 0) pool = current;
      }
    } else if (moonUpButSafe) {
      if (active !== null && multi && !forceOff && !rotate) {
        const onPanel = candidates.filter((c) => c.panelLabel === active);
        pool = onPanel.length > 0 ? nonLaOr(onPanel) : nonLaOr(candidates);
      } else if (active !== null && multi && (forceOff || rotate)) {
        const other = candidates.filter((c) => c.panelLabel !== active);
        pool = other.length > 0 ? nonLaOr(other) : nonLaOr(candidates);
      } else pool = nonLaOr(candidates);
    } else if (active !== null) {
      if (forceOff || rotate) {
        const other = candidates.filter((c) => c.panelLabel !== active);
        pool = other.length > 0 ? other : candidates;
      } else {
        pool = candidates.filter((c) => c.panelLabel === active);
        if (pool.length === 0) pool = candidates;
      }
    } else pool = candidates;

    if (moonDown) {
      const noMoon = pool.filter((c) => isNoMoon(row, c.line));
      if (noMoon.length > 0) pool = noMoon;
    }

    const headroom = new Map<UnitLine, number>();
    for (const c of pool) {
      if (headroom.has(c.line)) continue;
      if (!c.lunar) {
        headroom.set(c.line, Number.MAX_VALUE);
        continue;
      }
      let sec = 0;
      for (let k = slotIdx; k < n; k++) {
        if (!lineSafe(c.line, k)) break;
        sec += 300.0;
      }
      headroom.set(c.line, sec);
    }
    const rising = slotIdx + 1 < n && (moonAlt[slotIdx + 1] ?? 0) > (moonAlt[slotIdx] ?? 0);
    const preferRelaxed = !moonDown && !rising;
    const defOrder = new Map<UnitLine, number>();
    pool.forEach((c, i) => {
      if (!defOrder.has(c.line)) defOrder.set(c.line, i);
    });
    const h = (c: Candidate) => headroom.get(c.line) ?? Number.MAX_VALUE;
    const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
    pool.sort((a, b) => {
      const hc = cmp(h(a), h(b));
      if (hc !== 0) return hc;
      const ar = restrictiveness(row, a.line);
      const br = restrictiveness(row, b.line);
      const rc = preferRelaxed ? cmp(ar, br) : cmp(br, ar);
      if (rc !== 0) return rc;
      const remc = cmp(startRemaining(b.line), startRemaining(a.line));
      if (remc !== 0) return remc;
      return cmp(defOrder.get(a.line) ?? 0, defOrder.get(b.line) ?? 0);
    });

    const resetIfChanged = (newPanel: string) => {
      if (multi && active !== null && newPanel !== active) state.resetPanelTimes(ri);
    };
    const count = settings.filterSwitchCount;
    const result = (c: Candidate): Pick => ({
      line: c.line,
      panelLabel: c.panelLabel,
      panelPos: c.panelPos,
      lineIdx: c.lineIdx,
    });

    if (fsEnabled && count > 0) {
      const remainingTargetSec = targetRemainingSec ?? (n - 1 - slotIdx) * 300.0;
      const minSubsTol = Math.max(1, Math.ceil(count * settings.tolerance));
      const fits = (c: Candidate) => {
        const runway = Math.min(remainingTargetSec, headroom.get(c.line) ?? Number.MAX_VALUE);
        const fit = Math.trunc(runway / c.line.exposureS);
        return fit >= Math.min(minSubsTol, c.remaining);
      };
      const cycle = state.cycle.get(ri);
      if (cycle) {
        if (cycle.subs < count) {
          const same = pool.find((c) => c.line.filter === cycle.filter);
          if (same) {
            resetIfChanged(same.panelLabel);
            state.cycle.set(ri, {
              filter: cycle.filter,
              panelLabel: same.panelLabel,
              subs: cycle.subs + 1,
            });
            return result(same);
          }
        } else {
          const next = pool.filter((c) => c.line.filter !== cycle.filter);
          if (next.length > 0 && !next.some(fits)) {
            const same = pool.find((c) => c.line.filter === cycle.filter);
            if (same) {
              resetIfChanged(same.panelLabel);
              state.cycle.set(ri, {
                filter: cycle.filter,
                panelLabel: same.panelLabel,
                subs: cycle.subs + 1,
              });
              return result(same);
            }
          }
        }
      }
      let chosen = pool[0] as Candidate;
      const prev = state.cycle.get(ri);
      if (prev && prev.subs >= count && pool.length > 1) {
        const curIdx = pool.findIndex((c) => c.line.filter === prev.filter);
        if (curIdx >= 0) {
          const cur = pool[curIdx] as Candidate;
          let next = cur;
          for (let step = 1; step < pool.length; step++) {
            const cand = pool[(curIdx + step) % pool.length] as Candidate;
            if (fits(cand)) {
              next = cand;
              break;
            }
          }
          if (next.line === cur.line) chosen = cur;
          else {
            const curH = headroom.get(cur.line) ?? Number.MAX_VALUE;
            const nextH = headroom.get(next.line) ?? Number.MAX_VALUE;
            const curWork = cur.remaining * cur.line.exposureS;
            const lend = Math.min(next.remaining, Math.max(1, count)) * next.line.exposureS;
            if (curH >= nextH || curH >= curWork + lend) chosen = next;
            else {
              chosen = cur;
              for (let step = 1; step < pool.length; step++) {
                const cand = pool[(curIdx + step) % pool.length] as Candidate;
                if (cand.line === cur.line) continue;
                if ((headroom.get(cand.line) ?? Number.MAX_VALUE) <= curH && fits(cand)) {
                  chosen = cand;
                  break;
                }
              }
            }
          }
        }
      }
      resetIfChanged(chosen.panelLabel);
      state.cycle.set(ri, { filter: chosen.line.filter, panelLabel: chosen.panelLabel, subs: 1 });
      return result(chosen);
    }
    const final = pool[0] as Candidate;
    resetIfChanged(final.panelLabel);
    return result(final);
  }

  const nightStart = m.firstUsableSlot * SLOT_S;
  const nightEnd = (m.lastUsableSlot + 1) * SLOT_S;
  let now = nightStart;
  let current = -1;
  let currentFilter: string | null = null;
  let currentPanel: string | null = null;
  let subsSinceDither = 0;
  let graceUsed = false;
  let last: Pick | null = null;
  let lastAssignedRow = -1;
  let waitStart = Number.NEGATIVE_INFINITY;

  const unitOf = (r: number) => m.rows[r]?.profile.unitId ?? '';
  const allowedOf = (row: Row) => row.profile.panelPos;

  for (let s = m.firstUsableSlot; s <= m.lastUsableSlot; s++) {
    let rowIdx = assignment[s] ?? -1;
    const slotStart = s * SLOT_S;
    const slotEnd = slotStart + SLOT_S;
    if (now < slotStart) now = slotStart;
    if (rowIdx < 0) {
      if (lastAssignedRow >= 0) {
        waitStart = now;
        lastAssignedRow = -1;
      }
      continue;
    }
    if (lastAssignedRow < 0 && waitStart > Number.NEGATIVE_INFINITY) {
      if ((now - waitStart) / 60 >= 5)
        entries.push({ atS: waitStart, cmd: 'wait', untilS: s * SLOT_S });
    }
    lastAssignedRow = rowIdx;
    let row = m.rows[rowIdx] as Row;

    if (current !== rowIdx) {
      const probe = pick(row, s, fsFor(row), allowedOf(row), false, null);
      if (probe === null && m.locked[s]) {
        // gesperrter Transit-Slot: beim Transit bleiben
      } else if (probe === null) {
        let runEnd = s;
        for (let fs = s + 1; fs <= m.lastUsableSlot; fs++) {
          if (assignment[fs] !== rowIdx) break;
          runEnd = fs;
        }
        let firstViable = -1;
        for (let fs = s + 1; fs <= runEnd; fs++) {
          state.cycle.delete(rowIdx);
          if (pick(row, fs, fsFor(row), allowedOf(row), false, null) !== null) {
            firstViable = fs;
            break;
          }
        }
        state.cycle.delete(rowIdx);
        const reassignEnd = firstViable >= 0 ? firstViable : runEnd + 1;
        let fallback = -1;
        for (let r = 0; r < m.rows.length; r++) {
          if (r === rowIdx) continue;
          const other = m.rows[r] as Row;
          if (other.profile.canImage[s] !== true) continue;
          if (pick(other, s, fsFor(other), allowedOf(other), false, null) !== null) {
            fallback = r;
            break;
          }
        }
        if (fallback >= 0) {
          for (let fs = s; fs < reassignEnd; fs++) {
            if (m.locked[fs]) break;
            assignment[fs] = fallback;
          }
          rowIdx = fallback;
          row = m.rows[rowIdx] as Row;
        } else {
          let releaseEnd = reassignEnd;
          if (settings.bonusEnabled) {
            for (let fs = s; fs < reassignEnd; fs++) {
              state.cycle.delete(rowIdx);
              if (pick(row, fs, fsFor(row), allowedOf(row), true, null) !== null) {
                releaseEnd = fs;
                break;
              }
            }
            state.cycle.delete(rowIdx);
          }
          if (releaseEnd > s) {
            let released = s;
            for (let fs = s; fs < releaseEnd; fs++) {
              if (m.locked[fs]) break;
              assignment[fs] = -1;
              released = fs + 1;
            }
            if (released > s) {
              waitStart = now;
              lastAssignedRow = -1;
              s = released - 1;
              continue;
            }
          }
        }
      }
      state.cycle.delete(rowIdx);
    }

    const panels = panelsOf(row);
    const multi = panels.length > 1;
    if (current !== rowIdx) {
      const pos = row.profile.panelPos;
      entries.push({
        atS: now,
        cmd: 'slew_center',
        unit: unitOf(rowIdx),
        panel: pos === null ? null : (panels[pos]?.index ?? null),
      });
      current = rowIdx;
      currentFilter = null;
      currentPanel = null;
      subsSinceDither = 0;
      state.cycle.delete(rowIdx);
      if (multi && row.profile.panelPos === null) state.resetPanelTimes(rowIdx);
    }

    while (now < slotEnd && now < nightEnd) {
      const cs = slotIndex(now);
      if (cs > s) {
        const nextAssignment = cs < n ? (assignment[cs] ?? -1) : -1;
        if (nextAssignment !== rowIdx) break;
      }
      let allowed = allowedOf(row);
      if (allowed === null && multi && currentPanel !== null) {
        let remainingSec = nightEnd - now;
        for (let fs = cs + 1; fs < n; fs++)
          if (assignment[fs] !== rowIdx) {
            remainingSec = Math.min(remainingSec, fs * SLOT_S - now);
            break;
          }
        if (remainingSec < row.profile.minTimeSec) {
          const idx = panels.findIndex((p) => `P${String(p.index + 1)}` === currentPanel);
          if (idx >= 0) allowed = idx;
        }
      }
      let targetRemainingSec = Math.max(0, slotEnd - now);
      for (let fs = s + 1; fs <= m.lastUsableSlot; fs++) {
        if (assignment[fs] !== rowIdx) break;
        targetRemainingSec += 300.0;
      }
      let chosen = pick(row, cs, fsFor(row), allowed, false, targetRemainingSec);
      if (chosen === null && settings.bonusEnabled) {
        chosen = pick(row, cs, fsFor(row), allowed, true, targetRemainingSec);
        if (chosen === null && last !== null) {
          const gapMoonOk = last.line.tier <= 0 || lineSafe(last.line, cs);
          if (gapMoonOk) chosen = last;
        }
      }
      if (chosen === null) break;
      const line = chosen.line;
      if (now + line.exposureS > nightEnd) {
        if (graceUsed) break;
        graceUsed = true;
      }
      if (multi && currentPanel !== null && chosen.panelLabel !== currentPanel) {
        const pos = Number(chosen.panelLabel.slice(1)) - 1;
        entries.push({
          atS: now,
          cmd: 'slew_center',
          unit: unitOf(rowIdx),
          panel: panels[pos]?.index ?? null,
        });
        subsSinceDither = 0;
      }
      currentPanel = chosen.panelLabel;
      if (line.filter !== currentFilter) {
        entries.push({ atS: now, cmd: 'filter', filter: line.filter });
        currentFilter = line.filter;
        subsSinceDither = 0;
      }
      const bonus = state.remaining(rowIdx, chosen.panelPos, chosen.lineIdx, line) <= 0;
      entries.push({
        atS: now,
        cmd: 'expose',
        line: line.id,
        bonus,
        lastOfNight: now + line.exposureS > nightEnd,
      });
      now += line.exposureS;
      state.record(rowIdx, chosen.panelPos, chosen.lineIdx);
      last = chosen;
      if (multi && chosen.panelLabel !== '') {
        const k = `${String(rowIdx)}|${chosen.panelLabel}`;
        state.panelTime.set(k, (state.panelTime.get(k) ?? 0) + line.exposureS);
      }
      subsSinceDither++;
      if (
        settings.ditherEnabled &&
        subsSinceDither >= settings.ditherEvery &&
        row.profile.transit === null
      ) {
        entries.push({ atS: now, cmd: 'dither' });
        subsSinceDither = 0;
      }
    }
  }
  return { entries, assignment };
}
