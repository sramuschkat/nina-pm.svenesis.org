/**
 * S-73 Persönliche Einstellungen und Anmeldesitzungen (FA-ADM-03, FA-LOG-08; TK 5.3): Sprache,
 * Erscheinungsbild, Dichte; Sitzungsliste mit Gerät, gekürzter IP, Beginn und letzter Aktivität,
 * *Beenden* je Sitzung und *Überall abmelden* – jeweils über den `ConfirmDialog` – sowie die letzte
 * Anmeldung. In jedem Kontext (Mandant oder System).
 */
import { DENSITIES, THEMES, type Density, type Theme } from '@nina-pm/ui-tokens';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { sessionApi, type SessionList } from '../../api/client';
import { useAppearance } from '../../app/theme';
import { useAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SYSTEM_TIMEZONE } from '../../lib/time';
import styles from '../admin/admin.module.css';
import { DateTime, problemCode, useConfirm } from '../admin/shared';

const SESSIONS_KEY = ['me', 'sessions'] as const;
type Session = SessionList['sessions'][number];

export function PersonalSettingsPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <PageHeader title={t('me.title')} />
      <Preferences />
      <Sessions />
    </div>
  );
}

function Preferences() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme, density, setDensity } = useAppearance();
  return (
    <section className={styles.panel} aria-labelledby="me-prefs">
      <h2 id="me-prefs">{t('me.preferences')}</h2>
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="me-lang">{t('header.language')}</label>
          <select
            id="me-lang"
            className={styles.input}
            value={i18n.language === 'en' ? 'en' : 'de'}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="me-theme">{t('me.theme')}</label>
          <select
            id="me-theme"
            className={styles.input}
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            {THEMES.map((x) => (
              <option key={x} value={x}>
                {t(`me.themeValue.${x}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="me-density">{t('footer.density')}</label>
          <select
            id="me-density"
            className={styles.input}
            value={density}
            onChange={(e) => setDensity(e.target.value as Density)}
          >
            {DENSITIES.map((d) => (
              <option key={d} value={d}>
                {t(`me.densityValue.${d}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

function Sessions() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { me, refresh } = useAuth();
  const zone = me?.tenant?.timeZone ?? SYSTEM_TIMEZONE;
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: () => sessionApi.list() });
  const signedOut = async () => {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    await refresh();
    await navigate('/');
  };
  const endAll = useConfirm(async () => {
    await sessionApi.endAll();
    await signedOut();
  });
  const LogOut = actionIcons.logout;
  const deviceName = (s: Session) => s.device ?? t('me.unknownDevice');
  const columns: DataColumn<Session>[] = [
    {
      id: 'device',
      header: t('me.col.device'),
      sortValue: deviceName,
      cell: (s) => (
        <>
          {deviceName(s)}{' '}
          {s.current ? <span className={styles.pillOk}>{t('me.current')}</span> : null}
        </>
      ),
    },
    {
      id: 'ip',
      header: t('me.col.ip'),
      sortValue: (s) => s.ipTruncated,
      priority: 3,
      className: styles.code,
      cell: (s) => s.ipTruncated ?? '–',
    },
    {
      id: 'created',
      header: t('me.col.created'),
      sortValue: (s) => s.createdAt,
      priority: 2,
      nowrap: true,
      cell: (s) => <DateTime at={s.createdAt} zone={zone} />,
    },
    {
      id: 'lastSeen',
      header: t('me.col.lastSeen'),
      sortValue: (s) => s.lastSeenAt,
      nowrap: true,
      cell: (s) => <DateTime at={s.lastSeenAt} zone={zone} />,
    },
    {
      id: 'actions',
      header: t('system.superUsers.col.actions'),
      headerHidden: true,
      cell: (s) => <EndSession session={s} onEndedCurrent={signedOut} />,
    },
  ];
  return (
    <section className={styles.panel} aria-labelledby="me-sessions">
      <div className={styles.head}>
        <h2 id="me-sessions">{t('me.sessions')}</h2>
        <button type="button" className={styles.buttonDanger} onClick={endAll.open}>
          <LogOut size={ICON_SIZE.button} aria-hidden />
          {t('appBar.logoutEverywhere')}
        </button>
      </div>
      {sessions.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : sessions.isError ? (
        <ProblemMessage
          code={problemCode(sessions.error)}
          onRetry={() => void sessions.refetch()}
        />
      ) : (
        <>
          <p className={styles.muted}>
            {t('me.lastLogin')} <DateTime at={sessions.data.lastLoginAt} zone={zone} />
          </p>
          <DataTable
            columns={columns}
            rows={sessions.data.sessions}
            rowKey={(s) => s.id}
            rowLabel={deviceName}
            label={t('me.sessions')}
          />
        </>
      )}
      <ConfirmDialog
        {...endAll.dialog}
        variant="danger"
        title={t('appBar.logoutEverywhereTitle')}
        consequence={t('appBar.logoutEverywhereConsequence')}
        confirmLabel={t('appBar.logoutEverywhereConfirm')}
      />
    </section>
  );
}

/** *Beenden* einer Sitzung über den `ConfirmDialog`; die eigene Sitzung meldet ab. */
function EndSession({
  session,
  onEndedCurrent,
}: {
  session: Session;
  onEndedCurrent: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const end = useConfirm(async () => {
    await sessionApi.end(session.id);
    if (session.current) await onEndedCurrent();
    else await client.invalidateQueries({ queryKey: SESSIONS_KEY });
  });
  return (
    <>
      <button type="button" className={styles.button} onClick={end.open}>
        {t('me.end')}
      </button>
      <ConfirmDialog
        {...end.dialog}
        title={session.current ? t('me.endCurrentTitle') : t('me.endTitle')}
        consequence={session.current ? t('me.endCurrentConsequence') : t('me.endConsequence')}
        confirmLabel={t('me.end')}
      />
    </>
  );
}
