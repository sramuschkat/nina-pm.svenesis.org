/**
 * S-10 Rigs (FA-RIG-01…14, FA-SCH-01…10/17; FK 14.3): Listen-/Detail-Muster (AP-26b) – links die
 * durchsuchbare Rig-Liste, rechts das gewählte Rig mit Reitern *Allgemein* (Name, Notizen, Schalter, Standort) · *Ausrüstung* (Teleskop, Kamera, Rotation,
 * abgeleitete Kennzahlen) · *Scheduler* (Sortierkette per Ziehen, Flip, Flats, Overheads) ·
 * *Filterrad* (Belegung mit Zuordnung zu NINA) · *NINA* (zugeordnete Instanzen mit Übernahmestatus,
 * AP-14c, FA-SIM-09). Allgemein und Ausrüstung speichern gemeinsam den ganzen Rig-Entwurf; verdeckte
 * Reiter bleiben im DOM (`keepMounted`), ein Feldfehler in einem verdeckten Reiter holt ihn nach vorn.
 * *Neu* steht rechts im Seitenkopf; *Löschen* und *Speichern* stehen im Kopf der Rig-Karte (AP-26d) –
 * *Speichern* sendet das Formular des aktiven Reiters (Allgemein/Ausrüstung: Rig-Entwurf, Scheduler:
 * Scheduler-Einstellungen; Filterrad und NINA haben eigene Aktionen). Gespeichert wird mit `If-Match`
 * (`settingsVersion`, 412 bei parallelem Speichern).
 */
import { imageScale, RigInput, telescopeDerived } from '@nina-pm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { equipmentApi, type RigView } from '../../api/client';
import { ApiError, useCan } from '../../auth';
import { Tabs } from '../../components/Tabs';
import sched from './scheduler.module.css';
import styles from './equipment.module.css';
import css from './rigs.module.css';
import {
  CheckField,
  DeleteDialog,
  DetailHead,
  EQUIPMENT_PATHS,
  EquipmentLayout,
  equipmentKey,
  ListDetail,
  NewButton,
  NumberField,
  PickList,
  SaveError,
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
import { NINA_PATHS } from '../nina/NinaLayout';
import { UptakeStatus } from '../nina/UptakeStatus';
import { rebaseDraft } from '../../lib/draft-rebase';
import { FilterWheelSection } from './FilterWheelSection';
import { FocusOffsets } from './FocusOffsets';
import { MeasuredOverheads } from './MeasuredOverheads';
import { SORT_CHAIN_LABEL } from './SortChainEditor';
import type { SortChainKey } from '@nina-pm/shared';

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

/** Reiter der Rig-Seite (AP-26b). */
export type RigTab = 'general' | 'equipment' | 'scheduler' | 'filterWheel' | 'nina';
const RIG_TABS: readonly RigTab[] = ['general', 'equipment', 'scheduler', 'filterWheel', 'nina'];

/** Formulare der Reiter, die *Speichern* im Kartenkopf sendet (`form`-Attribut des Knopfs). */
const RIG_FORM_IDS = {
  general: 'rig-general-form',
  equipment: 'rig-equipment-form',
} as const;

/** Felder des Rig-Entwurfs auf dem Reiter *Ausrüstung*; alle übrigen liegen auf *Allgemein*. */
const EQUIPMENT_FIELDS: ReadonlySet<string> = new Set<keyof RigDraft>([
  'telescopeId',
  'cameraId',
  'defaultTemplateId',
  'hasRotator',
  'skipOnRotationMismatch',
  'defaultRotationDeg',
  'rotationToleranceDeg',
]);

/** Reiter eines Feldpfads (Client- oder Serverfehler) im Rig-Formular. */
export const rigTabOf = (path: string): RigTab =>
  EQUIPMENT_FIELDS.has(path.split('.')[0] ?? '') ? 'equipment' : 'general';

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
  /**
   * Fassung, auf der der Entwurf beruht (Prüfung 28.09.2026): gespeichert wird mit deren
   * `settingsVersion`, nicht mit der einer später nachgeladenen Liste – sonst überschriebe der ganze
   * Entwurf fremde Änderungen ohne 412. Gesetzt bei Auswahl, nach dem Speichern und beim Neuladen.
   */
  const [base, setBase] = useState<RigView | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const [picked, setPicked] = useState(false);
  /** Neues Rig in Arbeit (`selectedId = null`); weder gewählt noch neu → Leerzustand. */
  const [creating, setCreating] = useState(false);
  /** *Neu* vor dem Laden der Stammdaten: Standort/Teleskop/Kamera vorbelegen, sobald sie da sind. */
  const [needsDefaults, setNeedsDefaults] = useState(false);
  // `?rig=…&reiter=…` (AP-72b, Link „Grenzwerte ändern“ aus dem Reiter „Bilder“): Rig und Reiter vorwählen.
  const [params] = useSearchParams();
  const wantedTab = params.get('reiter');
  const [tab, setTab] = useState<RigTab>(
    (RIG_TABS as readonly string[]).includes(wantedTab ?? '') ? (wantedTab as RigTab) : 'general',
  );
  const num = useNumber();
  const items = rigs.data ?? [];
  if (!picked && rigs.data) {
    setPicked(true);
    const first = items.find((r) => r.id === params.get('rig')) ?? items[0];
    if (first) {
      setSelectedId(first.id);
      setDraft(rigDraft(first));
      setBase(first);
    }
  }
  const selected = items.find((r) => r.id === selectedId) ?? null;
  // Neuere Fassung des gewählten Rigs (Fensterfokus, eigenes Speichern von Filterrad/Scheduler): Entwurf
  // darauf heben, solange sich die Änderungen nicht überschneiden; sonst Konflikthinweis und 412.
  if (selected && base?.id === selected.id && selected.settingsVersion > base.settingsVersion) {
    const next = rebaseDraft(draft, rigDraft(base), rigDraft(selected));
    if (next) {
      setDraft(next);
      setBase(selected);
    }
  }
  const stale =
    selected !== null &&
    base?.id === selected.id &&
    selected.settingsVersion > base.settingsVersion;
  const select = (id: string) => {
    const rig = items.find((r) => r.id === id);
    if (!rig) return;
    setSelectedId(id);
    setCreating(false);
    setDraft(rigDraft(rig));
    setBase(rig);
    setErrors({});
    setSaved(false);
    save.reset();
    saveRig.reset();
    del.clearUsage();
  };
  const del = useDeleteWithUsage(
    (id) => remove.mutateAsync(id),
    () => {
      setSelectedId(null);
      setCreating(false);
      setDraft(emptyRig());
      setBase(null);
    },
  );
  const set = <K extends keyof RigDraft>(key: K, value: RigDraft[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  /** Fehler in einem verdeckten Reiter: dorthin wechseln, damit das Feld sichtbar ist. */
  const reveal = (found: FieldErrors) => {
    const tabs = Object.keys(found).map(rigTabOf);
    const first = tabs[0];
    if (first && !tabs.includes(tab)) setTab(first);
  };
  const saveRig = useMutation({
    mutationFn: (body: object) =>
      selected
        ? equipmentApi.updateRig(
            selected.id,
            body,
            (base?.id === selected.id ? base : selected).settingsVersion,
          )
        : save.mutateAsync({ id: null, body }),
    onSuccess: async (view) => {
      const rig = view as RigView;
      // Basis vor dem Neuladen setzen, damit die frische Liste nicht als fremde Änderung gilt.
      setSelectedId(rig.id);
      setCreating(false);
      setDraft(rigDraft(rig));
      setBase(rig);
      setSaved(true);
      // Filterrad und Übernahmestatus tragen die Einstellungsversion mit: ohne Neuladen schickte das
      // Filterrad danach die alte Version (falsches 412, Prüfung 28.09.2026).
      await Promise.all([
        client.invalidateQueries({ queryKey: equipmentKey('rigs') }),
        client.invalidateQueries({ queryKey: ['equipment', 'filter-wheel', rig.id] }),
        client.invalidateQueries({ queryKey: ['nina-instances'] }),
      ]);
    },
    onError: (e) => reveal(serverFieldErrors(e)),
  });
  const allErrors: FieldErrors = { ...serverFieldErrors(saveRig.error), ...errors };
  const fieldError = useFieldError(allErrors);
  const tabsWithErrors = new Set(Object.keys(allErrors).map(rigTabOf));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(RigInput, draft);
    if (!result.ok) {
      setErrors(result.errors);
      reveal(result.errors);
      return;
    }
    setErrors({});
    saveRig.mutate(result.data);
  };
  const reload = async () => {
    const fresh = await rigs.refetch();
    const rig = fresh.data?.find((r) => r.id === selectedId);
    if (rig) {
      setDraft(rigDraft(rig));
      setBase(rig);
    }
    saveRig.reset();
  };

  const site = (sites.data ?? []).find((s) => s.id === draft.siteId);
  const telescope = (telescopes.data ?? []).find((s) => s.id === draft.telescopeId);
  const camera = (cameras.data ?? []).find((s) => s.id === draft.cameraId);
  const scale = telescope && camera ? imageScale({ ...telescope, ...camera }) : null;
  const tel = telescope ? telescopeDerived(telescope) : null;
  const disabled = !canWrite;
  const pending = rigs.isPending || sites.isPending || telescopes.isPending || cameras.isPending;
  const listState = rigs.isError ? 'error' : pending ? 'loading' : 'ready';
  if (needsDefaults && sites.data && telescopes.data && cameras.data) {
    setNeedsDefaults(false);
    const defaults = {
      siteId: sites.data[0]?.id ?? '',
      telescopeId: telescopes.data[0]?.id ?? '',
      cameraId: cameras.data[0]?.id ?? '',
    };
    setDraft((d) => ({
      ...d,
      siteId: d.siteId || defaults.siteId,
      telescopeId: d.telescopeId || defaults.telescopeId,
      cameraId: d.cameraId || defaults.cameraId,
    }));
  }
  const startNew = () => {
    setSelectedId(null);
    setCreating(true);
    setDraft(emptyRig());
    setBase(null);
    setNeedsDefaults(true);
    setErrors({});
    setSaved(false);
    save.reset();
    saveRig.reset();
    del.clearUsage();
    setTab('general');
  };

  /** Allgemein und Ausrüstung: je ein Formular, beide speichern den ganzen Entwurf. */
  const rigForm = (id: string, children: ReactNode) => (
    <form
      id={id}
      className={styles.flat}
      onSubmit={submit}
      aria-labelledby="rig-form-title"
      noValidate
    >
      {children}
    </form>
  );
  /** Ziel von *Speichern* im Kartenkopf je Reiter; `null` = kein Knopf. */
  const saveTarget =
    tab === 'general' || tab === 'equipment' ? (canWrite ? RIG_FORM_IDS[tab] : null) : null;
  const rigTab = tab === 'general' || tab === 'equipment';
  const saveFirst = (
    <p className={styles.note} role="note">
      {t('rigs.tabs.saveFirst')}
    </p>
  );

  const general = rigForm(
    RIG_FORM_IDS.general,
    <>
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
          error={fieldError('notes')}
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
          <dl className={styles.kv}>
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
    </>,
  );

  const equipment = rigForm(
    RIG_FORM_IDS.equipment,
    <>
      <div className={styles.columns}>
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
            <dl className={styles.kv}>
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
            error={fieldError('defaultTemplateId')}
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
            <dl className={styles.kv}>
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
              <dd>{camera.isColor ? t('equipment.cameras.osc') : t('equipment.cameras.mono')}</dd>
              <dt>{t('equipment.cameras.field.readNoise')}</dt>
              <dd>{camera.readNoiseE === null ? '–' : `${num(camera.readNoiseE, 1)} e⁻`}</dd>
              <dt>{t('equipment.cameras.field.fullWell')}</dt>
              <dd>{camera.fullWellE === null ? '–' : `${num(camera.fullWellE, 0)} e⁻`}</dd>
              <dt>{t('equipment.cameras.field.bitDepth')}</dt>
              <dd>{camera.bitDepth} bit</dd>
            </dl>
          ) : null}
        </section>
        <section className={styles.section} aria-labelledby="rig-rotation">
          <h3 id="rig-rotation">{t('rigs.rotation')}</h3>
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
          <NumberField
            label={draft.hasRotator ? t('rigs.field.defaultRotation') : t('rigs.field.cameraAngle')}
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
        </section>
      </div>
      {scale ? (
        <section className={styles.section} aria-labelledby="rig-derived">
          <h3 id="rig-derived">{t('rigs.derived')}</h3>
          <dl className={styles.kv}>
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
        </section>
      ) : null}
    </>,
  );

  const label: Record<RigTab, string> = {
    general: t('rigs.tabs.general'),
    equipment: t('rigs.tabs.equipment'),
    scheduler: t('rigs.tabs.scheduler'),
    filterWheel: t('rigs.tabs.filterWheel'),
    nina: t('rigs.tabs.nina'),
  };

  return (
    <EquipmentLayout
      title={t('rigs.title')}
      actions={canWrite ? <NewButton onClick={startNew} /> : null}
    >
      <ListDetail
        state={listState}
        list={
          <PickList
            label={t('rigs.list')}
            items={items}
            selectedId={selectedId}
            onSelect={select}
            state={listState}
            onRetry={() => void rigs.refetch()}
            searchText={(r: RigView) => r.name}
            emptyText={t('rigs.empty')}
            render={(r: RigView) => (
              <>
                <span>{r.name}</span>
                <span className={styles.pickMeta}>{num(r.derived.scaleArcsecPx, 2)}″/px</span>
              </>
            )}
          />
        }
        detail={
          selected || creating ? (
            <section className={styles.card} aria-labelledby="rig-form-title">
              <DetailHead
                titleId="rig-form-title"
                title={selected ? selected.name : t('rigs.new')}
                meta={
                  selected ? t('rigs.version', { version: selected.settingsVersion }) : undefined
                }
                canWrite={canWrite}
                canSave={saveTarget !== null}
                form={saveTarget ?? undefined}
                saving={rigTab && saveRig.isPending}
                saved={rigTab && saved}
                onDelete={selected ? () => del.ask(selected.id, selected.name) : undefined}
              />
              <div className={styles.cardBody}>
                {del.usage ? <UsageNotice usage={del.usage} onClose={del.clearUsage} /> : null}
                {rigTab ? (
                  <SaveError error={isConflict(saveRig.error) ? null : saveRig.error} />
                ) : null}
                {isConflict(saveRig.error) || stale ? (
                  <div className={styles.warning} role="alert">
                    <p>{t('common.conflict')}</p>
                    <button type="button" className={styles.button} onClick={() => void reload()}>
                      {t('rigs.reload')}
                    </button>
                  </div>
                ) : null}
                <Tabs
                  label={t('rigs.tabs.label')}
                  value={tab}
                  onChange={setTab}
                  keepMounted
                  panelClassName={css.tabPanel}
                  tabs={RIG_TABS.map((key) => ({
                    key,
                    label: label[key],
                    ...(tabsWithErrors.has(key)
                      ? { badge: <span className={css.tabError}>{t('rigs.tabs.hasErrors')}</span> }
                      : {}),
                  }))}
                  panels={{
                    general,
                    equipment,
                    scheduler: selected ? (
                      <>
                        <SchedulerSummary rig={selected} />
                        <MeasuredOverheads rig={selected} canWrite={canSettings} />
                      </>
                    ) : (
                      saveFirst
                    ),
                    filterWheel: !selected ? (
                      saveFirst
                    ) : camera?.isColor ? (
                      <p className={styles.note} role="note">
                        {t('rigs.wheel.osc')}
                      </p>
                    ) : (
                      <>
                        <FilterWheelSection rig={selected} canWrite={canSettings} />
                        <FocusOffsets rig={selected} />
                      </>
                    ),
                    nina: selected ? (
                      <section className={styles.flat} aria-labelledby="rig-nina-title">
                        <div className={styles.flatTitle}>
                          <h3 id="rig-nina-title">{t('nina.uptake.title')}</h3>
                        </div>
                        <UptakeStatus
                          rigId={selected.id}
                          settingsVersion={selected.settingsVersion}
                        />
                        <p className={styles.muted}>{t('rigs.instancesLater')}</p>
                      </section>
                    ) : (
                      saveFirst
                    ),
                  }}
                />
              </div>
            </section>
          ) : null
        }
      />
      <DeleteDialog dialog={del.dialog} />
    </EquipmentLayout>
  );
}

// ---- Scheduler-Einstellungen ---------------------------------------------------------------------

/**
 * Reiter *Scheduler* am Rig (AP-26i, Entscheidung Sven 26.09.2026): die Einstellungen werden nur noch im
 * Nacht-Simulator bearbeitet, wo man ihre Wirkung sofort sieht. Hier eine kompakte Zusammenfassung mit Link.
 */
function SchedulerSummary({ rig }: { rig: RigView }) {
  const { t } = useTranslation();
  const s = rig.scheduler;
  const onOff = (on: boolean) => (on ? t('rigs.scheduler.on') : t('rigs.scheduler.off'));
  const rows: [string, string][] = [
    [t('rigs.scheduler.strategy'), t(`rigs.strategy.${s.strategy}`)],
    [t('rigs.scheduler.playback'), t(`rigs.playback.${s.playback}`)],
    [
      t('rigs.scheduler.sortChain'),
      s.sortChain
        .map((k, i) => {
          const label = SORT_CHAIN_LABEL[k as SortChainKey] as string | undefined;
          return `${String(i + 1)}. ${label ? t(label) : k}`;
        })
        .join(' · '),
    ],
    [t('rigs.scheduler.overshoot'), `${String(s.overshootPct)} %`],
    [t('rigs.scheduler.bonus'), onOff(s.bonusEnabled)],
    [
      t('rigs.scheduler.dither'),
      s.ditherEnabled ? t('rigs.scheduler.everyN', { n: s.ditherEvery }) : onOff(false),
    ],
    [
      t('rigs.scheduler.filterSwitch'),
      s.filterSwitchEnabled ? t('rigs.scheduler.everyN', { n: s.filterSwitchEvery }) : onOff(false),
    ],
    [
      t('rigs.scheduler.flatsSection'),
      s.flatsEnabled
        ? [
            t(`rigs.flatsSource.${s.flatsSource}`),
            ...(s.flatsAutoMode !== 'off' ? [t(`rigs.flatsAutoMode.${s.flatsAutoMode}`)] : []),
          ].join(' · ')
        : onOff(false),
    ],
    [
      t('rigs.scheduler.flipSection'),
      s.flipEnabled
        ? t('rigs.scheduler.flipSummary', {
            after: s.flipAfterMeridianMin,
            max: s.flipMaxAfterMeridianMin,
          })
        : onOff(false),
    ],
  ];
  return (
    <section className={sched.summary} aria-labelledby="scheduler-summary">
      <div className={sched.head}>
        <h3 id="scheduler-summary">{t('rigs.scheduler.title')}</h3>
        <span className={sched.spacer} />
        <Link
          className={styles.button}
          to={`${NINA_PATHS.simulator}?${new URLSearchParams({ rig: rig.id, einstellungen: '1' }).toString()}`}
        >
          {t('rigs.scheduler.editInSimulator')}
        </Link>
      </div>
      <p className={styles.muted}>{t('rigs.scheduler.movedHint')}</p>
      <dl className={sched.facts}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
