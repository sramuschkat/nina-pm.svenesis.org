/**
 * S-21 Objektbrowser (FK 14.3; FA-FRM-01, FA-FRM-15; AP-20): Katalogliste aus OpenNGC mit Filter nach
 * Katalog, Anzeigegruppe, Sternbild, Helligkeit (Band angezeigt), Flächenhelligkeit, Größe und „passt
 * ins Bildfeld“ des Rigs; mit Rig zusätzlich Nacht (◀ ▶, *Heute Nacht*), Mindesthöhe und min. nutzbare
 * Stunden – die Nachtwerte (beste Zeit/Höhe, Mond, nutzbare Stunden) rechnet die API mit der Engine.
 * Umschalter Liste/Galerie, Aktionen *Projekt anlegen* und *Sternkarte* (S-20, AP-21); Reiter
 * *Alle Objekte* / *Beste der Nacht* (FA-FRM-13, Bewertung der Website, AP-21). Filterleiste (FilterBar,
 * AP-26c): Suche, Objekttyp bzw. Familie und Katalog in der Zeile, übrige Filter unter *Weitere Filter*
 * mit Chips. Stilsystem AP-26d: Rig und Nacht in einer Kontextleiste über der Ergebniskarte (Bezug der
 * Nachtwerte, kein Filter); Reiter, Filterleiste und Tabelle in **einer** Karte; Zeilenaktionen als
 * Symbolknöpfe (*Saison*, *Sternkarte*) plus *Projekt*.
 */
import {
  DSO_TYPE_GROUPS,
  IAU_CONSTELLATION_NAMES,
  IAU_CONSTELLATIONS,
  dsoCatalogPrefixes,
  formatTzAbbr,
  formatZonedTime,
} from '@nina-pm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  catalogApi,
  equipmentApi,
  type DsoList,
  type DsoView,
  type SiteView,
} from '../../api/client';
import { useCan } from '../../auth';
import { CatalogImage } from './CatalogImage';
import { WikipediaLink } from './wikipedia';
import { PlanningContext } from '../planning/PlanningContext';
import { SiteMoonDarkness } from '../planning/SiteMoonDarkness';
import { PlanningTabs } from '../planning/PlanningTabs';
import { fovForFrame, skyMapHref } from '../planning/skymap/model';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { NightChart } from '../../components/night-chart';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { FilterBar, FilterCheck } from '../../components/FilterBar';
import { ICON_SIZE, actionIcons, areaIcons, uiIcons } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import { Tabs } from '../../components/Tabs';
import { ThumbPreview } from '../../components/ThumbPreview';
import type { RigOption } from '../../components/RigSelect';
import { problemCode } from '../admin/shared';
import { useEquipmentList, useNumber } from '../equipment/shared';
import { SeasonPanel } from '../projects/SeasonPanel';
import {
  aliasesOf,
  CATALOG_PATH,
  DEFAULT_MIN_ALT,
  effectiveSort,
  filtersFromParams,
  fovArcmin,
  NATURAL_DIR,
  NIGHT_SORTS,
  pageCount,
  paramsFromFilters,
  searchFromFilters,
  type Sort,
  SORTS,
  type BrowserFilters,
} from './model';
import { NumberInput, Select } from './fields';
import styles from './catalog.module.css';

/** Neues Projekt aus dem Katalog (die Zielfelder füllt der Editor aus `objekt`). */
export const createProjectHref = (primaryId: string, rigId: string | null) =>
  `/projekte/neu?${new URLSearchParams({ objekt: primaryId, ...(rigId ? { rig: rigId } : {}) }).toString()}`;

/** Kalenderdatum `YYYY-MM-DD` ohne Zeitzonenbezug (Abrufdatum des Katalogs). */
function plainDate(key: string, lang: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    Date.UTC(y, m - 1, d),
  );
}

export { CATALOG_PATH };

export function ObjectBrowserPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const ids = { results: useId() };
  const canCreate = useCan('project.create');

  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const rigList = rigs.data ?? [];
  const rigId =
    (rigList.some((r) => r.id === filters.rig) ? filters.rig : null) ??
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
  const fov = rig ? fovArcmin([rig.derived.fovWidthDeg, rig.derived.fovHeightDeg]) : null;

  // „Heute Nacht“ aus der Nacht-Tabelle des Servers (NT-01), nie aus dem Browserdatum.
  const nights = useQuery({
    queryKey: ['site-nights', site?.id, 'current'],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 2),
    enabled: site !== null,
  });
  const night = filters.night || nights.data?.currentNight || null;
  // Stabile Koordinaten für den Mondkalender (useMemo dort hängt am Objekt).
  const siteGeo = useMemo(
    () => (site ? { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg } : null),
    [site?.latitudeDeg, site?.longitudeDeg],
  );

  const update = (patch: Partial<BrowserFilters>) => {
    const next = { ...filters, ...patch };
    if (!('page' in patch)) next.page = 1;
    setParams(paramsFromFilters(next), { replace: true });
  };

  // Suche erst nach einer kurzen Pause im Eingabefeld.
  const [text, setText] = useState(filters.q);
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text === filters.q) return;
    const id = window.setTimeout(() => update({ q: text }), 250);
    return () => window.clearTimeout(id);
  });

  // Bewertung „Beste der Nacht“ braucht Standort und Bildfeld des Rigs (FA-FRM-13).
  const rated = site !== null && fov !== null;
  const sort = effectiveSort(filters.sort, { withNight: site !== null, rated });
  const waitForNight = site !== null && night === null && !nights.isError;
  const search = searchFromFilters(filters, {
    siteId: site?.id ?? null,
    night,
    fovArcmin: fov,
  });
  const list = useQuery({
    queryKey: ['dso', search],
    queryFn: () => catalogApi.search(search),
    placeholderData: keepPreviousData,
    enabled: !rigs.isPending && !waitForNight,
  });
  const data = list.data;
  const pages = pageCount(data?.total ?? 0);
  const fmt = useNumber();
  const fitsLabel =
    fov === null ? t('catalog.fitsFovNoRig') : t('catalog.fitsFov', { fov: `${fmt(fov, 0)}′` });

  // Aktive Filter aus „Weitere Filter“ als Chips (FilterBar, AP-26c); Suche, Typ und Katalog stehen in der Zeile.
  type ChipKey =
    'constellation' | 'magMax' | 'surfBrMax' | 'sizeMin' | 'sizeMax' | 'minAlt' | 'minHours';
  const valueChip = (key: ChipKey, label: string, value: string) =>
    filters[key]
      ? [
          {
            id: key,
            label: t('filterBar.chip', { label, value }),
            onRemove: () => update({ [key]: '' } as Partial<BrowserFilters>),
          },
        ]
      : [];
  const constellationName =
    IAU_CONSTELLATION_NAMES[filters.constellation as keyof typeof IAU_CONSTELLATION_NAMES];
  const chips = [
    ...valueChip(
      'constellation',
      t('catalog.constellation'),
      constellationName ? `${constellationName} (${filters.constellation})` : filters.constellation,
    ),
    ...valueChip('magMax', t('catalog.magMax'), `${filters.magMax} mag`),
    ...valueChip('surfBrMax', t('catalog.surfBrMax'), `${filters.surfBrMax} mag/″²`),
    ...valueChip('sizeMin', t('catalog.sizeMin'), `${filters.sizeMin}′`),
    ...valueChip('sizeMax', t('catalog.sizeMax'), `${filters.sizeMax}′`),
    ...valueChip('minAlt', t('catalog.minAlt'), `${filters.minAlt}°`),
    ...valueChip('minHours', t('catalog.minUsableHours'), `${filters.minHours} h`),
    ...(filters.fits
      ? [{ id: 'fits', label: fitsLabel, onRemove: () => update({ fits: false }) }]
      : []),
  ];

  return (
    <div className={styles.page}>
      <PageHeader title={t('catalog.title')} nav={<PlanningTabs />} />

      {/* Kontextleiste der Planung (gleich in der Sternkarte): Rig und Nacht sind Bezug, kein Filter. */}
      <PlanningContext
        rigs={rigOptions}
        rigId={rigId}
        onRigChange={(v) => update({ rig: v ?? '', night: '' })}
        site={site}
        siteGeo={siteGeo}
        night={night}
        today={nights.data?.currentNight ?? null}
        onNightChange={(v) => update({ night: v })}
        onTonight={() => update({ night: '' })}
        empty={
          rigs.isSuccess && rigList.length === 0 ? (
            <p className={styles.muted}>{t('catalog.noRig')}</p>
          ) : null
        }
      >
        {data?.night ? <NightInfo night={data.night} twilight={search.twilight} /> : null}
      </PlanningContext>

      {site && night ? (
        <section className={styles.moonDark} aria-label={t('moonDark.title')}>
          <SiteMoonDarkness site={site} night={night} current={nights.data?.currentNight ?? null} />
        </section>
      ) : null}

      <section className={styles.results} aria-labelledby={ids.results}>
        <div className={styles.resultHead}>
          <h2 id={ids.results} className={styles.resultTitle}>
            {data ? t('catalog.results', { count: data.total }) : t('catalog.title')}
          </h2>
          {data && data.total > 0 ? (
            <Pager page={filters.page} pages={pages} onPage={(page) => update({ page })} />
          ) : null}
        </div>
        <div className={styles.tabPanel}>
          <div className={styles.filterRow}>
            <p className={styles.muted}>
              {rated ? t('catalog.ratedHint') : t('catalog.bestNeedsRig')}
            </p>
            <FilterBar
              label={t('catalog.filters')}
              search={{
                value: text,
                onChange: setText,
                label: t('catalog.search'),
                placeholder: t('catalog.searchPlaceholder'),
                maxLength: 80,
                onSubmit: () => update({ q: text }),
              }}
              inline={
                <>
                  <Select
                    compact
                    id="catalog-group"
                    label={t('catalog.group')}
                    value={filters.group}
                    onChange={(v) => update({ group: v })}
                    options={[
                      ['', t('catalog.allGroups')],
                      ...DSO_TYPE_GROUPS.map((g) => [g, t(`catalog.groups.${g}`)] as const),
                    ]}
                  />
                  <Select
                    compact
                    id="catalog-catalog"
                    label={t('catalog.catalog')}
                    value={filters.catalog}
                    onChange={(v) => update({ catalog: v })}
                    options={[
                      ['', t('catalog.allCatalogs')],
                      ...dsoCatalogPrefixes.map((c) => [c, c] as const),
                    ]}
                  />
                </>
              }
              chips={chips}
              panelLabel={t('catalog.moreFilters')}
              panel={
                <>
                  <Select
                    id="catalog-constellation"
                    label={t('catalog.constellation')}
                    value={filters.constellation}
                    onChange={(v) => update({ constellation: v })}
                    options={[
                      ['', t('catalog.allConstellations')],
                      ...[...IAU_CONSTELLATIONS]
                        .sort((a, b) =>
                          IAU_CONSTELLATION_NAMES[a].localeCompare(IAU_CONSTELLATION_NAMES[b]),
                        )
                        .map((c) => [c, `${IAU_CONSTELLATION_NAMES[c]} (${c})`] as const),
                    ]}
                  />
                  <NumberInput
                    id="catalog-mag"
                    label={t('catalog.magMax')}
                    unit="mag"
                    value={filters.magMax}
                    onChange={(v) => update({ magMax: v })}
                  />
                  <NumberInput
                    id="catalog-sb"
                    label={t('catalog.surfBrMax')}
                    unit="mag/″²"
                    value={filters.surfBrMax}
                    onChange={(v) => update({ surfBrMax: v })}
                  />
                  <NumberInput
                    id="catalog-size-min"
                    label={t('catalog.sizeMin')}
                    unit="′"
                    value={filters.sizeMin}
                    onChange={(v) => update({ sizeMin: v })}
                  />
                  <NumberInput
                    id="catalog-size-max"
                    label={t('catalog.sizeMax')}
                    unit="′"
                    value={filters.sizeMax}
                    onChange={(v) => update({ sizeMax: v })}
                  />
                  {site ? (
                    <>
                      <NumberInput
                        id="catalog-min-alt"
                        label={t('catalog.minAlt')}
                        unit="°"
                        value={filters.minAlt}
                        placeholder={String(DEFAULT_MIN_ALT)}
                        onChange={(v) => update({ minAlt: v })}
                      />
                      <NumberInput
                        id="catalog-min-hours"
                        label={t('catalog.minUsableHours')}
                        unit="h"
                        value={filters.minHours}
                        onChange={(v) => update({ minHours: v })}
                      />
                    </>
                  ) : null}
                  <FilterCheck
                    label={fitsLabel}
                    checked={filters.fits}
                    disabled={fov === null}
                    onChange={(on) => update({ fits: on })}
                  />
                  <FilterCheck
                    label={t('catalog.candidatesOnly')}
                    checked={filters.candidates}
                    onChange={(on) => update({ candidates: on })}
                  />
                </>
              }
              onReset={() => {
                setText('');
                setParams(
                  paramsFromFilters({
                    ...filtersFromParams(new URLSearchParams()),
                    rig: rigId ?? '',
                    view: filters.view,
                  }),
                  { replace: true },
                );
              }}
              view={
                <>
                  {filters.view === 'gallery' ? (
                    <Select
                      compact
                      id="catalog-sort"
                      label={t('catalog.sort')}
                      value={sort}
                      onChange={(v) => update({ sort: v as Sort, dir: '' })}
                      options={SORTS.filter(
                        (s) =>
                          (s !== 'score' || rated) && (site !== null || !NIGHT_SORTS.includes(s)),
                      ).map((s) => [s, t(`catalog.sortBy.${s}`)] as const)}
                    />
                  ) : null}
                  <fieldset className={styles.viewToggle}>
                    <legend className={styles.srOnly}>{t('catalog.view')}</legend>
                    {(['list', 'gallery'] as const).map((v) => (
                      <label key={v} className={styles.check}>
                        <input
                          type="radio"
                          name="catalog-view"
                          checked={filters.view === v}
                          onChange={() => update({ view: v, page: filters.page })}
                        />
                        {v === 'list' ? t('catalog.viewList') : t('catalog.viewGallery')}
                      </label>
                    ))}
                  </fieldset>
                </>
              }
            />
          </div>

          {list.isPending || waitForNight ? (
            <p role="status" className={styles.state}>
              {site !== null ? t('catalog.loadingNight') : t('common.loading')}
            </p>
          ) : list.isError ? (
            <div className={styles.state}>
              <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className={`${styles.muted} ${styles.state}`}>{t('catalog.empty')}</p>
          ) : filters.view === 'gallery' ? (
            <div className={styles.state}>
              <Gallery
                items={data.items}
                minAlt={search.minAltDeg ?? DEFAULT_MIN_ALT}
                timeZone={data.night?.timeZone ?? null}
                rigId={rigId}
                rigFov={rig ? [rig.derived.fovWidthDeg, rig.derived.fovHeightDeg] : null}
                canCreate={canCreate}
              />
            </div>
          ) : (
            <ResultTable
              items={data.items}
              labelledBy={ids.results}
              minAlt={search.minAltDeg ?? DEFAULT_MIN_ALT}
              timeZone={data.night?.timeZone ?? null}
              rigId={rigId}
              rigFov={rig ? [rig.derived.fovWidthDeg, rig.derived.fovHeightDeg] : null}
              canCreate={canCreate}
              site={site}
              night={night}
              rated={rated}
              sort={{ by: sort, dir: filters.dir || NATURAL_DIR[sort] }}
              onSort={(next) => {
                // Dritter Klick (keine Sortierung) → Standard: Bewertung mit Rig, sonst Name.
                if (!next) return update({ sort: '', dir: '' });
                const fallback = effectiveSort('', { withNight: site !== null, rated });
                update({
                  sort: next.by === fallback ? '' : next.by,
                  dir: next.dir === NATURAL_DIR[next.by] ? '' : next.dir,
                });
              }}
            />
          )}
          {data ? (
            <p className={styles.source}>
              {t('catalog.source', {
                version: data.catalog.version,
                date: plainDate(data.catalog.fetchedAt, i18n.language),
              })}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

// ---- Bausteine der Seite --------------------------------------------------------------------------

function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.pager}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={t('catalog.prevPage')}
        title={t('catalog.prevPage')}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <uiIcons.previous size={ICON_SIZE.table} aria-hidden />
      </button>
      <span>{t('catalog.page', { page, pages })}</span>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={t('catalog.nextPage')}
        title={t('catalog.nextPage')}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <uiIcons.next size={ICON_SIZE.table} aria-hidden />
      </button>
    </div>
  );
}

function NightInfo({
  night,
  twilight,
}: {
  night: NonNullable<DsoList['night']>;
  twilight: string | undefined;
}) {
  const { t } = useTranslation();
  const time = (iso: string) =>
    `${formatZonedTime(iso, night.timeZone)} ${formatTzAbbr(iso, night.timeZone)}`;
  return (
    <p className={styles.nightInfo}>
      {night.darkStartUtc && night.darkEndUtc
        ? t('catalog.nightInfo', {
            from: time(night.darkStartUtc),
            to: time(night.darkEndUtc),
            pct: night.moonIllumPct ?? '–',
          })
        : t('catalog.noDarkness', { twilight: twilight ?? 'astronomical' })}
    </p>
  );
}

interface RowProps {
  readonly minAlt: number;
  readonly timeZone: string | null;
  readonly rigId: string | null;
  /** Bildfeld des Rigs (Grad) – Sichtfeld der Sternkarte. */
  readonly rigFov: readonly [number, number] | null;
  readonly canCreate: boolean;
  /** Standort des Rigs – Saisondiagramm je Objekt (AP-24); ohne Rig kein Diagramm. */
  readonly site?: SiteView | null;
  /** Nacht der Kontextleiste (`YYYY-MM-DD`) – Nachtdiagramm in der aufgeklappten Zeile (AP-26e). */
  readonly night?: string | null;
}

/** Mindestzeit des Saisondiagramms im Objektbrowser (ohne Projekt): 1 h am Stück, astronomische Dunkelheit. */
const BROWSER_SEASON = { minTimeOnTargetH: 1, twilight: 'astronomical' } as const;

function useCells({ minAlt, timeZone }: Pick<RowProps, 'minAlt' | 'timeZone'>) {
  const { t } = useTranslation();
  const fmt = useNumber();
  return {
    size: (o: DsoView) =>
      o.sizeMajorArcmin === null
        ? '–'
        : o.sizeMinorArcmin === null || o.sizeMinorArcmin === o.sizeMajorArcmin
          ? `${fmt(o.sizeMajorArcmin, 1)}′`
          : `${fmt(o.sizeMajorArcmin, 1)}′ × ${fmt(o.sizeMinorArcmin, 1)}′`,
    mag: (o: DsoView) => {
      const v = o.magBandUsed === 'V' ? o.magV : o.magBandUsed === 'B' ? o.magB : null;
      return v === null || o.magBandUsed === null ? (
        '–'
      ) : (
        <span title={t('catalog.bandTitle', { band: o.magBandUsed })}>
          {fmt(v, 1)} {o.magBandUsed}
        </span>
      );
    },
    surfBr: (o: DsoView) => (o.surfBrMagArcsec2 === null ? '–' : fmt(o.surfBrMagArcsec2, 1)),
    best: (o: DsoView) => {
      const n = o.night;
      if (!n || !timeZone) return '–';
      if (n.visibility === 'never') return t('catalog.neverVisible', { alt: minAlt });
      if (n.peakUtc === null || n.peakAltDeg === null) return t('catalog.notDark');
      return `${formatZonedTime(n.peakUtc, timeZone)} ${formatTzAbbr(n.peakUtc, timeZone)} · ${fmt(n.peakAltDeg, 0)}°`;
    },
    moon: (o: DsoView) =>
      !o.night || o.night.visibility === 'never'
        ? '–'
        : o.night.moonSepDeg === null
          ? t('catalog.moonDown')
          : t('catalog.moonSep', { deg: o.night.moonSepDeg }),
    usable: (o: DsoView) =>
      o.night ? t('catalog.hours', { h: fmt(o.night.usableHours, 1) }) : '–',
    score: (o: DsoView) =>
      o.night?.score === null || o.night?.score === undefined
        ? '–'
        : t('catalog.scoreValue', { score: Math.round(o.night.score * 100) }),
    filter: (o: DsoView) => (o.filterHint ? t(`catalog.filterHint.${o.filterHint}`) : '–'),
    group: (o: DsoView) => (
      <span title={t('catalog.typeCode', { code: o.objectType })}>
        {t(`catalog.groups.${o.group}`)}
      </span>
    ),
  };
}

/** Link zur Sternkarte mit Objekt, Rig und einem Sichtfeld, das Objekt und Bildfeld zeigt (S-20). */
const skyMapLink = (o: DsoView, rigId: string | null, rigFov: RowProps['rigFov']) =>
  skyMapHref({
    ra: o.raDeg,
    dec: o.decDeg,
    rig: rigId,
    object: o.primaryId,
    fov: fovForFrame(
      Math.max(rigFov?.[0] ?? 1, (o.sizeMajorArcmin ?? 0) / 60),
      Math.max(rigFov?.[1] ?? 1, (o.sizeMajorArcmin ?? 0) / 60),
    ),
  });

/**
 * Zeilenaktionen der Tabelle (Stilsystem AP-26d): *Sternkarte* und *Wikipedia* als Symbolknöpfe, dazu
 * *Projekt*. Das Saisondiagramm steht seit AP-26j als Reiter neben dem Höhendiagramm in der aufgeklappten Zeile.
 */
function RowActions({
  o,
  rigId,
  rigFov,
  canCreate,
}: { o: DsoView } & Omit<RowProps, 'minAlt' | 'timeZone' | 'site'>) {
  const { t } = useTranslation();
  const mapLabel = t('catalog.skyMapFor', { name: o.displayName });
  return (
    <div className={styles.rowActions}>
      <Link
        className={styles.iconButton}
        to={skyMapLink(o, rigId, rigFov)}
        aria-label={mapLabel}
        title={mapLabel}
      >
        <areaIcons.planning size={ICON_SIZE.table} aria-hidden />
      </Link>
      <WikipediaLink className={styles.iconButton} target={o} iconOnly />
      {canCreate ? (
        <Link
          className={styles.buttonSm}
          to={createProjectHref(o.primaryId, rigId)}
          aria-label={t('catalog.createProjectFor', { name: o.displayName })}
        >
          <actionIcons.add size={ICON_SIZE.table} aria-hidden />
          {t('catalog.projectShort')}
        </Link>
      ) : null}
    </div>
  );
}

/** Aktionen einer Galeriekarte: ausgeschrieben, die Karte hat Platz. */
function CardActions({
  o,
  rigId,
  rigFov,
  canCreate,
}: { o: DsoView } & Omit<RowProps, 'minAlt' | 'timeZone' | 'site'>) {
  const { t } = useTranslation();
  return (
    <div className={styles.rowActions}>
      {canCreate ? (
        <Link className={styles.buttonSm} to={createProjectHref(o.primaryId, rigId)}>
          <actionIcons.add size={ICON_SIZE.table} aria-hidden />
          {t('catalog.createProject')}
        </Link>
      ) : null}
      <Link className={styles.buttonSm} to={skyMapLink(o, rigId, rigFov)}>
        <areaIcons.planning size={ICON_SIZE.table} aria-hidden />
        {t('catalog.skyMap')}
      </Link>
      <WikipediaLink className={styles.buttonSm} target={o} />
    </div>
  );
}

/** Spalte → serverseitige Sortierung (AP-26a: Spaltenkopf statt Auswahlliste). */
const COLUMN_SORT: Readonly<Record<string, Sort>> = {
  object: 'name',
  mag: 'mag',
  size: 'size',
  best: 'altitude',
  usable: 'usable',
  score: 'score',
};

function ResultTable({
  items,
  labelledBy,
  sort,
  onSort,
  rated,
  ...row
}: {
  items: DsoView[];
  labelledBy: string;
  /** Aktuelle Sortierung des Servers. */
  sort: { by: Sort; dir: 'asc' | 'desc' };
  onSort: (next: { by: Sort; dir: 'asc' | 'desc' } | null) => void;
  /** Rig mit Standort und Bildfeld: Bewertung und Filterempfehlung als Spalten (FA-FRM-13). */
  rated: boolean;
} & RowProps) {
  const { t } = useTranslation();
  const cell = useCells(row);
  const night = items.some((o) => o.night !== null);
  const scored = rated && night;
  // Eine Tabelle (Wunsch Sven 27.09.2026): jede Spalte sortierbar, die der Server sortieren kann.
  const sortable = (id: string) =>
    id in COLUMN_SORT &&
    (night || !['best', 'usable', 'score'].includes(id)) &&
    (id !== 'score' || rated);
  const base: DataColumn<DsoView>[] = [
    {
      id: 'image',
      header: t('catalog.col.image'),
      headerHidden: true,
      // Immer sichtbar, auch in „Beste der Nacht“ (AP-26i); beim Überfahren das große Bild (AP-26h).
      priority: 1,
      cell: (o) => (
        <ThumbPreview
          preview={() => <CatalogImage primaryId={o.primaryId} name={o.displayName} size="large" />}
        >
          <CatalogImage
            primaryId={o.primaryId}
            name={o.displayName}
            size="small"
            className={styles.listThumb}
            fallback={<div className={styles.listThumbEmpty} aria-hidden />}
          />
        </ThumbPreview>
      ),
    },
    {
      id: 'object',
      header: t('catalog.col.object'),
      nowrap: true,
      cell: (o) => {
        const { common } = aliasesOf(o);
        return (
          <>
            <strong>{o.displayName}</strong>
            {common[0] ? <span className={styles.common}>{common[0]}</span> : null}
          </>
        );
      },
    },
    {
      id: 'aliases',
      header: t('catalog.col.aliases'),
      priority: 5,
      cell: (o) => {
        const { designations } = aliasesOf(o);
        return (
          <span title={designations.join(', ')}>
            {designations.slice(0, 3).join(', ')}
            {designations.length > 3 ? ' …' : ''}
          </span>
        );
      },
    },
    { id: 'type', header: t('catalog.col.type'), priority: 2, cell: (o) => cell.group(o) },
    {
      id: 'constellation',
      header: t('catalog.col.constellation'),
      priority: 3,
      cell: (o) => (
        <span
          title={
            o.constellation
              ? IAU_CONSTELLATION_NAMES[o.constellation as keyof typeof IAU_CONSTELLATION_NAMES]
              : undefined
          }
        >
          {o.constellation ?? '–'}
        </span>
      ),
    },
    {
      id: 'size',
      header: t('catalog.col.size'),
      align: 'end',
      nowrap: true,
      priority: 2,
      cell: (o) => cell.size(o),
    },
    {
      id: 'mag',
      header: t('catalog.col.mag'),
      align: 'end',
      nowrap: true,
      cell: (o) => cell.mag(o),
    },
    {
      id: 'surfBr',
      header: t('catalog.col.surfBr'),
      align: 'end',
      priority: 4,
      cell: (o) => cell.surfBr(o),
    },
    ...(scored
      ? ([
          {
            id: 'score',
            header: t('catalog.col.score'),
            align: 'end',
            nowrap: true,
            cell: (o) => cell.score(o),
          },
          {
            id: 'filter',
            header: t('catalog.col.filter'),
            nowrap: true,
            priority: 3,
            cell: (o) => cell.filter(o),
          },
        ] satisfies DataColumn<DsoView>[])
      : []),
    ...(night
      ? ([
          { id: 'best', header: t('catalog.col.best'), nowrap: true, cell: (o) => cell.best(o) },
          {
            id: 'moon',
            header: t('catalog.col.moon'),
            nowrap: true,
            priority: 3,
            cell: (o) => cell.moon(o),
          },
          {
            id: 'usable',
            header: t('catalog.col.usable'),
            align: 'end',
            nowrap: true,
            cell: (o) => cell.usable(o),
          },
        ] satisfies DataColumn<DsoView>[])
      : []),
    {
      id: 'actions',
      header: t('catalog.col.actions'),
      headerHidden: true,
      cell: (o) => (
        <RowActions o={o} rigId={row.rigId} rigFov={row.rigFov} canCreate={row.canCreate} />
      ),
    },
  ];
  const columns = base.map((c) => ({ ...c, sortable: sortable(c.id) }));
  const columnOf = (by: Sort) =>
    Object.entries(COLUMN_SORT).find(([, s]) => s === by)?.[0] ?? 'object';
  return (
    <>
      <div role="region" aria-labelledby={labelledBy}>
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(o) => o.id}
          rowLabel={(o) => o.displayName}
          label={t('catalog.title')}
          renderDetail={
            row.site && row.night
              ? (o) => (
                  <ObjectNight
                    o={o}
                    site={row.site as SiteView}
                    night={row.night as string}
                    minAlt={row.minAlt}
                  />
                )
              : undefined
          }
          serverSorted
          sort={{ id: columnOf(sort.by), dir: sort.dir }}
          onSortChange={(next) =>
            onSort(next ? { by: COLUMN_SORT[next.id] ?? 'name', dir: next.dir } : null)
          }
        />
      </div>
    </>
  );
}

/**
 * Nachtdiagramm eines Objekts in der aufgeklappten Zeile (AP-26e, Wunsch Sven 26.09.2026): Rig-Standort und
 * Nacht der Kontextleiste, Kennwerte daneben; Engine im Browser mit der Zonentabelle der Nacht (NT-02).
 */
function ObjectNight({
  o,
  site,
  night,
  minAlt,
}: {
  o: DsoView;
  site: SiteView;
  night: string;
  minAlt: number;
}) {
  const { t } = useTranslation();
  const nights = useQuery({
    queryKey: ['site-nights', site.id, 'from', night],
    queryFn: () => equipmentApi.nights(site.id, 2, night),
    staleTime: 60 * 60 * 1000,
  });
  const chart = useMemo(() => {
    if (!nights.data) return null;
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
          id: o.id,
          label: o.displayName,
          color: 'var(--npm-chart-curve)',
          target: { raJ2000Deg: o.raDeg, decJ2000Deg: o.decDeg },
        },
      ],
      minAltDeg: minAlt,
      twilight: 'astronomical',
      transitLabel: '',
    }).props;
  }, [nights.data, site, night, o, minAlt]);
  // Höhen- und Saisondiagramm als Reiter nebeneinander (AP-26j, Wunsch Sven 26.09.2026).
  const [tab, setTab] = useState<'altitude' | 'season'>('altitude');
  return (
    <div className={styles.objectNight}>
      <Tabs<'altitude' | 'season'>
        label={t('catalog.chartsOf', { name: o.displayName })}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'altitude', label: t('nightChart.tabs.altitude') },
          { key: 'season', label: t('nightChart.tabs.season') },
        ]}
        panelClassName={styles.objectNightPanel}
        panels={{
          altitude: (
            <>
              {chart ? (
                <NightChart {...chart} bands={false} facts height={220} />
              ) : (
                <NightChart
                  window={null}
                  timeZone={site.timeZone}
                  state={nights.isError ? 'error' : 'loading'}
                  onRetry={() => void nights.refetch()}
                />
              )}
              <span className={styles.muted}>{t('catalog.nightOf', { name: o.displayName })}</span>
            </>
          ),
          season: (
            <SeasonPanel
              site={site}
              target={{ raDeg: o.raDeg, decDeg: o.decDeg }}
              conditions={{ minAltitudeDeg: minAlt, ...BROWSER_SEASON }}
            />
          ),
        }}
      />
    </div>
  );
}

function Gallery({ items, ...row }: { items: DsoView[] } & RowProps) {
  const cell = useCells(row);
  const { t } = useTranslation();
  return (
    <ul className={styles.gallery}>
      {items.map((o) => (
        <li key={o.id} className={styles.card}>
          <CatalogImage
            primaryId={o.primaryId}
            name={o.displayName}
            size="large"
            className={styles.thumb}
            fallback={<div className={styles.thumbEmpty} aria-hidden />}
          />
          <div className={styles.cardBody}>
            <strong>{o.displayName}</strong>
            {aliasesOf(o).common[0] ? (
              <span className={styles.common}>{aliasesOf(o).common[0]}</span>
            ) : null}
            <span className={styles.muted}>
              {cell.group(o)} · {o.constellation ?? '–'} · {cell.size(o)} · {cell.mag(o)}
            </span>
            {o.night ? (
              <span className={styles.muted}>
                {t('catalog.col.usable')}: {cell.usable(o)} · {cell.best(o)}
              </span>
            ) : null}
          </div>
          <CardActions o={o} rigId={row.rigId} rigFov={row.rigFov} canCreate={row.canCreate} />
        </li>
      ))}
    </ul>
  );
}
