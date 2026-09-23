import { checks as defaultChecks, type Check, type CheckContext } from './checks';
import { Recorder, type CheckRecord, type Protocol, type SqlClient } from './protocol';

export interface RunSpikeOptions {
  connect(user: string): Promise<SqlClient>;
  connectPlain(user: string): Promise<SqlClient>;
  readonly iamPrincipalArn: string;
  readonly skipLong: boolean;
  readonly protocol: Protocol;
  readonly checks?: readonly Check[];
  readonly log?: (line: string) => void;
  readonly now?: () => number;
}

/**
 * Führt alle Prüfpunkte nacheinander aus. Ein scheiternder Prüfpunkt bricht den Lauf nicht ab,
 * er wird als „Fehler“ protokolliert. Das Protokoll wird fortlaufend im übergebenen Objekt gefüllt,
 * damit auch ein abgebrochener Lauf verwertbar bleibt.
 */
export async function runSpike(opts: RunSpikeOptions): Promise<Protocol> {
  const log = opts.log ?? console.log;
  const now = opts.now ?? (() => performance.now());
  const list = opts.checks ?? defaultChecks;
  const rec = new Recorder(now);

  const t0 = now();
  const admin = await opts.connect('admin');
  opts.protocol.notes.push(
    `Erste Verbindung als admin über den Connector: ${Math.round(now() - t0)} ms`,
  );
  try {
    const ctx: CheckContext = {
      rec,
      admin,
      connect: opts.connect,
      connectPlain: opts.connectPlain,
      iamPrincipalArn: opts.iamPrincipalArn,
      skipLong: opts.skipLong,
      now,
    };
    for (const check of list) {
      log(`▶ ${check.id} ${check.title}`);
      const started = now();
      let summary: string;
      let failed = false;
      try {
        summary = await check.run(ctx);
      } catch (error) {
        failed = true;
        summary = `Abbruch: ${error instanceof Error ? error.message : String(error)}`;
      }
      const steps = rec.reset();
      const record: CheckRecord = {
        id: check.id,
        title: check.title,
        tk: check.tk,
        verdict: failed ? 'Fehler' : steps.every((s) => s.matched) ? 'bestätigt' : 'abweichend',
        summary,
        steps,
        durationMs: Math.round(now() - started),
      };
      opts.protocol.checks.push(record);
      log(`  ${record.verdict}: ${summary}`);
    }
  } finally {
    try {
      await admin.end();
    } catch {
      /* bereits geschlossen */
    }
  }
  return opts.protocol;
}
