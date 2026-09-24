/**
 * Belichtungsplan im Projekt-Editor S-31 (FA-PRJ-05/07/10/20/21/22, FA-BPL-04/05, NT-E3): Reiter je
 * Panel, Schnelleingabe (Filter, Belichtung, Anzahl **oder** Stunden), Vorlage anwenden (nur ohne
 * Aufnahmen), Tabelle mit Zählern und Inline-Änderung, Summenzeile. Zeilen mit Aufnahmen: Filter,
 * Belichtung, Gain, Offset, Binning, Auslesemodus gesperrt; *Zeile duplizieren* legt eine neue Zeile
 * mit Zählern ab 0 an. Jede Änderung geht sofort an die API, die Antwort ist das ganze Projekt.
 */
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FilterChip } from '../../components/FilterChip';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { ProgressBar } from '../../components/ProgressBar';
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

export function ExposurePlan(props: ExposurePlanProps) {
  const { t } = useTranslation();
  const { project, canEdit } = props;
  const [panelIndex, setPanelIndex] = useState(0);
  const panel = project.panels[panelIndex] ?? project.panels[0];
  const allLines = project.panels.flatMap((p) => p.lines);

  const mutation = useMutation({
    mutationFn: (run: () => Promise<ProjectView | { soft: boolean } | undefined>) => run(),
    onSuccess: async (result) => {
      if (result && 'id' in result) props.onChange(result);
      else await props.onReload();
    },
  });
  const run = (fn: () => Promise<ProjectView | { soft: boolean } | undefined>) =>
    mutation.mutateAsync(fn).catch(() => undefined);

  if (!panel)
    return (
      <section className={styles.plan} aria-labelledby="plan-title">
        <h2 id="plan-title">{t('projectEditor.plan.title')}</h2>
        <p className={styles.note}>{t('projectEditor.plan.needsCoordinates')}</p>
      </section>
    );

  return (
    <section className={styles.plan} aria-labelledby="plan-title">
      <div className={styles.planHead}>
        <h2 id="plan-title">{t('projectEditor.plan.title')}</h2>
        {project.panels.length > 1 ? (
          <div className={styles.tabs} role="tablist" aria-label={t('projectEditor.plan.panels')}>
            {project.panels.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === panel.id}
                className={styles.tab}
                onClick={() => setPanelIndex(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        {canEdit ? (
          <TemplatePicker
            {...props}
            panelId={panel.id}
            allowed={templateAllowed(allLines)}
            hasLines={panel.lines.length > 0}
            run={run}
          />
        ) : null}
      </div>
      {canEdit ? <QuickEntry {...props} panelId={panel.id} run={run} /> : null}
      {mutation.error ? <ProblemMessage code={problemCode(mutation.error)} /> : null}
      {panel.lines.some((l) => l.hasCaptures) ? (
        <p className={styles.note}>{t('projectEditor.plan.lockedHint')}</p>
      ) : null}
      <LineTable {...props} lines={panel.lines} run={run} />
      <Sums sums={planSums(panel.lines)} label={t('projectEditor.plan.sumsPanel')} />
    </section>
  );
}

type Run = (fn: () => Promise<ProjectView | { soft: boolean } | undefined>) => Promise<unknown>;

// ---- Vorlage anwenden -----------------------------------------------------------------------------

function TemplatePicker({
  project,
  rig,
  templates,
  panelId,
  allowed,
  hasLines,
  run,
}: ExposurePlanProps & { panelId: string; allowed: boolean; hasLines: boolean; run: Run }) {
  const { t } = useTranslation();
  const id = useId();
  const options = templatesFor(templates, rig);
  const [templateId, setTemplateId] = useState('');
  const [allPanels, setAllPanels] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const apply = () =>
    run(() =>
      projectsApi.applyTemplate(project.id, {
        templateId,
        panelId: allPanels ? null : panelId,
        replace: true,
      }),
    ).then(() => setConfirm(false));
  return (
    <div className={styles.templates}>
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
        onClick={() => (hasLines ? setConfirm(true) : void apply())}
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
        consequence={t('projectEditor.plan.templateConfirm')}
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
  if (lines.length === 0) return <p className={styles.muted}>{t('projectEditor.plan.empty')}</p>;
  return (
    <>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.lineTable}`}>
          <thead>
            <tr>
              <th scope="col">{t('projectEditor.plan.col.enabled')}</th>
              <th scope="col">{t('projectEditor.plan.col.filter')}</th>
              <th scope="col">{t('projectEditor.plan.col.moon')}</th>
              <th scope="col" className={styles.num}>
                {t('projectEditor.plan.col.exposure')}
              </th>
              <th scope="col" className={styles.num}>
                {t('projectEditor.plan.col.planned')}
              </th>
              <th scope="col" className={styles.num}>
                {t('projectEditor.plan.col.acquired')}
              </th>
              <th scope="col" className={styles.num}>
                {t('projectEditor.plan.col.rejected')}
              </th>
              <th scope="col" className={styles.num}>
                {t('projectEditor.plan.col.accepted')}
              </th>
              <th scope="col" className={styles.num}>
                {t('projectEditor.plan.col.bonus')}
              </th>
              <th scope="col">{t('projectEditor.plan.col.progress')}</th>
              <th scope="col">{t('projectEditor.plan.col.gain')}</th>
              <th scope="col">{t('projectEditor.plan.col.offset')}</th>
              <th scope="col">{t('projectEditor.plan.col.binning')}</th>
              <th scope="col">{t('projectEditor.plan.col.readout')}</th>
              <th scope="col" className={styles.num}>
                {t('projectEditor.plan.col.total')}
              </th>
              <th scope="col" className={styles.num}>
                {t('projectEditor.plan.col.percent')}
              </th>
              <th scope="col">{t('projectEditor.plan.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <LineRow
                key={line.id}
                {...props}
                line={line}
                onDuplicate={() => {
                  setDeactivate(true);
                  setDuplicate(line);
                }}
                onDelete={() => setRemove(line)}
              />
            ))}
          </tbody>
        </table>
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
        onCancel={() => setRemove(null)}
      />
    </>
  );
}

function LineRow({
  project,
  line,
  canEdit,
  filters,
  moonProfiles,
  camera,
  rig,
  rigPath,
  run,
  onDuplicate,
  onDelete,
}: ExposurePlanProps & {
  line: LineView;
  run: Run;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const num = useNumber();
  const moonLabel = useMoonProfileLabel();
  const filter = filters.find((f) => f.id === line.filterId);
  const name = line.filterShortName;
  const patch = (body: object) => void run(() => projectsApi.patchLine(project.id, line.id, body));
  const locked = (field: string) => !canEdit || isLocked(line, field);
  const lockTitle = t('projectEditor.plan.lockedTitle');
  const Lock = actionIcons.lock;
  const lockedText = (text: string) => (
    <span className={styles.locked} title={lockTitle}>
      {line.hasCaptures ? <Lock size={ICON_SIZE.table} aria-label={lockTitle} /> : null}
      {text}
    </span>
  );
  const moonValue =
    line.moonMode === 'profile'
      ? (line.moonProfileId ?? '')
      : line.moonMode === 'none'
        ? 'none'
        : 'project';
  const binnings = camera?.supportedBinning.length ? camera.supportedBinning : [1, 2, 3, 4];
  const unassigned = filterUnassigned(line.filterId, rig?.filterWheel);
  return (
    <tr data-enabled={line.enabled}>
      <td>
        <input
          type="checkbox"
          checked={line.enabled}
          disabled={!canEdit}
          aria-label={t('projectEditor.plan.enabledFor', { filter: name })}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
      </td>
      <td>
        {locked('filterId') ? (
          <span className={styles.locked} title={line.hasCaptures ? lockTitle : undefined}>
            {line.hasCaptures ? <Lock size={ICON_SIZE.table} aria-label={lockTitle} /> : null}
            <FilterChip shortName={name} color={filter?.colorHex ?? '#888888'} size="sm" />
          </span>
        ) : (
          <select
            className={styles.input}
            aria-label={t('projectEditor.plan.filterFor', { filter: name })}
            value={line.filterId ?? ''}
            onChange={(e) => patch({ filterId: e.target.value })}
          >
            {filters.map((f) => (
              <option key={f.id} value={f.id}>
                {f.shortName}
              </option>
            ))}
          </select>
        )}
        {unassigned ? (
          <Link className={styles.flag} to={rigPath}>
            {t('projectEditor.plan.unassigned')}
          </Link>
        ) : null}
      </td>
      <td>
        <select
          className={styles.input}
          aria-label={t('projectEditor.plan.moonFor', { filter: name })}
          value={moonValue}
          disabled={!canEdit}
          onChange={(e) => {
            const v = e.target.value;
            patch(
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
      </td>
      <td className={styles.num}>
        {locked('exposureS') ? (
          lockedText(`${num(line.exposureS, 0)} s`)
        ) : (
          <NumberCell
            label={t('projectEditor.plan.exposureFor', { filter: name })}
            value={line.exposureS}
            onCommit={(v) => (v !== null && v > 0 ? patch({ exposureS: v }) : undefined)}
          />
        )}
      </td>
      <td className={styles.num}>
        {canEdit ? (
          <NumberCell
            label={t('projectEditor.plan.plannedFor', { filter: name })}
            value={line.plannedCount}
            step={1}
            onCommit={(v) =>
              v !== null && v >= 0 ? patch({ plannedCount: Math.round(v) }) : undefined
            }
          />
        ) : (
          line.plannedCount
        )}
      </td>
      <td className={styles.num}>{line.counters.acquired}</td>
      <td className={styles.num}>{line.counters.rejected}</td>
      <td className={styles.num}>{line.counters.accepted}</td>
      <td className={styles.num}>{line.counters.bonus}</td>
      <td>
        <ProgressBar
          acquired={line.counters.accepted}
          planned={line.counters.planned}
          bonus={line.counters.bonus}
          exposureS={line.exposureS}
          size="sm"
        />
      </td>
      <td>
        {locked('gain') ? (
          lockedText(line.gain === null ? t('projectEditor.plan.default') : String(line.gain))
        ) : (
          <NumberCell
            label={t('projectEditor.plan.gainFor', { filter: name })}
            value={line.gain}
            step={1}
            placeholder={t('projectEditor.plan.default')}
            onCommit={(v) => patch({ gain: v === null ? null : Math.round(v) })}
          />
        )}
      </td>
      <td>
        {locked('offsetAdu') ? (
          lockedText(
            line.offsetAdu === null ? t('projectEditor.plan.default') : String(line.offsetAdu),
          )
        ) : (
          <NumberCell
            label={t('projectEditor.plan.offsetFor', { filter: name })}
            value={line.offsetAdu}
            step={1}
            placeholder={t('projectEditor.plan.default')}
            onCommit={(v) => patch({ offsetAdu: v === null ? null : Math.round(v) })}
          />
        )}
      </td>
      <td>
        {locked('binning') ? (
          lockedText(`${line.binning}×${line.binning}`)
        ) : (
          <select
            className={styles.input}
            aria-label={t('projectEditor.plan.binningFor', { filter: name })}
            value={line.binning}
            onChange={(e) => patch({ binning: Number(e.target.value) })}
          >
            {binnings.map((b) => (
              <option key={b} value={b}>{`${b}×${b}`}</option>
            ))}
          </select>
        )}
      </td>
      <td>
        {locked('readoutMode') ? (
          lockedText(line.readoutMode ?? t('projectEditor.plan.default'))
        ) : (
          <select
            className={styles.input}
            aria-label={t('projectEditor.plan.readoutFor', { filter: name })}
            value={line.readoutMode ?? ''}
            onChange={(e) => patch({ readoutMode: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">{t('projectEditor.plan.default')}</option>
            {(camera?.readoutModes ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className={styles.num}>{`${num((line.plannedCount * line.exposureS) / 3600, 1)} h`}</td>
      <td className={styles.num}>{`${num(line.counters.percentDone, 0)} %`}</td>
      <td>
        {canEdit ? (
          <span className={styles.rowActions}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('projectEditor.plan.duplicateFor', { filter: name })}
              title={t('projectEditor.plan.duplicate')}
              onClick={onDuplicate}
            >
              <actionIcons.duplicate size={ICON_SIZE.table} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('projectEditor.plan.deleteFor', { filter: name })}
              title={t('projectEditor.delete')}
              onClick={onDelete}
            >
              <actionIcons.delete size={ICON_SIZE.table} aria-hidden />
            </button>
          </span>
        ) : null}
      </td>
    </tr>
  );
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

/** Fußzeile: Filter · GEPLANT Frames/Stunden · AKTUELL Frames/Stunden · Gesamtfortschritt (FA-PRJ-21). */
export function Sums({ sums, label }: { sums: PlanSums; label: string }) {
  const { t } = useTranslation();
  const num = useNumber();
  return (
    <p className={styles.sums} aria-label={label}>
      <span>{t('projectEditor.plan.sumFilters', { n: sums.filters })}</span>
      <span>
        <strong>{t('projectEditor.plan.sumPlanned')}</strong>{' '}
        {t('projectEditor.plan.sumFrames', {
          n: sums.plannedFrames,
          h: num(sums.plannedS / 3600, 1),
        })}
      </span>
      <span>
        <strong>{t('projectEditor.plan.sumCurrent')}</strong>{' '}
        {t('projectEditor.plan.sumFrames', {
          n: sums.acceptedFrames,
          h: num(sums.acceptedS / 3600, 1),
        })}
      </span>
      <span>{t('projectEditor.plan.sumProgress', { pct: num(sums.percent, 0) })}</span>
    </p>
  );
}
