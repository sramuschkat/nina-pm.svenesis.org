/**
 * S-63 Projektbericht (FK 14.3; FA-AUS-18, FA-AUS-10, FA-AUS-11, FA-AUS-13; AP-34): Zeitraum (vordefiniert
 * oder von/bis als Nacht-Schlüssel), Filter nach Status, Rig und Objekttyp; aufklappbare Abschnitte –
 * Übersicht und je Projekt Frames/Integration je Filter, Verlauf je Nacht (Balken je Nacht, kumulierte
 * Integration), Sessions mit Verworfen-Quote und Wetterbewertung, Bedingungen, Kanalbalance-Hinweis.
 * *CSV exportieren* und *Drucken* (Druckansicht des Browsers, alle Abschnitte aufgeklappt; kein PDF-Server).
 */
import { formatNightKey, projectStatuses } from '@nina-pm/shared';
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { reportsApi, type ProjectReport, type ReportProject } from '../../api/client';
import { useAuth } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { FilterChip } from '../../components/FilterChip';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { nightKeyIn } from '../projects/queue-model';
import styles from './sessions.module.css';
import { EvaluationTabs, SESSIONS_PATH } from './SessionsPage';
import { Person, useMemberNames } from '../../lib/member';

export const PROJECT_REPORT_PATH = '/auswertung/projektbericht';

const PERIODS = ['30', '90', '365', 'all', 'custom'] as const;
type Period = (typeof PERIODS)[number];

const hours = (s: number) => s / 3600;

export function ProjectReportPage() {
  const { t } = useTranslation();
  const nameOf = useMemberNames();
  const { me } = useAuth();
  const zone = me?.tenant?.timeZone ?? 'UTC';
  const today = nightKeyIn(Date.now(), zone);
  const rigs = useEquipmentList('rigs');
  const ids = {
    period: useId(),
    from: useId(),
    to: useId(),
    status: useId(),
    rig: useId(),
    type: useId(),
  };
  const [period, setPeriod] = useState<Period>('90');
  const [custom, setCustom] = useState({ from: keyFromDays(daysFromKey(today) - 30), to: today });
  const [status, setStatus] = useState('');
  const [rigId, setRigId] = useState('');
  const [type, setType] = useState('');
  const range =
    period === 'all'
      ? {}
      : period === 'custom'
        ? { from: custom.from, to: custom.to }
        : { from: keyFromDays(daysFromKey(today) - Number(period)), to: today };
  const query = { ...range, status, rigId, type };
  const report = useQuery({
    queryKey: ['project-report', query],
    queryFn: () => reportsApi.projects(query),
  });
  const print = () => {
    for (const d of document.querySelectorAll('details')) d.open = true;
    window.print();
  };
  return (
    <div className={styles.page}>
      <PageHeader
        title={t('report.title')}
        nav={<EvaluationTabs />}
        actions={
          <span className={`${styles.flags} ${styles.noPrint}`}>
            <button
              type="button"
              className={styles.button}
              disabled={!report.data}
              onClick={() => report.data && downloadReportCsv(report.data, nameOf)}
            >
              {t('report.csv')}
            </button>
            <button type="button" className={styles.button} onClick={print}>
              {t('report.print')}
            </button>
          </span>
        }
      />
      <section className={styles.listCard} aria-label={t('report.title')}>
        <div className={`${styles.toolbar} ${styles.listBar} ${styles.noPrint}`}>
          <div className={styles.field}>
            <label htmlFor={ids.period}>{t('report.period')}</label>
            <select
              id={ids.period}
              className={styles.input}
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`report.periods.${p}`)}
                </option>
              ))}
            </select>
          </div>
          {period === 'custom' ? (
            <>
              <div className={styles.field}>
                <label htmlFor={ids.from}>{t('report.from')}</label>
                <input
                  id={ids.from}
                  type="date"
                  className={styles.input}
                  value={custom.from}
                  onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor={ids.to}>{t('report.to')}</label>
                <input
                  id={ids.to}
                  type="date"
                  className={styles.input}
                  value={custom.to}
                  onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                />
              </div>
            </>
          ) : null}
          <div className={styles.field}>
            <label htmlFor={ids.status}>{t('report.status')}</label>
            <select
              id={ids.status}
              className={styles.input}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
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
            <label htmlFor={ids.rig}>{t('report.rig')}</label>
            <select
              id={ids.rig}
              className={styles.input}
              value={rigId}
              onChange={(e) => setRigId(e.target.value)}
            >
              <option value="">{t('report.all')}</option>
              {(rigs.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor={ids.type}>{t('report.type')}</label>
            <select
              id={ids.type}
              className={styles.input}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">{t('report.all')}</option>
              <option value="deep_sky">{t('report.types.deep_sky')}</option>
              <option value="exoplanet">{t('report.types.exoplanet')}</option>
            </select>
          </div>
        </div>
        {report.isError ? (
          <ProblemMessage code={problemCode(report.error)} onRetry={() => void report.refetch()} />
        ) : !report.data ? (
          <p className={styles.listNote} role="status">
            {t('common.loading')}
          </p>
        ) : (
          <ReportBody report={report.data} />
        )}
      </section>
    </div>
  );
}

function ReportBody({ report }: { report: ProjectReport }) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const columns: DataColumn<ReportProject>[] = [
    {
      id: 'name',
      header: t('report.col.project'),
      sortValue: (p) => p.name,
      cell: (p) => <Link to={`/projekte/${p.projectId}`}>{p.name}</Link>,
    },
    {
      // Ersteller mit Bild neben dem Projekt (Wunsch Sven 01.10.2026).
      id: 'creator',
      header: t('sessions.col.creator'),
      priority: 3,
      cell: (p) => <Person id={p.createdBy} />,
    },
    {
      id: 'rig',
      header: t('report.col.rig'),
      sortValue: (p) => p.rigName,
      priority: 3,
      cell: (p) => p.rigName ?? '–',
    },
    {
      id: 'status',
      header: t('report.col.status'),
      sortValue: (p) => p.status,
      priority: 2,
      cell: (p) => (p.status ? t(`status.project.${p.status}`) : '–'),
    },
    {
      id: 'done',
      header: t('report.col.done'),
      sortValue: (p) => p.percentDone,
      align: 'end',
      cell: (p) => `${n(p.percentDone)} %`,
    },
    {
      id: 'frames',
      header: t('report.col.periodFrames'),
      sortValue: (p) => p.periodAccepted,
      align: 'end',
      priority: 2,
      cell: (p) => p.periodAccepted,
    },
    {
      id: 'hours',
      header: t('report.col.periodHours'),
      sortValue: (p) => p.periodIntegrationS,
      align: 'end',
      nowrap: true,
      cell: (p) => t('report.hours', { h: n(hours(p.periodIntegrationS)) }),
    },
  ];
  const range =
    report.from && report.to
      ? t('report.range', { from: formatNightKey(report.from), to: formatNightKey(report.to) })
      : t('report.rangeAll');
  return (
    <div className={styles.forecastBody}>
      <details open className={styles.reportSection}>
        <summary>
          <h2 className={styles.reportHeading}>{t('report.overview')}</h2>
        </summary>
        <p className={styles.muted}>
          {range} ·{' '}
          {t('report.totals', {
            projects: report.totals.projects,
            frames: report.totals.periodAccepted,
            h: n(hours(report.totals.periodIntegrationS)),
          })}
        </p>
        <DataTable
          columns={columns}
          rows={report.projects}
          rowKey={(p) => p.projectId}
          rowLabel={(p) => p.name}
          label={t('report.overview')}
          empty={t('report.empty')}
        />
      </details>
      {report.projects.map((p) => (
        <ProjectSection key={p.projectId} project={p} />
      ))}
    </div>
  );
}

function ProjectSection({ project: p }: { project: ReportProject }) {
  const { t, i18n } = useTranslation();
  const filters = useEquipmentList('filters');
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const c = p.conditions;
  return (
    <details className={styles.reportSection}>
      <summary>
        <h2 className={styles.reportHeading}>
          {p.name}{' '}
          <span className={styles.reportCreator}>
            <Person id={p.createdBy} />
          </span>
          <span className={styles.muted}>
            {' '}
            · {p.rigName ?? '–'} · {n(p.percentDone)} % ·{' '}
            {t('report.hours', { h: n(hours(p.periodIntegrationS)) })}
          </span>
        </h2>
      </summary>
      {p.channelBalance ? (
        <p className={styles.note} role="note">
          {t('report.balance', {
            ahead: p.channelBalance.ahead
              .map((f) => `${f.filter} ${n(f.percentDone, 0)} %`)
              .join(', '),
            behind: p.channelBalance.behind
              .map((f) => `${f.filter} ${n(f.percentDone, 0)} %`)
              .join(', '),
            filters: p.channelBalance.behind.map((f) => f.filter).join(', '),
          })}
        </p>
      ) : null}
      <h3 className={styles.subTitle}>{t('report.filters')}</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>{t('report.filtersOf', { name: p.name })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('report.col.filter')}</th>
              <th scope="col" className={styles.num}>
                {t('report.col.planned')}
              </th>
              <th scope="col" className={styles.num}>
                {t('report.col.accepted')}
              </th>
              <th scope="col" className={styles.num}>
                {t('report.col.remaining')}
              </th>
              <th scope="col" className={styles.num}>
                {t('report.col.integration')}
              </th>
              <th scope="col" className={styles.num}>
                {t('report.col.done')}
              </th>
            </tr>
          </thead>
          <tbody>
            {p.filters.map((f) => (
              <tr key={f.filter}>
                <th scope="row">
                  <FilterChip shortName={f.filter} color={colorOf(f.filter)} size="sm" />
                </th>
                <td className={styles.num}>{f.planned}</td>
                <td className={styles.num}>{f.accepted}</td>
                <td className={styles.num}>{f.remaining}</td>
                <td className={styles.num}>{t('report.hours', { h: n(hours(f.integrationS)) })}</td>
                <td className={styles.num}>{n(f.percentDone)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className={styles.subTitle}>{t('report.progress')}</h3>
      {p.nights.length === 0 ? (
        <p className={styles.muted}>{t('report.noNights')}</p>
      ) : (
        <ProgressChart project={p} colorOf={colorOf} />
      )}
      <h3 className={styles.subTitle}>{t('report.sessions')}</h3>
      {p.sessions.length === 0 ? (
        <p className={styles.muted}>{t('report.noSessions')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>{t('report.sessionsOf', { name: p.name })}</caption>
            <thead>
              <tr>
                <th scope="col">{t('report.col.night')}</th>
                <th scope="col">{t('report.col.rig')}</th>
                <th scope="col">{t('report.col.frames')}</th>
                <th scope="col" className={styles.num}>
                  {t('report.col.rejected')}
                </th>
                <th scope="col">{t('report.col.weather')}</th>
              </tr>
            </thead>
            <tbody>
              {p.sessions.map((s) => (
                <tr key={s.sessionId}>
                  <th scope="row">
                    <Link to={`${SESSIONS_PATH}/${s.sessionId}`}>{formatNightKey(s.night)}</Link>
                  </th>
                  <td>{s.rigName}</td>
                  <td>
                    <span className={styles.flags}>
                      {s.filters.map((f) => (
                        <span key={f.filter}>
                          <FilterChip shortName={f.filter} color={colorOf(f.filter)} size="sm" />{' '}
                          {f.frames}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={styles.num}>
                    {s.rejectedPct === null ? '–' : `${n(s.rejectedPct)} %`}
                  </td>
                  <td>
                    {s.weatherRatingIndex === null
                      ? '–'
                      : t(`weather.rating.${String(s.weatherRatingIndex)}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className={styles.subTitle}>{t('report.conditions')}</h3>
      <dl className={styles.reportFacts}>
        <dt>{t('projectEditor.cond.minAltitude')}</dt>
        <dd>{n(c.minAltitudeDeg)}°</dd>
        <dt>{t('projectEditor.cond.minTime')}</dt>
        <dd>{t('report.hours', { h: n(c.minTimeOnTargetH) })}</dd>
        <dt>{t('projectEditor.cond.twilight')}</dt>
        <dd>{t(`nightChart.twilight.${c.twilight}`)}</dd>
        <dt>{t('projectEditor.cond.moonEnabled')}</dt>
        <dd>
          {c.moonAvoidanceEnabled
            ? t('report.moonOn', { deg: n(c.moonSeparationDeg, 0) })
            : t('report.moonOff')}
        </dd>
      </dl>
    </details>
  );
}

/**
 * Verlauf (FA-AUS-10): Balken je Nacht (akzeptierte Integration je Filter gestapelt) und die kumulierte
 * Integration aller Filter als Linie.
 */
function ProgressChart({
  project: p,
  colorOf,
}: {
  project: ReportProject;
  colorOf: (short: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const nights = p.nights;
  // Feste Zeichenbreite, gestreckt auf die Spaltenbreite; Balken höchstens SLOT breit, damit wenige
  // Nächte nicht die ganze Fläche füllen. Achsenbeschriftung als HTML (keine verzerrte Schrift).
  const W = 800;
  const H = 160;
  const pad = { l: 4, r: 4, t: 8, b: 4 };
  const SLOT = 32;
  const maxNight = Math.max(
    0.01,
    ...nights.map((x) => hours(x.filters.reduce((s, f) => s + f.integrationS, 0))),
  );
  const cum = nights.map((x) => hours(x.filters.reduce((s, f) => s + f.cumulativeS, 0)));
  const maxCum = Math.max(0.01, ...cum);
  const bw = Math.min(SLOT, (W - pad.l - pad.r) / Math.max(1, nights.length));
  const y = (h: number, max: number) => pad.t + (H - pad.t - pad.b) * (1 - h / max);
  const summary = t('report.chartSummary', {
    nights: nights.length,
    h: n(cum.at(-1) ?? 0),
  });
  const first = nights[0]?.night;
  const last = nights.at(-1)?.night;
  return (
    <figure className={styles.reportChart}>
      <div className={styles.reportPlot}>
        <span className={styles.reportAxis} aria-hidden="true">
          {n(maxNight)} h
        </span>
        <svg
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          role="img"
          aria-label={summary}
          preserveAspectRatio="none"
        >
          {nights.map((x, i) => {
            let top = H - pad.b;
            return (
              <g key={x.night}>
                {x.filters.map((f) => {
                  const h = ((H - pad.t - pad.b) * hours(f.integrationS)) / maxNight;
                  top -= h;
                  return (
                    <rect
                      key={f.filter}
                      x={pad.l + i * bw + 1}
                      y={top}
                      width={Math.max(1, bw - 2)}
                      height={Math.max(0, h)}
                      fill={colorOf(f.filter)}
                    >
                      <title>{`${formatNightKey(x.night)} · ${f.filter} ${n(hours(f.integrationS))} h`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
          {cum.length > 1 && (
            <polyline
              className={styles.reportCum}
              fill="none"
              points={cum
                .map((h, i) => `${String(pad.l + i * bw + bw / 2)},${String(y(h, maxCum))}`)
                .join(' ')}
            />
          )}
        </svg>
      </div>
      {first && last && (
        <div className={styles.reportAxisX} aria-hidden="true">
          <span>{formatNightKey(first)}</span>
          {last !== first && <span>{formatNightKey(last)}</span>}
        </div>
      )}
      <figcaption className={styles.muted}>{summary}</figcaption>
    </figure>
  );
}

/** CSV des Berichts: Summen je Projekt und Filter sowie Verlauf je Nacht. */
function downloadReportCsv(report: ProjectReport, nameOf: (id: string) => string) {
  const cell = (v: string | number | null) => {
    const text = v === null ? '' : String(v);
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = [
    'section',
    'project',
    'projectCreator',
    'rig',
    'status',
    'filter',
    'night',
    'planned',
    'accepted',
    'remaining',
    'acquired',
    'rejected',
    'integrationH',
    'cumulativeH',
  ];
  const rows: (string | number | null)[][] = [];
  const h = (s: number) => Math.round((s / 3600) * 100) / 100;
  for (const p of report.projects) {
    for (const f of p.filters)
      rows.push([
        'total',
        p.name,
        nameOf(p.createdBy),
        p.rigName,
        p.status,
        f.filter,
        null,
        f.planned,
        f.accepted,
        f.remaining,
        null,
        null,
        h(f.integrationS),
        null,
      ]);
    for (const x of p.nights)
      for (const f of x.filters)
        rows.push([
          'night',
          p.name,
          nameOf(p.createdBy),
          p.rigName,
          p.status,
          f.filter,
          x.night,
          null,
          f.accepted,
          null,
          f.acquired,
          f.rejected,
          h(f.integrationS),
          h(f.cumulativeS),
        ]);
  }
  const text = `\uFEFF${[head.join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `projektbericht-${report.from ?? 'alle'}${report.to ? `-${report.to}` : ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
