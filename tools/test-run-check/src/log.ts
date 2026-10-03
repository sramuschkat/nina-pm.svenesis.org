/**
 * Log-Grammatik der Plugin-Protokolle (ops/plugin-test-protocol.md, „Log-Grammatik“, NIN5-15):
 * `NINA-PM | EVENT key=value key="Wert mit Leerzeichen"`. Zeilen dürfen aus dem rohen `nina.log` stammen;
 * gelesen wird ab dem Präfix `NINA-PM |`, alles davor (Zeitstempel, Quelle von NINAs Logger) bleibt außen vor.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface LogEvent {
  /** Zeilennummer im Log (ab 1). */
  readonly line: number;
  readonly event: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface ParseResult {
  readonly events: LogEvent[];
  /** Zeilen mit Präfix, die der Grammatik nicht folgen oder unbekannte Ereignisse/Schlüssel tragen. */
  readonly violations: string[];
}

/** Betriebszeilen zusätzlich zu den `sessionEventKinds` (Protokoll-Dokument, „Erlaubte Ereignisnamen“). */
const OPERATION_LINES = [
  'PLAN',
  'API',
  'LEASE',
  'HEARTBEAT',
  'OUTBOX',
  'READOUT',
  'CAPTURE',
  'SESSION',
  'TARGETS',
  'BLOCKED',
  'FLATS_RESUME',
  'DARKFLAT_GROUP',
  'COPY',
  'TRIGGER',
] as const;

/** Verbindliche Schlüsselnamen (Tabelle „Schlüsselnamen“). */
export const KEYS: ReadonlySet<string> = new Set([
  'id',
  'block',
  'plan',
  'session',
  'reason',
  'state',
  'status',
  'call',
  'result',
  'file',
  'filter',
  'short',
  'mode',
  'name',
  'index',
  'type',
  'box',
  'pierBefore',
  'pierAfter',
  'durationS',
  'pending',
  'dead',
  'combination',
  'missing',
  'mechDg',
  'source',
  'etag',
  'atUtc',
  'untilUtc',
  'code',
  'night',
  'checks',
]);

const ENUMS = fileURLToPath(new URL('../../../docs/contracts/enums.json', import.meta.url));

/** Erlaubte Ereignisnamen: `sessionEventKinds` in Großbuchstaben plus Betriebszeilen. */
export function allowedEvents(): ReadonlySet<string> {
  const enums = JSON.parse(readFileSync(ENUMS, 'utf8')) as { sessionEventKinds: string[] };
  return new Set([...enums.sessionEventKinds.map((k) => k.toUpperCase()), ...OPERATION_LINES]);
}

const PREFIX = 'NINA-PM |';
const EVENT = /^([A-Z][A-Z0-9_]*)(?:\s+(.*))?$/;
const PAIR = /\s*([A-Za-z][A-Za-z0-9]*)=("(?:[^"\\]|\\.)*"|[^\s"]+)/y;

export function parseLog(text: string, events = allowedEvents()): ParseResult {
  const out: LogEvent[] = [];
  const violations: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const at = raw.indexOf(PREFIX);
    if (at < 0) return;
    const line = i + 1;
    const body = raw.slice(at + PREFIX.length).trim();
    const m = EVENT.exec(body);
    if (!m) {
      violations.push(`Zeile ${String(line)}: kein Ereignisname in „${body}“`);
      return;
    }
    const event = m[1] as string;
    const rest = m[2] ?? '';
    const fields: Record<string, string> = {};
    PAIR.lastIndex = 0;
    let pos = 0;
    while (pos < rest.length) {
      PAIR.lastIndex = pos;
      const p = PAIR.exec(rest);
      if (!p) {
        violations.push(`Zeile ${String(line)}: ${event} – nicht lesbar ab „${rest.slice(pos)}“`);
        break;
      }
      const key = p[1] as string;
      const value = p[2] as string;
      fields[key] = value.startsWith('"') ? value.slice(1, -1).replace(/\\(.)/g, '$1') : value;
      if (!KEYS.has(key))
        violations.push(`Zeile ${String(line)}: ${event} – unbekannter Schlüssel ${key}`);
      pos = PAIR.lastIndex;
      while (rest[pos] === ' ') pos++;
    }
    if (!events.has(event)) violations.push(`Zeile ${String(line)}: unbekanntes Ereignis ${event}`);
    out.push({ line, event, fields });
  });
  return { events: out, violations };
}
