/**
 * Scheduler-Einstellungen eines Rigs (S-40 Nacht-Simulator, seit AP-26i nur dort bearbeitet; eigener Endpunkt
 * `PUT /rigs/{id}/scheduler-settings`, `rig.settings.write`, `If-Match` mit `settingsVersion`).
 *
 * Aufbau nach dem Entwurf vom 10.10.2026 (Wunsch Sven): Karten mit Zeilen – links Name und Erklärung, rechts das
 * Feld; abhängige Felder eingerückt und gesperrt, solange ihr Schalter aus ist. Bei voller Breite drei Spalten
 * (Planung · Ablauf · Flats und Zeiten), schmaler zwei bzw. eine. Ungespeicherte Änderungen zeigt die Kopfleiste
 * (bleibt beim Scrollen oben) mit *Verwerfen*; geänderte Zeilen tragen einen Punkt. Die Overheads stehen mit der
 * Messung (AP-65) und dem Schalter „fest“ in einer Tabelle „Zeiten für die Planung“; „fest“ wird hier mit
 * *Speichern* übernommen.
 */
import {
  flatsAutoModes,
  IMAGE_QUALITY_DEFAULTS,
  overheadValueKeys,
  SchedulerSettings,
  strategies,
  type OverheadValueKey,
} from '@nina-pm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { equipmentApi, type RigView } from '../../api/client';
import styles from './equipment.module.css';
import sched from './scheduler.module.css';
import {
  equipmentKey,
  NumberInput,
  problemCode,
  SaveButton,
  SaveError,
  serverFieldErrors,
  useFieldError,
  validate,
  type FieldErrors,
} from './shared';
import { SortChainEditor } from './SortChainEditor';

type Scheduler = RigView['scheduler'];
type Quality = NonNullable<Scheduler['imageQuality']>;

const SECTIONS = ['planning', 'sort', 'nina', 'flip', 'quality', 'flats', 'times'] as const;
type SectionKey = (typeof SECTIONS)[number];
/** Spalten bei voller Breite (Entwurf): Planung · Ablauf · Flats und Zeiten. */
const COLUMNS: readonly (readonly SectionKey[])[] = [
  ['planning', 'sort'],
  ['nina', 'flip', 'quality'],
  ['flats', 'times'],
];

/** Feldpfad wie in den Prüfmeldungen (`overhead.slewCenterS`). */
const path = (group: string, key: string) => [group, key].join('.');

/** Pfade der geänderten Felder (`overhead.slewCenterS`, `imageQuality.hfrPct`, `overheadFixed` …). */
export function changedPaths(draft: Scheduler, saved: Scheduler): Set<string> {
  const out = new Set<string>();
  for (const key of Object.keys(draft) as (keyof Scheduler)[]) {
    if (key === 'overhead' || key === 'imageQuality' || key === 'overheadFixed') continue;
    const a = draft[key];
    const b = saved[key];
    const same = Array.isArray(a) && Array.isArray(b) ? a.join() === b.join() : a === b;
    if (!same) out.add(key);
  }
  for (const key of Object.keys(draft.overhead) as (keyof Scheduler['overhead'])[])
    if (draft.overhead[key] !== saved.overhead[key]) out.add(path('overhead', key));
  const qa = draft.imageQuality ?? IMAGE_QUALITY_DEFAULTS;
  const qb = saved.imageQuality ?? IMAGE_QUALITY_DEFAULTS;
  for (const key of Object.keys(qa) as (keyof Quality)[])
    if (qa[key] !== qb[key]) out.add(path('imageQuality', key));
  const fa = [...(draft.overheadFixed ?? [])].sort().join();
  const fb = [...(saved.overheadFixed ?? [])].sort().join();
  if (fa !== fb) out.add('overheadFixed');
  return out;
}

export function SchedulerForm({ rig, canWrite }: { rig: RigView; canWrite: boolean }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const uid = useId();
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
  // Bildbewertung (AP-72b): leeres Feld = Grenzwert aus.
  const quality = draft.imageQuality ?? IMAGE_QUALITY_DEFAULTS;
  const setQuality = <K extends keyof Quality>(key: K, value: Quality[K]) =>
    set('imageQuality', { ...quality, [key]: value });
  const fixed = new Set(draft.overheadFixed ?? []);
  const setFixed = (key: OverheadValueKey, on: boolean) => {
    const next = new Set(fixed);
    if (on) next.add(key);
    else next.delete(key);
    set(
      'overheadFixed',
      overheadValueKeys.filter((k) => next.has(k)),
    );
  };
  const changes = saved ? new Set<string>() : changedPaths(draft, rig.scheduler);
  const dirty = changes.size > 0;
  const changed = (...paths: string[]) => paths.some((p) => changes.has(p));
  const discard = () => {
    setDraft(rig.scheduler);
    setErrors({});
    save.reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(SchedulerSettings, draft);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    // flip-rotation.md §1: maxAfter ≥ after – der Hinweis steht schon an der Zeile, der Server prüft erneut.
    if (draft.flipMaxAfterMeridianMin < draft.flipAfterMeridianMin) return;
    save.mutate(result.data as Scheduler);
  };
  const flipInvalid = draft.flipMaxAfterMeridianMin < draft.flipAfterMeridianMin;
  const code = save.error ? problemCode(save.error) : null;
  const sectionId = (key: SectionKey) => `${uid}-section-${key}`;
  const num = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const unitLabel = (label: string, unit: string) => `${label} (${unit})`;

  const flatsOff = disabled || !draft.flatsEnabled;
  const flipOff = disabled || !draft.flipEnabled;

  const sections: Record<SectionKey, ReactNode> = {
    planning: (
      <Section id={sectionId('planning')} title={t('rigs.scheduler.planningSection')}>
        <Row
          label={t('rigs.scheduler.strategy')}
          hint={t('rigs.scheduler.strategyHint')}
          control={`${uid}-strategy`}
          changed={changed('strategy')}
        >
          <select
            id={`${uid}-strategy`}
            className={`${styles.input} ${sched.select}`}
            value={draft.strategy}
            disabled={disabled}
            onChange={(e) => set('strategy', e.target.value as Scheduler['strategy'])}
          >
            {strategies.map((s) => (
              <option key={s} value={s}>
                {t(`rigs.strategy.${s}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label={t('rigs.scheduler.playback')}
          hint={t('rigs.scheduler.playbackHint')}
          changed={changed('playback')}
        >
          <Segmented
            label={t('rigs.scheduler.playback')}
            value={draft.playback}
            options={(['time_aware', 'sequential'] as const).map((p) => ({
              value: p,
              label: t(`rigs.playback.${p}`),
            }))}
            onChange={(v) => set('playback', v)}
            disabled={disabled}
          />
        </Row>
        <Row
          label={t('rigs.scheduler.overshoot')}
          hint={t('rigs.scheduler.overshootHint')}
          control={`${uid}-overshoot`}
          changed={changed('overshootPct')}
          error={fieldError('overshootPct')}
        >
          <Num
            id={`${uid}-overshoot`}
            label={unitLabel(t('rigs.scheduler.overshoot'), '%')}
            value={draft.overshootPct}
            onChange={(v) => set('overshootPct', v ?? 0)}
            disabled={disabled}
            invalid={!!fieldError('overshootPct')}
          />
          <Unit>%</Unit>
        </Row>
        <Row
          label={t('rigs.scheduler.bonus')}
          hint={t('rigs.scheduler.bonusHint')}
          control={`${uid}-bonus`}
          changed={changed('bonusEnabled')}
        >
          <Switch
            id={`${uid}-bonus`}
            checked={draft.bonusEnabled}
            onChange={(v) => set('bonusEnabled', v)}
            disabled={disabled}
          />
        </Row>
        <Row
          label={t('rigs.scheduler.mosaicIndependent')}
          hint={t('rigs.scheduler.mosaicHint')}
          control={`${uid}-mosaic`}
          changed={changed('mosaicPanelsIndependent')}
        >
          <Switch
            id={`${uid}-mosaic`}
            checked={draft.mosaicPanelsIndependent}
            onChange={(v) => set('mosaicPanelsIndependent', v)}
            disabled={disabled}
          />
        </Row>
      </Section>
    ),
    sort: (
      <Section
        id={sectionId('sort')}
        title={t('rigs.scheduler.sortSection')}
        sub={t('rigs.scheduler.sortSub')}
      >
        <div className={sched.block} data-changed={changed('sortChain') || undefined}>
          <SortChainEditor
            value={draft.sortChain}
            onChange={(v) => set('sortChain', v)}
            disabled={disabled}
          />
          {code === 'rig.sort_chain_invalid' ? (
            <span className={styles.fieldError}>{t('errors.rig.sortChainInvalid')}</span>
          ) : null}
        </div>
      </Section>
    ),
    nina: (
      <Section
        id={sectionId('nina')}
        title={t('rigs.scheduler.ninaSection')}
        sub={t('rigs.scheduler.ninaSub')}
      >
        <Row
          label={t('rigs.scheduler.dither')}
          hint={t('rigs.scheduler.ditherHint')}
          control={`${uid}-dither`}
          changed={changed('ditherEnabled', 'ditherEvery')}
          error={fieldError('ditherEvery')}
        >
          <Unit>{t('rigs.scheduler.every')}</Unit>
          <Num
            label={t('rigs.scheduler.ditherEvery')}
            step={1}
            value={draft.ditherEvery}
            onChange={(v) => set('ditherEvery', v ?? 1)}
            disabled={disabled || !draft.ditherEnabled}
            invalid={!!fieldError('ditherEvery')}
          />
          <Switch
            id={`${uid}-dither`}
            checked={draft.ditherEnabled}
            onChange={(v) => set('ditherEnabled', v)}
            disabled={disabled}
          />
        </Row>
        <Row
          label={t('rigs.scheduler.filterSwitch')}
          hint={t('rigs.scheduler.filterSwitchHint')}
          control={`${uid}-filter-switch`}
          changed={changed('filterSwitchEnabled', 'filterSwitchEvery', 'filterSwitchTolerancePct')}
          error={fieldError('filterSwitchEvery') ?? fieldError('filterSwitchTolerancePct')}
        >
          <Unit>{t('rigs.scheduler.every')}</Unit>
          <Num
            label={t('rigs.scheduler.filterSwitchEvery')}
            step={1}
            value={draft.filterSwitchEvery}
            onChange={(v) => set('filterSwitchEvery', v ?? 1)}
            disabled={disabled || !draft.filterSwitchEnabled}
            invalid={!!fieldError('filterSwitchEvery')}
          />
          <Unit>· {t('rigs.scheduler.filterSwitchTolerance')}</Unit>
          <Num
            label={unitLabel(t('rigs.scheduler.filterSwitchTolerance'), '%')}
            value={draft.filterSwitchTolerancePct}
            onChange={(v) => set('filterSwitchTolerancePct', v ?? 0)}
            disabled={disabled || !draft.filterSwitchEnabled}
            invalid={!!fieldError('filterSwitchTolerancePct')}
          />
          <Unit>%</Unit>
          <Switch
            id={`${uid}-filter-switch`}
            checked={draft.filterSwitchEnabled}
            onChange={(v) => set('filterSwitchEnabled', v)}
            disabled={disabled}
          />
        </Row>
      </Section>
    ),
    flip: (
      <Section
        id={sectionId('flip')}
        title={t('rigs.scheduler.flipSection')}
        sub={t('rigs.scheduler.flipSub')}
      >
        <Row
          label={t('rigs.scheduler.flip')}
          hint={t('rigs.scheduler.flipHint')}
          control={`${uid}-flip`}
          changed={changed('flipEnabled')}
        >
          <Switch
            id={`${uid}-flip`}
            checked={draft.flipEnabled}
            onChange={(v) => set('flipEnabled', v)}
            disabled={disabled}
          />
        </Row>
        <Row
          sub
          label={t('rigs.scheduler.flipWindow')}
          hint={t('rigs.scheduler.flipWindowHint')}
          changed={changed('flipAfterMeridianMin', 'flipMaxAfterMeridianMin')}
          error={
            fieldError('flipAfterMeridianMin') ??
            fieldError('flipMaxAfterMeridianMin') ??
            (flipInvalid || code === 'rig.flip_settings_invalid'
              ? t('rigs.scheduler.flipMaxInvalid')
              : undefined)
          }
        >
          <Num
            label={unitLabel(t('rigs.scheduler.flipAfter'), 'min')}
            value={draft.flipAfterMeridianMin}
            onChange={(v) => set('flipAfterMeridianMin', v ?? 0)}
            disabled={flipOff}
            invalid={!!fieldError('flipAfterMeridianMin')}
          />
          <Unit>{t('rigs.scheduler.flipTo')}</Unit>
          <Num
            label={unitLabel(t('rigs.scheduler.flipMaxAfter'), 'min')}
            value={draft.flipMaxAfterMeridianMin}
            onChange={(v) => set('flipMaxAfterMeridianMin', v ?? 0)}
            disabled={flipOff}
            invalid={flipInvalid || !!fieldError('flipMaxAfterMeridianMin')}
          />
          <Unit>min</Unit>
        </Row>
        <Row
          sub
          label={t('rigs.scheduler.flipPause')}
          hint={t('rigs.scheduler.flipPauseHint')}
          control={`${uid}-flip-pause`}
          changed={changed('flipPauseBeforeMeridianMin')}
          error={fieldError('flipPauseBeforeMeridianMin')}
        >
          <Num
            id={`${uid}-flip-pause`}
            label={unitLabel(t('rigs.scheduler.flipPause'), 'min')}
            value={draft.flipPauseBeforeMeridianMin}
            onChange={(v) => set('flipPauseBeforeMeridianMin', v ?? 0)}
            disabled={flipOff}
            invalid={!!fieldError('flipPauseBeforeMeridianMin')}
          />
          <Unit>min</Unit>
        </Row>
        <p className={sched.note}>{t('rigs.scheduler.flipDurationNote')}</p>
      </Section>
    ),
    quality: (
      <Section
        id={sectionId('quality')}
        title={t('rigs.scheduler.qualitySection')}
        sub={t('rigs.scheduler.qualitySub')}
      >
        {/* AP-77: kein Modus mehr – die Grenzwerte gehen nur in die Anteile der Session-Qualität ein. */}
        <Row
          label={t('rigs.scheduler.qualityHfr')}
          hint={t('rigs.scheduler.qualityHfrHint')}
          control={`${uid}-q-hfr`}
          changed={changed('imageQuality.hfrPct')}
          error={fieldError('imageQuality.hfrPct')}
        >
          <Unit>{t('rigs.scheduler.qualityHfrPrefix')}</Unit>
          <Num
            id={`${uid}-q-hfr`}
            label={unitLabel(t('rigs.scheduler.qualityHfr'), '%')}
            value={quality.hfrPct}
            onChange={(v) => setQuality('hfrPct', v)}
            disabled={disabled}
            invalid={!!fieldError('imageQuality.hfrPct')}
          />
          <Unit>%</Unit>
        </Row>
        <Row
          label={t('rigs.scheduler.qualityStars')}
          hint={t('rigs.scheduler.qualityStarsHint')}
          control={`${uid}-q-stars`}
          changed={changed('imageQuality.starsPct')}
          error={fieldError('imageQuality.starsPct')}
        >
          <Num
            id={`${uid}-q-stars`}
            label={unitLabel(t('rigs.scheduler.qualityStars'), '%')}
            value={quality.starsPct}
            onChange={(v) => setQuality('starsPct', v)}
            disabled={disabled}
            invalid={!!fieldError('imageQuality.starsPct')}
          />
          <Unit>{t('rigs.scheduler.qualityStarsUnit')}</Unit>
        </Row>
        <Row
          label={t('rigs.scheduler.qualityRms')}
          hint={t('rigs.scheduler.qualityFixedLimit')}
          control={`${uid}-q-rms`}
          changed={changed('imageQuality.rmsArcsec')}
          error={fieldError('imageQuality.rmsArcsec')}
        >
          <Num
            id={`${uid}-q-rms`}
            label={unitLabel(t('rigs.scheduler.qualityRms'), '″')}
            value={quality.rmsArcsec}
            onChange={(v) => setQuality('rmsArcsec', v)}
            disabled={disabled}
            invalid={!!fieldError('imageQuality.rmsArcsec')}
          />
          <Unit>″ RMS</Unit>
        </Row>
        <Row
          label={t('rigs.scheduler.qualityCloud')}
          hint={t('rigs.scheduler.qualityCloudHint')}
          control={`${uid}-q-cloud`}
          changed={changed('imageQuality.cloudPct')}
          error={fieldError('imageQuality.cloudPct')}
        >
          <Num
            id={`${uid}-q-cloud`}
            label={unitLabel(t('rigs.scheduler.qualityCloud'), '%')}
            value={quality.cloudPct}
            onChange={(v) => setQuality('cloudPct', v)}
            disabled={disabled}
            invalid={!!fieldError('imageQuality.cloudPct')}
          />
          <Unit>%</Unit>
        </Row>
        <p className={sched.note}>{t('rigs.scheduler.qualityEmpty')}</p>
      </Section>
    ),
    flats: (
      <Section
        id={sectionId('flats')}
        title={t('rigs.scheduler.flatsSection')}
        sub={t('rigs.scheduler.flatsSub')}
      >
        <Row
          label={t('rigs.scheduler.flats')}
          hint={t('rigs.scheduler.flatsHint')}
          control={`${uid}-flats`}
          changed={changed('flatsEnabled')}
        >
          <Switch
            id={`${uid}-flats`}
            checked={draft.flatsEnabled}
            onChange={(v) => set('flatsEnabled', v)}
            disabled={disabled}
          />
        </Row>
        <Row
          sub
          label={t('rigs.scheduler.flatsSource')}
          hint={t(`rigs.flatsSourceHint.${draft.flatsSource}`)}
          changed={changed('flatsSource')}
        >
          <Segmented
            label={t('rigs.scheduler.flatsSource')}
            value={draft.flatsSource}
            options={(['panel', 'sky'] as const).map((s) => ({
              value: s,
              label: t(`rigs.flatsSource.${s}`),
            }))}
            onChange={(v) => set('flatsSource', v)}
            disabled={flatsOff}
          />
        </Row>
        {/* Auto-Flats je Projekt (AP-50b): Modus nur mit Flats, Intervall nur zeitbasiert. */}
        <Row
          sub
          label={t('rigs.scheduler.flatsAuto')}
          hint={t(`rigs.flatsAutoHint.${draft.flatsAutoMode}`)}
          control={`${uid}-flats-auto`}
          changed={changed('flatsAutoMode')}
        >
          <select
            id={`${uid}-flats-auto`}
            className={`${styles.input} ${sched.select}`}
            value={draft.flatsAutoMode}
            disabled={flatsOff}
            onChange={(e) => set('flatsAutoMode', e.target.value as Scheduler['flatsAutoMode'])}
          >
            {flatsAutoModes.map((m) => (
              <option key={m} value={m}>
                {t(`rigs.flatsAutoMode.${m}`)}
              </option>
            ))}
          </select>
        </Row>
        {draft.flatsAutoMode === 'time_based' ? (
          <Row
            sub={2}
            label={t('rigs.scheduler.flatsAutoInterval')}
            control={`${uid}-flats-interval`}
            changed={changed('flatsAutoIntervalDays')}
            error={fieldError('flatsAutoIntervalDays')}
          >
            <Num
              id={`${uid}-flats-interval`}
              label={unitLabel(
                t('rigs.scheduler.flatsAutoInterval'),
                t('rigs.scheduler.flatsAutoDays'),
              )}
              step={1}
              value={draft.flatsAutoIntervalDays}
              onChange={(v) => set('flatsAutoIntervalDays', v ?? 7)}
              disabled={flatsOff}
              invalid={!!fieldError('flatsAutoIntervalDays')}
            />
            <Unit>{t('rigs.scheduler.flatsAutoDays')}</Unit>
          </Row>
        ) : null}
        <Row
          sub
          label={t('rigs.scheduler.flatCount')}
          control={`${uid}-flat-count`}
          changed={changed('flatCount')}
          error={fieldError('flatCount')}
        >
          <Num
            id={`${uid}-flat-count`}
            label={t('rigs.scheduler.flatCount')}
            step={1}
            value={draft.flatCount}
            onChange={(v) => set('flatCount', v ?? 1)}
            disabled={flatsOff}
            invalid={!!fieldError('flatCount')}
          />
        </Row>
        <Row
          sub
          label={t('rigs.scheduler.darkFlats')}
          hint={t('rigs.scheduler.darkFlatCountHint')}
          control={`${uid}-dark-flats`}
          changed={changed('darkFlatsEnabled', 'darkFlatCount')}
          error={fieldError('darkFlatCount')}
        >
          <Num
            label={t('rigs.scheduler.darkFlatCount')}
            step={1}
            value={draft.darkFlatCount}
            onChange={(v) => set('darkFlatCount', v)}
            disabled={flatsOff || !draft.darkFlatsEnabled}
            invalid={!!fieldError('darkFlatCount')}
          />
          <Switch
            id={`${uid}-dark-flats`}
            checked={draft.darkFlatsEnabled}
            onChange={(v) => set('darkFlatsEnabled', v)}
            disabled={flatsOff}
          />
        </Row>
        <Row
          sub
          label={t('rigs.scheduler.flatsFullSet')}
          hint={t('rigs.scheduler.flatsFullSetHint')}
          control={`${uid}-full-set`}
          changed={changed('flatsFullSet')}
        >
          <Switch
            id={`${uid}-full-set`}
            checked={draft.flatsFullSet}
            onChange={(v) => set('flatsFullSet', v)}
            disabled={flatsOff}
          />
        </Row>
      </Section>
    ),
    times: (
      <Section
        id={sectionId('times')}
        title={t('rigs.scheduler.timesSection')}
        sub={t('rigs.scheduler.timesSub', { min: rig.overheads?.minSamples ?? 10 })}
      >
        <TimesTable
          rig={rig}
          draft={draft}
          fixed={fixed}
          disabled={disabled}
          changed={changed}
          fieldError={fieldError}
          sec={(s) =>
            s >= 120
              ? t('rigs.measured.secondsMin', { s: num.format(s), min: num.format(s / 60) })
              : t('rigs.measured.seconds', { s: num.format(s) })
          }
          onTyped={(key, v) =>
            key === 'flipDurationS' ? set('flipDurationS', v ?? 0) : setOverhead(key, v)
          }
          onFixed={setFixed}
        />
        <Row
          label={t('rigs.overhead.afEveryMin')}
          hint={
            draft.overhead.afEveryMin === 0 ? t('rigs.overhead.afOff') : t('rigs.overhead.afHint')
          }
          control={`${uid}-af-every`}
          changed={changed('overhead.afEveryMin')}
          error={fieldError('overhead.afEveryMin')}
        >
          <Num
            id={`${uid}-af-every`}
            label={unitLabel(t('rigs.overhead.afEveryMin'), 'min')}
            value={draft.overhead.afEveryMin}
            onChange={(v) => setOverhead('afEveryMin', v)}
            disabled={disabled}
            invalid={!!fieldError('overhead.afEveryMin')}
          />
          <Unit>min</Unit>
        </Row>
      </Section>
    ),
  };

  return (
    <form className={sched.form} onSubmit={submit} aria-labelledby={`${uid}-title`} noValidate>
      <div className={sched.bar} data-dirty={dirty || undefined}>
        <div className={sched.barTitle}>
          <h3 id={`${uid}-title`}>{t('rigs.scheduler.title')}</h3>
          <span className={styles.muted}>{t('rigs.scheduler.syncHint')}</span>
        </div>
        <span className={sched.spacer} />
        {dirty ? (
          <span className={sched.barState} role="status">
            {t('rigs.scheduler.unsaved', { count: changes.size })}
          </span>
        ) : saved ? (
          <span className={styles.success} role="status">
            {t('equipment.saved')}
          </span>
        ) : (
          <span className={styles.muted}>{t('rigs.scheduler.allSaved')}</span>
        )}
        {canWrite ? (
          <>
            {dirty ? (
              <button type="button" className={styles.button} onClick={discard}>
                {t('rigs.scheduler.discard')}
              </button>
            ) : null}
            <SaveButton disabled={save.isPending || !dirty} />
          </>
        ) : null}
      </div>
      <SaveError
        error={
          code === 'resource.version_conflict' ||
          code === 'rig.sort_chain_invalid' ||
          code === 'rig.flip_settings_invalid'
            ? null
            : save.error
        }
      />
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
      <nav className={sched.nav} aria-label={t('rigs.scheduler.sections')}>
        {SECTIONS.map((key) => (
          <button
            key={key}
            type="button"
            className={sched.chip}
            onClick={() =>
              document
                .getElementById(sectionId(key))
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            {t(`rigs.scheduler.nav.${key}`)}
          </button>
        ))}
      </nav>
      <div className={sched.columns}>
        {COLUMNS.map((col) => (
          <div key={col.join()} className={sched.column}>
            {col.map((key) => (
              <div key={key} className={sched.slot}>
                {sections[key]}
              </div>
            ))}
          </div>
        ))}
      </div>
    </form>
  );
}

// ---- Bausteine ---------------------------------------------------------------------------------------

function Section({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={sched.card} aria-labelledby={`${id}-h`}>
      <header className={sched.cardHead}>
        <h4 id={`${id}-h`}>{title}</h4>
        {sub ? <span className={styles.muted}>{sub}</span> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Zeile: links Name (`<label>`, wenn `control` das Feld nennt) und Erklärung, rechts die Felder. `sub` rückt
 * abhängige Zeilen ein (2 = zweite Stufe); `changed` setzt den Punkt am Rand, `error` steht unter der Erklärung.
 */
function Row({
  label,
  hint,
  control,
  sub,
  changed,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  control?: string;
  sub?: boolean | 2;
  changed?: boolean;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={sched.row}
      data-sub={sub === 2 ? '2' : sub ? '1' : undefined}
      data-changed={changed || undefined}
      data-error={error ? true : undefined}
    >
      <div className={sched.rowText}>
        {control ? (
          <label htmlFor={control} className={sched.rowLabel}>
            {label}
          </label>
        ) : (
          <span className={sched.rowLabel}>{label}</span>
        )}
        {hint ? <span className={sched.rowHint}>{hint}</span> : null}
        {error ? <span className={styles.fieldError}>{error}</span> : null}
      </div>
      <div className={sched.rowControl}>{children}</div>
    </div>
  );
}

function Unit({ children }: { children: ReactNode }) {
  return (
    <span className={sched.unit} aria-hidden>
      {children}
    </span>
  );
}

function Num({
  id,
  label,
  value,
  onChange,
  step = 'any',
  disabled,
  invalid,
}: {
  id?: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number | 'any';
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <NumberInput
      {...(id ? { id } : {})}
      className={`${styles.input} ${sched.num}`}
      aria-label={label}
      aria-invalid={invalid || undefined}
      step={step}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

/** Schalter (Checkbox mit `role="switch"`); der Name kommt vom `<label>` der Zeile. */
function Switch({
  id,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className={sched.switch}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
  disabled?: boolean;
}) {
  return (
    <div className={sched.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={sched.segment}
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Zeiten für die Planung (AP-65): je Schritt eingetragen, gemessen (Median, n) und „fest“. Gemessen wirkt ab
 * `minSamples` Messungen, solange „fest“ aus ist – die Zeile zeigt dann „wirkt“ an der Messung.
 */
function TimesTable({
  rig,
  draft,
  fixed,
  disabled,
  changed,
  fieldError,
  sec,
  onTyped,
  onFixed,
}: {
  rig: RigView;
  draft: Scheduler;
  fixed: ReadonlySet<OverheadValueKey>;
  disabled: boolean;
  changed: (...paths: string[]) => boolean;
  fieldError: (path: string) => string | undefined;
  sec: (s: number) => string;
  onTyped: (key: OverheadValueKey, v: number | null) => void;
  onFixed: (key: OverheadValueKey, on: boolean) => void;
}) {
  const { t } = useTranslation();
  const minSamples = rig.overheads?.minSamples ?? 10;
  const measuredOf = (key: OverheadValueKey) =>
    rig.overheads?.values.find((v) => v.key === key) ?? null;
  return (
    <table className={sched.times}>
      <thead>
        <tr>
          <th scope="col">{t('rigs.scheduler.timesCol.step')}</th>
          <th scope="col">{t('rigs.scheduler.timesCol.typed')}</th>
          <th scope="col">{t('rigs.scheduler.timesCol.measured')}</th>
          <th scope="col" className={sched.center}>
            {t('rigs.scheduler.timesCol.fixed')}
          </th>
        </tr>
      </thead>
      <tbody>
        {overheadValueKeys.map((key) => {
          const name = t(`rigs.measured.key.${key}`);
          const fieldPath = key === 'flipDurationS' ? key : path('overhead', key);
          const typed = key === 'flipDurationS' ? draft.flipDurationS : draft.overhead[key];
          const off =
            disabled ||
            (key === 'afDurationS' && draft.overhead.afEveryMin === 0) ||
            (key === 'flipDurationS' && !draft.flipEnabled);
          const v = measuredOf(key);
          const m = v?.measured ?? null;
          const enough = m !== null && m.n >= minSamples;
          const active = enough && !fixed.has(key);
          const error = fieldError(fieldPath);
          return (
            <tr
              key={key}
              data-changed={changed(fieldPath, 'overheadFixed') || undefined}
              data-error={error ? true : undefined}
            >
              <th scope="row">
                {name}
                {error ? <span className={styles.fieldError}>{error}</span> : null}
              </th>
              <td>
                <span className={sched.rowControl}>
                  <Num
                    label={`${name} (s)`}
                    value={typed}
                    onChange={(n) => onTyped(key, n)}
                    disabled={off}
                    invalid={!!error}
                  />
                  <Unit>s</Unit>
                </span>
              </td>
              <td>
                {m ? (
                  <span className={sched.measured}>
                    <span className={active ? sched.measuredActive : undefined}>
                      {sec(m.medianS)}
                    </span>
                    <span className={styles.muted}>n = {m.n}</span>
                    {active ? (
                      <span className={sched.tagOk}>{t('rigs.scheduler.timesActive')}</span>
                    ) : !enough ? (
                      <span className={styles.muted}>{t('rigs.scheduler.timesTooFew')}</span>
                    ) : null}
                    {v?.deviates ? (
                      <span className={sched.tagWarn}>{t('rigs.measured.deviates')}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className={styles.muted}>{t('rigs.measured.none')}</span>
                )}
              </td>
              <td className={sched.center}>
                <input
                  type="checkbox"
                  checked={fixed.has(key)}
                  disabled={disabled}
                  aria-label={t('rigs.measured.fixedAt', { value: name })}
                  onChange={(e) => onFixed(key, e.target.checked)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
