/**
 * Planprotokoll S-40 (FA-SIM-08): Spalten, Zellwerte und Export als CSV (Semikolon, Excel-tauglich) bzw.
 * Tab-getrennt zum Kopieren. Zeiten in Standortzeit mit Kürzel (NT-03).
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import type { TFunction } from 'i18next';
import { moonProfileLabel } from '../../lib/moon-profile-label';
import type { ProtocolRow } from './simulate';

export const PROTOCOL_COLUMNS = [
  'time',
  'cmd',
  'target',
  'panel',
  'no',
  'filter',
  'exposure',
  'gain',
  'offset',
  'binning',
  'readout',
  'rotation',
  'ra',
  'dec',
  'alt',
  'moonSep',
  'moonOk',
  'required',
  'dark',
  'la',
  'profile',
] as const;
export type ProtocolColumn = (typeof PROTOCOL_COLUMNS)[number];

/** „21:08:00 CDT“ – Uhrzeit mit Sekunden und Kürzel in der Standortzone. */
export function siteClock(atUtc: string, timeZone: string): string {
  const hm = formatZonedTime(atUtc, timeZone);
  return `${hm}:${atUtc.slice(17, 19)} ${formatTzAbbr(atUtc, timeZone)}`;
}

const num = (x: number | null, digits = 1) => (x === null ? '' : x.toFixed(digits));

export function cell(
  row: ProtocolRow,
  col: ProtocolColumn,
  t: TFunction,
  timeZone: string,
): string {
  const yesNo = (v: boolean | null) =>
    v === null ? '' : v ? t('simulator.yes') : t('simulator.no');
  switch (col) {
    case 'time':
      return siteClock(row.atUtc, timeZone);
    case 'cmd': {
      const name = t(`simulator.cmd.${row.cmd}`, { defaultValue: row.cmd });
      const until = row.untilUtc
        ? ` ${t('simulator.until', { time: siteClock(row.untilUtc, timeZone) })}`
        : '';
      const dur =
        row.durationS !== null && row.durationS > 0 ? ` (${String(row.durationS)} s)` : '';
      return `${name}${until}${dur}${row.bonus ? ` · ${t('simulator.bonus')}` : ''}`;
    }
    case 'target':
      return row.projectName;
    case 'panel':
      return row.panel;
    case 'no':
      return row.no === null ? '' : String(row.no);
    case 'filter':
      return row.filter;
    case 'exposure':
      return row.exposureS === null ? '' : `${String(row.exposureS)} s`;
    case 'gain':
      return row.gain === null ? '' : String(row.gain);
    case 'offset':
      return row.offset === null ? '' : String(row.offset);
    case 'binning':
      return row.binning === null ? '' : `${String(row.binning)}×${String(row.binning)}`;
    case 'readout':
      return row.readoutMode ?? '';
    case 'rotation':
      return num(row.rotationDeg);
    case 'ra':
      return num(row.raDeg, 4);
    case 'dec':
      return num(row.decDeg, 4);
    case 'alt':
      return num(row.altDeg);
    case 'moonSep':
      return num(row.moonSepDeg);
    case 'moonOk':
      return yesNo(row.moonOk);
    case 'required':
      return num(row.requiredSepDeg);
    case 'dark':
      return yesNo(row.dark);
    case 'la':
      return yesNo(row.la);
    case 'profile':
      return moonProfileLabel(t, row.moonProfile);
  }
}

function table(rows: readonly ProtocolRow[], t: TFunction, timeZone: string): string[][] {
  return [
    PROTOCOL_COLUMNS.map((c) => t(`simulator.col.${c}`)),
    ...rows.map((r) => PROTOCOL_COLUMNS.map((c) => cell(r, c, t, timeZone))),
  ];
}

/** CSV mit Semikolon; Felder mit Semikolon, Anführungszeichen oder Zeilenumbruch in Anführungszeichen. */
export function protocolCsv(rows: readonly ProtocolRow[], t: TFunction, timeZone: string): string {
  const quote = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${table(rows, t, timeZone)
    .map((r) => r.map(quote).join(';'))
    .join('\r\n')}\r\n`;
}

/** Tab-getrennt zum Einfügen in Tabellenkalkulationen. */
export function protocolTsv(rows: readonly ProtocolRow[], t: TFunction, timeZone: string): string {
  return table(rows, t, timeZone)
    .map((r) => r.map((v) => v.replace(/[\t\n]/g, ' ')).join('\t'))
    .join('\n');
}
