/**
 * S-61 Session-Detail (FK 14.3; FA-AUS-01…03, FA-AUS-06, FA-AUS-07, FA-AUS-22; NT-03, NT-E2, NT-E3;
 * AP-15): Kopf mit Status, Beginn–Ende in Standortzeit mit Kürzel, Frames und Integration; Aktionen
 * *Korrektur erfassen* und *Als geprüft markieren* (Admin). Reiter Soll/Ist je Zeile (Soll aus der
 * ersten Planrevision), Aufnahmen (Kennzeichen *Temperaturabweichung* und *Einstellungen abweichend*
 * mit Filter, nicht zugeordnete zuordnen), Ereignisse, Flats. Plangrafik, Protokoll, Kennzahlen und
 * Transits folgen mit ihren Paketen (R2/R3/R4).
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
import { ProblemMessage } from '../../components/ProblemMessage';
import { SiteTime } from '../../components/SiteTime';
import { StatusBadge } from '../../components/StatusBadge';
import { problemCode } from '../admin/shared';
import styles from './sessions.module.css';
import { SessionTime, hours } from './SessionsPage';

type Tab = 'plan' | 'captures' | 'events' | 'flats';
const TABS: readonly Tab[] = ['plan', 'captures', 'events', 'flats'];

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
      <nav aria-label={t('sessions.crumbs')} className={styles.muted}>
        {t('sessions.detail.crumbs', { night, rig: s.rigName })}
      </nav>
      <div className={styles.head}>
        <h1>{t('sessions.detail.title', { night, rig: s.rigName })}</h1>
        <div className={styles.actions}>
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
              {s.reviewed ? t('sessions.detail.unmarkReviewed') : t('sessions.detail.markReviewed')}
            </button>
          ) : null}
        </div>
      </div>
      {review.error ? <ProblemMessage code={problemCode(review.error)} /> : null}
      <p className={styles.summary}>
        <StatusBadge kind="session" value={s.status} />
        <SessionTime session={s} />
        <span>
          {t('sessions.detail.summary', { frames: s.frames, hours: hours(s.integrationS) })}
        </span>
        {s.ninaInstanceName ? (
          <span className={styles.muted}>
            {t('sessions.detail.instance', { name: s.ninaInstanceName })}
          </span>
        ) : null}
        {s.createdOffline ? <span className={styles.pill}>{t('sessions.offline')}</span> : null}
        <span className={s.reviewed ? styles.pillOk : styles.pillWarn}>
          {s.reviewed ? t('sessions.reviewedYes') : t('sessions.reviewedNo')}
        </span>
      </p>
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

      <div className={styles.tabs} role="tablist" aria-label={t('sessions.detail.tabs')}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`session-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`session-panel-${k}`}
            className={styles.tab}
            onClick={() => setTab(k)}
          >
            {t(`sessions.detail.tab.${k}`)}
          </button>
        ))}
      </div>
      <section
        className={styles.panel}
        role="tabpanel"
        id={`session-panel-${tab}`}
        aria-labelledby={`session-tab-${tab}`}
      >
        {tab === 'plan' ? (
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
            <PlanTable rows={d.rows} hasPlan={s.planRevision !== null} onCorrect={setCorrectLine} />
          </>
        ) : tab === 'captures' ? (
          <Captures
            detail={d}
            filter={captureFilter}
            onFilter={setCaptureFilter}
            onChanged={refresh}
          />
        ) : tab === 'events' ? (
          <Events detail={d} />
        ) : (
          <Flats detail={d} />
        )}
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
  return (
    <div
      className={styles.tableWrap}
      tabIndex={0}
      role="region"
      aria-label={t('sessions.detail.tab.plan')}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('sessions.plan.col.project')}</th>
            <th scope="col">{t('sessions.plan.col.filter')}</th>
            <th scope="col" className={styles.num}>
              {t('sessions.plan.col.planned')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.plan.col.acquired')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.plan.col.rejected')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.plan.col.accepted')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.plan.col.integration')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.plan.col.bonus')}
            </th>
            <th scope="col">{t('sessions.plan.col.action')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.exposureLineId}>
              <td>{r.projectName}</td>
              <td>{r.filterShortName}</td>
              <td className={styles.num}>
                {r.planned ?? (hasPlan ? '–' : t('sessions.detail.noPlan'))}
              </td>
              <td className={styles.num}>{r.acquired}</td>
              <td className={styles.num}>{r.rejected}</td>
              <td className={styles.num}>{r.accepted}</td>
              <td className={styles.num}>{t('sessions.hours', { h: hours(r.integrationS) })}</td>
              <td className={styles.num}>{r.bonus}</td>
              <td>
                <CorrectButton row={r} onCorrect={onCorrect} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label={t('sessions.detail.tab.captures')}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('sessions.captures.col.time')}</th>
                <th scope="col">{t('sessions.captures.col.type')}</th>
                <th scope="col">{t('sessions.captures.col.project')}</th>
                <th scope="col">{t('sessions.captures.col.filter')}</th>
                <th scope="col" className={styles.num}>
                  {t('sessions.captures.col.exposure')}
                </th>
                <th scope="col">{t('sessions.captures.col.result')}</th>
                <th scope="col">{t('sessions.captures.col.flags')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td className={styles.nowrap}>
                    <SiteTime atUtc={c.capturedAt} siteTimeZone={zone} />
                  </td>
                  <td>{t(`sessions.captures.type.${c.frameType}`)}</td>
                  <td>{c.projectName ?? '–'}</td>
                  <td>
                    {c.filterShortName}
                    {c.filterActual && c.filterActual !== c.filterShortName ? (
                      <span className={styles.muted}> ({c.filterActual})</span>
                    ) : null}
                  </td>
                  <td className={styles.num}>
                    {t('sessions.captures.seconds', { s: c.exposureS })}
                  </td>
                  <td>{t(`sessions.captures.result.${c.result}`)}</td>
                  <td>
                    <Flags c={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  return (
    <div
      className={styles.tableWrap}
      tabIndex={0}
      role="region"
      aria-label={t('sessions.detail.tab.events')}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('sessions.events.col.time')}</th>
            <th scope="col">{t('sessions.events.col.kind')}</th>
            <th scope="col">{t('sessions.events.col.message')}</th>
            <th scope="col" className={styles.num}>
              {t('sessions.events.col.duration')}
            </th>
          </tr>
        </thead>
        <tbody>
          {detail.events.map((e) => (
            <tr key={e.id}>
              <td className={styles.nowrap}>
                <SiteTime atUtc={e.occurredAt} siteTimeZone={zone} />
              </td>
              <td>
                {i18n.exists(`sessions.events.kind.${e.kind}`)
                  ? t(`sessions.events.kind.${e.kind}`)
                  : e.kind}
              </td>
              <td>{e.message ?? '–'}</td>
              <td className={styles.num}>
                {e.durationS === null
                  ? '–'
                  : t('sessions.captures.seconds', { s: Math.round(e.durationS) })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Flats({ detail }: { detail: NightSessionDetail }) {
  const { t } = useTranslation();
  if (detail.flats.length === 0) return <p className={styles.muted}>{t('sessions.flats.empty')}</p>;
  return (
    <div
      className={styles.tableWrap}
      tabIndex={0}
      role="region"
      aria-label={t('sessions.detail.tab.flats')}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('sessions.flats.col.filter')}</th>
            <th scope="col" className={styles.num}>
              {t('sessions.flats.col.rotator')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.flats.col.binning')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.flats.col.flats')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.flats.col.darkFlats')}
            </th>
            <th scope="col" className={styles.num}>
              {t('sessions.flats.col.exposure')}
            </th>
            <th scope="col">{t('sessions.flats.col.status')}</th>
          </tr>
        </thead>
        <tbody>
          {detail.flats.map((f) => (
            <tr key={`${f.filterShortName}-${String(f.rotatorMechDeg)}-${String(f.binning)}`}>
              <td>{f.filterShortName}</td>
              <td className={styles.num}>{f.rotatorMechDeg.toFixed(1)}°</td>
              <td className={styles.num}>{f.binning}</td>
              <td className={styles.num}>
                {f.flatsTaken}/{f.flatsPlanned}
              </td>
              <td className={styles.num}>
                {f.darkFlatsTaken}/{f.darkFlatsPlanned}
              </td>
              <td className={styles.num}>
                {f.flatExposureS === null
                  ? '–'
                  : t('sessions.captures.seconds', { s: f.flatExposureS })}
              </td>
              <td>{f.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
