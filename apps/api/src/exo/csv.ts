/**
 * CSV nach RFC 4180 für die Katalog-Downloads (NASA TAP, ExoFOP TOI): Anführungszeichen mit eingebetteten Kommas,
 * Zeilenumbrüchen und `""`, CRLF. Zeilen mit falscher Spaltenzahl (abgeschnittener Download) werden nicht
 * stillschweigend aufgefüllt, sondern gezählt.
 */
export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
  /** Zeilen, deren Spaltenzahl nicht zur Kopfzeile passt. */
  readonly malformed: number;
}

function records(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out.filter((r) => !(r.length === 1 && r[0]?.trim() === ''));
}

/** Liest die Tabelle; fehlt eine der `required`-Spalten, bricht der Import ab (Formatwechsel der Quelle). */
export function parseCsv(text: string, required: readonly string[], source: string): CsvTable {
  const [head, ...body] = records(text.replace(/^\uFEFF/, ''));
  const header = (head ?? []).map((h) => h.trim());
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`${source}: Spalten fehlen: ${missing.join(', ')}`);
  let malformed = 0;
  const rows: Record<string, string>[] = [];
  for (const r of body) {
    if (r.length !== header.length) {
      malformed += 1;
      continue;
    }
    rows.push(Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  }
  return { header, rows, malformed };
}
