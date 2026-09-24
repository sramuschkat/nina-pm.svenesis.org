/** Dateigrößen in SI-Einheiten (1 kB = 1.000 Byte) in der Sprache der Oberfläche: „12,4 MB“. */
const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number, lang: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const text = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-DE', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
  return `${text} ${UNITS[unit]}`;
}
