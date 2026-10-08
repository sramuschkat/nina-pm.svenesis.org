/**
 * Bausteine des Projektberichts (FA-AUS-10, FA-AUS-11, FA-AUS-13, FA-AUS-18; AP-34): Projektabschnitt (Reiter
 * *Sessions & Protokoll* im Projekt-Editor), Verlaufsgrafik (Balken je Nacht und Filter, kumulierte Integration) und CSV.
 * Seit AP-64 zeigt die Auswertung den Bericht im Reiter „Projekte“ (`ProjectsPage`).
 */
import { formatNightKey } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectReport, ReportProject } from '../../api/client';
import { ProjectCommentCount } from '../../lib/project-comments';
import { FilterChip } from '../../components/FilterChip';
import { useEquipmentList } from '../equipment/shared';
import styles from './sessions.module.css';
import { sessionPath } from './evaluation';
import { Person } from '../../lib/member';

const hours = (s: number) => s / 3600;

/** Abschnitt eines Projekts (Bericht S-63; aufgeklappt im Reiter *Sessions & Protokoll* des Projekt-Editors). */
export function ProjectSection({
  project: p,
  open = false,
}: {
  project: ReportProject;
  open?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const filters = useEquipmentList('filters');
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const c = p.conditions;
  return (
    <details className={styles.reportSection} open={open}>
      <summary>
        <h2 className={styles.reportHeading}>
          {p.name}{' '}
          <span className={styles.reportCreator}>
            <Person id={p.createdBy} compact />
          </span>{' '}
          <ProjectCommentCount projectId={p.projectId} count={p.commentCount} />
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
                    <Link to={sessionPath(s.sessionId)}>{formatNightKey(s.night)}</Link>
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
export function ProgressChart({
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
export function downloadReportCsv(report: ProjectReport, nameOf: (id: string) => string) {
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
