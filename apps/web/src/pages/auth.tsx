/**
 * S-01 Anmeldung (FK 14.3): Einstiegsseite mit „Mit Discord anmelden“, S-01b Mandantenauswahl,
 * S-01c Kein Zugang, S-01d Einladung annehmen. Anmeldung als Top-Level-Navigation (kein fetch), `next`
 * nur relativ (TK 5.2).
 */
import { safeNext } from '@nina-pm/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { ApiError, discordLoginUrl, useAuth } from '../auth';
import { ProblemMessage } from '../components/ProblemMessage';
import { SiteTime } from '../components/SiteTime';
import { LogoMark, TextLayout } from '../layout/Frame';
import styles from './pages.module.css';

function DiscordMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 0 13.5.3 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.6-3.6-13.6ZM8.7 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm6.6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"
      />
    </svg>
  );
}

function DiscordButton({
  label,
  next,
  tenantKey,
  onBefore,
}: {
  label: string;
  next: string;
  tenantKey?: string | undefined;
  onBefore?: () => Promise<unknown>;
}) {
  return (
    <a
      className={styles.discordButton}
      href={discordLoginUrl(next, tenantKey)}
      onClick={(e) => {
        if (!onBefore) return;
        e.preventDefault();
        const target = e.currentTarget.href;
        void onBefore().then(() => window.location.assign(target));
      }}
    >
      <DiscordMark />
      {label}
    </a>
  );
}

/** Einstiegsseite `/` für Anonyme (FA-WEB-02). */
export function LoginPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const failed = params.get('anmeldung') === 'fehler';
  return (
    <TextLayout>
      <section className={styles.hero}>
        <LogoMark size={56} />
        <h1>{t('auth.loginTitle')}</h1>
        <p className={styles.lead}>{t('auth.loginLead')}</p>
        {failed ? <ProblemMessage code="auth.unauthenticated" /> : null}
        {failed ? <p className={styles.hint}>{t('auth.loginFailed')}</p> : null}
        <DiscordButton
          label={t('auth.loginButton')}
          next={next}
          tenantKey={params.get('mandant') ?? undefined}
        />
        <p className={styles.note}>
          <Trans i18nKey="auth.loginPrivacy" components={{ privacy: <Link to="/datenschutz" /> }} />
        </p>
      </section>
    </TextLayout>
  );
}

/** S-01b Mandantenauswahl: Karten je Mitgliedschaft; Super User zusätzlich „System“. */
export function SelectTenantPage() {
  const { t } = useTranslation();
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const choose = useMutation({
    mutationFn: (body: { tenantKey: string } | { system: true }) => api.setContext(body),
    onSuccess: async () => {
      await refresh();
      await navigate(next);
    },
  });
  if (me === undefined)
    return (
      <TextLayout>
        <p>{t('common.loading')}</p>
      </TextLayout>
    );
  if (me === null)
    return <Navigate to={`/?next=${encodeURIComponent(`/mandant-waehlen`)}`} replace />;
  const error = choose.error instanceof ApiError ? choose.error.problem : null;
  return (
    <TextLayout crumbs={[{ label: t('auth.selectTitle') }]}>
      <h1>{t('auth.selectTitle')}</h1>
      <p className={styles.lead}>{t('auth.selectLead')}</p>
      {error ? (
        <ProblemMessage
          code={error.code === 'auth.mfa_required' ? 'auth.mfa_required' : error.code}
          requestId={error.requestId}
        />
      ) : null}
      <ul className={styles.cards}>
        {me.memberships.map((m) => {
          const current = me.tenant?.key === m.tenantKey;
          return (
            <li key={m.tenantKey}>
              <button
                type="button"
                className={styles.cardButton}
                disabled={choose.isPending}
                onClick={() => choose.mutate({ tenantKey: m.tenantKey })}
                aria-current={current || undefined}
              >
                <span className={styles.cardTitle}>{m.tenantName}</span>
                <span className={styles.cardMeta}>
                  {t('auth.selectRole', { role: t(`appBar.role.${m.role}`) })}
                </span>
                {current ? (
                  <span className={styles.cardBadge}>{t('auth.selectCurrent')}</span>
                ) : null}
              </button>
            </li>
          );
        })}
        {me.isSuperUser ? (
          <li>
            <button
              type="button"
              className={styles.cardButton}
              disabled={choose.isPending}
              onClick={() => choose.mutate({ system: true })}
              aria-current={me.context === 'system' || undefined}
            >
              <span className={styles.cardTitle}>{t('auth.selectSystem')}</span>
              <span className={styles.cardMeta}>
                {me.identity.mfa ? t('auth.selectSystemHint') : t('auth.systemNeedsMfa')}
              </span>
            </button>
          </li>
        ) : null}
      </ul>
    </TextLayout>
  );
}

/** S-01c Kein Zugang (FA-LOG-04). */
export function NoAccessPage() {
  const { t } = useTranslation();
  const { me, blocked } = useAuth();
  const [params] = useSearchParams();
  const invitationError = params.get('einladung');
  const isBlocked = blocked || params.get('grund') === 'gesperrt';
  const name = me ? (me.identity.globalName ?? me.identity.username) : '';
  return (
    <TextLayout crumbs={[{ label: t('auth.noAccessTitle') }]}>
      <h1>{t('auth.noAccessTitle')}</h1>
      {invitationError ? <ProblemMessage code={invitationError} /> : null}
      <p className={styles.lead}>
        {isBlocked
          ? t('auth.noAccessBlocked')
          : me
            ? t('auth.noAccessText', { name })
            : t('auth.noAccessAnonymous')}
      </p>
      {!me && !isBlocked ? <DiscordButton label={t('auth.loginButton')} next="/" /> : null}
    </TextLayout>
  );
}

/**
 * S-01d Einladung annehmen: Token aus dem Fragment `#<token>` (erreicht keine Logs, DAT-20), sofort aus
 * der Adresszeile entfernt; Vorschau über `POST /auth/invitations/preview`, danach Vormerken
 * (`POST /auth/invitation/claim`) und Anmeldung mit Discord – eingelöst wird im Callback.
 */
export function InvitationPage() {
  const { t } = useTranslation();
  const [token] = useState(() => window.location.hash.replace(/^#/, ''));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const preview = useQuery({
    queryKey: ['invitation', 'preview', token],
    queryFn: () => api.previewInvitation(token),
    enabled: valid,
    retry: false,
  });
  const problem = preview.error instanceof ApiError ? preview.error.problem : null;
  return (
    <TextLayout crumbs={[{ label: t('auth.invitationTitle') }]}>
      <h1>{t('auth.invitationTitle')}</h1>
      {!valid ? <p className={styles.lead}>{t('auth.invitationMissing')}</p> : null}
      {valid && preview.isPending ? <p>{t('common.loading')}</p> : null}
      {problem ? <ProblemMessage code={problem.code} requestId={problem.requestId} /> : null}
      {preview.data ? (
        <>
          <p className={styles.lead}>{t('auth.invitationLead')}</p>
          <dl className={styles.facts}>
            <dt>{t('auth.invitationTenant')}</dt>
            <dd>{preview.data.tenantName}</dd>
            <dt>{t('auth.invitationRole')}</dt>
            <dd>{t(`appBar.role.${preview.data.role}`)}</dd>
            <dt>{t('auth.invitationExpires')}</dt>
            <dd>
              {/* Vor dem Beitritt ist die Mandantenzeit unbekannt: Anzeige in der Browserzone mit Kürzel. */}
              <SiteTime
                atUtc={preview.data.expiresAt}
                siteTimeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
                withDate
              />
            </dd>
          </dl>
          <DiscordButton
            label={t('auth.invitationAccept')}
            next="/"
            onBefore={() => api.claimInvitation(token)}
          />
        </>
      ) : null}
    </TextLayout>
  );
}
