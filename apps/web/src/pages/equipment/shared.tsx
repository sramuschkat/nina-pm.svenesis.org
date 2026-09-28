/**
 * Gemeinsame Teile der Ausrüstungsseiten S-10…S-15 (AP-09b): Seitengerüst mit Bereichsreitern,
 * Stammdaten-Abfragen, Formularfelder mit zod-Prüfung aus `packages/shared`, das Listen-/Detail-Muster
 * (AP-26b: links Liste, rechts Detail), die Detailkarte mit *Löschen* und *Speichern* im Kartenkopf
 * (Stilsystem AP-26d) und die Löschsperre mit Verwenderliste (FA-RIG-13, `409 resource.in_use`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { equipmentApi, type EquipmentKind, type EquipmentKinds } from '../../api/client';
import { ApiError, useAuth, useCan } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage, problemI18nKey } from '../../components/ProblemMessage';
import styles from './equipment.module.css';
import { SectionTabs, newId, problemCode } from '../admin/shared';

export { newId, problemCode };

export const EQUIPMENT_PATHS = {
  rigs: '/ausruestung/rigs',
  sites: '/ausruestung/standorte',
  telescopes: '/ausruestung/teleskope',
  cameras: '/ausruestung/kameras',
  filters: '/ausruestung/filter',
  moonProfiles: '/ausruestung/mondprofile',
} as const;

/**
 * Seitengerüst der Ausrüstung (Stilsystem AP-26d): `PageHeader` mit dem Seitentitel, der Hauptaktion
 * *Neu…* rechts (`actions`) und den Bereichsreitern unter dem Titel; darunter der Nur-Lese-Hinweis.
 */
export function EquipmentLayout({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const canWrite = useCan('equipment.write');
  return (
    <div className={styles.page}>
      <PageHeader
        title={title}
        actions={actions}
        nav={
          <SectionTabs
            label={t('equipment.tabsLabel')}
            tabs={[
              { to: EQUIPMENT_PATHS.rigs, label: t('rigs.tab') },
              { to: EQUIPMENT_PATHS.sites, label: t('equipment.sites.tab') },
              { to: EQUIPMENT_PATHS.telescopes, label: t('equipment.telescopes.tab') },
              { to: EQUIPMENT_PATHS.cameras, label: t('equipment.cameras.tab') },
              { to: EQUIPMENT_PATHS.filters, label: t('equipment.filters.tab') },
              { to: EQUIPMENT_PATHS.moonProfiles, label: t('equipment.moonProfiles.tab') },
            ]}
          />
        }
      />
      {/* Nur-Lese-Hinweis: User sehen die Stammdaten; ohne 2FA ruhen Admin-Rechte (SV-03). */}
      {canWrite ? null : (
        <p className={styles.readOnly} role="note">
          {me?.mfaRequired ? t('errors.auth.mfaRequired') : t('equipment.readOnly')}
        </p>
      )}
      {children}
    </div>
  );
}

// ---- Abfragen -------------------------------------------------------------------------------------

export const equipmentKey = (kind: EquipmentKind) => ['equipment', kind] as const;

export function useEquipmentList<K extends EquipmentKind>(kind: K) {
  return useQuery({
    queryKey: equipmentKey(kind),
    queryFn: async () => (await equipmentApi.list(kind)).items,
  });
}

/**
 * Speichern (Anlage mit Client-UUID bzw. Änderung) und Löschen einer Objektart. Nach Erfolg wird die
 * Liste neu geladen; Rigs hängen an Standort/Teleskop/Kamera und werden mit aktualisiert.
 */
export function useEquipmentMutations<K extends EquipmentKind>(kind: K) {
  const client = useQueryClient();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: equipmentKey(kind) });
    if (kind !== 'rigs') await client.invalidateQueries({ queryKey: equipmentKey('rigs') });
  };
  const save = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: object }) =>
      id === null
        ? equipmentApi.create(kind, { id: newId(), ...body })
        : equipmentApi.update(kind, id, body),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => equipmentApi.remove(kind, id),
    onSuccess: refresh,
  });
  return { save, remove };
}

export type Item<K extends EquipmentKind> = EquipmentKinds[K];

// ---- Validierung ----------------------------------------------------------------------------------

export type FieldErrors = Readonly<Record<string, string>>;

/** Das Nötige eines zod-Schemas aus `packages/shared` (ohne eigene zod-Abhängigkeit der Web-App). */
export interface Schema<T = unknown> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
      };
}

/** zod-Prüfung mit den Schemas aus `packages/shared`; Fehler je Feldpfad (`lines.0.filterId`). */
export function validate<T>(
  schema: Schema<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.');
    errors[path] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Feldfehler aus Problem Details (`errors[].path` wie `lines[0].filterId`) in dieselbe Form. */
export function serverFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError) || error.problem.code !== 'validation.failed') return {};
  return Object.fromEntries(
    (error.problem.errors ?? []).map((e) => [e.path.replace(/\[(\d+)\]/g, '.$1'), e.message]),
  );
}

// ---- Formularfelder -------------------------------------------------------------------------------

interface FieldBase {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  /** Breite im Raster: `wide` belegt die ganze Zeile. */
  wide?: boolean;
}

/**
 * Beschriftung 12 px über dem Feld; eine Einheit steht rechts neben dem Feld (Stilsystem AP-26d) und bleibt
 * für Screenreader Teil des Feldnamens („Öffnung (mm)“).
 */
function FieldShell({
  id,
  label,
  error,
  hint,
  wide,
  unit,
  children,
}: FieldBase & { id: string; unit?: string | undefined; children: ReactNode }) {
  return (
    <div className={`${styles.field} ${wide ? styles.fieldWide : ''}`}>
      <label htmlFor={id}>
        {label}
        {unit ? <span className="visually-hidden"> ({unit})</span> : null}
      </label>
      {unit ? (
        <div className={styles.control}>
          {children}
          <span className={styles.unit} aria-hidden>
            {unit}
          </span>
        </div>
      ) : (
        children
      )}
      {hint ? (
        <span id={`${id}-hint`} className={styles.muted}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className={styles.fieldError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) =>
  [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

export function TextField({
  value,
  onChange,
  maxLength = 120,
  multiline,
  type = 'text',
  list,
  ...base
}: FieldBase & {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  multiline?: boolean;
  type?: 'text' | 'url';
  list?: string;
}) {
  const id = useId();
  const common = {
    id,
    className: styles.input,
    value,
    maxLength,
    disabled: base.disabled,
    'aria-invalid': base.error ? true : undefined,
    'aria-describedby': describedBy(id, base.hint, base.error),
  } as const;
  return (
    <FieldShell id={id} {...base}>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} list={list} onChange={(e) => onChange(e.target.value)} />
      )}
    </FieldShell>
  );
}

/** Zahl; leer ergibt `null` (optionale Felder) – Pflichtfelder meldet die zod-Prüfung. */
export function NumberField({
  value,
  onChange,
  step = 'any',
  min,
  max,
  unit,
  ...base
}: FieldBase & {
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number | 'any';
  min?: number;
  max?: number;
  unit?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  const [last, setLast] = useState(value);
  // Externe Änderung (anderes Objekt gewählt) übernehmen, ohne die laufende Eingabe zu stören.
  if (value !== last) {
    setLast(value);
    if (value !== (text.trim() === '' ? null : Number(text.replace(',', '.'))))
      setText(value === null ? '' : String(value));
  }
  return (
    <FieldShell id={id} {...base} unit={unit}>
      <input
        id={id}
        className={styles.input}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={text}
        disabled={base.disabled}
        aria-invalid={base.error ? true : undefined}
        aria-describedby={describedBy(id, base.hint, base.error)}
        onChange={(e) => {
          setText(e.target.value);
          const raw = e.target.value.trim();
          const n = raw === '' ? null : Number(raw);
          const next = n === null || Number.isFinite(n) ? n : null;
          setLast(next);
          onChange(next);
        }}
      />
    </FieldShell>
  );
}

export function SelectField<V extends string>({
  value,
  onChange,
  options,
  ...base
}: FieldBase & {
  value: V;
  onChange: (value: V) => void;
  options: readonly { value: V; label: string }[];
}) {
  const id = useId();
  return (
    <FieldShell id={id} {...base}>
      <select
        id={id}
        className={styles.input}
        value={value}
        disabled={base.disabled}
        aria-invalid={base.error ? true : undefined}
        aria-describedby={describedBy(id, base.hint, base.error)}
        onChange={(e) => onChange(e.target.value as V)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

// ---- Liste und Formularrahmen ---------------------------------------------------------------------

/** Hauptaktion *Neu* rechts im Seitenkopf bzw. Abschnittskopf (Titel links, Hauptaktion rechts). */
export function NewButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const { t } = useTranslation();
  const Add = actionIcons.add;
  return (
    <button type="button" className={styles.buttonPrimary} onClick={onClick}>
      <Add size={ICON_SIZE.button} aria-hidden />
      {label ?? t('equipment.new')}
    </button>
  );
}

/**
 * Listen-/Detail-Muster aller Ausrüstungsarten (AP-26b): links die Liste (`PickList` oder eine Tabelle),
 * rechts das gewählte Objekt. Ab 1024 px nebeneinander, darunter untereinander mit kompakter Liste (nie
 * horizontal scrollen). `detail = null` (nichts gewählt, nichts neu) zeigt rechts den Leerzustand.
 * `aside` (berechnete Werte, Diagramm) steht neben dem Formular, wenn Platz ist, sonst darunter.
 * `wideList` gibt der Liste mehr Breite, wenn sie eine Tabelle ist. Solange die Liste lädt oder fehlt
 * (`state`), bleibt die Detailspalte leer – kein aufblitzender Leerzustand.
 */
export function ListDetail({
  list,
  detail,
  aside,
  wideList,
  state = 'ready',
}: {
  list: ReactNode;
  detail: ReactNode | null;
  aside?: ReactNode;
  wideList?: boolean;
  state?: 'loading' | 'error' | 'ready';
}) {
  const { t } = useTranslation();
  const canWrite = useCan('equipment.write');
  return (
    <div className={`${styles.listDetail} ${wideList ? styles.listDetailWide : ''}`}>
      <div className={styles.listColumn}>{list}</div>
      <div className={styles.detailColumn}>
        {state !== 'ready' ? null : detail === null ? (
          <div className={styles.emptyDetail}>
            <p>{canWrite ? t('equipment.emptyDetail') : t('equipment.emptyDetailReadOnly')}</p>
          </div>
        ) : aside ? (
          <div className={styles.detailSplit}>
            {detail}
            {aside}
          </div>
        ) : (
          detail
        )}
      </div>
    </div>
  );
}

/**
 * Auswahlliste links (FK 14.3 „Auswahl +/-“) als Karte: optional Filter (`toolbar`) und Suchfeld, darunter
 * eine Zeile je Objekt als Knopf – Name und darunter eine gedämpfte Metazeile (`render` liefert beide
 * Teile). Die gewählte Zeile ist gefüllt (`--npm-selected-bg`, Name in Linkfarbe, `aria-current`).
 * *Neu* steht im Seitenkopf bzw. Abschnittskopf; `label` benennt die Liste (Region, Suchfeld).
 */
export function PickList<T extends { id: string }>({
  label,
  items,
  selectedId,
  onSelect,
  render,
  state,
  onRetry,
  emptyText,
  searchText,
  toolbar,
}: {
  label: string;
  items: readonly T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  render: (item: T) => ReactNode;
  state: 'loading' | 'error' | 'ready';
  onRetry?: () => void;
  emptyText: string;
  /** Durchsuchbarer Text je Objekt; ohne Angabe kein Suchfeld. */
  searchText?: (item: T) => string;
  /** Filterfelder über der Liste (z. B. Teleskop/Kamera der Vorlagen). */
  toolbar?: ReactNode;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const shown =
    searchText && needle !== ''
      ? items.filter((item) => searchText(item).toLocaleLowerCase().includes(needle))
      : items;
  return (
    <section className={styles.pick} aria-label={label}>
      {toolbar}
      {searchText && state === 'ready' && items.length > 0 ? (
        <input
          type="search"
          className={styles.input}
          value={query}
          placeholder={t('equipment.searchIn', { list: label })}
          aria-label={t('equipment.searchIn', { list: label })}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {state === 'loading' ? (
        <p role="status">{t('common.loading')}</p>
      ) : state === 'error' ? (
        <ProblemMessage code="internal.error" onRetry={onRetry} />
      ) : items.length === 0 ? (
        <p className={styles.muted}>{emptyText}</p>
      ) : shown.length === 0 ? (
        <p className={styles.muted}>{t('equipment.noMatches')}</p>
      ) : (
        <ul className={styles.pickList}>
          {shown.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.pickRow}
                aria-current={item.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
              >
                {render(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Detailkarte ----------------------------------------------------------------------------------

/** *Speichern* (primär); `form` verbindet den Knopf mit einem Formular außerhalb (Rigs: Reiter). */
export function SaveButton({ form, disabled }: { form?: string | undefined; disabled?: boolean }) {
  const { t } = useTranslation();
  const Save = actionIcons.save;
  return (
    <button type="submit" form={form} className={styles.buttonPrimary} disabled={disabled}>
      <Save size={ICON_SIZE.button} aria-hidden />
      {t('equipment.save')}
    </button>
  );
}

/**
 * Kopf der Detailkarte (Stilsystem AP-26d): links der Titel des Objekts (h2) mit gedämpfter Nebeninfo
 * (`meta`, z. B. „in 2 Rigs verwendet“), rechts weitere Werkzeuge (`tools`), *Löschen* (Gefahr, nur Text)
 * und *Speichern* (primär, ganz rechts) samt „Gespeichert.“. Steht der Kopf im Formular, ist *Speichern*
 * dessen Submit-Knopf; sonst verbindet `form` ihn mit dem Formular (Rigs). `canSave = false` blendet
 * *Speichern* aus (z. B. mitgelieferte Mondprofile, Reiter ohne eigenes Formular).
 */
export function DetailHead({
  titleId,
  title,
  meta,
  tools,
  canWrite,
  canSave = canWrite,
  form,
  saving = false,
  saved = false,
  onDelete,
  deleteLabel,
  level = 2,
}: {
  titleId: string;
  title: ReactNode;
  meta?: ReactNode;
  tools?: ReactNode;
  canWrite: boolean;
  canSave?: boolean;
  form?: string | undefined;
  saving?: boolean;
  saved?: boolean;
  onDelete?: (() => void) | undefined;
  deleteLabel?: string;
  /** Überschriftenebene des Titels (3 für eine Karte unter einer eigenen h2). */
  level?: 2 | 3;
}) {
  const { t } = useTranslation();
  const Delete = actionIcons.delete;
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div className={styles.cardHead}>
      <div className={styles.cardTitle}>
        <Heading id={titleId}>{title}</Heading>
        {meta ? <span className={styles.cardMeta}>{meta}</span> : null}
      </div>
      <div className={styles.cardActions}>
        {saved ? (
          <span className={styles.success} role="status">
            {t('equipment.saved')}
          </span>
        ) : null}
        {tools}
        {canWrite && onDelete ? (
          <button type="button" className={styles.buttonDanger} onClick={onDelete}>
            <Delete size={ICON_SIZE.button} aria-hidden />
            {deleteLabel ?? t('equipment.delete')}
          </button>
        ) : null}
        {canSave ? <SaveButton form={form} disabled={saving} /> : null}
      </div>
    </div>
  );
}

/** Fehler des letzten Speicherns im Kartenrumpf (Feldfehler stehen zusätzlich am Feld). */
export function SaveError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const code = error ? problemCode(error) : null;
  if (code === null) return null;
  return code === 'validation.failed' ? (
    <p className={styles.fieldError} role="alert">
      {t('errors.validation.failed')}
    </p>
  ) : (
    <ProblemMessage code={code} />
  );
}

/** Speichern / Abbrechen unter einem eingebetteten Unterformular (Remote-Verbindungen eines Standorts). */
export function FormActions({
  saving,
  error,
  extra,
}: {
  saving: boolean;
  error: unknown;
  extra?: ReactNode;
}) {
  return (
    <div className={styles.formFoot}>
      <SaveError error={error} />
      <div className={styles.actions}>
        <SaveButton disabled={saving} />
        {extra}
      </div>
    </div>
  );
}

/** Nebeninfo einer Stammdaten-Karte: in wie vielen Rigs das Objekt steckt (Standort, Teleskop, Kamera). */
export function useRigUsage(field: 'siteId' | 'telescopeId' | 'cameraId', id: string | null) {
  const { t } = useTranslation();
  const rigs = useEquipmentList('rigs');
  if (id === null || !rigs.data) return null;
  const count = rigs.data.filter((r) => r[field] === id).length;
  return count === 0
    ? t('equipment.usage.none')
    : count === 1
      ? t('equipment.usage.one')
      : t('equipment.usage.many', { count });
}

// ---- Löschen mit Löschsperre ----------------------------------------------------------------------

export interface Usage {
  readonly name: string;
  readonly users: readonly { kind: string; name: string }[];
}

/**
 * Löschen nach `ConfirmDialog`; liefert die API `409 resource.in_use`, schließt der Dialog und die Seite
 * zeigt die Verwender (FA-RIG-13) – der Dialog selbst trägt nur Titel, Folge und Verb.
 */
export function useDeleteWithUsage(run: (id: string) => Promise<unknown>, onDeleted: () => void) {
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [state, setState] = useState<'ready' | 'loading' | 'error'>('ready');
  const [errorKey, setErrorKey] = useState<string | undefined>();
  const [usage, setUsage] = useState<Usage | null>(null);
  return {
    usage,
    clearUsage: () => setUsage(null),
    ask: (id: string, name: string) => {
      setUsage(null);
      setState('ready');
      setTarget({ id, name });
    },
    dialog: {
      open: target !== null,
      name: target?.name ?? '',
      state,
      ...(errorKey ? { errorKey } : {}),
      onCancel: () => setTarget(null),
      onConfirm: async () => {
        if (!target) return;
        setState('loading');
        try {
          await run(target.id);
          setTarget(null);
          onDeleted();
        } catch (e) {
          if (e instanceof ApiError && e.problem.code === 'resource.in_use') {
            setUsage({
              name: target.name,
              users: (e.problem.errors ?? []).map((u) => ({ kind: u.path, name: u.message })),
            });
            setTarget(null);
            return;
          }
          setErrorKey(problemI18nKey(e instanceof ApiError ? e.problem.code : 'internal.error'));
          setState('error');
        }
      },
    },
  };
}

/** Zähl-Arten (`sessions`, `nightPlans`, `nightStats`) tragen eine Anzahl statt eines Namens. */
const COUNT_KINDS = new Set(['sessions', 'nightPlans', 'nightStats', 'activeSession']);

export function UsageNotice({ usage, onClose }: { usage: Usage; onClose: () => void }) {
  const { t } = useTranslation();
  const Warn = actionIcons.warning;
  return (
    <div className={styles.usage} role="alert">
      <p className={styles.usageTitle}>
        <Warn size={ICON_SIZE.button} aria-hidden />
        {t('equipment.inUse.title', { name: usage.name })}
      </p>
      <p>{t('equipment.inUse.hint')}</p>
      <ul>
        {usage.users.map((u) => (
          <li key={`${u.kind}:${u.name}`}>
            {COUNT_KINDS.has(u.kind)
              ? t(`equipment.inUse.count.${u.kind}`, { count: Number(u.name) || 0, id: u.name })
              : `${t(`equipment.inUse.kind.${u.kind}`, { defaultValue: u.kind })}: ${u.name}`}
          </li>
        ))}
      </ul>
      <button type="button" className={styles.button} onClick={onClose}>
        {t('equipment.inUse.close')}
      </button>
    </div>
  );
}

export function DeleteDialog({
  dialog,
}: {
  dialog: ReturnType<typeof useDeleteWithUsage>['dialog'];
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={dialog.open}
      title={t('equipment.deleteTitle', { name: dialog.name })}
      consequence={t('equipment.deleteConsequence')}
      confirmLabel={t('equipment.delete')}
      variant="danger"
      state={dialog.state}
      {...(dialog.errorKey ? { errorKey: dialog.errorKey } : {})}
      onCancel={dialog.onCancel}
      onConfirm={dialog.onConfirm}
    />
  );
}

/** Lade-/Fehlerzustand einer Seite, sonst der Inhalt. */
export function Loadable({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  children: () => ReactNode;
}) {
  const { t } = useTranslation();
  if (query.isError)
    return <ProblemMessage code={problemCode(query.error)} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <p role="status">{t('common.loading')}</p>;
  return <>{children()}</>;
}

/** Zahl in Anzeigeform der Sprache (Nachkommastellen fest). */
export function useNumber() {
  const { i18n } = useTranslation();
  return (value: number | null | undefined, digits = 2) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? '–'
      : new Intl.NumberFormat(i18n.language, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }).format(value);
}

// ---- Auswahl + Formular -------------------------------------------------------------------------

/**
 * Zustand einer Stammdatenseite: Liste, gewähltes Objekt (`null` = neu), Entwurf, Feldfehler (Client-
 * Prüfung mit dem zod-Schema aus `packages/shared`, danach Feldfehler des Servers), Speichern/Löschen.
 */
export function useEditor<K extends EquipmentKind, D extends object>({
  kind,
  schema,
  toDraft,
  empty,
}: {
  kind: K;
  schema: Schema;
  toDraft: (item: Item<K>) => D;
  empty: () => D;
}) {
  const list = useEquipmentList(kind);
  const { save, remove } = useEquipmentMutations(kind);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<D>(empty);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);
  const [picked, setPicked] = useState(false);
  /** Neues Objekt in Arbeit (`selectedId = null`); weder gewählt noch neu → Leerzustand (AP-26b). */
  const [creating, setCreating] = useState(false);
  const items = (list.data ?? []) as Item<K>[];
  // Erstes Objekt vorwählen, sobald die Liste da ist.
  if (!picked && list.data) {
    setPicked(true);
    const first = items[0];
    if (first) {
      setSelectedId(first.id);
      setDraft(toDraft(first));
    }
  }
  // Gewähltes Objekt nicht (mehr) in der Liste – Rest aus dem Cache des vorigen Mandanten oder
  // inzwischen gelöscht: gilt als nicht gewählt (Prüfung 28.09.2026), sonst stünde es weiter rechts und
  // *Speichern* spräche es an. Danach wird wie beim ersten Laden das erste Objekt vorgewählt.
  if (selectedId !== null && list.data && !items.some((i) => i.id === selectedId)) {
    setSelectedId(null);
    setDraft(empty());
    setClientErrors({});
    setSaved(false);
    setPicked(false);
  }
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const reset = () => {
    setClientErrors({});
    setSaved(false);
    save.reset();
  };
  const del = useDeleteWithUsage(
    (id) => remove.mutateAsync(id),
    () => {
      setSelectedId(null);
      setCreating(false);
      setDraft(empty());
      reset();
    },
  );
  return {
    list,
    items,
    selected,
    selectedId,
    creating,
    /** Rechts steht ein Formular: ein Objekt ist gewählt oder ein neues in Arbeit. */
    hasDetail: selectedId !== null || creating,
    /** Status der Liste für `PickList`. */
    listState: (list.isError ? 'error' : list.isPending ? 'loading' : 'ready') as
      'loading' | 'error' | 'ready',
    draft,
    set: <F extends keyof D>(field: F, value: D[F]) => {
      setSaved(false);
      setDraft((d) => ({ ...d, [field]: value }));
    },
    replace: (next: D) => {
      setSaved(false);
      setDraft(next);
    },
    select: (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      setSelectedId(id);
      setCreating(false);
      setDraft(toDraft(item));
      reset();
      del.clearUsage();
    },
    startNew: (from?: D) => {
      setSelectedId(null);
      setCreating(true);
      setDraft(from ?? empty());
      reset();
      del.clearUsage();
    },
    errors: { ...serverFieldErrors(save.error), ...clientErrors } as FieldErrors,
    saved,
    save,
    submit: async (body: unknown = draft) => {
      const result = validate(schema, body);
      if (!result.ok) {
        setClientErrors(result.errors);
        return;
      }
      setClientErrors({});
      const view = (await save
        .mutateAsync({ id: selectedId, body: result.data as object })
        .catch(() => null)) as Item<K> | null;
      if (view) {
        setSelectedId(view.id);
        setCreating(false);
        setDraft(toDraft(view));
        setSaved(true);
      }
    },
    del,
    /** Löschen des gewählten Objekts (nach `ConfirmDialog`); ohne Auswahl kein Knopf. */
    onDelete: (nameOf: (item: Item<K>) => string) => {
      const item = items.find((i) => i.id === selectedId);
      return item ? () => del.ask(item.id, nameOf(item)) : undefined;
    },
  };
}

/** Fehlermeldungen der zod-Prüfung sind technisch (englisch); angezeigt wird ein i18n-Text je Feld. */
export function useFieldError(errors: FieldErrors) {
  const { t } = useTranslation();
  return (path: string) => (errors[path] ? t('equipment.invalid') : undefined);
}

/** Anzeigename eines Mondprofils: mitgelieferte Profile heißen `moonProfile.<key>` (moon.md, FA-MON-02). */
export function useMoonProfileLabel() {
  const { t } = useTranslation();
  return (name: string) =>
    name.startsWith('moonProfile.') ? t(`moonProfile.${name.slice('moonProfile.'.length)}`) : name;
}
