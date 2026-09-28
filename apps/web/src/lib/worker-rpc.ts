/**
 * Schlanke, typisierte RPC-Schicht zwischen Seite und Web Worker (AP-13f) mit derselben Form wie
 * Comlinks `expose`/`wrap`: jede Methode wird zu einer Promise. Comlink selbst ist (noch) nicht
 * installiert (neue Abhängigkeit = Paket-Download mit Freigabe); ein Austausch betrifft nur diese Datei.
 */
type Api = Record<string, (...args: never[]) => unknown>;

export type Remote<T extends Api> = {
  [K in keyof T]: (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>>;
};

interface Call {
  readonly id: number;
  readonly method: string;
  readonly args: unknown[];
}

type Reply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: string;
    };

interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  removeEventListener?(type: 'message', listener: (e: MessageEvent) => void): void;
}

/** Port auf der Seite; ein Worker meldet zusätzlich `error` und `messageerror`. */
interface ClientPort {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (e: MessageEvent) => void,
  ): void;
}

/** Im Worker: Methoden von `api` auf Nachrichten `{id, method, args}` bereitstellen. */
export function expose(api: Api, port: Port = self as unknown as Port): void {
  port.addEventListener('message', (e: MessageEvent) => {
    const call = e.data as Call;
    const fn = api[call.method];
    const reply = (r: Reply) => port.postMessage(r);
    if (!fn) {
      reply({ id: call.id, ok: false, error: `unbekannte Methode ${call.method}` });
      return;
    }
    Promise.resolve()
      .then(() => (fn as (...a: unknown[]) => unknown)(...call.args))
      .then(
        (value) => reply({ id: call.id, ok: true, value }),
        (error: unknown) =>
          reply({
            id: call.id,
            ok: false,
            error: error instanceof Error ? error.message : 'Fehler',
          }),
      );
  });
}

/** Verbindung zu einem Worker: Proxy plus Aufräumen (28.09.2026, P1-16). */
export interface Connection<T extends Api> {
  readonly remote: Remote<T>;
  /** Offene Aufrufe mit Fehler beenden; spätere Aufrufe scheitern sofort. Vor `terminate()` aufrufen. */
  dispose(reason?: string): void;
  /** `true` nach `dispose` oder einem `error`-Ereignis des Workers – dann neu anlegen. */
  readonly closed: boolean;
}

/**
 * Auf der Seite: Proxy mit Promise-Methoden für einen Worker bzw. Port. Offene Aufrufe hängen nie:
 * `dispose` (Worker wird beendet) und die Worker-Ereignisse `error`/`messageerror` beenden sie mit Fehler –
 * sonst bliebe z. B. eine TanStack-Abfrage für immer im Zustand „lädt“.
 */
export function connect<T extends Api>(port: ClientPort): Connection<T> {
  let seq = 0;
  let closed = false;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const rejectAll = (reason: string) => {
    const calls = [...pending.values()];
    pending.clear();
    for (const p of calls) p.reject(new Error(reason));
  };
  port.addEventListener('message', (e: MessageEvent) => {
    const r = e.data as Reply;
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if (r.ok) p.resolve(r.value);
    else p.reject(new Error(r.error));
  });
  // Skriptfehler im Worker: Antworten kommen nicht mehr zuverlässig – Verbindung gilt als geschlossen.
  port.addEventListener('error', () => {
    closed = true;
    rejectAll('Worker-Fehler');
  });
  // Nicht deserialisierbare Antwort: die betroffene Anfrage ist nicht zuzuordnen, also alle offenen beenden.
  port.addEventListener('messageerror', () => rejectAll('Worker-Nachricht unlesbar'));
  const remote = new Proxy({} as Remote<T>, {
    get:
      (_target, method: string) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          if (closed) {
            reject(new Error('Worker beendet'));
            return;
          }
          seq += 1;
          pending.set(seq, { resolve, reject });
          port.postMessage({ id: seq, method, args } satisfies Call);
        }),
  });
  return {
    remote,
    dispose(reason = 'Worker beendet') {
      closed = true;
      rejectAll(reason);
    },
    get closed() {
      return closed;
    },
  };
}

/** Auf der Seite: nur der Proxy (langlebige Worker ohne Aufräumen, z. B. Saison). */
export function wrap<T extends Api>(port: ClientPort): Remote<T> {
  return connect<T>(port).remote;
}
