/**
 * Reiter „Bilder“ im Projekt (AP-72b, FA-AUS-25; Entwurf „AP-72b Bilder im Projekt“, Sven 09.10.2026): alle Lights des
 * Projekts über alle Nächte mit Bewertung gegen die Grenzwerte des Rigs. Kopf mit Filter-, Bewertungs- und Nachtauswahl,
 * „Markierte verwerfen“ und CSV mit Pfaden; Bezugsleiste; Tabelle; Seitenleiste mit allen Werten des gewählten Bilds,
 * Datei zum Kopieren, Verwerfen/Behalten. ↑/↓ wechseln das Bild, solange der Fokus im Reiter ist.
 */
import { formatNightKey, formatZonedTime } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { sessionsApi, type ProjectImage, type ProjectImagesView } from '../../api/client';
import { useAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../equipment/shared';
import {
  filtersOf,
  gradeCounts,
  imagesCsv,
  nightsOf,
  selectImages,
  type GradeChip,
} from './images-model';
import styles from './images.module.css';

const PAGE = 300;

export function ProjectImagesTab({
  projectId,
  initialImageId = null,
}: {
  projectId: string;
  /** Aus der Nacht verlinktes Bild (`?bild=`): vorgewählt mit seinem Filter und seiner Nacht. */
  initialImageId?: string | null;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['project-images', projectId],
    queryFn: () => sessionsApi.projectImages(projectId),
  });
  if (query.isPending) return <p role="status">{t('common.loading')}</p>;
  if (query.isError)
    return <ProblemMessage code={problemCode(query.error)} onRetry={() => void query.refetch()} />;
  if (query.data.items.length === 0) return <p className={styles.muted}>{t('images.empty')}</p>;
  return <ImagesView view={query.data} initialImageId={initialImageId} />;
}

function ImagesView({
  view,
  initialImageId,
}: {
  view: ProjectImagesView;
  initialImageId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const client = useQueryClient();
  const initial = view.items.find((i) => i.id === initialImageId) ?? null;
  const [filter, setFilter] = useState<string | null>(initial?.filter ?? null);
  const [grade, setGrade] = useState<GradeChip>(initial ? 'all' : 'flagged');
  const [night, setNight] = useState<string | null>(initial?.night ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);
  const [shown, setShown] = useState(PAGE);
  const [confirm, setConfirm] = useState(false);
  const counts = gradeCounts(view.items, { filter, night });
  // Ohne markierte Bilder öffnet der Reiter mit allen statt einer leeren Liste.
  const effectiveGrade: GradeChip = grade === 'flagged' && counts.flagged === 0 ? 'all' : grade;
  const list = useMemo(
    () => selectImages(view.items, { filter, grade: effectiveGrade, night }),
    [view.items, filter, effectiveGrade, night],
  );
  const selected = list.find((i) => i.id === selectedId) ?? list[0] ?? null;
  const index = selected ? list.indexOf(selected) : -1;
  const flaggedIds = list.filter((i) => i.grade === 'flagged').map((i) => i.id);
  const n = (v: number | null, d = 2) =>
    v === null ? '–' : v.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const scale = view.scaleArcsecPx;
  const hfrText = (i: ProjectImage) =>
    i.hfrArcsec !== null ? `${n(i.hfrArcsec)}″` : i.hfr !== null ? `${n(i.hfr)} px` : '–';
  const limitText = (i: ProjectImage, f: ProjectImage['flags'][number]) => {
    if (f.metric === 'hfr')
      return scale ? `${n(f.limit * scale * (i.binning ?? 1))}″` : `${n(f.limit)} px`;
    if (f.metric === 'rms') return `${n(f.limit)}″`;
    if (f.metric === 'cloud') return `${n(f.limit, 0)} %`;
    return n(f.limit, 0);
  };
  const valueText = (i: ProjectImage, f: ProjectImage['flags'][number]) =>
    f.metric === 'hfr'
      ? hfrText(i)
      : f.metric === 'rms'
        ? `${n(f.value)}″`
        : f.metric === 'cloud'
          ? `${n(f.value, 0)} %`
          : n(f.value, 0);
  const reasonShort = (i: ProjectImage) =>
    i.flags.map((f) => t(`images.metric.${f.metric}`)).join(', ');
  const refresh = () => client.invalidateQueries({ queryKey: ['project-images', view.projectId] });
  const reject = useMutation({
    mutationFn: (v: { ids: string[]; rejected: boolean }) =>
      sessionsApi.rejectImages(view.projectId, v.ids, v.rejected),
    onSuccess: refresh,
  });
  const keep = useMutation({
    mutationFn: (v: { id: string; kept: boolean }) => sessionsApi.keepImage(v.id, v.kept),
    onSuccess: refresh,
  });
  const move = (step: number) => {
    const next = list[Math.min(list.length - 1, Math.max(0, index + step))];
    if (next) setSelectedId(next.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('select, input, [role="dialog"]')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    }
  };
  const download = () => {
    const csv = imagesCsv(list, [
      'capturedAtUtc',
      'night',
      'filter',
      'grade',
      'flags',
      'hfr',
      'stars',
      'rmsArcsec',
      'cloudCoverPct',
      'fileName',
      'relativePath',
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bilder-${view.projectId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const columns: DataColumn<ProjectImage>[] = [
    {
      id: 'time',
      header: t('images.col.time'),
      cell: (i) => (
        <button
          type="button"
          className={styles.rowButton}
          aria-pressed={selected?.id === i.id}
          onClick={() => setSelectedId(i.id)}
        >
          {formatNightKey(i.night).slice(0, 6)} {formatZonedTime(i.capturedAt, zone)}
        </button>
      ),
      sortValue: (i) => i.capturedAt,
      nowrap: true,
    },
    {
      id: 'night',
      header: t('images.col.night'),
      cell: (i) => formatNightKey(i.night),
      sortValue: (i) => i.night,
      priority: 3,
      nowrap: true,
    },
    { id: 'filter', header: t('images.col.filter'), cell: (i) => i.filter, priority: 2 },
    {
      id: 'hfr',
      header: t('images.col.hfr'),
      cell: (i) => <span data-bad={i.flags.some((f) => f.metric === 'hfr')}>{hfrText(i)}</span>,
      sortValue: (i) => i.hfrArcsec ?? i.hfr,
      align: 'end',
      nowrap: true,
    },
    {
      id: 'stars',
      header: t('images.col.stars'),
      cell: (i) => (
        <span data-bad={i.flags.some((f) => f.metric === 'stars')}>{n(i.stars, 0)}</span>
      ),
      sortValue: (i) => i.stars,
      align: 'end',
    },
    {
      id: 'rms',
      header: t('images.col.rms'),
      cell: (i) => <span data-bad={i.flags.some((f) => f.metric === 'rms')}>{n(i.rmsArcsec)}</span>,
      sortValue: (i) => i.rmsArcsec,
      align: 'end',
      priority: 2,
    },
    {
      id: 'cloud',
      header: t('images.col.cloud'),
      cell: (i) => (
        <span data-bad={i.flags.some((f) => f.metric === 'cloud')}>
          {i.cloudCoverPct === null ? '–' : `${n(i.cloudCoverPct, 0)} %`}
        </span>
      ),
      sortValue: (i) => i.cloudCoverPct,
      align: 'end',
      priority: 3,
    },
    {
      id: 'grade',
      header: t('images.col.grade'),
      cell: (i) => (
        <span className={styles.grade} data-grade={i.grade}>
          {i.grade === 'flagged'
            ? `⚠ ${reasonShort(i)}`
            : i.grade === 'rejected'
              ? t('images.rejectedWith', {
                  reason: t(`sessions.correction.reasons.${i.rejectReason ?? 'other'}`),
                })
              : t(`images.grade.${i.grade}`)}
        </span>
      ),
      sortValue: (i) => i.grade,
      nowrap: true,
    },
  ];
  const ref = view.refs.find((r) => r.filter === (filter ?? selected?.filter));
  const s = view.settings;
  const nightPoints = selected
    ? view.items.filter((i) => i.night === selected.night && (i.hfrArcsec ?? i.hfr) !== null)
    : [];
  const hfrs = nightPoints.map((i) => (i.hfrArcsec ?? i.hfr) as number);
  const lo = Math.min(...hfrs);
  const hi = Math.max(...hfrs);
  const times = nightPoints.map((i) => Date.parse(i.capturedAt));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 1);
  const chip = (on: boolean) => ({ className: styles.chip, 'aria-pressed': on });

  return (
    <div className={styles.root} onKeyDown={onKeyDown}>
      <div className={styles.toolbar}>
        <div role="group" aria-label={t('images.filter')} className={styles.chips}>
          <span className={styles.label}>{t('images.filter')}</span>
          <button type="button" {...chip(filter === null)} onClick={() => setFilter(null)}>
            {t('images.all')}
          </button>
          {filtersOf(view.items).map((f) => (
            <button key={f} type="button" {...chip(filter === f)} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t('images.grading')} className={styles.chips}>
          <span className={styles.label}>{t('images.grading')}</span>
          {(['all', 'flagged', 'rejected', 'ok'] as const).map((g) => (
            <button
              key={g}
              type="button"
              {...chip(effectiveGrade === g)}
              onClick={() => setGrade(g)}
            >
              {t(`images.chip.${g}`, { count: counts[g] })}
            </button>
          ))}
        </div>
        <label className={styles.nightSelect}>
          {t('images.night')}
          <select
            value={night ?? ''}
            onChange={(e) => setNight(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">{t('images.allNights')}</option>
            {nightsOf(view.items).map((k) => (
              <option key={k} value={k}>
                {formatNightKey(k)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.actions}>
          {view.canCorrect ? (
            <button
              type="button"
              className={styles.primary}
              disabled={flaggedIds.length === 0 || reject.isPending}
              onClick={() => setConfirm(true)}
            >
              {t('images.rejectFlagged', { count: flaggedIds.length })}
            </button>
          ) : null}
          <button type="button" className={styles.button} onClick={download}>
            {t('images.csv')}
          </button>
        </div>
      </div>
      <p className={styles.refBar}>
        {ref ? (
          <span>
            {t('images.ref', {
              filter: ref.filter,
              n: ref.n,
              hfr:
                ref.hfrArcsec !== null
                  ? `${n(ref.hfrArcsec)}″`
                  : ref.hfr !== null
                    ? `${n(ref.hfr)} px`
                    : '–',
              stars: n(ref.stars, 0),
              rms: ref.rmsArcsec === null ? '–' : `${n(ref.rmsArcsec)}″`,
            })}
            {ref.n < view.minRef ? ` · ${t('images.refFew', { min: view.minRef })}` : ''}
          </span>
        ) : (
          <span>{t('images.refChoose')}</span>
        )}
        <span className={styles.limits}>
          {t('images.limits', {
            hfr: s.hfrPct === null ? t('images.off') : `+${n(s.hfrPct, 0)} %`,
            stars: s.starsPct === null ? t('images.off') : `${n(s.starsPct, 0)} %`,
            rms: s.rmsArcsec === null ? t('images.off') : `${n(s.rmsArcsec)}″`,
            cloud: s.cloudPct === null ? t('images.off') : `${n(s.cloudPct, 0)} %`,
            mode: t(`images.mode.${s.mode}`),
          })}{' '}
          {view.rigId ? (
            <Link to={`/ausruestung/rigs?rig=${view.rigId}&reiter=scheduler`}>
              {t('images.changeLimits')}
            </Link>
          ) : null}
        </span>
      </p>
      {reject.error || keep.error ? (
        <ProblemMessage code={problemCode(reject.error ?? keep.error)} />
      ) : null}
      {view.truncated ? <p className={styles.muted}>{t('images.truncated')}</p> : null}
      <div className={styles.layout}>
        <div className={styles.tableBox}>
          <DataTable
            columns={columns}
            rows={list.slice(0, shown)}
            rowKey={(i) => i.id}
            rowLabel={(i) => formatZonedTime(i.capturedAt, zone)}
            label={t('images.table', { count: list.length })}
            rowProps={(i) => ({ 'data-selected': selected?.id === i.id })}
            empty={t('images.none')}
          />
          {list.length > shown ? (
            <button
              type="button"
              className={styles.button}
              onClick={() => setShown((v) => v + PAGE)}
            >
              {t('images.more', { count: list.length - shown })}
            </button>
          ) : null}
        </div>
        {selected ? (
          <aside className={styles.side} aria-label={t('images.detail')}>
            <div className={styles.sideHead}>
              <h3>
                {t('images.title', {
                  filter: selected.filter,
                  exposure: n(selected.exposureS, 1),
                  time: `${formatNightKey(selected.night)} ${formatZonedTime(selected.capturedAt, zone)}`,
                })}
              </h3>
              <div className={styles.nav}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('images.previous')}
                  disabled={index <= 0}
                  onClick={() => move(-1)}
                >
                  ‹
                </button>
                <span>{t('images.position', { n: index + 1, of: list.length })}</span>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('images.next')}
                  disabled={index >= list.length - 1}
                  onClick={() => move(1)}
                >
                  ›
                </button>
              </div>
            </div>
            <div className={styles.verdict} data-grade={selected.grade}>
              <strong>{t(`images.verdict.${selected.grade}`)}</strong>
              {selected.flags.map((f) => (
                <span key={f.metric}>
                  {t(`images.flag.${f.metric}`, {
                    value: valueText(selected, f),
                    limit: limitText(selected, f),
                  })}
                </span>
              ))}
            </div>
            <dl className={styles.values}>
              <dt>{t('images.focus')}</dt>
              <dd>
                {t('images.focusValue', {
                  position: n(selected.focusPosition, 0),
                  temp: n(selected.focuserTemperatureC, 1),
                })}
              </dd>
              <dt>{t('images.guiding')}</dt>
              <dd>
                {t('images.guidingValue', {
                  total: n(selected.rmsArcsec),
                  ra: n(selected.rmsRaArcsec),
                  dec: n(selected.rmsDecArcsec),
                })}
              </dd>
              <dt>{t('images.sky')}</dt>
              <dd>
                {t('images.skyValue', {
                  alt: n(selected.altitudeDeg, 0),
                  airmass: n(selected.airmass),
                  cloud: n(selected.cloudCoverPct, 0),
                  sqm: n(selected.skyQualityMag),
                })}
              </dd>
              <dt>{t('images.image')}</dt>
              <dd>
                {t('images.imageValue', {
                  stars: n(selected.stars, 0),
                  hfr: hfrText(selected),
                  adu: n(selected.medianAdu, 0),
                  saturated: n(selected.saturatedPct),
                })}
              </dd>
              <dt>{t('images.camera')}</dt>
              <dd>
                {t('images.cameraValue', {
                  temp: n(selected.sensorTempC, 1),
                  setPoint: n(selected.setPointC, 1),
                  gain: selected.gain ?? '–',
                  offset: selected.offset ?? '–',
                  binning: selected.binning ?? 1,
                })}
              </dd>
            </dl>
            <div className={styles.file}>
              <span className={styles.label}>{t('images.file')}</span>
              <code>{selected.relativePath ?? selected.fileName ?? '–'}</code>
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    selected.relativePath ?? selected.fileName ?? '',
                  )
                }
              >
                {t('images.copy')}
              </button>
            </div>
            {nightPoints.length > 1 ? (
              <div className={styles.spark} aria-hidden="true">
                <span className={styles.label}>{t('images.nightCurve')}</span>
                <div className={styles.sparkPlot}>
                  {nightPoints.map((p) => (
                    <span
                      key={p.id}
                      data-current={p.id === selected.id}
                      style={{
                        left: `${String(((Date.parse(p.capturedAt) - t0) / (t1 - t0)) * 96 + 2)}%`,
                        bottom: `${String(hi > lo ? (((p.hfrArcsec ?? p.hfr ?? lo) - lo) / (hi - lo)) * 80 + 6 : 40)}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {view.canCorrect ? (
              <div className={styles.sideActions}>
                {selected.rejected ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={reject.isPending}
                    onClick={() => reject.mutate({ ids: [selected.id], rejected: false })}
                  >
                    {t('images.unreject')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={reject.isPending}
                    onClick={() => reject.mutate({ ids: [selected.id], rejected: true })}
                  >
                    {t('images.reject')}
                  </button>
                )}
                {selected.grade === 'flagged' || selected.grade === 'kept' ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={keep.isPending}
                    onClick={() =>
                      keep.mutate({ id: selected.id, kept: selected.grade !== 'kept' })
                    }
                  >
                    {selected.grade === 'kept' ? t('images.unkeep') : t('images.keep')}
                  </button>
                ) : null}
                <Link
                  className={styles.sideLink}
                  to={`/auswertung/sitzungen/${selected.sessionId}`}
                >
                  {t('images.openNight')}
                </Link>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        title={t('images.confirmTitle', { count: flaggedIds.length })}
        consequence={t('images.confirmConsequence')}
        confirmLabel={t('images.reject')}
        variant="danger"
        state={reject.isPending ? 'loading' : 'ready'}
        onConfirm={() =>
          reject
            .mutateAsync({ ids: flaggedIds.slice(0, 500), rejected: true })
            .then(() => setConfirm(false))
            .catch(() => setConfirm(false))
        }
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
