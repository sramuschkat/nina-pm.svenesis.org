/**
 * Bahndaten für „Ereignisse der Nacht“: täglicher Abruf der TLEs von CelesTrak nach `catalog/sky/satellites.json`
 * (alles oder nichts), Prüfung von Katalognummer und Prüfsumme, Aufgabe im Zeitplan `daily`.
 */
import {
  parseCelestrakTle,
  SKY_SATELLITES_KEY,
  SkySatellitesFile,
  tleChecksumOk,
} from '@nina-pm/shared';
import { describe, expect, it, vi } from 'vitest';
import { dispatch } from '../src/worker/dispatch';
import { CELESTRAK_URL, refreshSkySatellites } from '../src/worker/sky-satellites';
import { tickTasks } from '../src/worker/tasks';

// Stand 15.09.2026 (Vorlage `data/sky-events.json`).
const TLE: Record<number, [string, string, string]> = {
  25544: [
    'ISS (ZARYA)',
    '1 25544U 98067A   26257.85283187  .00006182  00000+0  11980-3 0  9992',
    '2 25544  51.6309 216.3169 0004922 141.7352 218.3986 15.49117649585657',
  ],
  48274: [
    'CSS (TIANHE)',
    '1 48274U 21035A   26257.90474193  .00020019  00000+0  24464-3 0  9999',
    '2 48274  41.4676 137.2952 0002677 279.5609  80.4927 15.59940613307175',
  ],
  20580: [
    'HST',
    '1 20580U 90037B   26257.89051612  .00006324  00000+0  19353-3 0  9996',
    '2 20580  28.4731 187.0531 0001889  66.5175 293.5620 15.31651019802338',
  ],
};
const answer = (id: number) => `${(TLE[id] ?? []).join('\r\n')}\r\n`;
const idOf = (url: string) => Number(/CATNR=(\d+)/.exec(url)?.[1]);

describe('Bahndaten (Ereignisse der Nacht)', () => {
  it('Prüfsumme und Katalognummer', () => {
    expect(tleChecksumOk(TLE[25544]?.[1] ?? '')).toBe(true);
    const bad = `${(TLE[25544]?.[1] ?? '').slice(0, 68)}0`;
    expect(tleChecksumOk(bad)).toBe(false);
    expect(parseCelestrakTle(answer(25544), 25544)).toEqual({
      tle1: TLE[25544]?.[1],
      tle2: TLE[25544]?.[2],
    });
    // falsche Nummer, Fehlerseite, abgeschnittene Zeile
    expect(parseCelestrakTle(answer(25544), 20580)).toBeNull();
    expect(parseCelestrakTle('No GP data found', 25544)).toBeNull();
    expect(parseCelestrakTle(answer(25544).replace(/9992/, '999'), 25544)).toBeNull();
  });

  it('holt alle drei Bahnen und legt eine gültige Datei ab', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const urls: string[] = [];
    const n = await refreshSkySatellites({
      fetchText: (url) => {
        urls.push(url);
        return Promise.resolve(answer(idOf(url)));
      },
      put,
      now: () => new Date('2026-09-28T03:00:00Z'),
    });
    expect(n).toBe(3);
    expect(urls).toEqual([CELESTRAK_URL(25544), CELESTRAK_URL(48274), CELESTRAK_URL(20580)]);
    expect(urls[0]).toBe('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE');
    expect(put).toHaveBeenCalledOnce();
    const [key, body] = put.mock.calls[0] as [string, string];
    expect(key).toBe(SKY_SATELLITES_KEY);
    expect(key).toBe('catalog/sky/satellites.json');
    const file = SkySatellitesFile.parse(JSON.parse(body));
    expect(file.generated).toBe('2026-09-28T03:00:00.000Z');
    expect(file.satellites.map((s) => [s.id, s.name, s.std])).toEqual([
      [25544, 'ISS', -1.8],
      [48274, 'Tiangong', 0],
      [20580, 'Hubble', 2.2],
    ]);
  });

  it('alles oder nichts: eine ungültige Bahn → keine Datei, Fehler', async () => {
    const put = vi.fn();
    await expect(
      refreshSkySatellites({
        fetchText: (url) =>
          Promise.resolve(idOf(url) === 48274 ? 'No GP data found' : answer(idOf(url))),
        put,
        now: () => new Date('2026-09-28T03:00:00Z'),
      }),
    ).rejects.toThrow(/Tiangong/);
    expect(put).not.toHaveBeenCalled();
  });

  it('läuft im Zeitplan daily', async () => {
    const skySatellites = vi.fn().mockResolvedValue(3);
    const tasks = tickTasks(
      { queue: () => Promise.reject(new Error('nicht gebraucht')), handlers: {} },
      { cleanupInvitations: () => Promise.resolve(0), skySatellites },
    );
    expect(tasks.daily.map((t) => t.name)).toContain('sky_satellites');
    await dispatch({ tick: 'daily' }, { tasks, runJob: () => Promise.resolve() });
    expect(skySatellites).toHaveBeenCalledOnce();
  });
});
