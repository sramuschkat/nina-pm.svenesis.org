/**
 * S-11 Standorte (FA-STO-01…06; FK 14.3): links Auswahl, Mitte Formular (Breite/Länge dezimal **und**
 * °′″, Höhe m/ft synchron), Remote-Verbindungen als Linkliste ohne Passwörter, rechts Kennwerte mit
 * Kartenlink und Plausibilitätsprüfung der Länge gegen die Zeitzone. Karte und 7-Tage-Astro-Wetter folgen
 * mit AP-23 (Wetter).
 */
import { observatoryTypes, SiteInput, SiteLinkInput } from '@nina-pm/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SiteLinkView, SiteView } from '../../api/client';
import { useCan } from '../../auth';
import { CoordinateInput } from '../../components/CoordinateInput';
import { formatCoordinate } from '../../components/CoordinateInput/coords';
import { ICON_SIZE, actionIcons } from '../../components/icons';
import { SiteWeather } from '../weather/SiteWeather';
import styles from './equipment.module.css';
import {
  CheckField,
  DeleteDialog,
  EquipmentLayout,
  FormActions,
  NumberField,
  PickList,
  SelectField,
  TextField,
  UsageNotice,
  useEditor,
  useEquipmentList,
  useEquipmentMutations,
  useFieldError,
  useNumber,
  validate,
  type FieldErrors,
} from './shared';

interface SiteDraft {
  name: string;
  pierName: string | null;
  observatoryType: (typeof observatoryTypes)[number];
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  elevationM: number | null;
  bortleClass: number | null;
  timeZone: string;
  weatherSafetyUrl: string | null;
  notes: string;
}

const FEET_PER_M = 1 / 0.3048;

export const siteDraft = (s: SiteView): SiteDraft => ({
  name: s.name,
  pierName: s.pierName,
  observatoryType: s.observatoryType,
  latitudeDeg: s.latitudeDeg,
  longitudeDeg: s.longitudeDeg,
  elevationM: s.elevationM,
  bortleClass: s.bortleClass,
  timeZone: s.timeZone,
  weatherSafetyUrl: s.weatherSafetyUrl,
  notes: s.notes,
});

const emptySite = (): SiteDraft => ({
  name: '',
  pierName: null,
  observatoryType: 'open_air',
  latitudeDeg: null,
  longitudeDeg: null,
  elevationM: 0,
  bortleClass: null,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weatherSafetyUrl: null,
  notes: '',
});

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Europe/Berlin', 'America/Chicago', 'UTC'];
  }
}

/** Mittlerer UTC-Versatz der Zone in Stunden (Januar/Juli) – nur Anzeigehilfe über `Intl`. */
function meanOffsetHours(timeZone: string): number | null {
  try {
    const offset = (month: number) => {
      const at = Date.UTC(2026, month, 15, 12);
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      }).formatToParts(at);
      const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      return (
        (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - at) /
        3_600_000
      );
    };
    return (offset(0) + offset(6)) / 2;
  } catch {
    return null;
  }
}

/**
 * Länge vermutlich falsch signiert (Schema-Kommentar zu `site.longitude_deg`, AST-G04): weicht λ/15 um
 * mehr als 3 h vom mittleren Versatz der Zone ab, stimmt meist das Vorzeichen nicht (Ost positiv).
 */
export function longitudeSuspicious(longitudeDeg: number, timeZone: string): boolean {
  const mean = meanOffsetHours(timeZone);
  return mean !== null && Math.abs(longitudeDeg / 15 - mean) > 3;
}

export function SitesPage() {
  const { t } = useTranslation();
  const canWrite = useCan('equipment.write');
  const editor = useEditor({
    kind: 'sites',
    schema: SiteInput,
    toDraft: siteDraft,
    empty: emptySite,
  });
  const zones = useMemo(timeZones, []);
  const fieldError = useFieldError(editor.errors);
  const num = useNumber();
  const d = editor.draft;
  const disabled = !canWrite;
  const [coordFormat, setCoordFormat] = useState<'sexagesimal' | 'decimal'>('sexagesimal');
  const suspicious =
    d.longitudeDeg !== null && zones.includes(d.timeZone)
      ? longitudeSuspicious(d.longitudeDeg, d.timeZone)
      : false;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void editor.submit({
      ...d,
      pierName: d.pierName?.trim() ? d.pierName.trim() : null,
      weatherSafetyUrl: d.weatherSafetyUrl?.trim() ? d.weatherSafetyUrl.trim() : null,
    });
  };
  const Map = actionIcons.map;
  return (
    <EquipmentLayout title={t('equipment.sites.title')}>
      <div className={styles.layout}>
        <PickList
          label={t('equipment.sites.list')}
          items={editor.items}
          selectedId={editor.selectedId}
          onSelect={editor.select}
          onNew={canWrite ? () => editor.startNew() : undefined}
          state={editor.list.isError ? 'error' : editor.list.isPending ? 'loading' : 'ready'}
          onRetry={() => void editor.list.refetch()}
          emptyText={t('equipment.sites.empty')}
          render={(s: SiteView) => (
            <>
              <span>{s.name}</span>
              <span className={styles.pickMeta}>{s.timeZone}</span>
            </>
          )}
        />
        <div className={styles.stack}>
          <form className={styles.form} onSubmit={submit} aria-labelledby="site-form-title">
            <div className={styles.formTitle}>
              <h2 id="site-form-title">
                {editor.selected ? editor.selected.name : t('equipment.sites.new')}
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
                label={t('equipment.sites.field.pierName')}
                value={d.pierName ?? ''}
                onChange={(v) => editor.set('pierName', v)}
                disabled={disabled}
              />
              <SelectField
                label={t('equipment.sites.field.observatoryType')}
                value={d.observatoryType}
                onChange={(v) => editor.set('observatoryType', v)}
                options={observatoryTypes.map((o) => ({
                  value: o,
                  label: t(`equipment.observatoryType.${o}`),
                }))}
                disabled={disabled}
              />
            </div>
            <div className={styles.section}>
              <h3>{t('equipment.sites.position')}</h3>
              <div className={styles.grid}>
                <div className={styles.field}>
                  <CoordinateInput
                    kind="lat"
                    label={t('equipment.sites.field.latitude')}
                    valueDeg={d.latitudeDeg}
                    onChange={(v) => editor.set('latitudeDeg', v)}
                    format={coordFormat}
                    onFormatChange={setCoordFormat}
                    disabled={disabled}
                    required
                  />
                  <span className={styles.muted} data-testid="lat-other">
                    {d.latitudeDeg === null
                      ? ''
                      : formatCoordinate(
                          'lat',
                          d.latitudeDeg,
                          coordFormat === 'decimal' ? 'sexagesimal' : 'decimal',
                        )}
                  </span>
                  {fieldError('latitudeDeg') ? (
                    <span className={styles.fieldError}>{fieldError('latitudeDeg')}</span>
                  ) : null}
                </div>
                <div className={styles.field}>
                  <CoordinateInput
                    kind="lon"
                    label={t('equipment.sites.field.longitude')}
                    valueDeg={d.longitudeDeg}
                    onChange={(v) => editor.set('longitudeDeg', v)}
                    format={coordFormat}
                    onFormatChange={setCoordFormat}
                    disabled={disabled}
                    required
                  />
                  <span className={styles.muted}>
                    {d.longitudeDeg === null
                      ? ''
                      : formatCoordinate(
                          'lon',
                          d.longitudeDeg,
                          coordFormat === 'decimal' ? 'sexagesimal' : 'decimal',
                        )}
                  </span>
                  {fieldError('longitudeDeg') ? (
                    <span className={styles.fieldError}>{fieldError('longitudeDeg')}</span>
                  ) : null}
                </div>
                <NumberField
                  label={t('equipment.sites.field.elevation')}
                  unit="m"
                  value={d.elevationM}
                  onChange={(v) => editor.set('elevationM', v)}
                  error={fieldError('elevationM')}
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.sites.field.elevation')}
                  unit="ft"
                  value={d.elevationM === null ? null : Math.round(d.elevationM * FEET_PER_M)}
                  onChange={(v) =>
                    editor.set(
                      'elevationM',
                      v === null ? null : Math.round((v / FEET_PER_M) * 10) / 10,
                    )
                  }
                  disabled={disabled}
                />
                <NumberField
                  label={t('equipment.sites.field.bortle')}
                  value={d.bortleClass}
                  min={1}
                  max={9}
                  onChange={(v) => editor.set('bortleClass', v)}
                  error={fieldError('bortleClass')}
                  disabled={disabled}
                />
                <TextField
                  label={t('equipment.sites.field.timeZone')}
                  value={d.timeZone}
                  list="site-tz-list"
                  onChange={(v) => editor.set('timeZone', v.trim())}
                  error={
                    fieldError('timeZone') ??
                    (zones.includes(d.timeZone) ? undefined : t('equipment.sites.tzUnknown'))
                  }
                  hint={t('equipment.sites.tzHint')}
                  disabled={disabled}
                />
                <datalist id="site-tz-list">
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </div>
              {suspicious ? (
                <p className={styles.warning} role="status">
                  {t('equipment.sites.longitudeSuspicious')}
                </p>
              ) : null}
            </div>
            <div className={styles.section}>
              <div className={styles.grid}>
                <TextField
                  label={t('equipment.sites.field.weatherSafetyUrl')}
                  type="url"
                  maxLength={500}
                  value={d.weatherSafetyUrl ?? ''}
                  onChange={(v) => editor.set('weatherSafetyUrl', v)}
                  error={fieldError('weatherSafetyUrl')}
                  disabled={disabled}
                  wide
                />
                <TextField
                  label={t('equipment.field.notes')}
                  value={d.notes}
                  maxLength={4000}
                  multiline
                  onChange={(v) => editor.set('notes', v)}
                  disabled={disabled}
                  wide
                />
              </div>
            </div>
            <FormActions
              canWrite={canWrite}
              saving={editor.save.isPending}
              saved={editor.saved}
              error={editor.save.error}
              onDelete={editor.onDelete((s) => s.name)}
            />
          </form>
          {editor.selected ? <SiteLinks site={editor.selected} canWrite={canWrite} /> : null}
        </div>
        <aside className={styles.derived} aria-labelledby="site-derived">
          <h2 id="site-derived">{t('equipment.sites.overview')}</h2>
          <dl>
            <dt>{t('equipment.sites.field.latitude')}</dt>
            <dd>{num(d.latitudeDeg, 4)}°</dd>
            <dt>{t('equipment.sites.field.longitude')}</dt>
            <dd>{num(d.longitudeDeg, 4)}°</dd>
            <dt>{t('equipment.sites.field.elevation')}</dt>
            <dd>{d.elevationM === null ? '–' : `${num(d.elevationM, 0)} m`}</dd>
            <dt>{t('equipment.sites.field.timeZone')}</dt>
            <dd>{d.timeZone}</dd>
          </dl>
          {d.latitudeDeg !== null && d.longitudeDeg !== null ? (
            <a
              className={styles.button}
              href={`https://www.openstreetmap.org/?mlat=${String(d.latitudeDeg)}&mlon=${String(d.longitudeDeg)}#map=12/${String(d.latitudeDeg)}/${String(d.longitudeDeg)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Map size={ICON_SIZE.table} aria-hidden />
              {t('equipment.sites.openMap')}
            </a>
          ) : null}
          {d.weatherSafetyUrl ? (
            <a href={d.weatherSafetyUrl} target="_blank" rel="noopener noreferrer">
              {t('equipment.sites.weatherSafety')}
            </a>
          ) : null}
          {editor.selected ? (
            <SiteWeather siteId={editor.selected.id} siteName={editor.selected.name} compact />
          ) : null}
        </aside>
      </div>
      <DeleteDialog dialog={editor.del.dialog} />
    </EquipmentLayout>
  );
}

// ---- Remote-Verbindungen (FA-STO-05) --------------------------------------------------------------

interface LinkDraft {
  serviceType: string;
  name: string;
  remoteIdOrUrl: string;
  notes: string;
  isDefault: boolean;
}
const emptyLink = (): LinkDraft => ({
  serviceType: 'anydesk',
  name: '',
  remoteIdOrUrl: '',
  notes: '',
  isDefault: false,
});
const SERVICES = ['anydesk', 'rustdesk', 'rdp', 'teamviewer', 'vnc', 'web'] as const;

function SiteLinks({ site, canWrite }: { site: SiteView; canWrite: boolean }) {
  const { t } = useTranslation();
  const links = useEquipmentList('site-links');
  const { save, remove } = useEquipmentMutations('site-links');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<LinkDraft>(emptyLink);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirm, setConfirm] = useState<SiteLinkView | null>(null);
  const fieldError = useFieldError(errors);
  const mine = (links.data ?? []).filter((l) => l.siteId === site.id);
  const Delete = actionIcons.delete;
  const Add = actionIcons.add;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = validate(SiteLinkInput, { ...draft, siteId: site.id });
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    await save
      .mutateAsync({ id: editing === 'new' ? null : editing, body: result.data })
      .then(() => setEditing(null))
      .catch(() => undefined);
  };
  return (
    <section className={styles.panel} aria-labelledby="site-links-title">
      <div className={styles.formTitle}>
        <h2 id="site-links-title">{t('equipment.sites.links.title')}</h2>
        {canWrite && editing === null ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setDraft(emptyLink());
              setErrors({});
              setEditing('new');
            }}
          >
            <Add size={ICON_SIZE.table} aria-hidden />
            {t('equipment.sites.links.add')}
          </button>
        ) : null}
      </div>
      <p className={styles.muted}>{t('equipment.sites.links.noPasswords')}</p>
      {mine.length === 0 ? (
        <p className={styles.muted}>{t('equipment.sites.links.empty')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('equipment.sites.links.service')}</th>
                <th>{t('equipment.field.name')}</th>
                <th>{t('equipment.sites.links.remote')}</th>
                <th>{t('equipment.sites.links.default')}</th>
                {canWrite ? <th aria-label={t('equipment.actions')} /> : null}
              </tr>
            </thead>
            <tbody>
              {mine.map((l) => (
                <tr key={l.id}>
                  <td>{l.serviceType}</td>
                  <td>
                    {canWrite ? (
                      <button
                        type="button"
                        className={styles.pickItem}
                        onClick={() => {
                          setDraft({
                            serviceType: l.serviceType,
                            name: l.name,
                            remoteIdOrUrl: l.remoteIdOrUrl,
                            notes: l.notes,
                            isDefault: l.isDefault,
                          });
                          setErrors({});
                          setEditing(l.id);
                        }}
                      >
                        {l.name}
                      </button>
                    ) : (
                      l.name
                    )}
                  </td>
                  <td>
                    {/^https?:\/\//.test(l.remoteIdOrUrl) ? (
                      <a href={l.remoteIdOrUrl} target="_blank" rel="noopener noreferrer">
                        {l.remoteIdOrUrl}
                      </a>
                    ) : (
                      <code>{l.remoteIdOrUrl}</code>
                    )}
                  </td>
                  <td>{l.isDefault ? t('equipment.yes') : ''}</td>
                  {canWrite ? (
                    <td>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t('equipment.deleteNamed', { name: l.name })}
                        onClick={() => setConfirm(l)}
                      >
                        <Delete size={ICON_SIZE.table} aria-hidden />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null ? (
        <form className={styles.section} onSubmit={(e) => void submit(e)}>
          <div className={styles.grid}>
            <TextField
              label={t('equipment.sites.links.service')}
              value={draft.serviceType}
              list="site-link-services"
              maxLength={40}
              onChange={(v) => setDraft({ ...draft, serviceType: v })}
              error={fieldError('serviceType')}
            />
            <datalist id="site-link-services">
              {SERVICES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <TextField
              label={t('equipment.field.name')}
              value={draft.name}
              onChange={(v) => setDraft({ ...draft, name: v })}
              error={fieldError('name')}
            />
            <TextField
              label={t('equipment.sites.links.remote')}
              value={draft.remoteIdOrUrl}
              maxLength={500}
              onChange={(v) => setDraft({ ...draft, remoteIdOrUrl: v })}
              error={fieldError('remoteIdOrUrl')}
            />
            <TextField
              label={t('equipment.field.notes')}
              value={draft.notes}
              maxLength={4000}
              onChange={(v) => setDraft({ ...draft, notes: v })}
            />
          </div>
          <CheckField
            label={t('equipment.sites.links.default')}
            checked={draft.isDefault}
            onChange={(v) => setDraft({ ...draft, isDefault: v })}
          />
          <FormActions
            canWrite
            saving={save.isPending}
            saved={false}
            error={save.error}
            extra={
              <button type="button" className={styles.button} onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </button>
            }
          />
        </form>
      ) : null}
      <DeleteDialog
        dialog={{
          open: confirm !== null,
          name: confirm?.name ?? '',
          state: remove.isPending ? 'loading' : remove.isError ? 'error' : 'ready',
          ...(remove.isError ? { errorKey: 'errors.internal.error' } : {}),
          onCancel: () => {
            remove.reset();
            setConfirm(null);
          },
          onConfirm: async () => {
            if (!confirm) return;
            await remove
              .mutateAsync(confirm.id)
              .then(() => setConfirm(null))
              .catch(() => undefined);
          },
        }}
      />
    </section>
  );
}
