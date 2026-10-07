/**
 * Laufende Nacht aus **einer** Quelle (Entscheidung Sven 07.10.2026): Hat die Rig für die laufende Nacht einen
 * gespeicherten Serverplan, zeigt das Web alles aus dem, was die Rig tatsächlich ausführt – letzte Planrevision (der
 * offene Rest ab jetzt) plus Ist (`ExecutedNight`). Zielkarten, „Nicht zugeteilt“, Kopfzahlen (Ziele · Frames),
 * Flip-Marken sowie auf „Heute Nacht“ Tabelle und Kennzahl kommen von hier. Die Rechnung ab jetzt bleibt für
 * Was-wäre-wenn (eigene Entwürfe) und Nächte ohne gespeicherten Plan.
 *
 * Offen ist ein Block des gespeicherten Plans, solange sein Ende nach „jetzt“ liegt und das Plugin ihn weder beendet
 * (`block_end`, auch leer) noch übersprungen (`block_skipped`) noch im Ist abgeschlossen hat; ebenso vorbei ist jeder
 * Block, der im Plan vor dem zuletzt begonnenen Ist-Block liegt (das Plugin arbeitet der Reihe nach – Plugins vor 0.4.13
 * melden keine Blockenden). Rein: keine Uhr, `nowMs` kommt von der Seite.
 */
import type { NightPlan, PlanBlock, PlanEntry } from '@nina-pm/engine';
import { nightUsage, type ExecutedNight, type StoredPlan } from '@nina-pm/shared';

/** Zustand eines Projekts in der laufenden Nacht. */
export type RigProjectState = 'running' | 'planned' | 'done';

export interface RigNightProject {
  readonly projectId: string;
  /** `running`: Block an der Rig läuft (jetzt im Plan bzw. laufender Ist-Block); `planned`: späterer offener Block. */
  readonly state: RigProjectState;
  /** Mit offenen Blöcken: deren Zeitraum ab jetzt; abgearbeitet: Zeitraum des Ist. */
  readonly fromUtc: string;
  /** `null`: nur ein laufender Ist-Block ohne Block im gespeicherten Plan. */
  readonly toUtc: string | null;
  /** Gespeicherte Aufnahmen der Nacht bisher (Ist). */
  readonly exposures: number;
  readonly transit: boolean;
  /** Titel aus dem Ist (Name, wenn das Projekt nicht mehr in der Eingabe steht). */
  readonly title: string;
  /** Hat offene Blöcke im gespeicherten Plan. */
  readonly open: boolean;
}

export interface RigNight {
  /** Offene Blöcke der letzten Revision, ab jetzt gekürzt (Einträge ab jetzt, Serien ab jetzt). */
  readonly blocks: readonly PlanBlock[];
  readonly projects: ReadonlyMap<string, RigNightProject>;
  /** Kommende Meridian-Flips (`meridian_flip`-Einträge der offenen Blöcke, ISO). */
  readonly flips: readonly string[];
  /** Geplante Frames des Rests (wie Prognose und Tabelle: Belichtungen ohne Bonus, Serien als ganze Belichtungen). */
  readonly frames: number;
  /** Projekte der Nacht: offene Blöcke oder Ist. */
  readonly targets: number;
  /** Gespeicherte Aufnahmen bisher. */
  readonly saved: number;
}

const ms = (iso: string) => Date.parse(iso);
const isoOf = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Eintrag gehört zum Rest ab jetzt: beginnt ab jetzt; eine Serie, solange sie läuft; das Blockende immer. */
function remains(e: PlanEntry, nowMs: number): boolean {
  if (e.cmd === 'end') return true;
  if (e.cmd === 'expose_series') return ms(e.untilUtc) > nowMs;
  return ms(e.atUtc) >= nowMs;
}

/**
 * Ab jetzt gekürzter Block: Einträge ab jetzt (eine laufende Belichtung zählt gleich im Ist), Serie ab jetzt – dieselbe
 * Grenze für Protokoll, Filterleiste, Frames und Zielkarten.
 */
function clip(b: PlanBlock, nowMs: number): PlanBlock {
  const flip = (b.meridianFlip as PlanBlock['meridianFlip'] | undefined) ?? null;
  return {
    ...b,
    panelId: b.panelId ?? null,
    startUtc: ms(b.startUtc) < nowMs ? isoOf(nowMs) : b.startUtc,
    meridianFlip: flip && ms(flip.plannedUtc) > nowMs ? flip : null,
    entries: (b.entries ?? [])
      .filter((e) => remains(e, nowMs))
      .map((e) =>
        e.cmd === 'expose_series' && ms(e.atUtc) < nowMs ? { ...e, atUtc: isoOf(nowMs) } : e,
      ),
  };
}

/**
 * Offene Blöcke der gespeicherten Revision ab jetzt (s. o.). `endedBlockIds`: vom Plugin beendete bzw. übersprungene
 * Blöcke (`GET /simulations/input`); dazu `block_skipped` aus den Ist-Ereignissen und abgeschlossene Ist-Blöcke.
 */
export function openStoredBlocks(
  stored: Pick<StoredPlan, 'blocks'>,
  executed: ExecutedNight | null | undefined,
  endedBlockIds: readonly string[] | undefined,
  nowMs: number,
): PlanBlock[] {
  const blocks = stored.blocks as unknown as readonly PlanBlock[];
  const ended = new Set(endedBlockIds ?? []);
  for (const e of executed?.events ?? [])
    if (e.kind === 'block_skipped' && e.blockId) ended.add(e.blockId);
  const running = new Set<string>();
  for (const b of executed?.blocks ?? [])
    if (b.blockId) (b.running ? running : ended).add(b.blockId);
  // Zuletzt begonnener Ist-Block: was im Plan davor liegt, ist vorbei (Plugin arbeitet der Reihe nach).
  const last = [...(executed?.blocks ?? [])].sort((a, b) => ms(a.startUtc) - ms(b.startUtc)).at(-1);
  const lastPlanned = last?.blockId ? blocks.find((b) => b.id === last.blockId) : undefined;
  const passedBefore = lastPlanned
    ? ms(lastPlanned.startUtc)
    : last
      ? ms(last.startUtc)
      : Number.NEGATIVE_INFINITY;
  return blocks
    .filter(
      (b) =>
        running.has(b.id) ||
        (ms(b.endUtc) > nowMs &&
          !ended.has(b.id) &&
          !(ms(b.startUtc) < passedBefore && b.id !== last?.blockId)),
    )
    .filter((b) => ms(b.endUtc) > nowMs)
    .map((b) => clip(b, nowMs));
}

/** Laufende Nacht mit gespeichertem Plan: offener Rest, Zustand je Projekt, Flips und Kopfzahlen; ohne Plan `null`. */
export function rigNight(o: {
  readonly executed: ExecutedNight | null | undefined;
  readonly stored: Pick<StoredPlan, 'blocks'> | null | undefined;
  readonly endedBlockIds?: readonly string[] | undefined;
  readonly nowMs: number;
}): RigNight | null {
  if (!o.stored || !Number.isFinite(o.nowMs)) return null;
  const blocks = openStoredBlocks(o.stored, o.executed, o.endedBlockIds, o.nowMs);
  const raw = new Map(
    (o.stored.blocks as unknown as readonly PlanBlock[]).map((b) => [b.id, b] as const),
  );
  // Läuft an der Rig: Block, der jetzt im gespeicherten Plan dran ist, bzw. laufender Ist-Block.
  const current = new Set<string>();
  for (const b of blocks) {
    const start = ms(raw.get(b.id)?.startUtc ?? b.startUtc);
    if (start <= o.nowMs && o.nowMs < ms(b.endUtc)) current.add(b.projectId);
  }
  for (const b of o.executed?.blocks ?? []) if (b.running) current.add(b.projectId);

  const projects = new Map<string, RigNightProject>();
  for (const b of blocks) {
    const p = projects.get(b.projectId);
    projects.set(b.projectId, {
      projectId: b.projectId,
      state: current.has(b.projectId) ? 'running' : 'planned',
      fromUtc: p && p.fromUtc < b.startUtc ? p.fromUtc : b.startUtc,
      toUtc: p?.toUtc && p.toUtc > b.endUtc ? p.toUtc : b.endUtc,
      exposures: 0,
      transit: (p?.transit ?? false) || b.kind === 'transit',
      title: '',
      open: true,
    });
  }
  for (const x of o.executed?.blocks ?? []) {
    // Bloß angefahren (ohne gespeicherte Aufnahme, kein Transit, nicht laufend): keine Karte.
    if (x.exposures === 0 && !x.running && x.kind !== 'transit') continue;
    const p = projects.get(x.projectId);
    if (p?.open) {
      projects.set(x.projectId, {
        ...p,
        exposures: p.exposures + x.exposures,
        transit: p.transit || x.kind === 'transit',
        title: p.title || x.title,
      });
      continue;
    }
    const toUtc = x.endUtc === null || p?.toUtc === null ? null : maxIso(p?.toUtc, x.endUtc);
    projects.set(x.projectId, {
      projectId: x.projectId,
      state: x.running || p?.state === 'running' ? 'running' : 'done',
      fromUtc: p && p.fromUtc < x.startUtc ? p.fromUtc : x.startUtc,
      toUtc,
      exposures: (p?.exposures ?? 0) + x.exposures,
      transit: (p?.transit ?? false) || x.kind === 'transit',
      title: p?.title || x.title,
      open: false,
    });
  }
  const usage = nightUsage({ blocks } as unknown as NightPlan);
  return {
    blocks,
    projects,
    flips: blocks.flatMap((b) =>
      b.entries
        .filter((e) => e.cmd === 'meridian_flip' && ms(e.atUtc) > o.nowMs)
        .map((e) => e.atUtc),
    ),
    frames: Object.values(usage.lineFrames).reduce((s, n) => s + n, 0),
    targets: projects.size,
    saved: o.executed?.counters.saved ?? 0,
  };
}

const maxIso = (a: string | null | undefined, b: string) => (a && a > b ? a : b);
