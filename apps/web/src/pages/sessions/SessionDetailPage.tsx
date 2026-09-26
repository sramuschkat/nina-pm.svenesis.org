/**
 * S-61 Session-Detail (FK 14.3; FA-AUS-01…03, FA-AUS-06, FA-AUS-07, FA-AUS-22; NT-03, NT-E2, NT-E3;
 * AP-15): Seitenkopf (`PageHeader` mit Brotkrumen, Stilsystem AP-26d) mit Status, Beginn–Ende in
 * Standortzeit mit Kürzel, Frames und Integration; Aktionen *Korrektur erfassen* und *Als geprüft
 * markieren* (Admin, Hauptaktion rechts); Reiter in einer Karte. Reiter Soll/Ist je Zeile (Soll aus der
 * ersten Planrevision), Aufnahmen (Kennzeichen *Temperaturabweichung* und *Einstellungen abweichend*
 * mit Filter, nicht zugeordnete zuordnen), Ereignisse, Flats, Protokoll (AP-30, `SessionLogPanel`).
 * Plangrafik, Kennzahlen und Transits folgen mit ihren Paketen (R2/R3/R4).
 */
import { formatNightKey, rejectReasons } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import {
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
import { SessionLogPanel } from './SessionLogPanel';
import styles from './sessions.module.css';
import { SESSIONS_PATH, SessionTime, hours } from './SessionsPage';

type Tab = 'plan' | 'captures' | 'events' | 'flats' | 'log';
const TABS: readonly Tab[] = ['plan', 'captures', 'events', 'log', 'flats'];

export function SessionDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['sessions', 'detail', id],
    queryFn: () => sessionsApi.get(id),
  });
  const canReview = useCan('session.review');
  const [tab, setTab] = useState<Tab>('plan');
  const [correctLine, setCorrectLine] = useState<string | null>(null);
  const [captureFilter, setCaptureFilter] = useState<'all' | 'deviations' | 'unassigned'>('all');
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
          d.rows.length > 0 || canReview ? (
            <>
              {d.rows.length > 0 ? (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => {
                    setTab('plan');
                    setCorrectLine(d.rows[0]?.exposureLineId ?? null);
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
            </>
          ) : null
        }
      />
      {review.error ? <ProblemMessage code={problemCode(review.error)} /> : null}
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
                    rows={d.rows}
                    initialLine={correctLine}
                    onDone={() => setCorrectLine(null)}
                  />
                ) : null}
                <PlanTable
                  rows={d.rows}
                  hasPlan={s.planRevision !== null}
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
          }}
        />
      </section>
    </div>
  );
}

function PlanTable({
  rows,
  hasPlan,
  onCorrect,
}: {
  rows: readonly NightSessionLineRow[];
  hasPlan: boolean;
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
      cell: (r) => r.planned ?? (hasPlan ? '–' : t('sessions.detail.noPlan')),
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

/** Admins immer; User nur für eigene Projekte – ob der Mandant das erlaubt, entscheidet die API. */
function CorrectButton({
  row,
  onCorrect,
}: {
  row: NightSessionLineRow;
  onCorrect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const allowed = useCan('session.correct', {
    ...(row.projectCreatedBy ? { createdBy: row.projectCreatedBy } : {}),
    settings: { userCorrections: true },
  });
  if (!allowed) return null;
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
  const client = useQueryClient();
  const [lineId, setLineId] = useState(initialLine);
  const row = rows.find((r) => r.exposureLineId === lineId) ?? rows[0];
  const min = row?.rejectedIndividual ?? 0;
  const [rejected, setRejected] = useState(Math.max(min, row?.rejectedCorrection ?? 0));
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
            onChange={(e) => setLineId(e.target.value)}
          >
            {rows.map((r) => (
              <option key={r.exposureLineId} value={r.exposureLineId}>
                {r.projectName} · {r.filterShortName}
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
            max={row?.acquired ?? undefined}
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
        <span className={styles.pillDanger}>{t('sessions.captures.rejected')}</span>
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
  filter: 'all' | 'deviations' | 'unassigned';
  onFilter: (f: 'all' | 'deviations' | 'unassigned') => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const zone = detail.session.siteTimeZone;
  const list = detail.captures.filter((c) =>
    filter === 'deviations'
      ? c.temperatureDeviation || c.settingsDeviation
      : filter === 'unassigned'
        ? c.assignment === 'unassigned'
        : true,
  );
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
            onChange={(e) => onFilter(e.target.value as 'all' | 'deviations' | 'unassigned')}
          >
            <option value="all">{t('sessions.captures.all')}</option>
            <option value="deviations">{t('sessions.captures.deviations')}</option>
            <option value="unassigned">{t('sessions.captures.unassigned')}</option>
          </select>
        </div>
      </div>
      {detail.capturesTruncated ? (
        <p className={styles.muted}>
          {t('sessions.detail.truncated', { count: detail.captures.length })}
        </p>
      ) : null}
      {unassigned.length > 0 && filter !== 'deviations' ? (
        <AssignPanel detail={detail} captures={unassigned} onChanged={onChanged} />
      ) : null}
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
                      {r.projectName} · {r.filterShortName}
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
