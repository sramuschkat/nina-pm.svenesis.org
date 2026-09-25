import type { NinaPrincipal } from '@nina-pm/db';
import type { AuthContext } from '@nina-pm/shared';
import type { SessionState } from '../auth/session';
import type { NinaAuthState } from '../nina/auth';

/** Hono-Umgebung der Lambda `api`: Variablen je Anfrage. */
export interface ApiEnv {
  Variables: {
    requestId: string | undefined;
    /** Sitzungsprüfung, erst bei Bedarf ausgeführt (öffentliche Routen wie /api/health lesen die DB nie). */
    session: () => Promise<SessionState>;
    /** Ergebnis der Sitzungsprüfung nach `authorize`; `null` = anonym (TK 5.3). */
    auth: AuthContext | null;
    /** Token-Prüfung der NINA-API, erst bei Bedarf ausgeführt (TK 5.6). */
    ninaAuth: () => Promise<NinaAuthState>;
    /** Instanz, Mandant und Rig des Tokens nach `ninaAuthorize`; sonst `null`. */
    nina: NinaPrincipal | null;
  };
}
