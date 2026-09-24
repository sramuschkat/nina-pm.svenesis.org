/**
 * S-10 Rigs (FA-RIG-01…14, FA-SCH-01…10/17; FK 14.3): Kopf mit Rig-Auswahl, Name, Notizen und
 * Schaltern, darunter drei Spalten Standort / Teleskop / Kamera mit Kennwerten, abgeleitete Kennzahlen,
 * Scheduler-Einstellungen (Sortierkette per Ziehen, Flip, Flats, Overheads) und die Filterradbelegung
 * mit Zuordnung zu NINA. Gespeichert wird mit `If-Match` (`settingsVersion`, 412 bei parallelem
 * Speichern). Übernahmestatus in NINA und zugeordnete Instanzen folgen mit AP-14.
 */
import {
  flatsSources,
  imageScale,
  playbackModes,
  RigInput,
  SchedulerSettings,
  strategies,
  telescopeDerived,
} from '@nina-pm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { equipmentApi, type RigView } from '../../api/client';
import { ApiError, useCan } from '../../auth';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { ProblemMessage } from '../../components/ProblemMessage';
import styles from './equipment.module.css';
import {
  CheckField,
  DeleteDialog,
  EQUIPMENT_PATHS,
  EquipmentLayout,
  equipmentKey,
  FormActions,
  NumberField,
  problemCode,
  SelectField,
  serverFieldErrors,
  TextField,
  UsageNotice,
  useDeleteWithUsage,
  useEquipmentList,
  useEquipmentMutations,
  useFieldError,
  useNumber,
  validate,
  type FieldErrors,
} from './shared';
import { FilterWheelSection } from './FilterWheelSection';
import { SortChainEditor } from './SortChainEditor';

interface RigDraft {
  name: string;
  siteId: string;
  telescopeId: string;
  cameraId: string;
  showInPlanning: boolean;
  ninaDeliveryEnabled: boolean;
  defaultTemplateId: string | null;
  defaultRotationDeg: number | null;
  hasRotator: boolean;
  rotationToleranceDeg: number | null;
  skipOnRotationMismatch: boolean;
  sessionReportDiscord: boolean;
  notes: string;
}

type Scheduler = RigView['scheduler'];

const rigDraft = (r: RigView): RigDraft => ({
  name: r.name,
  siteId: r.siteId,
  telescopeId: r.telescopeId,
  cameraId: r.cameraId,
  showInPlanning: r.showInPlanning,
  ninaDeliveryEnabled: r.ninaDeliveryEnabled,
  defaultTemplateId: r.defaultTemplateId,
  defaultRotationDeg: r.defaultRotationDeg,
  hasRotator: r.hasRotator,
  rotationToleranceDeg: r.rotationToleranceDeg,
  skipOnRotationMismatch: r.skipOnRotationMismatch,
  sessionReportDiscord: r.sessionReportDiscord,
  notes: r.notes,
});

const emptyRig = (): RigDraft => ({
  name: '',
  siteId: '',
  telescopeId: '',
  cameraId: '',
  showInPlanning: true,
  ninaDeliveryEnabled: true,
  defaultTemplateId: null,
  defaultRotationDeg: null,
  hasRotator: false,
  rotationToleranceDeg: 5,
  skipOnRotationMismatch: false,
  sessionReportDiscord: false,
  notes: '',
});

/** Konflikt beim Speichern (412): Hinweis mit „Neu laden“ statt stiller Überschreibung. */
const isConflict = (e: unknown) =>
  e instanceof ApiError && e.problem.code === 'resource.version_conflict';

export function RigsPage() {
  const { t } = useTranslation();
  const canWrite = useCan('equipment.write');
  const canSettings = useCan('rig.settings.write');
  const client = useQueryClient();
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const templates = useEquipmentList('exposure-templates');
  const { save, remove } = useEquipmentMutations('rigs');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RigDraft>(emptyRig);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const [picked, setPicked] = useState(false);
  const fieldError = useFieldError({ ...serverFieldErrors(save.error), ...errors });
  const num = useNumber();
  const items = rigs.data ?? [];
  if (!picked && rigs.data) {
    setPicked(true);
    const first = items[0];
    if (first) {
      setSelectedId(first.id);
      setDraft(rigDraft(first));
    }
  }
  const selected = items.find((r) => r.id === selectedId) ?? null;
  const select = (id: string) => {
    const rig = items.find((r) => r.id === id);
    if (!rig) return;
    setSelectedId(id);
    setDraft(rigDraft(rig));
    setErrors({});
    setSaved(false);
    save.reset();
    del.clearUsage();
  };
  const del = useDeleteWithUsage(
    (id) => remove.mutateAsync(id),
    () => {
      setSelectedId(null);
      setDraft(emptyRig());
    },
  );
  const set = <K extends keyof RigDraft>(key: K, value: RigDraft[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const saveRig = useMutation({
    mutationFn: (body: object) =>
      selected
        ? equipmentApi.updateRig(selected.id, body, selected.settingsVersion)
        : save.mutateAsync({ id: null, body }),
    onSuccess: async (view) => {
      await client.invalidateQueries({ queryKey: equipmentKey('rigs') });
      const rig = view as RigView;
      setSelectedId(rig.id);
      setDraft(rigDraft(rig));
      setSaved(true);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(RigInput, draft);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    saveRig.mutate(result.data);
  };
  const reload = async () => {
    const fresh = await rigs.refetch();
    const rig = fresh.data?.find((r) => r.id === selectedId);
    if (rig) setDraft(rigDraft(rig));
    saveRig.reset();
  };

  const site = (sites.data ?? []).find((s) => s.id === draft.siteId);
  const telescope = (telescopes.data ?? []).find((s) => s.id === draft.telescopeId);
  const camera = (cameras.data ?? []).find((s) => s.id === draft.cameraId);
  const scale = telescope && camera ? imageScale({ ...telescope, ...camera }) : null;
  const tel = telescope ? telescopeDerived(telescope) : null;
  const disabled = !canWrite;
  const Add = actionIcons.add;
  const pending = rigs.isPending || sites.isPending || telescopes.isPending || cameras.isPending;

  return (
    <EquipmentLayout title={t('rigs.title')}>
      {rigs.isError ? (
        <ProblemMessage code={problemCode(rigs.error)} onRetry={() => void rigs.refetch()} />
      ) : pending ? (
        <p role="status">{t('common.loading')}</p>
      ) : (
        <>
          <div className={styles.inline}>
            {items.length > 0 ? (
              <SelectField
                label={t('rigs.select')}
                value={selectedId ?? ''}
                onChange={(v) => (v ? select(v) : undefined)}
                options={[
                  ...(selectedId === null ? [{ value: '', label: t('rigs.new') }] : []),
                  ...items.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            ) : (
              <p className={styles.muted}>{t('rigs.empty')}</p>
            )}
            {canWrite ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  setSelectedId(null);
                  setDraft({
                    ...emptyRig(),
                    siteId: sites.data?.[0]?.id ?? '',
                    telescopeId: telescopes.data?.[0]?.id ?? '',
                    cameraId: cameras.data?.[0]?.id ?? '',
                  });
                  setErrors({});
                  saveRig.reset();
                }}
              >
                <Add size={ICON_SIZE.table} aria-hidden />
                {t('equipment.new')}
              </button>
            ) : null}
          </div>
          <form className={styles.form} onSubmit={submit} aria-labelledby="rig-form-title">
            <div className={styles.formTitle}>
              <h2 id="rig-form-title">{selected ? selected.name : t('rigs.new')}</h2>
              {selected ? (
                <span className={styles.muted}>
                  {t('rigs.version', { version: selected.settingsVersion })}
                </span>
              ) : null}
            </div>
            {del.usage ? <UsageNotice usage={del.usage} onClose={del.clearUsage} /> : null}
            {isConflict(saveRig.error) ? (
              <div className={styles.warning} role="alert">
                <p>{t('common.conflict')}</p>
                <button type="button" className={styles.button} onClick={() => void reload()}>
                  {t('rigs.reload')}
                </button>
              </div>
            ) : null}
            <div className={styles.grid}>
              <TextField
                label={t('equipment.field.name')}
                value={draft.name}
                onChange={(v) => set('name', v)}
                error={fieldError('name')}
                disabled={disabled}
              />
              <TextField
                label={t('equipment.field.notes')}
                value={draft.notes}
                maxLength={4000}
                onChange={(v) => set('notes', v)}
                disabled={disabled}
              />
            </div>
            <div className={styles.inline}>
              <CheckField
                label={t('rigs.field.showInPlanning')}
                checked={draft.showInPlanning}
                onChange={(v) => set('showInPlanning', v)}
                disabled={disabled}
              />
              <CheckField
                label={t('rigs.field.ninaDeliveryEnabled')}
                checked={draft.ninaDeliveryEnabled}
                onChange={(v) => set('ninaDeliveryEnabled', v)}
                disabled={disabled}
              />
              <CheckField
                label={t('rigs.field.sessionReportDiscord')}
                checked={draft.sessionReportDiscord}
                onChange={(v) => set('sessionReportDiscord', v)}
                disabled={disabled}
              />
            </div>
            <div className={styles.section}>
              <h3>{t('rigs.rotation')}</h3>
              <div className={styles.inline}>
                <CheckField
                  label={t('rigs.field.hasRotator')}
                  checked={draft.hasRotator}
                  onChange={(v) => set('hasRotator', v)}
                  disabled={disabled}
                />
                <CheckField
                  label={t('rigs.field.skipOnRotationMismatch')}
                  checked={draft.skipOnRotationMismatch}
                  onChange={(v) => set('skipOnRotationMismatch', v)}
                  disabled={disabled}
                />
              </div>
              <div className={styles.grid}>
                <NumberField
                  label={
                    draft.hasRotator ? t('rigs.field.defaultRotation') : t('rigs.field.cameraAngle')
                  }
                  unit="°"
                  value={draft.defaultRotationDeg}
                  onChange={(v) => set('defaultRotationDeg', v)}
                  error={fieldError('defaultRotationDeg')}
                  hint={draft.hasRotator ? undefined : t('rigs.cameraAngleHint')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('rigs.field.rotationTolerance')}
                  unit="°"
                  value={draft.rotationToleranceDeg}
                  onChange={(v) => set('rotationToleranceDeg', v)}
                  error={fieldError('rotationToleranceDeg')}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className={styles.columns}>
              <section className={styles.section} aria-labelledby="rig-site">
                <h3 id="rig-site">{t('rigs.site')}</h3>
                <SelectField
                  label={t('rigs.site')}
                  value={draft.siteId}
                  onChange={(v) => set('siteId', v)}
                  options={[
                    { value: '', label: '–' },
                    ...(sites.data ?? []).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  error={fieldError('siteId')}
                  disabled={disabled}
                />
                <Link to={EQUIPMENT_PATHS.sites}>{t('rigs.edit')}</Link>
                {site ? (
                  <dl className={styles.facts}>
                    <dt>{t('equipment.sites.field.latitude')}</dt>
                    <dd>{num(site.latitudeDeg, 4)}°</dd>
                    <dt>{t('equipment.sites.field.longitude')}</dt>
                    <dd>{num(site.longitudeDeg, 4)}°</dd>
                    <dt>{t('equipment.sites.field.elevation')}</dt>
                    <dd>{num(site.elevationM, 0)} m</dd>
                    <dt>{t('equipment.sites.field.bortle')}</dt>
                    <dd>{site.bortleClass ?? '–'}</dd>
                    <dt>{t('equipment.sites.field.timeZone')}</dt>
                    <dd>{site.timeZone}</dd>
                    <dt>{t('equipment.sites.field.observatoryType')}</dt>
                    <dd>{t(`equipment.observatoryType.${site.observatoryType}`)}</dd>
                  </dl>
                ) : null}
              </section>
              <section className={styles.section} aria-labelledby="rig-telescope">
                <h3 id="rig-telescope">{t('rigs.telescope')}</h3>
                <SelectField
                  label={t('rigs.telescope')}
                  value={draft.telescopeId}
                  onChange={(v) => set('telescopeId', v)}
                  options={[
                    { value: '', label: '–' },
                    ...(telescopes.data ?? []).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  error={fieldError('telescopeId')}
                  disabled={disabled}
                />
                <Link to={EQUIPMENT_PATHS.telescopes}>{t('rigs.edit')}</Link>
                {telescope && tel ? (
                  <dl className={styles.facts}>
                    <dt>{t('equipment.telescopes.field.aperture')}</dt>
                    <dd>{num(telescope.apertureMm, 0)} mm</dd>
                    <dt>{t('equipment.telescopes.field.focalLength')}</dt>
                    <dd>{num(telescope.focalLengthMm, 0)} mm</dd>
                    <dt>{t('equipment.telescopes.derived.fRatioNative')}</dt>
                    <dd>f/{num(tel.fRatioNative, 2)}</dd>
                    <dt>{t('equipment.telescopes.field.reducer')}</dt>
                    <dd>{num(telescope.reducerFactor, 2)}</dd>
                    <dt>{t('equipment.telescopes.derived.effFocal')}</dt>
                    <dd>
                      {num(tel.effFocalMm, 0)} mm · f/{num(tel.fRatioEffective, 2)}
                    </dd>
                    <dt>{t('equipment.telescopes.field.opticalDesign')}</dt>
                    <dd>{t(`equipment.opticalDesign.${telescope.opticalDesign}`)}</dd>
                  </dl>
                ) : null}
                <SelectField
                  label={t('rigs.field.defaultTemplate')}
                  value={draft.defaultTemplateId ?? ''}
                  onChange={(v) => set('defaultTemplateId', v === '' ? null : v)}
                  options={[
                    { value: '', label: t('equipment.none') },
                    ...(templates.data ?? []).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  disabled={disabled}
                />
                <Link to={EQUIPMENT_PATHS.filters}>{t('rigs.editFilters')}</Link>
              </section>
              <section className={styles.section} aria-labelledby="rig-camera">
                <h3 id="rig-camera">{t('rigs.camera')}</h3>
                <SelectField
                  label={t('rigs.camera')}
                  value={draft.cameraId}
                  onChange={(v) => set('cameraId', v)}
                  options={[
                    { value: '', label: '–' },
                    ...(cameras.data ?? []).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  error={fieldError('cameraId')}
                  disabled={disabled}
                />
                <Link to={EQUIPMENT_PATHS.cameras}>{t('rigs.edit')}</Link>
                {camera ? (
                  <dl className={styles.facts}>
                    <dt>{t('equipment.cameras.derived.resolution')}</dt>
                    <dd>
                      {camera.widthPx} × {camera.heightPx}
                    </dd>
                    <dt>{t('equipment.cameras.field.pixelSize')}</dt>
                    <dd>{num(camera.pixelSizeUm, 2)} µm</dd>
                    <dt>{t('equipment.cameras.derived.sensorSize')}</dt>
                    <dd>
                      {num((camera.widthPx * camera.pixelSizeUm) / 1000, 1)} ×{' '}
                      {num((camera.heightPx * camera.pixelSizeUm) / 1000, 1)} mm
                    </dd>
                    <dt>{t('rigs.cameraType')}</dt>
                    <dd>
                      {camera.isColor ? t('equipment.cameras.osc') : t('equipment.cameras.mono')}
                    </dd>
                    <dt>{t('equipment.cameras.field.readNoise')}</dt>
                    <dd>{camera.readNoiseE === null ? '–' : `${num(camera.readNoiseE, 1)} e⁻`}</dd>
                    <dt>{t('equipment.cameras.field.fullWell')}</dt>
                    <dd>{camera.fullWellE === null ? '–' : `${num(camera.fullWellE, 0)} e⁻`}</dd>
                    <dt>{t('equipment.cameras.field.bitDepth')}</dt>
                    <dd>{camera.bitDepth} bit</dd>
                  </dl>
                ) : null}
              </section>
            </div>
            {scale ? (
              <div className={styles.section}>
                <h3>{t('rigs.derived')}</h3>
                <dl className={styles.facts}>
                  <dt>{t('rigs.scale')}</dt>
                  <dd>{num(scale.scaleArcsecPx, 2)}″/px</dd>
                  <dt>{t('rigs.fov')}</dt>
                  <dd>
                    {num(scale.fovWidthDeg, 2)}° × {num(scale.fovHeightDeg, 2)}° (
                    {num(scale.fovWidthDeg * 60, 0)}′ × {num(scale.fovHeightDeg * 60, 0)}′)
                  </dd>
                  <dt>{t('rigs.fovDiagonal')}</dt>
                  <dd>{num(scale.fovDiagonalDeg, 2)}°</dd>
                  <dt>{t('rigs.sampling')}</dt>
                  <dd>{t('rigs.samplingValue', { value: num(2 / scale.scaleArcsecPx, 1) })}</dd>
                </dl>
              </div>
            ) : null}
            <p className={styles.muted}>{t('rigs.instancesLater')}</p>
            <FormActions
              canWrite={canWrite}
              saving={saveRig.isPending}
              saved={saved}
              error={isConflict(saveRig.error) ? null : saveRig.error}
              onDelete={selected ? () => del.ask(selected.id, selected.name) : undefined}
            />
          </form>
          {selected ? (
            <>
              <SchedulerForm rig={selected} canWrite={canSettings} />
              {camera?.isColor ? (
                <p className={styles.note} role="note">
                  {t('rigs.wheel.osc')}
                </p>
              ) : (
                <FilterWheelSection rig={selected} canWrite={canSettings} />
              )}
            </>
          ) : null}
        </>
      )}
      <DeleteDialog dialog={del.dialog} />
    </EquipmentLayout>
  );
}

// ---- Scheduler-Einstellungen ---------------------------------------------------------------------

export function SchedulerForm({ rig, canWrite }: { rig: RigView; canWrite: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Scheduler>(rig.scheduler);
  const [base, setBase] = useState({ id: rig.id, version: rig.settingsVersion });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  // Anderes Rig bzw. neue Version vom Server: Entwurf übernehmen.
  if (base.id !== rig.id || base.version !== rig.settingsVersion) {
    setBase({ id: rig.id, version: rig.settingsVersion });
    setDraft(rig.scheduler);
    setErrors({});
  }
  const save = useMutation({
    mutationFn: (body: Scheduler) =>
      equipmentApi.schedulerSettings(rig.id, body, rig.settingsVersion),
    onSuccess: async () => {
      setSaved(true);
      await client.invalidateQueries({ queryKey: equipmentKey('rigs') });
    },
  });
  const fieldError = useFieldError({ ...serverFieldErrors(save.error), ...errors });
  const disabled = !canWrite;
  const set = <K extends keyof Scheduler>(key: K, value: Scheduler[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const setOverhead = (key: keyof Scheduler['overhead'], value: number | null) =>
    set('overhead', { ...draft.overhead, [key]: value } as Scheduler['overhead']);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(SchedulerSettings, draft);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    // flip-rotation.md §1: maxAfter ≥ after – der Hinweis steht schon am Feld, der Server prüft erneut.
    if (draft.flipMaxAfterMeridianMin < draft.flipAfterMeridianMin) return;
    save.mutate(result.data as Scheduler);
  };
  const flipInvalid = draft.flipMaxAfterMeridianMin < draft.flipAfterMeridianMin;
  const code = save.error ? problemCode(save.error) : null;
  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby="scheduler-title">
      <div className={styles.formTitle}>
        <h2 id="scheduler-title">{t('rigs.scheduler.title')}</h2>
        <span className={styles.muted}>{t('rigs.scheduler.syncHint')}</span>
      </div>
      {code === 'resource.version_conflict' ? (
        <div className={styles.warning} role="alert">
          <p>{t('common.conflict')}</p>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              save.reset();
              void client.invalidateQueries({ queryKey: equipmentKey('rigs') });
            }}
          >
            {t('rigs.reload')}
          </button>
        </div>
      ) : null}
      <div className={styles.columns}>
        <section className={styles.section} aria-labelledby="scheduler-strategy">
          <h3 id="scheduler-strategy">{t('rigs.scheduler.strategySection')}</h3>
          <SelectField
            label={t('rigs.scheduler.strategy')}
            value={draft.strategy}
            onChange={(v) => set('strategy', v)}
            options={strategies.map((s) => ({ value: s, label: t(`rigs.strategy.${s}`) }))}
            disabled={disabled}
          />
          <SelectField
            label={t('rigs.scheduler.playback')}
            value={draft.playback}
            onChange={(v) => set('playback', v)}
            options={playbackModes.map((s) => ({ value: s, label: t(`rigs.playback.${s}`) }))}
            disabled={disabled}
          />
          <div className={styles.field}>
            <span className={styles.label}>{t('rigs.scheduler.sortChain')}</span>
            <SortChainEditor
              value={draft.sortChain}
              onChange={(v) => set('sortChain', v)}
              disabled={disabled}
            />
            {code === 'rig.sort_chain_invalid' ? (
              <span className={styles.fieldError}>{t('errors.rig.sortChainInvalid')}</span>
            ) : null}
          </div>
          <CheckField
            label={t('rigs.scheduler.bonus')}
            checked={draft.bonusEnabled}
            onChange={(v) => set('bonusEnabled', v)}
            disabled={disabled}
          />
          <NumberField
            label={t('rigs.scheduler.overshoot')}
            unit="%"
            value={draft.overshootPct}
            onChange={(v) => set('overshootPct', v ?? 0)}
            error={fieldError('overshootPct')}
            disabled={disabled}
          />
          <CheckField
            label={t('rigs.scheduler.mosaicIndependent')}
            checked={draft.mosaicPanelsIndependent}
            onChange={(v) => set('mosaicPanelsIndependent', v)}
            disabled={disabled}
          />
        </section>
        <section className={styles.section} aria-labelledby="scheduler-exposure">
          <h3 id="scheduler-exposure">{t('rigs.scheduler.exposureSection')}</h3>
          <CheckField
            label={t('rigs.scheduler.dither')}
            checked={draft.ditherEnabled}
            onChange={(v) => set('ditherEnabled', v)}
            disabled={disabled}
          />
          <NumberField
            label={t('rigs.scheduler.ditherEvery')}
            step={1}
            value={draft.ditherEvery}
            onChange={(v) => set('ditherEvery', v ?? 1)}
            error={fieldError('ditherEvery')}
            disabled={disabled || !draft.ditherEnabled}
          />
          <CheckField
            label={t('rigs.scheduler.filterSwitch')}
            checked={draft.filterSwitchEnabled}
            onChange={(v) => set('filterSwitchEnabled', v)}
            disabled={disabled}
          />
          <NumberField
            label={t('rigs.scheduler.filterSwitchEvery')}
            step={1}
            value={draft.filterSwitchEvery}
            onChange={(v) => set('filterSwitchEvery', v ?? 1)}
            error={fieldError('filterSwitchEvery')}
            disabled={disabled || !draft.filterSwitchEnabled}
          />
          <NumberField
            label={t('rigs.scheduler.filterSwitchTolerance')}
            unit="%"
            value={draft.filterSwitchTolerancePct}
            onChange={(v) => set('filterSwitchTolerancePct', v ?? 0)}
            error={fieldError('filterSwitchTolerancePct')}
            disabled={disabled || !draft.filterSwitchEnabled}
          />
          <h3>{t('rigs.scheduler.flatsSection')}</h3>
          <CheckField
            label={t('rigs.scheduler.flats')}
            checked={draft.flatsEnabled}
            onChange={(v) => set('flatsEnabled', v)}
            disabled={disabled}
          />
          <SelectField
            label={t('rigs.scheduler.flatsSource')}
            value={draft.flatsSource}
            onChange={(v) => set('flatsSource', v)}
            options={flatsSources.map((s) => ({ value: s, label: t(`rigs.flatsSource.${s}`) }))}
            hint={t(`rigs.flatsSourceHint.${draft.flatsSource}`)}
            disabled={disabled || !draft.flatsEnabled}
          />
          <CheckField
            label={t('rigs.scheduler.flatsFullSet')}
            checked={draft.flatsFullSet}
            onChange={(v) => set('flatsFullSet', v)}
            disabled={disabled || !draft.flatsEnabled}
          />
          <NumberField
            label={t('rigs.scheduler.flatCount')}
            step={1}
            value={draft.flatCount}
            onChange={(v) => set('flatCount', v ?? 1)}
            error={fieldError('flatCount')}
            disabled={disabled || !draft.flatsEnabled}
          />
          <CheckField
            label={t('rigs.scheduler.darkFlats')}
            checked={draft.darkFlatsEnabled}
            onChange={(v) => set('darkFlatsEnabled', v)}
            disabled={disabled || !draft.flatsEnabled}
          />
          <NumberField
            label={t('rigs.scheduler.darkFlatCount')}
            step={1}
            value={draft.darkFlatCount}
            onChange={(v) => set('darkFlatCount', v)}
            hint={t('rigs.scheduler.darkFlatCountHint')}
            error={fieldError('darkFlatCount')}
            disabled={disabled || !draft.flatsEnabled || !draft.darkFlatsEnabled}
          />
        </section>
        <section className={styles.section} aria-labelledby="scheduler-flip">
          <h3 id="scheduler-flip">{t('rigs.scheduler.flipSection')}</h3>
          <CheckField
            label={t('rigs.scheduler.flip')}
            checked={draft.flipEnabled}
            onChange={(v) => set('flipEnabled', v)}
            disabled={disabled}
          />
          <NumberField
            label={t('rigs.scheduler.flipAfter')}
            unit="min"
            value={draft.flipAfterMeridianMin}
            onChange={(v) => set('flipAfterMeridianMin', v ?? 0)}
            error={fieldError('flipAfterMeridianMin')}
            disabled={disabled || !draft.flipEnabled}
          />
          <NumberField
            label={t('rigs.scheduler.flipMaxAfter')}
            unit="min"
            value={draft.flipMaxAfterMeridianMin}
            onChange={(v) => set('flipMaxAfterMeridianMin', v ?? 0)}
            error={
              fieldError('flipMaxAfterMeridianMin') ??
              (flipInvalid || code === 'rig.flip_settings_invalid'
                ? t('rigs.scheduler.flipMaxInvalid')
                : undefined)
            }
            disabled={disabled || !draft.flipEnabled}
          />
          <NumberField
            label={t('rigs.scheduler.flipPause')}
            unit="min"
            value={draft.flipPauseBeforeMeridianMin}
            onChange={(v) => set('flipPauseBeforeMeridianMin', v ?? 0)}
            error={fieldError('flipPauseBeforeMeridianMin')}
            disabled={disabled || !draft.flipEnabled}
          />
          <NumberField
            label={t('rigs.scheduler.flipDuration')}
            unit="s"
            value={draft.flipDurationS}
            onChange={(v) => set('flipDurationS', v ?? 0)}
            error={fieldError('flipDurationS')}
            disabled={disabled || !draft.flipEnabled}
          />
          <h3>{t('rigs.scheduler.overheadSection')}</h3>
          <NumberField
            label={t('rigs.overhead.slewCenterS')}
            unit="s"
            value={draft.overhead.slewCenterS}
            onChange={(v) => setOverhead('slewCenterS', v)}
            error={fieldError('overhead.slewCenterS')}
            disabled={disabled}
          />
          <NumberField
            label={t('rigs.overhead.filterChangeS')}
            unit="s"
            value={draft.overhead.filterChangeS}
            onChange={(v) => setOverhead('filterChangeS', v)}
            error={fieldError('overhead.filterChangeS')}
            disabled={disabled}
          />
          <NumberField
            label={t('rigs.overhead.ditherSettleS')}
            unit="s"
            value={draft.overhead.ditherSettleS}
            onChange={(v) => setOverhead('ditherSettleS', v)}
            error={fieldError('overhead.ditherSettleS')}
            disabled={disabled}
          />
          <NumberField
            label={t('rigs.overhead.afEveryMin')}
            unit="min"
            value={draft.overhead.afEveryMin}
            onChange={(v) => setOverhead('afEveryMin', v)}
            error={fieldError('overhead.afEveryMin')}
            hint={
              draft.overhead.afEveryMin === 0 ? t('rigs.overhead.afOff') : t('rigs.overhead.afHint')
            }
            disabled={disabled}
          />
          <NumberField
            label={t('rigs.overhead.afDurationS')}
            unit="s"
            value={draft.overhead.afDurationS}
            onChange={(v) => setOverhead('afDurationS', v)}
            error={fieldError('overhead.afDurationS')}
            disabled={disabled || draft.overhead.afEveryMin === 0}
          />
          <NumberField
            label={t('rigs.overhead.downloadS')}
            unit="s"
            value={draft.overhead.downloadS}
            onChange={(v) => setOverhead('downloadS', v)}
            error={fieldError('overhead.downloadS')}
            disabled={disabled}
          />
        </section>
      </div>
      <FormActions
        canWrite={canWrite}
        saving={save.isPending}
        saved={saved}
        error={
          code === 'resource.version_conflict' ||
          code === 'rig.sort_chain_invalid' ||
          code === 'rig.flip_settings_invalid'
            ? null
            : save.error
        }
      />
    </form>
  );
}
