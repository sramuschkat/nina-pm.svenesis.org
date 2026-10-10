/**
 * S-60 Nächte (AP-64, AP-77; FA-AUS-01, FA-AUS-05, FA-AUS-17, FA-AUS-22): Reiter „Nächte“ der Auswertung – „Was ist
 * passiert?“. Kennzahlen für Rig und Zeitraum (Nächte mit Session und davon nutzbar, Integration, Effizienz Ø) und eine
 * Karte je Session-Nacht: Datum mit Wetterpunkt, Effizienzbalken („8,2 von 9,6 h · 85 %“), Projekt-Chips mit Ersteller
 * und Frames je Filter (Transit als Serie), Hinweis auf nicht zugeordnete Aufnahmen, „Öffnen“. Nächte ohne Session
 * erscheinen grau, wenn die Standort-Statistik sie als bewölkt führt. Die Liste lädt seitenweise. Prüfen (Kennzahl
 * „Ungeprüft“, Schalter „Nur ungeprüfte“, Plakette) entfällt seit AP-77; `?ungeprueft=1` wird ignoriert.
 */
import {
  combineQualityCounts,
  formatNightKey,
  formatTzAbbr,
  formatZonedTime,
  sessionGrade,
  shareLabelPct,
} from '@nina-pm/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { sessionLogApi, sessionsApi, type NightSessionListItem } from '../../api/client';
import { ProblemMessage } from '../../components/ProblemMessage';
import { QualityBar } from '../../components/quality';
import { StatusBadge } from '../../components/StatusBadge';
import { Person } from '../../lib/member';
import { problemCode } from '../admin/shared';
import { useEquipmentList } from '../equipment/shared';
import { EvaluationHeader, useEvaluationFilter } from './EvaluationHeader';
import { nightPath, nightWeekday } from './evaluation';
import {
  efficiencyBar,
  groupNights,
  projectChips,
  weatherTone,
  type NightGroup,
  type ProjectChip,
} from './night-model';
import styles from './evaluation.module.css';

/** Nicht zugeordnete Lights der Nacht (alle Sessions); sie zählen erst nach dem Zuordnen (FA-AUS-22). */
const unassignedOf = (g: NightGroup) => g.sessions.reduce((n, x) => n + x.unassigned, 0);

/** Nächte je Seite der Liste. */
export const NIGHTS_PAGE_SIZE = 30;

export function NightsPage() {
  const { t } = useTranslation();
  const { filter, range, search, ready } = useEvaluationFilter();
  const rigId = filter.rigId;
  const query = { ...(rigId ? { rigId } : {}), from: range.from, to: range.to };
  const summary = useQuery({
    queryKey: ['sessions', 'summary', query],
    queryFn: () => sessionsApi.summary(query),
    enabled: ready,
  });
  const list = useInfiniteQuery({
    queryKey: ['sessions', 'nights', query],
    queryFn: ({ pageParam }) =>
      sessionsApi.list({
        ...query,
        limit: NIGHTS_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: ready,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className={styles.page}>
      <EvaluationHeader />
      <SummaryTiles summary={summary} />
      <section className={styles.listHead} aria-label={t('evaluation.nights.listLabel')}>
        <h2 className={styles.sectionTitle}>{t('evaluation.nights.listTitle')}</h2>
      </section>
      {list.isError ? (
        <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <p className={styles.muted} role="status">
          {t('common.loading')}
        </p>
      ) : (
        <NightList items={items} search={search} range={range} complete={!list.hasNextPage} />
      )}
      {list.hasNextPage ? (
        <button
          type="button"
          className={styles.more}
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? t('common.loading') : t('evaluation.nights.more')}
        </button>
      ) : null}
    </div>
  );
}

function SummaryTiles({
  summary,
}: {
  summary: ReturnType<typeof useQuery<Awaited<ReturnType<typeof sessionsApi.summary>>>>;
}) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  if (summary.isError)
    return (
      <ProblemMessage code={problemCode(summary.error)} onRetry={() => void summary.refetch()} />
    );
  const s = summary.data;
  const dash = '–';
  return (
    <section className={styles.tiles} aria-label={t('evaluation.nights.kpis')}>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{t('evaluation.nights.withSession')}</span>
        <span className={styles.tileValue}>{s ? s.nights : dash}</span>
        <span className={styles.tileSub}>
          {s ? t('evaluation.nights.usable', { count: s.usableNights }) : ' '}
        </span>
      </div>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{t('evaluation.nights.integration')}</span>
        <span className={styles.tileValue}>
          {s ? t('sessions.hours', { h: n(s.integrationS / 3600) }) : dash}
        </span>
        <span className={styles.tileSub}>
          {s
            ? t('evaluation.nights.lightsProjects', {
                lights: s.lights.toLocaleString(i18n.language),
                count: s.projects,
              })
            : ' '}
        </span>
      </div>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{t('evaluation.nights.efficiency')}</span>
        <span className={styles.tileValue}>
          {s && s.efficiencyPct !== null ? `${n(s.efficiencyPct, 0)} %` : dash}
        </span>
        <span className={styles.tileSub}>{t('evaluation.nights.efficiencyHint')}</span>
      </div>
    </section>
  );
}

type Card =
  | { readonly kind: 'night'; readonly night: string; readonly group: NightGroup }
  | { readonly kind: 'cloudy'; readonly night: string };

function NightList({
  items,
  search,
  range,
  complete,
}: {
  items: readonly NightSessionListItem[];
  search: string;
  range: { from: string; to: string };
  complete: boolean;
}) {
  const { t } = useTranslation();
  const { filter } = useEvaluationFilter();
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  // Graue Nächte (bewölkt erfasst) nur mit eindeutigem Standort: der des gewählten Rigs bzw. der einzige.
  const siteId =
    (rigs.data ?? []).find((r) => r.id === filter.rigId)?.siteId ??
    (sites.data?.length === 1 ? sites.data[0]?.id : undefined) ??
    '';
  const clear = useQuery({
    queryKey: ['clear-nights', siteId, range.from, range.to],
    queryFn: () => sessionLogApi.clearNights(siteId, range.from, range.to),
    enabled: siteId !== '',
  });
  const oldest = items.at(-1)?.night ?? range.to;
  const withSession = new Set(items.map((s) => s.night));
  const cloudy: Card[] = (clear.data?.nights ?? [])
    .filter(
      (n) =>
        n.source === 'manual' &&
        n.sessionIds.length === 0 &&
        !withSession.has(n.night) &&
        (complete || n.night >= oldest),
    )
    .map((n) => ({ kind: 'cloudy', night: n.night }));
  const cards: Card[] = [
    ...groupNights(items).map((g): Card => ({ kind: 'night', night: g.night, group: g })),
    ...cloudy,
  ].sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0));
  if (cards.length === 0) return <p className={styles.empty}>{t('evaluation.nights.empty')}</p>;
  return (
    <ul className={styles.cards}>
      {cards.map((c) =>
        c.kind === 'night' ? (
          <li key={c.group.key}>
            <NightCard group={c.group} search={search} showRig={filter.rigId === ''} />
          </li>
        ) : (
          <li key={`cloudy-${c.night}`}>
            <CloudyCard night={c.night} />
          </li>
        ),
      )}
    </ul>
  );
}

function NightDate({ night }: { night: string }) {
  const { i18n } = useTranslation();
  return (
    <span className={styles.cardDate}>
      {nightWeekday(night, i18n.language)} {formatNightKey(night)}
    </span>
  );
}

/** Karte einer Nacht und eines Rigs (Entscheidung Sven 07.10.2026): Summen über die Sessions der Nacht. */
function NightCard({
  group: s,
  search,
  showRig,
}: {
  group: NightGroup;
  search: string;
  showRig: boolean;
}) {
  const { t, i18n } = useTranslation();
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const bar = efficiencyBar(s.efficiency);
  const tone = weatherTone(s.weather);
  // Sessionqualität der Nacht (AP-77) aus den Sessions; die Vorhersage steht klar beschriftet darunter.
  const quality = combineQualityCounts(s.sessions.flatMap((x) => (x.quality ? [x.quality] : [])));
  const grade = sessionGrade(quality.sharePct);
  const zone = s.siteTimeZone;
  const time = (at: string) => `${formatZonedTime(at, zone)} ${formatTzAbbr(at, zone)}`;
  const label = t('evaluation.nights.cardLabel', {
    night: formatNightKey(s.night),
    rig: s.rigName,
  });
  return (
    <article className={styles.card} aria-label={label}>
      <div className={styles.cardStart}>
        <NightDate night={s.night} />
        {grade && quality.sharePct !== null ? (
          <span className={styles.quality} data-grade={grade}>
            <span className={styles.weatherDot} aria-hidden="true" />
            {t('evaluation.nights.quality', {
              grade: t(`evaluation.quality.grade.${grade}`),
              pct: shareLabelPct(quality.sharePct),
            })}
            <span className={styles.qualityMini}>
              <QualityBar counts={quality} />
            </span>
          </span>
        ) : null}
        <span className={styles.weather} data-tone={tone}>
          <span className={styles.weatherDot} aria-hidden="true" />
          {s.weather && s.weather.ratingIndex !== null
            ? s.weather.nightMean !== null
              ? t('evaluation.nights.weather', {
                  rating: t(`weather.rating.${String(s.weather.ratingIndex)}`),
                  pct: n(s.weather.nightMean * 100, 0),
                })
              : t(`weather.rating.${String(s.weather.ratingIndex)}`)
            : t('evaluation.nights.noWeather')}
        </span>
        <span className={styles.cardMeta}>
          {showRig ? `${s.rigName} · ` : ''}
          {time(s.startedAt)} – {s.endedAt ? time(s.endedAt) : t('sessions.running')}
        </span>
        {s.sessions.length > 1 ? (
          <span className={styles.cardMeta}>
            {t('evaluation.nights.sessions', { count: s.sessions.length })}
          </span>
        ) : null}
      </div>
      <div className={styles.cardMid}>
        <div className={styles.effRow}>
          <span className={styles.effTrack} aria-hidden="true">
            <span className={styles.effFill} style={{ width: `${String(bar?.widthPct ?? 0)}%` }} />
          </span>
          <span className={styles.effText}>
            {bar
              ? bar.pct !== null
                ? t('evaluation.nights.eff', {
                    exposure: n(bar.exposureH),
                    dark: n(bar.darkH),
                    pct: bar.pct,
                  })
                : t('evaluation.nights.effNoDark', { exposure: n(bar.exposureH) })
              : s.status === 'running'
                ? t('sessions.running')
                : t('evaluation.nights.effNone', { h: n(s.integrationS / 3600) })}
          </span>
        </div>
        {s.projects.length > 0 ? (
          <ul className={styles.chips} aria-label={t('evaluation.nights.projects')}>
            {projectChips(s.projects).map((p) => (
              <li key={p.projectId} className={styles.chip}>
                <ChipContent chip={p} />
              </li>
            ))}
          </ul>
        ) : (
          <span className={styles.muted}>{t('evaluation.nights.noLights')}</span>
        )}
      </div>
      <div className={styles.cardEnd}>
        {s.status !== 'completed' ? (
          <StatusBadge kind="session" value={s.status} size="sm" />
        ) : null}
        {unassignedOf(s) > 0 ? (
          <span className={styles.badgeWarn}>
            {t('evaluation.nights.unassigned', { count: unassignedOf(s) })}
          </span>
        ) : null}
        <Link
          className={styles.open}
          to={nightPath(s.rigId, s.night, search)}
          aria-label={t('evaluation.nights.openLabel', {
            night: formatNightKey(s.night),
            rig: s.rigName,
          })}
        >
          {t('evaluation.nights.open')}
        </Link>
      </div>
    </article>
  );
}

/** Chip-Inhalt: Projekt, Ersteller (Kurzform), Frames je Filter bzw. „Transit · RED 558“. */
export function ChipContent({ chip }: { chip: ProjectChip }) {
  const { t, i18n } = useTranslation();
  const parts = chip.parts
    .map((f) => `${f.filter} ${f.frames.toLocaleString(i18n.language)}`)
    .join(' · ');
  return (
    <>
      <strong className={styles.chipName}>{chip.projectName}</strong>
      <Person id={chip.createdBy} compact />
      <span className={styles.chipFrames}>
        · {chip.series ? t('evaluation.nights.series', { parts }) : parts}
      </span>
    </>
  );
}

function CloudyCard({ night }: { night: string }) {
  const { t } = useTranslation();
  return (
    <article
      className={`${styles.card} ${styles.cardGrey}`}
      aria-label={t('evaluation.nights.cloudyLabel', { night: formatNightKey(night) })}
    >
      <div className={styles.cardStart}>
        <NightDate night={night} />
        <span className={styles.weather} data-tone="none">
          <span className={styles.weatherDot} aria-hidden="true" />
          {t('evaluation.nights.cloudy')}
        </span>
      </div>
      <div className={styles.cardMid}>
        <span className={styles.muted}>{t('evaluation.nights.noSession')}</span>
      </div>
      <div className={styles.cardEnd} />
    </article>
  );
}
