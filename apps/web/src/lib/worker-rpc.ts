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

/** Auf der Seite: Proxy mit Promise-Methoden für einen Worker bzw. Port. */
export function wrap<T extends Api>(port: Port): Remote<T> {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  port.addEventListener('message', (e: MessageEvent) => {
    const r = e.data as Reply;
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    if (r.ok) p.resolve(r.value);
    else p.reject(new Error(r.error));
  });
  return new Proxy({} as Remote<T>, {
    get:
      (_target, method: string) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          seq += 1;
          pending.set(seq, { resolve, reject });
          port.postMessage({ id: seq, method, args } satisfies Call);
        }),
  });
}
