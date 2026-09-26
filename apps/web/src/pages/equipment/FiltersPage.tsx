/**
 * S-14 Filter & Belichtungsplan-Vorlagen (FA-FIL-01…06, FA-BPL-01…06; FK 14.3) im Listen-/Detail-Muster
 * (AP-26b): links Reiter *Meine Sammlung* (Tabelle, Filter nach Teleskop, Summen nach Typ; Klick auf den
 * Kurznamen wählt den Filter) / *Spektrum* (Durchlasskurven aus Zentralwellenlänge und Bandbreite), rechts
 * das Filterformular; darunter die Belichtungsplan-Vorlagen im selben Muster.
 */
import { filterTypes, FilterInput, photometricBands } from '@nina-pm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilterView } from '../../api/client';
import { useCan } from '../../auth';
import { DataTable, type DataColumn } from '../../components/DataTable';
import { FilterChip } from '../../components/FilterChip';
import { Tabs } from '../../components/Tabs';
import styles from './equipment.module.css';
import {
  CheckField,
  DeleteDialog,
  EquipmentLayout,
  FormActions,
  ListDetail,
  NewButton,
  NumberField,
  SelectField,
  TextField,
  UsageNotice,
  useEditor,
  useEquipmentList,
  useFieldError,
  useMoonProfileLabel,
  useNumber,
} from './shared';
import { FilterSpectrum } from './FilterSpectrum';
import { TemplateEditor } from './TemplateEditor';

export { filterPassband } from './FilterSpectrum';

interface FilterDraft {
  shortName: string;
  fullName: string;
  brand: string;
  filterType: (typeof filterTypes)[number];
  telescopeId: string | null;
  size: string | null;
  shape: string | null;
  mountType: string | null;
  bandwidthNm: number | null;
  centerWavelengthNm: number | null;
  photometricBand: (typeof photometricBands)[number];
  transmissionPct: number | null;
  thicknessMm: number | null;
  colorHex: string;
  defaultOnNewProject: boolean;
  defaultExposureS: number | null;
  defaultMoonProfileId: string | null;
  notes: string;
}

const toDraft = (f: FilterView): FilterDraft => ({
  shortName: f.shortName,
  fullName: f.fullName,
  brand: f.brand,
  filterType: f.filterType,
  telescopeId: f.telescopeId,
  size: f.size,
  shape: f.shape,
  mountType: f.mountType,
  bandwidthNm: f.bandwidthNm,
  centerWavelengthNm: f.centerWavelengthNm,
  photometricBand: f.photometricBand,
  transmissionPct: f.transmissionPct,
  thicknessMm: f.thicknessMm,
  colorHex: f.colorHex,
  defaultOnNewProject: f.defaultOnNewProject,
  defaultExposureS: f.defaultExposureS,
  defaultMoonProfileId: f.defaultMoonProfileId,
  notes: f.notes,
});

const empty = (): FilterDraft => ({
  shortName: '',
  fullName: '',
  brand: '',
  filterType: 'narrowband',
  telescopeId: null,
  size: null,
  shape: null,
  mountType: null,
  bandwidthNm: null,
  centerWavelengthNm: null,
  photometricBand: 'none',
  transmissionPct: null,
  thicknessMm: null,
  colorHex: '#CCCCCC',
  defaultOnNewProject: false,
  defaultExposureS: null,
  defaultMoonProfileId: null,
  notes: '',
});

const blankToNull = (v: string | null) => (v?.trim() ? v.trim() : null);

export function FiltersPage() {
  const { t } = useTranslation();
  const canWrite = useCan('equipment.write');
  const editor = useEditor({ kind: 'filters', schema: FilterInput, toDraft, empty });
  const telescopes = useEquipmentList('telescopes');
  const moonProfiles = useEquipmentList('moon-profiles');
  const fieldError = useFieldError(editor.errors);
  const [tab, setTab] = useState<'collection' | 'spectrum'>('collection');
  const d = editor.draft;
  const disabled = !canWrite;
  const profileName = useMoonProfileLabel();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void editor.submit({
      ...d,
      size: blankToNull(d.size),
      shape: blankToNull(d.shape),
      mountType: blankToNull(d.mountType),
    });
  };
  return (
    <EquipmentLayout
      title={t('equipment.filters.title')}
      actions={canWrite ? <NewButton onClick={() => editor.startNew()} /> : null}
    >
      <ListDetail
        state={editor.listState}
        wideList
        list={
          <section className={styles.panel} aria-label={t('equipment.filters.collection')}>
            <Tabs
              label={t('equipment.filters.views')}
              value={tab}
              onChange={setTab}
              tabs={(['collection', 'spectrum'] as const).map((key) => ({
                key,
                label: t(`equipment.filters.view.${key}`),
              }))}
              panels={{
                collection: (
                  <FilterCollection
                    filters={editor.items}
                    state={editor.listState}
                    telescopes={telescopes.data ?? []}
                    selectedId={editor.selectedId}
                    onSelect={editor.select}
                  />
                ),
                spectrum: <FilterSpectrum filters={editor.items} />,
              }}
            />
          </section>
        }
        detail={
          editor.hasDetail ? (
            <form className={styles.form} onSubmit={submit} aria-labelledby="filter-form-title">
              <div className={styles.formTitle}>
                <h2 id="filter-form-title">
                  {editor.selected ? editor.selected.shortName : t('equipment.filters.new')}
                </h2>
              </div>
              {editor.del.usage ? (
                <UsageNotice usage={editor.del.usage} onClose={editor.del.clearUsage} />
              ) : null}
              <div className={styles.grid}>
                <TextField
                  label={t('equipment.filters.field.shortName')}
                  value={d.shortName}
                  maxLength={20}
                  onChange={(v) => editor.set('shortName', v)}
                  error={fieldError('shortName')}
                  hint={t('equipment.filters.shortNameHint')}
                  disabled={disabled}
                />
                <TextField
                  label={t('equipment.filters.field.fullName')}
                  value={d.fullName}
                  onChange={(v) => editor.set('fullName', v)}
                  disabled={disabled}
                />
                <TextField
                  label={t('equipment.field.brand')}
                  value={d.brand}
                  onChange={(v) => editor.set('brand', v)}
                  disabled={disabled}
                />
                <SelectField
                  label={t('equipment.filters.field.type')}
                  value={d.filterType}
                  onChange={(v) => editor.set('filterType', v)}
                  options={filterTypes.map((f) => ({
                    value: f,
                    label: t(`equipment.filterType.${f}`),
                  }))}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.filters.field.bandwidth')}
                  unit="nm"
                  value={d.bandwidthNm}
                  onChange={(v) => editor.set('bandwidthNm', v)}
                  error={fieldError('bandwidthNm')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.filters.field.center')}
                  unit="nm"
                  value={d.centerWavelengthNm}
                  onChange={(v) => editor.set('centerWavelengthNm', v)}
                  error={fieldError('centerWavelengthNm')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.filters.field.transmission')}
                  unit="%"
                  value={d.transmissionPct}
                  onChange={(v) => editor.set('transmissionPct', v)}
                  error={fieldError('transmissionPct')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.filters.field.thickness')}
                  unit="mm"
                  value={d.thicknessMm}
                  onChange={(v) => editor.set('thicknessMm', v)}
                  error={fieldError('thicknessMm')}
                  disabled={disabled}
                />
                <TextField
                  label={t('equipment.filters.field.size')}
                  value={d.size ?? ''}
                  maxLength={40}
                  onChange={(v) => editor.set('size', v)}
                  disabled={disabled}
                />
                <TextField
                  label={t('equipment.filters.field.shape')}
                  value={d.shape ?? ''}
                  maxLength={40}
                  onChange={(v) => editor.set('shape', v)}
                  disabled={disabled}
                />
                <TextField
                  label={t('equipment.filters.field.mount')}
                  value={d.mountType ?? ''}
                  maxLength={40}
                  onChange={(v) => editor.set('mountType', v)}
                  disabled={disabled}
                />
                <div className={styles.field}>
                  <label htmlFor="filter-color">{t('equipment.filters.field.color')}</label>
                  <div className={styles.inline}>
                    <input
                      id="filter-color"
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(d.colorHex) ? d.colorHex : '#cccccc'}
                      disabled={disabled}
                      onChange={(e) => editor.set('colorHex', e.target.value.toUpperCase())}
                    />
                    <FilterChip shortName={d.shortName || '?'} color={d.colorHex} />
                  </div>
                </div>
                <SelectField
                  label={t('equipment.filters.field.photometricBand')}
                  value={d.photometricBand}
                  onChange={(v) => editor.set('photometricBand', v)}
                  options={photometricBands.map((b) => ({
                    value: b,
                    label: b === 'none' ? t('equipment.filters.bandNone') : b,
                  }))}
                  hint={t('equipment.filters.bandHint')}
                  disabled={disabled}
                />
                <SelectField
                  label={t('equipment.filters.field.telescope')}
                  value={d.telescopeId ?? ''}
                  onChange={(v) => editor.set('telescopeId', v === '' ? null : v)}
                  options={[
                    { value: '', label: t('equipment.none') },
                    ...(telescopes.data ?? []).map((tel) => ({ value: tel.id, label: tel.name })),
                  ]}
                  hint={t('equipment.filters.telescopeHint')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.filters.field.defaultExposure')}
                  unit="s"
                  value={d.defaultExposureS}
                  onChange={(v) => editor.set('defaultExposureS', v)}
                  error={fieldError('defaultExposureS')}
                  disabled={disabled}
                />
                <SelectField
                  label={t('equipment.filters.field.defaultMoonProfile')}
                  value={d.defaultMoonProfileId ?? ''}
                  onChange={(v) => editor.set('defaultMoonProfileId', v === '' ? null : v)}
                  options={[
                    { value: '', label: t('equipment.none') },
                    ...(moonProfiles.data ?? []).map((m) => ({
                      value: m.id,
                      label: profileName(m.name),
                    })),
                  ]}
                  disabled={disabled}
                />
              </div>
              <CheckField
                label={t('equipment.filters.field.defaultOnNewProject')}
                checked={d.defaultOnNewProject}
                onChange={(v) => editor.set('defaultOnNewProject', v)}
                disabled={disabled}
              />
              <TextField
                label={t('equipment.field.notes')}
                value={d.notes}
                maxLength={4000}
                multiline
                onChange={(v) => editor.set('notes', v)}
                disabled={disabled}
              />
              <FormActions
                canWrite={canWrite}
                saving={editor.save.isPending}
                saved={editor.saved}
                error={editor.save.error}
                onDelete={editor.onDelete((s) => s.shortName)}
              />
            </form>
          ) : null
        }
      />
      <TemplateEditor canWrite={canWrite} />
      <DeleteDialog dialog={editor.del.dialog} />
    </EquipmentLayout>
  );
}

function FilterCollection({
  filters,
  state,
  telescopes,
  selectedId,
  onSelect,
}: {
  filters: FilterView[];
  state: 'loading' | 'error' | 'ready';
  telescopes: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const num = useNumber();
  const [telescope, setTelescope] = useState('');
  if (state === 'loading') return <p role="status">{t('common.loading')}</p>;
  const shown = filters.filter((f) => telescope === '' || f.telescopeId === telescope);
  const byType = filterTypes
    .map((ft) => ({ type: ft, n: shown.filter((f) => f.filterType === ft).length }))
    .filter((x) => x.n > 0);
  const telescopeName = (id: string | null) => telescopes.find((x) => x.id === id)?.name ?? '';
  // AP-26a: Kurzname (wählt den Filter zum Bearbeiten) bleibt immer sichtbar, Nebenspalten weichen.
  const columns: DataColumn<FilterView>[] = [
    {
      id: 'shortName',
      header: t('equipment.filters.field.shortName'),
      sortValue: (f) => f.shortName,
      nowrap: true,
      cell: (f) => (
        <button
          type="button"
          className={styles.pickItem}
          aria-current={f.id === selectedId ? 'true' : undefined}
          onClick={() => onSelect(f.id)}
        >
          <FilterChip shortName={f.shortName} color={f.colorHex} title={f.shortName} />
          <span>{f.shortName}</span>
        </button>
      ),
    },
    {
      id: 'fullName',
      header: t('equipment.filters.field.fullName'),
      sortValue: (f) => f.fullName,
      priority: 2,
      cell: (f) => f.fullName,
    },
    {
      id: 'brand',
      header: t('equipment.field.brand'),
      sortValue: (f) => f.brand,
      priority: 4,
      cell: (f) => f.brand,
    },
    {
      id: 'type',
      header: t('equipment.filters.field.type'),
      sortValue: (f) => t(`equipment.filterType.${f.filterType}`),
      priority: 2,
      cell: (f) => t(`equipment.filterType.${f.filterType}`),
    },
    {
      id: 'bandwidth',
      header: t('equipment.filters.field.bandwidth'),
      sortValue: (f) => f.bandwidthNm,
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (f) => (f.bandwidthNm === null ? '–' : `${num(f.bandwidthNm, 1)} nm`),
    },
    {
      id: 'size',
      header: t('equipment.filters.field.size'),
      sortValue: (f) => f.size,
      priority: 4,
      cell: (f) => f.size ?? '',
    },
    {
      id: 'telescope',
      header: t('equipment.filters.field.telescope'),
      sortValue: (f) => telescopeName(f.telescopeId),
      priority: 3,
      cell: (f) => telescopeName(f.telescopeId),
    },
    {
      id: 'default',
      header: t('equipment.filters.default'),
      sortValue: (f) => f.defaultOnNewProject,
      priority: 4,
      cell: (f) => (f.defaultOnNewProject ? t('equipment.yes') : ''),
    },
    {
      id: 'defaultExposure',
      header: t('equipment.filters.field.defaultExposure'),
      sortValue: (f) => f.defaultExposureS,
      priority: 3,
      align: 'end',
      nowrap: true,
      cell: (f) => (f.defaultExposureS === null ? '–' : `${num(f.defaultExposureS, 0)} s`),
    },
  ];
  return (
    <div className={styles.listEditor}>
      <SelectField
        label={t('equipment.filters.byTelescope')}
        value={telescope}
        onChange={setTelescope}
        options={[
          { value: '', label: t('equipment.all') },
          ...telescopes.map((x) => ({ value: x.id, label: x.name })),
        ]}
      />
      {shown.length === 0 ? (
        <p className={styles.muted}>{t('equipment.filters.empty')}</p>
      ) : (
        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(f) => f.id}
          rowLabel={(f) => f.shortName}
          label={t('equipment.filters.collection')}
          rowProps={(f) => ({ 'aria-selected': f.id === selectedId })}
        />
      )}
      <p className={styles.muted} data-testid="filter-sums">
        {byType.map((x) => `${t(`equipment.filterType.${x.type}`)}: ${String(x.n)}`).join(' · ')}
      </p>
    </div>
  );
}
