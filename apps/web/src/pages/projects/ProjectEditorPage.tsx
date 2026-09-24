/**
 * S-31 Projekt-Editor (FK 14.3, FA-PRJ-01…23, AP-11b): Kopf mit Status, Rig, Aufwand (Platzhalter
 * bis AP-13e), Favorit, Speichern/Duplizieren/Löschen; oben drei Spalten Zielinformationen ·
 * Bedingungen · Vorschau mit Ausrüstung und Recherche-Links; Reiter mit Nachtdiagramm-Vorschau,
 * Notizen und Verlauf; unten der Belichtungsplan. Das Projekt wird mit `If-Match` gespeichert (412 bei
 * parallelem Speichern), nur geänderte Felder. Neue Projekte sind Entwürfe und dürfen unvollständig
 * sein (FA-PRJ-01); Zeilen setzen Koordinaten voraus (erst dann gibt es das Hauptpanel).
 * Einreichen, Freigabe und Änderungsanträge folgen mit AP-12a, Mosaik und Sternkarte mit R2.
 */
import {
  canTransition,
  DEFAULT_CONDITIONS,
  ProjectCreate,
  ProjectPatch,
  projectStatuses,
  twilight as twilightLimits,
  type ProjectStatus,
} from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { api, approvalApi, projectsApi, type ProjectView, type RigView } from '../../api/client';
import { ApiError, useAuth, useCan } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CoordinateInput } from '../../components/CoordinateInput';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { Markdown } from '../../components/Markdown';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import { RigSelect, type RigOption } from '../../components/RigSelect';
import { StatusBadge } from '../../components/StatusBadge';
import {
  CheckField,
  EQUIPMENT_PATHS,
  NumberField,
  SelectField,
  TextField,
  newId,
  problemCode,
  useEquipmentList,
  useMoonProfileLabel,
  useNumber,
  validate,
  type FieldErrors,
} from '../equipment/shared';
import { ExposurePlan, Sums } from './ExposurePlan';
import {
  changedFields,
  conditionsFromProfile,
  draftBody,
  emptyDraft,
  planSums,
  toDraft,
  type Conditions,
  type ProjectDraft,
} from './model';
import { ProjectTabs } from './ProjectTabs';
import { SubmitPanel } from './SubmitPanel';
import styles from './projects.module.css';

export const PROJECT_PATHS = {
  list: '/projekte',
  create: '/projekte/neu',
  edit: (id: string) => `/projekte/${id}`,
} as const;

const projectKey = (id: string | undefined) => ['project', id] as const;
const isConflict = (e: unknown) =>
  e instanceof ApiError && e.problem.code === 'resource.version_conflict';
const isRigConflict = (e: unknown) =>
  e instanceof ApiError &&
  (e.problem.code === 'approval.rig_conflict' || e.problem.code === 'rig.change_has_captures');

export function ProjectEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const isNew = id === undefined;
  const { me } = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();

  const project = useQuery({
    queryKey: projectKey(id),
    queryFn: () => projectsApi.get(id ?? ''),
    enabled: !isNew,
  });
  const prefs = useQuery({
    queryKey: ['me', 'preferences', me?.tenant?.id],
    queryFn: () => api.preferences(),
    enabled: isNew && me?.context === 'tenant',
    staleTime: Infinity,
  });

  // Entwurf: einmal je Projekt aus der gespeicherten Fassung, neu aus der eigenen Vorbelegung.
  const [draft, setDraft] = useState<{ for: string; value: ProjectDraft } | null>(null);
  const draftKey = id ?? 'new';
  if (draft?.for !== draftKey) {
    if (isNew && !prefs.isPending) {
      const defaults = prefs.data?.['project.defaultConditions'];
      setDraft({ for: draftKey, value: emptyDraft({ ...DEFAULT_CONDITIONS, ...defaults }) });
    } else if (!isNew && project.data) {
      setDraft({ for: draftKey, value: toDraft(project.data) });
    }
  }

  if (!isNew && project.isError)
    return (
      <div className={styles.page}>
        <ProblemMessage code={problemCode(project.error)} onRetry={() => void project.refetch()} />
        <p>
          <Link to={PROJECT_PATHS.list}>{t('common.back')}</Link>
        </p>
      </div>
    );
  if (!draft || draft.for !== draftKey || (!isNew && !project.data))
    return (
      <div className={styles.page}>
        <p role="status">{t('common.loading')}</p>
      </div>
    );

  return (
    <Editor
      key={draftKey}
      saved={isNew ? null : (project.data ?? null)}
      draft={draft.value}
      setDraft={(value) => setDraft({ for: draftKey, value })}
      onSaved={(view) => {
        client.setQueryData(projectKey(view.id), view);
        if (isNew) {
          void navigate(PROJECT_PATHS.edit(view.id), { replace: true });
        } else {
          setDraft({ for: draftKey, value: toDraft(view) });
        }
      }}
      onChange={(view) => client.setQueryData(projectKey(view.id), view)}
      onReload={async () => {
        const res = await project.refetch();
        return res.data;
      }}
      onReset={async () => {
        const res = await project.refetch();
        if (res.data) setDraft({ for: draftKey, value: toDraft(res.data) });
      }}
    />
  );
}

interface EditorProps {
  saved: ProjectView | null;
  draft: ProjectDraft;
  setDraft: (d: ProjectDraft) => void;
  onSaved: (view: ProjectView) => void;
  onChange: (view: ProjectView) => void;
  onReload: () => Promise<unknown>;
  onReset: () => Promise<unknown>;
}

function Editor({ saved, draft, setDraft, onSaved, onChange, onReload, onReset }: EditorProps) {
  const { t } = useTranslation();
  const num = useNumber();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { me } = useAuth();

  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const filters = useEquipmentList('filters');
  const moonProfiles = useEquipmentList('moon-profiles');
  const templates = useEquipmentList('exposure-templates');

  const resource = saved
    ? { createdBy: saved.createdBy, approvalStatus: saved.approvalStatus }
    : undefined;
  const canCreate = useCan('project.create');
  const canUpdate = useCan('project.update', resource);
  const canDelete = useCan('project.delete', resource);
  const canStatus = useCan('project.status');
  const canFavorite = useCan('me.favorites');
  const canSubmit = useCan('project.submit', resource);
  const canWithdraw = useCan('project.withdraw', resource);
  const [submitting, setSubmitting] = useState(false);
  // „Geändert seit deiner Stimme“ gilt als gesehen, sobald das Objekt geöffnet ist (FA-FRG-14).
  const savedId = saved?.id;
  const ackNeeded = saved?.approvalStatus === 'submitted' && saved.createdBy !== me?.member?.id;
  useEffect(() => {
    if (savedId && ackNeeded) void approvalApi.acknowledge(savedId).catch(() => undefined);
  }, [savedId, ackNeeded]);
  const canEdit = saved ? canUpdate : canCreate;

  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [topTab, setTopTab] = useState<TopTab>('target');
  const topTabsId = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [defaultSaved, setDefaultSaved] = useState(false);

  const rig = (rigs.data ?? []).find((r) => r.id === draft.rigId) ?? null;
  const site = (sites.data ?? []).find((s) => s.id === rig?.siteId) ?? null;
  const telescope = (telescopes.data ?? []).find((x) => x.id === rig?.telescopeId) ?? null;
  const camera = (cameras.data ?? []).find((x) => x.id === rig?.cameraId) ?? null;
  const rigOptions: RigOption[] = (rigs.data ?? []).map((r: RigView) => ({
    id: r.id,
    name: r.name,
    siteName: (sites.data ?? []).find((s) => s.id === r.siteId)?.name ?? '',
    telescopeName: (telescopes.data ?? []).find((x) => x.id === r.telescopeId)?.name ?? '',
    cameraName: (cameras.data ?? []).find((x) => x.id === r.cameraId)?.name ?? '',
    scaleArcsecPx: r.derived.scaleArcsecPx,
    fovDeg: [r.derived.fovWidthDeg, r.derived.fovHeightDeg],
    showInPlanning: r.showInPlanning,
  }));

  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) =>
    setDraft({ ...draft, [key]: value });
  const setCond = <K extends keyof Conditions>(key: K, value: Conditions[K]) =>
    setDraft({ ...draft, conditions: { ...draft.conditions, [key]: value } });

  const changes = saved ? changedFields(draft, saved) : null;
  const dirty = saved === null || Object.keys(changes ?? {}).length > 0;

  const save = useMutation({
    mutationFn: async (acceptRigConflicts: boolean) => {
      if (!saved) {
        const result = validate(ProjectCreate, { id: newId(), ...draftBody(draft) });
        if (!result.ok) throw new FormErrors(result.errors);
        return projectsApi.create(result.data as object & { id: string });
      }
      const body = { ...changes, ...(acceptRigConflicts ? { acceptRigConflicts: true } : {}) };
      const result = validate(ProjectPatch, body);
      if (!result.ok) throw new FormErrors(result.errors);
      return projectsApi.patch(saved.id, result.data as object, saved.version);
    },
    onMutate: () => setClientErrors({}),
    onSuccess: onSaved,
    onError: (e) => {
      const found = e instanceof FormErrors ? e.errors : serverErrors(e);
      if (e instanceof FormErrors) setClientErrors(e.errors);
      // Fehler in einem verdeckten Reiter: dorthin wechseln, damit das Feld sichtbar ist.
      const first = Object.keys(found)[0];
      if (first) setTopTab(tabOf(first));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(false);
  };
  const errors: FieldErrors = { ...serverErrors(save.error), ...clientErrors };
  const tabsWithErrors = new Set(Object.keys(errors).map(tabOf));
  const fieldError = (path: string) => (errors[path] ? t('equipment.invalid') : undefined);
  const disabled = !canEdit;
  const formId = useId();

  const status = useMutation({
    mutationFn: (next: ProjectStatus) => projectsApi.setStatus(saved?.id ?? '', next),
    onSuccess: (view) => {
      onChange(view);
      setDraft(toDraft(view));
    },
  });
  const favorite = useMutation({
    mutationFn: (on: boolean) => projectsApi.favorite(saved?.id ?? '', on),
    onSuccess: () => onReload(),
  });
  const withdraw = useMutation({
    mutationFn: () => approvalApi.withdraw(saved?.id ?? '', saved?.version ?? 0),
    onSuccess: onSaved,
  });
  const duplicate = useMutation({
    mutationFn: () => projectsApi.duplicate(saved?.id ?? '', { id: newId() }),
    onSuccess: (view) => {
      client.setQueryData(['project', view.id], view);
      void navigate(`/projekte/${view.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => projectsApi.remove(saved?.id ?? ''),
    onSuccess: () => void navigate('/projekte'),
  });
  const setDefault = useMutation({
    mutationFn: () => api.setPreference('project.defaultConditions', draft.conditions),
    onSuccess: async () => {
      setDefaultSaved(true);
      await client.invalidateQueries({ queryKey: ['me', 'preferences'] });
    },
  });

  const statusOptions =
    saved?.status && saved.approvalStatus === 'approved'
      ? projectStatuses.filter((s) => s === saved.status || canTransition(saved.status ?? s, s))
      : [];
  const allLines = saved?.panels.flatMap((p) => p.lines) ?? [];
  const title = draft.name.trim() || saved?.name || t('projectEditor.newTitle');
  const Save = actionIcons.save;
  const Star = actionIcons.favorite;
  const Back = actionIcons.back;
  const moonLabel = useMoonProfileLabel();
  const fov = rig
    ? `${num(rig.derived.fovWidthDeg, 2)}° × ${num(rig.derived.fovHeightDeg, 2)}°`
    : '–';
  const research = draft.targetName.trim() || draft.name.trim();

  return (
    <div className={styles.page}>
      <nav aria-label={t('projectEditor.crumbs')}>
        <ol className={styles.crumbs}>
          <li>
            <Link to="/projekte">{t('projectEditor.list')}</Link>
          </li>
          {saved ? (
            <li>
              {saved.status
                ? t(`status.project.${saved.status}`)
                : t(`status.approval.${saved.approvalStatus}`)}
            </li>
          ) : null}
          <li aria-current="page">{title}</li>
        </ol>
      </nav>
      <div className={styles.head}>
        <Link to="/projekte" className={styles.button}>
          <Back size={ICON_SIZE.button} aria-hidden />
          {t('common.back')}
        </Link>
        <h1>{title}</h1>
        {saved ? <StatusBadge kind="approval" value={saved.approvalStatus} /> : null}
        {saved?.status ? <StatusBadge kind="project" value={saved.status} /> : null}
        <span className={styles.effort} title={t('projectEditor.effortHint')}>
          {t('projectEditor.effortPending')}
        </span>
        {saved && canFavorite ? (
          <button
            type="button"
            className={`${styles.iconButton} ${styles.favorite}`}
            aria-pressed={saved.favorite}
            aria-label={t('projectEditor.favorite')}
            title={t('projectEditor.favorite')}
            onClick={() => favorite.mutate(!saved.favorite)}
          >
            <Star
              size={ICON_SIZE.button}
              aria-hidden
              fill={saved.favorite ? 'currentColor' : 'none'}
            />
          </button>
        ) : null}
        <div className={styles.headActions}>
          {dirty && saved ? (
            <span className={styles.dirty}>{t('projectEditor.unsaved')}</span>
          ) : null}
          {canEdit ? (
            <button
              type="submit"
              form={formId}
              className={styles.buttonPrimary}
              disabled={save.isPending || !dirty}
            >
              <Save size={ICON_SIZE.button} aria-hidden />
              {t('projectEditor.save')}
            </button>
          ) : null}
          {saved &&
          canSubmit &&
          (saved.approvalStatus === 'draft' || saved.approvalStatus === 'returned') ? (
            <button
              type="button"
              className={styles.button}
              disabled={dirty}
              title={dirty ? t('approvalFlow.saveFirst') : undefined}
              onClick={() => setSubmitting(true)}
            >
              <actionIcons.submit size={ICON_SIZE.button} aria-hidden />
              {t('approvalFlow.submit')}
            </button>
          ) : null}
          {saved && canWithdraw && saved.approvalStatus === 'submitted' ? (
            <button
              type="button"
              className={styles.button}
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              <actionIcons.return size={ICON_SIZE.button} aria-hidden />
              {t('approvalFlow.withdraw')}
            </button>
          ) : null}
          {saved && canCreate ? (
            <button type="button" className={styles.button} onClick={() => duplicate.mutate()}>
              <actionIcons.duplicate size={ICON_SIZE.button} aria-hidden />
              {t('projectEditor.duplicate')}
            </button>
          ) : null}
          {saved && canDelete ? (
            <button
              type="button"
              className={styles.buttonDanger}
              onClick={() => setConfirmDelete(true)}
            >
              <actionIcons.delete size={ICON_SIZE.button} aria-hidden />
              {t('projectEditor.delete')}
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.head}>
        <div className={styles.rig}>
          <RigSelect
            rigs={rigOptions}
            value={draft.rigId}
            onChange={(v) => set('rigId', v)}
            disabled={disabled}
            label={t('projectEditor.rig')}
            onEmptyAction={() => void navigate(EQUIPMENT_PATHS.rigs)}
          />
        </div>
        {statusOptions.length > 0 && canStatus ? (
          <SelectField
            label={t('projectEditor.status')}
            value={saved?.status ?? 'planning'}
            options={statusOptions.map((s) => ({ value: s, label: t(`status.project.${s}`) }))}
            onChange={(v) => status.mutate(v)}
          />
        ) : null}
        {saved ? (
          <Sums sums={planSums(allLines)} label={t('projectEditor.plan.sumsProject')} />
        ) : null}
      </div>
      {!canEdit ? (
        <p className={styles.note} role="note">
          {me?.mfaRequired ? t('errors.auth.mfaRequired') : t('projectEditor.readOnly')}
        </p>
      ) : null}
      {isConflict(save.error) ? (
        <div className={styles.warning} role="alert">
          <p>{t('common.conflict')}</p>
          <button type="button" className={styles.button} onClick={() => void onReset()}>
            {t('projectEditor.reload')}
          </button>
        </div>
      ) : isRigConflict(save.error) ? (
        <div className={styles.warning} role="alert">
          <ProblemMessage code={problemCode(save.error)} />
          <RigConflicts error={save.error} />
          <button type="button" className={styles.button} onClick={() => save.mutate(true)}>
            {t('projectEditor.rigChangeAnyway')}
          </button>
        </div>
      ) : save.error instanceof FormErrors || problemCode(save.error) === 'validation.failed' ? (
        <p className={styles.fieldError} role="alert">
          {t('errors.validation.failed')}
        </p>
      ) : save.error ? (
        <ProblemMessage code={problemCode(save.error)} />
      ) : null}
      {saved && submitting ? (
        <SubmitPanel
          project={{
            id: saved.id,
            name: saved.name,
            version: saved.version,
            rigId: saved.rigId,
            requestPeriodFrom: saved.requestPeriodFrom,
            requestPeriodTo: saved.requestPeriodTo,
            requestComment: saved.requestComment,
          }}
          rigs={rigs.data ?? []}
          onDone={(view) => {
            setSubmitting(false);
            onSaved(view);
          }}
          onCancel={() => setSubmitting(false)}
        />
      ) : null}
      {[status.error, favorite.error, duplicate.error, withdraw.error].map((e, i) =>
        e ? <ProblemMessage key={i} code={problemCode(e)} /> : null,
      )}

      <form id={formId} className={styles.topTabs} onSubmit={submit} noValidate>
        <div className={styles.tabs} role="tablist" aria-label={t('projectEditor.topTabs')}>
          {TOP_TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${topTabsId}-${key}`}
              aria-selected={topTab === key}
              aria-controls={`${topTabsId}-${key}-panel`}
              className={styles.tab}
              onClick={() => setTopTab(key)}
            >
              {t(TOP_TAB_LABEL[key])}
              {tabsWithErrors.has(key) ? (
                <span className={styles.tabError}>{t('projectEditor.tabHasErrors')}</span>
              ) : null}
            </button>
          ))}
        </div>
        <section
          className={styles.stack}
          role="tabpanel"
          id={`${topTabsId}-target-panel`}
          aria-labelledby={`${topTabsId}-target`}
          hidden={topTab !== 'target'}
        >
          <div className={styles.grid}>
            <TextField
              label={t('projectEditor.field.name')}
              value={draft.name}
              maxLength={200}
              onChange={(v) => set('name', v)}
              error={fieldError('name')}
              disabled={disabled}
              wide
            />
            <TextField
              label={t('projectEditor.field.targetName')}
              value={draft.targetName}
              maxLength={200}
              onChange={(v) => set('targetName', v)}
              error={fieldError('targetName')}
              disabled={disabled}
            />
            <TextField
              label={t('projectEditor.field.targetType')}
              value={draft.targetType}
              maxLength={40}
              onChange={(v) => set('targetType', v)}
              error={fieldError('targetType')}
              disabled={disabled}
            />
            <DateField
              label={t('projectEditor.field.startDate')}
              value={draft.startDate}
              onChange={(v) => set('startDate', v)}
              hint={t('projectEditor.field.nightKeyHint')}
              error={fieldError('startDate')}
              disabled={disabled}
            />
            <DateField
              label={t('projectEditor.field.dueDate')}
              value={draft.dueDate}
              onChange={(v) => set('dueDate', v)}
              error={fieldError('dueDate')}
              disabled={disabled}
            />
            <CoordinateInput
              kind="ra"
              label={t('projectEditor.field.ra')}
              valueDeg={draft.raDeg}
              onChange={(v) => set('raDeg', v)}
              disabled={disabled}
            />
            <CoordinateInput
              kind="dec"
              label={t('projectEditor.field.dec')}
              valueDeg={draft.decDeg}
              onChange={(v) => set('decDeg', v)}
              disabled={disabled}
            />
            <NumberField
              label={t('projectEditor.field.rotation')}
              unit="°"
              value={draft.rotationDeg}
              min={0}
              max={359.9}
              onChange={(v) => set('rotationDeg', v)}
              error={fieldError('rotationDeg')}
              disabled={disabled}
            />
            <div>
              <span className={styles.muted}>{t('projectEditor.field.fov')}</span>
              <p>{fov}</p>
            </div>
          </div>
          <p className={styles.muted}>{t('projectEditor.coordinatesSearchLater')}</p>
          <TextField
            label={t('projectEditor.field.catalogNames')}
            value={draft.catalogNames}
            maxLength={500}
            onChange={(v) => set('catalogNames', v)}
            disabled={disabled}
          />
          <TextField
            label={t('projectEditor.field.description')}
            value={draft.descriptionMd}
            maxLength={20000}
            multiline
            onChange={(v) => set('descriptionMd', v)}
            hint={t('projectEditor.field.markdownHint')}
            disabled={disabled}
          />
          {draft.descriptionMd.trim() ? (
            <details>
              <summary>{t('projectEditor.field.descriptionPreview')}</summary>
              <div className={styles.markdownPreview}>
                <Markdown>{draft.descriptionMd}</Markdown>
              </div>
            </details>
          ) : null}
        </section>

        <section
          className={styles.stack}
          role="tabpanel"
          id={`${topTabsId}-conditions-panel`}
          aria-labelledby={`${topTabsId}-conditions`}
          hidden={topTab !== 'conditions'}
        >
          <div className={styles.grid}>
            <NumberField
              label={t('projectEditor.cond.minAltitude')}
              unit="°"
              value={draft.conditions.minAltitudeDeg}
              min={0}
              max={90}
              onChange={(v) => setCond('minAltitudeDeg', v ?? 0)}
              error={fieldError('conditions.minAltitudeDeg')}
              disabled={disabled}
            />
            <NumberField
              label={t('projectEditor.cond.minTime')}
              unit="h"
              value={draft.conditions.minTimeOnTargetH}
              min={0}
              max={24}
              onChange={(v) => setCond('minTimeOnTargetH', v ?? 0)}
              error={fieldError('conditions.minTimeOnTargetH')}
              disabled={disabled}
            />
            <SelectField
              label={t('projectEditor.cond.twilight')}
              value={draft.conditions.twilight}
              options={twilightLimits.map((k) => ({
                value: k,
                label: t(`nightChart.twilight.${k}`),
              }))}
              onChange={(v) => setCond('twilight', v)}
              disabled={disabled}
            />
          </div>
          <CheckField
            label={t('projectEditor.cond.moonEnabled')}
            checked={draft.conditions.moonAvoidanceEnabled}
            onChange={(v) => setCond('moonAvoidanceEnabled', v)}
            disabled={disabled}
          />
          <p className={styles.muted}>{t('projectEditor.cond.moonHint')}</p>
          {draft.conditions.moonAvoidanceEnabled ? (
            <>
              <SelectField
                label={t('projectEditor.cond.moonFromProfile')}
                value=""
                options={[
                  { value: '', label: t('projectEditor.cond.moonFromProfileChoose') },
                  ...(moonProfiles.data ?? []).map((p) => ({
                    value: p.id,
                    label: moonLabel(p.name),
                  })),
                ]}
                onChange={(pid) => {
                  const p = (moonProfiles.data ?? []).find((x) => x.id === pid);
                  if (p)
                    setDraft({ ...draft, conditions: conditionsFromProfile(draft.conditions, p) });
                }}
                disabled={disabled}
              />
              <CheckField
                label={t('projectEditor.cond.moonMustBeDown')}
                checked={draft.conditions.moonMustBeDown}
                onChange={(v) => setCond('moonMustBeDown', v)}
                disabled={disabled}
              />
              <div className={styles.grid}>
                <NumberField
                  label={t('projectEditor.cond.moonSeparation')}
                  unit="°"
                  value={draft.conditions.moonSeparationDeg}
                  onChange={(v) => setCond('moonSeparationDeg', v ?? 0)}
                  error={fieldError('conditions.moonSeparationDeg')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('projectEditor.cond.moonWidth')}
                  unit="d"
                  value={draft.conditions.moonWidthDays}
                  onChange={(v) => setCond('moonWidthDays', v ?? 0)}
                  error={fieldError('conditions.moonWidthDays')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('projectEditor.cond.moonRelax')}
                  value={draft.conditions.moonRelaxScale}
                  onChange={(v) => setCond('moonRelaxScale', v ?? 0)}
                  error={fieldError('conditions.moonRelaxScale')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('projectEditor.cond.moonMinAlt')}
                  unit="°"
                  value={draft.conditions.moonMinAltDeg}
                  onChange={(v) => setCond('moonMinAltDeg', v ?? 0)}
                  error={fieldError('conditions.moonMinAltDeg')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('projectEditor.cond.moonMaxAlt')}
                  unit="°"
                  value={draft.conditions.moonMaxAltDeg}
                  onChange={(v) => setCond('moonMaxAltDeg', v ?? 0)}
                  error={fieldError('conditions.moonMaxAltDeg')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('projectEditor.cond.moonIllumination')}
                  unit="%"
                  value={draft.conditions.moonMaxIlluminationPct}
                  onChange={(v) => setCond('moonMaxIlluminationPct', v ?? 0)}
                  error={fieldError('conditions.moonMaxIlluminationPct')}
                  disabled={disabled}
                />
              </div>
            </>
          ) : null}
          <div>
            <button type="button" className={styles.button} onClick={() => setDefault.mutate()}>
              {t('projectEditor.cond.setDefault')}
            </button>{' '}
            {defaultSaved ? (
              <span className={styles.success} role="status">
                {t('projectEditor.cond.defaultSaved')}
              </span>
            ) : null}
            {setDefault.error ? <ProblemMessage code={problemCode(setDefault.error)} /> : null}
          </div>
        </section>

        <section
          className={styles.stack}
          role="tabpanel"
          id={`${topTabsId}-preview-panel`}
          aria-labelledby={`${topTabsId}-preview`}
          hidden={topTab !== 'preview'}
        >
          <div className={styles.preview}>{t('projectEditor.previewLater')}</div>
          <dl className={styles.facts}>
            <dt>{t('projectEditor.facts.site')}</dt>
            <dd>{site?.name ?? '–'}</dd>
            <dt>{t('projectEditor.facts.telescope')}</dt>
            <dd>{telescope?.name ?? '–'}</dd>
            <dt>{t('projectEditor.facts.camera')}</dt>
            <dd>{camera?.name ?? '–'}</dd>
            <dt>{t('projectEditor.facts.scale')}</dt>
            <dd>{rig ? `${num(rig.derived.scaleArcsecPx, 2)}″/px` : '–'}</dd>
            <dt>{t('projectEditor.facts.fov')}</dt>
            <dd>{fov}</dd>
          </dl>
          {research ? (
            <>
              <span className={styles.muted}>{t('projectEditor.research')}</span>
              <ul className={styles.links}>
                {researchLinks(research).map((l) => (
                  <li key={l.name}>
                    <a href={l.href} target="_blank" rel="noopener noreferrer">
                      {l.name}
                      <actionIcons.external size={ICON_SIZE.table} aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </form>

      <ProjectTabs projectId={saved?.id ?? null} resource={resource} draft={draft} site={site} />

      {saved ? (
        <ExposurePlan
          project={saved}
          canEdit={canEdit}
          rig={rig}
          camera={camera}
          filters={filters.data ?? []}
          moonProfiles={moonProfiles.data ?? []}
          templates={templates.data ?? []}
          onChange={onChange}
          onReload={onReload}
          rigPath={EQUIPMENT_PATHS.rigs}
        />
      ) : (
        <section className={styles.plan} aria-labelledby="plan-title">
          <h2 id="plan-title">{t('projectEditor.plan.title')}</h2>
          <p className={styles.note}>{t('projectEditor.plan.saveFirst')}</p>
        </section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t('projectEditor.deleteTitle', { name: saved?.name ?? '' })}
        consequence={t('projectEditor.deleteConsequence')}
        confirmLabel={t('projectEditor.delete')}
        variant="danger"
        state={remove.isPending ? 'loading' : remove.isError ? 'error' : 'ready'}
        {...(remove.error ? { errorKey: problemI18nKey(problemCode(remove.error)) } : {})}
        onConfirm={() => remove.mutateAsync().catch(() => undefined)}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Reiter des oberen Bereichs (Entscheidung Sven 24.09.2026 statt drei Spalten nebeneinander). */
const TOP_TABS = ['target', 'conditions', 'preview'] as const;
type TopTab = (typeof TOP_TABS)[number];
const TOP_TAB_LABEL: Record<TopTab, string> = {
  target: 'projectEditor.targetInfo',
  conditions: 'projectEditor.conditions',
  preview: 'projectEditor.preview',
};
/** Reiter eines Feldpfads: Bedingungen unter `conditions.*`, alles andere Zielinformationen. */
const tabOf = (path: string): TopTab => (path.startsWith('conditions.') ? 'conditions' : 'target');

/** Fehler der Client-Prüfung (zod) als Feldpfade. */
class FormErrors extends Error {
  constructor(readonly errors: FieldErrors) {
    super('validation');
  }
}

/** Feldfehler aus Problem Details (`errors[].path`). */
function serverErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError) || error.problem.code !== 'validation.failed') return {};
  return Object.fromEntries(
    (error.problem.errors ?? []).map((e) => [e.path.replace(/\[(\d+)\]/g, '.$1'), e.message]),
  );
}

/** Konfliktliste des Rig-Wechsels (FA-RIG-12) aus `errors[]`. */
function RigConflicts({ error }: { error: unknown }) {
  if (!(error instanceof ApiError) || !error.problem.errors?.length) return null;
  return (
    <ul>
      {error.problem.errors.map((e, i) => (
        <li key={`${e.path}-${String(i)}`}>{e.message}</li>
      ))}
    </ul>
  );
}

/** Datum als Nacht-Schlüssel `YYYY-MM-DD` (NT-04): Abend in Standortzeit; kein `Date`-Rechnen. */
function DateField({
  label,
  value,
  onChange,
  hint,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const id = `date-${label.replace(/\W+/g, '-')}`;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={styles.input}
        type="date"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? (
        <span id={`${id}-hint`} className={styles.muted}>
          {hint}
        </span>
      ) : null}
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </div>
  );
}

/** Recherche-Links (FK 14.3 S-31): SIMBAD, AstroBin, NED mit dem Zielnamen. */
export function researchLinks(name: string) {
  const q = encodeURIComponent(name.trim());
  return [
    { name: 'SIMBAD', href: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${q}` },
    { name: 'AstroBin', href: `https://www.astrobin.com/search/?q=${q}` },
    { name: 'NED', href: `https://ned.ipac.caltech.edu/byname?objname=${q}` },
  ];
}
