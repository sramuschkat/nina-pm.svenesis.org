/**
 * Panel-Liste im Projekt-Editor (S-31; FA-PRJ-06, AP-22): Nummer (= NINA-Nummer, NT-32), Bezeichnung,
 * Koordinaten, Rotation, *aktiv*; Umsortieren, Hinzufügen, Löschen (mit Aufnahmen weich, ConfirmDialog).
 * Das Mosaik-Raster entsteht in der Sternkarte (Link mit Raster und Projekt). Der Schalter „Panels getrennt
 * planen“ ist eine Rig-Einstellung (Scheduler, seit R1) – hier angezeigt, ändern dürfen Admins.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { equipmentApi, projectsApi, type ProjectView, type RigView } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CoordinateInput } from '../../components/CoordinateInput';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../admin/shared';
import { equipmentKey, newId, useNumber } from '../equipment/shared';
import { fovForFrame, skyMapHref } from '../planning/skymap/model';
import styles from './projects.module.css';

type Panel = ProjectView['panels'][number];

export interface PanelListProps {
  readonly project: ProjectView;
  readonly rig: RigView | null;
  readonly canEdit: boolean;
  /** Rig-Einstellung „Panels getrennt planen“ ändern (`rig.settings.write`). */
  readonly canRigSettings: boolean;
  readonly onChange: (view: ProjectView) => void;
  readonly onReload: () => Promise<unknown>;
}

export function PanelList({
  project,
  rig,
  canEdit,
  canRigSettings,
  onChange,
  onReload,
}: PanelListProps) {
  const { t } = useTranslation();
  const num = useNumber();
  const client = useQueryClient();
  const titleId = useId();
  const [remove, setRemove] = useState<Panel | null>(null);
  const panels = project.panels;

  const mutation = useMutation({
    mutationFn: (run: () => Promise<ProjectView | { soft: boolean }>) => run(),
    onSuccess: async (result) => {
      if ('id' in result) onChange(result);
      else await onReload();
    },
  });
  const run = (fn: () => Promise<ProjectView | { soft: boolean }>) =>
    mutation.mutateAsync(fn).catch(() => undefined);

  const patch = (
    panel: Panel,
    body: Partial<Pick<Panel, 'label' | 'raDeg' | 'decDeg' | 'rotationDeg' | 'enabled'>>,
  ) => run(() => projectsApi.patchPanel(project.id, panel.id, body));

  const move = (from: number, to: number) => {
    const ids = panels.map((p) => p.id);
    const [id] = ids.splice(from, 1);
    if (id === undefined) return;
    ids.splice(to, 0, id);
    void run(() => projectsApi.reorderPanels(project.id, ids, project.version));
  };

  const independent = rig?.scheduler.mosaicPanelsIndependent ?? true;
  const toggleIndependent = useMutation({
    mutationFn: () => {
      if (!rig) throw new Error('kein Rig');
      return equipmentApi.schedulerSettings(
        rig.id,
        { ...rig.scheduler, mosaicPanelsIndependent: !independent },
        rig.settingsVersion,
      );
    },
    onSuccess: () => client.invalidateQueries({ queryKey: equipmentKey('rigs') }),
  });

  const add = () => {
    const last = panels[panels.length - 1];
    const body = {
      id: newId(),
      label: `Panel ${String(panels.length + 1)}`,
      raDeg: last?.raDeg ?? project.raDeg ?? 0,
      decDeg: last?.decDeg ?? project.decDeg ?? 0,
      rotationDeg: last?.rotationDeg ?? project.rotationDeg,
    };
    void run(() => projectsApi.addPanel(project.id, body));
  };

  const hasCaptures = (p: Panel) => p.lines.some((l) => l.hasCaptures);
  const Up = uiIcons.up;
  const Down = uiIcons.down;
  const Delete = actionIcons.delete;
  const { cols, rows, overlapPct } = project.mosaic;

  return (
    <section className={styles.panelList} aria-labelledby={titleId}>
      <div className={styles.panelListHead}>
        <h2 id={titleId}>{t('projectEditor.panelList.title')}</h2>
        <span className={styles.muted}>
          {cols * rows > 1
            ? t('projectEditor.panelList.mosaic', { cols, rows, overlap: num(overlapPct, 0) })
            : t('projectEditor.panelList.single')}
        </span>
        {project.raDeg !== null && project.decDeg !== null ? (
          <Link
            className={styles.button}
            to={skyMapHref({
              ra: project.raDeg,
              dec: project.decDeg,
              rot: project.rotationDeg,
              rig: project.rigId,
              cols,
              rows,
              overlap: overlapPct,
              project: project.id,
              ...(rig
                ? {
                    fov: fovForFrame(rig.derived.fovWidthDeg, rig.derived.fovHeightDeg, cols, rows),
                  }
                : {}),
            })}
          >
            {t('projectEditor.panelList.editInSkyMap')}
          </Link>
        ) : null}
      </div>
      {rig && panels.length > 1 ? (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={independent}
            disabled={!canRigSettings || toggleIndependent.isPending}
            onChange={() => toggleIndependent.mutate()}
          />
          {t('projectEditor.panelList.independent', { rig: rig.name })}
        </label>
      ) : null}
      {toggleIndependent.isError ? (
        <ProblemMessage code={problemCode(toggleIndependent.error)} />
      ) : null}
      {panels.length === 0 ? (
        <p className={styles.muted}>{t('projectEditor.plan.needsCoordinates')}</p>
      ) : (
        <div className={styles.tableWrap} role="region" aria-labelledby={titleId} tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.num}>
                  {t('projectEditor.panelList.col.number')}
                </th>
                <th scope="col">{t('projectEditor.panelList.col.label')}</th>
                <th scope="col">{t('projectEditor.panelList.col.ra')}</th>
                <th scope="col">{t('projectEditor.panelList.col.dec')}</th>
                <th scope="col">{t('projectEditor.panelList.col.rotation')}</th>
                <th scope="col">{t('projectEditor.panelList.col.enabled')}</th>
                <th scope="col">{t('projectEditor.panelList.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {panels.map((p, i) => (
                <tr key={p.id} className={p.enabled ? undefined : styles.inactiveRow}>
                  <td className={styles.num}>{i + 1}</td>
                  <td>
                    <input
                      className={styles.input}
                      defaultValue={p.label}
                      maxLength={60}
                      aria-label={t('projectEditor.panelList.labelOf', { n: i + 1 })}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== p.label) void patch(p, { label: v });
                      }}
                    />
                  </td>
                  <td>
                    <CoordinateInput
                      kind="ra"
                      label={t('projectEditor.panelList.raOf', { n: i + 1 })}
                      valueDeg={p.raDeg}
                      disabled={!canEdit}
                      onChange={(v) => v !== null && v !== p.raDeg && void patch(p, { raDeg: v })}
                    />
                  </td>
                  <td>
                    <CoordinateInput
                      kind="dec"
                      label={t('projectEditor.panelList.decOf', { n: i + 1 })}
                      valueDeg={p.decDeg}
                      disabled={!canEdit}
                      onChange={(v) => v !== null && v !== p.decDeg && void patch(p, { decDeg: v })}
                    />
                  </td>
                  <td>
                    <input
                      className={styles.numberInput}
                      type="number"
                      min={0}
                      max={359.99}
                      step={0.01}
                      defaultValue={Math.round(p.rotationDeg * 100) / 100}
                      aria-label={t('projectEditor.panelList.rotationOf', { n: i + 1 })}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (
                          Number.isFinite(v) &&
                          v >= 0 &&
                          v < 360 &&
                          Math.abs(v - p.rotationDeg) > 1e-6
                        )
                          void patch(p, { rotationDeg: v });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      disabled={!canEdit}
                      aria-label={t('projectEditor.panelList.enabledOf', { n: i + 1 })}
                      onChange={() => void patch(p, { enabled: !p.enabled })}
                    />
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t('projectEditor.panelList.up', { n: i + 1 })}
                        title={t('projectEditor.panelList.up', { n: i + 1 })}
                        disabled={!canEdit || i === 0}
                        onClick={() => move(i, i - 1)}
                      >
                        <Up size={ICON_SIZE.table} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t('projectEditor.panelList.down', { n: i + 1 })}
                        title={t('projectEditor.panelList.down', { n: i + 1 })}
                        disabled={!canEdit || i === panels.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        <Down size={ICON_SIZE.table} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t('projectEditor.panelList.delete', { label: p.label })}
                        title={t('projectEditor.panelList.delete', { label: p.label })}
                        disabled={!canEdit || panels.length <= 1}
                        onClick={() => setRemove(p)}
                      >
                        <Delete size={ICON_SIZE.table} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && panels.length > 0 ? (
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={add}>
            <actionIcons.add size={ICON_SIZE.button} aria-hidden />
            {t('projectEditor.panelList.add')}
          </button>
        </div>
      ) : null}
      {mutation.isError ? <ProblemMessage code={problemCode(mutation.error)} /> : null}
      <ConfirmDialog
        open={remove !== null}
        title={t('projectEditor.panelList.deleteTitle', { label: remove?.label ?? '' })}
        consequence={
          remove && hasCaptures(remove)
            ? t('projectEditor.panelList.deleteSoft')
            : t('projectEditor.panelList.deleteHard')
        }
        confirmLabel={t('projectEditor.panelList.deleteConfirm')}
        variant="danger"
        onConfirm={async () => {
          const target = remove;
          setRemove(null);
          if (target) await run(() => projectsApi.deletePanel(project.id, target.id));
        }}
        onCancel={() => setRemove(null)}
      />
    </section>
  );
}
