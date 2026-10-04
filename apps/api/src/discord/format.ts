/**
 * Zeitangaben in Discord-Meldungen (NT-03, `ops/discord-embeds.md`): jede Uhrzeit doppelt – Standortzeit mit
 * Kürzel aus `formatTzAbbr` plus Discord-Zeitstempel `<t:UNIX:t>`, den Discord in der Zone des Lesers zeigt.
 * Nächte als Doppeldatum des Standorts („17./18.09.“), Fristen in Mandantenzeit mit `<t:UNIX:f>`.
 */
import { formatNightKey, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { resources, type Language } from '@nina-pm/i18n';

const unix = (at: Date | string) =>
  Math.floor((typeof at === 'string' ? Date.parse(at) : at.getTime()) / 1000);

/** `21:08 CDT (<t:1789697280:t>)`. */
export function siteTime(at: Date | string, timeZone: string): string {
  return `${formatZonedTime(at, timeZone)} ${formatTzAbbr(at, timeZone)} (<t:${unix(at)}:t>)`;
}

/** `21:08–02:34 CDT (<t:…:t>–<t:…:t>)`; wechselt das Kürzel in der Nacht, steht es an beiden Zeiten. */
export function siteSpan(from: Date | string, to: Date | string, timeZone: string): string {
  const a = formatTzAbbr(from, timeZone);
  const b = formatTzAbbr(to, timeZone);
  const left =
    a === b ? formatZonedTime(from, timeZone) : `${formatZonedTime(from, timeZone)} ${a}`;
  return `${left}–${formatZonedTime(to, timeZone)} ${b} (<t:${unix(from)}:t>–<t:${unix(to)}:t>)`;
}

/** Frist ohne Standortbezug: `18.09. 18:00 MESZ (<t:…:f>)`. */
export function tenantDateTime(at: Date | string, timeZone: string): string {
  const d = typeof at === 'string' ? new Date(Date.parse(at)) : at;
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}. ${get('hour')}:${get('minute')} ${formatTzAbbr(d, timeZone)} (<t:${unix(d)}:f>)`;
}

/** Relativ (`vor 12 Minuten` in der Sprache des Lesers): `<t:…:R>`. */
export const relative = (at: Date | string) => `<t:${unix(at)}:R>`;

export const nightLabel = (night: string) => formatNightKey(night);

/** Dauer in Sekunden als `2 h 05 min` bzw. `45 min`. */
export function duration(lang: Language, seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return text(lang, 'value.minutes', { m });
  return text(lang, 'value.hm', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
}

export const hours = (seconds: number) => (seconds / 3600).toFixed(1);

interface Tree {
  readonly [k: string]: string | Tree;
}

/** Text aus `discordMsg.*` in der Standardsprache des Mandanten (TK 7.7). */
export function text(lang: Language, key: string, vars: Record<string, unknown> = {}): string {
  let node: string | Tree | undefined = resources[lang].translation.discordMsg as unknown as Tree;
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') return key;
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? '' : String(v);
  });
}
