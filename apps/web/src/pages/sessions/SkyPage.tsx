/**
 * Auswertung – Reiter „Himmel“ (S-65, AP-69; FA-AUS-26 … FA-AUS-29; Ort nach Svens Entscheidung vom 10.10.2026 in der
 * Auswertung statt auf der Projektliste): oben die Ganzhimmelkarte (`AllSkyMap`) mit allen Projekten des Filters als
 * Bildfeld in echter Größe, gefüllt nach den Stunden im Zeitraum bzw. nach Filtermix, ohne Aufnahmen im Zeitraum nur
 * als Umriss; darunter die Zeitachse je Rig (`NightStack`) mit Stunden je Nacht gestapelt nach Projekt und Mondspur.
 * Karte und Zeitachse heben dasselbe Projekt hervor; Klick auf ein Feld öffnet das Projekt (S-31), auf eine Nacht die
 * Nacht (S-61). Filter: Rig und Zeitraum der Auswertung, dazu Status (wie „Projekte“) und Färbung in der Adresse.
 */
import { projectStatuses } from '@nina-pm/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { reportsApi, type SkyProject } from '../../api/client';
import { AllSkyMap, SKY_LAYERS, type SkyLayer } from '../../components/all-sky/AllSkyMap';
import { NightStack } from '../../components/all-sky/NightStack';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../admin/shared';
import { useNumber } from '../equipment/shared';
import { EvaluationHeader, useEvaluationFilter } from './EvaluationHeader';
import { nightPath } from './evaluation';
import {
  FILTER_MIXES,
  filterMix,
  HOURS_BINS,
  hoursStep,
  moonMarks,
  nightKeys,
  projectOrder,
  stackRows,
  type ColorMode,
} from './sky-model';
import styles from './evaluation.module.css';
import sky from './sky.module.css';

const LAYERS_KEY = 'npm.sky.layers';
const SERIES = 6;

function readLayers(): Set<SkyLayer> {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    if (raw) {
      const list = (JSON.parse(raw) as unknown[]).filter((x): x is SkyLayer =>
        (SKY_LAYERS as readonly unknown[]).includes(x),
      );
      return new Set(list);
    }
  } catch {
    // Ohne Speicher: alle Ebenen an.
  }
  return new Set(SKY_LAYERS);
}

/** Aufgelöste Farben (Canvas kennt keine CSS-Variablen); die Himmelsfarben sind themen-unabhängig. */
function cssColor(name: string): string {
  if (typeof document === 'undefined') return '#888';
  return (
    getComputedStyle(document.documentElement).getPropertyValue(`--npm-${name}`).trim() || '#888'
  );
}

export function SkyPage() {
  const { t, i18n } = useTranslation();
  const fmt = useNumber();
  const navigate = useNavigate();
  const { filter, range, ready, search } = useEvaluationFilter();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const mode: ColorMode = params.get('farbe') === 'filter' ? 'mix' : 'hours';
  const ids = { status: useId(), layers: useId() };
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const [layers, setLayers] = useState<Set<SkyLayer>>(readLayers);
  const toggleLayer = (l: SkyLayer) => {
    const next = new Set(layers);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    setLayers(next);
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify([...next]));
    } catch {
      // Nur Bequemlichkeit.
    }
  };
  const [highlight, setHighlight] = useState<string | null>(null);

  const query = { from: range.from, to: range.to, status, rigId: filter.rigId };
  const report = useQuery({
    queryKey: ['sky-report', query],
    queryFn: () => reportsApi.sky(query),
    enabled: ready && range.from !== '' && range.to !== '',
  });
  const data = report.data;
  const projects = useMemo(() => data?.projects ?? [], [data]);
  const order = useMemo(() => projectOrder(projects), [projects]);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const palette = useMemo(
    () => ({
      hours: [1, 2, 3, 4, 5].map((i) => cssColor(`sky-hours-${String(i)}`)),
      mix: Object.fromEntries(FILTER_MIXES.map((m) => [m, cssColor(`sky-mix-${m}`)])),
      series: Array.from({ length: SERIES }, (_, i) => cssColor(`chart-series-${String(i + 1)}`)),
    }),
    [],
  );
  const mapColor = (p: SkyProject): string | null => {
    const hours = p.periodIntegrationS / 3600;
    if (hours <= 0) return null;
    if (mode === 'hours') return palette.hours[hoursStep(hours) - 1] ?? null;
    const m = filterMix(p.byFilter);
    return m ? (palette.mix[m] ?? null) : null;
  };
  const stackColor = (projectId: string): string => {
    const p = byId.get(projectId);
    if (mode === 'mix' && p) {
      const m = filterMix(p.byFilter);
      if (m) return palette.mix[m] ?? '#888';
    }
    return palette.series[(order.get(projectId) ?? 0) % SERIES] ?? '#888';
  };

  const keys = useMemo(() => (data ? nightKeys(data.from, data.to) : []), [data]);
  const rows = useMemo(() => (data ? stackRows(data, order) : []), [data, order]);
  const moon = useMemo(() => new Map((data?.moon ?? []).map((m) => [m.night, m] as const)), [data]);
  const marks = useMemo(() => moonMarks(data?.moon ?? []), [data]);
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'de-DE', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }),
    [i18n.language],
  );
  const formatNight = (night: string) => {
    const [y, m, d] = night.split('-').map(Number) as [number, number, number];
    return dateFmt.format(new Date(Date.UTC(y, m - 1, d)));
  };
  const totalHours = projects.reduce((s, p) => s + p.periodIntegrationS, 0) / 3600;
  const withHours = projects.filter((p) => p.periodIntegrationS > 0).length;

  const tooltip = (p: SkyProject) => (
    <div className={sky.tip}>
      <strong>{p.name}</strong>
      <span>
        {p.status ? t(`status.project.${p.status}`) : ''} · {fmt(p.percentDone, 0)} %
      </span>
      <span>
        {t('evaluation.sky.tipHours', {
          period: fmt(p.periodIntegrationS / 3600, 1),
          total: fmt(p.totalIntegrationS / 3600, 1),
        })}
      </span>
      {p.byFilter.length > 0 ? (
        <span>
          {p.byFilter.map((f) => `${f.filter} ${fmt(f.integrationS / 3600, 1)} h`).join(' · ')}
        </span>
      ) : (
        <span>{t('evaluation.sky.noCaptures')}</span>
      )}
      {p.fov === null ? <span>{t('evaluation.sky.noFov')}</span> : null}
      <em>{t('evaluation.sky.tipOpen')}</em>
    </div>
  );

  const legend =
    mode === 'hours'
      ? [
          ...HOURS_BINS.map((b, i) => ({
            color: palette.hours[i] ?? '#888',
            label:
              i === 0
                ? t('evaluation.sky.legend.under', { hours: b })
                : t('evaluation.sky.legend.range', { from: HOURS_BINS[i - 1], to: b }),
          })),
          {
            color: palette.hours[4] ?? '#888',
            label: t('evaluation.sky.legend.over', { hours: HOURS_BINS[3] }),
          },
        ]
      : FILTER_MIXES.map((m) => ({
          color: palette.mix[m] ?? '#888',
          label: t(`evaluation.sky.mix.${m}`),
        }));

  return (
    <div className={styles.page}>
      <EvaluationHeader
        extra={
          <>
            <div className={styles.field}>
              <label htmlFor={ids.status}>{t('report.status')}</label>
              <select
                id={ids.status}
                className={styles.select}
                value={status}
                onChange={(e) => setParam('status', e.target.value)}
              >
                <option value="">{t('report.all')}</option>
                {projectStatuses.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.project.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <span className={sky.fieldLabel}>{t('evaluation.sky.colorBy')}</span>
              <div
                className={styles.segments}
                role="group"
                aria-label={t('evaluation.sky.colorBy')}
              >
                {(['hours', 'mix'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`${styles.segment} ${sky.segmentButton}`}
                    aria-pressed={mode === m}
                    onClick={() => setParam('farbe', m === 'mix' ? 'filter' : '')}
                  >
                    {t(`evaluation.sky.color.${m}`)}
                  </button>
                ))}
              </div>
            </div>
          </>
        }
      />
      {report.isError ? (
        <ProblemMessage code={problemCode(report.error)} onRetry={() => void report.refetch()} />
      ) : null}
      <section className={styles.chartCard} aria-labelledby="sky-map-title">
        <div className={styles.cardHead}>
          <h2 id="sky-map-title" className={styles.sectionTitle}>
            {t('evaluation.sky.mapTitle')}
          </h2>
          <span className={styles.muted}>
            {data
              ? t('evaluation.sky.summary', {
                  count: projects.length,
                  withHours,
                  hours: fmt(totalHours, 1),
                })
              : t('evaluation.sky.loading')}
          </span>
        </div>
        <AllSkyMap
          items={projects}
          colorOf={mapColor}
          layers={layers}
          highlight={highlight}
          onHover={setHighlight}
          onOpen={(id) => void navigate(`/projekte/${id}`)}
          tooltip={tooltip}
          label={t('evaluation.sky.mapLabel', { count: projects.length })}
        />
        {/* Für Screenreader: die Projekte der Karte als Liste mit Link (der Canvas selbst ist nur ein Bild). */}
        <ul className={styles.srOnly} aria-label={t('evaluation.sky.listLabel')}>
          {projects.map((p) => (
            <li key={p.id}>
              <a href={`/projekte/${p.id}`}>
                {p.name}:{' '}
                {t('evaluation.sky.tipHours', {
                  period: fmt(p.periodIntegrationS / 3600, 1),
                  total: fmt(p.totalIntegrationS / 3600, 1),
                })}
              </a>
            </li>
          ))}
        </ul>
        <div className={sky.below}>
          <ul className={sky.legend} aria-label={t('evaluation.sky.legendLabel')}>
            {legend.map((l) => (
              <li key={l.label}>
                <span className={sky.swatch} style={{ background: l.color }} aria-hidden="true" />
                {l.label}
              </li>
            ))}
            <li>
              <span className={`${sky.swatch} ${sky.outline}`} aria-hidden="true" />
              {t('evaluation.sky.legend.planned')}
            </li>
          </ul>
          <fieldset className={sky.layers}>
            <legend className={styles.srOnly}>{t('evaluation.sky.layersLabel')}</legend>
            {SKY_LAYERS.map((l) => (
              <label key={l} className={sky.check}>
                <input type="checkbox" checked={layers.has(l)} onChange={() => toggleLayer(l)} />
                {t(`evaluation.sky.layer.${l}`)}
              </label>
            ))}
          </fieldset>
        </div>
      </section>
      <section className={styles.chartCard} aria-labelledby="sky-stack-title">
        <div className={styles.cardHead}>
          <h2 id="sky-stack-title" className={styles.sectionTitle}>
            {t('evaluation.sky.stackTitle')}
          </h2>
          <span className={styles.muted}>{t('evaluation.sky.stackHint')}</span>
        </div>
        {data && rows.length === 0 ? (
          <p className={styles.empty}>{t('evaluation.sky.stackEmpty')}</p>
        ) : (
          <NightStack
            rows={rows}
            nights={keys}
            moon={moon}
            marks={marks}
            colorOf={stackColor}
            nameOf={(id) => byId.get(id)?.name ?? ''}
            highlight={highlight}
            onHover={setHighlight}
            onOpenNight={(rigId, night) => void navigate(nightPath(rigId, night, search))}
            formatNight={formatNight}
            formatHours={(h) => fmt(h, 1)}
            label={t('evaluation.sky.stackTitle')}
          />
        )}
      </section>
    </div>
  );
}
