/**
 * S-61 Session-Detail (FK 14.3; FA-AUS-01…03, FA-AUS-06, FA-AUS-07, FA-AUS-22; NT-03, NT-E2, NT-E3;
 * AP-15): Seitenkopf (`PageHeader` mit Brotkrumen, Stilsystem AP-26d) mit Status, Beginn–Ende in
 * Standortzeit mit Kürzel, Frames und Integration; Aktionen *Korrektur erfassen* und *Als geprüft
 * markieren* (Admin, Hauptaktion rechts); Reiter in einer Karte. Reiter Soll/Ist je Zeile (Soll = erste
 * Planrevision der Session ohne Bonus, Transit-Serie als Zeitfenster; Ist = Aufnahmen dieser Session –
 * Entscheidung Sven 07.10.2026), Aufnahmen (Kennzeichen *Temperaturabweichung* und *Einstellungen abweichend*
 * mit Filter, nicht zugeordnete zuordnen), Ereignisse, Flats, Protokoll (AP-30, `SessionLogPanel`).
 * Plangrafik, Kennzahlen und Transits folgen mit ihren Paketen (R2/R3/R4).
 */
import { formatNightKey, rejectReasons } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import {
  discordApi,
  sessionsApi,
  type NightSessionCapture,
  type NightSessionDetail,
  type NightSessionLineRow,
} from '../../api/client';
import { useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SiteTime } from '../../components/SiteTime';
import { StatusBadge } from '../../components/StatusBadge';
import { Tabs } from '../../components/Tabs';
import { problemCode } from '../admin/shared';
import { SessionKpisPanel } from './SessionKpisPanel';
import { SessionLogPanel } from './SessionLogPanel';
import styles from './sessions.module.css';
import { SESSIONS_PATH, SessionTime, hours } from './SessionsPage';
import { Person, useMemberNames } from '../../lib/member';

type Tab = 'plan' | 'captures' | 'events' | 'flats' | 'log' | 'kpis';
/** Reihenfolge nach FK 14.3 (S-61). */
const TABS: readonly Tab[] = ['plan', 'events', 'captures', 'log', 'kpis', 'flats'];
type CaptureFilter = 'all' | 'deviations' | 'unassigned' | 'rejected';

export function SessionDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['sessions', 'detail', id],
    queryFn: () => sessionsApi.get(id),
  });
  const canReview = useCan('session.review');
  // Nachtbericht erneut nach Discord (FA-AUS-21, AP-60): nur Admins, nur nach dem Sessionende.
  const canResend = useCan('session.report.resend');
  const resend = useMutation({ mutationFn: () => discordApi.resendReport(id) });
  const [tab, setTab] = useState<Tab>('plan');
  const [correctLine, setCorrectLine] = useState<string | null>(null);
  const [captureFilter, setCaptureFilter] = useState<CaptureFilter>('all');
  const refresh = () => client.invalidateQueries({ queryKey: ['sessions'] });
  const review = useMutation({
    mutationFn: (reviewed: boolean) => sessionsApi.review(id, reviewed),
    onSettled: refresh,
  });

  if (detail.isPending) return <p role="status">{t('common.loading')}</p>;
  if (detail.isError)
    return (
      <ProblemMessage code={problemCode(detail.error)} onRetry={() => void detail.refetch()} />
    );
  const d = detail.data;
  const s = d.session;
  const night = formatNightKey(s.night);
  const unassigned = d.captures.filter((c) => c.assignment === 'unassigned');
  // Nur Zeilen, die der Nutzer korrigieren darf (wie `CorrectButton`); sonst antwortet die API mit 403.
  const correctable = d.rows.filter(canCorrect);
  return (
    <div className={styles.page}>
      <PageHeader
        crumbs={[{ label: t('nav.evaluation') }, { label: t('sessions.title'), to: SESSIONS_PATH }]}
        title={t('sessions.detail.title', { night, rig: s.rigName })}
        meta={
          <>
            <StatusBadge kind="session" value={s.status} size="sm" />
            <SessionTime session={s} />
            <span>
              {t('sessions.detail.summary', { frames: s.frames, hours: hours(s.integrationS) })}
            </span>
            {s.ninaInstanceName ? (
              <span>{t('sessions.detail.instance', { name: s.ninaInstanceName })}</span>
            ) : null}
            {s.createdOffline ? <span className={styles.pill}>{t('sessions.offline')}</span> : null}
            <span className={s.reviewed ? styles.pillOk : styles.pillWarn}>
              {s.reviewed ? t('sessions.reviewedYes') : t('sessions.reviewedNo')}
            </span>
          </>
        }
        actions={
          correctable.length > 0 || canReview || canResend ? (
            <>
              {correctable.length > 0 ? (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    setTab('plan');
                    setCorrectLine(correctable[0]?.exposureLineId ?? null);
                  }}
                >
                  {t('sessions.detail.correct')}
                </button>
              ) : null}
              {canReview ? (
                <button
                  type="button"
                  className={s.reviewed ? styles.button : styles.buttonPrimary}
                  disabled={review.isPending}
                  onClick={() => review.mutate(!s.reviewed)}
                >
                  {s.reviewed
                    ? t('sessions.detail.unmarkReviewed')
                    : t('sessions.detail.markReviewed')}
                </button>
              ) : null}
              {canResend && s.status !== 'running' ? (
                <button
                  type="button"
                  className={styles.button}
                  disabled={resend.isPending}
                  onClick={() => resend.mutate()}
                >
                  {t('sessions.detail.resendReport')}
                </button>
              ) : null}
            </>
          ) : null
        }
      />
      {review.error ? <ProblemMessage code={problemCode(review.error)} /> : null}
      {resend.error ? <ProblemMessage code={problemCode(resend.error)} /> : null}
      {resend.data ? (
        <p role="status" className={resend.data.channels > 0 ? styles.pillOk : styles.pillWarn}>
          {resend.data.channels > 0
            ? t('sessions.detail.resendQueued', { count: resend.data.channels })
            : t('sessions.detail.resendNoChannel')}
        </p>
      ) : null}
      {unassigned.length > 0 ? (
        <p>
          <span className={styles.pillWarn}>
            {t('sessions.detail.unassignedHint', { count: unassigned.length })}
          </span>{' '}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setTab('captures');
              setCaptureFilter('unassigned');
            }}
          >
            {t('sessions.detail.toAssign')}
          </button>
        </p>
      ) : null}

      <section className={styles.tabCard} aria-label={t('sessions.detail.tabs')}>
        <Tabs
          label={t('sessions.detail.tabs')}
          tabs={TABS.map((k) => ({ key: k, label: t(`sessions.detail.tab.${k}`) }))}
          value={tab}
          onChange={setTab}
          panelClassName={styles.tabPanel}
          panels={{
            plan: (
              <>
                {correctLine ? (
                  <CorrectionForm
                    key={correctLine}
                    sessionId={id}
                    rows={correctable}
                    initialLine={correctLine}
                    onDone={() => setCorrectLine(null)}
                  />
                ) : null}
                <p className={styles.muted}>{t('sessions.plan.definition')}</p>
                <PlanTable
                  rows={d.rows}
                  hasPlan={s.planRevision !== null}
                  siteTimeZone={s.siteTimeZone}
                  onCorrect={setCorrectLine}
                />
              </>
            ),
            captures: (
              <Captures
                detail={d}
                filter={captureFilter}
                onFilter={setCaptureFilter}
                onChanged={refresh}
              />
            ),
            events: <Events detail={d} />,
            flats: <Flats detail={d} />,
            log: <SessionLogPanel sessionId={id} siteTimeZone={s.siteTimeZone} />,
            kpis: <SessionKpisPanel detail={d} />,
          }}
        />
      </section>
    </div>
  );
}

/**
 * Soll-Zelle (07.10.2026): Anzahl ohne Bonus; Transit-Serie als Zeitfenster statt Anzahl; Zeilen, die erst
 * eine spätere Planrevision der Session eingeplant hat, mit Hinweis *später eingeplant*.
 */
function PlannedCell({
  row,
  hasPlan,
  siteTimeZone,
}: {
  row: NightSessionLineRow;
  hasPlan: boolean;
  siteTimeZone: string;
}) {
  const { t } = useTranslation();
  if (row.plannedSeries)
    return (
      <span title={t('sessions.plan.seriesHint')}>
        {row.planned ? `${row.planned} + ` : ''}
        {t('sessions.plan.series')}{' '}
        <SiteTime atUtc={row.plannedSeries.fromUtc} siteTimeZone={siteTimeZone} />
        {' – '}
        <SiteTime atUtc={row.plannedSeries.untilUtc} siteTimeZone={siteTimeZone} />
      </span>
    );
  if (row.planned === null) return <>{hasPlan ? '–' : t('sessions.detail.noPlan')}</>;
  if (!row.plannedLater) return <>{row.planned}</>;
  return (
    <>
      <span className={styles.pill} title={t('sessions.plan.plannedLaterHint')}>
        {t('sessions.plan.plannedLater')}
      </span>{' '}
      {row.planned}
    </>
  );
}

function PlanTable({
  rows,
  hasPlan,
  siteTimeZone,
  onCorrect,
}: {
  rows: readonly NightSessionLineRow[];
  hasPlan: boolean;
  siteTimeZone: string;
  onCorrect: (lineId: string) => void;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) return <p className={styles.muted}>{t('sessions.plan.empty')}</p>;
  // AP-26a: Projekt und Aktion bleiben immer sichtbar, Nebenzahlen weichen bei wenig Platz.
  const columns: DataColumn<NightSessionLineRow>[] = [
    {
      id: 'project',
      header: t('sessions.plan.col.project'),
      sortValue: (r) => r.projectName,
      cell: (r) => r.projectName,
    },
    {
      // Ersteller mit Bild neben dem Projekt (Wunsch Sven 01.10.2026).
      id: 'creator',
      header: t('sessions.col.creator'),
      priority: 2,
      cell: (r) => <Person id={r.projectCreatedBy} />,
    },
    {
      id: 'filter',
      header: t('sessions.plan.col.filter'),
      sortValue: (r) => r.filterShortName,
      cell: (r) => r.filterShortName,
    },
    {
      id: 'planned',
      header: t('sessions.plan.col.planned'),
      sortValue: (r) => r.planned,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (r) => <PlannedCell row={r} hasPlan={hasPlan} siteTimeZone={siteTimeZone} />,
    },
    {
      id: 'acquired',
      header: t('sessions.plan.col.acquired'),
      sortValue: (r) => r.acquired,
      priority: 3,
      align: 'end',
      cell: (r) => r.acquired,
    },
    {
      id: 'rejected',
      header: t('sessions.plan.col.rejected'),
      sortValue: (r) => r.rejected,
      priority: 3,
      align: 'end',
      cell: (r) => r.rejected,
    },
    {
      id: 'accepted',
      header: t('sessions.plan.col.accepted'),
      sortValue: (r) => r.accepted,
      priority: 2,
      align: 'end',
      cell: (r) => r.accepted,
    },
    {
      id: 'integration',
      header: t('sessions.plan.col.integration'),
      sortValue: (r) => r.integrationS,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (r) => t('sessions.hours', { h: hours(r.integrationS) }),
    },
    {
      id: 'bonus',
      header: t('sessions.plan.col.bonus'),
      sortValue: (r) => r.bonus,
      priority: 4,
      align: 'end',
      cell: (r) => r.bonus,
    },
    {
      id: 'bonusRejected',
      header: t('sessions.plan.col.bonusRejected'),
      sortValue: (r) => r.bonusRejected,
      priority: 4,
      align: 'end',
      cell: (r) => r.bonusRejected,
    },
    {
      id: 'action',
      header: t('sessions.plan.col.action'),
      headerHidden: true,
      cell: (r) => <CorrectButton row={r} onCorrect={onCorrect} />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.exposureLineId}
      rowLabel={(r) => `${r.projectName} · ${r.filterShortName}`}
      label={t('sessions.detail.tab.plan')}
    />
  );
}

/**
 * Darf der Nutzer die Zeile korrigieren? Die API rechnet das je Zeile mit der Mandanteneinstellung
 * `userCorrections` (`canCorrect`), die User nicht lesen dürfen – vorher zeigte die Seite den Knopf auch bei
 * abgeschalteter Einstellung, und die API antwortete 403 (28.09.2026).
 */
function canCorrect(row: NightSessionLineRow): boolean {
  return row.canCorrect;
}

function CorrectButton({
  row,
  onCorrect,
}: {
  row: NightSessionLineRow;
  onCorrect: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (!canCorrect(row)) return null;
  return (
    <button type="button" className={styles.button} onClick={() => onCorrect(row.exposureLineId)}>
      {t('sessions.plan.correctRow')}
    </button>
  );
}

function CorrectionForm({
  sessionId,
  rows,
  initialLine,
  onDone,
}: {
  sessionId: string;
  rows: readonly NightSessionLineRow[];
  initialLine: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = useMemberNames();
  const client = useQueryClient();
  const [lineId, setLineId] = useState(initialLine);
  const row = rows.find((r) => r.exposureLineId === lineId) ?? rows[0];
  // Die Korrektur gilt je Zeile und Nacht (FA-AUS-06): Untergrenze und Startwert aus den Nachtwerten,
  // nicht aus den Werten dieser Session (07.10.2026).
  const min = row?.night.rejectedIndividual ?? 0;
  const startValue = (r: NightSessionLineRow | undefined) =>
    Math.max(r?.night.rejectedIndividual ?? 0, r?.night.rejectedCorrection ?? 0);
  const [rejected, setRejected] = useState(startValue(row));
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const save = useMutation({
    mutationFn: () =>
      sessionsApi.correct(sessionId, {
        exposureLineId: lineId,
        rejected,
        reason: reason || null,
        comment: comment.trim() || null,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <form
      className={styles.form}
      aria-labelledby="correction-title"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (rejected >= min) save.mutate();
      }}
    >
      <h2 id="correction-title">{t('sessions.correction.title')}</h2>
      <p className={styles.muted}>{t('sessions.correction.hint')}</p>
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="correction-line">{t('sessions.correction.line')}</label>
          <select
            id="correction-line"
            className={styles.input}
            value={lineId}
            onChange={(e) => {
              // Zeilenwechsel: Zahl der neuen Zeile übernehmen, nicht die der vorigen senden (P1-12).
              const next = e.target.value;
              setLineId(next);
              setRejected(startValue(rows.find((r) => r.exposureLineId === next)));
              save.reset();
            }}
          >
            {rows.map((r) => (
              <option key={r.exposureLineId} value={r.exposureLineId}>
                {r.projectName}
                {nameOf(r.projectCreatedBy) ? ` (${nameOf(r.projectCreatedBy)})` : ''} ·{' '}
                {r.filterShortName}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="correction-rejected">{t('sessions.correction.rejected')}</label>
          <input
            id="correction-rejected"
            type="number"
            className={styles.input}
            min={min}
            max={row?.night.acquired ?? undefined}
            value={rejected}
            aria-describedby="correction-min"
            onChange={(e) => setRejected(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
          />
          <span id="correction-min" className={styles.muted}>
            {t('sessions.correction.minimum', { min })}
          </span>
        </div>
        <div className={styles.field}>
          <label htmlFor="correction-reason">{t('sessions.correction.reason')}</label>
          <select
            id="correction-reason"
            className={styles.input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">{t('sessions.correction.noReason')}</option>
            {rejectReasons.map((r) => (
              <option key={r} value={r}>
                {t(`sessions.correction.reasons.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="correction-comment">{t('sessions.correction.comment')}</label>
          <input
            id="correction-comment"
            className={styles.input}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.buttonPrimary}
          disabled={save.isPending || rejected < min}
        >
          {t('sessions.correction.submit')}
        </button>
        <button type="button" className={styles.button} onClick={onDone}>
          {t('sessions.correction.cancel')}
        </button>
      </div>
      {save.isSuccess ? (
        <p className={styles.success} role="status">
          {save.data.projectStatus === 'active'
            ? t('sessions.correction.reactivated')
            : t('sessions.correction.saved')}
        </p>
      ) : null}
      {save.error ? <ProblemMessage code={problemCode(save.error)} /> : null}
    </form>
  );
}

function Flags({ c }: { c: NightSessionCapture }) {
  const { t } = useTranslation();
  return (
    <span className={styles.flags}>
      {c.temperatureDeviation ? (
        <span className={styles.pillWarn}>{t('sessions.captures.temperatureDeviation')}</span>
      ) : null}
      {c.settingsDeviation ? (
        <span className={styles.pillWarn}>{t('sessions.captures.settingsDeviation')}</span>
      ) : null}
      {c.isBonus ? <span className={styles.pill}>{t('sessions.captures.bonus')}</span> : null}
      {c.rejected ? (
        <span className={styles.pillDanger}>
          {c.rejectReason
            ? t('sessions.captures.rejectedWith', {
                reason: t(`sessions.correction.reasons.${c.rejectReason}`),
              })
            : t('sessions.captures.rejected')}
        </span>
      ) : null}
      {c.assignment === 'unassigned' ? (
        <span className={styles.pillWarn}>{t('sessions.captures.unassignedFlag')}</span>
      ) : null}
    </span>
  );
}

function Captures({
  detail,
  filter,
  onFilter,
  onChanged,
}: {
  detail: NightSessionDetail;
  filter: CaptureFilter;
  onFilter: (f: CaptureFilter) => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useMemberNames();
  const zone = detail.session.siteTimeZone;
  const [rejecting, setRejecting] = useState<NightSessionCapture | null>(null);
  const list = detail.captures.filter((c) =>
    filter === 'deviations'
      ? c.temperatureDeviation || c.settingsDeviation
      : filter === 'unassigned'
        ? c.assignment === 'unassigned'
        : filter === 'rejected'
          ? c.rejected
          : true,
  );
  // Verwerfen einzelner Aufnahmen: dieselbe Berechtigung wie die Korrektur der Zeile ihres Projekts.
  const correctableProjects = new Set(detail.rows.filter(canCorrect).map((r) => r.projectId));
  const unassigned = detail.captures.filter((c) => c.assignment === 'unassigned');
  // AP-26a: Zeit bleibt immer sichtbar; Kennzeichen und Ergebnis weichen zuerst.
  const captureColumns: DataColumn<NightSessionCapture>[] = [
    {
      id: 'time',
      header: t('sessions.captures.col.time'),
      sortValue: (c) => c.capturedAt,
      nowrap: true,
      cell: (c) => <SiteTime atUtc={c.capturedAt} siteTimeZone={zone} />,
    },
    {
      id: 'type',
      header: t('sessions.captures.col.type'),
      sortValue: (c) => t(`sessions.captures.type.${c.frameType}`),
      priority: 3,
      cell: (c) => t(`sessions.captures.type.${c.frameType}`),
    },
    {
      id: 'project',
      header: t('sessions.captures.col.project'),
      sortValue: (c) => c.projectName,
      priority: 2,
      cell: (c) => c.projectName ?? '–',
    },
    {
      id: 'creator',
      header: t('sessions.col.creator'),
      priority: 3,
      cell: (c) => (c.projectCreatedBy ? <Person id={c.projectCreatedBy} /> : '–'),
    },
    {
      id: 'filter',
      header: t('sessions.captures.col.filter'),
      sortValue: (c) => c.filterShortName,
      cell: (c) => (
        <>
          {c.filterShortName}
          {c.filterActual && c.filterActual !== c.filterShortName ? (
            <span className={styles.muted}> ({c.filterActual})</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'exposure',
      header: t('sessions.captures.col.exposure'),
      sortValue: (c) => c.exposureS,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (c) => t('sessions.captures.seconds', { s: c.exposureS }),
    },
    {
      id: 'hfr',
      header: t('sessions.captures.col.hfr'),
      sortValue: (c) => c.hfr ?? -1,
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (c) =>
        c.hfr === null ? '–' : t('sessions.captures.hfrPx', { hfr: hfrText(c.hfr, i18n.language) }),
    },
    {
      id: 'stars',
      header: t('sessions.captures.col.stars'),
      sortValue: (c) => c.stars ?? -1,
      priority: 4,
      align: 'end',
      cell: (c) => (c.stars === null ? '–' : c.stars.toLocaleString(i18n.language)),
    },
    {
      id: 'result',
      header: t('sessions.captures.col.result'),
      sortValue: (c) => t(`sessions.captures.result.${c.result}`),
      priority: 4,
      cell: (c) => t(`sessions.captures.result.${c.result}`),
    },
    {
      id: 'flags',
      header: t('sessions.captures.col.flags'),
      priority: 3,
      cell: (c) => <Flags c={c} />,
    },
    {
      id: 'action',
      header: t('sessions.captures.col.action'),
      headerHidden: true,
      nowrap: true,
      cell: (c) =>
        c.frameType === 'light' && c.result === 'saved' && c.assignment === 'assigned' ? (
          <RejectButton
            capture={c}
            allowed={c.projectId !== null && correctableProjects.has(c.projectId)}
            onReject={setRejecting}
            onChanged={onChanged}
          />
        ) : null,
    },
  ];
  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.field}>
          <label htmlFor="captures-filter">{t('sessions.captures.filter')}</label>
          <select
            id="captures-filter"
            className={styles.input}
            value={filter}
            onChange={(e) => onFilter(e.target.value as CaptureFilter)}
          >
            <option value="all">{t('sessions.captures.all')}</option>
            <option value="deviations">{t('sessions.captures.deviations')}</option>
            <option value="unassigned">{t('sessions.captures.unassigned')}</option>
            <option value="rejected">{t('sessions.captures.onlyRejected')}</option>
          </select>
        </div>
        <button
          type="button"
          className={styles.button}
          disabled={list.length === 0}
          onClick={() => downloadCsv(detail, list, zone, nameOf)}
        >
          {t('sessions.captures.csv')}
        </button>
      </div>
      {rejecting ? (
        <RejectForm
          key={rejecting.id}
          capture={rejecting}
          zone={zone}
          onDone={() => setRejecting(null)}
          onChanged={onChanged}
        />
      ) : null}
      {detail.capturesTruncated ? (
        <p className={styles.muted}>
          {t('sessions.detail.truncated', { count: detail.captures.length })}
        </p>
      ) : null}
      {unassigned.length > 0 && filter !== 'deviations' ? (
        <AssignPanel detail={detail} captures={unassigned} onChanged={onChanged} />
      ) : null}
      {list.length > 0 ? <MetricsSummary captures={detail.captures} /> : null}
      {list.length === 0 ? (
        <p className={styles.muted}>{t('sessions.captures.empty')}</p>
      ) : (
        <DataTable
          columns={captureColumns}
          rows={list}
          rowKey={(c) => c.id}
          rowLabel={(c) => `${c.projectName ?? '–'} · ${c.filterShortName}`}
          label={t('sessions.detail.tab.captures')}
        />
      )}
    </>
  );
}

/**
 * *Verwerfen* bzw. *Zurücknehmen* je Aufnahme (FA-AUS-20): Rechte wie bei der Korrektur – Admins immer,
 * User für eigene Projekte; ob der Mandant das erlaubt, entscheidet die API.
 */
function RejectButton({
  capture,
  allowed,
  onReject,
  onChanged,
}: {
  capture: NightSessionCapture;
  allowed: boolean;
  onReject: (c: NightSessionCapture) => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const undo = useMutation({
    mutationFn: () => sessionsApi.reject(capture.id, false, null),
    onSettled: onChanged,
  });
  if (!allowed) return null;
  return capture.rejected ? (
    <button
      type="button"
      className={styles.linkButton}
      disabled={undo.isPending}
      onClick={() => undo.mutate()}
    >
      {t('sessions.captures.unreject')}
    </button>
  ) : (
    <button type="button" className={styles.linkButton} onClick={() => onReject(capture)}>
      {t('sessions.captures.reject')}
    </button>
  );
}

/** Grund wählen und verwerfen (FA-AUS-20); die Zähler folgen der Regel max (FA-AUS-06). */
function RejectForm({
  capture,
  zone,
  onDone,
  onChanged,
}: {
  capture: NightSessionCapture;
  zone: string;
  onDone: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const nameOf = useMemberNames();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => sessionsApi.reject(capture.id, true, reason || null),
    onSuccess: async () => {
      await onChanged();
      onDone();
    },
  });
  return (
    <form
      className={styles.form}
      aria-labelledby="reject-title"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 id="reject-title">{t('sessions.captures.rejectTitle')}</h2>
      <p className={styles.muted}>
        <SiteTime atUtc={capture.capturedAt} siteTimeZone={zone} /> · {capture.projectName ?? '–'}
        {nameOf(capture.projectCreatedBy) ? ` (${nameOf(capture.projectCreatedBy)})` : ''} ·{' '}
        {capture.filterShortName} · {t('sessions.captures.seconds', { s: capture.exposureS })}
        {capture.isBonus ? ` · ${t('sessions.captures.bonus')}` : ''}
      </p>
      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="reject-reason">{t('sessions.correction.reason')}</label>
          <select
            id="reject-reason"
            className={`${styles.input} ${styles.rigSelect}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">{t('sessions.correction.noReason')}</option>
            {rejectReasons.map((r) => (
              <option key={r} value={r}>
                {t(`sessions.correction.reasons.${r}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="submit" className={styles.buttonPrimary} disabled={save.isPending}>
          {t('sessions.captures.rejectSubmit')}
        </button>
        <button type="button" className={styles.button} onClick={onDone}>
          {t('sessions.correction.cancel')}
        </button>
      </div>
      {save.error ? <ProblemMessage code={problemCode(save.error)} /> : null}
    </form>
  );
}

/** CSV der angezeigten Aufnahmen (FA-AUS-12), Zeiten in UTC und Standortzeit. */
function downloadCsv(
  detail: NightSessionDetail,
  list: readonly NightSessionCapture[],
  zone: string,
  nameOf: (id: string | null) => string,
) {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const cell = (v: string | number | boolean | null) => {
    const text = v === null ? '' : String(v);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = [
    'capturedAtUtc',
    'capturedAtSite',
    'frameType',
    'project',
    'projectCreator',
    'filter',
    'filterActual',
    'exposureS',
    'gain',
    'offset',
    'binning',
    'result',
    'bonus',
    'rejected',
    'rejectReason',
    'temperatureDeviation',
    'settingsDeviation',
    'assignment',
    'fileName',
    'hfr',
    'stars',
  ];
  const rows = list.map((c) =>
    [
      c.capturedAt,
      local.format(new Date(Date.parse(c.capturedAt))),
      c.frameType,
      c.projectName,
      nameOf(c.projectCreatedBy),
      c.filterShortName,
      c.filterActual,
      c.exposureS,
      c.gain,
      c.offset,
      c.binning,
      c.result,
      c.isBonus,
      c.rejected,
      c.rejectReason,
      c.temperatureDeviation,
      c.settingsDeviation,
      c.assignment,
      c.fileName,
      c.hfr,
      c.stars,
    ]
      .map(cell)
      .join(';'),
  );
  const blob = new Blob([`\uFEFF${[head.join(';'), ...rows].join('\r\n')}\r\n`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${detail.session.night}-${detail.session.rigName.replace(/[^\w-]+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Nicht zugeordnete Aufnahmen einer Zeile zuordnen (FA-AUS-22, Admin); erst dann zählen sie. */
function AssignPanel({
  detail,
  captures,
  onChanged,
}: {
  detail: NightSessionDetail;
  captures: readonly NightSessionCapture[];
  onChanged: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useMemberNames();
  const canAssign = useCan('session.review');
  const zone = detail.session.siteTimeZone;
  const [choice, setChoice] = useState<Record<string, string>>({});
  const assign = useMutation({
    mutationFn: (v: { captureId: string; lineId: string }) =>
      sessionsApi.assign(v.captureId, v.lineId),
    onSettled: onChanged,
  });
  const time = (at: string) =>
    new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'de-DE', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(Date.parse(at)));
  return (
    <div className={styles.form} aria-labelledby="assign-title">
      <h2 id="assign-title">{t('sessions.captures.assignTitle')}</h2>
      <p className={styles.muted}>{t('sessions.captures.assignHint')}</p>
      {canAssign
        ? captures.map((c) => (
            <div key={c.id} className={styles.row}>
              <div className={styles.field}>
                <label htmlFor={`assign-${c.id}`}>
                  {t('sessions.captures.assignTo', { time: time(c.capturedAt) })} ·{' '}
                  {c.filterShortName}
                </label>
                <select
                  id={`assign-${c.id}`}
                  className={styles.input}
                  value={choice[c.id] ?? ''}
                  onChange={(e) => setChoice({ ...choice, [c.id]: e.target.value })}
                >
                  <option value="">{t('sessions.captures.chooseLine')}</option>
                  {detail.rows.map((r) => (
                    <option key={r.exposureLineId} value={r.exposureLineId}>
                      {r.projectName}
                      {nameOf(r.projectCreatedBy) ? ` (${nameOf(r.projectCreatedBy)})` : ''} ·{' '}
                      {r.filterShortName}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className={styles.button}
                disabled={!choice[c.id] || assign.isPending}
                onClick={() => assign.mutate({ captureId: c.id, lineId: choice[c.id] as string })}
              >
                {t('sessions.captures.assign')}
              </button>
            </div>
          ))
        : null}
      {assign.error ? <ProblemMessage code={problemCode(assign.error)} /> : null}
    </div>
  );
}

function Events({ detail }: { detail: NightSessionDetail }) {
  const { t, i18n } = useTranslation();
  const zone = detail.session.siteTimeZone;
  if (detail.events.length === 0)
    return <p className={styles.muted}>{t('sessions.events.empty')}</p>;
  const kind = (k: string) =>
    i18n.exists(`sessions.events.kind.${k}`) ? t(`sessions.events.kind.${k}`) : k;
  type SessionEvent = NightSessionDetail['events'][number];
  // AP-26a: Zeit und Art bleiben immer sichtbar; Meldung und Dauer weichen bei wenig Platz.
  const columns: DataColumn<SessionEvent>[] = [
    {
      id: 'time',
      header: t('sessions.events.col.time'),
      sortValue: (e) => e.occurredAt,
      nowrap: true,
      cell: (e) => <SiteTime atUtc={e.occurredAt} siteTimeZone={zone} />,
    },
    {
      id: 'kind',
      header: t('sessions.events.col.kind'),
      sortValue: (e) => kind(e.kind),
      cell: (e) => kind(e.kind),
    },
    {
      id: 'message',
      header: t('sessions.events.col.message'),
      sortValue: (e) => e.message,
      priority: 2,
      cell: (e) => e.message ?? '–',
    },
    {
      id: 'duration',
      header: t('sessions.events.col.duration'),
      sortValue: (e) => e.durationS,
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (e) =>
        e.durationS === null ? '–' : t('sessions.captures.seconds', { s: Math.round(e.durationS) }),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={detail.events}
      rowKey={(e) => e.id}
      rowLabel={(e) => kind(e.kind)}
      label={t('sessions.detail.tab.events')}
    />
  );
}

function Flats({ detail }: { detail: NightSessionDetail }) {
  const { t } = useTranslation();
  if (detail.flats.length === 0) return <p className={styles.muted}>{t('sessions.flats.empty')}</p>;
  type SessionFlat = NightSessionDetail['flats'][number];
  const flatKey = (f: SessionFlat) =>
    `${f.filterShortName}-${String(f.rotatorMechDeg)}-${String(f.binning)}`;
  // AP-26a: Filter bleibt immer sichtbar; Belichtung und Binning weichen zuerst.
  const columns: DataColumn<SessionFlat>[] = [
    {
      id: 'filter',
      header: t('sessions.flats.col.filter'),
      sortValue: (f) => f.filterShortName,
      cell: (f) => f.filterShortName,
    },
    {
      id: 'rotator',
      header: t('sessions.flats.col.rotator'),
      sortValue: (f) => f.rotatorMechDeg,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (f) => `${f.rotatorMechDeg.toFixed(1)}°`,
    },
    {
      id: 'binning',
      header: t('sessions.flats.col.binning'),
      sortValue: (f) => f.binning,
      priority: 3,
      align: 'end',
      cell: (f) => f.binning,
    },
    {
      id: 'flats',
      header: t('sessions.flats.col.flats'),
      sortValue: (f) => f.flatsTaken,
      align: 'end',
      nowrap: true,
      cell: (f) => `${String(f.flatsTaken)}/${String(f.flatsPlanned)}`,
    },
    {
      id: 'darkFlats',
      header: t('sessions.flats.col.darkFlats'),
      sortValue: (f) => f.darkFlatsTaken,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (f) => `${String(f.darkFlatsTaken)}/${String(f.darkFlatsPlanned)}`,
    },
    {
      id: 'exposure',
      header: t('sessions.flats.col.exposure'),
      sortValue: (f) => f.flatExposureS,
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (f) =>
        f.flatExposureS === null ? '–' : t('sessions.captures.seconds', { s: f.flatExposureS }),
    },
    {
      id: 'status',
      header: t('sessions.flats.col.status'),
      sortValue: (f) => f.status,
      cell: (f) => f.status,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={detail.flats}
      rowKey={flatKey}
      rowLabel={(f) => f.filterShortName}
      label={t('sessions.detail.tab.flats')}
    />
  );
}

/** HFR mit zwei Nachkommastellen in der Sprache der Oberfläche. */
function hfrText(hfr: number, lang: string): string {
  return hfr.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/**
 * Optionale NINA-Metriken (AP-62): Median von HFR und Sternen über die gespeicherten Lights der Session; ohne Messwerte
 * ein Hinweis, warum die Spalten leer sind.
 */
function MetricsSummary({ captures }: { captures: readonly NightSessionCapture[] }) {
  const { t, i18n } = useTranslation();
  const lights = captures.filter((c) => c.frameType === 'light' && c.result === 'saved');
  if (lights.length === 0) return null;
  const measured = lights.filter((c) => c.hfr !== null);
  const hfr = median(measured.map((c) => c.hfr as number));
  const stars = median(lights.flatMap((c) => (c.stars === null ? [] : [c.stars])));
  if (hfr === null) return <p className={styles.muted}>{t('sessions.captures.metricsMissing')}</p>;
  return (
    <p className={styles.muted} data-testid="capture-metrics">
      {t('sessions.captures.metricsSummary', {
        hfr: hfrText(hfr, i18n.language),
        stars: stars === null ? '–' : Math.round(stars).toLocaleString(i18n.language),
        count: measured.length,
      })}
    </p>
  );
}
