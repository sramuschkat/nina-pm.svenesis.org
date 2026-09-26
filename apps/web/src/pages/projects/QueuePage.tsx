/**
 * S-33 Warteschlange (FK 14.3, FA-FRG-04/06/07/14/16; AP-12c): Tabelle für alle Mitglieder mit Frist,
 * Objekt, Typ, Einreicher, Rang beim Einreicher, Aufwand (Platzhalter bis AP-13e), Plan-Chips (Tooltip
 * mit Gain/Offset/Binning/Auslesemodus/Mondprofil), Stimmen mit Knopf und Namen, eingereicht am,
 * Wunsch-Rig, Zeitraum (abgelaufen markiert) und geschätztem Bedarf; Filter „ohne meine Stimme“ und
 * „geändert seit meiner Stimme“; jede Spalte sortierbar. Admins entscheiden im Detailbereich:
 * *Freigeben* (Rig, Position je Rig, Status, Termine, Kommentar), *Zurückgeben*, *Ablehnen*
 * (Bestätigungsdialog); Spalte „Sichtbarkeit 4 Wochen“ als Mini-Balken (AP-24). Auswirkungsvorschau
 * folgt mit R3.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  approvalApi,
  projectsApi,
  type FilterView,
  type QueueItem,
  type RigView,
} from '../../api/client';
import { ApiError, useAuth, useCan } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EffortChip } from '../../components/EffortChip';
import { FilterChip } from '../../components/FilterChip';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import { problemCode, useEquipmentList, useMoonProfileLabel, useNumber } from '../equipment/shared';
import { EFFORT_FILTERS } from './list-model';
import { ProjectsLayout } from './ProjectsLayout';
import { useQueueVisibility, VisibilityBars } from './VisibilityWeeks';
import {
  NO_QUEUE_FILTERS,
  filterQueue,
  nightKeyIn,
  periodExpired,
  sortQueue,
  type QueueFilters,
  type QueueSort,
  type QueueSortKey,
} from './queue-model';
import styles from './projects.module.css';

const QUEUE_KEY = ['projects', 'queue'] as const;

export function QueuePage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const canDecide = useCan('queue.decide');
  const client = useQueryClient();
  const queue = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => (await approvalApi.queue()).items,
  });
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const filters = useEquipmentList('filters');
  const [f, setF] = useState<QueueFilters>(NO_QUEUE_FILTERS);
  const [sort, setSort] = useState<QueueSort | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const vote = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => approvalApi.vote(id, on),
    onSuccess: () => client.invalidateQueries({ queryKey: QUEUE_KEY }),
  });
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const today = nightKeyIn(Date.now(), zone);
  const items = useMemo(
    () => sortQueue(filterQueue(queue.data ?? [], f), sort),
    [queue.data, f, sort],
  );
  const current = (queue.data ?? []).find((q) => q.id === selected) ?? null;
  const visibility = useQueueVisibility(items, rigs.data ?? [], sites.data ?? []);

  return (
    <ProjectsLayout title={t('queue.title')}>
      <p className={styles.muted}>{t('queue.hint')}</p>
      {queue.isError ? (
        <ProblemMessage code={problemCode(queue.error)} onRetry={() => void queue.refetch()} />
      ) : queue.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : (
        <>
          <fieldset className={styles.filterBar}>
            <legend>{t('projectList.filters')}</legend>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={f.withoutMyVote}
                onChange={(e) => setF({ ...f, withoutMyVote: e.target.checked })}
              />
              {t('queue.filter.withoutMyVote')}
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={f.changedSinceMyVote}
                onChange={(e) => setF({ ...f, changedSinceMyVote: e.target.checked })}
              />
              {t('queue.filter.changed')}
            </label>
            <label>
              {t('projectList.filter.effort')}
              <select
                className={styles.input}
                value={f.effort}
                onChange={(e) => setF({ ...f, effort: e.target.value })}
              >
                <option value="">{t('projectList.all')}</option>
                {EFFORT_FILTERS.map((k) => (
                  <option key={k} value={k}>
                    {k === 'done' || k === 'none'
                      ? t(`effort.filter.${k}`)
                      : t(`status.effort.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <span className={styles.muted} role="status">
              {t('queue.count', { n: items.length, total: queue.data.length })}
            </span>
          </fieldset>
          {vote.error ? <ProblemMessage code={problemCode(vote.error)} /> : null}
          {queue.data.length === 0 ? (
            <p className={styles.note}>{t('queue.empty')}</p>
          ) : (
            <QueueTable
              items={items}
              sort={sort}
              onSort={setSort}
              rigs={rigs.data ?? []}
              filters={filters.data ?? []}
              zone={zone}
              today={today}
              meId={me?.member?.id ?? ''}
              canDecide={canDecide}
              selected={selected}
              onSelect={setSelected}
              onVote={(id, on) => vote.mutate({ id, on })}
              voting={vote.isPending}
              visibility={visibility}
            />
          )}
          {canDecide && current ? (
            <DecisionPanel
              key={current.id}
              item={current}
              rigs={rigs.data ?? []}
              own={current.createdBy === me?.member?.id}
              onDone={() => {
                setSelected(null);
                void client.invalidateQueries({ queryKey: ['projects'] });
              }}
            />
          ) : null}
        </>
      )}
    </ProjectsLayout>
  );
}

// ---- Tabelle --------------------------------------------------------------------------------------

function QueueTable({
  items,
  sort,
  onSort,
  rigs,
  filters,
  zone,
  today,
  meId,
  canDecide,
  selected,
  onSelect,
  onVote,
  voting,
  visibility,
}: {
  items: readonly QueueItem[];
  sort: QueueSort | null;
  onSort: (s: QueueSort) => void;
  rigs: readonly RigView[];
  filters: readonly FilterView[];
  zone: string;
  today: string;
  meId: string;
  canDecide: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  visibility: ReturnType<typeof useQueueVisibility>;
  onVote: (id: string, on: boolean) => void;
  voting: boolean;
}) {
  const { t, i18n } = useTranslation();
  const num = useNumber();
  const Vote = actionIcons.vote;
  const header = (key: QueueSortKey, label: string, numeric = false) => {
    const active = sort?.key === key;
    const dir = active ? sort.dir : null;
    return (
      <th
        scope="col"
        className={numeric ? styles.num : undefined}
        aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
      >
        <button
          type="button"
          className={styles.sortButton}
          onClick={() => onSort({ key, dir: active && dir === 'asc' ? 'desc' : 'asc' })}
        >
          {label}
          {active && dir === 'asc' ? <uiIcons.up size={ICON_SIZE.table} aria-hidden /> : null}
          {active && dir === 'desc' ? <uiIcons.down size={ICON_SIZE.table} aria-hidden /> : null}
        </button>
      </th>
    );
  };
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {header('deadline', t('queue.col.deadline'))}
            {header('name', t('queue.col.object'))}
            <th scope="col">{t('queue.col.type')}</th>
            {header('creator', t('queue.col.creator'))}
            {header('rank', t('queue.col.rank'))}
            <th scope="col">{t('queue.col.effort')}</th>
            <th scope="col">{t('queue.col.plan')}</th>
            {header('votes', t('queue.col.votes'))}
            {header('submitted', t('queue.col.submitted'))}
            <th scope="col">{t('queue.col.rig')}</th>
            <th scope="col">{t('queue.col.period')}</th>
            <th scope="col">{t('queue.col.visibility')}</th>
            {header('hours', t('queue.col.hours'), true)}
            {canDecide ? <th scope="col">{t('projectList.col.actions')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((q, index) => {
            const own = q.createdBy === meId;
            const weeks = visibility.weeks[index] ?? null;
            const expired = periodExpired(q, today);
            return (
              <tr key={q.id} data-selected={selected === q.id}>
                <td>{q.expiresAt ? formatDateTime(q.expiresAt, zone, i18n.language) : '–'}</td>
                <td>
                  <Link to={`/projekte/${q.id}`}>{q.name}</Link>
                  {q.votes.mineChangedSince ? (
                    <span className={styles.flag}>{t('queue.changedSinceVote')}</span>
                  ) : null}
                </td>
                <td>{q.targetType ?? '–'}</td>
                <td>{q.createdByName}</td>
                <td>
                  {q.submitterRank
                    ? t('queue.rank', { rank: q.submitterRank.rank, of: q.submitterRank.of })
                    : '–'}
                </td>
                <td>
                  <EffortChip effort={q.effort} size="sm" />
                </td>
                <td>
                  <PlanChips item={q} filters={filters} />
                </td>
                <td>
                  <span className={styles.voteCell}>
                    <button
                      type="button"
                      className={`${styles.iconButton} ${styles.voteButton}`}
                      aria-pressed={q.votes.mine}
                      aria-label={
                        own
                          ? t('queue.voteOwn', { name: q.name })
                          : t('queue.voteFor', { name: q.name })
                      }
                      title={own ? t('queue.voteOwnHint') : undefined}
                      disabled={own || voting}
                      onClick={() => onVote(q.id, !q.votes.mine)}
                    >
                      <Vote
                        size={ICON_SIZE.table}
                        aria-hidden
                        fill={q.votes.mine ? 'currentColor' : 'none'}
                      />
                    </button>
                    <span title={q.votes.voters.map((v) => v.displayName).join(', ')}>
                      {q.votes.count}
                    </span>
                  </span>
                  {q.votes.voters.length > 0 ? (
                    <span className={styles.voterNames}>
                      {q.votes.voters.map((v) => v.displayName).join(', ')}
                    </span>
                  ) : null}
                </td>
                <td>{q.submittedAt ? formatDateTime(q.submittedAt, zone, i18n.language) : '–'}</td>
                <td>{rigs.find((r) => r.id === q.requestedRigId)?.name ?? '–'}</td>
                <td>
                  {q.requestPeriodFrom || q.requestPeriodTo
                    ? `${q.requestPeriodFrom ?? '…'} – ${q.requestPeriodTo ?? '…'}`
                    : '–'}
                  {expired ? <span className={styles.flag}>{t('queue.periodExpired')}</span> : null}
                </td>
                <td>
                  {weeks ? (
                    <VisibilityBars weeks={weeks} name={q.name} />
                  ) : visibility.state === 'loading' && q.target && q.requestedRigId ? (
                    <span className={styles.muted}>{t('common.loading')}</span>
                  ) : (
                    '–'
                  )}
                </td>
                <td className={styles.num}>{`${num(q.estimatedHours, 1)} h`}</td>
                {canDecide ? (
                  <td>
                    <button
                      type="button"
                      className={styles.button}
                      aria-expanded={selected === q.id}
                      onClick={() => onSelect(selected === q.id ? null : q.id)}
                    >
                      {t('queue.decide')}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Plan-Chips „Ha 40 × 300 s“ je aktiver Zeile; Tooltip mit Gain/Offset/Binning/Auslesemodus/Mond. */
function PlanChips({ item, filters }: { item: QueueItem; filters: readonly FilterView[] }) {
  const { t } = useTranslation();
  const moonLabel = useMoonProfileLabel();
  const profiles = useEquipmentList('moon-profiles');
  const moon = (p: QueueItem['planSummary'][number]) =>
    p.moonMode === 'none'
      ? t('projectEditor.plan.moonNone')
      : p.moonMode === 'project_default'
        ? t('projectEditor.plan.moonProject')
        : moonLabel((profiles.data ?? []).find((x) => x.id === p.moonProfileId)?.name ?? '–');
  return (
    <ul className={styles.planChips}>
      {item.planSummary.map((p, i) => (
        <li
          key={`${p.filterShortName}-${String(i)}`}
          title={t('queue.chipTitle', {
            gain: p.gain ?? t('projectEditor.plan.default'),
            offset: p.offset ?? t('projectEditor.plan.default'),
            binning: `${String(p.binning)}×${String(p.binning)}`,
            readout: p.readoutMode ?? t('projectEditor.plan.default'),
            moon: moon(p),
          })}
        >
          <FilterChip
            shortName={p.filterShortName}
            color={filters.find((f) => f.id === p.filterId)?.colorHex ?? '#888888'}
            size="sm"
          />
          {` ${String(p.count)} × ${String(p.exposureS)} s`}
        </li>
      ))}
      {item.panelCount > 1 ? <li>{t('queue.panels', { n: item.panelCount })}</li> : null}
    </ul>
  );
}

// ---- Entscheiden (Admin) --------------------------------------------------------------------------

function DecisionPanel({
  item,
  rigs,
  own,
  onDone,
}: {
  item: QueueItem;
  rigs: readonly RigView[];
  own: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const ids = {
    rig: useId(),
    position: useId(),
    start: useId(),
    due: useId(),
    comment: useId(),
  };
  const [rigId, setRigId] = useState(item.requestedRigId ?? rigs[0]?.id ?? '');
  const [position, setPosition] = useState<number | null>(null);
  const [status, setStatus] = useState<'planning' | 'active'>('active');
  const [startDate, setStartDate] = useState(item.requestPeriodFrom ?? '');
  const [dueDate, setDueDate] = useState(item.requestPeriodTo ?? '');
  const [comment, setComment] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const [commentMissing, setCommentMissing] = useState(false);
  // Position je Rig: Anzahl freigegebener Projekte des Rigs (Einfügeposition 1 … n+1).
  const approved = useQuery({
    queryKey: ['projects', 'approved-on', rigId],
    queryFn: async () =>
      (await projectsApi.list(`?rigId=${rigId}&approvalStatus=approved`)).items.length,
    enabled: rigId !== '',
  });
  const max = (approved.data ?? 0) + 1;
  // Vorschlag nach Stimmen (FA-FRG-16) gilt für das Wunsch-Rig; der Admin übernimmt oder ändert ihn.
  const suggested =
    rigId === item.requestedRigId && item.suggestedPriorityPosition !== null
      ? Math.min(item.suggestedPriorityPosition, max)
      : null;
  const approve = useMutation({
    mutationFn: (accept: boolean) =>
      approvalApi.approve(
        item.id,
        {
          rigId,
          priorityPosition: position ?? suggested ?? max,
          status,
          startDate: startDate || null,
          dueDate: dueDate || null,
          comment: comment.trim() || null,
          ...(accept ? { acceptRigConflicts: true } : {}),
        },
        item.version,
      ),
    onSuccess: onDone,
  });
  const decide = useMutation({
    mutationFn: (to: 'return' | 'reject') =>
      to === 'return'
        ? approvalApi.returnToUser(item.id, comment.trim(), item.version)
        : approvalApi.reject(item.id, comment.trim(), item.version),
    onSuccess: onDone,
  });
  const needComment = (then: () => void) => {
    if (!comment.trim()) {
      setCommentMissing(true);
      return;
    }
    setCommentMissing(false);
    then();
  };
  const rigConflict =
    approve.error instanceof ApiError && approve.error.problem.code === 'approval.rig_conflict';
  const error = approve.error ?? decide.error;
  return (
    <section className={styles.decision} aria-labelledby="decision-title">
      <h2 id="decision-title">{t('queue.decisionTitle', { name: item.name })}</h2>
      <dl className={styles.cardFacts}>
        <dt>{t('queue.col.creator')}</dt>
        <dd>{item.createdByName}</dd>
        <dt>{t('queue.col.votes')}</dt>
        <dd>
          {item.votes.count}
          {item.votes.voters.length > 0
            ? ` (${item.votes.voters.map((v) => v.displayName).join(', ')})`
            : ''}
        </dd>
        {item.requestComment ? (
          <>
            <dt>{t('approvalFlow.reason')}</dt>
            <dd>{item.requestComment}</dd>
          </>
        ) : null}
      </dl>
      {own ? <p className={styles.note}>{t('queue.ownObject')}</p> : null}
      <p className={styles.muted}>{t('queue.impactLater')}</p>
      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor={ids.rig}>{t('projectEditor.rig')}</label>
          <select
            id={ids.rig}
            className={styles.input}
            value={rigId}
            onChange={(e) => {
              setRigId(e.target.value);
              setPosition(null);
            }}
          >
            {rigs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.position}>{t('queue.position')}</label>
          <input
            id={ids.position}
            className={styles.input}
            type="number"
            min={1}
            max={max}
            step={1}
            value={position ?? suggested ?? max}
            aria-describedby={`${ids.position}-hint`}
            onChange={(e) =>
              setPosition(
                e.target.value === '' ? null : Math.max(1, Math.min(max, Number(e.target.value))),
              )
            }
          />
          <span id={`${ids.position}-hint`} className={styles.muted}>
            {suggested !== null ? `${t('queue.positionSuggested', { position: suggested })} ` : ''}
            {t('queue.positionHint', { max })}
          </span>
        </div>
        <fieldset className={styles.field}>
          <legend>{t('projectEditor.status')}</legend>
          {(['active', 'planning'] as const).map((s) => (
            <label key={s} className={styles.check}>
              <input
                type="radio"
                name={`${ids.rig}-status`}
                checked={status === s}
                onChange={() => setStatus(s)}
              />
              {t(`status.project.${s}`)}
            </label>
          ))}
        </fieldset>
        <div className={styles.field}>
          <label htmlFor={ids.start}>{t('projectEditor.field.startDate')}</label>
          <input
            id={ids.start}
            className={styles.input}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.due}>{t('projectEditor.field.dueDate')}</label>
          <input
            id={ids.due}
            className={styles.input}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor={ids.comment}>{t('queue.comment')}</label>
        <textarea
          id={ids.comment}
          className={styles.input}
          rows={2}
          maxLength={4000}
          value={comment}
          aria-invalid={commentMissing ? true : undefined}
          aria-describedby={commentMissing ? `${ids.comment}-error` : undefined}
          onChange={(e) => setComment(e.target.value)}
        />
        {commentMissing ? (
          <span id={`${ids.comment}-error`} className={styles.fieldError}>
            {t('queue.commentRequired')}
          </span>
        ) : null}
      </div>
      {rigConflict ? (
        <div className={styles.warning} role="alert">
          <ProblemMessage code="approval.rig_conflict" />
          <ul>
            {((approve.error as ApiError).problem.errors ?? []).map((e, i) => (
              <li key={`${e.path}-${String(i)}`}>{e.message}</li>
            ))}
          </ul>
          <button type="button" className={styles.button} onClick={() => approve.mutate(true)}>
            {t('queue.approveAnyway')}
          </button>
        </div>
      ) : error ? (
        <ProblemMessage code={problemCode(error)} />
      ) : null}
      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={approve.isPending || rigId === ''}
          onClick={() => approve.mutate(false)}
        >
          <actionIcons.approve size={ICON_SIZE.button} aria-hidden />
          {t('queue.approve')}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={decide.isPending}
          onClick={() => needComment(() => decide.mutate('return'))}
        >
          <actionIcons.return size={ICON_SIZE.button} aria-hidden />
          {t('queue.return')}
        </button>
        <button
          type="button"
          className={styles.buttonDanger}
          disabled={decide.isPending}
          onClick={() => needComment(() => setConfirmReject(true))}
        >
          <actionIcons.reject size={ICON_SIZE.button} aria-hidden />
          {t('queue.reject')}
        </button>
      </div>
      <ConfirmDialog
        open={confirmReject}
        title={t('queue.rejectTitle', { name: item.name })}
        consequence={t('queue.rejectConsequence')}
        confirmLabel={t('queue.reject')}
        variant="danger"
        state={decide.isPending ? 'loading' : decide.isError ? 'error' : 'ready'}
        {...(decide.error ? { errorKey: problemI18nKey(problemCode(decide.error)) } : {})}
        onConfirm={() =>
          decide
            .mutateAsync('reject')
            .then(() => setConfirmReject(false))
            .catch(() => undefined)
        }
        onCancel={() => setConfirmReject(false)}
      />
    </section>
  );
}
