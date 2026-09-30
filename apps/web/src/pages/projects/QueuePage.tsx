/**
 * S-33 Warteschlange (FK 14.3, FA-FRG-04/06/07/14/16; AP-12c): Tabelle für alle Mitglieder mit Frist,
 * Objekt, Typ, Einreicher, Rang beim Einreicher, Aufwand (Platzhalter bis AP-13e), Plan-Chips (Tooltip
 * mit Gain/Offset/Binning/Auslesemodus/Mondprofil), Stimmen mit Knopf und Namen, eingereicht am,
 * Wunsch-Rig, Zeitraum (abgelaufen markiert) und geschätztem Bedarf; Filterleiste (FilterBar, AP-26c:
 * Suche, Chips; aufklappbar „ohne meine Stimme“, „geändert seit meiner Stimme“, Aufwand); jede Spalte
 * sortierbar. Admins entscheiden im Detailbereich:
 * *Freigeben* (Rig, Position je Rig, Status, Termine, Kommentar), *Zurückgeben*, *Ablehnen*
 * (Bestätigungsdialog); Spalte „Sichtbarkeit 4 Wochen“ als Mini-Balken (AP-24). Auswirkungsvorschau
 * im Entscheidungsbereich als Job `impact` (AP-32a, `ImpactPanel`).
 * Reiter *Meine Rangfolge* (seit 30.09.2026, vorher in „Meine Objekte“): eigene Einreichungen ordnen und
 * zurückziehen (FA-FRG-15, `SubmissionRanking`).
 */
import { formatNightKey, type SeasonBar } from '@nina-pm/shared';
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
import { DataTable, type DataColumn } from '../../components/DataTable';
import { EffortChip } from '../../components/EffortChip';
import { FilterBar, FilterCheck, FilterField } from '../../components/FilterBar';
import { FilterChip } from '../../components/FilterChip';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { Tabs } from '../../components/Tabs';
import { formatDateTime } from '../../lib/time';
import { problemCode, useEquipmentList, useMoonProfileLabel, useNumber } from '../equipment/shared';
import { EFFORT_FILTERS } from './list-model';
import { ProjectsLayout } from './ProjectsLayout';
import { SubmissionRanking } from './SubmissionRanking';
import { useQueueVisibility, VisibilityBars } from './VisibilityWeeks';
import {
  NO_QUEUE_FILTERS,
  filterQueue,
  nightKeyIn,
  periodExpired,
  queueSortValue,
  type QueueFilters,
  type QueueSortKey,
} from './queue-model';
import { ProjectThumb } from './ProjectImage';
import { ChangeRequestDecision } from './ChangeRequestDecision';
import { TransitDecision, transitWindowText } from './TransitDecision';
import { ImpactPanel } from './ImpactPanel';
import styles from './projects.module.css';

const QUEUE_KEY = ['projects', 'queue'] as const;
type QueueKindTab = 'all' | 'project' | 'change-request' | 'transit' | 'mine';
const QUEUE_KIND_TABS: readonly QueueKindTab[] = [
  'all',
  'project',
  'change-request',
  'transit',
  'mine',
];

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
  const [selected, setSelected] = useState<string | null>(null);
  const effortId = useId();
  const effortLabel = (k: string) =>
    k === 'done' || k === 'none' ? t(`effort.filter.${k}`) : t(`status.effort.${k}`);
  const vote = useMutation({
    mutationFn: ({
      id,
      on,
      kind,
    }: {
      id: string;
      on: boolean;
      kind: 'project' | 'change-request';
    }) => approvalApi.vote(id, on, kind),
    onSuccess: () => client.invalidateQueries({ queryKey: QUEUE_KEY }),
  });
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const today = nightKeyIn(Date.now(), zone);
  /** Reiter nach Art (FK 14.3 S-33): Einreichungen und Änderungsanträge (AP-32b). */
  const [kind, setKind] = useState<QueueKindTab>('all');
  const all = queue.data ?? [];
  const items = useMemo(
    () => filterQueue(all, f).filter((q) => kind === 'all' || q.kind === kind),
    [all, f, kind],
  );
  // Eigene Einreichungen nach Rang (Transit-Bestätigungen haben keinen Rang beim Einreicher, FA-FRG-04).
  const own = all
    .filter((q) => q.createdBy === me?.member?.id && q.kind !== 'transit')
    .sort((a, b) => (a.submitterRank?.rank ?? 0) - (b.submitterRank?.rank ?? 0));
  const tabCount = (k: QueueKindTab) =>
    k === 'all' ? all.length : k === 'mine' ? own.length : all.filter((q) => q.kind === k).length;
  const current = (queue.data ?? []).find((q) => q.id === selected) ?? null;
  const visibility = useQueueVisibility(items, rigs.data ?? [], sites.data ?? []);
  const visibilityById = useMemo(
    () => new Map(items.map((q, i) => [q.id, visibility.weeks[i] ?? null])),
    [items, visibility.weeks],
  );

  return (
    <ProjectsLayout title={t('queue.title')} meta={t('queue.hint')}>
      {queue.isError ? (
        <ProblemMessage code={problemCode(queue.error)} onRetry={() => void queue.refetch()} />
      ) : queue.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : (
        <>
          <Tabs<QueueKindTab>
            label={t('queue.kindTabs')}
            value={kind}
            onChange={setKind}
            tabs={QUEUE_KIND_TABS.map((k) => ({
              key: k,
              label: `${t(`queue.kind.${k}`)} (${String(tabCount(k))})`,
            }))}
            panelClassName={styles.kindPanel}
            panels={{
              [kind]:
                kind === 'mine' ? (
                  <SubmissionRanking entries={own} loading={false} />
                ) : (
                  <div className={styles.listCard}>
                    <FilterBar
                      label={t('projectList.filters')}
                      className={styles.listBar}
                      search={{
                        value: f.query,
                        onChange: (query) => setF({ ...f, query }),
                        label: t('projectList.search'),
                        placeholder: t('queue.searchPlaceholder'),
                        maxLength: 80,
                      }}
                      chips={[
                        ...(f.withoutMyVote
                          ? [
                              {
                                id: 'withoutMyVote',
                                label: t('queue.filter.withoutMyVote'),
                                onRemove: () => setF({ ...f, withoutMyVote: false }),
                              },
                            ]
                          : []),
                        ...(f.changedSinceMyVote
                          ? [
                              {
                                id: 'changedSinceMyVote',
                                label: t('queue.filter.changed'),
                                onRemove: () => setF({ ...f, changedSinceMyVote: false }),
                              },
                            ]
                          : []),
                        ...(f.effort
                          ? [
                              {
                                id: 'effort',
                                label: t('filterBar.chip', {
                                  label: t('projectList.filter.effort'),
                                  value: effortLabel(f.effort),
                                }),
                                onRemove: () => setF({ ...f, effort: '' }),
                              },
                            ]
                          : []),
                      ]}
                      panel={
                        <>
                          <FilterCheck
                            label={t('queue.filter.withoutMyVote')}
                            checked={f.withoutMyVote}
                            onChange={(on) => setF({ ...f, withoutMyVote: on })}
                          />
                          <FilterCheck
                            label={t('queue.filter.changed')}
                            checked={f.changedSinceMyVote}
                            onChange={(on) => setF({ ...f, changedSinceMyVote: on })}
                          />
                          <FilterField label={t('projectList.filter.effort')} htmlFor={effortId}>
                            <select
                              id={effortId}
                              className={styles.input}
                              value={f.effort}
                              onChange={(e) => setF({ ...f, effort: e.target.value })}
                            >
                              <option value="">{t('projectList.all')}</option>
                              {EFFORT_FILTERS.map((k) => (
                                <option key={k} value={k}>
                                  {effortLabel(k)}
                                </option>
                              ))}
                            </select>
                          </FilterField>
                        </>
                      }
                      onReset={() => setF(NO_QUEUE_FILTERS)}
                      count={t('queue.count', { n: items.length, total: queue.data.length })}
                    />
                    {vote.error ? (
                      <div className={styles.listBody}>
                        <ProblemMessage code={problemCode(vote.error)} />
                      </div>
                    ) : null}
                    {queue.data.length === 0 ? (
                      <div className={styles.listBody}>
                        <p className={styles.note}>{t('queue.empty')}</p>
                      </div>
                    ) : (
                      <QueueTable
                        items={items}
                        rigs={rigs.data ?? []}
                        filters={filters.data ?? []}
                        zone={zone}
                        today={today}
                        meId={me?.member?.id ?? ''}
                        canDecide={canDecide}
                        selected={selected}
                        onSelect={setSelected}
                        onVote={(q, on) => {
                          if (q.kind !== 'transit') vote.mutate({ id: q.id, on, kind: q.kind });
                        }}
                        voting={vote.isPending}
                        visibility={visibilityById}
                      />
                    )}
                  </div>
                ),
            }}
          />
          {canDecide && current?.kind === 'transit' ? (
            <TransitDecision
              key={current.id}
              item={current}
              own={current.createdBy === me?.member?.id}
              zone={zone}
              onDone={() => {
                setSelected(null);
                void client.invalidateQueries({ queryKey: ['projects'] });
                void client.invalidateQueries({ queryKey: ['exo-project'] });
              }}
            />
          ) : canDecide && current?.kind === 'change-request' ? (
            <ChangeRequestDecision
              key={current.id}
              item={current}
              own={current.createdBy === me?.member?.id}
              onDone={() => {
                setSelected(null);
                void client.invalidateQueries({ queryKey: ['projects'] });
                void client.invalidateQueries({ queryKey: ['change-requests'] });
              }}
            />
          ) : canDecide && current ? (
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
  rigs: readonly RigView[];
  filters: readonly FilterView[];
  zone: string;
  today: string;
  meId: string;
  canDecide: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  visibility: ReadonlyMap<string, SeasonBar[] | null>;
  onVote: (item: QueueItem, on: boolean) => void;
  voting: boolean;
}) {
  const { t, i18n } = useTranslation();
  const num = useNumber();
  const Vote = actionIcons.vote;
  const sortBy = (key: QueueSortKey) => (q: QueueItem) => queueSortValue(q, key);
  // Priorität: 1 bleibt immer, höhere Zahlen werden bei wenig Platz zuerst ausgeblendet (AP-26a).
  const columns: DataColumn<QueueItem>[] = [
    {
      id: 'image',
      header: t('catalog.col.image'),
      headerHidden: true,
      // Immer sichtbar (Wunsch Sven 26.09.2026), die Spalte ist nur 40 px breit.
      priority: 1,
      cell: (q) => (
        <ProjectThumb thumbnailUrl={q.thumbnailUrl} primaryId={q.dsoPrimaryId} name={q.name} />
      ),
    },
    {
      id: 'name',
      header: t('queue.col.object'),
      sortValue: sortBy('name'),
      nowrap: true,
      cell: (q) => (
        <>
          <Link to={`/projekte/${q.projectId}`}>{q.name}</Link>
          {q.kind === 'change-request' ? (
            <span className={styles.flag}>{t('changeRequests.badge')}</span>
          ) : null}
          {q.kind === 'transit' ? (
            <span className={styles.flag}>{t('queue.transit.badge')}</span>
          ) : null}
          {q.transit ? (
            <span className={styles.subline}>
              {t('queue.transit.line', {
                planet: q.transit.planet,
                night: formatNightKey(q.transit.night),
                window: transitWindowText(q.transit),
              })}
            </span>
          ) : null}
          {q.votes.mineChangedSince ? (
            <span className={styles.flag}>{t('queue.changedSinceVote')}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'votes',
      header: t('queue.col.votes'),
      sortValue: sortBy('votes'),
      cell: (q) => {
        // Transit-Bestätigungen haben keine Stimmen (FA-FRG-04).
        if (q.kind === 'transit') return '–';
        const own = q.createdBy === meId;
        return (
          <span className={styles.voteCell}>
            <button
              type="button"
              className={`${styles.iconButton} ${styles.voteButton}`}
              aria-pressed={q.votes.mine}
              aria-label={
                own ? t('queue.voteOwn', { name: q.name }) : t('queue.voteFor', { name: q.name })
              }
              title={own ? t('queue.voteOwnHint') : undefined}
              disabled={own || voting}
              onClick={() => onVote(q, !q.votes.mine)}
            >
              <Vote
                size={ICON_SIZE.table}
                aria-hidden
                fill={q.votes.mine ? 'currentColor' : 'none'}
              />
            </button>
            <span title={q.votes.voters.map((v) => v.displayName).join(', ')}>{q.votes.count}</span>
          </span>
        );
      },
    },
    {
      id: 'effort',
      header: t('queue.col.effort'),
      priority: 2,
      cell: (q) => <EffortChip effort={q.effort} size="sm" />,
    },
    {
      id: 'plan',
      header: t('queue.col.plan'),
      priority: 2,
      cell: (q) => <PlanChips item={q} filters={filters} />,
    },
    {
      id: 'visibility',
      header: t('queue.col.visibility'),
      priority: 2,
      cell: (q) => {
        const weeks = visibility.get(q.id) ?? null;
        return weeks ? (
          <VisibilityBars weeks={weeks} name={q.name} />
        ) : q.target && q.requestedRigId ? (
          <span className={styles.muted}>{t('common.loading')}</span>
        ) : (
          '–'
        );
      },
    },
    {
      id: 'deadline',
      header: t('queue.col.deadline'),
      sortValue: sortBy('deadline'),
      priority: 3,
      nowrap: true,
      cell: (q) => (q.expiresAt ? formatDateTime(q.expiresAt, zone, i18n.language) : '–'),
    },
    {
      id: 'creator',
      header: t('queue.col.creator'),
      sortValue: sortBy('creator'),
      priority: 3,
      nowrap: true,
      cell: (q) => q.createdByName,
    },
    {
      id: 'rig',
      header: t('queue.col.rig'),
      sortValue: (q) => rigs.find((r) => r.id === q.requestedRigId)?.name ?? null,
      priority: 3,
      cell: (q) => rigs.find((r) => r.id === q.requestedRigId)?.name ?? '–',
    },
    {
      id: 'hours',
      header: t('queue.col.hours'),
      sortValue: sortBy('hours'),
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (q) => `${num(q.estimatedHours, 1)} h`,
    },
    {
      id: 'rank',
      header: t('queue.col.rank'),
      sortValue: sortBy('rank'),
      priority: 4,
      nowrap: true,
      cell: (q) =>
        q.submitterRank
          ? t('queue.rank', { rank: q.submitterRank.rank, of: q.submitterRank.of })
          : '–',
    },
    {
      id: 'period',
      header: t('queue.col.period'),
      sortValue: (q) => q.requestPeriodFrom ?? q.requestPeriodTo,
      priority: 4,
      cell: (q) => (
        <>
          {q.requestPeriodFrom || q.requestPeriodTo
            ? `${q.requestPeriodFrom ?? '…'} – ${q.requestPeriodTo ?? '…'}`
            : '–'}
          {periodExpired(q, today) ? (
            <span className={styles.flag}>{t('queue.periodExpired')}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'submitted',
      header: t('queue.col.submitted'),
      sortValue: sortBy('submitted'),
      priority: 5,
      nowrap: true,
      cell: (q) => (q.submittedAt ? formatDateTime(q.submittedAt, zone, i18n.language) : '–'),
    },
    {
      id: 'type',
      header: t('queue.col.type'),
      sortValue: (q) => q.targetType,
      priority: 5,
      cell: (q) => q.targetType ?? '–',
    },
    ...(canDecide
      ? [
          {
            id: 'actions',
            header: t('projectList.col.actions'),
            headerHidden: true,
            cell: (q: QueueItem) => (
              <button
                type="button"
                className={styles.button}
                aria-expanded={selected === q.id}
                onClick={() => onSelect(selected === q.id ? null : q.id)}
              >
                {t('queue.decide')}
              </button>
            ),
          },
        ]
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(q) => q.id}
      rowLabel={(q) => q.name}
      label={t('queue.title')}
      rowProps={(q) => ({ 'data-selected': selected === q.id })}
    />
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
        {item.transit ? (
          <>
            <dt>{t('queue.transit.wish')}</dt>
            <dd>
              {t('queue.transit.line', {
                planet: item.transit.planet,
                night: formatNightKey(item.transit.night),
                window: transitWindowText(item.transit),
              })}
            </dd>
          </>
        ) : null}
        {item.requestComment ? (
          <>
            <dt>{t('approvalFlow.reason')}</dt>
            <dd>{item.requestComment}</dd>
          </>
        ) : null}
      </dl>
      {own ? <p className={styles.note}>{t('queue.ownObject')}</p> : null}
      <ImpactPanel id={item.id} />
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
