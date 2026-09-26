/**
 * S-13 Kameras (FA-KAM-01…08; FK 14.3): Formular mit Grunddaten, Standard-Betriebspunkt (Gain/Offset
 * `null` = NINA-Standard, NT-38), Rauschmodell, Gain-Modi und Auslesemodi als Listen-Editor, Binning-
 * Stufen, Kühlung (Soll/Toleranz, NT-E2). Listen-/Detail-Muster (AP-26b): links die Kameras, rechts
 * Formular und Reiter *Berechnete Werte* / *Sensorgröße*
 * (maßstäblicher Vergleich mit den übrigen Kameras des Mandanten) und der Hinweis, wenn NINA abweichende
 * Auslesemodi meldet (FA-KAM-07).
 */
import { cameraDerived, CameraInput } from '@nina-pm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraView } from '../../api/client';
import { useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { Tabs } from '../../components/Tabs';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import styles from './equipment.module.css';
import {
  CheckField,
  DeleteDialog,
  DetailHead,
  EquipmentLayout,
  ListDetail,
  NewButton,
  NumberField,
  PickList,
  SaveError,
  SelectField,
  TextField,
  UsageNotice,
  useEditor,
  useFieldError,
  useNumber,
  useRigUsage,
} from './shared';

interface GainModeDraft {
  name: string;
  gain: number | null;
  readNoiseE: number | null;
  fullWellE: number | null;
  ePerAdu: number | null;
}

export interface CameraDraft {
  name: string;
  brand: string;
  model: string;
  sensorName: string;
  widthPx: number | null;
  heightPx: number | null;
  pixelSizeUm: number | null;
  bitDepth: number | null;
  isCooled: boolean;
  coolingSetpointC: number | null;
  coolingToleranceC: number | null;
  isColor: boolean;
  readNoiseE: number | null;
  fullWellE: number | null;
  gainEPerAdu: number | null;
  quantumEfficiencyPct: number | null;
  darkCurrentES20c: number | null;
  defaultGain: number | null;
  defaultOffset: number | null;
  defaultBinning: number;
  defaultReadoutMode: string;
  supportedBinning: number[];
  gainModes: GainModeDraft[];
  readoutModes: string[];
  notes: string;
}

export const cameraDraft = (c: CameraView): CameraDraft => ({
  name: c.name,
  brand: c.brand,
  model: c.model,
  sensorName: c.sensorName,
  widthPx: c.widthPx,
  heightPx: c.heightPx,
  pixelSizeUm: c.pixelSizeUm,
  bitDepth: c.bitDepth,
  isCooled: c.isCooled,
  coolingSetpointC: c.coolingSetpointC,
  coolingToleranceC: c.coolingToleranceC,
  isColor: c.isColor,
  readNoiseE: c.readNoiseE,
  fullWellE: c.fullWellE,
  gainEPerAdu: c.gainEPerAdu,
  quantumEfficiencyPct: c.quantumEfficiencyPct,
  darkCurrentES20c: c.darkCurrentES20c,
  defaultGain: c.defaultGain,
  defaultOffset: c.defaultOffset,
  defaultBinning: c.defaultBinning,
  defaultReadoutMode: c.defaultReadoutMode,
  supportedBinning: [...c.supportedBinning],
  gainModes: c.gainModes.map((g) => ({ ...g })),
  readoutModes: [...c.readoutModes],
  notes: c.notes,
});

export const emptyCamera = (): CameraDraft => ({
  name: '',
  brand: '',
  model: '',
  sensorName: '',
  widthPx: null,
  heightPx: null,
  pixelSizeUm: null,
  bitDepth: 16,
  isCooled: true,
  coolingSetpointC: null,
  coolingToleranceC: 1,
  isColor: false,
  readNoiseE: null,
  fullWellE: null,
  gainEPerAdu: null,
  quantumEfficiencyPct: 80,
  darkCurrentES20c: 0.005,
  defaultGain: null,
  defaultOffset: null,
  defaultBinning: 1,
  defaultReadoutMode: 'Default',
  supportedBinning: [1, 2],
  gainModes: [],
  readoutModes: ['Default'],
  notes: '',
});

const BINNINGS = [1, 2, 3, 4] as const;

/** Vom Plugin gemeldete Auslesemodi, die in der Kamera fehlen oder zu viel sind (FA-KAM-07). */
export function readoutMismatch(
  camera: CameraView,
): { missing: string[]; unknown: string[] } | null {
  const reported = (camera.ninaReported as { readoutModes?: unknown } | null)?.readoutModes;
  if (!Array.isArray(reported)) return null;
  const nina = reported.map(String);
  const missing = nina.filter((m) => !camera.readoutModes.includes(m));
  const unknown = camera.readoutModes.filter((m) => !nina.includes(m));
  return missing.length + unknown.length > 0 ? { missing, unknown } : null;
}

type BinnedRow = ReturnType<typeof cameraDerived>['binned'][number];
interface GainRow {
  g: GainModeDraft;
  i: number;
}

export function CamerasPage() {
  const { t } = useTranslation();
  const canWrite = useCan('equipment.write');
  const editor = useEditor({
    kind: 'cameras',
    schema: CameraInput,
    toDraft: cameraDraft,
    empty: emptyCamera,
  });
  const fieldError = useFieldError(editor.errors);
  const num = useNumber();
  const usage = useRigUsage('cameraId', editor.selectedId);
  const [tab, setTab] = useState<'derived' | 'sensor'>('derived');
  const d = editor.draft;
  const disabled = !canWrite;
  const mismatch = editor.selected ? readoutMismatch(editor.selected) : null;
  const { widthPx, heightPx, pixelSizeUm, bitDepth } = d;
  const derived =
    widthPx !== null && heightPx !== null && pixelSizeUm !== null && bitDepth !== null
      ? cameraDerived({
          widthPx,
          heightPx,
          pixelSizeUm,
          bitDepth,
          fullWellE: d.fullWellE,
          readNoiseE: d.readNoiseE,
          supportedBinning: d.supportedBinning,
        })
      : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void editor.submit({
      ...d,
      readoutModes: d.readoutModes.map((m) => m.trim()).filter(Boolean),
      supportedBinning: [...d.supportedBinning].sort((a, b) => a - b),
    });
  };
  // Werte je Binning-Stufe (AP-26a): Binning bleibt immer sichtbar, die übrigen weichen im schmalen Seitenfeld.
  const binningColumns: DataColumn<BinnedRow>[] = [
    {
      id: 'binning',
      header: t('equipment.cameras.field.binning'),
      sortValue: (b) => b.binning,
      nowrap: true,
      cell: (b) => `${String(b.binning)}×${String(b.binning)}`,
    },
    {
      id: 'resolution',
      header: t('equipment.cameras.derived.resolution'),
      sortValue: (b) => b.widthPx * b.heightPx,
      priority: 2,
      align: 'end',
      nowrap: true,
      cell: (b) => `${String(b.widthPx)} × ${String(b.heightPx)}`,
    },
    {
      id: 'pixelSize',
      header: 'µm',
      sortValue: (b) => b.pixelSizeUm,
      priority: 3,
      align: 'end',
      cell: (b) => num(b.pixelSizeUm, 2),
    },
    {
      id: 'megapixels',
      header: 'MP',
      sortValue: (b) => b.megapixels,
      priority: 2,
      align: 'end',
      cell: (b) => num(b.megapixels, 2),
    },
  ];
  const Add = actionIcons.add;
  const Delete = actionIcons.delete;
  // Gain-Modi als Listen-Editor in der Datentabelle (AP-26d): Name und Gain bleiben immer sichtbar.
  const updateGain = (i: number, patch: Partial<GainModeDraft>) =>
    editor.set(
      'gainModes',
      d.gainModes.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    );
  const gainCell =
    (key: 'gain' | 'readNoiseE' | 'fullWellE' | 'ePerAdu', label: string) =>
    ({ g, i }: GainRow) => (
      <input
        className={styles.input}
        type="number"
        step="any"
        aria-label={`${label} ${String(i + 1)}`}
        value={g[key] ?? ''}
        disabled={disabled}
        aria-invalid={editor.errors[['gainModes', i, key].join('.')] ? true : undefined}
        onChange={(e) =>
          updateGain(i, { [key]: e.target.value === '' ? null : Number(e.target.value) })
        }
      />
    );
  const gainColumns: DataColumn<GainRow>[] = [
    {
      id: 'name',
      header: t('equipment.field.name'),
      cell: ({ g, i }) => (
        <input
          className={styles.input}
          aria-label={`${t('equipment.field.name')} ${String(i + 1)}`}
          value={g.name}
          maxLength={60}
          disabled={disabled}
          aria-invalid={editor.errors[['gainModes', i, 'name'].join('.')] ? true : undefined}
          onChange={(e) => updateGain(i, { name: e.target.value })}
        />
      ),
    },
    {
      id: 'gain',
      header: t('equipment.cameras.field.gain'),
      cell: gainCell('gain', t('equipment.cameras.field.gain')),
    },
    {
      id: 'readNoise',
      header: t('equipment.cameras.field.readNoise'),
      priority: 2,
      cell: gainCell('readNoiseE', t('equipment.cameras.field.readNoise')),
    },
    {
      id: 'fullWell',
      header: t('equipment.cameras.field.fullWell'),
      priority: 3,
      cell: gainCell('fullWellE', t('equipment.cameras.field.fullWell')),
    },
    {
      id: 'ePerAdu',
      header: t('equipment.cameras.field.ePerAdu'),
      priority: 3,
      cell: gainCell('ePerAdu', t('equipment.cameras.field.ePerAdu')),
    },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: t('equipment.actions'),
            headerHidden: true,
            cell: ({ i }: GainRow) => (
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t('equipment.removeRow', { n: i + 1 })}
                onClick={() =>
                  editor.set(
                    'gainModes',
                    d.gainModes.filter((_, j) => j !== i),
                  )
                }
              >
                <Delete size={ICON_SIZE.table} aria-hidden />
              </button>
            ),
          },
        ]
      : []),
  ];
  const Warn = actionIcons.warning;
  const toggleBinning = (b: number, on: boolean) =>
    editor.set(
      'supportedBinning',
      on ? [...new Set([...d.supportedBinning, b])] : d.supportedBinning.filter((x) => x !== b),
    );
  return (
    <EquipmentLayout
      title={t('equipment.cameras.title')}
      actions={canWrite ? <NewButton onClick={() => editor.startNew()} /> : null}
    >
      <ListDetail
        state={editor.listState}
        list={
          <PickList
            label={t('equipment.cameras.list')}
            items={editor.items}
            selectedId={editor.selectedId}
            onSelect={editor.select}
            state={editor.listState}
            onRetry={() => void editor.list.refetch()}
            searchText={(c: CameraView) => `${c.name} ${c.brand} ${c.model} ${c.sensorName}`}
            emptyText={t('equipment.cameras.empty')}
            render={(c: CameraView) => (
              <>
                <span>{c.name}</span>
                <span className={styles.pickMeta}>
                  {[
                    c.isColor ? t('equipment.cameras.osc') : t('equipment.cameras.mono'),
                    c.sensorName,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </>
            )}
          />
        }
        detail={
          editor.hasDetail ? (
            <form className={styles.card} onSubmit={submit} aria-labelledby="camera-form-title">
              <DetailHead
                titleId="camera-form-title"
                title={editor.selected ? editor.selected.name : t('equipment.cameras.new')}
                meta={usage}
                canWrite={canWrite}
                saving={editor.save.isPending}
                saved={editor.saved}
                onDelete={editor.onDelete((s) => s.name)}
              />
              <div className={styles.cardBody}>
                <SaveError error={editor.save.error} />
                {editor.del.usage ? (
                  <UsageNotice usage={editor.del.usage} onClose={editor.del.clearUsage} />
                ) : null}
                {mismatch ? (
                  <div className={styles.warning} role="status">
                    <p className={styles.usageTitle}>
                      <Warn size={ICON_SIZE.button} aria-hidden />
                      {t('equipment.cameras.ninaMismatch')}
                    </p>
                    {mismatch.missing.length > 0 ? (
                      <p>
                        {t('equipment.cameras.ninaMissing', { modes: mismatch.missing.join(', ') })}
                      </p>
                    ) : null}
                    {mismatch.unknown.length > 0 ? (
                      <p>
                        {t('equipment.cameras.ninaUnknown', { modes: mismatch.unknown.join(', ') })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <section className={styles.section} aria-labelledby="camera-general">
                  <h3 id="camera-general">{t('equipment.section.general')}</h3>
                  <div className={styles.grid}>
                    <TextField
                      label={t('equipment.field.name')}
                      value={d.name}
                      onChange={(v) => editor.set('name', v)}
                      error={fieldError('name')}
                      disabled={disabled}
                    />
                    <TextField
                      label={t('equipment.field.brand')}
                      value={d.brand}
                      onChange={(v) => editor.set('brand', v)}
                      disabled={disabled}
                    />
                    <TextField
                      label={t('equipment.field.model')}
                      value={d.model}
                      onChange={(v) => editor.set('model', v)}
                      disabled={disabled}
                    />
                    <TextField
                      label={t('equipment.cameras.field.sensorName')}
                      value={d.sensorName}
                      onChange={(v) => editor.set('sensorName', v)}
                      disabled={disabled}
                    />
                  </div>
                </section>
                <section className={styles.section} aria-labelledby="camera-sensor">
                  <h3 id="camera-sensor">{t('equipment.cameras.sensor')}</h3>
                  <div className={styles.grid}>
                    <NumberField
                      label={t('equipment.cameras.field.widthPx')}
                      unit="px"
                      step={1}
                      value={d.widthPx}
                      onChange={(v) => editor.set('widthPx', v)}
                      error={fieldError('widthPx')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.heightPx')}
                      unit="px"
                      step={1}
                      value={d.heightPx}
                      onChange={(v) => editor.set('heightPx', v)}
                      error={fieldError('heightPx')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.pixelSize')}
                      unit="µm"
                      value={d.pixelSizeUm}
                      onChange={(v) => editor.set('pixelSizeUm', v)}
                      error={fieldError('pixelSizeUm')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.bitDepth')}
                      unit="bit"
                      step={1}
                      value={d.bitDepth}
                      onChange={(v) => editor.set('bitDepth', v)}
                      error={fieldError('bitDepth')}
                      disabled={disabled}
                    />
                  </div>
                  <div className={styles.inline}>
                    <CheckField
                      label={t('equipment.cameras.field.isColor')}
                      checked={d.isColor}
                      onChange={(v) => editor.set('isColor', v)}
                      disabled={disabled}
                    />
                    <CheckField
                      label={t('equipment.cameras.field.isCooled')}
                      checked={d.isCooled}
                      onChange={(v) => editor.set('isCooled', v)}
                      disabled={disabled}
                    />
                  </div>
                  <fieldset className={styles.inline}>
                    <legend className={styles.muted}>{t('equipment.cameras.field.binning')}</legend>
                    {BINNINGS.map((b) => (
                      <CheckField
                        key={b}
                        label={`${String(b)}×${String(b)}`}
                        checked={d.supportedBinning.includes(b)}
                        onChange={(on) => toggleBinning(b, on)}
                        disabled={disabled}
                      />
                    ))}
                    {fieldError('supportedBinning') ? (
                      <span className={styles.fieldError}>{fieldError('supportedBinning')}</span>
                    ) : null}
                  </fieldset>
                </section>
                {d.isCooled ? (
                  <div className={styles.section}>
                    <h3>{t('equipment.cameras.cooling')}</h3>
                    <div className={styles.grid}>
                      <NumberField
                        label={t('equipment.cameras.field.coolingSetpoint')}
                        unit="°C"
                        value={d.coolingSetpointC}
                        onChange={(v) => editor.set('coolingSetpointC', v)}
                        error={fieldError('coolingSetpointC')}
                        hint={t('equipment.cameras.coolingHint')}
                        disabled={disabled}
                      />
                      <NumberField
                        label={t('equipment.cameras.field.coolingTolerance')}
                        unit="K"
                        value={d.coolingToleranceC}
                        onChange={(v) => editor.set('coolingToleranceC', v)}
                        error={fieldError('coolingToleranceC')}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                ) : null}
                <div className={styles.section}>
                  <h3>{t('equipment.cameras.operatingPoint')}</h3>
                  <div className={styles.grid}>
                    <NumberField
                      label={t('equipment.cameras.field.defaultGain')}
                      step={1}
                      value={d.defaultGain}
                      onChange={(v) => editor.set('defaultGain', v)}
                      error={fieldError('defaultGain')}
                      hint={t('equipment.ninaDefaultHint')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.defaultOffset')}
                      step={1}
                      value={d.defaultOffset}
                      onChange={(v) => editor.set('defaultOffset', v)}
                      error={fieldError('defaultOffset')}
                      hint={t('equipment.ninaDefaultHint')}
                      disabled={disabled}
                    />
                    <SelectField
                      label={t('equipment.cameras.field.defaultBinning')}
                      value={String(d.defaultBinning)}
                      onChange={(v) => editor.set('defaultBinning', Number(v))}
                      options={[...d.supportedBinning]
                        .sort((a, b) => a - b)
                        .map((b) => ({ value: String(b), label: `${String(b)}×${String(b)}` }))}
                      error={fieldError('defaultBinning')}
                      disabled={disabled}
                    />
                    <SelectField
                      label={t('equipment.cameras.field.defaultReadoutMode')}
                      value={d.defaultReadoutMode}
                      onChange={(v) => editor.set('defaultReadoutMode', v)}
                      options={d.readoutModes.filter(Boolean).map((m) => ({ value: m, label: m }))}
                      error={fieldError('defaultReadoutMode')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.ePerAdu')}
                      unit="e⁻/ADU"
                      value={d.gainEPerAdu}
                      onChange={(v) => editor.set('gainEPerAdu', v)}
                      error={fieldError('gainEPerAdu')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.readNoise')}
                      unit="e⁻"
                      value={d.readNoiseE}
                      onChange={(v) => editor.set('readNoiseE', v)}
                      error={fieldError('readNoiseE')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.fullWell')}
                      unit="e⁻"
                      value={d.fullWellE}
                      onChange={(v) => editor.set('fullWellE', v)}
                      error={fieldError('fullWellE')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.qe')}
                      unit="%"
                      value={d.quantumEfficiencyPct}
                      onChange={(v) => editor.set('quantumEfficiencyPct', v)}
                      error={fieldError('quantumEfficiencyPct')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.cameras.field.darkCurrent')}
                      unit="e⁻/s"
                      value={d.darkCurrentES20c}
                      onChange={(v) => editor.set('darkCurrentES20c', v)}
                      error={fieldError('darkCurrentES20c')}
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className={`${styles.section} ${styles.listEditor}`}>
                  <h3>{t('equipment.cameras.gainModes')}</h3>
                  {d.gainModes.length === 0 ? (
                    <p className={styles.muted}>{t('equipment.cameras.gainModesEmpty')}</p>
                  ) : (
                    <DataTable
                      columns={gainColumns}
                      rows={d.gainModes.map((g, i) => ({ g, i }))}
                      rowKey={(r) => String(r.i)}
                      rowLabel={(r) => r.g.name || String(r.i + 1)}
                      label={t('equipment.cameras.gainModes')}
                    />
                  )}
                  {canWrite ? (
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() =>
                        editor.set('gainModes', [
                          ...d.gainModes,
                          {
                            name: '',
                            gain: null,
                            readNoiseE: null,
                            fullWellE: null,
                            ePerAdu: null,
                          },
                        ])
                      }
                    >
                      <Add size={ICON_SIZE.table} aria-hidden />
                      {t('equipment.cameras.addGainMode')}
                    </button>
                  ) : null}
                </div>
                <div className={`${styles.section} ${styles.listEditor}`}>
                  <h3>{t('equipment.cameras.readoutModes')}</h3>
                  <p className={styles.muted}>{t('equipment.cameras.readoutHint')}</p>
                  <ul className={styles.pickList}>
                    {d.readoutModes.map((m, i) => (
                      <li key={i} className={styles.inline}>
                        <input
                          className={styles.input}
                          aria-label={`${t('equipment.cameras.readoutMode')} ${String(i + 1)}`}
                          value={m}
                          maxLength={60}
                          disabled={disabled}
                          onChange={(e) =>
                            editor.set(
                              'readoutModes',
                              d.readoutModes.map((x, j) => (j === i ? e.target.value : x)),
                            )
                          }
                        />
                        {canWrite && d.readoutModes.length > 1 ? (
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={t('equipment.removeRow', { n: i + 1 })}
                            onClick={() =>
                              editor.set(
                                'readoutModes',
                                d.readoutModes.filter((_, j) => j !== i),
                              )
                            }
                          >
                            <Delete size={ICON_SIZE.table} aria-hidden />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {canWrite ? (
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() => editor.set('readoutModes', [...d.readoutModes, ''])}
                    >
                      <Add size={ICON_SIZE.table} aria-hidden />
                      {t('equipment.cameras.addReadoutMode')}
                    </button>
                  ) : null}
                </div>
                <TextField
                  label={t('equipment.field.notes')}
                  value={d.notes}
                  maxLength={4000}
                  multiline
                  onChange={(v) => editor.set('notes', v)}
                  disabled={disabled}
                />
              </div>
            </form>
          ) : null
        }
        aside={
          <aside className={styles.derived} aria-label={t('equipment.derived')}>
            <Tabs
              label={t('equipment.derived')}
              value={tab}
              onChange={setTab}
              tabs={(['derived', 'sensor'] as const).map((key) => ({
                key,
                label: t(`equipment.cameras.view.${key}`),
              }))}
              panels={{
                derived: derived ? (
                  <>
                    <dl className={styles.kv}>
                      <dt>{t('equipment.cameras.derived.sensorSize')}</dt>
                      <dd>
                        {num(derived.sensorWidthMm, 2)} × {num(derived.sensorHeightMm, 2)} mm
                      </dd>
                      <dt>{t('equipment.cameras.derived.diagonal')}</dt>
                      <dd>{num(derived.sensorDiagonalMm, 2)} mm</dd>
                      <dt>{t('equipment.cameras.derived.megapixels')}</dt>
                      <dd>{num(derived.megapixels, 2)} MP</dd>
                      <dt>{t('equipment.cameras.derived.aspect')}</dt>
                      <dd>{num(derived.aspectRatio, 3)}</dd>
                      <dt>{t('equipment.cameras.derived.dynamicRange')}</dt>
                      <dd>
                        {derived.dynamicRangeStops === null
                          ? '–'
                          : `${num(derived.dynamicRangeStops, 2)} ${t('equipment.cameras.stops')}`}
                      </dd>
                      <dt>{t('equipment.cameras.derived.maxAdu')}</dt>
                      <dd>{num(derived.maxAdu, 0)}</dd>
                    </dl>
                    <p className={styles.muted}>{t('equipment.cameras.perBinning')}</p>
                    <DataTable
                      columns={binningColumns}
                      rows={derived.binned}
                      rowKey={(b) => String(b.binning)}
                      rowLabel={(b) => `${String(b.binning)}×${String(b.binning)}`}
                      label={t('equipment.cameras.perBinning')}
                    />
                  </>
                ) : (
                  <p className={styles.muted}>{t('equipment.cameras.derivedMissing')}</p>
                ),
                sensor: (
                  <SensorComparison
                    current={
                      derived
                        ? {
                            name: d.name || t('equipment.cameras.new'),
                            w: derived.sensorWidthMm,
                            h: derived.sensorHeightMm,
                          }
                        : null
                    }
                    others={editor.items
                      .filter((c) => c.id !== editor.selectedId)
                      .map((c) => ({
                        name: c.name,
                        w: (c.widthPx * c.pixelSizeUm) / 1000,
                        h: (c.heightPx * c.pixelSizeUm) / 1000,
                      }))}
                  />
                ),
              }}
            />
          </aside>
        }
      />
      <DeleteDialog dialog={editor.del.dialog} />
    </EquipmentLayout>
  );
}

/** Gängige Formate (mm) als Bezug des maßstäblichen Vergleichs (FA-KAM-08). */
const FORMATS = [
  { name: 'APS-C', w: 23.5, h: 15.6 },
  { name: 'Four Thirds', w: 17.3, h: 13 },
  { name: '1″', w: 13.2, h: 8.8 },
] as const;

function SensorComparison({
  current,
  others,
}: {
  current: { name: string; w: number; h: number } | null;
  others: { name: string; w: number; h: number }[];
}) {
  const { t } = useTranslation();
  const num = useNumber();
  const shapes = [
    ...(current ? [{ ...current, kind: 'current' as const }] : []),
    ...others.map((o) => ({ ...o, kind: 'other' as const })),
    ...FORMATS.map((f) => ({ ...f, kind: 'format' as const })),
  ];
  const maxW = Math.max(36, ...shapes.map((s) => s.w));
  const maxH = Math.max(24, ...shapes.map((s) => s.h));
  const scale = 240 / Math.max(maxW, maxH * 1.5);
  const colour = {
    current: 'var(--npm-accent)',
    other: 'var(--npm-text-light)',
    format: 'var(--npm-border)',
  };
  return (
    <figure>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${String(maxW * scale + 8)} ${String(maxH * scale + 8)}`}
        role="img"
        aria-label={t('equipment.cameras.sensorCompare')}
      >
        {shapes.map((s) => (
          <rect
            key={`${s.kind}:${s.name}`}
            x={4 + ((maxW - s.w) * scale) / 2}
            y={4 + ((maxH - s.h) * scale) / 2}
            width={s.w * scale}
            height={s.h * scale}
            fill="none"
            stroke={colour[s.kind]}
            strokeWidth={s.kind === 'current' ? 2 : 1}
            strokeDasharray={s.kind === 'format' ? '4 3' : undefined}
          />
        ))}
      </svg>
      <figcaption>
        <ul className={styles.legend}>
          {shapes.map((s) => (
            <li key={`${s.kind}:${s.name}`}>
              <span className={styles.swatch} style={{ borderColor: colour[s.kind] }} />
              {s.name}: {num(s.w, 1)} × {num(s.h, 1)} mm
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
