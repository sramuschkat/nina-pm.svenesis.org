/**
 * Projekt-Editor, Reiter *Änderungsanträge* (FK 14.3; FA-FRG-08; AP-32b): alle Anträge des Projekts mit
 * Status, Begründung und Gegenüberstellung gegen die aktuelle Fassung. Der Ersteller eines freigegebenen
 * Projekts stellt einen Antrag (Admins bearbeiten direkt) und bearbeitet bzw. zieht ihn zurück, solange er
 * offen ist. Umfang (Entscheidung Sven 26.09.2026): geplante Anzahl und aktiv je Zeile, neue Zeilen,
 * Mindesthöhe, Mindestzeit, Dämmerung, Start/Fälligkeit, Beschreibung.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  changeRequestsApi,
  type ChangeRequestProposal,
  type ChangeRequestView,
  type ProjectView,
} from '../../api/client';
import { ApiError, useAuth, useCan } from '../../auth';
import { ProblemMessage } from '../../components/ProblemMessage';
import { formatDateTime } from '../../lib/time';
import { problemCode, useEquipmentList } from '../equipment/shared';
import { ChangeRequestDiffTable } from './ChangeRequestDiff';
import styles from './projects.module.css';
import { MemberAvatarFor } from '../../lib/member';

type Line = ProjectView['panels'][number]['lines'][number];
type Twilight = ProjectView['conditions']['twilight'];

interface NewLineDraft {
  readonly id: string;
  panelId: string;
  filterId: string;
  exposureS: string;
  plannedCount: string;
}

interface Draft {
  lines: Record<string, { plannedCount: string; enabled: boolean }>;
  newLines: NewLineDraft[];
  minAltitudeDeg: string;
  minTimeOnTargetH: string;
  twilight: Twilight;
  startDate: string;
  dueDate: string;
  descriptionMd: string;
  comment: string;
}

const allLines = (p: ProjectView): Line[] => p.panels.flatMap((panel) => panel.lines);

/** Formularstand: aktuelle Fassung, bei einem bestehenden Antrag mit dessen Vorschlag überlagert. */
function initialDraft(project: ProjectView, existing: ChangeRequestView | null): Draft {
  const proposal = (existing?.proposal ?? null) as ChangeRequestProposal | null;
  const changes = new Map((proposal?.lines ?? []).map((l) => [l.lineId, l]));
  const c = project.conditions;
  const pc = proposal?.conditions ?? {};
  return {
    lines: Object.fromEntries(
      allLines(project).map((l) => {
        const ch = changes.get(l.id);
        return [
          l.id,
          {
            plannedCount: String(ch?.plannedCount ?? l.plannedCount),
            enabled: ch?.enabled ?? l.enabled,
          },
        ];
      }),
    ),
    newLines: (proposal?.newLines ?? []).map((n) => ({
      id: n.id,
      panelId: n.panelId,
      filterId: n.filterId,
      exposureS: String(n.exposureS),
      plannedCount: String(n.plannedCount),
    })),
    minAltitudeDeg: String(pc.minAltitudeDeg ?? c.minAltitudeDeg),
    minTimeOnTargetH: String(pc.minTimeOnTargetH ?? c.minTimeOnTargetH),
    twilight: pc.twilight ?? c.twilight,
    startDate: (proposal?.startDate === undefined ? project.startDate : proposal.startDate) ?? '',
    dueDate: (proposal?.dueDate === undefined ? project.dueDate : proposal.dueDate) ?? '',
    descriptionMd: proposal?.descriptionMd ?? project.descriptionMd,
    comment: existing?.comment ?? '',
  };
}

/** Nur geänderte Felder (FA-FRG-08: angenommen werden nur die im Antrag geänderten Felder). */
export function proposalFrom(project: ProjectView, d: Draft): ChangeRequestProposal {
  const lines = allLines(project).flatMap((l) => {
    const x = d.lines[l.id];
    if (!x) return [];
    const planned = Number(x.plannedCount);
    const change: ChangeRequestProposal['lines'][number] = { lineId: l.id };
    if (Number.isFinite(planned) && planned !== l.plannedCount) change.plannedCount = planned;
    if (x.enabled !== l.enabled) change.enabled = x.enabled;
    return change.plannedCount !== undefined || change.enabled !== undefined ? [change] : [];
  });
  const newLines = d.newLines
    .filter((n) => n.filterId && Number(n.exposureS) > 0 && Number(n.plannedCount) > 0)
    .map((n) => ({
      id: n.id,
      panelId: n.panelId,
      filterId: n.filterId,
      exposureS: Number(n.exposureS),
      plannedCount: Math.trunc(Number(n.plannedCount)),
      gain: null,
      offsetAdu: null,
      binning: 1,
      readoutMode: null,
      moonMode: 'project_default' as const,
      moonProfileId: null,
      enabled: true,
      notes: '',
    }));
  const c = project.conditions;
  const conditions: NonNullable<ChangeRequestProposal['conditions']> = {};
  if (Number(d.minAltitudeDeg) !== c.minAltitudeDeg)
    conditions.minAltitudeDeg = Number(d.minAltitudeDeg);
  if (Number(d.minTimeOnTargetH) !== c.minTimeOnTargetH)
    conditions.minTimeOnTargetH = Number(d.minTimeOnTargetH);
  if (d.twilight !== c.twilight) conditions.twilight = d.twilight;
  const date = (v: string) => (v === '' ? null : v);
  return {
    lines,
    newLines,
    ...(Object.keys(conditions).length > 0 ? { conditions } : {}),
    ...(date(d.startDate) !== project.startDate ? { startDate: date(d.startDate) } : {}),
    ...(date(d.dueDate) !== project.dueDate ? { dueDate: date(d.dueDate) } : {}),
    ...(d.descriptionMd !== project.descriptionMd ? { descriptionMd: d.descriptionMd } : {}),
  };
}

const isEmpty = (p: ChangeRequestProposal) =>
  p.lines.length === 0 &&
  p.newLines.length === 0 &&
  p.conditions === undefined &&
  p.startDate === undefined &&
  p.dueDate === undefined &&
  p.descriptionMd === undefined;

export function ChangeRequestsTab({
  project,
  canEdit,
}: {
  project: ProjectView;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const key = ['change-requests', project.id];
  const list = useQuery({
    queryKey: key,
    queryFn: async () => (await changeRequestsApi.list(project.id)).items,
  });
  const canRequest =
    useCan('changeRequest.create', {
      createdBy: project.createdBy,
      approvalStatus: project.approvalStatus,
    }) &&
    project.approvalStatus === 'approved' &&
    !canEdit;
  const [editing, setEditing] = useState<ChangeRequestView | 'new' | null>(null);
  const items = list.data ?? [];
  const hasOpenOwn = items.some((r) => r.status === 'open' && r.requestedBy === me?.member?.id);
  return (
    <div className={styles.crList}>
      <p className={styles.muted}>
        {canRequest ? t('changeRequests.hintUser') : t('changeRequests.hint')}
      </p>
      {canRequest && editing === null ? (
        <div>
          <button type="button" className={styles.buttonPrimary} onClick={() => setEditing('new')}>
            {t('changeRequests.create')}
          </button>
          {hasOpenOwn ? (
            <span className={styles.muted}> {t('changeRequests.openExists')}</span>
          ) : null}
        </div>
      ) : null}
      {editing !== null ? (
        <ChangeRequestForm
          key={editing === 'new' ? 'new' : editing.id}
          project={project}
          existing={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {list.isError ? (
        <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className={styles.muted}>{t('changeRequests.empty')}</p>
      ) : (
        <ul className={styles.crList} aria-label={t('changeRequests.title')}>
          {items.map((r) => (
            <ChangeRequestCard
              key={r.id}
              request={r}
              own={r.requestedBy === me?.member?.id}
              onEdit={() => setEditing(r)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChangeRequestCard({
  request: r,
  own,
  onEdit,
}: {
  request: ChangeRequestView;
  own: boolean;
  onEdit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const client = useQueryClient();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const withdraw = useMutation({
    mutationFn: () => changeRequestsApi.withdraw(r.id, r.version),
    onSettled: () => client.invalidateQueries({ queryKey: ['change-requests', r.projectId] }),
  });
  return (
    <li
      className={styles.crCard}
      aria-label={t('changeRequests.cardAria', { name: r.requestedByName })}
    >
      <div className={styles.crHead}>
        <span className={r.status === 'open' ? styles.pillWarn : styles.pill}>
          {t(`changeRequests.status.${r.status}`)}
        </span>
        <span className={styles.byLine}>
          <MemberAvatarFor id={r.requestedBy} />
          {t('changeRequests.by', {
            name: r.requestedByName,
            at: formatDateTime(r.createdAt, zone, i18n.language),
          })}
        </span>
        {r.decidedAt ? (
          <span className={`${styles.muted} ${styles.byLine}`}>
            <MemberAvatarFor id={r.decidedBy} />
            {t('changeRequests.decidedBy', {
              name: r.decidedByName ?? '–',
              at: formatDateTime(r.decidedAt, zone, i18n.language),
            })}
          </span>
        ) : null}
      </div>
      {r.comment ? <p>{r.comment}</p> : null}
      {r.status === 'open' && r.projectChangedSince ? (
        <p className={styles.note}>{t('changeRequests.projectChanged')}</p>
      ) : null}
      <ChangeRequestDiffTable diff={r.diff} caption={t('changeRequests.diffCaption')} />
      {r.decisionComment ? (
        <p className={styles.muted}>
          {t('changeRequests.decisionNote', { comment: r.decisionComment })}
        </p>
      ) : null}
      {own && r.status === 'open' ? (
        <div className={styles.rowActions}>
          <button type="button" className={styles.button} onClick={onEdit}>
            {t('changeRequests.edit')}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            {t('changeRequests.withdraw')}
          </button>
        </div>
      ) : null}
      {withdraw.error ? <ProblemMessage code={problemCode(withdraw.error)} /> : null}
    </li>
  );
}

function ChangeRequestForm({
  project,
  existing,
  onDone,
}: {
  project: ProjectView;
  existing: ChangeRequestView | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const filters = useEquipmentList('filters');
  const ids = {
    title: useId(),
    minAlt: useId(),
    minTime: useId(),
    twilight: useId(),
    start: useId(),
    due: useId(),
    desc: useId(),
    comment: useId(),
  };
  const [d, setD] = useState<Draft>(() => initialDraft(project, existing));
  const proposal = proposalFrom(project, d);
  const empty = isEmpty(proposal);
  const save = useMutation({
    mutationFn: () =>
      existing
        ? changeRequestsApi.update(
            existing.id,
            { proposal, comment: d.comment.trim() || null },
            existing.version,
          )
        : changeRequestsApi.create(project.id, {
            id: crypto.randomUUID(),
            proposal,
            comment: d.comment.trim() || null,
          }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['change-requests', project.id] });
      await client.invalidateQueries({ queryKey: ['projects'] });
      onDone();
    },
  });
  const conflict = save.error instanceof ApiError && save.error.problem.status === 412;
  const multiPanel = project.panels.length > 1;
  const lineLabel = (l: Line) => {
    const panel = project.panels.find((p) => p.id === l.panelId);
    return `${l.filterShortName} · ${String(l.exposureS)} s${multiPanel && panel ? ` · ${panel.label}` : ''}`;
  };
  const addLine = () =>
    setD({
      ...d,
      newLines: [
        ...d.newLines,
        {
          id: crypto.randomUUID(),
          panelId: project.panels[0]?.id ?? '',
          filterId: '',
          exposureS: '300',
          plannedCount: '10',
        },
      ],
    });
  const setNew = (id: string, patch: Partial<NewLineDraft>) =>
    setD({ ...d, newLines: d.newLines.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  return (
    <form
      className={styles.crForm}
      aria-labelledby={ids.title}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!empty) save.mutate();
      }}
    >
      <h3 id={ids.title}>
        {existing ? t('changeRequests.editTitle') : t('changeRequests.createTitle')}
      </h3>
      <p className={styles.muted}>{t('changeRequests.formHint')}</p>
      <fieldset className={styles.crForm}>
        <legend>{t('changeRequests.lines')}</legend>
        {allLines(project).map((l) => {
          const x = d.lines[l.id] ?? { plannedCount: String(l.plannedCount), enabled: l.enabled };
          const inputId = `cr-line-${l.id}`;
          return (
            <div key={l.id} className={styles.crLineRow}>
              <label htmlFor={inputId}>
                {t('changeRequests.plannedFor', { line: lineLabel(l) })}
              </label>
              <input
                id={inputId}
                className={styles.input}
                type="number"
                min={0}
                step={1}
                value={x.plannedCount}
                onChange={(e) =>
                  setD({
                    ...d,
                    lines: { ...d.lines, [l.id]: { ...x, plannedCount: e.target.value } },
                  })
                }
              />
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={x.enabled}
                  onChange={(e) =>
                    setD({
                      ...d,
                      lines: { ...d.lines, [l.id]: { ...x, enabled: e.target.checked } },
                    })
                  }
                />
                {t('changeRequests.active')}
              </label>
            </div>
          );
        })}
        {d.newLines.map((n, i) => (
          <div
            key={n.id}
            className={styles.crNewLine}
            role="group"
            aria-label={t('changeRequests.newLineAria', { n: i + 1 })}
          >
            {multiPanel ? (
              <div className={styles.field}>
                <label htmlFor={`cr-new-panel-${n.id}`}>{t('changeRequests.panel')}</label>
                <select
                  id={`cr-new-panel-${n.id}`}
                  className={styles.input}
                  value={n.panelId}
                  onChange={(e) => setNew(n.id, { panelId: e.target.value })}
                >
                  {project.panels.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className={styles.field}>
              <label htmlFor={`cr-new-filter-${n.id}`}>{t('changeRequests.filter')}</label>
              <select
                id={`cr-new-filter-${n.id}`}
                className={styles.input}
                value={n.filterId}
                onChange={(e) => setNew(n.id, { filterId: e.target.value })}
              >
                <option value="">{t('changeRequests.chooseFilter')}</option>
                {(filters.data ?? []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor={`cr-new-exp-${n.id}`}>{t('changeRequests.exposureS')}</label>
              <input
                id={`cr-new-exp-${n.id}`}
                className={styles.input}
                type="number"
                min={1}
                step="any"
                value={n.exposureS}
                onChange={(e) => setNew(n.id, { exposureS: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={`cr-new-count-${n.id}`}>{t('changeRequests.count')}</label>
              <input
                id={`cr-new-count-${n.id}`}
                className={styles.input}
                type="number"
                min={1}
                step={1}
                value={n.plannedCount}
                onChange={(e) => setNew(n.id, { plannedCount: e.target.value })}
              />
            </div>
            <button
              type="button"
              className={styles.button}
              onClick={() => setD({ ...d, newLines: d.newLines.filter((x) => x.id !== n.id) })}
            >
              {t('changeRequests.removeLine')}
            </button>
          </div>
        ))}
        <div>
          <button type="button" className={styles.button} onClick={addLine}>
            {t('changeRequests.addLine')}
          </button>
        </div>
      </fieldset>
      <div className={styles.crGrid}>
        <div className={styles.field}>
          <label htmlFor={ids.minAlt}>{t('projectEditor.cond.minAltitude')}</label>
          <input
            id={ids.minAlt}
            className={styles.input}
            type="number"
            min={0}
            max={90}
            step="any"
            value={d.minAltitudeDeg}
            onChange={(e) => setD({ ...d, minAltitudeDeg: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.minTime}>{t('projectEditor.cond.minTime')}</label>
          <input
            id={ids.minTime}
            className={styles.input}
            type="number"
            min={0}
            max={24}
            step="any"
            value={d.minTimeOnTargetH}
            onChange={(e) => setD({ ...d, minTimeOnTargetH: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.twilight}>{t('projectEditor.cond.twilight')}</label>
          <select
            id={ids.twilight}
            className={styles.input}
            value={d.twilight}
            onChange={(e) => setD({ ...d, twilight: e.target.value as Twilight })}
          >
            {(['astronomical', 'nautical', 'civil'] as const).map((x) => (
              <option key={x} value={x}>
                {t(`nightChart.twilight.${x}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.start}>{t('changeRequests.field.startDate')}</label>
          <input
            id={ids.start}
            className={styles.input}
            type="date"
            value={d.startDate}
            onChange={(e) => setD({ ...d, startDate: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.due}>{t('changeRequests.field.dueDate')}</label>
          <input
            id={ids.due}
            className={styles.input}
            type="date"
            value={d.dueDate}
            onChange={(e) => setD({ ...d, dueDate: e.target.value })}
          />
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor={ids.desc}>{t('changeRequests.field.descriptionMd')}</label>
        <textarea
          id={ids.desc}
          className={styles.input}
          rows={3}
          maxLength={20_000}
          value={d.descriptionMd}
          onChange={(e) => setD({ ...d, descriptionMd: e.target.value })}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={ids.comment}>{t('changeRequests.comment')}</label>
        <textarea
          id={ids.comment}
          className={styles.input}
          rows={2}
          maxLength={4000}
          value={d.comment}
          onChange={(e) => setD({ ...d, comment: e.target.value })}
        />
      </div>
      {empty ? <p className={styles.muted}>{t('changeRequests.nothingChanged')}</p> : null}
      <div className={styles.rowActions}>
        <button type="submit" className={styles.buttonPrimary} disabled={empty || save.isPending}>
          {existing ? t('changeRequests.saveEdit') : t('changeRequests.submit')}
        </button>
        <button type="button" className={styles.button} onClick={onDone}>
          {t('changeRequests.cancel')}
        </button>
      </div>
      {conflict ? (
        <p className={styles.warning} role="alert">
          {t('changeRequests.conflict')}
        </p>
      ) : save.error ? (
        <ProblemMessage code={problemCode(save.error)} />
      ) : null}
    </form>
  );
}
