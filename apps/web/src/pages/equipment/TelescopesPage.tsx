/**
 * S-12 Teleskope (FA-TEL-01…03; FK 14.3): Listen-/Detail-Muster (AP-26b) – links Auswahl, rechts
 * Formular mit aufklappbaren optionalen Daten und berechneten Werten (nativ, mit Reducer, Dawes/Rayleigh, Airy, Lichtsammelvermögen).
 * Die Modellbibliothek (FA-TEL-04, K) ist nicht Teil von AP-09b.
 */
import { opticalDesigns, telescopeDerived, TelescopeInput } from '@nina-pm/shared';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TelescopeView } from '../../api/client';
import { useCan } from '../../auth';
import styles from './equipment.module.css';
import {
  DeleteDialog,
  EquipmentLayout,
  FormActions,
  ListDetail,
  NewButton,
  NumberField,
  PickList,
  SelectField,
  TextField,
  UsageNotice,
  useEditor,
  useFieldError,
  useNumber,
} from './shared';

interface TelescopeDraft {
  name: string;
  brand: string;
  model: string;
  opticalDesign: (typeof opticalDesigns)[number];
  apertureMm: number | null;
  focalLengthMm: number | null;
  reducerFactor: number | null;
  obstructionPct: number | null;
  imageCircleMm: number | null;
  backfocusMm: number | null;
  weightKg: number | null;
  notes: string;
}

const toDraft = (t: TelescopeView): TelescopeDraft => ({
  name: t.name,
  brand: t.brand,
  model: t.model,
  opticalDesign: t.opticalDesign,
  apertureMm: t.apertureMm,
  focalLengthMm: t.focalLengthMm,
  reducerFactor: t.reducerFactor,
  obstructionPct: t.obstructionPct,
  imageCircleMm: t.imageCircleMm,
  backfocusMm: t.backfocusMm,
  weightKg: t.weightKg,
  notes: t.notes,
});

const empty = (): TelescopeDraft => ({
  name: '',
  brand: '',
  model: '',
  opticalDesign: 'apochromatic_refractor',
  apertureMm: null,
  focalLengthMm: null,
  reducerFactor: 1,
  obstructionPct: 0,
  imageCircleMm: null,
  backfocusMm: null,
  weightKg: null,
  notes: '',
});

/** Pupille des dunkeladaptierten Auges (mm) als Bezug des Lichtsammelvermögens. */
const EYE_PUPIL_MM = 7;

export function TelescopesPage() {
  const { t } = useTranslation();
  const canWrite = useCan('equipment.write');
  const editor = useEditor({ kind: 'telescopes', schema: TelescopeInput, toDraft, empty });
  const fieldError = useFieldError(editor.errors);
  const num = useNumber();
  const d = editor.draft;
  const disabled = !canWrite;
  const { apertureMm, focalLengthMm, reducerFactor } = d;
  const derived =
    apertureMm !== null &&
    apertureMm > 0 &&
    focalLengthMm !== null &&
    focalLengthMm > 0 &&
    reducerFactor !== null &&
    reducerFactor > 0
      ? {
          ...telescopeDerived({ apertureMm, focalLengthMm, reducerFactor }),
          // Fläche relativ zur Pupille, abzüglich der Obstruktion (Durchmesser in %).
          lightGathering:
            (apertureMm / EYE_PUPIL_MM) ** 2 * (1 - ((d.obstructionPct ?? 0) / 100) ** 2),
        }
      : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void editor.submit();
  };
  return (
    <EquipmentLayout
      title={t('equipment.telescopes.title')}
      actions={canWrite ? <NewButton onClick={() => editor.startNew()} /> : null}
    >
      <ListDetail
        state={editor.listState}
        list={
          <PickList
            label={t('equipment.telescopes.list')}
            items={editor.items}
            selectedId={editor.selectedId}
            onSelect={editor.select}
            state={editor.listState}
            onRetry={() => void editor.list.refetch()}
            searchText={(s: TelescopeView) => `${s.name} ${s.brand} ${s.model}`}
            emptyText={t('equipment.telescopes.empty')}
            render={(s: TelescopeView) => (
              <>
                <span>{s.name}</span>
                <span className={styles.pickMeta}>
                  {num(s.apertureMm, 0)}/{num(s.focalLengthMm * s.reducerFactor, 0)}
                </span>
              </>
            )}
          />
        }
        detail={
          editor.hasDetail ? (
            <form className={styles.form} onSubmit={submit} aria-labelledby="telescope-form-title">
              <div className={styles.formTitle}>
                <h2 id="telescope-form-title">
                  {editor.selected ? editor.selected.name : t('equipment.telescopes.new')}
                </h2>
              </div>
              {editor.del.usage ? (
                <UsageNotice usage={editor.del.usage} onClose={editor.del.clearUsage} />
              ) : null}
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
                <SelectField
                  label={t('equipment.telescopes.field.opticalDesign')}
                  value={d.opticalDesign}
                  onChange={(v) => editor.set('opticalDesign', v)}
                  options={opticalDesigns.map((o) => ({
                    value: o,
                    label: t(`equipment.opticalDesign.${o}`),
                  }))}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.telescopes.field.aperture')}
                  unit="mm"
                  value={d.apertureMm}
                  onChange={(v) => editor.set('apertureMm', v)}
                  error={fieldError('apertureMm')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.telescopes.field.focalLength')}
                  unit="mm"
                  value={d.focalLengthMm}
                  onChange={(v) => editor.set('focalLengthMm', v)}
                  error={fieldError('focalLengthMm')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.telescopes.field.reducer')}
                  value={d.reducerFactor}
                  step={0.01}
                  onChange={(v) => editor.set('reducerFactor', v)}
                  error={fieldError('reducerFactor')}
                  hint={t('equipment.telescopes.reducerHint')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.telescopes.field.obstruction')}
                  unit="%"
                  value={d.obstructionPct}
                  onChange={(v) => editor.set('obstructionPct', v)}
                  error={fieldError('obstructionPct')}
                  disabled={disabled}
                />
              </div>
              <details className={styles.details}>
                <summary>{t('equipment.telescopes.optional')}</summary>
                <div className={styles.grid}>
                  <NumberField
                    label={t('equipment.telescopes.field.imageCircle')}
                    unit="mm"
                    value={d.imageCircleMm}
                    onChange={(v) => editor.set('imageCircleMm', v)}
                    error={fieldError('imageCircleMm')}
                    disabled={disabled}
                  />
                  <NumberField
                    label={t('equipment.telescopes.field.backfocus')}
                    unit="mm"
                    value={d.backfocusMm}
                    onChange={(v) => editor.set('backfocusMm', v)}
                    error={fieldError('backfocusMm')}
                    disabled={disabled}
                  />
                  <NumberField
                    label={t('equipment.telescopes.field.weight')}
                    unit="kg"
                    value={d.weightKg}
                    onChange={(v) => editor.set('weightKg', v)}
                    error={fieldError('weightKg')}
                    disabled={disabled}
                  />
                </div>
              </details>
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
                onDelete={editor.onDelete((s) => s.name)}
              />
            </form>
          ) : null
        }
        aside={
          <aside className={styles.derived} aria-labelledby="telescope-derived">
            <h2 id="telescope-derived">{t('equipment.derived')}</h2>
            {derived ? (
              <dl>
                <dt>{t('equipment.telescopes.derived.fRatioNative')}</dt>
                <dd>f/{num(derived.fRatioNative, 2)}</dd>
                <dt>{t('equipment.telescopes.derived.effFocal')}</dt>
                <dd>{num(derived.effFocalMm, 1)} mm</dd>
                <dt>{t('equipment.telescopes.derived.fRatioEffective')}</dt>
                <dd>f/{num(derived.fRatioEffective, 2)}</dd>
                <dt>{t('equipment.telescopes.derived.dawes')}</dt>
                <dd>{num(derived.dawesArcsec, 2)}″</dd>
                <dt>{t('equipment.telescopes.derived.rayleigh')}</dt>
                <dd>{num(derived.rayleighArcsec, 2)}″</dd>
                <dt>{t('equipment.telescopes.derived.airy')}</dt>
                <dd>{num(derived.airyDiskUm, 2)} µm</dd>
                <dt>{t('equipment.telescopes.derived.lightGathering')}</dt>
                <dd>{num(derived.lightGathering, 0)}×</dd>
              </dl>
            ) : (
              <p className={styles.muted}>{t('equipment.telescopes.derivedMissing')}</p>
            )}
          </aside>
        }
      />
      <DeleteDialog dialog={editor.del.dialog} />
    </EquipmentLayout>
  );
}
