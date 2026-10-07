/**
 * Alte Pfade der Auswertung (vor AP-64) leiten um: `/auswertung/sessions[/:id]` → Nächte bzw. Nacht,
 * `/auswertung/projektbericht` → Projekte, `/auswertung/klarnacht` → Standort-Statistik, `/auswertung/folgeplanung` →
 * „Heute Nacht“, Abschnitt „Nächste Nächte“. Die Suche (z. B. `?rig=`) bleibt erhalten – Links aus Discord-Nachrichten und
 * Lesezeichen funktionieren weiter.
 */
import { Navigate, useLocation, useParams } from 'react-router';

export function LegacyRedirect({ to, withId = false }: { to: string; withId?: boolean }) {
  const { id } = useParams();
  const location = useLocation();
  const [path, hash] = to.split('#') as [string, string | undefined];
  const target = withId && id ? `${path}/${id}` : path;
  return (
    <Navigate
      to={{ pathname: target, search: location.search, hash: hash ? `#${hash}` : location.hash }}
      replace
    />
  );
}
