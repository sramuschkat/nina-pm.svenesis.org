/**
 * Alte Pfade der Auswertung (vor AP-64) leiten um: `/auswertung/sessions[/:id]` → Nächte bzw. Session,
 * `/auswertung/projektbericht` → Projekte, `/auswertung/klarnacht` → Standort-Statistik, `/auswertung/folgeplanung` →
 * „Heute Nacht“, Abschnitt „Nächste Nächte“. Die Suche (z. B. `?rig=`) bleibt erhalten – Links aus Discord-Nachrichten und
 * Lesezeichen funktionieren weiter. Session-Links (`/auswertung/naechte/{sessionId}`) führen auf die Nacht der Session
 * (eine Seite je Nacht und Rig, Entscheidung Sven 07.10.2026) und wählen die Session vor; `?nacht=1` zeigt die ganze Nacht.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useParams } from 'react-router';
import { sessionsApi } from '../../api/client';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../admin/shared';
import { nightPath } from './evaluation';

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

export function SessionRedirect() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const location = useLocation();
  const detail = useQuery({
    queryKey: ['sessions', 'detail', id],
    queryFn: () => sessionsApi.get(id),
  });
  if (detail.isError)
    return (
      <ProblemMessage code={problemCode(detail.error)} onRetry={() => void detail.refetch()} />
    );
  if (!detail.data) return <p role="status">{t('common.loading')}</p>;
  const params = new URLSearchParams(location.search);
  const whole = params.has('nacht');
  params.delete('nacht');
  const s = detail.data.session;
  return (
    <Navigate
      to={nightPath(s.rigId, s.night, params.toString(), whole ? undefined : s.id)}
      replace
    />
  );
}
