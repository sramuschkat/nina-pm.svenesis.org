/**
 * S-23 Rechner (AP-61, FK 2.4, Spec-Ergänzung 01.10.2026 in `docs/specs/engine/calculator.md`): links die
 * Ausrüstung – Rig und Filter wählen, alle Kennwerte vorbelegt und frei änderbar, *Aus Rig zurücksetzen* –, rechts
 * drei Reiter: *Belichtung* (kürzeste Einzelbelichtung, Effizienz je Belichtungszeit), *Sampling* (Maßstab,
 * FWHM in Pixeln, Bildfeld je Binning) und *Exoplanet-Stern* (dieselbe Empfehlung wie die Karte in S-22). Reiter,
 * Rig, Filter und Band stehen in der URL; S-22 öffnet den Exoplanet-Reiter mit den Werten des Transits.
 */
import { DEFAULT_BANDWIDTH_NM, DEFAULT_FILTER_TRANSMISSION_PCT } from '@nina-pm/engine';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { RigSelect, type RigOption } from '../../components/RigSelect';
import { Tabs } from '../../components/Tabs';
import { NumberInput, Select } from '../catalog/fields';
import { useEquipmentList, useNumber } from '../equipment/shared';
import { ExposureCard } from '../exo/ExposureCard';
import { PlanningTabs } from '../planning/PlanningTabs';
import {
  bandFor,
  CALC_BANDS,
  computeExo,
  computeExposure,
  computeSampling,
  EQUIPMENT_FIELDS,
  paramsFromUrl,
  rigDefaults,
  UNITS,
  urlFromParams,
  type Calc,
  type CalcTab,
  type CalcUrl,
  type FieldKey,
  type Fields,
} from './model';
import styles from './calculator.module.css';

export { CALC_PATH } from './model';

const GROUPS: readonly (readonly [string, readonly FieldKey[]])[] = [
  ['optics', ['apertureMm', 'obstructionPct', 'focalLengthMm']],
  [
    'camera',
    ['pixelSizeUm', 'widthPx', 'heightPx', 'readNoiseE', 'saturationE', 'qePct', 'darkES'],
  ],
  ['filter', ['bandwidthNm', 'transmissionPct']],
  ['sky', ['skyMag', 'elevationM', 'downloadS']],
];

export function CalculatorPage() {
  const { t } = useTranslation();
  const fmt = useNumber();
  const id = useId();
  const [params, setParams] = useSearchParams();
  const url = useMemo(() => urlFromParams(params), [params]);
  const setUrl = (patch: Partial<CalcUrl>) =>
    setParams(paramsFromUrl({ ...url, ...patch }), { replace: true });

  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const filters = useEquipmentList('filters');
  const rigList = rigs.data ?? [];
  const rigId =
    (rigList.some((r) => r.id === url.rig) ? url.rig : null) ??
    rigList.find((r) => r.showInPlanning)?.id ??
    rigList[0]?.id ??
    null;
  const rig = rigList.find((r) => r.id === rigId) ?? null;
  const site = (sites.data ?? []).find((s) => s.id === rig?.siteId) ?? null;
  const telescope = (telescopes.data ?? []).find((x) => x.id === rig?.telescopeId) ?? null;
  const camera = (cameras.data ?? []).find((x) => x.id === rig?.cameraId) ?? null;
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

  // Filter des Filterrads (Reihenfolge der Plätze), ohne Belegung alle Filter des Mandanten.
  const allFilters = filters.data ?? [];
  const wheel = (rig?.filterWheel ?? [])
    .map((s) => allFilters.find((f) => f.id === s.filterId))
    .filter((f): f is NonNullable<typeof f> => f !== undefined);
  const filterList = wheel.length > 0 ? wheel : allFilters;
  const filter =
    filterList.find((f) => f.id === url.filter) ??
    allFilters.find((f) => f.id === url.filter) ??
    filterList[0] ??
    null;
  const band = url.band ?? bandFor(filter);

  const defaults = useMemo(
    () => rigDefaults({ rig, site, telescope, camera, filter }),
    [rig, site, telescope, camera, filter],
  );
  // Eigene Werte; Ziel-Felder (Exoplanet-Stern) kommen beim Öffnen aus der URL.
  const [overrides, setOverrides] = useState<Partial<Record<FieldKey, string>>>(() => url.target);
  const equipmentKey = `${rig?.id ?? ''}|${filter?.id ?? ''}`;
  const [seenKey, setSeenKey] = useState(equipmentKey);
  useEffect(() => {
    if (equipmentKey === seenKey) return;
    setSeenKey(equipmentKey);
    // Anderes Rig bzw. anderer Filter: Ausrüstung wieder aus dem Rig, Reiter-Werte bleiben.
    setOverrides((o) =>
      Object.fromEntries(
        Object.entries(o).filter(([k]) => !(EQUIPMENT_FIELDS as readonly string[]).includes(k)),
      ),
    );
  }, [equipmentKey, seenKey]);
  const values: Fields = { ...defaults, ...overrides };
  const changed = EQUIPMENT_FIELDS.some(
    (k) => overrides[k] !== undefined && overrides[k] !== defaults[k],
  );
  const setField = (k: FieldKey) => (v: string) => setOverrides((o) => ({ ...o, [k]: v }));
  const resetEquipment = () =>
    setOverrides((o) =>
      Object.fromEntries(
        Object.entries(o).filter(([k]) => !(EQUIPMENT_FIELDS as readonly string[]).includes(k)),
      ),
    );

  const placeholder: Partial<Record<FieldKey, string>> = {
    bandwidthNm: String(DEFAULT_BANDWIDTH_NM[band]),
    transmissionPct: String(DEFAULT_FILTER_TRANSMISSION_PCT),
    obstructionPct: '0',
    darkES: '0',
  };
  const field = (k: FieldKey) => (
    <NumberInput
      key={k}
      id={`${id}-${k}`}
      label={t(`calc.field.${k}`)}
      unit={UNITS[k]}
      value={values[k]}
      placeholder={placeholder[k]}
      onChange={setField(k)}
    />
  );
  const labels = (keys: readonly FieldKey[]) => keys.map((k) => t(`calc.field.${k}`)).join(', ');
  function notOk<T>(c: Calc<T>) {
    if (c.status === 'ok') return null;
    return (
      <p className={styles.missing} role="status">
        {c.status === 'missing'
          ? t('calc.missing', { list: labels(c.missing) })
          : t('calc.invalid', { list: labels(c.invalid) })}
      </p>
    );
  }

  const bortle = site?.bortleClass ?? null;
  const bandLabel = t(`calc.bandName.${band}`);

  // ---- Reiter Belichtung ------------------------------------------------------------------------
  const exposure = computeExposure(values, band);
  const exposurePanel = (
    <div className={styles.panelBody}>
      <p className={styles.muted}>{t('calc.exposure.intro')}</p>
      <div className={styles.inputs}>{field('swampFactor')}</div>
      {exposure.status === 'ok' ? (
        <>
          <div className={styles.headline}>
            <span className={styles.headlineLabel}>{t('calc.exposure.minSub')}</span>
            <span className={styles.headlineValue}>
              {fmt(exposure.value.minSubS, exposure.value.minSubS < 10 ? 1 : 0)} s
            </span>
          </div>
          <p className={styles.muted}>
            {t('calc.exposure.minSubHint', {
              factor: values.swampFactor,
              e: fmt(exposure.value.targetBackgroundE, 0),
            })}
          </p>
          <p className={styles.muted}>
            {t('calc.exposure.background', {
              sky: fmt(exposure.value.skyES, 3),
              mag: fmt(exposure.value.skyMagArcsec2, 2),
              band: bandLabel,
              dark: fmt(exposure.value.darkES, 4),
              scale: fmt(exposure.value.scaleArcsecPx, 2),
            })}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>{t('calc.exposure.table')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('calc.exposure.col.exposure')}</th>
                  <th scope="col" className={styles.num}>
                    {t('calc.exposure.col.background')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('calc.exposure.col.efficiency')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('calc.exposure.col.noise')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('calc.exposure.col.saturation')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {exposure.value.rows.map((r) => (
                  <tr key={r.exposureS} className={r.recommended ? styles.recommended : undefined}>
                    <th scope="row">
                      {fmt(r.exposureS, r.exposureS < 10 ? 1 : 0)} s
                      {r.recommended ? (
                        <span className={styles.badge}>{t('calc.exposure.recommended')}</span>
                      ) : null}
                    </th>
                    <td className={styles.num}>{fmt(r.backgroundE, 0)} e⁻</td>
                    <td className={styles.num}>{fmt(r.efficiencyPct, 1)} %</td>
                    <td className={styles.num}>+{fmt(r.noiseIncreasePct, 1)} %</td>
                    <td className={styles.num}>
                      {r.saturationPct === null ? '–' : `${fmt(r.saturationPct, 1)} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>{t('calc.exposure.explain')}</p>
        </>
      ) : (
        notOk(exposure)
      )}
    </div>
  );

  // ---- Reiter Sampling --------------------------------------------------------------------------
  const samp = computeSampling(values);
  const samplingPanel = (
    <div className={styles.panelBody}>
      <p className={styles.muted}>{t('calc.sampling.intro')}</p>
      <div className={styles.inputs}>{field('seeingArcsec')}</div>
      {samp.status === 'ok' ? (
        <>
          <div className={styles.headline}>
            <span className={styles.headlineLabel}>{t('calc.sampling.recommended')}</span>
            <span className={styles.headlineValue}>
              {t('calc.sampling.binValue', { bin: samp.value.recommendedBinning })}
            </span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>{t('calc.sampling.table')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('calc.sampling.col.binning')}</th>
                  <th scope="col" className={styles.num}>
                    {t('calc.sampling.col.scale')}
                  </th>
                  <th scope="col" className={styles.num}>
                    {t('calc.sampling.col.fwhm')}
                  </th>
                  <th scope="col">{t('calc.sampling.col.grade')}</th>
                  <th scope="col" className={styles.num}>
                    {t('calc.sampling.col.fov')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {samp.value.rows.map((r) => (
                  <tr
                    key={r.binning}
                    className={
                      r.binning === samp.value.recommendedBinning ? styles.recommended : undefined
                    }
                  >
                    <th scope="row">{t('calc.sampling.binValue', { bin: r.binning })}</th>
                    <td className={styles.num}>{fmt(r.scaleArcsecPx, 2)}″/px</td>
                    <td className={styles.num}>{fmt(r.fwhmPx, 1)} px</td>
                    <td>
                      <span className={styles[`grade_${r.grade}`]}>
                        {t(`calc.sampling.grade.${r.grade}`)}
                      </span>
                    </td>
                    <td className={styles.num}>
                      {r.fovWidthArcmin === null || r.fovHeightArcmin === null
                        ? '–'
                        : t('calc.sampling.fovValue', {
                            w: fmt(r.fovWidthArcmin, 1),
                            h: fmt(r.fovHeightArcmin, 1),
                          })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>{t('calc.sampling.explain')}</p>
        </>
      ) : (
        notOk(samp)
      )}
    </div>
  );

  // ---- Reiter Exoplanet-Stern -------------------------------------------------------------------
  const exo = computeExo(values, {
    band,
    filterShortName: filter?.shortName ?? bandLabel,
    gain: camera?.defaultGain ?? null,
    bortle,
  });
  const star = url.star || t('calc.exo.starUnknown');
  const exoPanel = (
    <div className={styles.panelBody}>
      <p className={styles.muted}>
        {url.star ? t('calc.exo.fromSearch', { star: url.star }) : t('calc.exo.intro')}
      </p>
      <div className={styles.inputs}>
        {(
          [
            'mag',
            'depthMmag',
            'durationH',
            'rpOverRs',
            'windowH',
            'altMaxDeg',
            'altMidDeg',
          ] as const
        ).map(field)}
      </div>
      {exo.status === 'ok' ? <ExposureCard exposure={exo.value} star={star} /> : notOk(exo)}
    </div>
  );

  return (
    <div className={styles.page}>
      <PageHeader title={t('calc.title')} nav={<PlanningTabs />} />
      <div className={styles.layout}>
        <section className={styles.equipment} aria-labelledby={`${id}-equipment`}>
          <div className={styles.equipmentHead}>
            <h2 id={`${id}-equipment`} className={styles.heading}>
              {t('calc.equipment')}
            </h2>
            <button
              type="button"
              className={styles.reset}
              onClick={resetEquipment}
              disabled={!changed}
            >
              {t('calc.reset')}
            </button>
          </div>
          <p className={styles.muted}>{t('calc.equipmentHint')}</p>
          {rigs.isSuccess && rigList.length === 0 ? (
            <p className={styles.muted}>{t('calc.noRig')}</p>
          ) : (
            <RigSelect
              rigs={rigOptions}
              value={rigId}
              onChange={(v) => setUrl({ rig: v ?? '', filter: '', band: null })}
              label={t('calc.rig')}
            />
          )}
          <div className={styles.inputs}>
            <Select
              id={`${id}-filter`}
              label={t('calc.filter')}
              value={filter?.id ?? ''}
              options={
                filterList.length === 0
                  ? [['', t('calc.filterNone')]]
                  : filterList.map((f) => [f.id, f.shortName] as const)
              }
              onChange={(v) => setUrl({ filter: v, band: null })}
              colors={Object.fromEntries(filterList.map((f) => [f.id, f.colorHex]))}
            />
            <Select
              id={`${id}-band`}
              label={t('calc.band')}
              value={band}
              options={CALC_BANDS.map((b) => [b, t(`calc.bandName.${b}`)] as const)}
              onChange={(v) =>
                setUrl({ band: v === bandFor(filter) ? null : (v as CalcUrl['band']) })
              }
            />
          </div>
          {GROUPS.map(([group, keys]) => (
            <fieldset key={group} className={styles.group}>
              <legend className={styles.legend}>{t(`calc.group.${group}`)}</legend>
              <div className={styles.inputs}>{keys.map(field)}</div>
              {group === 'sky' ? (
                <p className={styles.muted}>
                  {bortle === null
                    ? t('calc.skyHintDefault')
                    : t('calc.skyHint', { bortle: fmt(bortle, 0) })}
                </p>
              ) : null}
            </fieldset>
          ))}
        </section>

        <section className={styles.results} aria-label={t('calc.resultsLabel')}>
          <Tabs<CalcTab>
            label={t('calc.tabsLabel')}
            value={url.tab}
            onChange={(tab) => setUrl({ tab })}
            tabs={[
              { key: 'exposure', label: t('calc.tab.exposure') },
              { key: 'sampling', label: t('calc.tab.sampling') },
              { key: 'exo', label: t('calc.tab.exo') },
            ]}
            panels={{ exposure: exposurePanel, sampling: samplingPanel, exo: exoPanel }}
          />
        </section>
      </div>
    </div>
  );
}
