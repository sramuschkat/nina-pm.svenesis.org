/** Einmal je Container erzeugen; ein Fehler wird nicht zwischengespeichert (nächster Aufruf versucht neu). */
export function lazy<T>(create: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= create().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
