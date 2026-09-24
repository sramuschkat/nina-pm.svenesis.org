import type { AuthContext } from '@nina-pm/shared';
import type { SessionState } from '../auth/session';

/** Hono-Umgebung der Lambda `api`: Variablen je Anfrage. */
export interface ApiEnv {
  Variables: {
    requestId: string | undefined;
    /** Sitzungsprüfung, erst bei Bedarf ausgeführt (öffentliche Routen wie /api/health lesen die DB nie). */
    session: () => Promise<SessionState>;
    /** Ergebnis der Sitzungsprüfung nach `authorize`; `null` = anonym (TK 5.3). */
    auth: AuthContext | null;
  };
}
