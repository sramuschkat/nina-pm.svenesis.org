import type { AuthContext } from '@nina-pm/shared';

/** Hono-Umgebung der Lambda `api`: Variablen je Anfrage. */
export interface ApiEnv {
  Variables: {
    requestId: string | undefined;
    /** Ergebnis der Sitzungsprüfung; `null` = anonym (TK 5.3). */
    auth: AuthContext | null;
  };
}
