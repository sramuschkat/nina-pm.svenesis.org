/**
 * S-61 Nacht (AP-64, AP-77; FA-AUS-01…06, FA-AUS-09, FA-AUS-12, FA-AUS-20, FA-AUS-22, FA-AUS-23, FA-AUS-25; NT-03, NT-E2,
 * NT-E3): eine Nacht eines Rigs **im Bereich** Auswertung (`/auswertung/naechte/{rigId}/{night}`) – Link „← Nächte“ (mit
 * dem Filter des Bereichs) statt Brotkrumen. Mehrere Sessions der Nacht: Auswahl „Ganze Nacht | Session 1 · 20:00–01:10 |
 * …“ (`?session=`); Qualität, Grafik, Kennzahlen und Bedingungen gelten für die Auswahl, Soll/Ist und die Qualität je
 * Projekt bleiben je Session (Entscheidung Sven 07.10.2026).
 *
 * Seit AP-77 (Entscheidung Sven 10.10.2026) **ohne Reiter** und **ohne Prüfen**, nur die Übersicht:
 * 1. **Session-Qualität** als Urteil (Anteil guter Lights: sehr gut ≥ 95 %, gut ≥ 85 %, mäßig ≥ 70 %, sonst schlecht).
 * 2. Hinweise: Warnungen und Fehler der Nacht, nicht zugeordnete Aufnahmen mit *Zuordnen* (sie zählen erst danach).
 * 3. Kennzahlenleiste, Zeile **Bedingungen** (Lights, Telemetrie, Vorhersage), Nachtgrafik mit Ist, Qualitätskurve.
 * 4. **Ergebnis je Projekt** je Session: Filter-Chips mit Ist/Soll und Qualitätsleiste; „Details“ mit Tabelle je Filter
 *    (Anteile, HFR, Sterne, Guiding, Verläufe mit Grenzlinie) und Soll/Ist mit Korrektur.
 * 5. Eingeklappt: Flats und „Alle Ereignisse (n)“. Die CSV der Nacht steht im Kopf.
 * Soll = erster Plan der Session ohne Bonus, Ist = Aufnahmen dieser Session (Entscheidung Sven 07.10.2026).
 */
import {
  formatNightKey,
  formatTzAbbr,
  formatZonedTime,
  qualityStats,
  rejectReasons,
  sessionGrade,
  shareLabelPct,
  type ConditionMetric,
} from '@nina-pm/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { QualityBar, QualityText, Sparkline, reasonText } from '../../components/quality';
import { SiteTime } from '../../components/SiteTime';
import { StatusBadge } from '../../components/StatusBadge';
import { Person, useMemberNames } from '../../lib/member';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { EVALUATION_PATHS, filterSearch, nightWeekday, parseFilter } from './evaluation';
import { MetricsChart } from './MetricsChart';
import { useNightActual } from './night-actual';
import {
  gapsWithin,
  mergeDetails,
  nightFacts,
  nightWarnings,
  projectResults,
  type NightGap,
  type ProjectResult,
} from './night-model';
import styles from './evaluation.module.css';

export const hours = (s: number) => (s / 3600).toFixed(1);

type NightLineQuality = NonNullable<NightSessionDetail['quality']>['lines'][number];

/** Bewertete Lights (gespeichert, zugeordnet, mit Bewertung) für die Summe der Auswahl. */
const gradedLights = (captures: readonly NightSessionCapture[]) =>
  captures.flatMap((c) =>
    c.grade
      ? [
          {
            grade: c.grade,
            flags: c.flags ?? [],
            hfr: c.hfr,
            stars: c.stars,
            rmsArcsec: c.quality?.rmsArcsec ?? null,
          },
        ]
      : [],
  );

export function NightPage() {
  const { t, i18n } = useTranslation();
  const { rigId = '', night = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const back = `${EVALUATION_PATHS.nights}${filterSearch(parseFilter(params))}`;
  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(params);
    if (value === null) p.delete(key);
    else p.set(key, value);
    setParams(p, { replace: true });
  };
  const client = useQueryClient();
  const nameOf = useMemberNames();
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
  const [cursor, setCursor] = useState<number | null>(null);
  const [assigning, setAssigning] = useState(false);
  const assignRef = useRef<HTMLDivElement>(null);
  const canAssign = useCan('session.review');

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
  const unassigned = merged.captures.filter(
    (c) => c.frameType === 'light' && c.assignment === 'unassigned',
  );
  const lights = merged.captures.filter((c) => c.frameType === 'light' && c.result === 'saved');
  const openAssign = () => {
    setAssigning(true);
    requestAnimationFrame(() => assignRef.current?.scrollIntoView?.({ block: 'start' }));
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
          </>
        }
        actions={
          <button
            type="button"
            className={styles.button}
            disabled={merged.captures.length === 0}
            onClick={() => downloadCsv(merged, merged.captures, zone, nameOf)}
          >
            {t('evaluation.night.csv')}
          </button>
        }
      />
      {many ? (
        // Auswahl der Session (Standard: ganze Nacht für Qualität, Grafik, Kennzahlen und Bedingungen).
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
      <QualitySummary captures={merged.captures} />
      <Notices
        detail={merged}
        unassigned={unassigned.length}
        canAssign={canAssign}
        onAssign={openAssign}
      />
      {assigning && unassigned.length > 0 ? (
        <div ref={assignRef} className={styles.subCard}>
          <AssignList
            captures={unassigned}
            detail={merged}
            onDone={() => setAssigning(false)}
            onChanged={refresh}
          />
        </div>
      ) : null}
      <FactsBar
        detail={merged}
        gaps={actual.gaps && selected ? gapsWithin(actual.gaps, selected.session) : actual.gaps}
      />
      <Conditions conditions={merged.conditions ?? []} />
      <section tabIndex={-1} className={styles.chartCard} aria-label={t('evaluation.night.chart')}>
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
      {/* Ergebnis je Projekt mit Qualität, Soll/Ist und Korrektur je Session (sessionbezogen). */}
      {shown.map((d) => (
        <SessionBlock key={d.session.id} detail={d} label={sessionLabel(d)} />
      ))}
      {lights.some((c) => c.hfr !== null) ? (
        <QualityCurve detail={merged} gaps={actual.gaps ?? []} />
      ) : null}
      {merged.flats.length > 0 ? (
        <details className={styles.deviations}>
          <summary>{t('evaluation.captures.flatsSummary')}</summary>
          <FlatsHeader detail={merged} />
        </details>
      ) : null}
      <details className={styles.deviations}>
        <summary>{t('evaluation.night.allEvents', { count: merged.events.length })}</summary>
        <EventTimeline detail={merged} />
      </details>
    </div>
  );
}

// ---- Qualität und Hinweise ----

/** Urteil der Auswahl (ganze Nacht bzw. Session) aus allen bewerteten Lights. */
function QualitySummary({ captures }: { captures: readonly NightSessionCapture[] }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const stats = qualityStats(gradedLights(captures));
  const grade = sessionGrade(stats.sharePct);
  const graded = stats.good + stats.flagged + stats.rejected;
  const n = (x: number, d: number) =>
    x.toLocaleString(i18n.language, { minimumFractionDigits: d, maximumFractionDigits: d });
  const parts = [
    t('evaluation.quality.lights', { good: stats.good, count: graded }),
    t('evaluation.quality.flaggedCount', { count: stats.flagged }),
    ...(stats.rejected > 0
      ? [t('evaluation.quality.rejectedCount', { count: stats.rejected })]
      : []),
    ...(stats.hfr
      ? [t('evaluation.quality.hfrRange', { min: n(stats.hfr.min, 2), max: n(stats.hfr.max, 2) })]
      : []),
    ...(stats.rmsArcsec
      ? [t('evaluation.quality.rms', { rms: n(stats.rmsArcsec.median, 1) })]
      : []),
  ];
  return (
    <section
      className={styles.qualitySummary}
      aria-labelledby={headingId}
      data-grade={grade ?? 'none'}
    >
      <span className={styles.qualityPct}>
        {stats.sharePct === null ? '–' : `${String(shareLabelPct(stats.sharePct))} %`}
      </span>
      <div className={styles.qualityBody}>
        <h2 id={headingId} className={styles.qualityTitle}>
          {grade
            ? t('evaluation.quality.title', { grade: t(`evaluation.quality.grade.${grade}`) })
            : t('evaluation.quality.titleNone')}
        </h2>
        <span className={styles.muted}>
          {grade ? parts.join(' · ') : t('evaluation.quality.noneHint')}
        </span>
      </div>
      <div className={styles.qualityBar}>
        <QualityBar counts={stats} size="md" />
      </div>
    </section>
  );
}

/**
 * Hinweise der Nacht (nur wenn es welche gibt): Warnungen und Fehler, Aufnahmen mit Temperatur- bzw.
 * Einstellungsabweichung (NT-E2/E3, bisher Symbol im Reiter Aufnahmen), nicht zugeordnete Aufnahmen mit *Zuordnen*.
 */
function Notices({
  detail,
  unassigned,
  canAssign,
  onAssign,
}: {
  detail: NightSessionDetail;
  unassigned: number;
  canAssign: boolean;
  onAssign: () => void;
}) {
  const { t, i18n } = useTranslation();
  const w = nightWarnings(detail.events);
  const Warn = actionIcons.warning;
  const kind = (k: string) =>
    i18n.exists(`sessions.events.kind.${k}`) ? t(`sessions.events.kind.${k}`) : k;
  const lights = detail.captures.filter((c) => c.frameType === 'light');
  const temperature = lights.filter((c) => c.temperatureDeviation).length;
  const settings = lights.filter((c) => c.settingsDeviation).length;
  if (w.kinds.length === 0 && unassigned === 0 && temperature === 0 && settings === 0) return null;
  return (
    <div className={styles.notices}>
      {w.kinds.length > 0 ? (
        <p className={styles.notice} data-tone={w.errors > 0 ? 'danger' : 'warning'} role="note">
          <Warn size={16} aria-hidden="true" />
          <span>
            {t('evaluation.night.warnings', { errors: w.errors, warnings: w.warnings })}{' '}
            <span className={styles.muted}>
              ({w.kinds.map((k) => `${kind(k.kind)} ${String(k.count)}`).join(', ')})
            </span>
          </span>
        </p>
      ) : null}
      {temperature > 0 || settings > 0 ? (
        <p className={styles.notice} data-tone="warning" role="note">
          <Warn size={16} aria-hidden="true" />
          <span>{t('evaluation.night.deviating', { temperature, settings })}</span>
        </p>
      ) : null}
      {unassigned > 0 ? (
        <p className={styles.notice} data-tone="warning" role="note">
          <Warn size={16} aria-hidden="true" />
          <span>{t('evaluation.night.unassigned', { count: unassigned })}</span>
          {canAssign ? (
            <button type="button" className={styles.linkButton} onClick={onAssign}>
              {t('evaluation.night.assign')}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

const CONDITION_DIGITS: Record<ConditionMetric, number> = {
  cloudPct: 0,
  sqm: 2,
  temperatureC: 1,
  humidityPct: 0,
  dewPointC: 1,
  windMs: 1,
  seeingScore: 0,
  transparencyPct: 0,
};

/** Zeile „Bedingungen“ (AP-77): Median mit Spanne, Quelle als Hinweis; fehlende Größen entfallen. */
function Conditions({ conditions }: { conditions: NonNullable<NightSessionDetail['conditions']> }) {
  const { t, i18n } = useTranslation();
  if (conditions.length === 0) return null;
  const scale = (m: ConditionMetric, v: number) => (m === 'seeingScore' ? v * 100 : v);
  const n = (m: ConditionMetric, v: number) =>
    scale(m, v).toLocaleString(i18n.language, {
      minimumFractionDigits: CONDITION_DIGITS[m],
      maximumFractionDigits: CONDITION_DIGITS[m],
    });
  return (
    <section className={styles.conditions} aria-label={t('evaluation.conditions.title')}>
      <span className={styles.factLabel}>{t('evaluation.conditions.title')}</span>
      <ul className={styles.conditionList}>
        {conditions.map((c) => {
          const same = n(c.metric, c.min) === n(c.metric, c.max);
          const value = t(`evaluation.conditions.unit.${c.metric}`, { v: n(c.metric, c.median) });
          return (
            <li
              key={c.metric}
              title={t(`evaluation.conditions.source.${c.source}`)}
              className={styles.condition}
            >
              <span className={styles.muted}>{t(`evaluation.conditions.metric.${c.metric}`)}</span>{' '}
              <strong>{value}</strong>
              {same ? null : (
                <span className={styles.muted}>
                  {' '}
                  ({n(c.metric, c.min)}–{n(c.metric, c.max)})
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Qualitätskurve der Auswahl (FA-AUS-23, bisher Reiter Aufnahmen). */
function QualityCurve({ detail, gaps }: { detail: NightSessionDetail; gaps: readonly NightGap[] }) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section className={styles.subCard} aria-labelledby={headingId}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          {t('evaluation.captures.metrics')}
        </h2>
      </div>
      <MetricsChart
        captures={detail.captures}
        events={detail.events}
        gaps={gaps}
        timeZone={detail.session.siteTimeZone}
        fromUtc={detail.session.startedAt}
        toUtc={detail.session.endedAt}
        scaleArcsecPx={detail.quality?.scaleArcsecPx ?? null}
        refs={detail.quality?.refs ?? []}
      />
    </section>
  );
}

/**
 * Eine Session der Nacht: Kopfzeile (Zeitraum, NINA-Instanz, ⋯ mit Nachtbericht erneut senden) und Ergebnis je Projekt
 * (Soll/Ist und Qualität je Session).
 */
function SessionBlock({ detail: d, label }: { detail: NightSessionDetail; label: string }) {
  const { t } = useTranslation();
  const s = d.session;
  const canResend = useCan('session.report.resend');
  const resend = useMutation({ mutationFn: () => discordApi.resendReport(s.id) });
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [correctLine, setCorrectLine] = useState<string | null>(null);
  const menu: ActionMenuItem[] =
    canResend && s.status !== 'running'
      ? [
          {
            key: 'resend',
            label: t('sessions.detail.resendReport'),
            onSelect: () => resend.mutate(),
          },
        ]
      : [];
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
        {menu.length > 0 ? (
          <span className={styles.sessionMenu}>
            <ActionMenu
              label={t('evaluation.night.moreSession', { session: label })}
              items={menu}
            />
          </span>
        ) : null}
      </div>
      {resend.error ? <ProblemMessage code={problemCode(resend.error)} /> : null}
      {resend.data ? (
        <p role="status" className={resend.data.channels > 0 ? styles.badgeOk : styles.badgeWarn}>
          {resend.data.channels > 0
            ? t('sessions.detail.resendQueued', { count: resend.data.channels })
            : t('sessions.detail.resendNoChannel')}
        </p>
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

/** Qualität einer Zeile der Session (Server, AP-77) zum Filter-Chip. */
const lineQualityOf = (
  lines: readonly NightLineQuality[],
  projectId: string,
  lineId: string,
): NightLineQuality | undefined =>
  lines.find((l) => l.projectId === projectId && l.exposureLineId === lineId);

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
  const lines = detail.quality?.lines ?? [];
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
        <span className={styles.muted}>
          {t('sessions.plan.definition')} · {t('evaluation.quality.definition')}
        </span>
      </div>
      {results.length === 0 ? (
        <p className={styles.muted}>{t('sessions.plan.empty')}</p>
      ) : (
        <ul className={styles.results}>
          {results.map((p) => {
            const expanded = open === p.projectId;
            const detailsId = `details-${p.projectId}`;
            const mine = lines.filter((l) => l.projectId === p.projectId);
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
                    {p.filters.map((f) => {
                      const q = lineQualityOf(lines, p.projectId, f.lineId);
                      return (
                        <li key={f.lineId} className={styles.filterQuality}>
                          <span
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
                                aria-label={t('evaluation.night.planReached')}
                              />
                            ) : f.ok === false ? (
                              <Warn
                                size={14}
                                className={styles.warnIcon}
                                aria-label={t('evaluation.night.planMissed')}
                              />
                            ) : null}
                          </span>
                          {q ? (
                            <>
                              <QualityBar counts={q} />
                              <QualityText counts={q} />
                            </>
                          ) : null}
                        </li>
                      );
                    })}
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
                    {mine.length > 0 ? (
                      <LineQualityTable
                        lines={mine}
                        projectName={p.projectName}
                        colorOf={colorOf}
                      />
                    ) : null}
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

/** Bildqualität je Filter eines Projekts (AP-77, Entwurf „Aufgeklappt“): Anteile, Median/Spanne, Verläufe mit Grenze. */
function LineQualityTable({
  lines,
  projectName,
  colorOf,
}: {
  lines: readonly NightLineQuality[];
  projectName: string;
  colorOf: (short: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d: number) =>
    x.toLocaleString(i18n.language, { minimumFractionDigits: d, maximumFractionDigits: d });
  const spread = (s: NightLineQuality['hfr'], d: number, unit: (v: string) => string): ReactNode =>
    s ? (
      <>
        {unit(n(s.median, d))}{' '}
        <span className={styles.muted}>
          {n(s.min, d)}–{n(s.max, d)}
        </span>
      </>
    ) : (
      '–'
    );
  const columns: DataColumn<NightLineQuality>[] = [
    {
      id: 'filter',
      header: t('sessions.plan.col.filter'),
      sortValue: (l) => l.filter,
      cell: (l) => <FilterChip shortName={l.filter} color={colorOf(l.filter)} size="sm" />,
    },
    {
      id: 'lights',
      header: t('evaluation.quality.col.lights'),
      align: 'end',
      sortValue: (l) => l.good + l.flagged + l.rejected + l.none,
      cell: (l) => l.good + l.flagged + l.rejected + l.none,
    },
    {
      id: 'share',
      header: t('evaluation.quality.col.share'),
      sortValue: (l) => l.sharePct ?? -1,
      cell: (l) => (
        <span className={styles.shareCell}>
          <QualityBar counts={l} />
          <QualityText counts={l} showCount={false} />
        </span>
      ),
    },
    {
      id: 'hfr',
      header: t('evaluation.quality.col.hfr'),
      priority: 2,
      nowrap: true,
      sortValue: (l) => l.hfr?.median ?? -1,
      cell: (l) => spread(l.hfr, 2, (v) => t('evaluation.quality.px', { v })),
    },
    {
      id: 'stars',
      header: t('evaluation.quality.col.stars'),
      priority: 3,
      nowrap: true,
      sortValue: (l) => l.stars?.median ?? -1,
      cell: (l) => spread(l.stars, 0, (v) => v),
    },
    {
      id: 'rms',
      header: t('evaluation.quality.col.rms'),
      priority: 2,
      nowrap: true,
      sortValue: (l) => l.rmsArcsec?.median ?? -1,
      cell: (l) => spread(l.rmsArcsec, 2, (v) => t('evaluation.quality.arcsec', { v })),
    },
    {
      id: 'hfrTrend',
      header: t('evaluation.quality.col.hfrTrend'),
      priority: 3,
      cell: (l) => (
        <Sparkline
          tone="hfr"
          points={l.series.map((p) => ({ x: Date.parse(p.atUtc), y: p.hfr, flagged: p.flagged }))}
          limit={l.hfrLimit}
          label={t('evaluation.quality.hfrTrend', {
            filter: l.filter,
            reasons: reasonText(l.reasons, t) || t('evaluation.quality.allGood'),
          })}
        />
      ),
    },
    {
      id: 'rmsTrend',
      header: t('evaluation.quality.col.rmsTrend'),
      priority: 3,
      cell: (l) => (
        <Sparkline
          tone="rms"
          points={l.series.map((p) => ({
            x: Date.parse(p.atUtc),
            y: p.rmsArcsec,
            flagged: p.flagged,
          }))}
          limit={l.rmsLimit}
          min={0}
          label={t('evaluation.quality.rmsTrend', { filter: l.filter })}
        />
      ),
    },
  ];
  return (
    <div className={styles.lineQuality}>
      <h3 className={styles.formTitle}>{t('evaluation.quality.perFilter')}</h3>
      <DataTable
        columns={columns}
        rows={lines}
        rowKey={(l) => l.exposureLineId ?? l.filter}
        rowLabel={(l) => `${projectName} · ${l.filter}`}
        label={t('evaluation.quality.tableOf', { name: projectName })}
      />
      <p className={styles.muted}>{t('evaluation.quality.legend')}</p>
    </div>
  );
}

/** Nicht zugeordnete Lights der Auswahl zuordnen (FA-AUS-22, Admin): je Aufnahme ein Formular. */
function AssignList({
  captures,
  detail,
  onDone,
  onChanged,
}: {
  captures: readonly NightSessionCapture[];
  detail: NightSessionDetail;
  onDone: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className={styles.cardHead}>
        <h2 className={styles.sectionTitle}>
          {t('evaluation.night.assignTitle', { count: captures.length })}
        </h2>
        <button type="button" className={styles.button} onClick={onDone}>
          {t('evaluation.night.assignClose')}
        </button>
      </div>
      {captures.map((c) => (
        <AssignForm
          key={c.id}
          capture={c}
          detail={detail}
          onDone={() => undefined}
          onChanged={onChanged}
        />
      ))}
    </>
  );
}

// ---- Deviations, Soll/Ist, Korrektur ----

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

// ---- Flats, Zuordnen, CSV ----

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

/** CSV der Nacht (FA-AUS-12): alle Aufnahmen der Auswahl, Zeiten in UTC und Standortzeit, Qualität je Light (AP-77). */
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
    'guidingRmsArcsec',
    'quality',
    'qualityReasons',
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
      c.quality?.rmsArcsec ?? null,
      c.grade === 'kept' ? 'ok' : (c.grade ?? null),
      (c.flags ?? []).map((f) => f.metric).join(','),
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

// ---- Alle Ereignisse ----

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
