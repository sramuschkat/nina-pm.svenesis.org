/**
 * S-21 Objektbrowser (FK 14.3; FA-FRM-01, FA-FRM-15; AP-20): Katalogliste aus OpenNGC mit Filter nach
 * Katalog, Anzeigegruppe, Sternbild, Helligkeit (Band angezeigt), Flächenhelligkeit, Größe und „passt
 * ins Bildfeld“ des Rigs; mit Rig zusätzlich Nacht (◀ ▶, *Heute Nacht*), Mindesthöhe und min. nutzbare
 * Stunden – die Nachtwerte (beste Zeit/Höhe, Mond, nutzbare Stunden) rechnet die API mit der Engine.
 * Umschalter Liste/Galerie, Aktionen *Projekt anlegen* und *Sternkarte* (S-20, AP-21); Reiter
 * *Alle Objekte* / *Beste der Nacht* (FA-FRM-13, Bewertung der Website, AP-21).
 */
import { daysFromKey, keyFromDays } from '@nina-pm/engine';
import {
  DSO_TYPE_GROUPS,
  IAU_CONSTELLATION_NAMES,
  IAU_CONSTELLATIONS,
  dsoCatalogPrefixes,
  formatNightKey,
  formatTzAbbr,
  formatZonedTime,
} from '@nina-pm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { catalogApi, equipmentApi, type DsoList, type DsoView } from '../../api/client';
import { useCan } from '../../auth';
import { CatalogImage } from './CatalogImage';
import { PlanningTabs } from '../planning/PlanningTabs';
import { fovForFrame, skyMapHref } from '../planning/skymap/model';
import { ICON_SIZE, uiIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import { RigSelect, type RigOption } from '../../components/RigSelect';
import { problemCode } from '../admin/shared';
import { useEquipmentList, useNumber } from '../equipment/shared';
import {
  aliasesOf,
  CATALOG_PATH,
  DEFAULT_MIN_ALT,
  filtersFromParams,
  fovArcmin,
  NIGHT_SORTS,
  pageCount,
  paramsFromFilters,
  searchFromFilters,
  SORTS,
  type BrowserFilters,
} from './model';
import styles from './catalog.module.css';

const shiftNight = (night: string, days: number) => keyFromDays(daysFromKey(night) + days);

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
  const ids = { form: useId(), results: useId() };
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

  // Beste der Nacht braucht Standort und Bildfeld des Rigs (FA-FRM-13).
  const best =
    filters.tab === 'best'
      ? { hint: site && fov !== null ? t('catalog.bestHint') : t('catalog.bestNeedsRig') }
      : null;
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

  return (
    <div className={styles.page}>
      <PlanningTabs />
      <nav aria-label={t('catalog.crumbs')} className={styles.muted}>
        {t('catalog.crumbs')}
      </nav>
      <div className={styles.head}>
        <h1>{t('catalog.title')}</h1>
      </div>

      <div role="tablist" aria-label={t('catalog.tabsLabel')} className={styles.tabs}>
        {(['all', 'best'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={filters.tab === tab}
            className={filters.tab === tab ? styles.tabActive : styles.tab}
            onClick={() => update({ tab })}
          >
            {t(`catalog.tab.${tab}`)}
          </button>
        ))}
      </div>
      {best ? <p className={styles.muted}>{best.hint}</p> : null}

      <form
        className={styles.filters}
        aria-labelledby={ids.form}
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: text });
        }}
      >
        <h2 id={ids.form} className={styles.srOnly}>
          {t('catalog.filters')}
        </h2>
        <div className={`${styles.field} ${styles.searchField}`}>
          <label htmlFor="catalog-q">{t('catalog.search')}</label>
          <input
            id="catalog-q"
            type="search"
            className={styles.input}
            value={text}
            placeholder={t('catalog.searchPlaceholder')}
            maxLength={80}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {filters.tab === 'best' ? (
          <Select
            id="catalog-family"
            label={t('catalog.family')}
            value={filters.family}
            onChange={(v) => update({ family: v as BrowserFilters['family'] })}
            options={[
              ['', t('catalog.allFamilies')],
              ...(['galaxies', 'nebulae', 'clusters'] as const).map(
                (f) => [f, t(`catalog.families.${f}`)] as const,
              ),
            ]}
          />
        ) : (
          <Select
            id="catalog-group"
            label={t('catalog.group')}
            value={filters.group}
            onChange={(v) => update({ group: v })}
            options={[
              ['', t('catalog.allGroups')],
              ...DSO_TYPE_GROUPS.map((g) => [g, t(`catalog.groups.${g}`)] as const),
            ]}
          />
        )}
        <Select
          id="catalog-catalog"
          label={t('catalog.catalog')}
          value={filters.catalog}
          onChange={(v) => update({ catalog: v })}
          options={[
            ['', t('catalog.allCatalogs')],
            ...dsoCatalogPrefixes.map((c) => [c, c] as const),
          ]}
        />
        <Select
          id="catalog-constellation"
          label={t('catalog.constellation')}
          value={filters.constellation}
          onChange={(v) => update({ constellation: v })}
          options={[
            ['', t('catalog.allConstellations')],
            ...[...IAU_CONSTELLATIONS]
              .sort((a, b) => IAU_CONSTELLATION_NAMES[a].localeCompare(IAU_CONSTELLATION_NAMES[b]))
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
      </form>

      <div className={styles.filters}>
        <div className={`${styles.field} ${styles.rigField}`}>
          <span className={styles.label}>{t('catalog.rig')}</span>
          <RigSelect
            rigs={rigOptions}
            value={rigId}
            onChange={(v) => update({ rig: v ?? '', night: '' })}
            label={t('catalog.rig')}
          />
        </div>
        {site ? (
          <>
            <div className={styles.nightNav}>
              <button
                type="button"
                className={styles.button}
                aria-label={t('catalog.prevNight')}
                title={t('catalog.prevNight')}
                disabled={!night}
                onClick={() => night && update({ night: shiftNight(night, -1) })}
              >
                <uiIcons.previous size={ICON_SIZE.button} aria-hidden />
              </button>
              <strong aria-live="polite">
                {night ? t('catalog.nightValue', { night: formatNightKey(night) }) : '–'}
              </strong>
              <button
                type="button"
                className={styles.button}
                aria-label={t('catalog.nextNight')}
                title={t('catalog.nextNight')}
                disabled={!night}
                onClick={() => night && update({ night: shiftNight(night, 1) })}
              >
                <uiIcons.next size={ICON_SIZE.button} aria-hidden />
              </button>
              <button type="button" className={styles.button} onClick={() => update({ night: '' })}>
                {t('catalog.tonight')}
              </button>
            </div>
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
        ) : rigs.isSuccess && rigList.length === 0 ? (
          <p className={styles.muted}>{t('catalog.noRig')}</p>
        ) : null}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={filters.fits}
            disabled={fov === null}
            onChange={(e) => update({ fits: e.target.checked })}
          />
          {fov === null
            ? t('catalog.fitsFovNoRig')
            : t('catalog.fitsFov', { fov: `${fmt(fov, 0)}′` })}
        </label>
        {filters.tab === 'all' ? (
          <Select
            id="catalog-sort"
            label={t('catalog.sort')}
            value={filters.sort}
            onChange={(v) => update({ sort: v as BrowserFilters['sort'] })}
            options={SORTS.filter((s) => site !== null || !NIGHT_SORTS.includes(s)).map(
              (s) => [s, t(`catalog.sortBy.${s}`)] as const,
            )}
          />
        ) : null}
        <fieldset className={styles.viewToggle}>
          <legend className={styles.label}>{t('catalog.view')}</legend>
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
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setText('');
            setParams(new URLSearchParams(rigId ? { rig: rigId } : {}), { replace: true });
          }}
        >
          {t('catalog.reset')}
        </button>
      </div>

      {data?.night ? <NightInfo night={data.night} twilight={search.twilight} /> : null}

      <section className={styles.panel} aria-labelledby={ids.results}>
        <div className={styles.resultHead}>
          <h2 id={ids.results} className={styles.muted}>
            {data ? t('catalog.results', { count: data.total }) : t('catalog.title')}
          </h2>
          {data && data.total > 0 ? (
            <Pager page={filters.page} pages={pages} onPage={(page) => update({ page })} />
          ) : null}
        </div>
        {list.isPending || waitForNight ? (
          <p role="status">{site !== null ? t('catalog.loadingNight') : t('common.loading')}</p>
        ) : list.isError ? (
          <ProblemMessage code={problemCode(list.error)} onRetry={() => void list.refetch()} />
        ) : !data || data.items.length === 0 ? (
          <p className={styles.muted}>{t('catalog.empty')}</p>
        ) : filters.view === 'gallery' ? (
          <Gallery
            items={data.items}
            minAlt={search.minAltDeg ?? DEFAULT_MIN_ALT}
            timeZone={data.night?.timeZone ?? null}
            rigId={rigId}
            rigFov={rig ? [rig.derived.fovWidthDeg, rig.derived.fovHeightDeg] : null}
            canCreate={canCreate}
          />
        ) : (
          <ResultTable
            items={data.items}
            labelledBy={ids.results}
            minAlt={search.minAltDeg ?? DEFAULT_MIN_ALT}
            timeZone={data.night?.timeZone ?? null}
            rigId={rigId}
            rigFov={rig ? [rig.derived.fovWidthDeg, rig.derived.fovHeightDeg] : null}
            canCreate={canCreate}
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
      </section>
    </div>
  );
}

// ---- Bausteine der Seite --------------------------------------------------------------------------

function Select({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Zahl als Text (leer = kein Filter); übernommen beim Verlassen des Felds oder mit Enter. */
function NumberInput({
  id,
  label,
  unit,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onChange(draft.trim());
  };
  return (
    <div className={`${styles.field} ${styles.numberField}`}>
      <label htmlFor={id}>
        {label} <span className={styles.muted}>({unit})</span>
      </label>
      <input
        id={id}
        className={styles.input}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}

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
        className={styles.button}
        aria-label={t('catalog.prevPage')}
        title={t('catalog.prevPage')}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <uiIcons.previous size={ICON_SIZE.button} aria-hidden />
      </button>
      <span>{t('catalog.page', { page, pages })}</span>
      <button
        type="button"
        className={styles.button}
        aria-label={t('catalog.nextPage')}
        title={t('catalog.nextPage')}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <uiIcons.next size={ICON_SIZE.button} aria-hidden />
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
}

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

function Actions({
  o,
  rigId,
  rigFov,
  canCreate,
}: { o: DsoView } & Omit<RowProps, 'minAlt' | 'timeZone'>) {
  const { t } = useTranslation();
  return (
    <div className={styles.rowActions}>
      {canCreate ? (
        <Link className={styles.button} to={createProjectHref(o.primaryId, rigId)}>
          {t('catalog.createProject')}
        </Link>
      ) : null}
      <Link
        className={styles.button}
        to={skyMapHref({
          ra: o.raDeg,
          dec: o.decDeg,
          rig: rigId,
          object: o.primaryId,
          fov: fovForFrame(
            Math.max(rigFov?.[0] ?? 1, (o.sizeMajorArcmin ?? 0) / 60),
            Math.max(rigFov?.[1] ?? 1, (o.sizeMajorArcmin ?? 0) / 60),
          ),
        })}
      >
        {t('catalog.skyMap')}
      </Link>
    </div>
  );
}

function ResultTable({
  items,
  labelledBy,
  ...row
}: { items: DsoView[]; labelledBy: string } & RowProps) {
  const { t } = useTranslation();
  const cell = useCells(row);
  const night = items.some((o) => o.night !== null);
  const scored = items.some((o) => o.night?.score !== null && o.night?.score !== undefined);
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-labelledby={labelledBy}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.hideNarrow}>
              {t('catalog.col.image')}
            </th>
            <th scope="col">{t('catalog.col.object')}</th>
            <th scope="col" className={styles.hideNarrow}>
              {t('catalog.col.aliases')}
            </th>
            <th scope="col">{t('catalog.col.type')}</th>
            <th scope="col">{t('catalog.col.constellation')}</th>
            <th scope="col" className={styles.num}>
              {t('catalog.col.size')}
            </th>
            <th scope="col" className={styles.num}>
              {t('catalog.col.mag')}
            </th>
            <th scope="col" className={`${styles.num} ${styles.hideNarrow}`}>
              {t('catalog.col.surfBr')}
            </th>
            {scored ? (
              <>
                <th scope="col" className={styles.num}>
                  {t('catalog.col.score')}
                </th>
                <th scope="col">{t('catalog.col.filter')}</th>
              </>
            ) : null}
            {night ? (
              <>
                <th scope="col">{t('catalog.col.best')}</th>
                <th scope="col" className={styles.hideNarrow}>
                  {t('catalog.col.moon')}
                </th>
                <th scope="col" className={styles.num}>
                  {t('catalog.col.usable')}
                </th>
              </>
            ) : null}
            <th scope="col">{t('catalog.col.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => {
            const { designations, common } = aliasesOf(o);
            return (
              <tr key={o.id}>
                <td className={styles.hideNarrow}>
                  <CatalogImage
                    primaryId={o.primaryId}
                    name={o.displayName}
                    size="small"
                    className={styles.listThumb}
                    fallback={<div className={styles.listThumbEmpty} aria-hidden />}
                  />
                </td>
                <td>
                  <strong>{o.displayName}</strong>
                  {common[0] ? <span className={styles.common}>{common[0]}</span> : null}
                </td>
                <td className={styles.hideNarrow} title={designations.join(', ')}>
                  {designations.slice(0, 3).join(', ')}
                  {designations.length > 3 ? ' …' : ''}
                </td>
                <td>{cell.group(o)}</td>
                <td
                  title={
                    o.constellation
                      ? IAU_CONSTELLATION_NAMES[
                          o.constellation as keyof typeof IAU_CONSTELLATION_NAMES
                        ]
                      : undefined
                  }
                >
                  {o.constellation ?? '–'}
                </td>
                <td className={`${styles.num} ${styles.nowrap}`}>{cell.size(o)}</td>
                <td className={`${styles.num} ${styles.nowrap}`}>{cell.mag(o)}</td>
                <td className={`${styles.num} ${styles.hideNarrow}`}>{cell.surfBr(o)}</td>
                {scored ? (
                  <>
                    <td className={`${styles.num} ${styles.nowrap}`}>{cell.score(o)}</td>
                    <td className={styles.nowrap}>{cell.filter(o)}</td>
                  </>
                ) : null}
                {night ? (
                  <>
                    <td className={styles.nowrap}>{cell.best(o)}</td>
                    <td className={`${styles.hideNarrow} ${styles.nowrap}`}>{cell.moon(o)}</td>
                    <td className={`${styles.num} ${styles.nowrap}`}>{cell.usable(o)}</td>
                  </>
                ) : null}
                <td>
                  <Actions o={o} rigId={row.rigId} rigFov={row.rigFov} canCreate={row.canCreate} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
          <Actions o={o} rigId={row.rigId} rigFov={row.rigFov} canCreate={row.canCreate} />
        </li>
      ))}
    </ul>
  );
}
