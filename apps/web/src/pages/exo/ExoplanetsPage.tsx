/**
 * S-22 Exoplaneten (FK 14.3; FA-EXO-01…14; AP-42): Transitsuche je Rig und Nacht.
 * - Kontextleiste wie S-21 (Rig, Nacht ◀ ▶, *Heute Nacht* aus der Nacht-Tabelle des Servers, NT-01).
 * - Filterleiste (FA-EXO-05): Kataloge, Priorität, max. Helligkeit, min. Tiefe, min. Höhe, Schalter; je Benutzer
 *   gespeichert (Einstellung `exo.search`). Trefferzahl im Kopf, *Transits suchen* rechnet neu.
 * - Ergebnistabelle (FA-EXO-06…09), sortierbar, Standard nach Transitmitte.
 * - Aufgeklappte Zeile (Wunsch Sven 30.09.2026): Zeitleiste der Nacht mit Beobachtungsfenster, Kontakten und
 *   Lichtkurve (FA-EXO-10…12), darunter die Karten Sternfeld, Himmelsposition und die Reiter *Zieldetails* /
 *   *Meine Beobachtungen* (FA-EXO-13/14).
 * - Aktion *Projekt* (FA-EXO-15): Exoplaneten-Projekt anlegen bzw. das eigene öffnen (OP-22), dann der Editor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  api,
  equipmentApi,
  exoApi,
  type ExoSearchSettings,
  type ExoTransitList,
  type ExoTransitView,
} from '../../api/client';
import { useAuth, useCan } from '../../auth';
import { formatCoordinate } from '../../components/CoordinateInput/coords';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { FilterBar, FilterCheck } from '../../components/FilterBar';
import { ICON_SIZE, actionIcons, areaIcons, uiIcons } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import type { RigOption } from '../../components/RigSelect';
import { Tabs } from '../../components/Tabs';
import { newId, problemCode } from '../admin/shared';
import { NumberInput, Select } from '../catalog/fields';
import catalogStyles from '../catalog/catalog.module.css';
import { useEquipmentList, useNumber } from '../equipment/shared';
import { PlanningContext } from '../planning/PlanningContext';
import { PlanningTabs } from '../planning/PlanningTabs';
import { SiteMoonDarkness } from '../planning/SiteMoonDarkness';
import { exoCalculatorHref } from '../calculator/model';
import { PROJECT_PATHS } from '../projects/ProjectEditorPage';
import { skyMapHref } from '../planning/skymap/model';
import {
  applyExoFilters,
  EXO_CATALOG_LABELS,
  EXO_SEARCH_DEFAULTS,
  lightYears,
  paramsFromUrl,
  researchLinks,
  siteClock,
  depthFraction,
  urlFromParams,
  type ExoUrl,
} from './model';
import { ExposureCard } from './ExposureCard';
import { HelpTip } from './HelpTip';
import { SkyPosition } from './SkyPosition';
import { StarField } from './StarField';
import { TransitTimeline } from './TransitTimeline';
import styles from './exo.module.css';

export { EXO_PATH } from './model';

const CATALOGS = ['exoclock', 'nasa', 'toi'] as const;
const CATALOG_NAMES = EXO_CATALOG_LABELS;

/** „21:08 CDT“ in der Zone des Standorts (rules/ui.md). */
const useClock = siteClock;

export function ExoplanetsPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const url = useMemo(() => urlFromParams(params), [params]);
  const setUrl = (patch: Partial<ExoUrl>) =>
    setParams(paramsFromUrl({ ...url, ...patch }), { replace: true });
  const ids = { results: useId() };

  // Filter je Benutzer (FA-EXO-05): gespeicherter Stand, lokale Änderungen sofort, Speichern verzögert.
  const prefKey = ['me', 'preferences', me?.tenant?.id];
  const prefs = useQuery({
    queryKey: prefKey,
    queryFn: () => api.preferences(),
    staleTime: Infinity,
  });
  const [settings, setSettings] = useState<ExoSearchSettings | null>(null);
  const current: ExoSearchSettings = settings ?? prefs.data?.['exo.search'] ?? EXO_SEARCH_DEFAULTS;
  const saveTimer = useRef<number | undefined>(undefined);
  const change = (patch: Partial<ExoSearchSettings>) => {
    const next = { ...current, ...patch };
    setSettings(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void api
        .setPreference('exo.search', next)
        .then(() => client.setQueryData(prefKey, { ...(prefs.data ?? {}), 'exo.search': next }))
        .catch(() => undefined);
    }, 600);
  };
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  // Rig und Nacht wie im Objektbrowser (S-21).
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const rigList = rigs.data ?? [];
  const rigId =
    (rigList.some((r) => r.id === url.rig) ? url.rig : null) ??
    rigList.find((r) => r.showInPlanning)?.id ??
    rigList[0]?.id ??
    null;
  const rig = rigList.find((r) => r.id === rigId) ?? null;
  const site = (sites.data ?? []).find((s) => s.id === rig?.siteId) ?? null;
  const rigOptions: RigOption[] = rigList.map((r) => ({
    id: r.id,
    name: r.name,
    siteName: (sites.data ?? []).find((s) => s.id === r.siteId)?.name ?? '',
    telescopeName: (telescopes.data ?? []).find((x) => x.id === r.telescopeId)?.name ?? '',
    cameraName: (cameras.data ?? []).find((x) => x.id === r.cameraId)?.name ?? '',
    scaleArcsecPx: r.derived.scaleArcsecPx,
    fovDeg: [r.derived.fovWidthDeg, r.derived.fovHeightDeg],
    showInPlanning: r.showInPlanning,
  }));
  const nights = useQuery({
    queryKey: ['site-nights', site?.id, 'current'],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 2),
    enabled: site !== null,
  });
  const night = url.night || nights.data?.currentNight || null;
  const siteGeo = useMemo(
    () => (site ? { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg } : null),
    [site?.latitudeDeg, site?.longitudeDeg],
  );

  const search = useQuery({
    queryKey: [
      'exo-transits',
      rigId,
      night,
      [...current.catalogs].sort().join(','),
      current.minAltDeg,
    ],
    queryFn: () =>
      exoApi.transits({
        rigId: rigId ?? '',
        night,
        catalogs: current.catalogs,
        minAltDeg: current.minAltDeg,
      }),
    enabled: rigId !== null && night !== null && !prefs.isPending,
    staleTime: 5 * 60_000,
  });
  const data = search.data;
  const items = useMemo(() => (data ? applyExoFilters(data.items, current) : []), [data, current]);
  const chips = [
    ...(current.priority !== 'all'
      ? [
          {
            id: 'priority',
            label: t('filterBar.chip', {
              label: t('exo.filter.priority'),
              value: t(`exo.priorityFilter.${current.priority}`),
            }),
            onRemove: () => change({ priority: 'all' }),
          },
        ]
      : []),
  ];

  return (
    <div className={catalogStyles.page}>
      <PageHeader title={t('exo.title')} nav={<PlanningTabs />} />

      <PlanningContext
        rigs={rigOptions}
        rigId={rigId}
        onRigChange={(v) => setUrl({ rig: v ?? '', night: '' })}
        site={site}
        siteGeo={siteGeo}
        night={night}
        today={nights.data?.currentNight ?? null}
        onNightChange={(v) => setUrl({ night: v })}
        onTonight={() => setUrl({ night: '' })}
        empty={
          rigs.isSuccess && rigList.length === 0 ? (
            <p className={catalogStyles.muted}>{t('exo.noRig')}</p>
          ) : null
        }
      />

      {site && night ? (
        <section className={catalogStyles.moonDark} aria-label={t('moonDark.title')}>
          <SiteMoonDarkness site={site} night={night} current={nights.data?.currentNight ?? null} />
        </section>
      ) : null}

      <section className={catalogStyles.results} aria-labelledby={ids.results}>
        <div className={catalogStyles.resultHead}>
          <h2 id={ids.results} className={catalogStyles.resultTitle}>
            {data ? t('exo.results', { count: items.length }) : t('exo.title')}
          </h2>
          <button
            type="button"
            className={styles.searchButton}
            disabled={rigId === null || night === null || search.isFetching}
            onClick={() => void search.refetch()}
          >
            <actionIcons.refresh size={ICON_SIZE.button} aria-hidden />
            {t('exo.search')}
          </button>
        </div>
        <div className={catalogStyles.tabPanel}>
          <div className={catalogStyles.filterRow}>
            <CatalogDates data={data} />
            <FilterBar
              label={t('exo.filters')}
              inline={
                <>
                  <fieldset className={styles.catalogs}>
                    <legend className={catalogStyles.srOnly}>{t('exo.filter.catalogs')}</legend>
                    {CATALOGS.map((c) => (
                      <label key={c} className={catalogStyles.check}>
                        <input
                          type="checkbox"
                          checked={current.catalogs.includes(c)}
                          // Mindestens ein Katalog bleibt gewählt.
                          disabled={current.catalogs.length === 1 && current.catalogs.includes(c)}
                          onChange={(e) =>
                            change({
                              catalogs: e.target.checked
                                ? [...current.catalogs, c]
                                : current.catalogs.filter((x) => x !== c),
                            })
                          }
                        />
                        {CATALOG_NAMES[c]}
                      </label>
                    ))}
                  </fieldset>
                  <Select
                    compact
                    id="exo-priority"
                    label={t('exo.filter.priority')}
                    value={current.priority}
                    onChange={(v) => change({ priority: v as ExoSearchSettings['priority'] })}
                    options={(['all', 'alert', 'high', 'medium'] as const).map(
                      (p) => [p, t(`exo.priorityFilter.${p}`)] as const,
                    )}
                  />
                </>
              }
              chips={chips}
              panelLabel={t('exo.moreFilters')}
              panel={
                <>
                  <NumberInput
                    id="exo-max-mag"
                    label={t('exo.filter.maxMag')}
                    unit="mag"
                    value={String(current.maxMag)}
                    onChange={(v) => {
                      const n = Number(v.replace(',', '.'));
                      if (v !== '' && Number.isFinite(n)) change({ maxMag: n });
                    }}
                  />
                  <NumberInput
                    id="exo-min-depth"
                    label={t('exo.filter.minDepth')}
                    unit="mmag"
                    value={String(current.minDepthMmag)}
                    onChange={(v) => {
                      const n = Number(v.replace(',', '.'));
                      if (v !== '' && Number.isFinite(n)) change({ minDepthMmag: n });
                    }}
                  />
                  <NumberInput
                    id="exo-min-alt"
                    label={t('exo.filter.minAlt')}
                    unit="°"
                    value={String(current.minAltDeg)}
                    onChange={(v) => {
                      const n = Number(v.replace(',', '.'));
                      if (v !== '' && Number.isFinite(n) && n >= 0 && n <= 90)
                        change({ minAltDeg: n });
                    }}
                  />
                  <FilterCheck
                    label={t('exo.filter.observableOnly')}
                    checked={current.observableOnly}
                    onChange={(on) => change({ observableOnly: on })}
                  />
                  <FilterCheck
                    label={t('exo.filter.startEndDark')}
                    checked={current.startEndDark}
                    onChange={(on) => change({ startEndDark: on })}
                  />
                  <FilterCheck
                    label={t('exo.filter.startEndAboveMinAlt')}
                    checked={current.startEndAboveMinAlt}
                    onChange={(on) => change({ startEndAboveMinAlt: on })}
                  />
                  <FilterCheck
                    label={t('exo.filter.showFlip')}
                    checked={current.showFlip}
                    onChange={(on) => change({ showFlip: on })}
                  />
                  <FilterCheck
                    label={t('exo.filter.hideFlip')}
                    checked={current.hideFlip}
                    onChange={(on) => change({ hideFlip: on })}
                  />
                </>
              }
              onReset={() => change(EXO_SEARCH_DEFAULTS)}
            />
          </div>

          {rigId === null && rigs.isSuccess ? null : search.isPending || prefs.isPending ? (
            <p role="status" className={catalogStyles.state}>
              {t('exo.loading')}
            </p>
          ) : search.isError ? (
            <div className={catalogStyles.state}>
              <ProblemMessage
                code={problemCode(search.error)}
                onRetry={() => void search.refetch()}
              />
            </div>
          ) : items.length === 0 ? (
            <p className={`${catalogStyles.muted} ${catalogStyles.state}`}>{t('exo.empty')}</p>
          ) : (
            <ResultTable items={items} data={data as ExoTransitList} showFlip={current.showFlip} />
          )}
        </div>
      </section>
    </div>
  );
}

/** Stand der Kataloge: nur das Datum des letzten Abrufs (FK 14.3; Aktualisieren in S-82). */
function CatalogDates({ data }: { data: ExoTransitList | undefined }) {
  const { t, i18n } = useTranslation();
  if (!data) return null;
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso))
      : '–';
  return (
    <p className={catalogStyles.muted}>
      {t('exo.catalogDates', {
        list: data.catalogs
          .map((c) => `${CATALOG_NAMES[c.catalog]} ${date(c.fetchedAt)}`)
          .join(' · '),
      })}
    </p>
  );
}

function Priority({ value }: { value: ExoTransitView['priority'] }) {
  const { t } = useTranslation();
  if (!value) return <span className={catalogStyles.muted}>–</span>;
  return (
    <span className={`${styles.priority} ${styles[`prio_${value}`] ?? ''}`}>
      {t(`exo.priority.${value}`)}
    </span>
  );
}

function ResultTable({
  items,
  data,
  showFlip,
}: {
  items: ExoTransitView[];
  data: ExoTransitList;
  showFlip: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useNumber();
  const tz = data.site.timeZone;
  const clock = useClock(tz);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', timeZone: tz }).format(
      new Date(iso),
    );
  const columns: DataColumn<ExoTransitView>[] = [
    {
      id: 'priority',
      header: t('exo.col.priority'),
      sortValue: (x) =>
        x.priority === null ? 9 : ['alert', 'high', 'medium', 'low'].indexOf(x.priority),
      cell: (x) => <Priority value={x.priority} />,
    },
    {
      id: 'planet',
      header: t('exo.col.planet'),
      nowrap: true,
      sortValue: (x) => x.planet,
      cell: (x) => <strong className={styles.planet}>{x.planet}</strong>,
    },
    {
      id: 'catalog',
      header: t('exo.col.catalog'),
      priority: 3,
      sortValue: (x) => x.catalog,
      cell: (x) =>
        `${CATALOG_NAMES[x.catalog]}${x.disposition ? ` (${x.disposition})` : ''}${
          x.alsoIn.length ? ` +${String(x.alsoIn.length)}` : ''
        }`,
    },
    {
      id: 'type',
      header: t('exo.col.type'),
      priority: 4,
      sortValue: (x) => x.radiusRe,
      cell: (x) => (x.sizeClass ? t(`exo.size.${x.sizeClass}`) : '–'),
    },
    {
      id: 'star',
      header: t('exo.col.star'),
      priority: 4,
      nowrap: true,
      sortValue: (x) => x.teffK,
      cell: (x) => (x.spectralClass ? `${x.spectralClass} · ${fmt(x.teffK ?? 0, 0)} K` : '–'),
    },
    {
      id: 'filter',
      header: t('exo.col.filter'),
      priority: 2,
      nowrap: true,
      cell: (x) =>
        x.filter.choice ? (
          <span title={t(`exo.filterMatch.${x.filter.choice.match}`)}>
            {x.filter.choice.shortName}
            {x.filter.choice.match === 'substitute' ? ' *' : ''}
          </span>
        ) : (
          <span className={catalogStyles.muted} title={t('exo.filterNone')}>
            {x.filter.band} –
          </span>
        ),
    },
    {
      id: 'distance',
      header: t('exo.col.distance'),
      align: 'end',
      priority: 5,
      sortValue: (x) => x.distancePc,
      cell: (x) => (x.distancePc === null ? '–' : `${fmt(lightYears(x.distancePc), 0)} Lj`),
    },
    {
      id: 'mag',
      header: t('exo.col.mag'),
      align: 'end',
      nowrap: true,
      sortValue: (x) => x.mag,
      cell: (x) => (x.mag === null ? '–' : `${fmt(x.mag, 1)} ${x.magBand ?? ''}`),
    },
    {
      id: 'depth',
      header: t('exo.col.depth'),
      align: 'end',
      nowrap: true,
      sortValue: (x) => x.depthMmag,
      cell: (x) =>
        x.depthMmag === null ? '–' : `${fmt(x.depthMmag, 1)}${x.depthEstimated ? '*' : ''}`,
    },
    {
      id: 'date',
      header: t('exo.col.date'),
      priority: 3,
      nowrap: true,
      sortValue: (x) => x.transit.tcUtc,
      cell: (x) => date(x.transit.tcUtc),
    },
    {
      id: 'ingress',
      header: t('exo.col.ingress'),
      nowrap: true,
      priority: 2,
      sortValue: (x) => x.transit.ingressUtc,
      cell: (x) => clock(x.transit.ingressUtc),
    },
    {
      id: 'mid',
      header: t('exo.col.mid'),
      nowrap: true,
      sortValue: (x) => x.transit.tcUtc,
      cell: (x) => clock(x.transit.tcUtc),
    },
    {
      id: 'egress',
      header: t('exo.col.egress'),
      nowrap: true,
      priority: 2,
      sortValue: (x) => x.transit.egressUtc,
      cell: (x) => clock(x.transit.egressUtc),
    },
    {
      id: 'duration',
      header: t('exo.col.duration'),
      align: 'end',
      priority: 3,
      sortValue: (x) => x.durationH,
      cell: (x) => `${fmt(x.durationH, 2)} h${x.durationEstimated ? '*' : ''}`,
    },
    {
      id: 'period',
      header: t('exo.col.period'),
      align: 'end',
      priority: 5,
      sortValue: (x) => x.periodD,
      cell: (x) => `${fmt(x.periodD, 3)} d`,
    },
    {
      id: 'alt',
      header: t('exo.col.alt'),
      align: 'end',
      sortValue: (x) => x.transit.altAtCenterDeg,
      cell: (x) => (
        <span className={x.transit.observable ? undefined : catalogStyles.muted}>
          {`${fmt(x.transit.altAtCenterDeg, 0)}°`}
          {showFlip && x.transit.meridianInWindow ? (
            <uiIcons.meridianFlip
              className={styles.flip}
              size={ICON_SIZE.table}
              aria-label={t('exo.flipInWindow')}
              role="img"
            />
          ) : null}
        </span>
      ),
    },
    {
      id: 'moon',
      header: t('exo.col.moon'),
      align: 'end',
      priority: 4,
      sortValue: (x) => x.transit.moonSepDeg,
      cell: (x) => `${fmt(x.transit.moonSepDeg, 0)}°`,
    },
    {
      id: 'oc',
      header: t('exo.col.oc'),
      align: 'end',
      priority: 5,
      sortValue: (x) => x.ocMin,
      cell: (x) => (x.ocMin === null ? '–' : fmt(x.ocMin, 1)),
    },
    {
      id: 'mine',
      header: t('exo.col.mine'),
      align: 'end',
      priority: 4,
      sortValue: (x) => x.myProjects,
      cell: (x) => (x.myProjects ? String(x.myProjects) : '–'),
    },
    {
      id: 'aperture',
      header: t('exo.col.aperture'),
      align: 'end',
      nowrap: true,
      priority: 2,
      sortValue: (x) => x.aperture?.requiredMm ?? null,
      cell: (x) =>
        x.aperture ? (
          <span
            className={x.aperture.fit ? styles[`fit_${x.aperture.fit}`] : undefined}
            title={t(`exo.apertureFit.${x.aperture.fit ?? 'unknown'}`)}
          >
            {`${fmt(x.aperture.requiredMm, 0)} mm`}
            {x.aperture.estimated ? ' est' : ''}
          </span>
        ) : (
          '–'
        ),
    },
    {
      id: 'links',
      header: t('exo.col.links'),
      priority: 5,
      cell: (x) => (
        <span className={styles.links}>
          {researchLinks(x).map((l) => (
            <a key={l.name} href={l.href} target="_blank" rel="noopener noreferrer">
              {l.name}
            </a>
          ))}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('exo.col.actions'),
      headerHidden: true,
      cell: (x) => (
        <span className={styles.actions}>
          <Link
            className={styles.iconLink}
            to={skyMapHref({ ra: x.raDeg, dec: x.decDeg, rig: data.rig.id, fov: 2 })}
            aria-label={t('exo.action.framing', { name: x.planet })}
            title={t('exo.action.framing', { name: x.planet })}
          >
            <areaIcons.planning size={ICON_SIZE.table} aria-hidden />
          </Link>
          <ProjectButton x={x} data={data} />
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(x) => x.key}
      rowLabel={(x) => x.planet}
      label={t('exo.title')}
      defaultSort={{ id: 'mid', dir: 'asc' }}
      renderDetail={(x) => <TransitDetail x={x} data={data} showFlip={showFlip} />}
    />
  );
}

/**
 * *Projekt* (FA-EXO-15): legt das Exoplaneten-Projekt für Planet und Rig an bzw. öffnet das eigene (OP-22) und
 * springt in den Editor. Dämmerung und Mindesthöhe kommen aus dem Suchfilter (FA-EXO-05), die Belichtung der
 * Transit-Zeile aus der Empfehlung (FA-EXO-14a).
 */
function ProjectButton({ x, data }: { x: ExoTransitView; data: ExoTransitList }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCreate = useCan('project.create');
  const create = useMutation({
    mutationFn: () =>
      exoApi.createProject({
        id: newId(),
        rigId: data.rig.id,
        catalog: x.catalog,
        planet: x.planet,
        twilight: data.twilight,
        minAltDeg: data.minAltDeg,
        exposureS: x.exposure.status === 'ok' ? x.exposure.exposureS : null,
      }),
    onSuccess: (r) => void navigate(PROJECT_PATHS.edit(r.projectId)),
  });
  if (!canCreate) return null;
  const label = t('exo.action.projectCreate', { name: x.planet });
  return (
    <>
      <button
        type="button"
        className={styles.projectButton}
        aria-label={label}
        title={label}
        disabled={create.isPending}
        onClick={() => create.mutate()}
      >
        {t('exo.action.project')}
      </button>
      {create.isError ? (
        <span className={styles.warn} role="alert">
          {t('exo.action.projectFailed')}
        </span>
      ) : null}
    </>
  );
}

/** Kennwert mit Erklärung als Hilfesymbol (FA-EXO-13: „mit kurzer Erklärung je Größe“). */
function Fact({ label, value, why }: { label: string; value: string; why: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>
        <HelpTip label={t('exo.explainLabel', { name: label })} text={why} />
        <span>{value}</span>
      </dd>
    </div>
  );
}

/**
 * Aufgeklappte Zeile (Wunsch Sven 30.09.2026): Zeitleiste der ganzen Nacht mit Fenster, Kontakten, Meridian und
 * Lichtkurve (FA-EXO-10…12); darunter Sternfeld, Himmelsposition und die Reiter *Zieldetails* /
 * *Meine Beobachtungen* (FA-EXO-13/14).
 */
function TransitDetail({
  x,
  data,
  showFlip,
}: {
  x: ExoTransitView;
  data: ExoTransitList;
  showFlip: boolean;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useNumber();
  const tz = data.site.timeZone;
  const clock = useClock(tz);
  const depthPct = x.depthMmag === null ? null : depthFraction(x.depthMmag) * 100;
  const [tab, setTab] = useState<'details' | 'mine'>('details');
  const coords = `${formatCoordinate('ra', x.raDeg, 'sexagesimal')} · ${formatCoordinate(
    'dec',
    x.decDeg,
    'sexagesimal',
  )}`;
  const facts: [string, string, string][] = [
    [
      t('exo.fact.catalog'),
      `${CATALOG_NAMES[x.catalog]}${x.disposition ? ` (${x.disposition})` : ''}${
        x.alsoIn.length ? ` · ${x.alsoIn.map((c) => CATALOG_NAMES[c]).join(', ')}` : ''
      }`,
      t('exo.explain.catalog'),
    ],
    [t('exo.fact.coords'), coords, t('exo.explain.coords')],
    [
      t('exo.fact.distance'),
      x.distancePc === null
        ? '–'
        : `${fmt(lightYears(x.distancePc), 0)} Lj (${fmt(x.distancePc, 0)} pc)`,
      t('exo.explain.distance'),
    ],
    [
      t('exo.fact.mag'),
      x.mag === null ? '–' : `${x.magBand ?? ''} ${fmt(x.mag, 2)}`,
      t('exo.explain.mag'),
    ],
    [
      t('exo.fact.depth'),
      x.depthMmag === null
        ? '–'
        : `${fmt(x.depthMmag, 1)} mmag${depthPct === null ? '' : ` (${fmt(depthPct, 2)} %)`}${
            x.depthEstimated ? ` · ${t('exo.estimated')}` : ''
          }`,
      t('exo.explain.depth'),
    ],
    [t('exo.fact.rpRs'), x.rpOverRs === null ? '–' : fmt(x.rpOverRs, 4), t('exo.explain.rpRs')],
    [
      t('exo.fact.type'),
      x.sizeClass
        ? `${t(`exo.size.${x.sizeClass}`)}${x.radiusRe === null ? '' : ` · ${fmt(x.radiusRe, 2)} R⊕`}`
        : '–',
      t('exo.explain.type'),
    ],
    [
      t('exo.fact.spectral'),
      x.spectralClass ? `${x.spectralClass} · ${fmt(x.teffK ?? 0, 0)} K` : '–',
      t('exo.explain.spectral'),
    ],
    [
      t('exo.fact.duration'),
      `${fmt(x.durationH, 2)} h${x.durationEstimated ? ` · ${t('exo.estimated')}` : ''}`,
      t('exo.explain.duration'),
    ],
    [t('exo.fact.period'), `${fmt(x.periodD, 5)} d`, t('exo.explain.period')],
    [
      t('exo.fact.ingress'),
      `${clock(x.transit.ingressUtc)} · ${fmt(x.transit.altAtIngressDeg, 0)}°`,
      t('exo.explain.contacts'),
    ],
    [
      t('exo.fact.mid'),
      `${clock(x.transit.tcUtc)} · ${fmt(x.transit.altAtCenterDeg, 0)}°`,
      t('exo.explain.contacts'),
    ],
    [
      t('exo.fact.egress'),
      `${clock(x.transit.egressUtc)} · ${fmt(x.transit.altAtEgressDeg, 0)}°`,
      t('exo.explain.contacts'),
    ],
    [
      t('exo.fact.window'),
      `${clock(x.transit.windowStartUtc)} – ${clock(x.transit.windowEndUtc)}`,
      t('exo.explain.window'),
    ],
    [
      t('exo.fact.uncertainty'),
      t('exo.uncertaintyValue', {
        sigma: fmt(x.transit.sigmaS / 60, 1),
        buffer: fmt(x.transit.bufferS / 60, 0),
        age: t(`exo.ephemerisAge.${x.transit.ephemerisAge}`),
      }),
      t('exo.explain.uncertainty'),
    ],
    [
      t('exo.fact.moon'),
      `${fmt(x.transit.moonSepDeg, 0)}° · ${fmt(x.transit.moonIllumPct, 0)} %`,
      t('exo.explain.moon'),
    ],
    [
      t('exo.fact.aperture'),
      x.aperture
        ? `${fmt(x.aperture.requiredMm, 0)} mm${x.aperture.estimated ? ' est' : ''}${
            data.rig.apertureMm
              ? ` · ${t('exo.rigAperture', { mm: fmt(data.rig.apertureMm, 0) })}`
              : ''
          }`
        : '–',
      t('exo.explain.aperture'),
    ],
  ];
  const source = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
    new Date(x.fetchedAt),
  );
  return (
    <div className={styles.detail}>
      {x.transit.timeSystemUncertain ? (
        <p className={styles.warn}>{t('exo.timeSystemUncertain')}</p>
      ) : null}
      {x.transit.ephemerisAge !== 'ok' ? (
        <p className={styles.warn}>{t(`exo.ephemerisAgeHint.${x.transit.ephemerisAge}`)}</p>
      ) : null}
      {x.transit.baselineInTwilight ? (
        <p className={styles.muted}>{t('exo.baselineInTwilight')}</p>
      ) : null}
      <TransitTimeline
        x={x}
        site={data.site}
        night={data.night}
        minAltDeg={data.minAltDeg}
        twilight={data.twilight}
        showFlip={showFlip}
      />
      <div className={styles.cards}>
        {/* Titel, Bild, Fußzeile – Sternfeld und Himmelsposition stehen auf gleicher Höhe (Wunsch Sven 01.10.2026). */}
        <section
          className={`${styles.card} ${styles.fieldCard}`}
          aria-label={t('exo.starField.title', { star: x.star })}
        >
          <h3 className={styles.cardTitle}>{t('exo.starField.title', { star: x.star })}</h3>
          <StarField raDeg={x.raDeg} decDeg={x.decDeg} star={x.star} />
          <p className={styles.cardFoot}>
            <Link to={skyMapHref({ ra: x.raDeg, dec: x.decDeg, rig: data.rig.id, fov: 2 })}>
              {t('exo.starField.openFraming')}
            </Link>
          </p>
        </section>
        <section
          className={`${styles.card} ${styles.skyCard}`}
          aria-label={t('exo.skyPosition.title', { star: x.star })}
        >
          <h3 className={styles.cardTitle}>{t('exo.skyPosition.title', { star: x.star })}</h3>
          <SkyPosition raDeg={x.raDeg} decDeg={x.decDeg} label={x.star} />
        </section>
        <ExposureCard
          exposure={x.exposure}
          star={x.star}
          // Auch ohne Empfehlung (z. B. kein passender Filter): Rechner mit den Katalogwerten (AP-61).
          calculatorHref={exoCalculatorHref({
            rigId: data.rig.id,
            filterId: x.filter.choice?.filterId ?? null,
            star: x.star,
            band: x.exposure.status === 'ok' ? x.exposure.band : x.filter.band,
            mag: x.exposure.status === 'ok' ? x.exposure.mag : x.mag,
            depthMmag: x.depthMmag,
            durationH: x.durationH,
            rpOverRs: x.rpOverRs,
            windowS:
              (Date.parse(x.transit.windowEndUtc) - Date.parse(x.transit.windowStartUtc)) / 1000,
            // Wie die API (transit.md §6): Kontakte, bei Kulmination im Fenster deren Höhe.
            altMaxDeg: Math.max(
              x.transit.altAtIngressDeg,
              x.transit.altAtCenterDeg,
              x.transit.altAtEgressDeg,
              x.transit.meridianInWindow ? 90 - Math.abs(data.site.latDeg - x.decDeg) : -90,
            ),
            altMidDeg: x.transit.altAtCenterDeg,
          })}
        />
        <section className={`${styles.card} ${styles.detailsCard}`}>
          <Tabs<'details' | 'mine'>
            label={t('exo.tabsLabel', { name: x.planet })}
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'details', label: t('exo.tab.details') },
              { key: 'mine', label: t('exo.tab.mine') },
            ]}
            panels={{
              details: (
                <div className={styles.tabBody}>
                  <p className={styles.detailsHead}>
                    <strong>{x.planet}</strong>
                    {x.ticId ? <span className={styles.muted}> (TIC {x.ticId})</span> : null}
                  </p>
                  <dl className={styles.facts}>
                    {facts.map(([label, value, why]) => (
                      <Fact key={label} label={label} value={value} why={why} />
                    ))}
                  </dl>
                  <p>
                    <span className={styles.muted}>{t('exo.filterTitle')}: </span>
                    {t(`exo.filterReason.${x.filter.band}`)}{' '}
                    {x.filter.choice
                      ? t(`exo.filterChoice.${x.filter.choice.match}`, {
                          name: x.filter.choice.shortName,
                        })
                      : t('exo.filterNone')}
                  </p>
                  <p className={styles.research}>
                    <span className={styles.muted}>{t('exo.researchTitle')}: </span>
                    {researchLinks(x).map((l) => (
                      <a
                        key={l.name}
                        className={styles.smallButton}
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {l.name}
                      </a>
                    ))}
                  </p>
                  <p className={styles.muted}>
                    {t('exo.ephemerisSource', {
                      catalog: CATALOG_NAMES[x.catalog],
                      t0: fmt(x.t0BjdTdb, 5),
                      system: x.timeSystemSource,
                      date: source,
                    })}{' '}
                    · {t('exo.starField.caption')}
                  </p>
                </div>
              ),
              mine: (
                <div className={styles.tabBody}>
                  <p>
                    {x.myProjects > 0
                      ? t('exo.mine.count', { count: x.myProjects })
                      : t('exo.mine.none')}
                  </p>
                </div>
              ),
            }}
          />
        </section>
      </div>
    </div>
  );
}
