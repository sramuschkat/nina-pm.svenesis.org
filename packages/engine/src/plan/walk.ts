/**
 * Ablauf im Produktivmodus (`specs/engine/allocation.md` §8, §8.1, §8.4, §9; Abweichungen A-4, A-7,
 * A-17, A-18, A-21, A-22, A-23, A-24, A-29). Grundlage ist `WalkToLog`/`PickExposureSet` des
 * Astro-PM-NINA-Plugins (MIT, Commit 5dd621d); der originalgetreue Port steht in `walk-compat.ts`.
 * Die Uhr läuft mit Overheads (Slew/Zentrieren, Filterwechsel, Download, Dither, Autofokus), `pick` ist
 * seiteneffektfrei, Blöcke enden hart (einzige Ausnahme: Nachtende-Kulanz) und leere Blockreste werden
 * freigegeben. Zeiten in Sekunden ab Slot 0. Meridian-Flip und Pierseiten folgen mit AP-13d.
 */
import { SLOT_S, type Matrix, type Row, type UnitLine } from './model';

export interface WalkSettings {
  readonly slewCenterS: number;
  readonly filterChangeS: number;
  readonly ditherSettleS: number;
  readonly afEveryMin: number;
  readonly afDurationS: number;
  readonly downloadS: number;
  readonly ditherEnabled: boolean;
  readonly ditherEvery: number;
  readonly filterSwitchEnabled: boolean;
  readonly filterSwitchEvery: number;
  readonly tolerancePct: number;
  readonly bonusEnabled: boolean;
  /** Rig mit Rotator → `slew_center_rotate`. */
  readonly rotator: boolean;
  /** `darknessEndUtc` in s ab Slot 0 (nachtweit, NT-12); `null` = keine der genutzten Grenzen. */
  readonly darknessEndS: number | null;
  /** Aufwärtsdurchgang der eigenen Dämmerungsgrenze je Einheit (`block.twilightEndUtc`). */
  readonly twilightEndS: (unitId: string) => number | null;
  /** Letzter Autofokus (`tonight.lastAutofocusUtc`); `null` = fällig. */
  readonly lastAutofocusS: number | null;
  /** Neuplanung: Uhrstart (§5.3). */
  readonly startAtS: number | null;
  /** Filterzyklus aus `tonight` je Einheit. */
  readonly initialCycle: ReadonlyMap<string, { readonly lineId: string; readonly subs: number }>;
}

export type WalkEntry =
  | {
      readonly cmd: 'slew_center' | 'slew_center_rotate';
      readonly atS: number;
      readonly durationS: number;
      /** Panel des Slews (Panel-Index), `null` = Projektzentrum. */
      panelIndex: number | null;
    }
  | {
      readonly cmd: 'filter';
      readonly atS: number;
      readonly durationS: number;
      readonly filter: string;
    }
  | {
      readonly cmd: 'expose';
      readonly atS: number;
      readonly lineId: string;
      readonly filter: string;
      readonly exposureS: number;
      readonly bonus: boolean;
      readonly lastOfNight: boolean;
    }
  | {
      readonly cmd: 'expose_series';
      readonly atS: number;
      readonly untilS: number;
      readonly lineId: string;
      readonly filter: string;
      readonly exposureS: number;
    }
  | { readonly cmd: 'dither'; readonly atS: number; readonly durationS: number }
  | { readonly cmd: 'autofocus_hint'; readonly atS: number; readonly durationS: number }
  | { readonly cmd: 'wait'; readonly atS: number; readonly durationS: number }
  | { readonly cmd: 'end'; readonly atS: number };

export interface WalkBlock {
  readonly kind: 'regular' | 'transit';
  readonly row: number;
  readonly unitId: string;
  readonly projectId: string;
  /** Panel des Blocks (Panel-Index), `null` = Projekt ohne Panel-Bezug. */
  panelIndex: number | null;
  startS: number;
  endS: number;
  readonly entries: WalkEntry[];
}

export interface WalkResult {
  readonly blocks: readonly WalkBlock[];
  /** Zuteilung nach dem Ablauf (Ersatz am Blockanfang, Freigaben A-29). */
  readonly assignment: readonly number[];
}

interface Candidate {
  readonly line: UnitLine;
  readonly panelIndex: number;
  /** Definitionsreihenfolge (Panel, Zeile). */
  readonly def: number;
  readonly rest: number;
  readonly lunar: boolean;
}

export interface Picked {
  readonly line: UnitLine;
  readonly panelIndex: number;
  /** Filterzyklus nach Annahme (A-7: erst übernehmen, wenn die Belichtung angenommen ist). */
  readonly cycle: { readonly lineId: string; readonly subs: number } | null;
}

interface PickOptions {
  readonly targetRemainingSec: number;
  readonly includeCompleted: boolean;
  readonly allowedPanel: number | null;
  /** Uhrzeit der Belichtung; die sichere Zeit zählt ab hier, nicht ab Slotbeginn (A-26). */
  readonly atS?: number;
}

export function walk(m: Matrix, settings: WalkSettings): WalkResult {
  const assignment = m.assignment;
  const blocks: WalkBlock[] = [];
  if (m.firstUsableSlot < 0) return { blocks, assignment };
  const n = m.slots;
  const moonAlt = m.setup.moonAltDeg;
  const dl = settings.downloadS;
  const projects = new Map(m.setup.projects.map((p) => [p.projectId, p.panels]));
  const emitted = new Map<string, number>();
  const cycle = new Map<number, { lineId: string; subs: number }>();
  const activePanel = new Map<number, number>();
  const panelTime = new Map<number, Map<number, number>>();
  const lastLine = new Map<number, Picked>();
  for (const row of m.rows) {
    const c = settings.initialCycle.get(row.profile.unitId);
    if (c) cycle.set(row.index, { lineId: c.lineId, subs: c.subs });
  }
  const slewCmd = settings.rotator ? 'slew_center_rotate' : 'slew_center';
  const nightEnd = (m.lastUsableSlot + 1) * SLOT_S;

  const unitPanels = (row: Row) => {
    const all = projects.get(row.profile.projectId) ?? [];
    return row.profile.panelIndex === null
      ? all
      : all.filter((p) => p.index === row.profile.panelIndex);
  };
  const multiPanel = (row: Row) => row.profile.panelIndex === null && unitPanels(row).length > 1;
  const restOf = (line: UnitLine) => line.effRemaining - (emitted.get(line.id) ?? 0);
  const startRemaining = (line: UnitLine) =>
    line.enabled ? Math.max(0, line.planned - line.accepted) : 0;
  const restrictiveness = (row: Row, line: UnitLine) => {
    const tier = row.profile.tiers[line.tier];
    if (!tier || line.tier <= 0) return 0;
    return tier.requiresMoonDown ? Number.POSITIVE_INFINITY : tier.restrictiveness;
  };
  const headroomOf = (line: UnitLine, cs: number) => {
    if (line.tier <= 0) return Number.POSITIVE_INFINITY;
    let sec = 0;
    for (let k = cs; k < n; k++) {
      if (line.safe[k] !== true) break;
      sec += SLOT_S;
    }
    return sec;
  };

  /** §9 `pick`, seiteneffektfrei. */
  function pick(row: Row, cs: number, opts: PickOptions): Picked | null {
    const moonDown = (moonAlt[cs] ?? 0) <= 0;
    const candidates: Candidate[] = [];
    let def = 0;
    for (const panel of unitPanels(row)) {
      for (const line of panel.lines) {
        const d = def++;
        if (opts.allowedPanel !== null && panel.index !== opts.allowedPanel) continue;
        if (line.exposureS <= 0 || !line.enabled || line.tier < 0) continue;
        const rest = restOf(line);
        if (rest <= 0 && !opts.includeCompleted) continue;
        const cost = line.exposureS + dl;
        if (cost > opts.targetRemainingSec) continue;
        const lunar = line.tier > 0;
        const offset = opts.atS === undefined ? 0 : opts.atS - cs * SLOT_S;
        if (lunar && (line.safe[cs] !== true || headroomOf(line, cs) - offset < cost)) continue;
        candidates.push({ line, panelIndex: panel.index, def: d, rest, lunar });
      }
    }
    if (candidates.length === 0) return null;
    const multi = multiPanel(row);
    const active = multi ? (activePanel.get(row.index) ?? null) : null;
    let rotate = false;
    let forceOff = false;
    if (active !== null) {
      const onActive = panelTime.get(row.index)?.get(active) ?? 0;
      const activeLa = moonDown && candidates.some((c) => c.panelIndex === active && c.lunar);
      const otherLa = moonDown && candidates.some((c) => c.panelIndex !== active && c.lunar);
      if (moonDown && !activeLa && otherLa) forceOff = true;
      if (onActive >= row.profile.minTimeSec && candidates.some((c) => c.panelIndex !== active))
        rotate = true;
    }
    const nonLaOr = (list: Candidate[]) => {
      const nonLa = list.filter((c) => !c.lunar);
      return nonLa.length > 0 ? nonLa : list;
    };
    const laCandidates = candidates.filter((c) => c.lunar);
    let pool: Candidate[];
    if (moonDown && laCandidates.length > 0) {
      pool = laCandidates;
      if (forceOff || rotate) {
        const other = pool.filter((c) => c.panelIndex !== active);
        if (other.length > 0) pool = other;
      } else if (active !== null) {
        const current = pool.filter((c) => c.panelIndex === active);
        if (current.length > 0) pool = current;
      }
    } else if (!moonDown && laCandidates.length > 0) {
      if (active !== null && !forceOff && !rotate) {
        const onPanel = candidates.filter((c) => c.panelIndex === active);
        pool = onPanel.length > 0 ? nonLaOr(onPanel) : nonLaOr(candidates);
      } else if (active !== null) {
        const other = candidates.filter((c) => c.panelIndex !== active);
        pool = other.length > 0 ? nonLaOr(other) : nonLaOr(candidates);
      } else pool = nonLaOr(candidates);
    } else if (active !== null) {
      if (forceOff || rotate) {
        const other = candidates.filter((c) => c.panelIndex !== active);
        pool = other.length > 0 ? other : candidates;
      } else {
        const current = candidates.filter((c) => c.panelIndex === active);
        pool = current.length > 0 ? current : candidates;
      }
    } else pool = candidates;
    if (moonDown) {
      const noMoon = pool.filter(
        (c) => c.lunar && row.profile.tiers[c.line.tier]?.requiresMoonDown === true,
      );
      if (noMoon.length > 0) pool = noMoon;
    }
    const rising = cs + 1 < n && (moonAlt[cs + 1] ?? 0) > (moonAlt[cs] ?? 0);
    const preferRelaxed = !moonDown && !rising;
    const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
    const head = new Map(pool.map((c) => [c.line.id, headroomOf(c.line, cs)]));
    const h = (c: Candidate) => head.get(c.line.id) ?? Number.POSITIVE_INFINITY;
    pool = [...pool].sort((a, b) => {
      const hc = cmp(h(a), h(b));
      if (hc !== 0) return hc;
      const ar = restrictiveness(row, a.line);
      const br = restrictiveness(row, b.line);
      const rc = preferRelaxed ? cmp(ar, br) : cmp(br, ar);
      if (rc !== 0) return rc;
      return cmp(startRemaining(b.line), startRemaining(a.line)) || cmp(a.def, b.def);
    });

    const every = settings.filterSwitchEvery;
    const fsOn = settings.filterSwitchEnabled && every > 0 && row.profile.transit === null;
    const result = (c: Candidate, cyc: Picked['cycle']): Picked => ({
      line: c.line,
      panelIndex: c.panelIndex,
      cycle: cyc,
    });
    if (!fsOn) return result(pool[0] as Candidate, null);

    const minSubs = Math.max(1, Math.ceil((every * settings.tolerancePct) / 100));
    const fits = (c: Candidate) => {
      const runway = Math.min(opts.targetRemainingSec, h(c));
      return Math.floor(runway / (c.line.exposureS + dl)) >= Math.min(minSubs, c.rest);
    };
    const cur = cycle.get(row.index) ?? null;
    const same = cur ? pool.find((c) => c.line.id === cur.lineId) : undefined;
    const keep = (c: Candidate) => result(c, { lineId: c.line.id, subs: (cur?.subs ?? 0) + 1 });
    const start = (c: Candidate) =>
      c.line.id === cur?.lineId ? keep(c) : result(c, { lineId: c.line.id, subs: 1 });
    if (cur && same) {
      if (cur.subs < every) return keep(same);
      const others = pool.filter((c) => c.line.id !== cur.lineId);
      if (others.length > 0 && !others.some(fits)) return keep(same);
    }
    if (!cur || cur.subs < every || pool.length <= 1 || !same) return start(pool[0] as Candidate);
    const curIdx = pool.indexOf(same);
    let next = same;
    for (let step = 1; step < pool.length; step++) {
      const cand = pool[(curIdx + step) % pool.length] as Candidate;
      if (fits(cand)) {
        next = cand;
        break;
      }
    }
    if (next === same) return keep(same);
    const curH = h(same);
    const curWork = same.rest * (same.line.exposureS + dl);
    const lend = Math.min(next.rest, Math.max(1, every)) * (next.line.exposureS + dl);
    if (curH >= h(next) || curH >= curWork + lend) return start(next);
    for (let step = 1; step < pool.length; step++) {
      const cand = pool[(curIdx + step) % pool.length] as Candidate;
      if (cand === same) continue;
      if (h(cand) <= curH && fits(cand)) return start(cand);
    }
    return keep(same);
  }

  // ─── Ablauf ───────────────────────────────────────────────────────────────────────────────────
  let t = Math.max(m.firstUsableSlot * SLOT_S, settings.startAtS ?? 0);
  let lastAf = settings.lastAutofocusS ?? Number.NEGATIVE_INFINITY;
  let block = null as WalkBlock | null;
  let lastClosed = null as WalkBlock | null;
  let graceUsed = false;
  let currentFilter: string | null = null;
  let currentPanel: number | null = null;
  let ditherCount = 0;
  let ditherDue = false;

  const runEndOf = (row: number, s: number) => {
    let e = s;
    while (e + 1 < n && assignment[e + 1] === row) e++;
    return e + 1; // exklusiv
  };
  const close = (atS: number) => {
    if (!block) return;
    block.entries.push({ cmd: 'end', atS });
    block.endS = atS;
    const hasExposure = block.entries.some((e) => e.cmd === 'expose' || e.cmd === 'expose_series');
    if (hasExposure) {
      blocks.push(block);
      lastClosed = block;
    } else {
      // Block ohne Belichtung entfällt, seine Slots sind Leerlauf (§8.4).
      const first = Math.floor(block.startS / SLOT_S);
      const last = Math.min(n, Math.ceil(atS / SLOT_S));
      for (let fs = Math.max(0, first); fs < last; fs++)
        if (assignment[fs] === block.row && !m.locked[fs]) assignment[fs] = -1;
    }
    block = null;
    ditherDue = false;
  };
  /** Leerlauf ≥ 5 min seit dem letzten Block → `wait` am Ende dieses Blocks (§8). */
  const waitUntil = (startS: number) => {
    const prev = lastClosed;
    if (!prev || prev.kind !== 'regular') return;
    const idle = startS - prev.endS;
    if (idle < 300) return;
    const end = prev.entries.pop();
    prev.entries.push({ cmd: 'wait', atS: prev.endS, durationS: idle });
    if (end) prev.entries.push({ cmd: 'end', atS: startS });
    prev.endS = startS;
  };
  const open = (row: Row, panelIndex: number | null, kind: WalkBlock['kind'], atS: number) => {
    block = {
      kind,
      row: row.index,
      unitId: row.profile.unitId,
      projectId: row.profile.projectId,
      panelIndex,
      startS: atS,
      endS: atS,
      entries: [],
    };
    currentFilter = null;
    ditherCount = 0;
    ditherDue = false;
    return block;
  };
  const release = (from: number, to: number) => {
    for (let fs = from; fs < to; fs++) {
      if (m.locked[fs]) break;
      assignment[fs] = -1;
    }
  };

  for (let s = m.firstUsableSlot; s <= m.lastUsableSlot; s++) {
    let r = assignment[s] ?? -1;
    if (block !== null && r !== block.row) close(t);
    if (s * SLOT_S + SLOT_S <= t) continue;
    t = Math.max(t, s * SLOT_S);
    if (r < 0) continue;
    let row = m.rows[r] as Row;

    // Transit-Einheit (A-21): Vorlauf, Serie bis Fensterende; Flip-Lücke folgt mit AP-13d.
    if (row.profile.transit !== null && m.locked[s]) {
      if (block) close(t);
      const tr = row.profile.transit;
      const line = row.profile.lines.find((l) => l.id === tr.lineId);
      // Vorlauf + Fenster sind ein zusammenhängender gesperrter Lauf (preClaimTransits). Die Serie läuft
      // bis Fensterende (A-21), aber nicht über die gesperrten Slots hinaus: wo das Ziel unter die
      // Mindesthöhe fällt, hat `preClaimTransits` nichts gesperrt und eine andere Einheit belichtet.
      let lastLocked = s;
      while (lastLocked + 1 < n && assignment[lastLocked + 1] === r && m.locked[lastLocked + 1])
        lastLocked++;
      let firstWindow = s;
      while (firstWindow < lastLocked && firstWindow * SLOT_S + SLOT_S / 2 < tr.startS)
        firstWindow++;
      // Die Serie beginnt am Fensterbeginn, wenn dessen Slot gesperrt ist (Slotmitte-Regel verschiebt nur
      // den ersten Fenster-Slot, transit.md §3); sonst ab dem ersten gesperrten Fenster-Slot.
      const startSlot = Math.floor(tr.startS / SLOT_S);
      const startLocked = startSlot >= s && startSlot <= lastLocked;
      const seriesS = startLocked ? tr.startS : Math.max(tr.startS, firstWindow * SLOT_S);
      const untilS = Math.min(tr.endS, (lastLocked + 1) * SLOT_S);
      const leadAt = Math.max(t, seriesS - settings.slewCenterS - 60);
      const b = open(row, row.profile.panelIndex, 'transit', leadAt);
      b.startS = seriesS;
      waitUntil(leadAt);
      b.entries.push({
        cmd: slewCmd,
        atS: leadAt,
        durationS: settings.slewCenterS,
        panelIndex: row.profile.panelIndex,
      });
      if (line && untilS > seriesS)
        b.entries.push({
          cmd: 'expose_series',
          atS: seriesS,
          untilS,
          lineId: line.id,
          filter: line.filter,
          exposureS: line.exposureS,
        });
      t = Math.max(t, untilS);
      close(untilS);
      s = lastLocked;
      continue;
    }

    const newVisit = block === null || block.row !== r;
    if (newVisit) {
      // Blockanfang ohne Arbeit (§8, FA-SCH-19, A-17): Ersatz oder Freigabe.
      const runEnd = runEndOf(r, s);
      const probe = pick(row, s, {
        targetRemainingSec: runEnd * SLOT_S - (t + settings.slewCenterS),
        includeCompleted: false,
        allowedPanel: row.profile.panelIndex,
      });
      if (probe === null && !m.locked[s]) {
        let firstViable = -1;
        for (let fs = s + 1; fs < runEnd; fs++) {
          const at = Math.max(t, fs * SLOT_S);
          if (
            pick(row, fs, {
              targetRemainingSec: runEnd * SLOT_S - (at + settings.slewCenterS),
              includeCompleted: false,
              allowedPanel: row.profile.panelIndex,
            })
          ) {
            firstViable = fs;
            break;
          }
        }
        const reassignEnd = firstViable >= 0 ? firstViable : runEnd;
        let fallback = -1;
        for (const other of m.rows) {
          if (other.index === r || other.profile.transit !== null || other.preFiltered) continue;
          let all = true;
          for (let fs = s; fs < reassignEnd; fs++)
            if (other.profile.canImage[fs] !== true) {
              all = false;
              break;
            }
          if (!all) continue;
          if (
            pick(other, s, {
              targetRemainingSec: reassignEnd * SLOT_S - (t + settings.slewCenterS),
              includeCompleted: false,
              allowedPanel: other.profile.panelIndex,
            })
          ) {
            fallback = other.index;
            break;
          }
        }
        if (fallback >= 0) {
          for (let fs = s; fs < reassignEnd; fs++) {
            if (m.locked[fs]) break;
            assignment[fs] = fallback;
          }
          r = fallback;
          row = m.rows[r] as Row;
        } else {
          let releaseEnd = reassignEnd;
          if (settings.bonusEnabled)
            for (let fs = s; fs < reassignEnd; fs++) {
              const at = Math.max(t, fs * SLOT_S);
              if (
                pick(row, fs, {
                  targetRemainingSec: runEnd * SLOT_S - (at + settings.slewCenterS),
                  includeCompleted: true,
                  allowedPanel: row.profile.panelIndex,
                })
              ) {
                releaseEnd = fs;
                break;
              }
            }
          if (releaseEnd > s) {
            release(s, releaseEnd);
            if (assignment[s] === -1) {
              s = releaseEnd - 1;
              continue;
            }
          }
        }
      }
      // Blockbeginn: Slew/Zentrieren (A-18 auch nach Leerlauf auf derselben Einheit).
      const b = open(row, row.profile.panelIndex, 'regular', t);
      waitUntil(t);
      b.entries.push({
        cmd: slewCmd,
        atS: t,
        durationS: settings.slewCenterS,
        panelIndex: row.profile.panelIndex,
      });
      t += settings.slewCenterS;
      currentPanel = row.profile.panelIndex;
      if (multiPanel(row)) panelTime.set(r, new Map());
    }

    const runEnd = runEndOf(r, s);
    const blockEnd = runEnd * SLOT_S;
    while (t < (s + 1) * SLOT_S && t < nightEnd && block) {
      let cs = Math.floor(t / SLOT_S);
      if (cs > s && assignment[cs] !== r) break;
      let allowed = row.profile.panelIndex;
      // Mosaik ohne Panel-Einheiten: kurz vor Blockende auf das aktuelle Panel sperren (A-19).
      if (
        allowed === null &&
        multiPanel(row) &&
        currentPanel !== null &&
        blockEnd - t < row.profile.minTimeSec
      )
        allowed = currentPanel;
      // Dither erst, wenn im Block noch eine Belichtung folgt (ENG5-6).
      if (ditherDue) {
        ditherDue = false;
        const after = t + settings.ditherSettleS;
        const next = pick(row, Math.min(n - 1, Math.floor(after / SLOT_S)), {
          targetRemainingSec: blockEnd - after,
          includeCompleted: settings.bonusEnabled,
          allowedPanel: allowed,
          atS: after,
        });
        if (next) {
          (block as WalkBlock).entries.push({
            cmd: 'dither',
            atS: t,
            durationS: settings.ditherSettleS,
          });
          t = after;
          ditherCount = 0;
        }
      }
      if (settings.afEveryMin > 0 && t - lastAf >= settings.afEveryMin * 60) {
        (block as WalkBlock).entries.push({
          cmd: 'autofocus_hint',
          atS: t,
          durationS: settings.afDurationS,
        });
        t += settings.afDurationS;
        lastAf = t;
      }
      cs = Math.min(n - 1, Math.floor(t / SLOT_S));
      const opts = {
        targetRemainingSec: blockEnd - t,
        includeCompleted: false,
        allowedPanel: allowed,
        atS: t,
      };
      let chosen = pick(row, cs, opts);
      if (!chosen && settings.bonusEnabled) {
        chosen = pick(row, cs, { ...opts, includeCompleted: true });
        const last = lastLine.get(r);
        // A-23: letzte Zeile derselben Einheit, falls in cs sicher und bis Blockende passend.
        if (
          !chosen &&
          last &&
          (last.line.tier <= 0 ||
            headroomOf(last.line, cs) - (t - cs * SLOT_S) >= last.line.exposureS + dl) &&
          last.line.exposureS + dl <= blockEnd - t
        )
          chosen = {
            ...last,
            cycle: last.cycle ? { lineId: last.line.id, subs: last.cycle.subs + 1 } : null,
          };
      }
      let lastOfNight = false;
      if (!chosen) {
        // Nachtende-Kulanz (A-24, NT-13, M4): letzter Block der Nacht, einmal.
        const laterAssigned = assignment.slice(runEnd).some((a) => a >= 0);
        const limits = [settings.darknessEndS, settings.twilightEndS(row.profile.unitId)].filter(
          (x): x is number => x !== null,
        );
        const graceLimit = limits.length > 0 ? Math.min(...limits) : blockEnd;
        if (blockEnd === nightEnd && !laterAssigned && !graceUsed && graceLimit > blockEnd) {
          const grace = pick(row, cs, {
            targetRemainingSec: graceLimit - t,
            includeCompleted: settings.bonusEnabled,
            allowedPanel: allowed,
            atS: t,
          });
          if (grace) {
            chosen = grace;
            lastOfNight = true;
            graceUsed = true;
          }
        }
      }
      if (!chosen) {
        // A-29: Rest des Laufs freigeben, Block schließen.
        release(Math.ceil(t / SLOT_S), runEnd);
        close(t);
        s = runEnd - 1;
        break;
      }
      const b = block as WalkBlock;
      if (multiPanel(row) && currentPanel !== null && chosen.panelIndex !== currentPanel) {
        // Panelwechsel = neuer Block (§8.4).
        close(t);
        const nb = open(row, chosen.panelIndex, 'regular', t);
        nb.entries.push({
          cmd: slewCmd,
          atS: t,
          durationS: settings.slewCenterS,
          panelIndex: chosen.panelIndex,
        });
        t += settings.slewCenterS;
        panelTime.set(r, new Map());
        const limit = lastOfNight ? Number.POSITIVE_INFINITY : blockEnd;
        if (t + chosen.line.exposureS + dl > limit) continue;
      } else if (b.panelIndex === null && multiPanel(row)) {
        // Erster Block eines Mosaiks ohne Panel-Einheiten: Slew auf das Panel der ersten Belichtung (A-19).
        b.panelIndex = chosen.panelIndex;
        const slew = b.entries.find(
          (e) => e.cmd === 'slew_center' || e.cmd === 'slew_center_rotate',
        );
        if (slew && (slew.cmd === 'slew_center' || slew.cmd === 'slew_center_rotate'))
          slew.panelIndex = chosen.panelIndex;
      }
      currentPanel = chosen.panelIndex;
      const target = block as WalkBlock;
      if (chosen.line.filter !== currentFilter) {
        const limit = lastOfNight ? Number.POSITIVE_INFINITY : blockEnd;
        if (t + settings.filterChangeS + chosen.line.exposureS + dl > limit) {
          release(Math.ceil(t / SLOT_S), runEnd);
          close(t);
          s = runEnd - 1;
          break;
        }
        target.entries.push({
          cmd: 'filter',
          atS: t,
          durationS: settings.filterChangeS,
          filter: chosen.line.filter,
        });
        t += settings.filterChangeS;
        currentFilter = chosen.line.filter;
        ditherCount = 0;
      }
      target.entries.push({
        cmd: 'expose',
        atS: t,
        lineId: chosen.line.id,
        filter: chosen.line.filter,
        exposureS: chosen.line.exposureS,
        bonus: restOf(chosen.line) <= 0,
        lastOfNight,
      });
      t += chosen.line.exposureS + dl;
      emitted.set(chosen.line.id, (emitted.get(chosen.line.id) ?? 0) + 1);
      if (chosen.cycle) cycle.set(r, { ...chosen.cycle });
      if (multiPanel(row)) {
        const times = panelTime.get(r) ?? new Map<number, number>();
        times.set(
          chosen.panelIndex,
          (times.get(chosen.panelIndex) ?? 0) + chosen.line.exposureS + dl,
        );
        panelTime.set(r, times);
        activePanel.set(r, chosen.panelIndex);
      }
      lastLine.set(r, chosen);
      ditherCount++;
      if (
        settings.ditherEnabled &&
        settings.ditherEvery > 0 &&
        row.profile.transit === null &&
        ditherCount >= settings.ditherEvery
      )
        ditherDue = true;
      if (lastOfNight) {
        close(t);
        s = m.lastUsableSlot;
        break;
      }
    }
  }
  if (block) close(t);
  return { blocks, assignment };
}
