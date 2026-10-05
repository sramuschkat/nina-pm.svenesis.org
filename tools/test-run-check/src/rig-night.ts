/**
 * `pnpm rig-night:check <nina.log …> [--site <breite>,<länge>,<zone>] [--json]` – Auswertung einer echten Nacht am Rig
 * (ops/rig-first-night.md §5): liest die NINA-PM-Zeilen der NINA-Logs der Nacht (auch mehrere Dateien nach einem
 * Neustart) und gibt ein Go/No-Go mit Begründung. Muss-Prüfungen entscheiden über Go; Hinweise zeigen, was am Morgen
 * einen Blick wert ist. Standort Standard Starfront (Dämmerungen für „Flats erst nach der nautischen Dämmerung“).
 * Exitcode 0 = Go, 1 = No-Go, 2 = Aufruf falsch.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nightTimes } from '../../../packages/engine/src/index';
import { timeZoneTransitions } from '../../../apps/api/src/lib/night-table';
import { parseLog, type LogEvent } from './log';

export interface Site {
  readonly latDeg: number;
  readonly lonDeg: number;
  readonly timeZone: string;
}

/** Starfront (Rig-Standort, ops/rig-first-night.md §1). */
export const STARFRONT: Site = { latDeg: 31.5474, lonDeg: -99.3821, timeZone: 'America/Chicago' };

export interface RigCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RigBlock {
  readonly id: string;
  readonly startUtc: string | null;
  readonly end: string | null;
  readonly captures: number;
}

export interface RigNightReport {
  readonly go: boolean;
  readonly night: string | null;
  readonly checks: RigCheck[];
  readonly notes: string[];
  readonly blocks: RigBlock[];
  readonly capturesByFilter: Record<string, number>;
  readonly twilight: {
    astronomicalDusk: string | null;
    astronomicalDawn: string | null;
    nauticalDawn: string | null;
  };
}

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Filter aus dem NINA-Dateinamen (Muster `…_$$FILTER$$_$$SENSORTEMP$$_…`, Starfront 05.10.2026); sonst `?`. */
export function filterFromFile(file: string | undefined): string {
  const m = /_([A-Za-z][A-Za-z0-9]*)_-?\d+(?:\.\d+)?_\d+(?:\.\d+)?s_\d+\.\w+$/.exec(file ?? '');
  return m?.[1] ?? '?';
}

export function checkRigNight(text: string, site: Site = STARFRONT): RigNightReport {
  const { events } = parseLog(text);
  const ev = (name: string, where: Record<string, string> = {}) =>
    events.filter(
      (e) => e.event === name && Object.entries(where).every(([k, v]) => e.fields[k] === v),
    );
  // Zeitpunkt: `atUtc` der Zeile, sonst NINAs Zeitstempel (Ortszeit des PCs) minus dessen Abstand zu UTC – abgeleitet aus
  // Zeilen mit beidem (Flat-Meldungen tragen kein `atUtc`).
  const raw = text.split(/\r?\n/);
  const local = (line: number) => {
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)/.exec(raw[line - 1] ?? '');
    return m ? Date.parse(`${m[1] ?? ''}Z`) : NaN;
  };
  const offsets = events
    .filter((e) => e.fields.atUtc)
    .map((e) => local(e.line) - Date.parse(e.fields.atUtc ?? ''))
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
  const offset = offsets.length
    ? Math.round((offsets[Math.floor(offsets.length / 2)] as number) / (15 * MIN)) * 15 * MIN
    : NaN;
  const at = (e: LogEvent | undefined) =>
    e?.fields.atUtc ? Date.parse(e.fields.atUtc) : e ? local(e.line) - offset : NaN;
  const checks: RigCheck[] = [];
  const notes: string[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // ---- Nacht und Dämmerungen ----
  const running = ev('SESSION', { status: 'running' });
  const night = running[0]?.fields.night ?? ev('PLAN')[0]?.fields.night ?? null;
  let twilight: RigNightReport['twilight'] = {
    astronomicalDusk: null,
    astronomicalDawn: null,
    nauticalDawn: null,
  };
  if (night) {
    const noon = Date.parse(`${night}T12:00:00Z`);
    const t = nightTimes({
      site: { latDeg: site.latDeg, lonDeg: site.lonDeg },
      night,
      timeZoneTransitions: timeZoneTransitions(
        site.timeZone,
        noon - 3 * 86_400_000,
        noon + 3 * 86_400_000,
      ),
    }).twilight;
    const s = (x: number | null) => (x === null ? null : iso(x * 1000));
    twilight = {
      astronomicalDusk: s(t.astronomical.startUtc),
      astronomicalDawn: s(t.astronomical.endUtc),
      nauticalDawn: s(t.nautical.endUtc),
    };
  }

  // ---- Muss: Plan, Session, Abschluss ----
  const initial = ev('PLAN').find(
    (e) => e.fields.reason === 'initial' || e.fields.reason === 'resume',
  );
  check(
    'Plan vom Server',
    initial !== undefined,
    `${String(ev('PLAN').length)} Pläne (${[...new Set(ev('PLAN').map((e) => e.fields.reason))].join(', ')})`,
  );
  check(
    'Session gestartet',
    running.length >= 1,
    `${String(running.length)}× running, Nacht ${night ?? '–'}`,
  );
  const completed = ev('SESSION', { status: 'completed' });
  const finished = ev('SESSION', { status: 'finished' });
  check(
    'Nacht regulär beendet',
    completed.length >= 1 && finished.length >= 1,
    `completed ${String(completed.length)}×, finished ${String(finished.length)}×${finished[0]?.fields.reason ? ` (reason=${finished[0].fields.reason})` : ''}`,
  );
  const outbox = ev('OUTBOX').map((e) => Number(e.fields.pending));
  const lastPending = outbox.at(-1);
  check(
    'Outbox am Ende leer',
    lastPending === 0,
    `letzter Stand pending=${String(lastPending ?? '–')}, dead=${ev('OUTBOX').at(-1)?.fields.dead ?? '–'}`,
  );

  // ---- Muss: keine Fehler, keine Sperre, nichts abgelehnt ----
  const errors = ev('ERROR');
  check(
    'Keine ERROR-Zeile',
    errors.length === 0,
    errors.map((e) => e.fields.code ?? '?').join(', ') || '–',
  );
  const blocked = ev('BLOCKED');
  check(
    'Keine Sperre (BLOCKED)',
    blocked.length === 0,
    blocked.map((e) => e.fields.reason ?? '?').join(', ') || '–',
  );
  const api = ev('API');
  const rejected = api.filter((e) => /^4\d\d$/.test(e.fields.status ?? ''));
  check(
    'Keine vom Server abgelehnte Anfrage (4xx)',
    rejected.length === 0,
    rejected.map((e) => `${e.fields.status ?? ''} ${e.fields.call ?? ''}`).join(', ') || '–',
  );
  const failed = api.filter((e) => /^5\d\d$/.test(e.fields.status ?? ''));
  if (failed.length)
    notes.push(
      `${String(failed.length)}× Serverfehler (5xx), vom Plugin wiederholt: ${[...new Set(failed.map((e) => e.fields.call))].join(', ')}`,
    );

  // ---- Muss: Aufnahmen ----
  const captures = ev('CAPTURE');
  const lights = captures.filter((e) => e.fields.result === 'saved' && !e.fields.type);
  check(
    'Lights gespeichert',
    lights.length > 0,
    `${String(lights.length)} gespeichert, ${String(captures.filter((e) => e.fields.result !== 'saved').length)} abgebrochen/verworfen`,
  );
  const capturesByFilter: Record<string, number> = {};
  for (const c of lights) {
    const f = filterFromFile(c.fields.file);
    capturesByFilter[f] = (capturesByFilter[f] ?? 0) + 1;
  }

  // ---- Muss: Flats (Starfront: erst nach der nautischen Dämmerung) ----
  const flatsStart = ev('FLATS_START').find((e) => e.fields.atUtc && !e.fields.combination);
  const flatEnds = ev('FLATS_END').filter((e) => e.fields.combination);
  if (flatsStart) {
    const skipped = flatEnds.filter((e) => e.fields.status !== 'done');
    check(
      'Flat-Kombinationen erledigt',
      flatEnds.length > 0 && skipped.length === 0,
      `${String(flatEnds.length - skipped.length)} done${skipped.length ? `, übersprungen: ${skipped.map((e) => `${e.fields.combination ?? ''} (${e.fields.reason ?? '?'})`).join(', ')}` : ''}`,
    );
    // 3 min Spielraum: NINAs *Wait for Time → Nautical Dawn* rechnet aus dem Profil und endete im VM-Lauf 05.10.2026
    // 100 s vor der Dämmerung der Engine.
    const nd = twilight.nauticalDawn ? Date.parse(twilight.nauticalDawn) : NaN;
    const firstFlat = Math.min(
      ...captures
        .filter((e) => e.fields.type === 'flat')
        .map(at)
        .filter((x) => !Number.isNaN(x)),
    );
    check(
      'Flats erst nach der nautischen Dämmerung',
      Number.isFinite(firstFlat) && !Number.isNaN(nd) && firstFlat >= nd - 3 * MIN,
      `erste Flat ${Number.isFinite(firstFlat) ? iso(firstFlat) : '–'}, nautische Dämmerung ${twilight.nauticalDawn ?? '–'}`,
    );
  } else {
    notes.push('Keine Flats in dieser Nacht (Rig-Einstellung aus oder Box „Je Kombination“ leer).');
  }

  // ---- Hinweise ----
  const warnings: Record<string, number> = {};
  for (const w of ev('WARNING'))
    warnings[w.fields.code ?? '?'] = (warnings[w.fields.code ?? '?'] ?? 0) + 1;
  if (Object.keys(warnings).length)
    notes.push(
      `Warnungen: ${Object.entries(warnings)
        .map(([k, n]) => `${k} ${String(n)}×`)
        .join(', ')}`,
    );
  const flips = ev('FLIP');
  if (flips.length)
    notes.push(
      `Flips: ${flips.map((e) => `${e.fields.pierBefore ?? '?'}→${e.fields.pierAfter ?? '?'} ${e.fields.durationS ?? '?'} s`).join(', ')}`,
    );
  const undetected = ev('FLIP_UNDETECTED');
  if (undetected.length)
    notes.push(
      `${String(undetected.length)}× flip_undetected – Flip-Einstellungen von Profil und Rig vergleichen`,
    );
  const waits = ev('WAIT_PLAN').map((e) => Number(e.fields.durationS ?? 0));
  if (waits.length)
    notes.push(
      `WAIT_PLAN ${String(waits.length)}×, zusammen ${String(Math.round(waits.reduce((a, b) => a + b, 0) / 60))} min (Plugin war schneller als geplant)`,
    );
  const skippedBlocks = [...ev('BLOCK_SKIPPED'), ...ev('SKIPPED_TIMEAWARE')];
  if (skippedBlocks.length)
    notes.push(
      `Übersprungen: ${skippedBlocks.map((e) => `${e.event} ${e.fields.reason ?? ''}`.trim()).join(', ')}`,
    );
  const pauses = ev('SAFETY_PAUSE');
  if (pauses.length)
    notes.push(
      `Safety: ${String(pauses.length)}× unterbrochen (${pauses.map((e) => e.fields.atUtc ?? '?').join(', ')}), ${String(ev('SAFETY_RESUME').length)}× fortgesetzt`,
    );
  const dusk = twilight.astronomicalDusk ? Date.parse(twilight.astronomicalDusk) : NaN;
  const dawn = twilight.astronomicalDawn ? Date.parse(twilight.astronomicalDawn) : NaN;
  const lightTimes = lights
    .map(at)
    .filter((x) => !Number.isNaN(x))
    .sort((a, b) => a - b);
  if (lightTimes.length && !Number.isNaN(dusk) && !Number.isNaN(dawn)) {
    const first = lightTimes[0] as number;
    const last = lightTimes.at(-1) as number;
    notes.push(
      `Dunkelheit ${iso(dusk)} – ${iso(dawn)}; erstes Light ${String(Math.round((first - dusk) / MIN))} min nach Beginn, letztes ${String(Math.round((dawn - last) / MIN))} min vor dem Ende`,
    );
  }

  // ---- Blöcke ----
  const blocks: RigBlock[] = ev('BLOCK_START').map((s) => {
    const end = events.find(
      (e) => e.event === 'BLOCK_END' && e.fields.id === s.fields.id && e.line > s.line,
    );
    const endLine = end?.line ?? Infinity;
    return {
      id: s.fields.id ?? '?',
      startUtc: s.fields.atUtc ?? null,
      end: end?.fields.reason ?? null,
      captures: lights.filter((c) => c.line > s.line && c.line < endLine).length,
    };
  });
  const interrupted = blocks.filter((b) => b.end && !['completed', 'interrupted'].includes(b.end));
  if (interrupted.length)
    notes.push(
      `Blöcke mit besonderem Ende: ${interrupted.map((b) => `${b.end ?? ''}`).join(', ')}`,
    );

  return {
    go: checks.every((c) => c.ok),
    night,
    checks,
    notes,
    blocks,
    capturesByFilter,
    twilight,
  };
}

/** Logdateien: einzelne Dateien oder alle `*.log` eines Ordners, nach Namen sortiert (NINA legt je Start eine Datei an). */
export function readLogs(paths: readonly string[]): string {
  const files = paths.flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p)
          .filter((f) => f.endsWith('.log'))
          .sort()
          .map((f) => join(p, f))
      : [p],
  );
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

function main(): number {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const siteAt = args.indexOf('--site');
  let site = STARFRONT;
  if (siteAt >= 0) {
    const [lat, lon, zone] = (args[siteAt + 1] ?? '').split(',');
    site = { latDeg: Number(lat), lonDeg: Number(lon), timeZone: zone ?? 'UTC' };
  }
  const paths = args
    .filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--site')
    .map((p) => resolve(p));
  if (paths.length === 0) {
    console.error(
      'Aufruf: pnpm rig-night:check <nina.log oder Ordner …> [--site <breite>,<länge>,<zone>] [--json]',
    );
    return 2;
  }
  const r = checkRigNight(readLogs(paths), site);
  if (json) {
    console.log(JSON.stringify(r, null, 2));
    return r.go ? 0 : 1;
  }
  console.log(`${r.go ? '✓ GO' : '✗ NO-GO'} – Nacht ${r.night ?? '?'}`);
  for (const c of r.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name} – ${c.detail}`);
  console.log(
    `  Lights je Filter: ${
      Object.entries(r.capturesByFilter)
        .map(([f, n]) => `${f} ${String(n)}`)
        .join(', ') || '–'
    }`,
  );
  console.log(
    `  Blöcke: ${String(r.blocks.length)} (${r.blocks.map((b) => `${String(b.captures)} Lights/${b.end ?? 'offen'}`).join(', ')})`,
  );
  for (const n of r.notes) console.log(`  · ${n}`);
  return r.go ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(main());
