/**
 * S-14 Filter & Belichtungsplan-Vorlagen (FA-FIL-01…06, FA-BPL-01…06; FK 14.3): links Filterformular,
 * rechts oben Reiter *Meine Sammlung* (Tabelle, Filter nach Teleskop, Summen nach Typ) / *Spektrum*
 * (Durchlasskurven aus Zentralwellenlänge und Bandbreite), rechts unten der Vorlagen-Editor.
 */
import { filterTypes, FilterInput, photometricBands } from '@nina-pm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FilterView } from '../../api/client';
import { useCan } from '../../auth';
import { FilterChip } from '../../components/FilterChip';
import styles from './equipment.module.css';
import {
  CheckField,
  DeleteDialog,
  EquipmentLayout,
  FormActions,
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
import { TemplateEditor } from './TemplateEditor';

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
    <EquipmentLayout title={t('equipment.filters.title')}>
      <div className={styles.layoutTwo}>
        <form className={styles.form} onSubmit={submit} aria-labelledby="filter-form-title">
          <div className={styles.formTitle}>
            <h2 id="filter-form-title">
              {editor.selected ? editor.selected.shortName : t('equipment.filters.new')}
            </h2>
            {canWrite ? (
              <button type="button" className={styles.button} onClick={() => editor.startNew()}>
                {t('equipment.new')}
              </button>
            ) : null}
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
        <div className={styles.stack}>
          <section className={styles.panel} aria-label={t('equipment.filters.collection')}>
            <div className={styles.tabs} role="tablist" aria-label={t('equipment.filters.views')}>
              {(['collection', 'spectrum'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`filter-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={`filter-panel-${key}`}
                  aria-current={tab === key ? 'page' : undefined}
                  className={styles.tab}
                  onClick={() => setTab(key)}
                >
                  {t(`equipment.filters.view.${key}`)}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`filter-panel-${tab}`} aria-labelledby={`filter-tab-${tab}`}>
              {tab === 'collection' ? (
                <FilterCollection
                  filters={editor.items}
                  state={
                    editor.list.isError ? 'error' : editor.list.isPending ? 'loading' : 'ready'
                  }
                  telescopes={telescopes.data ?? []}
                  selectedId={editor.selectedId}
                  onSelect={editor.select}
                />
              ) : (
                <FilterSpectrum filters={editor.items} />
              )}
            </div>
          </section>
          <TemplateEditor canWrite={canWrite} />
        </div>
      </div>
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
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('equipment.filters.field.shortName')}</th>
                <th>{t('equipment.filters.field.fullName')}</th>
                <th>{t('equipment.field.brand')}</th>
                <th>{t('equipment.filters.field.type')}</th>
                <th className={styles.num}>{t('equipment.filters.field.bandwidth')}</th>
                <th>{t('equipment.filters.field.size')}</th>
                <th>{t('equipment.filters.field.telescope')}</th>
                <th>{t('equipment.filters.default')}</th>
                <th className={styles.num}>{t('equipment.filters.field.defaultExposure')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} aria-selected={f.id === selectedId}>
                  <td>
                    <button
                      type="button"
                      className={styles.pickItem}
                      aria-current={f.id === selectedId ? 'true' : undefined}
                      onClick={() => onSelect(f.id)}
                    >
                      <FilterChip shortName={f.shortName} color={f.colorHex} title={f.shortName} />
                      <span>{f.shortName}</span>
                    </button>
                  </td>
                  <td>{f.fullName}</td>
                  <td>{f.brand}</td>
                  <td>{t(`equipment.filterType.${f.filterType}`)}</td>
                  <td className={styles.num}>
                    {f.bandwidthNm === null ? '–' : `${num(f.bandwidthNm, 1)} nm`}
                  </td>
                  <td>{f.size ?? ''}</td>
                  <td>{telescopeName(f.telescopeId)}</td>
                  <td>{f.defaultOnNewProject ? t('equipment.yes') : ''}</td>
                  <td className={styles.num}>
                    {f.defaultExposureS === null ? '–' : `${num(f.defaultExposureS, 0)} s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.muted} data-testid="filter-sums">
        {byType.map((x) => `${t(`equipment.filterType.${x.type}`)}: ${String(x.n)}`).join(' · ')}
      </p>
    </div>
  );
}

/** Spektrum 300–1100 nm: Durchlassbereich als Trapez aus Zentralwellenlänge ± Bandbreite/2. */
const LAMBDA_MIN = 300;
const LAMBDA_MAX = 1100;

export function filterPassband(f: {
  centerWavelengthNm: number | null;
  bandwidthNm: number | null;
}): { from: number; to: number } | null {
  if (f.centerWavelengthNm === null || f.bandwidthNm === null) return null;
  return {
    from: Math.max(LAMBDA_MIN, f.centerWavelengthNm - f.bandwidthNm / 2),
    to: Math.min(LAMBDA_MAX, f.centerWavelengthNm + f.bandwidthNm / 2),
  };
}

function FilterSpectrum({ filters }: { filters: FilterView[] }) {
  const { t } = useTranslation();
  const num = useNumber();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const W = 800;
  const H = 200;
  const x = (nm: number) => ((nm - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN)) * W;
  const withBand = filters.filter((f) => filterPassband(f));
  const without = filters.filter((f) => !filterPassband(f));
  return (
    <figure className={styles.listEditor}>
      <div className={styles.legend}>
        {withBand.map((f) => (
          <FilterChip
            key={f.id}
            shortName={f.shortName}
            color={f.colorHex}
            selected={!hidden.has(f.id)}
            onToggle={() =>
              setHidden((h) => {
                const next = new Set(h);
                if (next.has(f.id)) next.delete(f.id);
                else next.add(f.id);
                return next;
              })
            }
            title={f.fullName || f.shortName}
          />
        ))}
      </div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${String(W)} ${String(H + 24)}`}
        role="img"
        aria-label={t('equipment.filters.spectrumLabel')}
      >
        {[400, 500, 600, 700, 800, 900, 1000].map((nm) => (
          <g key={nm}>
            <line className={styles.chartAxis} x1={x(nm)} x2={x(nm)} y1={0} y2={H} />
            <text className={styles.chartLabel} x={x(nm)} y={H + 16} textAnchor="middle">
              {nm}
            </text>
          </g>
        ))}
        <line className={styles.chartAxis} x1={0} x2={W} y1={H} y2={H} />
        {withBand
          .filter((f) => !hidden.has(f.id))
          .map((f) => {
            const band = filterPassband(f);
            if (!band) return null;
            const top = H - ((f.transmissionPct ?? 90) / 100) * (H - 10);
            const edge = Math.min(4, (x(band.to) - x(band.from)) / 4);
            return (
              <polygon
                key={f.id}
                points={`${String(x(band.from))},${String(H)} ${String(x(band.from) + edge)},${String(top)} ${String(x(band.to) - edge)},${String(top)} ${String(x(band.to))},${String(H)}`}
                fill={f.colorHex}
                fillOpacity={0.35}
                stroke={f.colorHex}
                strokeWidth={2}
              />
            );
          })}
      </svg>
      <figcaption className={styles.muted}>{t('equipment.filters.spectrumAxis')}</figcaption>
      {without.length > 0 ? (
        <p className={styles.muted}>
          {t('equipment.filters.spectrumMissing', {
            names: without.map((f) => f.shortName).join(', '),
          })}
        </p>
      ) : null}
      <details className={styles.details}>
        <summary>{t('equipment.textAlternative')}</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('equipment.filters.field.shortName')}</th>
              <th className={styles.num}>{t('equipment.filters.field.center')}</th>
              <th className={styles.num}>{t('equipment.filters.field.bandwidth')}</th>
              <th className={styles.num}>{t('equipment.filters.field.transmission')}</th>
            </tr>
          </thead>
          <tbody>
            {withBand.map((f) => (
              <tr key={f.id}>
                <td>{f.shortName}</td>
                <td className={styles.num}>{num(f.centerWavelengthNm, 1)} nm</td>
                <td className={styles.num}>{num(f.bandwidthNm, 1)} nm</td>
                <td className={styles.num}>
                  {f.transmissionPct === null ? '–' : `${num(f.transmissionPct, 0)} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
