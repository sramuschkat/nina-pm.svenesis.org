/**
 * Mittlerer Bereich des Projekt-Editors S-31 (FK 14.3, AP-26b): Reiter *Nachtdiagramm* (mit Nachtwahl
 * in der Reiterleiste, Standortzeit), *Saisondiagramm* (AP-24) und *Wetter* des Standorts (FA-WET-05,
 * AP-23) – Vorschau des Entwurfs, Koordinaten und Bedingungen live; Engine im Browser mit der
 * Nacht-Tabelle des Standorts (NT-02). Dazu *Notizen* (FA-PRJ-17, Markdown ohne rohes HTML) und
 * *Freigabe-Verlauf* (FA-BER-03), die der Editor unter *Bild & Notizen* zeigt.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { equipmentApi, projectsApi, type HistoryEntry, type SiteView } from '../../api/client';
import { useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { ICON_SIZE, uiIcons } from '../../components/icons';
import { Markdown } from '../../components/Markdown';
import { NightChart } from '../../components/night-chart';
import { ProblemMessage } from '../../components/ProblemMessage';
import { Tabs } from '../../components/Tabs';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { problemCode } from '../equipment/shared';
import { useSiteWeather } from '../weather/WeatherPage';
import { weatherHref } from '../weather/model';
import { SeasonPanel } from './SeasonPanel';
import { engineMoonProfile, type ProjectDraft } from './model';
import styles from './projects.module.css';

type ChartTab = 'night' | 'season' | 'weather';

/** Zeile des Freigabe-Verlaufs mit stabilem Schlüssel. */
interface HistoryRow {
  h: HistoryEntry;
  key: string;
}

export function ChartArea({ draft, site }: { draft: ProjectDraft; site: SiteView | null }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ChartTab>('night');
  const nights = useQuery({
    queryKey: ['site-nights', site?.id],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 60),
    enabled: site !== null,
    staleTime: 60 * 60 * 1000,
  });
  const [offset, setOffset] = useState(0);
  const list = nights.data?.nights ?? [];
  const night = list[Math.min(offset, Math.max(0, list.length - 1))]?.night ?? null;
  const { raDeg, decDeg } = draft;
  const ready = site !== null && raDeg !== null && decDeg !== null;
  const needs = !site ? (
    <p className={styles.note}>{t('projectEditor.charts.needsRig')}</p>
  ) : (
    <p className={styles.note}>{t('projectEditor.charts.needsCoordinates')}</p>
  );
  const Prev = uiIcons.previous;
  const Next = uiIcons.next;
  const nightNav =
    tab === 'night' && ready ? (
      <div className={styles.nightNav}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('projectEditor.charts.previous')}
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - 1))}
        >
          <Prev size={ICON_SIZE.table} aria-hidden />
        </button>
        <strong aria-live="polite">
          {night ? t('projectEditor.charts.night', { night: formatNightKey(night) }) : '–'}
        </strong>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('projectEditor.charts.next')}
          disabled={offset >= list.length - 1}
          onClick={() => setOffset((o) => Math.min(list.length - 1, o + 1))}
        >
          <Next size={ICON_SIZE.table} aria-hidden />
        </button>
        <span className={styles.muted}>
          {t('projectEditor.charts.siteTime', { site: site.name })}
        </span>
      </div>
    ) : null;
  return (
    <section className={styles.area} aria-label={t('projectEditor.areas.charts')}>
      <Tabs<ChartTab>
        label={t('projectEditor.areas.charts')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'night', label: t('projectEditor.tabs.night') },
          { key: 'season', label: t('projectEditor.tabs.season') },
          { key: 'weather', label: t('projectEditor.tabs.weather') },
        ]}
        toolbar={nightNav}
        panelClassName={styles.areaMiddle}
        panels={{
          night: ready ? (
            <NightTab draft={draft} site={site} night={night} nights={nights} />
          ) : (
            needs
          ),
          season: ready ? (
            <SeasonPanel
              site={site}
              target={{ raDeg, decDeg }}
              conditions={{
                minAltitudeDeg: draft.conditions.minAltitudeDeg,
                minTimeOnTargetH: draft.conditions.minTimeOnTargetH,
                twilight: draft.conditions.twilight,
              }}
              startDate={draft.startDate || null}
            />
          ) : (
            needs
          ),
          weather: site ? (
            <WeatherTiles
              site={site}
              onPick={(n) => {
                const i = list.findIndex((x) => x.night === n);
                if (i >= 0) setOffset(i);
                setTab('night');
              }}
            />
          ) : (
            <p className={styles.note}>{t('weatherPage.noRig')}</p>
          ),
        }}
      />
    </section>
  );
}

// ---- Wetter ---------------------------------------------------------------------------------------

/** Kennzeichen je Bewertungsstufe (0 sehr schlecht … 4 ausgezeichnet). */
const RATING_PILL = ['pillDanger', 'pillDanger', 'pillWarn', 'pillOk', 'pillOk'] as const;

/**
 * Wetter-Reiter des Editors (AP-26f): die Nächte der Vorhersage als Kacheln (Bewertung, Mond) statt der
 * hohen Stundentabelle; ein Klick zeigt die Nacht im Nacht-Reiter, Stundenwerte auf der Wetterseite.
 */
function WeatherTiles({ site, onPick }: { site: SiteView; onPick: (night: string) => void }) {
  const { t, i18n } = useTranslation();
  const weather = useSiteWeather(site.id);
  const view = weather.data;
  const pct = (v: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(v * 100);
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>{t('weatherPage.forProject', { site: site.name })}</p>
      {weather.isError && !view ? (
        <ProblemMessage code={problemCode(weather.error)} onRetry={() => void weather.refetch()} />
      ) : !view ? (
        <p className={styles.muted} role="status">
          {t('common.loading')}
        </p>
      ) : view.status === 'pending' ? (
        <p className={styles.muted} role="status">
          {t('weatherPage.pending')}
        </p>
      ) : (
        <ul className={styles.weatherTiles}>
          {view.nights.map((n) => {
            const rating =
              n.darkFromUtc === null
                ? t('weather.chart.noDark')
                : n.nightMean === null || n.ratingIndex === null
                  ? t('weather.rating.none')
                  : t(`weather.rating.${String(n.ratingIndex)}`);
            const pill = n.ratingIndex === null ? 'pill' : (RATING_PILL[n.ratingIndex] ?? 'pill');
            return (
              <li key={n.night}>
                <button
                  type="button"
                  className={styles.weatherTile}
                  onClick={() => onPick(n.night)}
                  aria-label={t('projectEditor.weatherTile', {
                    night: formatNightKey(n.night),
                    rating,
                  })}
                >
                  <strong>{formatNightKey(n.night)}</strong>
                  <span className={`${styles.pill} ${styles[pill] ?? ''}`}>
                    {rating}
                    {n.nightMean !== null ? ` ${pct(n.nightMean)} %` : ''}
                  </span>
                  <span className={styles.muted}>
                    {t('projectEditor.weatherMoon', { pct: Math.round(n.moonIllumPct) })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Link className={styles.button} to={weatherHref(site.id)}>
          {t('weatherPage.openFull')}
        </Link>
      </div>
    </div>
  );
}

// ---- Nachtdiagramm --------------------------------------------------------------------------------

function NightTab({
  draft,
  site,
  night,
  nights,
}: {
  draft: ProjectDraft;
  site: SiteView;
  night: string | null;
  nights: UseQueryResult<Awaited<ReturnType<typeof equipmentApi.nights>>>;
}) {
  const { t } = useTranslation();
  const { raDeg, decDeg } = draft;
  const chart = useMemo(() => {
    if (!night || !nights.data || raDeg === null || decDeg === null) return null;
    return nightChartFromEngine({
      site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
      night,
      timeZoneTransitions: nights.data.timeZoneTransitions.map((z) => ({
        atUtc: Date.parse(z.atUtc) / 1000,
        utcOffsetMinutes: z.utcOffsetMinutes,
      })),
      timeZone: site.timeZone,
      targets: [
        {
          id: 'target',
          label: draft.targetName || draft.name || t('projectEditor.target'),
          color: 'var(--npm-chart-target)',
          target: { raJ2000Deg: raDeg, decJ2000Deg: decDeg },
        },
      ],
      minAltDeg: draft.conditions.minAltitudeDeg,
      twilight: draft.conditions.twilight,
      transitLabel: t('projectEditor.charts.meridian'),
      moonProfile: engineMoonProfile(draft.conditions),
    }).props;
  }, [site, night, nights.data, raDeg, decDeg, draft.targetName, draft.name, draft.conditions, t]);
  return chart ? (
    <NightChart {...chart} legend="top" />
  ) : (
    <NightChart
      window={null}
      timeZone={site.timeZone}
      state={nights.isError ? 'error' : 'loading'}
      onRetry={() => void nights.refetch()}
    />
  );
}

// ---- Notizen --------------------------------------------------------------------------------------

export function NotesTab({
  projectId,
  resource,
}: {
  projectId: string;
  resource: Parameters<typeof useCan>[1];
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const canWrite = useCan('project.note.write', resource);
  const notes = useQuery({
    queryKey: ['project-notes', projectId],
    queryFn: async () => (await projectsApi.notes(projectId)).items,
  });
  const [body, setBody] = useState('');
  const id = useId();
  const add = useMutation({
    mutationFn: () => projectsApi.addNote(projectId, body.trim()),
    onSuccess: async () => {
      setBody('');
      await client.invalidateQueries({ queryKey: ['project-notes', projectId] });
    },
  });
  // Kein eigenes `<form>`: der Reiter liegt im Formular des oberen Bereichs (keine verschachtelten Formulare).
  const submit = () => {
    if (body.trim()) add.mutate();
  };
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      Date.parse(iso),
    );
  return (
    <div className={styles.stack}>
      {canWrite ? (
        <div className={styles.stack}>
          <label htmlFor={id} className={styles.muted}>
            {t('projectEditor.notes.new')}
          </label>
          <textarea
            id={id}
            className={styles.input}
            rows={3}
            maxLength={20000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {add.error ? <ProblemMessage code={problemCode(add.error)} /> : null}
          <div>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={!body.trim()}
              onClick={submit}
            >
              {t('projectEditor.notes.add')}
            </button>
          </div>
        </div>
      ) : null}
      {notes.isError ? (
        <ProblemMessage code={problemCode(notes.error)} onRetry={() => void notes.refetch()} />
      ) : notes.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : notes.data.length === 0 ? (
        <p className={styles.muted}>{t('projectEditor.notes.empty')}</p>
      ) : (
        <ul className={styles.notes}>
          {notes.data.map((n) => (
            <li key={n.id}>
              <span className={styles.noteMeta}>
                {n.authorName} · {when(n.createdAt)}
              </span>
              <Markdown>{n.bodyMd}</Markdown>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Freigabe-Verlauf -----------------------------------------------------------------------------

export function HistoryTab({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const history = useQuery({
    queryKey: ['project-history', projectId],
    queryFn: async () => (await projectsApi.history(projectId)).items,
  });
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      Date.parse(iso),
    );
  /** Freigabeereignis in Worten; bei Entscheidungen mit Endstand der Stimmen (FA-FRG-14). */
  const approvalText = (h: { action: string; detail?: unknown }) => {
    const known = [
      'submitted',
      'withdrawn',
      'approved',
      'returned',
      'rejected',
      'expired',
      'edited_by_admin',
    ];
    const label = known.includes(h.action)
      ? t(`projectEditor.history.action.${h.action}`)
      : t('projectEditor.history.approval', { action: h.action });
    const votes = (h.detail as { votes?: { count: number; names?: string[] } } | null)?.votes;
    if (!votes) return label;
    return `${label} · ${t('projectEditor.history.votes', {
      count: votes.count,
      names: (votes.names ?? []).join(', ') || '–',
    })}`;
  };
  if (history.isError)
    return (
      <ProblemMessage code={problemCode(history.error)} onRetry={() => void history.refetch()} />
    );
  if (history.isPending) return <p role="status">{t('common.loading')}</p>;
  if (history.data.length === 0)
    return <p className={styles.muted}>{t('projectEditor.history.empty')}</p>;
  const what = (h: HistoryEntry) =>
    h.kind === 'approval'
      ? approvalText(h)
      : t('projectEditor.history.change', { entity: h.entity, action: h.action });
  const columns: DataColumn<HistoryRow>[] = [
    {
      id: 'when',
      header: t('projectEditor.history.when'),
      sortValue: (r) => r.h.createdAt,
      nowrap: true,
      cell: (r) => when(r.h.createdAt),
    },
    {
      id: 'who',
      header: t('projectEditor.history.who'),
      sortValue: (r) => r.h.userName,
      priority: 2,
      cell: (r) => r.h.userName ?? '–',
    },
    {
      id: 'what',
      header: t('projectEditor.history.what'),
      sortValue: (r) => what(r.h),
      cell: (r) => what(r.h),
    },
    {
      id: 'comment',
      header: t('projectEditor.history.comment'),
      priority: 3,
      cell: (r) => r.h.comment ?? '',
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={history.data.map((h, i) => ({ h, key: `${h.createdAt}-${String(i)}` }))}
      rowKey={(r) => r.key}
      rowLabel={(r) => when(r.h.createdAt)}
      label={t('projectEditor.tabs.history')}
      defaultSort={{ id: 'when', dir: 'desc' }}
    />
  );
}
