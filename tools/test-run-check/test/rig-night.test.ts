/**
 * `pnpm rig-night:check` (ops/rig-first-night.md §5): Go/No-Go aus dem NINA-Log einer Nacht. Vorlage ist das echte
 * NINA-Log des VM-Laufs `real-night-flats` vom 05.10.2026 (nur NINA-PM-Zeilen), Standort gestaucht wie im Lauf.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRigNight, filterFromFile, type Site } from '../src/rig-night';

const LOG = readFileSync(new URL('./fixtures/rig-night-vm.log', import.meta.url), 'utf8');
const SITE: Site = { latDeg: 50, lonDeg: -57.75, timeZone: 'Etc/GMT+4' };
const failed = (text: string) =>
  checkRigNight(text, SITE)
    .checks.filter((c) => !c.ok)
    .map((c) => c.name);
const append = (line: string) =>
  `${LOG}2026-10-05T03:15:00.0000|INFO|NinaLogSink.cs|Info|11|NINA-PM | ${line}\n`;

describe('rig-night:check', () => {
  it('VM-Nacht: alles erledigt, aber Flats vor der nautischen Dämmerung (kein Warten in „Vor Flats“) → No-Go', () => {
    const r = checkRigNight(LOG, SITE);
    expect(r.night).toBe('2026-10-04');
    expect(failed(LOG)).toEqual(['Flats erst nach der nautischen Dämmerung']);
    expect(r.go).toBe(false);
    expect(r.capturesByFilter).toEqual({ LUMINANCE: 12, HA: 12 });
    expect(r.checks.find((c) => c.name.startsWith('Flats erst'))?.detail).toContain(
      'erste Flat 2026-10-05T08:09:32Z',
    );
  });

  it('ohne Flats in der Nacht → Go mit Hinweis', () => {
    const noFlats = LOG.split('\n')
      .filter((l) => !/FLATS_|type=flat|type=dark_flat|DARKFLAT_GROUP/.test(l))
      .join('\n');
    const r = checkRigNight(noFlats, SITE);
    expect(r.go).toBe(true);
    expect(r.notes.some((n) => n.startsWith('Keine Flats'))).toBe(true);
  });

  it('ERROR, Sperre und abgelehnte Anfrage sind No-Go', () => {
    expect(failed(append('ERROR code=clock_skew durationS=75'))).toContain('Keine ERROR-Zeile');
    expect(failed(append('BLOCKED reason=lease_lost'))).toContain('Keine Sperre (BLOCKED)');
    expect(failed(append('API status=409 call=sessions'))).toContain(
      'Keine vom Server abgelehnte Anfrage (4xx)',
    );
  });

  it('Outbox nicht leer am Ende → No-Go', () => {
    expect(failed(append('OUTBOX pending=3 dead=0'))).toContain('Outbox am Ende leer');
  });

  it('Filter aus dem Starfront-Dateimuster', () => {
    expect(filterFromFile('2026-10-05_06-34-10_RED_-10.00_30.00s_0541.fits')).toBe('RED');
    expect(filterFromFile('SIM_L_0208.fits')).toBe('?');
  });
});
