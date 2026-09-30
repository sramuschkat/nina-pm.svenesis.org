/**
 * Auszüge der echten Katalogantworten vom 29.09.2026 (`samples/`): Testdaten der Parser und Startbestand des
 * lokalen Stacks (`pnpm dev:api`, E2E), damit die Transitsuche S-22 ohne Netzzugriff Treffer hat. Nur Node –
 * nicht im Lambda-Bundle.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { replaceExoCatalog, type OpenDatabase } from '@nina-pm/db';
import { EXO_PREFILTER_DEFAULT } from '@nina-pm/shared';
import { parseExoClock, parseNasa, parseToi } from './parse';

export const readExoSample = (
  name: 'exoclock-sample.json' | 'nasa-sample.csv' | 'toi-sample.csv',
) => readFileSync(fileURLToPath(new URL(`./samples/${name}`, import.meta.url)), 'utf8');

/** Schreibt die drei Auszüge nach `exo_catalog_entry` (Vorfilter mit der Vorgabe). */
export async function importExoSamples(db: OpenDatabase['db'], now: Date): Promise<number> {
  const f = EXO_PREFILTER_DEFAULT;
  const parsed = {
    exoclock: parseExoClock(JSON.parse(readExoSample('exoclock-sample.json')) as unknown, f),
    nasa: parseNasa(readExoSample('nasa-sample.csv'), f),
    toi: parseToi(readExoSample('toi-sample.csv'), f),
  } as const;
  let rows = 0;
  for (const catalog of ['exoclock', 'nasa', 'toi'] as const) {
    rows += (await replaceExoCatalog(db, catalog, parsed[catalog].rows, now)).written;
  }
  return rows;
}
