/**
 * S-15 Mondprofile (FA-MON-01/02; FK 14.3; moon.md §1): Liste (mitgelieferte Profile gesperrt, klonbar),
 * Formular mit den sechs Parametern (Validierung `minAlt < maxAlt` u. a. über das Schema aus
 * `packages/shared`) und das Avoidance-Diagramm über den Mondzyklus mit Vorschau der Änderung.
 * `maxAlt` ist die Höhe, **ab der** der volle Abstand gilt; `relax` ist Grad je Grad, kein Multiplikator.
 */
import { MoonProfileInput } from '@nina-pm/shared';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MoonProfileView } from '../../api/client';
import { useCan } from '../../auth';
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
  TextField,
  UsageNotice,
  useEditor,
  useFieldError,
  useMoonProfileLabel,
  useNumber,
} from './shared';

interface MoonDraft {
  name: string;
  description: string;
  separationDeg: number | null;
  widthDays: number | null;
  relaxScale: number | null;
  moonMinAltDeg: number | null;
  moonMaxAltDeg: number | null;
  maxIlluminationPct: number | null;
  moonMustBeDown: boolean;
}

const toDraft = (m: MoonProfileView): MoonDraft => ({
  name: m.name,
  description: m.description,
  separationDeg: m.separationDeg,
  widthDays: m.widthDays,
  relaxScale: m.relaxScale,
  moonMinAltDeg: m.moonMinAltDeg,
  moonMaxAltDeg: m.moonMaxAltDeg,
  maxIlluminationPct: m.maxIlluminationPct,
  moonMustBeDown: m.moonMustBeDown,
});

const empty = (): MoonDraft => ({
  name: '',
  description: '',
  separationDeg: 60,
  widthDays: 5,
  relaxScale: 2,
  moonMinAltDeg: -15,
  moonMaxAltDeg: 5,
  maxIlluminationPct: 60,
  moonMustBeDown: false,
});

/** Mitgelieferte Profile in der Reihenfolge aus moon.md, danach die eigenen. */
const BUILT_IN_ORDER = [
  'moonProfile.none',
  'moonProfile.strict',
  'moonProfile.moderate',
  'moonProfile.relaxed',
];
const order = (m: MoonProfileView) => {
  const i = BUILT_IN_ORDER.indexOf(m.name);
  return m.isBuiltIn && i >= 0 ? i : BUILT_IN_ORDER.length;
};

/** Halber synodischer Monat in Tagen (x-Achse: Tage bis/seit Vollmond). */
const HALF_CYCLE = 14.77;

interface Params {
  A: number;
  W: number;
  relax: number;
  minAlt: number;
  maxAlt: number;
}

/**
 * Geforderter Abstand bei Mondhöhe `alt` und `d` Tagen vom Vollmond (moon.md §1, Stufe 4) – nur zur
 * Anzeige; die verbindliche Rechnung liegt in der Engine (AP-10).
 */
export function requiredSeparation(p: Params, d: number, alt: number): number {
  let Ae = p.A;
  let We = p.W;
  if (alt < p.maxAlt) {
    const f = (alt - p.minAlt) / (p.maxAlt - p.minAlt);
    Ae = Math.max(0, p.A - p.relax * (p.maxAlt - alt));
    We = p.W * f;
  }
  return We <= 0 ? 0 : Ae / (1 + (d / We) ** 2);
}

const paramsOf = (d: MoonDraft): Params | null =>
  d.separationDeg === null ||
  d.widthDays === null ||
  d.relaxScale === null ||
  d.moonMinAltDeg === null ||
  d.moonMaxAltDeg === null ||
  d.moonMinAltDeg >= d.moonMaxAltDeg
    ? null
    : {
        A: d.separationDeg,
        W: d.widthDays,
        relax: d.relaxScale,
        minAlt: d.moonMinAltDeg,
        maxAlt: d.moonMaxAltDeg,
      };

export function MoonProfilesPage() {
  const { t } = useTranslation();
  const canWrite = useCan('equipment.write');
  const editor = useEditor({ kind: 'moon-profiles', schema: MoonProfileInput, toDraft, empty });
  const fieldError = useFieldError(editor.errors);
  const d = editor.draft;
  const builtIn = editor.selected?.isBuiltIn ?? false;
  const disabled = !canWrite || builtIn;
  const label = useMoonProfileLabel();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!builtIn) void editor.submit();
  };
  const Lock = actionIcons.lock;
  const Clone = actionIcons.clone;
  const minMaxError =
    d.moonMinAltDeg !== null && d.moonMaxAltDeg !== null && d.moonMinAltDeg >= d.moonMaxAltDeg
      ? t('equipment.moonProfiles.minBelowMax')
      : undefined;
  return (
    <EquipmentLayout
      title={t('equipment.moonProfiles.title')}
      actions={canWrite ? <NewButton onClick={() => editor.startNew()} /> : null}
    >
      <ListDetail
        state={editor.listState}
        list={
          <PickList
            label={t('equipment.moonProfiles.list')}
            items={[...editor.items].sort((a, b) => order(a) - order(b))}
            selectedId={editor.selectedId}
            onSelect={editor.select}
            state={editor.listState}
            onRetry={() => void editor.list.refetch()}
            searchText={(m: MoonProfileView) => label(m.name)}
            emptyText={t('equipment.moonProfiles.empty')}
            render={(m: MoonProfileView) => (
              <>
                <span>{label(m.name)}</span>
                {m.isBuiltIn ? (
                  <span className={styles.pickMeta}>
                    <Lock size={ICON_SIZE.table} aria-hidden />
                    {t('equipment.moonProfiles.builtIn')}
                  </span>
                ) : null}
              </>
            )}
          />
        }
        detail={
          editor.hasDetail ? (
            <form className={styles.card} onSubmit={submit} aria-labelledby="moon-form-title">
              <DetailHead
                titleId="moon-form-title"
                title={
                  editor.selected ? label(editor.selected.name) : t('equipment.moonProfiles.new')
                }
                canWrite={canWrite}
                canSave={canWrite && !builtIn}
                saving={editor.save.isPending}
                saved={editor.saved}
                onDelete={builtIn ? undefined : editor.onDelete((s) => s.name)}
                tools={
                  canWrite && editor.selected ? (
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() =>
                        editor.startNew({
                          ...d,
                          name: t('equipment.moonProfiles.cloneName', { name: label(d.name) }),
                        })
                      }
                    >
                      <Clone size={ICON_SIZE.button} aria-hidden />
                      {t('equipment.moonProfiles.clone')}
                    </button>
                  ) : null
                }
              />
              <div className={styles.cardBody}>
                <SaveError error={editor.save.error} />
                {builtIn ? (
                  <p className={styles.note} role="note">
                    {t('equipment.moonProfiles.builtInHint')}
                  </p>
                ) : null}
                {editor.del.usage ? (
                  <UsageNotice usage={editor.del.usage} onClose={editor.del.clearUsage} />
                ) : null}
                <section className={styles.section} aria-labelledby="moon-general">
                  <h3 id="moon-general">{t('equipment.section.general')}</h3>
                  <div className={styles.grid}>
                    <TextField
                      label={t('equipment.field.name')}
                      value={builtIn ? label(d.name) : d.name}
                      onChange={(v) => editor.set('name', v)}
                      error={fieldError('name')}
                      disabled={disabled}
                    />
                    <TextField
                      label={t('equipment.moonProfiles.field.description')}
                      value={d.description}
                      maxLength={1000}
                      onChange={(v) => editor.set('description', v)}
                      disabled={disabled}
                      wide
                    />
                  </div>
                </section>
                <section className={styles.section} aria-labelledby="moon-params">
                  <h3 id="moon-params">{t('equipment.moonProfiles.params')}</h3>
                  <div className={styles.grid}>
                    <NumberField
                      label={t('equipment.moonProfiles.field.separation')}
                      unit="°"
                      value={d.separationDeg}
                      onChange={(v) => editor.set('separationDeg', v)}
                      error={fieldError('separationDeg')}
                      hint={t('equipment.moonProfiles.hint.separation')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.moonProfiles.field.width')}
                      unit={t('equipment.moonProfiles.days')}
                      value={d.widthDays}
                      onChange={(v) => editor.set('widthDays', v)}
                      error={fieldError('widthDays')}
                      hint={t('equipment.moonProfiles.hint.width')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.moonProfiles.field.relax')}
                      unit="°/°"
                      value={d.relaxScale}
                      onChange={(v) => editor.set('relaxScale', v)}
                      error={fieldError('relaxScale')}
                      hint={t('equipment.moonProfiles.hint.relax')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.moonProfiles.field.minAlt')}
                      unit="°"
                      value={d.moonMinAltDeg}
                      onChange={(v) => editor.set('moonMinAltDeg', v)}
                      error={fieldError('moonMinAltDeg') ?? minMaxError}
                      hint={t('equipment.moonProfiles.hint.minAlt')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.moonProfiles.field.maxAlt')}
                      unit="°"
                      value={d.moonMaxAltDeg}
                      onChange={(v) => editor.set('moonMaxAltDeg', v)}
                      error={fieldError('moonMaxAltDeg')}
                      hint={t('equipment.moonProfiles.hint.maxAlt')}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t('equipment.moonProfiles.field.maxIllumination')}
                      unit="%"
                      value={d.maxIlluminationPct}
                      onChange={(v) => editor.set('maxIlluminationPct', v)}
                      error={fieldError('maxIlluminationPct')}
                      hint={t('equipment.moonProfiles.hint.maxIllumination')}
                      disabled={disabled}
                    />
                  </div>
                  <CheckField
                    label={t('equipment.moonProfiles.field.mustBeDown')}
                    checked={d.moonMustBeDown}
                    onChange={(v) => editor.set('moonMustBeDown', v)}
                    disabled={disabled}
                  />
                </section>
              </div>
            </form>
          ) : null
        }
        aside={
          <aside className={styles.derived} aria-labelledby="moon-chart-title">
            <h2 id="moon-chart-title">{t('equipment.moonProfiles.chart')}</h2>
            <AvoidanceChart
              draft={paramsOf(d)}
              saved={editor.selected ? paramsOf(toDraft(editor.selected)) : null}
              mustBeDown={d.moonMustBeDown}
            />
          </aside>
        }
      />
      <DeleteDialog dialog={editor.del.dialog} />
    </EquipmentLayout>
  );
}

/** Geforderter Abstand über den Mondzyklus (Mond ab `maxAlt`, voller Abstand) – gespeichert gegen Entwurf. */
function AvoidanceChart({
  draft,
  saved,
  mustBeDown,
}: {
  draft: Params | null;
  saved: Params | null;
  mustBeDown: boolean;
}) {
  const { t } = useTranslation();
  const num = useNumber();
  if (mustBeDown)
    return <p className={styles.muted}>{t('equipment.moonProfiles.mustBeDownChart')}</p>;
  if (!draft) return <p className={styles.muted}>{t('equipment.moonProfiles.chartMissing')}</p>;
  const W = 320;
  const H = 180;
  const steps = Array.from({ length: 31 }, (_, i) => (i / 30) * HALF_CYCLE);
  const x = (d: number) => 30 + (d / HALF_CYCLE) * (W - 40);
  const y = (sep: number) => H - 20 - (sep / 180) * (H - 30);
  const path = (p: Params) =>
    steps
      .map(
        (d, i) =>
          `${i === 0 ? 'M' : 'L'}${x(d).toFixed(1)},${y(requiredSeparation(p, d, p.maxAlt)).toFixed(1)}`,
      )
      .join(' ');
  const changed = saved && JSON.stringify(saved) !== JSON.stringify(draft);
  return (
    <figure className={styles.listEditor}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label={t('equipment.moonProfiles.chartLabel')}
      >
        {[0, 45, 90, 135, 180].map((sep) => (
          <g key={sep}>
            <line className={styles.chartAxis} x1={30} x2={W - 10} y1={y(sep)} y2={y(sep)} />
            <text className={styles.chartLabel} x={26} y={y(sep) + 4} textAnchor="end">
              {sep}°
            </text>
          </g>
        ))}
        {[0, 3.5, 7, 10.5, 14].map((d) => (
          <text key={d} className={styles.chartLabel} x={x(d)} y={H - 4} textAnchor="middle">
            {num(d, d % 1 === 0 ? 0 : 1)}
          </text>
        ))}
        {changed && saved ? (
          <path
            d={path(saved)}
            fill="none"
            stroke="var(--npm-text-light)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ) : null}
        <path d={path(draft)} fill="none" stroke="var(--npm-accent)" strokeWidth={2} />
      </svg>
      <figcaption className={styles.legend}>
        <span>{t('equipment.moonProfiles.chartAxis')}</span>
        {changed ? <span>{t('equipment.moonProfiles.chartPreview')}</span> : null}
      </figcaption>
      <details className={styles.details}>
        <summary>{t('equipment.textAlternative')}</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('equipment.moonProfiles.daysFromFull')}</th>
              <th className={styles.num}>{t('equipment.moonProfiles.required')}</th>
              {changed ? (
                <th className={styles.num}>{t('equipment.moonProfiles.requiredSaved')}</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 5, 7, 10, 14].map((d) => (
              <tr key={d}>
                <td>{d}</td>
                <td className={styles.num}>
                  {num(requiredSeparation(draft, d, draft.maxAlt), 1)}°
                </td>
                {changed && saved ? (
                  <td className={styles.num}>
                    {num(requiredSeparation(saved, d, saved.maxAlt), 1)}°
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
