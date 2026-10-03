import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BenchServer } from '../src/bench-server';

const KEY = 'k'.repeat(48);
let bench: BenchServer | undefined;

async function start() {
  bench = new BenchServer(KEY);
  const http = await bench.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
  const call = (path: string, init: RequestInit = {}, key = KEY) =>
    fetch(`${base}${path}`, { ...init, headers: { 'x-bench-key': key, ...(init.headers ?? {}) } });
  return { bench, base, call };
}

afterEach(() => bench?.close());

describe('Prüfstand-Server (Agent holt Aufträge per HTTP)', () => {
  it('ohne oder mit falschem Schlüssel 401, Einrichtungsskripte ohne Schlüssel', async () => {
    const { base, call } = await start();
    expect((await call('/agent/next', {}, 'falsch')).status).toBe(401);
    expect((await fetch(`${base}/agent/next`)).status).toBe(401);
    const setup = await fetch(`${base}/setup/NinaPmBenchAgent.ps1`);
    expect(setup.status).toBe(200);
    expect(await setup.text()).toContain('X-Bench-Key');
    expect((await fetch(`${base}/setup/../src/config.ts`)).status).toBe(401);
  });

  it('Auftrag: einreihen, abholen, Datei hochladen, Abschluss melden', async () => {
    const { bench, call } = await start();
    const out = mkdtempSync(join(tmpdir(), 'bench-'));
    expect((await call('/agent/next?nina=stopped&host=VM1')).status).toBe(204);
    expect(bench.agent?.host).toBe('VM1');

    const done = bench.enqueue('collect-log', { sinceUtc: '2026-10-03T00:00:00Z' }, out);
    const job = (await (await call('/agent/next?nina=running')).json()) as {
      id: string;
      type: string;
    };
    expect(job.type).toBe('collect-log');
    expect((await call('/agent/next')).status).toBe(204); // genau einmal ausgeliefert

    await call(`/agent/upload/${job.id}/nina.log`, {
      method: 'PUT',
      body: 'NINA-PM | PLAN reason=initial',
    });
    await call(`/agent/done/${job.id}`, {
      method: 'POST',
      body: JSON.stringify({ ok: true, message: '1 Logdatei' }),
    });
    const r = await done;
    expect(r).toMatchObject({ ok: true, message: '1 Logdatei' });
    expect(readFileSync(r.files['nina.log'] ?? '', 'utf8')).toBe('NINA-PM | PLAN reason=initial');
  });

  it('bereitgestellte Datei mit SHA-256; nicht bereitgestellte 404', async () => {
    const { bench, call } = await start();
    const dir = mkdtempSync(join(tmpdir(), 'bench-'));
    const zip = join(dir, 'nina-pm-plugin.zip');
    writeFileSync(zip, 'ZIPDATA');
    const staged = bench.stage(zip);
    const res = await call(`/files/${staged.name}`);
    expect(res.headers.get('x-sha256')).toBe(staged.sha256);
    expect(await res.text()).toBe('ZIPDATA');
    expect((await call('/files/anderes.zip')).status).toBe(404);
  });
});
