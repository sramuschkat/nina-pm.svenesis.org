/**
 * VM-Prüfstand gegen den echten Server (Stufe 2a): jedes Szenario stellt Standort, Ziele und Instanz so ein, dass der
 * echte `POST /plan` sofort einen passenden Plan liefert – sonst stünde der VM-Lauf eine halbe Stunde ohne Block.
 */
import { describe, expect, it } from 'vitest';
import { startRealServer, type RealScenario } from '../src/bench/real-server';

const cases: [RealScenario, string][] = [
  ['night-flats', 'regular'],
  ['transit', 'transit'],
  ['commands', 'regular'],
  ['full-night', 'regular'],
  ['network', 'regular'],
  ['flip', 'regular'],
];

describe('Prüfstand gegen den echten Server', () => {
  it.each(cases)(
    '%s: Plugin-Token wird umgeschrieben, Plan mit %s-Block vor dem Nachtende',
    async (scenario, kind) => {
      const port = 18_900 + cases.findIndex(([s]) => s === scenario);
      const real = await startRealServer({ scenario, port, latDeg: 50, log: () => undefined });
      try {
        const call = async (path: string, method = 'GET', body?: unknown) => {
          const res = await fetch(`http://127.0.0.1:${String(port)}/api/nina/v1${path}`, {
            method,
            headers: { authorization: 'Bearer npm_test', 'content-type': 'application/json' },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          });
          return { status: res.status, body: (await res.json()) as Record<string, unknown> };
        };
        expect((await call('/bootstrap')).status).toBe(200);
        const plan = await call('/plan', 'POST', {
          night: real.info.night,
          reason: 'initial',
          pendingCaptures: [],
        });
        expect(plan.status).toBe(200);
        const blocks = plan.body.blocks as {
          kind: string;
          endUtc: string;
          entries: { cmd: string; readoutMode?: string | null }[];
        }[];
        // Nur Auslesemodi, die die Simulator-Kamera kennt (sonst `readout_mode_not_found`, Lauf 05.10.2026).
        for (const b of blocks)
          for (const e of b.entries.filter((x) => x.cmd.startsWith('expose')))
            expect(['normal1', 'normal2']).toContain(e.readoutMode);
        expect(blocks.map((b) => b.kind)).toContain(kind);
        const darknessEnd = Date.parse(plan.body.darknessEndUtc as string);
        expect(darknessEnd - Date.now()).toBeGreaterThan(20 * 60_000);
        expect(darknessEnd - Date.now()).toBeLessThan(45 * 60_000);
        for (const b of blocks) expect(Date.parse(b.endUtc)).toBeLessThanOrEqual(darknessEnd);
        // Flip im Block: der Server plant ihn nach dem Meridian (Rig ohne Rotator wie Starfront).
        if (scenario === 'flip')
          expect(blocks.flatMap((b) => b.entries.map((e) => e.cmd))).toContain('meridian_flip');
        // Aktionen der Laufdatei müssen der echte Server annehmen (Lauf 05.10.2026: `paused` → 422).
        if (scenario === 'network')
          for (const a of ['drop_network', 'restore_network'])
            await expect(real.action(a)).resolves.toBeTruthy();
        if (scenario === 'commands')
          for (const a of ['pause_running', 'refresh_targets', 'reset_plan'])
            await expect(real.action(a)).resolves.toBeTruthy();
      } finally {
        real.close();
      }
    },
    120_000,
  );
});
