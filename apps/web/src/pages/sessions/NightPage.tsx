/**
 * S-61 Nacht (AP-64; FA-AUS-01…09, FA-AUS-12, FA-AUS-14, FA-AUS-20, FA-AUS-22; NT-03, NT-E2, NT-E3): eine Nacht eines
 * Rigs **im Bereich** Auswertung (`/auswertung/naechte/{rigId}/{night}`) – Link „← Nächte“ (mit dem Filter des Bereichs)
 * statt Brotkrumen. Mehrere Sessions der Nacht: Auswahl „Ganze Nacht | Session 1 · 20:00–01:10 | …“ (`?session=`);
 * Grafik, Kennzahlen, Aufnahmen und Verlauf gelten für die Auswahl, Soll/Ist und Prüfen bleiben je Session (Entscheidung
 * Sven 07.10.2026). Drei Reiter:
 * 1. **Übersicht**: Prüf-Banner, solange die Nacht ungeprüft ist (Prüfliste aus den Daten: ohne Zuordnung → zuordnen,
 *    Ist < Soll → Grund erfassen, Lücken > 10 min → ansehen; am Ende „Als geprüft markieren“), Kennzahlenleiste, Nachtgrafik
 *    mit Ist (`NightChart` wie Simulator und „Heute Nacht“), Ergebnis je Projekt mit Filter-Chips und „Details“ (Soll/Ist
 *    je Zeile mit Korrektur; Verworfen/Bonus nur bei Werten > 0).
 * 2. **Aufnahmen**: Typ-Chips mit Anzahl, CSV, HFR- und Sterne-Verlauf (FA-AUS-08), Tabelle mit 7 Spalten, Kennzeichen als
 *    Symbol am Ergebnis, Aktionen über „⋯“; die Flats-Übersicht als Kopfzeile beim Chip „Flats“.
 * 3. **Verlauf & Notizen**: Ereignisse als Zeitachse (Standortzeit mit Kürzel) neben dem Sitzungsprotokoll.
 * Soll = erster Plan der Session ohne Bonus, Ist = Aufnahmen dieser Session (Entscheidung Sven 07.10.2026).
 */
import { formatNightKey, formatTzAbbr, formatZonedTime, rejectReasons } from '@nina-pm/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  discordApi,
  sessionsApi,
  type NightSessionCapture,
  type NightSessionDetail,
  type NightSessionLineRow,
} from '../../api/client';
import { useCan } from '../../auth';
import { ActionMenu, type ActionMenuItem } from '../../components/ActionMenu';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { FilterChip } from '../../components/FilterChip';
import { actionIcons, uiIcons } from '../../components/icons';
import { NightChart } from '../../components/night-chart';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SiteTime } from '../../components/SiteTime';
import { StatusBadge } from '../../components/StatusBadge';
import { Tabs } from '../../components/Tabs';
import { Person, useMemberNames } from '../../lib/member';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { EVALUATION_PATHS, filterSearch, nightWeekday, parseFilter } from './evaluation';
import { MetricsChart } from './MetricsChart';
import { useNightActual } from './night-actual';
import {
  captureCounts,
  captureMatches,
  CAPTURE_TYPES,
  gapsWithin,
  median,
  mergeDetails,
  nightFacts,
  projectResults,
  reviewChecklist,
  type CaptureType,
  type NightGap,
  type ProjectResult,
  type ReviewItem,
} from './night-model';
import { SessionLogPanel } from './SessionLogPanel';
import styles from './evaluation.module.css';

type Tab = 'overview' | 'captures' | 'history';
/** Reiter in der Adresse (deutsch): `?ansicht=aufnahmen` usw. */
const TAB_PARAM: Record<Tab, string> = {
  overview: 'uebersicht',
  captures: 'aufnahmen',
  history: 'verlauf',
};
const TABS: readonly Tab[] = ['overview', 'captures', 'history'];

export const hours = (s: number) => (s / 3600).toFixed(1);

export function NightPage() {
  const { t, i18n } = useTranslation();
  const { rigId = '', night = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const back = `${EVALUATION_PATHS.nights}${filterSearch(parseFilter(params))}`;
  const tab =
    (Object.entries(TAB_PARAM).find(([, v]) => v === params.get('ansicht'))?.[0] as
      Tab | undefined) ?? 'overview';
  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(params);
    if (value === null) p.delete(key);
    else p.set(key, value);
    setParams(p, { replace: true });
  };
  const setTab = (next: Tab) => setParam('ansicht', next === 'overview' ? null : TAB_PARAM[next]);
  const client = useQueryClient();
  // Eine Seite je Nacht und Rig (Entscheidung Sven 07.10.2026): alle Sessions der Nacht, je Session das Detail.
  const list = useQuery({
    queryKey: ['sessions', 'night', rigId, night],
    queryFn: () => sessionsApi.list({ rigId, from: night, to: night, limit: 50 }),
  });
  const ids = [...(list.data?.items ?? [])]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((s) => s.id);
  const details = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['sessions', 'detail', id],
      queryFn: () => sessionsApi.get(id),
    })),
  });
  const loaded = details.map((d) => d.data).filter((d): d is NightSessionDetail => d !== undefined);
  const wanted = params.get('session');
  const selected = loaded.find((d) => d.session.id === wanted) ?? null;
  const shown = selected ? [selected] : loaded;
  const merged = shown.length > 0 ? mergeDetails(shown) : undefined;
  const actual = useNightActual(rigId && night ? { rigId, night } : null, merged?.events ?? null);
  const refresh = () => client.invalidateQueries({ queryKey: ['sessions'] });
  const [captureType, setCaptureType] = useState<CaptureType>('all');
  const [cursor, setCursor] = useState<number | null>(null);
  const chartRef = useRef<HTMLElement>(null);

  const failed = list.error ?? details.find((d) => d.isError)?.error;
  if (failed)
    return (
      <div className={styles.page}>
        <Link to={back} className={styles.back}>
          {t('evaluation.night.back')}
        </Link>
        <ProblemMessage
          code={problemCode(failed)}
          onRetry={() => {
            void list.refetch();
            for (const d of details) void d.refetch();
          }}
        />
      </div>
    );
  if (!list.data || loaded.length < ids.length || !merged)
    return list.data && ids.length === 0 ? (
      <div className={styles.page}>
        <Link to={back} className={styles.back}>
          {t('evaluation.night.back')}
        </Link>
        <p className={styles.empty}>{t('evaluation.night.noSessions')}</p>
      </div>
    ) : (
      <p role="status">{t('common.loading')}</p>
    );
  const s = merged.session;
  const zone = s.siteTimeZone;
  const time = (at: string) => `${formatZonedTime(at, zone)} ${formatTzAbbr(at, zone)}`;
  const counts = captureCounts(merged.captures);
  const many = loaded.length > 1;
  const sessionLabel = (d: NightSessionDetail) => {
    const i = loaded.indexOf(d);
    const range = `${formatZonedTime(d.session.startedAt, zone)}–${
      d.session.endedAt ? formatZonedTime(d.session.endedAt, zone) : t('sessions.running')
    }`;
    return many
      ? t('evaluation.night.sessionN', { n: i + 1, range })
      : t('evaluation.night.sessionOne', { range });
  };
  const showGap = (fromUtc: number) => {
    setTab('overview');
    setCursor(fromUtc);
    chartRef.current?.scrollIntoView({ block: 'center' });
    chartRef.current?.focus();
  };
  return (
    <div className={styles.page}>
      <Link to={back} className={styles.back}>
        {t('evaluation.night.back')}
      </Link>
      <PageHeader
        title={t('evaluation.night.title', {
          night: `${nightWeekday(night, i18n.language)} ${formatNightKey(night)}`,
          rig: s.rigName,
        })}
        meta={
          <>
            <span>
              {time(s.startedAt)} – {s.endedAt ? time(s.endedAt) : t('sessions.running')}
            </span>
            {many ? <span>{t('evaluation.nights.sessions', { count: loaded.length })}</span> : null}
            <span className={s.reviewed ? styles.badgeOk : styles.badgeWarn}>
              {s.reviewed ? t('sessions.reviewedYes') : t('sessions.reviewedNo')}
            </span>
          </>
        }
      />
      {many ? (
        // Auswahl der Session (Standard: ganze Nacht für Grafik, Kennzahlen, Aufnahmen und Verlauf).
        <div className={styles.typeChips} role="group" aria-label={t('evaluation.night.choose')}>
          <button
            type="button"
            className={styles.typeChip}
            aria-pressed={selected === null}
            onClick={() => setParam('session', null)}
          >
            {t('evaluation.night.whole')}
          </button>
          {loaded.map((d) => (
            <button
              key={d.session.id}
              type="button"
              className={styles.typeChip}
              aria-pressed={selected === d}
              onClick={() => setParam('session', d.session.id)}
            >
              {sessionLabel(d)}
            </button>
          ))}
        </div>
      ) : null}
      <Tabs
        label={t('evaluation.night.tabs')}
        tabs={TABS.map((k) => ({
          key: k,
          label: t(`evaluation.night.tab.${k}`),
          ...(k === 'captures'
            ? { badge: <span className={styles.tabCount}>{counts.all}</span> }
            : {}),
        }))}
        value={tab}
        onChange={setTab}
        panelClassName={styles.tabPanel}
        panels={{
          overview: (
            <>
              <FactsBar
                detail={merged}
                gaps={
                  actual.gaps && selected ? gapsWithin(actual.gaps, selected.session) : actual.gaps
                }
              />
              <section
                ref={chartRef}
                tabIndex={-1}
                className={styles.chartCard}
                aria-label={t('evaluation.night.chart')}
              >
                <div className={styles.cardHead}>
                  <h2 className={styles.sectionTitle}>{t('evaluation.night.chart')}</h2>
                  <span className={styles.muted}>
                    {t('evaluation.night.chartHint', { zone: formatTzAbbr(s.startedAt, zone) })}
                  </span>
                </div>
                {actual.chart ? (
                  <NightChart
                    {...actual.chart}
                    variant="plan"
                    cursorUtc={cursor}
                    onCursorChange={setCursor}
                    height={260}
                    state="ready"
                  />
                ) : actual.isError ? (
                  <p className={styles.muted}>{t('evaluation.night.chartError')}</p>
                ) : (
                  <p className={styles.muted} role="status">
                    {t('evaluation.night.chartPending')}
                  </p>
                )}
              </section>
              {/* Soll/Ist und Prüfen je Session (sessionbezogen). */}
              {shown.map((d) => (
                <SessionBlock
                  key={d.session.id}
                  detail={d}
                  label={sessionLabel(d)}
                  gaps={gapsWithin(actual.gaps ?? [], d.session)}
                  onRefresh={refresh}
                  onAssign={() => {
                    setCaptureType('unassigned');
                    setTab('captures');
                  }}
                  onGap={showGap}
                />
              ))}
            </>
          ),
          captures: (
            <Captures
              detail={merged}
              type={captureType}
              onType={setCaptureType}
              gaps={actual.gaps ?? []}
              onChanged={refresh}
            />
          ),
          history: (
            <div className={styles.historyGrid}>
              <EventTimeline detail={merged} />
              <div className={styles.logs}>
                {shown.map((d) => (
                  <section
                    key={d.session.id}
                    className={styles.subCard}
                    aria-label={
                      many
                        ? `${t('sessions.log.title')} – ${sessionLabel(d)}`
                        : t('sessions.log.title')
                    }
                  >
                    {many ? <p className={styles.muted}>{sessionLabel(d)}</p> : null}
                    <SessionLogPanel sessionId={d.session.id} siteTimeZone={zone} />
                  </section>
                ))}
              </div>
            </div>
          ),
        }}
      />
    </div>
  );
}

/**
 * Eine Session der Nacht in der Übersicht: Kopfzeile (Zeitraum, NINA-Instanz, geprüft, ⋯ mit Prüfung zurücknehmen bzw.
 * Nachtbericht erneut senden), Prüf-Banner, solange sie ungeprüft ist, und Ergebnis je Projekt (Soll/Ist je Session).
 */
function SessionBlock({
  detail: d,
  label,
  gaps,
  onRefresh,
  onAssign,
  onGap,
}: {
  detail: NightSessionDetail;
  label: string;
  gaps: readonly NightGap[];
  onRefresh: () => Promise<unknown>;
  onAssign: () => void;
  onGap: (fromUtc: number) => void;
}) {
  const { t } = useTranslation();
  const s = d.session;
  const canReview = useCan('session.review');
  const canResend = useCan('session.report.resend');
  const resend = useMutation({ mutationFn: () => discordApi.resendReport(s.id) });
  const review = useMutation({
    mutationFn: (reviewed: boolean) => sessionsApi.review(s.id, reviewed),
    onSettled: onRefresh,
  });
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [correctLine, setCorrectLine] = useState<string | null>(null);
  const items = reviewChecklist(d, gaps);
  const banner = !s.reviewed && items.length > 0;
  const menu: ActionMenuItem[] = [
    ...(canReview && !s.reviewed && !banner
      ? [
          {
            key: 'review',
            label: t('sessions.detail.markReviewed'),
            onSelect: () => review.mutate(true),
          },
        ]
      : []),
    ...(canReview && s.reviewed
      ? [
          {
            key: 'unreview',
            label: t('sessions.detail.unmarkReviewed'),
            onSelect: () => review.mutate(false),
          },
        ]
      : []),
    ...(canResend && s.status !== 'running'
      ? [
          {
            key: 'resend',
            label: t('sessions.detail.resendReport'),
            onSelect: () => resend.mutate(),
          },
        ]
      : []),
  ];
  const openCorrection = (lineId: string) => {
    const row = d.rows.find((r) => r.exposureLineId === lineId);
    if (!row) return;
    setOpenProject(row.projectId);
    setCorrectLine(row.canCorrect ? lineId : null);
  };
  return (
    <>
      <div className={styles.sessionHead}>
        <strong>{label}</strong>
        {s.status !== 'completed' ? (
          <StatusBadge kind="session" value={s.status} size="sm" />
        ) : null}
        {s.ninaInstanceName ? (
          <span className={styles.muted}>
            {t('sessions.detail.instance', { name: s.ninaInstanceName })}
          </span>
        ) : null}
        {s.createdOffline ? <span className={styles.badge}>{t('sessions.offline')}</span> : null}
        <span className={s.reviewed ? styles.badgeOk : styles.badgeWarn}>
          {s.reviewed ? t('sessions.reviewedYes') : t('sessions.reviewedNo')}
        </span>
        {menu.length > 0 ? (
          <span className={styles.sessionMenu}>
            <ActionMenu
              label={t('evaluation.night.moreSession', { session: label })}
              items={menu}
            />
          </span>
        ) : null}
      </div>
      {review.error ? <ProblemMessage code={problemCode(review.error)} /> : null}
      {resend.error ? <ProblemMessage code={problemCode(resend.error)} /> : null}
      {resend.data ? (
        <p role="status" className={resend.data.channels > 0 ? styles.badgeOk : styles.badgeWarn}>
          {resend.data.channels > 0
            ? t('sessions.detail.resendQueued', { count: resend.data.channels })
            : t('sessions.detail.resendNoChannel')}
        </p>
      ) : null}
      {banner ? (
        <ReviewBanner
          items={items}
          zone={s.siteTimeZone}
          canReview={canReview}
          pending={review.isPending}
          onReview={() => review.mutate(true)}
          onAssign={onAssign}
          onCorrect={openCorrection}
          onGap={onGap}
        />
      ) : null}
      <ProjectResults
        detail={d}
        open={openProject}
        onOpen={(p) => {
          setOpenProject(p);
          setCorrectLine(null);
        }}
        correctLine={correctLine}
        onCorrect={setCorrectLine}
      />
    </>
  );
}

// ---- Übersicht ----

function ReviewBanner({
  items,
  zone,
  canReview,
  pending,
  onReview,
  onAssign,
  onCorrect,
  onGap,
}: {
  items: readonly ReviewItem[];
  zone: string;
  canReview: boolean;
  pending: boolean;
  onReview: () => void;
  onAssign: () => void;
  onCorrect: (lineId: string) => void;
  onGap: (fromUtc: number) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const open = items.filter((i) => !i.ok).length;
  const Ok = uiIcons.ok;
  const Warn = actionIcons.warning;
  const hm = (sec: number) => {
    const at = new Date(sec * 1000).toISOString();
    return formatZonedTime(at, zone);
  };
  return (
    <section className={styles.banner} aria-labelledby={headingId}>
      <div className={styles.bannerBody}>
        <h2 id={headingId} className={styles.bannerTitle}>
          {open > 0
            ? t('evaluation.review.title', { count: open })
            : t('evaluation.review.titleDone')}
        </h2>
        <ul className={styles.checklist}>
          {items.map((i) => (
            <li
              key={`${i.kind}-${'lineId' in i ? i.lineId : 'fromUtc' in i ? String(i.fromUtc) : ''}`}
            >
              {i.ok ? (
                <Ok size={16} className={styles.okIcon} aria-label={t('evaluation.review.ok')} />
              ) : (
                <Warn
                  size={16}
                  className={styles.warnIcon}
                  aria-label={t('evaluation.review.open')}
                />
              )}
              {i.kind === 'assigned' ? (
                <span>{t('evaluation.review.assigned', { count: i.count })}</span>
              ) : i.kind === 'unassigned' ? (
                <>
                  <span>{t('evaluation.review.unassigned', { count: i.count })}</span>
                  <button type="button" className={styles.linkButton} onClick={onAssign}>
                    {t('evaluation.review.assign')}
                  </button>
                </>
              ) : i.kind === 'short' ? (
                <>
                  <span>
                    {t('evaluation.review.short', {
                      project: i.projectName,
                      filter: i.filter,
                      acquired: i.acquired,
                      planned: i.planned,
                    })}
                  </span>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => onCorrect(i.lineId)}
                  >
                    {t('evaluation.review.reason')}
                  </button>
                </>
              ) : (
                <>
                  <span>
                    {t('evaluation.review.gap', {
                      min: Math.round((i.toUtc - i.fromUtc) / 60),
                      kind: t(`simulator.gap.${i.gapKind}`, { count: i.count }),
                      from: hm(i.fromUtc),
                      to: hm(i.toUtc),
                    })}
                  </span>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => onGap(i.fromUtc)}
                  >
                    {t('evaluation.review.show')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
      {canReview ? (
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={pending}
          onClick={onReview}
        >
          {t('sessions.detail.markReviewed')}
        </button>
      ) : null}
    </section>
  );
}

function FactsBar({
  detail,
  gaps,
}: {
  detail: NightSessionDetail;
  gaps: readonly NightGap[] | null;
}) {
  const { t, i18n } = useTranslation();
  const f = nightFacts(detail, gaps);
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const h = (sec: number) => t('sessions.hours', { h: n(sec / 3600) });
  const fact = (label: string, value: string, warn = false) => (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue} data-warn={warn || undefined}>
        {value}
      </span>
    </div>
  );
  return (
    <section className={styles.facts} aria-label={t('evaluation.night.facts')}>
      {fact(t('evaluation.night.dark'), f.darkS === null ? '–' : h(f.darkS))}
      {fact(
        t('evaluation.night.exposed'),
        f.efficiencyPct === null
          ? h(f.exposureS)
          : `${h(f.exposureS)} · ${n(f.efficiencyPct, 0)} %`,
      )}
      {fact(t('evaluation.night.lights'), f.lights.toLocaleString(i18n.language))}
      {fact(t('evaluation.night.flats'), `${String(f.flats)} · ${String(f.darkFlats)}`)}
      {fact(
        t('evaluation.night.idle'),
        f.idleS === null ? '–' : t('evaluation.night.minutes', { m: Math.round(f.idleS / 60) }),
        f.idleS !== null && f.idleS > 600,
      )}
      {fact(t('evaluation.night.flipAf'), `${String(f.flips)} · ${String(f.autofocus)}`)}
    </section>
  );
}

function ProjectResults({
  detail,
  open,
  onOpen,
  correctLine,
  onCorrect,
}: {
  detail: NightSessionDetail;
  open: string | null;
  onOpen: (projectId: string | null) => void;
  correctLine: string | null;
  onCorrect: (lineId: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const filters = useEquipmentList('filters');
  const colorOf = (short: string) =>
    (filters.data ?? []).find((f) => f.shortName === short)?.colorHex ?? '#888888';
  const results = projectResults(detail.rows);
  const zone = detail.session.siteTimeZone;
  const hm = (at: string) => formatZonedTime(at, zone);
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const headingId = useId();
  const Ok = uiIcons.ok;
  const Warn = actionIcons.warning;
  return (
    <section className={styles.subCard} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          {t('evaluation.night.results')}
        </h2>
        <span className={styles.muted}>{t('sessions.plan.definition')}</span>
      </div>
      {results.length === 0 ? (
        <p className={styles.muted}>{t('sessions.plan.empty')}</p>
      ) : (
        <ul className={styles.results}>
          {results.map((p) => {
            const expanded = open === p.projectId;
            const detailsId = `details-${p.projectId}`;
            return (
              <li key={p.projectId} className={styles.result}>
                <div className={styles.resultRow}>
                  <div className={styles.resultName}>
                    <strong>{p.projectName}</strong>
                    <Person id={p.createdBy} compact />
                  </div>
                  <ul
                    className={styles.filterChips}
                    aria-label={t('evaluation.night.filtersOf', { name: p.projectName })}
                  >
                    {p.filters.map((f) => (
                      <li
                        key={f.lineId}
                        className={styles.filterChip}
                        data-ok={f.ok === null ? undefined : String(f.ok)}
                      >
                        <FilterChip shortName={f.filter} color={colorOf(f.filter)} size="sm" />
                        <span>
                          {f.series
                            ? t('evaluation.night.series', {
                                from: hm(f.series.fromUtc),
                                to: hm(f.series.untilUtc),
                                n: f.acquired.toLocaleString(i18n.language),
                              })
                            : f.planned === null
                              ? String(f.acquired)
                              : `${String(f.acquired)}/${String(f.planned)}`}
                        </span>
                        {f.ok === true ? (
                          <Ok
                            size={14}
                            className={styles.okIcon}
                            aria-label={t('evaluation.review.ok')}
                          />
                        ) : f.ok === false ? (
                          <Warn
                            size={14}
                            className={styles.warnIcon}
                            aria-label={t('evaluation.review.open')}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <span className={styles.resultHours}>
                    {t('sessions.hours', { h: n(p.integrationS / 3600) })}
                  </span>
                  <button
                    type="button"
                    className={styles.button}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => onOpen(expanded ? null : p.projectId)}
                  >
                    {expanded ? t('evaluation.night.hideDetails') : t('evaluation.night.details')}
                  </button>
                </div>
                {expanded ? (
                  <div id={detailsId} className={styles.resultDetails}>
                    <ProjectDetails
                      detail={detail}
                      project={p}
                      correctLine={correctLine}
                      onCorrect={onCorrect}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Deviations detail={detail} />
    </section>
  );
}

/** Soll/Ist je Zeile eines Projekts mit Korrektur (bisheriger Reiter Soll/Ist); Verworfen/Bonus nur bei Werten > 0. */
function ProjectDetails({
  detail,
  project,
  correctLine,
  onCorrect,
}: {
  detail: NightSessionDetail;
  project: ProjectResult;
  correctLine: string | null;
  onCorrect: (lineId: string | null) => void;
}) {
  const { t } = useTranslation();
  const hasPlan = detail.session.planRevision !== null;
  const zone = detail.session.siteTimeZone;
  const rows = project.rows;
  const correctable = rows.filter((r) => r.canCorrect);
  const any = (pick: (r: NightSessionLineRow) => number) => rows.some((r) => pick(r) > 0);
  const columns: DataColumn<NightSessionLineRow>[] = [
    {
      id: 'filter',
      header: t('sessions.plan.col.filter'),
      sortValue: (r) => r.filterShortName,
      cell: (r) => r.filterShortName,
    },
    {
      id: 'planned',
      header: t('sessions.plan.col.planned'),
      sortValue: (r) => r.planned,
      align: 'end',
      nowrap: true,
      cell: (r) => <PlannedCell row={r} hasPlan={hasPlan} siteTimeZone={zone} />,
    },
    {
      id: 'acquired',
      header: t('sessions.plan.col.acquired'),
      sortValue: (r) => r.acquired,
      align: 'end',
      cell: (r) => r.acquired,
    },
    ...(any((r) => r.rejected)
      ? [
          {
            id: 'rejected',
            header: t('sessions.plan.col.rejected'),
            sortValue: (r: NightSessionLineRow) => r.rejected,
            priority: 2,
            align: 'end' as const,
            cell: (r: NightSessionLineRow) => r.rejected,
          },
        ]
      : []),
    {
      id: 'accepted',
      header: t('sessions.plan.col.accepted'),
      sortValue: (r) => r.accepted,
      priority: 2,
      align: 'end',
      cell: (r) => r.accepted,
    },
    {
      id: 'integration',
      header: t('sessions.plan.col.integration'),
      sortValue: (r) => r.integrationS,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (r) => t('sessions.hours', { h: hours(r.integrationS) }),
    },
    ...(any((r) => r.bonus)
      ? [
          {
            id: 'bonus',
            header: t('sessions.plan.col.bonus'),
            sortValue: (r: NightSessionLineRow) => r.bonus,
            priority: 3,
            align: 'end' as const,
            cell: (r: NightSessionLineRow) => r.bonus,
          },
        ]
      : []),
    ...(any((r) => r.bonusRejected)
      ? [
          {
            id: 'bonusRejected',
            header: t('sessions.plan.col.bonusRejected'),
            sortValue: (r: NightSessionLineRow) => r.bonusRejected,
            priority: 3,
            align: 'end' as const,
            cell: (r: NightSessionLineRow) => r.bonusRejected,
          },
        ]
      : []),
    {
      id: 'action',
      header: t('sessions.plan.col.action'),
      headerHidden: true,
      cell: (r) =>
        r.canCorrect ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => onCorrect(r.exposureLineId)}
          >
            {t('sessions.plan.correctRow')}
          </button>
        ) : null,
    },
  ];
  return (
    <>
      {correctLine && correctable.some((r) => r.exposureLineId === correctLine) ? (
        <CorrectionForm
          key={correctLine}
          sessionId={detail.session.id}
          rows={correctable}
          initialLine={correctLine}
          onDone={() => onCorrect(null)}
        />
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.exposureLineId}
        rowLabel={(r) => `${r.projectName} · ${r.filterShortName}`}
        label={t('evaluation.night.planOf', { name: project.projectName })}
      />
    </>
  );
}

/** Abweichungsgründe der Nacht und Plan-Treue (FA-AUS-04, FA-AUS-09) – bisher Reiter Kennzahlen. */
function Deviations({ detail }: { detail: NightSessionDetail }) {
  const { t, i18n } = useTranslation();
  const k = detail.kpis;
  const n = (v: number, d = 1) => v.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const dur = (s: number | null) => {
    if (s === null) return '–';
    const total = Math.round(s);
    if (total < 60) return t('sessions.kpis.dur.s', { s: total });
    const m = Math.round(total / 60);
    if (m < 60) return t('sessions.kpis.dur.m', { m });
    return t('sessions.kpis.dur.hm', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
  };
  if (detail.reasons.length === 0 && !k.plan && !k.overhead) return null;
  return (
    <details className={styles.deviations}>
      <summary>{t('evaluation.night.deviations')}</summary>
      <ul className={styles.plainList}>
        {k.plan ? (
          <li>
            {t('evaluation.night.planFidelity', {
              frames: k.plan.framesPct === null ? '–' : `${n(k.plan.framesPct)} %`,
              time: k.plan.timePct === null ? '–' : `${n(k.plan.timePct)} %`,
            })}
          </li>
        ) : null}
        {k.overhead ? (
          <li>
            {t('evaluation.night.overhead', { pct: n(k.overhead.pct) })}{' '}
            {t('sessions.kpis.overheadHint', {
              af: dur(k.overhead.autofocusS),
              flip: dur(k.overhead.flipS),
              other: dur(k.overhead.otherS),
            })}
          </li>
        ) : null}
        {detail.reasons.map((r) => (
          <li key={r.reason}>
            {t(`sessions.kpis.reason.${r.reason}`)}: {r.count}
            {r.durationS !== null ? ` · ${dur(r.durationS)}` : ''}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Soll-Zelle (07.10.2026): Anzahl ohne Bonus; Transit-Serie als Zeitfenster statt Anzahl; Zeilen, die erst eine spätere
 * Planrevision der Session eingeplant hat, mit Hinweis *später eingeplant*.
 */
function PlannedCell({
  row,
  hasPlan,
  siteTimeZone,
}: {
  row: NightSessionLineRow;
  hasPlan: boolean;
  siteTimeZone: string;
}) {
  const { t } = useTranslation();
  if (row.plannedSeries)
    return (
      <span title={t('sessions.plan.seriesHint')}>
        {row.planned ? `${row.planned} + ` : ''}
        {t('sessions.plan.series')}{' '}
        <SiteTime atUtc={row.plannedSeries.fromUtc} siteTimeZone={siteTimeZone} />
        {' – '}
        <SiteTime atUtc={row.plannedSeries.untilUtc} siteTimeZone={siteTimeZone} />
      </span>
    );
  if (row.planned === null) return <>{hasPlan ? '–' : t('sessions.detail.noPlan')}</>;
  if (!row.plannedLater) return <>{row.planned}</>;
  return (
    <>
      <span className={styles.badge} title={t('sessions.plan.plannedLaterHint')}>
        {t('sessions.plan.plannedLater')}
      </span>{' '}
      {row.planned}
    </>
  );
}

function CorrectionForm({
  sessionId,
  rows,
  initialLine,
  onDone,
}: {
  sessionId: string;
  rows: readonly NightSessionLineRow[];
  initialLine: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const ids = {
    title: useId(),
    line: useId(),
    rejected: useId(),
    min: useId(),
    reason: useId(),
    comment: useId(),
  };
  const [lineId, setLineId] = useState(initialLine);
  const row = rows.find((r) => r.exposureLineId === lineId) ?? rows[0];
  // Die Korrektur gilt je Zeile und Nacht (FA-AUS-06): Untergrenze und Startwert aus den Nachtwerten.
  const min = row?.night.rejectedIndividual ?? 0;
  const startValue = (r: NightSessionLineRow | undefined) =>
    Math.max(r?.night.rejectedIndividual ?? 0, r?.night.rejectedCorrection ?? 0);
  const [rejected, setRejected] = useState(startValue(row));
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const save = useMutation({
    mutationFn: () =>
      sessionsApi.correct(sessionId, {
        exposureLineId: lineId,
        rejected,
        reason: reason || null,
        comment: comment.trim() || null,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <form
      className={styles.form}
      aria-labelledby={ids.title}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (rejected >= min) save.mutate();
      }}
    >
      <h3 id={ids.title} className={styles.formTitle}>
        {t('sessions.correction.title')}
      </h3>
      <p className={styles.muted}>{t('sessions.correction.hint')}</p>
      <div className={styles.formRow}>
        {rows.length > 1 ? (
          <div className={styles.field}>
            <label htmlFor={ids.line}>{t('sessions.correction.line')}</label>
            <select
              id={ids.line}
              className={styles.select}
              value={lineId}
              onChange={(e) => {
                // Zeilenwechsel: Zahl der neuen Zeile übernehmen, nicht die der vorigen senden (P1-12).
                const next = e.target.value;
                setLineId(next);
                setRejected(startValue(rows.find((r) => r.exposureLineId === next)));
                save.reset();
              }}
            >
              {rows.map((r) => (
                <option key={r.exposureLineId} value={r.exposureLineId}>
                  {r.filterShortName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className={styles.field}>
          <label htmlFor={ids.rejected}>{t('sessions.correction.rejected')}</label>
          <input
            id={ids.rejected}
            type="number"
            className={styles.select}
            min={min}
            max={row?.night.acquired ?? undefined}
            value={rejected}
            aria-describedby={ids.min}
            onChange={(e) => setRejected(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
          />
          <span id={ids.min} className={styles.muted}>
            {t('sessions.correction.minimum', { min })}
          </span>
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.reason}>{t('sessions.correction.reason')}</label>
          <select
            id={ids.reason}
            className={styles.select}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">{t('sessions.correction.noReason')}</option>
            {rejectReasons.map((r) => (
              <option key={r} value={r}>
                {t(`sessions.correction.reasons.${r}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.comment}>{t('sessions.correction.comment')}</label>
          <input
            id={ids.comment}
            className={styles.select}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </div>
      <div className={styles.formActions}>
        <button
          type="submit"
          className={styles.buttonPrimary}
          disabled={save.isPending || rejected < min}
        >
          {t('sessions.correction.submit')}
        </button>
        <button type="button" className={styles.button} onClick={onDone}>
          {t('sessions.correction.cancel')}
        </button>
      </div>
      {save.isSuccess ? (
        <p className={styles.success} role="status">
          {save.data.projectStatus === 'active'
            ? t('sessions.correction.reactivated')
            : t('sessions.correction.saved')}
        </p>
      ) : null}
      {save.error ? <ProblemMessage code={problemCode(save.error)} /> : null}
    </form>
  );
}

// ---- Aufnahmen ----

/** Ergebnis mit Kennzeichen als Symbol (NT-E2/E3), verworfen mit Grund, Bonus, ohne Zuordnung. */
function ResultCell({ c }: { c: NightSessionCapture }) {
  const { t } = useTranslation();
  const flags = [
    c.temperatureDeviation ? t('sessions.captures.temperatureDeviation') : null,
    c.settingsDeviation ? t('sessions.captures.settingsDeviation') : null,
  ].filter((x): x is string => x !== null);
  const Warn = actionIcons.warning;
  return (
    <span className={styles.resultCell}>
      {c.rejected ? (
        <span className={styles.badgeDanger}>
          {c.rejectReason
            ? t('sessions.captures.rejectedWith', {
                reason: t(`sessions.correction.reasons.${c.rejectReason}`),
              })
            : t('sessions.captures.rejected')}
        </span>
      ) : (
        <span>{t(`sessions.captures.result.${c.result}`)}</span>
      )}
      {c.isBonus ? <span className={styles.badge}>{t('sessions.captures.bonus')}</span> : null}
      {c.assignment === 'unassigned' ? (
        <span className={styles.badgeWarn}>{t('sessions.captures.unassignedFlag')}</span>
      ) : null}
      {flags.length > 0 ? (
        <span
          className={styles.flagIcon}
          title={flags.join(' · ')}
          role="img"
          aria-label={flags.join(' · ')}
        >
          <Warn size={16} aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}

function Captures({
  detail,
  type,
  onType,
  gaps,
  onChanged,
}: {
  detail: NightSessionDetail;
  type: CaptureType;
  onType: (t: CaptureType) => void;
  gaps: readonly NightGap[];
  onChanged: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useMemberNames();
  const canAssign = useCan('session.review');
  const zone = detail.session.siteTimeZone;
  const [rejecting, setRejecting] = useState<NightSessionCapture | null>(null);
  const [assigning, setAssigning] = useState<NightSessionCapture | null>(null);
  const counts = captureCounts(detail.captures);
  const list = detail.captures.filter((c) => captureMatches(c, type));
  const correctable = new Set(detail.rows.filter((r) => r.canCorrect).map((r) => r.projectId));
  const undo = useMutation({
    mutationFn: (id: string) => sessionsApi.reject(id, false, null),
    onSettled: onChanged,
  });
  const menu = (c: NightSessionCapture): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [];
    const rejectable =
      c.frameType === 'light' &&
      c.result === 'saved' &&
      c.assignment === 'assigned' &&
      c.projectId !== null &&
      correctable.has(c.projectId);
    if (rejectable && !c.rejected)
      items.push({
        key: 'reject',
        label: t('sessions.captures.reject'),
        onSelect: () => {
          setAssigning(null);
          setRejecting(c);
        },
      });
    if (rejectable && c.rejected)
      items.push({
        key: 'unreject',
        label: t('sessions.captures.unreject'),
        disabled: undo.isPending,
        onSelect: () => undo.mutate(c.id),
      });
    if (canAssign && c.assignment === 'unassigned' && c.frameType === 'light')
      items.push({
        key: 'assign',
        label: t('sessions.captures.assign'),
        onSelect: () => {
          setRejecting(null);
          setAssigning(c);
        },
      });
    return items;
  };
  const columns: DataColumn<NightSessionCapture>[] = [
    {
      id: 'time',
      header: t('sessions.captures.col.time'),
      sortValue: (c) => c.capturedAt,
      nowrap: true,
      cell: (c) => <SiteTime atUtc={c.capturedAt} siteTimeZone={zone} />,
    },
    {
      id: 'project',
      header: t('sessions.captures.col.project'),
      sortValue: (c) => c.projectName ?? t(`sessions.captures.type.${c.frameType}`),
      cell: (c) =>
        c.projectName ? (
          <span className={styles.projectWithCreator}>
            {c.projectName}
            <Person id={c.projectCreatedBy} compact />
          </span>
        ) : c.frameType !== 'light' ? (
          t(`sessions.captures.type.${c.frameType}`)
        ) : (
          '–'
        ),
    },
    {
      id: 'filter',
      header: t('sessions.captures.col.filter'),
      sortValue: (c) => c.filterShortName,
      cell: (c) => (
        <>
          {c.filterShortName}
          {c.filterActual && c.filterActual !== c.filterShortName ? (
            <span className={styles.muted}> ({c.filterActual})</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'exposure',
      header: t('sessions.captures.col.exposure'),
      sortValue: (c) => c.exposureS,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (c) => t('sessions.captures.seconds', { s: c.exposureS }),
    },
    {
      id: 'hfr',
      header: t('sessions.captures.col.hfr'),
      sortValue: (c) => c.hfr ?? -1,
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (c) =>
        c.hfr === null ? '–' : t('sessions.captures.hfrPx', { hfr: hfrText(c.hfr, i18n.language) }),
    },
    {
      id: 'stars',
      header: t('sessions.captures.col.stars'),
      sortValue: (c) => c.stars ?? -1,
      priority: 3,
      align: 'end',
      cell: (c) => (c.stars === null ? '–' : c.stars.toLocaleString(i18n.language)),
    },
    {
      id: 'result',
      header: t('sessions.captures.col.result'),
      sortValue: (c) => (c.rejected ? 'z' : c.result),
      cell: (c) => <ResultCell c={c} />,
    },
    {
      id: 'action',
      header: t('sessions.captures.col.action'),
      headerHidden: true,
      nowrap: true,
      cell: (c) => (
        <ActionMenu
          size="sm"
          label={t('evaluation.captures.menu', {
            time: formatZonedTime(c.capturedAt, zone),
            filter: c.filterShortName,
          })}
          items={menu(c)}
        />
      ),
    },
  ];
  const lights = detail.captures.filter((c) => c.frameType === 'light' && c.result === 'saved');
  const measured = lights.filter((c) => c.hfr !== null);
  const hfrMedian = median(measured.map((c) => c.hfr as number));
  const starsMedian = median(lights.flatMap((c) => (c.stars === null ? [] : [c.stars])));
  return (
    <>
      <div className={styles.captureBar}>
        <div className={styles.typeChips} role="group" aria-label={t('sessions.captures.filter')}>
          {CAPTURE_TYPES.map((k) => (
            <button
              key={k}
              type="button"
              className={styles.typeChip}
              aria-pressed={type === k}
              onClick={() => onType(k)}
            >
              {t(`evaluation.captures.type.${k}`)}{' '}
              <span className={styles.typeCount}>{counts[k]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.button}
          disabled={list.length === 0}
          onClick={() => downloadCsv(detail, list, zone, nameOf)}
        >
          {t('sessions.captures.csv')}
        </button>
      </div>
      {type === 'flats' ? <FlatsHeader detail={detail} /> : null}
      {lights.length > 0 ? (
        <section className={styles.subCard} aria-label={t('evaluation.captures.metrics')}>
          <div className={styles.cardHead}>
            <h2 className={styles.sectionTitle}>{t('evaluation.captures.metrics')}</h2>
            {hfrMedian === null ? (
              <span className={styles.muted}>{t('sessions.captures.metricsMissing')}</span>
            ) : (
              <span className={styles.muted} data-testid="capture-metrics">
                {t('sessions.captures.metricsSummary', {
                  hfr: hfrText(hfrMedian, i18n.language),
                  stars:
                    starsMedian === null
                      ? '–'
                      : Math.round(starsMedian).toLocaleString(i18n.language),
                  count: measured.length,
                })}
              </span>
            )}
          </div>
          {hfrMedian !== null ? (
            <MetricsChart
              captures={detail.captures}
              events={detail.events}
              gaps={gaps}
              timeZone={zone}
              fromUtc={detail.session.startedAt}
              toUtc={detail.session.endedAt}
            />
          ) : null}
        </section>
      ) : null}
      {rejecting ? (
        <RejectForm
          key={rejecting.id}
          capture={rejecting}
          zone={zone}
          onDone={() => setRejecting(null)}
          onChanged={onChanged}
        />
      ) : null}
      {assigning ? (
        <AssignForm
          key={assigning.id}
          capture={assigning}
          detail={detail}
          onDone={() => setAssigning(null)}
          onChanged={onChanged}
        />
      ) : null}
      {undo.error ? <ProblemMessage code={problemCode(undo.error)} /> : null}
      {detail.capturesTruncated ? (
        <p className={styles.muted}>
          {t('sessions.detail.truncated', { count: detail.captures.length })}
        </p>
      ) : null}
      <DataTable
        columns={columns}
        rows={list}
        rowKey={(c) => c.id}
        rowLabel={(c) => `${c.projectName ?? '–'} · ${c.filterShortName}`}
        label={t('evaluation.night.tab.captures')}
        empty={t('sessions.captures.empty')}
      />
    </>
  );
}

/** Kombinationsübersicht der Flats (bisher Reiter Flats): Flats und Dark-Flats Ist/Soll, Belichtung. */
function FlatsHeader({ detail }: { detail: NightSessionDetail }) {
  const { t, i18n } = useTranslation();
  if (detail.flats.length === 0) return <p className={styles.muted}>{t('sessions.flats.empty')}</p>;
  return (
    <ul className={styles.flatsHead} aria-label={t('evaluation.captures.flatsSummary')}>
      {detail.flats.map((f) => (
        <li
          key={`${f.filterShortName}-${String(f.rotatorMechDeg)}-${String(f.binning)}`}
          className={styles.flatItem}
        >
          <strong>{f.filterShortName}</strong>
          <span>
            {t('evaluation.captures.flatLine', {
              rot: f.rotatorMechDeg.toLocaleString(i18n.language, { maximumFractionDigits: 1 }),
              bin: f.binning,
              flats: `${String(f.flatsTaken)}/${String(f.flatsPlanned)}`,
              darkFlats: `${String(f.darkFlatsTaken)}/${String(f.darkFlatsPlanned)}`,
            })}
          </span>
          {f.flatExposureS !== null ? (
            <span className={styles.muted}>
              {t('sessions.captures.seconds', { s: f.flatExposureS })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Grund wählen und verwerfen (FA-AUS-20); die Zähler folgen der Regel max (FA-AUS-06). */
function RejectForm({
  capture,
  zone,
  onDone,
  onChanged,
}: {
  capture: NightSessionCapture;
  zone: string;
  onDone: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const ids = { title: useId(), reason: useId() };
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => sessionsApi.reject(capture.id, true, reason || null),
    onSuccess: async () => {
      await onChanged();
      onDone();
    },
  });
  return (
    <form
      className={styles.form}
      aria-labelledby={ids.title}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h3 id={ids.title} className={styles.formTitle}>
        {t('sessions.captures.rejectTitle')}
      </h3>
      <p className={styles.muted}>
        <SiteTime atUtc={capture.capturedAt} siteTimeZone={zone} /> · {capture.projectName ?? '–'} ·{' '}
        {capture.filterShortName} · {t('sessions.captures.seconds', { s: capture.exposureS })}
        {capture.isBonus ? ` · ${t('sessions.captures.bonus')}` : ''}
      </p>
      <div className={styles.formRow}>
        <div className={styles.field}>
          <label htmlFor={ids.reason}>{t('sessions.correction.reason')}</label>
          <select
            id={ids.reason}
            className={styles.select}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">{t('sessions.correction.noReason')}</option>
            {rejectReasons.map((r) => (
              <option key={r} value={r}>
                {t(`sessions.correction.reasons.${r}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className={styles.buttonPrimary} disabled={save.isPending}>
          {t('sessions.captures.rejectSubmit')}
        </button>
        <button type="button" className={styles.button} onClick={onDone}>
          {t('sessions.correction.cancel')}
        </button>
      </div>
      {save.error ? <ProblemMessage code={problemCode(save.error)} /> : null}
    </form>
  );
}

/** Nicht zugeordnete Aufnahme einer Zeile zuordnen (FA-AUS-22, Admin); erst dann zählt sie. */
function AssignForm({
  capture,
  detail,
  onDone,
  onChanged,
}: {
  capture: NightSessionCapture;
  detail: NightSessionDetail;
  onDone: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const nameOf = useMemberNames();
  const ids = { title: useId(), line: useId() };
  const zone = detail.session.siteTimeZone;
  const [lineId, setLineId] = useState('');
  const assign = useMutation({
    mutationFn: () => sessionsApi.assign(capture.id, lineId),
    onSuccess: async () => {
      await onChanged();
      onDone();
    },
  });
  return (
    <form
      className={styles.form}
      aria-labelledby={ids.title}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (lineId) assign.mutate();
      }}
    >
      <h3 id={ids.title} className={styles.formTitle}>
        {t('sessions.captures.assignTitle')}
      </h3>
      <p className={styles.muted}>{t('sessions.captures.assignHint')}</p>
      <div className={styles.formRow}>
        <div className={styles.field}>
          <label htmlFor={ids.line}>
            {t('sessions.captures.assignTo', { time: formatZonedTime(capture.capturedAt, zone) })} ·{' '}
            {capture.filterShortName}
          </label>
          <select
            id={ids.line}
            className={styles.select}
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
          >
            <option value="">{t('sessions.captures.chooseLine')}</option>
            {detail.rows.map((r) => (
              <option key={r.exposureLineId} value={r.exposureLineId}>
                {r.projectName}
                {nameOf(r.projectCreatedBy) ? ` (${nameOf(r.projectCreatedBy)})` : ''} ·{' '}
                {r.filterShortName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.formActions}>
        <button
          type="submit"
          className={styles.buttonPrimary}
          disabled={!lineId || assign.isPending}
        >
          {t('sessions.captures.assign')}
        </button>
        <button type="button" className={styles.button} onClick={onDone}>
          {t('sessions.correction.cancel')}
        </button>
      </div>
      {assign.error ? <ProblemMessage code={problemCode(assign.error)} /> : null}
    </form>
  );
}

/** CSV der angezeigten Aufnahmen (FA-AUS-12), Zeiten in UTC und Standortzeit. */
function downloadCsv(
  detail: NightSessionDetail,
  list: readonly NightSessionCapture[],
  zone: string,
  nameOf: (id: string | null) => string,
) {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const cell = (v: string | number | boolean | null) => {
    const text = v === null ? '' : String(v);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = [
    'capturedAtUtc',
    'capturedAtSite',
    'frameType',
    'project',
    'projectCreator',
    'filter',
    'filterActual',
    'exposureS',
    'gain',
    'offset',
    'binning',
    'result',
    'bonus',
    'rejected',
    'rejectReason',
    'temperatureDeviation',
    'settingsDeviation',
    'assignment',
    'fileName',
    'hfr',
    'stars',
  ];
  const rows = list.map((c) =>
    [
      c.capturedAt,
      local.format(new Date(Date.parse(c.capturedAt))),
      c.frameType,
      c.projectName,
      nameOf(c.projectCreatedBy),
      c.filterShortName,
      c.filterActual,
      c.exposureS,
      c.gain,
      c.offset,
      c.binning,
      c.result,
      c.isBonus,
      c.rejected,
      c.rejectReason,
      c.temperatureDeviation,
      c.settingsDeviation,
      c.assignment,
      c.fileName,
      c.hfr,
      c.stars,
    ]
      .map(cell)
      .join(';'),
  );
  const blob = new Blob([`\uFEFF${[head.join(';'), ...rows].join('\r\n')}\r\n`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${detail.session.night}-${detail.session.rigName.replace(/[^\w-]+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** HFR mit zwei Nachkommastellen in der Sprache der Oberfläche. */
function hfrText(hfr: number, lang: string): string {
  return hfr.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---- Verlauf & Notizen ----

function EventTimeline({ detail }: { detail: NightSessionDetail }) {
  const { t, i18n } = useTranslation();
  const zone = detail.session.siteTimeZone;
  const headingId = useId();
  const kind = (k: string) =>
    i18n.exists(`sessions.events.kind.${k}`) ? t(`sessions.events.kind.${k}`) : k;
  return (
    <section className={styles.subCard} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {t('evaluation.history.events')}
      </h2>
      {detail.events.length === 0 ? (
        <p className={styles.muted}>{t('sessions.events.empty')}</p>
      ) : (
        <ol className={styles.timeline}>
          {detail.events.map((e) => (
            <li key={e.id} className={styles.timelineItem} data-kind={e.kind}>
              <span className={styles.timelineTime}>
                <SiteTime atUtc={e.occurredAt} siteTimeZone={zone} />
              </span>
              <span className={styles.timelineBody}>
                <strong>{kind(e.kind)}</strong>
                {e.durationS !== null ? (
                  <span className={styles.muted}>
                    {' '}
                    · {t('sessions.captures.seconds', { s: Math.round(e.durationS) })}
                  </span>
                ) : null}
                {e.message ? <span className={styles.timelineMessage}>{e.message}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
