/**
 * Vorlagen-Editor unter der Filtersammlung (FA-BPL-01…06, FK 14.3 S-14): Teleskop + Kamera wählen,
 * Vorlage wählen / *Neu* / *Löschen*, Name, Zeilen (Filter, Belichtung, Anzahl, Stunden, Mondprofil,
 * Gain, Offset, Auslesemodus, Binning, aktiv), *+ Filter*, *Vorlage speichern*. Gain/Offset leer =
 * NINA-Standard (NT-38); Binning und Auslesemodus nur aus der gewählten Kamera (FA-KAM-06).
 */
import { ExposureTemplateInput } from '@nina-pm/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExposureTemplateView } from '../../api/client';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import styles from './equipment.module.css';
import {
  DeleteDialog,
  FormActions,
  SelectField,
  TextField,
  UsageNotice,
  useEditor,
  useEquipmentList,
  useFieldError,
  useMoonProfileLabel,
  useNumber,
} from './shared';

interface LineDraft {
  filterId: string;
  exposureS: number | null;
  plannedCount: number | null;
  gain: number | null;
  offsetAdu: number | null;
  binning: number;
  readoutMode: string | null;
  moonMode: 'profile' | 'project_default' | 'none';
  moonProfileId: string | null;
  enabled: boolean;
}

interface TemplateDraft {
  name: string;
  telescopeId: string | null;
  cameraId: string | null;
  notes: string;
  lines: LineDraft[];
}

const toDraft = (v: ExposureTemplateView): TemplateDraft => ({
  name: v.name,
  telescopeId: v.telescopeId,
  cameraId: v.cameraId,
  notes: v.notes,
  lines: v.lines.map((l) => ({
    filterId: l.filterId ?? '',
    exposureS: l.exposureS,
    plannedCount: l.plannedCount,
    gain: l.gain,
    offsetAdu: l.offsetAdu,
    binning: l.binning,
    readoutMode: l.readoutMode,
    moonMode: l.moonMode,
    moonProfileId: l.moonProfileId,
    enabled: l.enabled,
  })),
});

const empty = (): TemplateDraft => ({
  name: '',
  telescopeId: null,
  cameraId: null,
  notes: '',
  lines: [],
});

/** Auswahlwert des Mondprofils: Profil-ID oder die beiden Sonderfälle. */
const moonValue = (l: LineDraft) =>
  l.moonMode === 'profile' ? (l.moonProfileId ?? '') : `:${l.moonMode}`;

export function TemplateEditor({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation();
  const num = useNumber();
  const editor = useEditor({
    kind: 'exposure-templates',
    schema: ExposureTemplateInput,
    toDraft,
    empty,
  });
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const filters = useEquipmentList('filters');
  const moonProfiles = useEquipmentList('moon-profiles');
  const fieldError = useFieldError(editor.errors);
  const [telescopeId, setTelescopeId] = useState('');
  const [cameraId, setCameraId] = useState('');
  const d = editor.draft;
  const disabled = !canWrite;
  const camera = (cameras.data ?? []).find((c) => c.id === (d.cameraId ?? cameraId));
  const profileName = useMoonProfileLabel();
  const matching = editor.items.filter(
    (v) =>
      (telescopeId === '' || v.telescopeId === telescopeId) &&
      (cameraId === '' || v.cameraId === cameraId),
  );
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    editor.set(
      'lines',
      d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    );
  const addLine = () => {
    const first = filters.data?.[0];
    editor.set('lines', [
      ...d.lines,
      {
        filterId: first?.id ?? '',
        exposureS: first?.defaultExposureS ?? 300,
        plannedCount: 10,
        gain: camera?.defaultGain ?? null,
        offsetAdu: camera?.defaultOffset ?? null,
        binning: camera?.defaultBinning ?? 1,
        readoutMode: null,
        moonMode: first?.defaultMoonProfileId ? 'profile' : 'project_default',
        moonProfileId: first?.defaultMoonProfileId ?? null,
        enabled: true,
      },
    ]);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void editor.submit({
      ...d,
      telescopeId: d.telescopeId ?? (telescopeId || null),
      cameraId: d.cameraId ?? (cameraId || null),
    });
  };
  const Add = actionIcons.add;
  const Delete = actionIcons.delete;
  const totalHours = d.lines
    .filter((l) => l.enabled)
    .reduce((s, l) => s + ((l.exposureS ?? 0) * (l.plannedCount ?? 0)) / 3600, 0);
  return (
    <section className={styles.panel} aria-labelledby="template-title">
      <div className={styles.formTitle}>
        <h2 id="template-title">{t('equipment.templates.title')}</h2>
      </div>
      <div className={styles.grid}>
        <SelectField
          label={t('equipment.templates.telescope')}
          value={telescopeId}
          onChange={setTelescopeId}
          options={[
            { value: '', label: t('equipment.all') },
            ...(telescopes.data ?? []).map((x) => ({ value: x.id, label: x.name })),
          ]}
        />
        <SelectField
          label={t('equipment.templates.camera')}
          value={cameraId}
          onChange={setCameraId}
          options={[
            { value: '', label: t('equipment.all') },
            ...(cameras.data ?? []).map((x) => ({ value: x.id, label: x.name })),
          ]}
        />
        <SelectField
          label={t('equipment.templates.template')}
          value={editor.selectedId ?? ''}
          onChange={(v) => (v === '' ? editor.startNew() : editor.select(v))}
          options={[
            { value: '', label: t('equipment.templates.newOption') },
            ...matching.map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
      </div>
      <form
        className={styles.listEditor}
        onSubmit={submit}
        aria-label={t('equipment.templates.form')}
      >
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
          <SelectField
            label={t('equipment.templates.telescope')}
            value={d.telescopeId ?? ''}
            onChange={(v) => editor.set('telescopeId', v === '' ? null : v)}
            options={[
              { value: '', label: t('equipment.none') },
              ...(telescopes.data ?? []).map((x) => ({ value: x.id, label: x.name })),
            ]}
            disabled={disabled}
          />
          <SelectField
            label={t('equipment.templates.camera')}
            value={d.cameraId ?? ''}
            onChange={(v) => editor.set('cameraId', v === '' ? null : v)}
            options={[
              { value: '', label: t('equipment.none') },
              ...(cameras.data ?? []).map((x) => ({ value: x.id, label: x.name })),
            ]}
            disabled={disabled}
          />
        </div>
        {d.lines.length === 0 ? (
          <p className={styles.muted}>{t('equipment.templates.noLines')}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('equipment.templates.col.filter')}</th>
                  <th>{t('equipment.templates.col.exposure')}</th>
                  <th>{t('equipment.templates.col.count')}</th>
                  <th className={styles.num}>{t('equipment.templates.col.hours')}</th>
                  <th>{t('equipment.templates.col.moon')}</th>
                  <th>{t('equipment.templates.col.gain')}</th>
                  <th>{t('equipment.templates.col.offset')}</th>
                  <th>{t('equipment.templates.col.readout')}</th>
                  <th>{t('equipment.templates.col.binning')}</th>
                  <th>{t('equipment.templates.col.enabled')}</th>
                  {canWrite ? <th aria-label={t('equipment.actions')} /> : null}
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l, i) => {
                  const n = String(i + 1);
                  const invalid = (key: string) =>
                    editor.errors[['lines', i, key].join('.')] ? true : undefined;
                  const numberCell = (
                    key: 'exposureS' | 'plannedCount' | 'gain' | 'offsetAdu',
                    label: string,
                  ) => (
                    <td>
                      <input
                        className={styles.input}
                        type="number"
                        step={key === 'exposureS' ? 'any' : 1}
                        aria-label={`${label} ${n}`}
                        value={l[key] ?? ''}
                        disabled={disabled}
                        aria-invalid={invalid(key)}
                        placeholder={key === 'gain' || key === 'offsetAdu' ? 'NINA' : undefined}
                        onChange={(e) =>
                          setLine(i, {
                            [key]: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                  );
                  return (
                    <tr key={i}>
                      <td>
                        <select
                          className={styles.input}
                          aria-label={`${t('equipment.templates.col.filter')} ${n}`}
                          value={l.filterId}
                          disabled={disabled}
                          aria-invalid={invalid('filterId')}
                          onChange={(e) => setLine(i, { filterId: e.target.value })}
                        >
                          <option value="">–</option>
                          {(filters.data ?? []).map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.shortName}
                            </option>
                          ))}
                        </select>
                      </td>
                      {numberCell('exposureS', t('equipment.templates.col.exposure'))}
                      {numberCell('plannedCount', t('equipment.templates.col.count'))}
                      <td className={styles.num}>
                        {num(((l.exposureS ?? 0) * (l.plannedCount ?? 0)) / 3600, 1)}
                      </td>
                      <td>
                        <select
                          className={styles.input}
                          aria-label={`${t('equipment.templates.col.moon')} ${n}`}
                          value={moonValue(l)}
                          disabled={disabled}
                          aria-invalid={invalid('moonProfileId')}
                          onChange={(e) => {
                            const v = e.target.value;
                            setLine(
                              i,
                              v.startsWith(':')
                                ? {
                                    moonMode: v.slice(1) as LineDraft['moonMode'],
                                    moonProfileId: null,
                                  }
                                : { moonMode: 'profile', moonProfileId: v || null },
                            );
                          }}
                        >
                          <option value=":project_default">
                            {t('equipment.templates.moonProjectDefault')}
                          </option>
                          <option value=":none">{t('equipment.templates.moonNone')}</option>
                          {(moonProfiles.data ?? []).map((m) => (
                            <option key={m.id} value={m.id}>
                              {profileName(m.name)}
                            </option>
                          ))}
                        </select>
                      </td>
                      {numberCell('gain', t('equipment.templates.col.gain'))}
                      {numberCell('offsetAdu', t('equipment.templates.col.offset'))}
                      <td>
                        <select
                          className={styles.input}
                          aria-label={`${t('equipment.templates.col.readout')} ${n}`}
                          value={l.readoutMode ?? ''}
                          disabled={disabled}
                          aria-invalid={invalid('readoutMode')}
                          onChange={(e) =>
                            setLine(i, {
                              readoutMode: e.target.value === '' ? null : e.target.value,
                            })
                          }
                        >
                          <option value="">{t('equipment.templates.cameraDefault')}</option>
                          {(camera?.readoutModes ?? []).map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className={styles.input}
                          aria-label={`${t('equipment.templates.col.binning')} ${n}`}
                          value={String(l.binning)}
                          disabled={disabled}
                          aria-invalid={invalid('binning')}
                          onChange={(e) => setLine(i, { binning: Number(e.target.value) })}
                        >
                          {(camera?.supportedBinning ?? [1, 2, 3, 4]).map((b) => (
                            <option key={b} value={String(b)}>
                              {b}×{b}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${t('equipment.templates.col.enabled')} ${n}`}
                          checked={l.enabled}
                          disabled={disabled}
                          onChange={(e) => setLine(i, { enabled: e.target.checked })}
                        />
                      </td>
                      {canWrite ? (
                        <td>
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={t('equipment.removeRow', { n: i + 1 })}
                            onClick={() =>
                              editor.set(
                                'lines',
                                d.lines.filter((_, j) => j !== i),
                              )
                            }
                          >
                            <Delete size={ICON_SIZE.table} aria-hidden />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.muted}>
          {t('equipment.templates.total', { hours: num(totalHours, 1) })}
        </p>
        {canWrite ? (
          <button type="button" className={styles.button} onClick={addLine}>
            <Add size={ICON_SIZE.table} aria-hidden />
            {t('equipment.templates.addLine')}
          </button>
        ) : null}
        <FormActions
          canWrite={canWrite}
          saving={editor.save.isPending}
          saved={editor.saved}
          error={editor.save.error}
          onDelete={editor.onDelete((s) => s.name)}
        />
      </form>
      <DeleteDialog dialog={editor.del.dialog} />
    </section>
  );
}
