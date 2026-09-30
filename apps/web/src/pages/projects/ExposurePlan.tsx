/**
 * Belichtungsplan im Projekt-Editor S-31 (FA-PRJ-05/07/10/20/21/22, FA-BPL-04/05, NT-E3): unterer
 * Bereich mit einem Reiter je Panel und dem Reiter *Panels* (AP-26b); je Panel Schnelleingabe (Filter,
 * Belichtung, Anzahl **oder** Stunden), Vorlage anwenden (nur ohne Aufnahmen; aufklappbar über *Vorlage*
 * in der Reiterleiste), Tabelle mit Zählern und Inline-Änderung, Zeilenaktionen im ⋯-Menü, Summen als
 * Fußleiste der Karte (Stilsystem AP-26d). Zeilen mit Aufnahmen: Filter,
 * Belichtung, Gain, Offset, Binning, Auslesemodus gesperrt; *Zeile duplizieren* legt eine neue Zeile
 * mit Zählern ab 0 an. Jede Änderung geht sofort an die API, die Antwort ist das ganze Projekt.
 */
import { useMutation } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router';
import {
  projectsApi,
  type CameraView,
  type ExposureTemplateView,
  type FilterView,
  type LineView,
  type MoonProfileView,
  type ProjectView,
  type RigView,
} from '../../api/client';
import { ActionMenu } from '../../components/ActionMenu';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { chipBackground, chipTextColor, FilterChip } from '../../components/FilterChip';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
import { Tabs } from '../../components/Tabs';
import { newId, problemCode, useMoonProfileLabel, useNumber } from '../equipment/shared';
import {
  filterUnassigned,
  hoursFromCount,
  isLocked,
  planSums,
  quickEntryLine,
  templateAllowed,
  templatesFor,
  type PlanSums,
} from './model';
import styles from './projects.module.css';

export interface ExposurePlanProps {
  project: ProjectView;
  canEdit: boolean;
  rig: RigView | null;
  camera: CameraView | null;
  filters: readonly FilterView[];
  moonProfiles: readonly MoonProfileView[];
  templates: readonly ExposureTemplateView[];
  /** Neue Fassung aus der Antwort übernehmen. */
  onChange: (view: ProjectView) => void;
  /** Nach Löschen (Antwort ohne Projekt) neu laden. */
  onReload: () => Promise<unknown>;
  rigPath: string;
}

/** Schlüssel des Reiters *Panels* (Liste, Reihenfolge, Mosaik) neben den Reitern je Panel. */
const PANELS_TAB = 'panels';

export function ExposurePlan(props: ExposurePlanProps & { panelsTab?: ReactNode }) {
  const { t } = useTranslation();
  const { project, canEdit } = props;
  const [tab, setTab] = useState<string>(project.panels[0]?.id ?? PANELS_TAB);
  const allLines = project.panels.flatMap((p) => p.lines);
  // *Vorlage* in der Reiterleiste klappt die Vorlagenzeile auf; ohne Zeilen ist sie gleich offen.
  const [templateOpen, setTemplateOpen] = useState(allLines.length === 0);
  const templateId = useId();

  const mutation = useMutation({
    mutationFn: (run: () => Promise<ProjectView | { soft: boolean } | undefined>) => run(),
    onSuccess: async (result) => {
      if (result && 'id' in result) props.onChange(result);
      else await props.onReload();
    },
  });
  const run = (fn: () => Promise<ProjectView | { soft: boolean } | undefined>) =>
    mutation.mutateAsync(fn).catch(() => undefined);

  if (project.panels.length === 0)
    return (
      <section className={styles.area} aria-label={t('projectEditor.plan.title')}>
        <p className={styles.areaNote}>{t('projectEditor.plan.needsCoordinates')}</p>
      </section>
    );
  // Gelöschtes Panel: auf das erste zurückfallen.
  const active =
    tab === PANELS_TAB && props.panelsTab
      ? PANELS_TAB
      : ((project.panels.find((p) => p.id === tab) ?? project.panels[0])?.id ?? PANELS_TAB);
  const panelBody = (panelId: string) => {
    const panel = project.panels.find((p) => p.id === panelId);
    if (!panel) return null;
    return (
      <div className={styles.planBody}>
        {canEdit ? (
          <div className={styles.planTools}>
            {templateOpen ? (
              <TemplatePicker
                {...props}
                id={templateId}
                panelId={panel.id}
                allowed={templateAllowed(allLines)}
                hasLines={panel.lines.length > 0}
                run={run}
              />
            ) : null}
            <QuickEntry {...props} panelId={panel.id} run={run} />
          </div>
        ) : null}
        {mutation.error ? (
          <div className={styles.planNote}>
            <ProblemMessage code={problemCode(mutation.error)} />
          </div>
        ) : null}
        {panel.lines.some((l) => l.hasCaptures) ? (
          <p className={`${styles.note} ${styles.planNote}`}>
            {t('projectEditor.plan.lockedHint')}
          </p>
        ) : null}
        <LineTable {...props} lines={panel.lines} run={run} />
        <Sums sums={planSums(panel.lines)} label={t('projectEditor.plan.sumsPanel')} />
      </div>
    );
  };
  return (
    <section className={styles.area} aria-label={t('projectEditor.plan.title')}>
      <Tabs<string>
        label={t('projectEditor.plan.title')}
        value={active}
        onChange={setTab}
        tabs={[
          ...project.panels.map((p) => ({ key: p.id, label: p.label })),
          ...(props.panelsTab
            ? [{ key: PANELS_TAB, label: t('projectEditor.panelList.title') }]
            : []),
        ]}
        toolbar={
          canEdit && active !== PANELS_TAB ? (
            <button
              type="button"
              className={styles.button}
              aria-expanded={templateOpen}
              aria-controls={templateOpen ? templateId : undefined}
              onClick={() => setTemplateOpen((o) => !o)}
            >
              {t('projectEditor.plan.template')}
              <uiIcons.menu size={ICON_SIZE.table} aria-hidden />
            </button>
          ) : null
        }
        panels={Object.fromEntries([
          ...project.panels.map((p) => [p.id, panelBody(p.id)]),
          [PANELS_TAB, props.panelsTab ?? null],
        ])}
      />
    </section>
  );
}

type Run = (fn: () => Promise<ProjectView | { soft: boolean } | undefined>) => Promise<unknown>;

// ---- Vorlage anwenden -----------------------------------------------------------------------------

function TemplatePicker({
  project,
  rig,
  templates,
  id: groupId,
  panelId,
  allowed,
  hasLines,
  run,
}: ExposurePlanProps & {
  id: string;
  panelId: string;
  allowed: boolean;
  hasLines: boolean;
  run: Run;
}) {
  const { t } = useTranslation();
  const id = useId();
  const options = templatesFor(templates, rig);
  const [templateId, setTemplateId] = useState('');
  const [allPanels, setAllPanels] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // „Auf alle Panels“ ersetzt die Zeilen **aller** Panels – bestätigen, sobald irgendein Panel Zeilen hat
  // (Prüfung 28.09.2026: vorher zählten nur die Zeilen des offenen Panels).
  const replacesLines = allPanels ? project.panels.some((p) => p.lines.length > 0) : hasLines;
  const apply = () =>
    run(() =>
      projectsApi.applyTemplate(project.id, {
        templateId,
        panelId: allPanels ? null : panelId,
        replace: true,
      }),
    ).then(() => setConfirm(false));
  return (
    <div id={groupId} className={styles.templates}>
      <label htmlFor={id}>
        {t('projectEditor.plan.template')}
        <select
          id={id}
          className={styles.input}
          value={templateId}
          disabled={!allowed || options.length === 0}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">{t('projectEditor.plan.templateChoose')}</option>
          {options.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
        </select>
      </label>
      {project.panels.length > 1 ? (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={allPanels}
            onChange={(e) => setAllPanels(e.target.checked)}
          />
          {t('projectEditor.plan.allPanels')}
        </label>
      ) : null}
      <button
        type="button"
        className={styles.button}
        disabled={!allowed || templateId === ''}
        onClick={() => (replacesLines ? setConfirm(true) : void apply())}
      >
        {t('projectEditor.plan.templateApply')}
      </button>
      {allowed ? null : (
        <span className={styles.muted}>{t('projectEditor.plan.templateLocked')}</span>
      )}
      <Link className={styles.muted} to="/ausruestung/filter">
        {t('projectEditor.plan.templatesEdit')}
      </Link>
      <ConfirmDialog
        open={confirm}
        title={t('projectEditor.plan.templateConfirmTitle')}
        consequence={
          allPanels
            ? t('projectEditor.plan.templateConfirmAll')
            : t('projectEditor.plan.templateConfirm')
        }
        confirmLabel={t('projectEditor.plan.templateApply')}
        onConfirm={apply}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

// ---- Schnelleingabe (FA-PRJ-20) -------------------------------------------------------------------

function QuickEntry({
  project,
  filters,
  camera,
  panelId,
  run,
}: ExposurePlanProps & { panelId: string; run: Run }) {
  const { t } = useTranslation();
  const num = useNumber();
  const ids = { filter: useId(), exposure: useId(), value: useId() };
  const [filterId, setFilterId] = useState('');
  const [exposureS, setExposureS] = useState<number | null>(null);
  const [mode, setMode] = useState<'count' | 'hours'>('count');
  const [value, setValue] = useState<number | null>(null);
  const filter = filters.find((f) => f.id === filterId) ?? null;
  const line = quickEntryLine(
    { filterId, exposureS, mode, value },
    {
      gain: camera?.defaultGain ?? null,
      offsetAdu: camera?.defaultOffset ?? null,
      binning: camera?.defaultBinning ?? 1,
      readoutMode: camera?.defaultReadoutMode ? camera.defaultReadoutMode : null,
      moonProfileId: filter?.defaultMoonProfileId ?? null,
    },
  );
  const derived =
    line === null
      ? null
      : mode === 'count'
        ? t('projectEditor.plan.quickHours', {
            h: num(hoursFromCount(line.plannedCount, line.exposureS), 1),
          })
        : t('projectEditor.plan.quickCount', { n: line.plannedCount });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!line) return;
    void run(() => projectsApi.addLine(project.id, { id: newId(), panelId, ...line })).then(() =>
      setValue(null),
    );
  };
  return (
    <form onSubmit={submit}>
      <fieldset className={styles.quick}>
        <legend>{t('projectEditor.plan.quick')}</legend>
        <label htmlFor={ids.filter}>
          {t('projectEditor.plan.filter')}
          <select
            id={ids.filter}
            className={styles.input}
            value={filterId}
            onChange={(e) => {
              setFilterId(e.target.value);
              const f = filters.find((x) => x.id === e.target.value);
              if (f?.defaultExposureS) setExposureS(f.defaultExposureS);
            }}
          >
            <option value="">{t('projectEditor.plan.filterChoose')}</option>
            {filters.map((f) => (
              <option key={f.id} value={f.id}>
                {f.shortName}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.exposure}>
          {t('projectEditor.plan.exposure')}
          <input
            id={ids.exposure}
            className={`${styles.input} ${styles.small}`}
            type="number"
            min={0}
            step="any"
            value={exposureS ?? ''}
            onChange={(e) => setExposureS(e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        <label className={styles.radio}>
          <input type="radio" checked={mode === 'count'} onChange={() => setMode('count')} />
          {t('projectEditor.plan.modeCount')}
        </label>
        <label className={styles.radio}>
          <input type="radio" checked={mode === 'hours'} onChange={() => setMode('hours')} />
          {t('projectEditor.plan.modeHours')}
        </label>
        <label htmlFor={ids.value}>
          {mode === 'count' ? t('projectEditor.plan.count') : t('projectEditor.plan.hours')}
          <input
            id={ids.value}
            className={`${styles.input} ${styles.small}`}
            type="number"
            min={0}
            step={mode === 'count' ? 1 : 'any'}
            value={value ?? ''}
            onChange={(e) => setValue(e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        <button type="submit" className={styles.buttonPrimary} disabled={line === null}>
          <actionIcons.add size={ICON_SIZE.button} aria-hidden />
          {t('projectEditor.plan.add')}
        </button>
        {derived ? <span className={styles.muted}>{derived}</span> : null}
      </fieldset>
    </form>
  );
}

// ---- Tabelle ----------------------------------------------------------------------------------------

function LineTable(props: ExposurePlanProps & { lines: readonly LineView[]; run: Run }) {
  const { t } = useTranslation();
  const { lines, project, run } = props;
  const [duplicate, setDuplicate] = useState<LineView | null>(null);
  const [deactivate, setDeactivate] = useState(true);
  const [remove, setRemove] = useState<LineView | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  /** Nach *Abbrechen* zurück auf das ⋯-Menü der Zeile (der Menüeintrag ist dann geschlossen). */
  const cancelRemove = () => {
    const label = remove
      ? t('projectEditor.plan.moreFor', { filter: remove.filterShortName })
      : null;
    setRemove(null);
    setTimeout(() => {
      const trigger = [...(tableRef.current?.querySelectorAll('button') ?? [])].find(
        (b) => b.getAttribute('aria-label') === label,
      );
      trigger?.focus();
    }, 0);
  };
  const num = useNumber();
  const moonLabel = useMoonProfileLabel();
  const lineColumns = columnsFor(
    props,
    run,
    { t, num, moonLabel },
    {
      onDuplicate: (line) => {
        setDeactivate(true);
        setDuplicate(line);
      },
      onDelete: setRemove,
    },
  );
  if (lines.length === 0)
    return <p className={`${styles.muted} ${styles.planEmpty}`}>{t('projectEditor.plan.empty')}</p>;
  return (
    <>
      <div ref={tableRef}>
        <DataTable
          columns={lineColumns}
          rows={lines}
          rowKey={(l) => l.id}
          rowLabel={(l) => l.filterShortName}
          label={t('projectEditor.plan.title')}
          rowProps={(l) => ({ 'data-enabled': l.enabled })}
          className={styles.lineTable}
        />
      </div>
      {duplicate ? (
        <div
          className={styles.duplicateBox}
          role="group"
          aria-label={t('projectEditor.plan.duplicate')}
        >
          <span>
            {t('projectEditor.plan.duplicateText', { filter: duplicate.filterShortName })}
          </span>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={deactivate}
              onChange={(e) => setDeactivate(e.target.checked)}
            />
            {t('projectEditor.plan.deactivateSource')}
          </label>
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={() =>
              void run(() =>
                projectsApi.duplicateLine(project.id, duplicate.id, {
                  id: newId(),
                  deactivateSource: deactivate,
                }),
              ).then(() => setDuplicate(null))
            }
          >
            <actionIcons.duplicate size={ICON_SIZE.button} aria-hidden />
            {t('projectEditor.plan.duplicate')}
          </button>
          <button type="button" className={styles.button} onClick={() => setDuplicate(null)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={remove !== null}
        title={t('projectEditor.plan.deleteTitle', { filter: remove?.filterShortName ?? '' })}
        consequence={
          remove?.hasCaptures
            ? t('projectEditor.plan.deleteSoft')
            : t('projectEditor.plan.deleteHard')
        }
        confirmLabel={t('projectEditor.delete')}
        variant="danger"
        onConfirm={() =>
          remove
            ? run(() => projectsApi.deleteLine(project.id, remove.id)).then(() => setRemove(null))
            : undefined
        }
        onCancel={cancelRemove}
      />
    </>
  );
}

/**
 * Spalten des Belichtungsplans (AP-26a): bearbeitbar, **nicht** sortierbar (Reihenfolge = NINA-Reihenfolge).
 * Bei wenig Platz werden Zähler und Kamera-Einstellungen zuerst ausgeblendet und stehen dann in der
 * Detailzeile – Aktiv, Filter, Belichtung, Soll und Aktionen bleiben immer sichtbar.
 */
function columnsFor(
  props: ExposurePlanProps,
  run: Run,
  fmt: {
    t: TFunction;
    num: ReturnType<typeof useNumber>;
    moonLabel: ReturnType<typeof useMoonProfileLabel>;
  },
  actions: { onDuplicate: (line: LineView) => void; onDelete: (line: LineView) => void },
): DataColumn<LineView>[] {
  const { project, canEdit, filters, moonProfiles, camera, rig, rigPath } = props;
  const { t, num, moonLabel } = fmt;
  const patch = (line: LineView, body: object) =>
    void run(() => projectsApi.patchLine(project.id, line.id, body));
  const locked = (line: LineView, field: string) => !canEdit || isLocked(line, field);
  const lockTitle = t('projectEditor.plan.lockedTitle');
  const Lock = actionIcons.lock;
  const lockedText = (line: LineView, text: string) => (
    <span className={styles.locked} title={lockTitle}>
      {line.hasCaptures ? <Lock size={ICON_SIZE.table} aria-label={lockTitle} /> : null}
      {text}
    </span>
  );
  const binnings = camera?.supportedBinning.length ? camera.supportedBinning : [1, 2, 3, 4];
  return [
    {
      id: 'enabled',
      header: t('projectEditor.plan.col.enabled'),
      cell: (line) => (
        <input
          type="checkbox"
          checked={line.enabled}
          disabled={!canEdit}
          aria-label={t('projectEditor.plan.enabledFor', { filter: line.filterShortName })}
          onChange={(e) => patch(line, { enabled: e.target.checked })}
        />
      ),
    },
    {
      id: 'filter',
      header: t('projectEditor.plan.col.filter'),
      nowrap: true,
      cell: (line) => {
        const filter = filters.find((f) => f.id === line.filterId);
        const name = line.filterShortName;
        return (
          <>
            {locked(line, 'filterId') ? (
              <span className={styles.locked} title={line.hasCaptures ? lockTitle : undefined}>
                {line.hasCaptures ? <Lock size={ICON_SIZE.table} aria-label={lockTitle} /> : null}
                <FilterChip shortName={name} color={filter?.colorHex ?? '#888888'} size="sm" />
              </span>
            ) : (
              // Auswahl in der Filterfarbe wie der Filter-Chip (Wunsch Sven 30.09.2026); Kontrast wie
              // `FilterChip` (≥ 4,5:1). Die Optionen tragen ihre Farbe, soweit der Browser das zeigt.
              <select
                className={`${styles.input} ${styles.filterSelect}`}
                aria-label={t('projectEditor.plan.filterFor', { filter: name })}
                value={line.filterId ?? ''}
                onChange={(e) => patch(line, { filterId: e.target.value })}
                style={
                  filter
                    ? {
                        background: chipBackground(filter.colorHex),
                        color: chipTextColor(filter.colorHex),
                      }
                    : undefined
                }
              >
                {filters.map((f) => (
                  <option
                    key={f.id}
                    value={f.id}
                    style={{
                      background: chipBackground(f.colorHex),
                      color: chipTextColor(f.colorHex),
                    }}
                  >
                    {f.shortName}
                  </option>
                ))}
              </select>
            )}
            {filterUnassigned(line.filterId, rig?.filterWheel) ? (
              <Link className={styles.flag} to={rigPath}>
                {t('projectEditor.plan.unassigned')}
              </Link>
            ) : null}
          </>
        );
      },
    },
    {
      id: 'exposure',
      header: t('projectEditor.plan.col.exposure'),
      align: 'end',
      cell: (line) =>
        locked(line, 'exposureS') ? (
          lockedText(line, `${num(line.exposureS, 0)} s`)
        ) : (
          <NumberCell
            label={t('projectEditor.plan.exposureFor', { filter: line.filterShortName })}
            value={line.exposureS}
            onCommit={(v) => (v !== null && v > 0 ? patch(line, { exposureS: v }) : undefined)}
          />
        ),
    },
    {
      id: 'planned',
      header: t('projectEditor.plan.col.planned'),
      align: 'end',
      cell: (line) =>
        canEdit ? (
          <NumberCell
            label={t('projectEditor.plan.plannedFor', { filter: line.filterShortName })}
            value={line.plannedCount}
            step={1}
            onCommit={(v) =>
              v !== null && v >= 0 ? patch(line, { plannedCount: Math.round(v) }) : undefined
            }
          />
        ) : (
          line.plannedCount
        ),
    },
    {
      id: 'progress',
      header: t('projectEditor.plan.col.progress'),
      priority: 2,
      cell: (line) => (
        <ProgressBar
          acquired={line.counters.accepted}
          planned={line.counters.planned}
          bonus={line.counters.bonus}
          exposureS={line.exposureS}
          size="sm"
        />
      ),
    },
    {
      id: 'accepted',
      header: t('projectEditor.plan.col.accepted'),
      align: 'end',
      priority: 2,
      cell: (line) => line.counters.accepted,
    },
    {
      id: 'moon',
      header: t('projectEditor.plan.col.moon'),
      priority: 2,
      cell: (line) => {
        const value =
          line.moonMode === 'profile'
            ? (line.moonProfileId ?? '')
            : line.moonMode === 'none'
              ? 'none'
              : 'project';
        return (
          <select
            className={styles.input}
            aria-label={t('projectEditor.plan.moonFor', { filter: line.filterShortName })}
            value={value}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value;
              patch(
                line,
                v === 'project'
                  ? { moonMode: 'project_default', moonProfileId: null }
                  : v === 'none'
                    ? { moonMode: 'none', moonProfileId: null }
                    : { moonMode: 'profile', moonProfileId: v },
              );
            }}
          >
            <option value="project">{t('projectEditor.plan.moonProject')}</option>
            <option value="none">{t('projectEditor.plan.moonNone')}</option>
            {moonProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {moonLabel(p.name)}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      id: 'total',
      header: t('projectEditor.plan.col.total'),
      align: 'end',
      nowrap: true,
      priority: 3,
      cell: (line) => `${num((line.plannedCount * line.exposureS) / 3600, 1)} h`,
    },
    {
      id: 'gain',
      header: t('projectEditor.plan.col.gain'),
      priority: 3,
      cell: (line) =>
        locked(line, 'gain') ? (
          lockedText(line, line.gain === null ? t('projectEditor.plan.default') : String(line.gain))
        ) : (
          <NumberCell
            label={t('projectEditor.plan.gainFor', { filter: line.filterShortName })}
            value={line.gain}
            step={1}
            placeholder={t('projectEditor.plan.default')}
            onCommit={(v) => patch(line, { gain: v === null ? null : Math.round(v) })}
          />
        ),
    },
    {
      id: 'offset',
      header: t('projectEditor.plan.col.offset'),
      priority: 3,
      cell: (line) =>
        locked(line, 'offsetAdu') ? (
          lockedText(
            line,
            line.offsetAdu === null ? t('projectEditor.plan.default') : String(line.offsetAdu),
          )
        ) : (
          <NumberCell
            label={t('projectEditor.plan.offsetFor', { filter: line.filterShortName })}
            value={line.offsetAdu}
            step={1}
            placeholder={t('projectEditor.plan.default')}
            onCommit={(v) => patch(line, { offsetAdu: v === null ? null : Math.round(v) })}
          />
        ),
    },
    {
      id: 'binning',
      header: t('projectEditor.plan.col.binning'),
      priority: 3,
      cell: (line) =>
        locked(line, 'binning') ? (
          lockedText(line, `${line.binning}×${line.binning}`)
        ) : (
          <select
            className={styles.input}
            aria-label={t('projectEditor.plan.binningFor', { filter: line.filterShortName })}
            value={line.binning}
            onChange={(e) => patch(line, { binning: Number(e.target.value) })}
          >
            {binnings.map((b) => (
              <option key={b} value={b}>{`${b}×${b}`}</option>
            ))}
          </select>
        ),
    },
    {
      id: 'readout',
      header: t('projectEditor.plan.col.readout'),
      priority: 4,
      cell: (line) =>
        locked(line, 'readoutMode') ? (
          lockedText(line, line.readoutMode ?? t('projectEditor.plan.default'))
        ) : (
          <select
            className={styles.input}
            aria-label={t('projectEditor.plan.readoutFor', { filter: line.filterShortName })}
            value={line.readoutMode ?? ''}
            onChange={(e) =>
              patch(line, { readoutMode: e.target.value === '' ? null : e.target.value })
            }
          >
            <option value="">{t('projectEditor.plan.default')}</option>
            {(camera?.readoutModes ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ),
    },
    {
      id: 'percent',
      header: t('projectEditor.plan.col.percent'),
      align: 'end',
      nowrap: true,
      priority: 4,
      cell: (line) => `${num(line.counters.percentDone, 0)} %`,
    },
    {
      id: 'acquired',
      header: t('projectEditor.plan.col.acquired'),
      align: 'end',
      priority: 5,
      cell: (line) => line.counters.acquired,
    },
    {
      id: 'rejected',
      header: t('projectEditor.plan.col.rejected'),
      align: 'end',
      priority: 5,
      cell: (line) => line.counters.rejected,
    },
    {
      id: 'bonus',
      header: t('projectEditor.plan.col.bonus'),
      align: 'end',
      priority: 5,
      cell: (line) => line.counters.bonus,
    },
    {
      id: 'actions',
      header: t('projectEditor.plan.col.actions'),
      headerHidden: true,
      align: 'end',
      cell: (line) =>
        canEdit ? (
          <ActionMenu
            size="sm"
            label={t('projectEditor.plan.moreFor', { filter: line.filterShortName })}
            items={[
              {
                key: 'duplicate',
                label: t('projectEditor.plan.duplicate'),
                icon: <actionIcons.duplicate size={ICON_SIZE.table} aria-hidden />,
                onSelect: () => actions.onDuplicate(line),
              },
              {
                key: 'delete',
                label: t('projectEditor.delete'),
                icon: <actionIcons.delete size={ICON_SIZE.table} aria-hidden />,
                danger: true,
                onSelect: () => actions.onDelete(line),
              },
            ]}
          />
        ) : null,
    },
  ];
}

/** Zahl in der Tabelle: lokale Eingabe, übernommen beim Verlassen bzw. mit Enter. */
function NumberCell({
  label,
  value,
  step = 'any',
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  step?: number | 'any';
  placeholder?: string;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(value === null ? '' : String(value));
  }
  const commit = () => {
    const raw = text.trim().replace(',', '.');
    const next = raw === '' ? null : Number(raw);
    if (next !== null && !Number.isFinite(next)) return;
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className={styles.input}
      type="number"
      step={step}
      min={0}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

/**
 * Summen als Fußleiste der Plan-Karte (FA-PRJ-21, Stilsystem AP-26d): Filter · Geplant Frames/Stunden ·
 * Aktuell Frames/Stunden · Gesamtfortschritt; Beschriftung gedämpft, Werte kräftig.
 */
export function Sums({ sums, label }: { sums: PlanSums; label: string }) {
  const { t } = useTranslation();
  const num = useNumber();
  return (
    <p className={styles.sums} aria-label={label}>
      <span>{t('projectEditor.plan.sumFilters', { n: sums.filters })}</span>
      <span>
        {t('projectEditor.plan.sumPlanned')}{' '}
        <strong>
          {t('projectEditor.plan.sumFrames', {
            n: sums.plannedFrames,
            h: num(sums.plannedS / 3600, 1),
          })}
        </strong>
      </span>
      <span>
        {t('projectEditor.plan.sumCurrent')}{' '}
        <strong>
          {t('projectEditor.plan.sumFrames', {
            n: sums.acceptedFrames,
            h: num(sums.acceptedS / 3600, 1),
          })}
        </strong>
      </span>
      <span>{t('projectEditor.plan.sumProgress', { pct: num(sums.percent, 0) })}</span>
    </p>
  );
}
