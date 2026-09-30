/**
 * S-61 Reiter *Protokoll* (FK 14.3; FA-AUS-14, FA-AUS-15; AP-30): Beginn/Ende und Mondphase automatisch,
 * Seeing, Transparenz, SQM, Temperatur, Feuchte, Wind, Wolken, Wetter- und Freitext-Notizen. Je Feld ein
 * Kennzeichen der Quelle (*Vorhersage*, *NINA*, *manuell*, *automatisch*) und die Vorschläge aus NINA
 * (Mittel/Min/Max) und Vorhersage (Mittel der astronomisch dunklen Stunden zum Sessionbeginn) mit
 * *übernehmen*. Ohne gespeichertes Protokoll zeigt die Seite die Vorbelegung des Servers. Bearbeiten nur
 * mit `sessionlog.write` (Admin); Speichern mit `If-Match`, `412` lädt die neue Fassung.
 */
import {
  logSuggestions,
  sourcesOnSave,
  type LogSuggestion,
  type SessionLogField,
  type SessionLogSource,
} from '@nina-pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionLogApi, type SessionLogValues, type SessionLogView } from '../../api/client';
import { useCan } from '../../auth';
import { Markdown } from '../../components/Markdown';
import { ProblemMessage } from '../../components/ProblemMessage';
import { SiteTime } from '../../components/SiteTime';
import { problemCode } from '../admin/shared';
import styles from './sessions.module.css';
import { MemberAvatarFor } from '../../lib/member';

type NumberField = Exclude<SessionLogField, 'startTime' | 'endTime' | 'cloudsNote'>;

/** Zahlenfelder in Anzeigereihenfolge mit Grenzen wie im Vertrag (`SessionLogValues`). */
/** Vorbelegte Mittelwerte haben beliebige Nachkommastellen – daher `step="any"` (sonst blockiert der Browser). */
const NUMBER_FIELDS: readonly { key: NumberField; min: number; max: number }[] = [
  { key: 'seeingArcsec', min: 0, max: 20 },
  { key: 'transparencyPct', min: 0, max: 100 },
  { key: 'sqm', min: 14, max: 23 },
  { key: 'temperatureC', min: -60, max: 60 },
  { key: 'humidityPct', min: 0, max: 100 },
  { key: 'windKmh', min: 0, max: 300 },
  { key: 'moonIlluminationPct', min: 0, max: 100 },
];

const NINA_KEY: Partial<Record<SessionLogField, keyof SessionLogView['nina']>> = {
  sqm: 'sqm',
  temperatureC: 'temperatureC',
  humidityPct: 'humidityPct',
  windKmh: 'windKmh',
  seeingArcsec: 'seeingArcsec',
};

const SOURCE_CLASS: Record<SessionLogSource, string | undefined> = {
  nina: styles.pillOk,
  forecast: styles.pill,
  manual: styles.pillWarn,
  auto: styles.pill,
};

export function SessionLogPanel({
  sessionId,
  siteTimeZone,
}: {
  sessionId: string;
  siteTimeZone: string;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ['sessions', 'log', sessionId];
  const query = useQuery({ queryKey: key, queryFn: () => sessionLogApi.get(sessionId) });
  // Im Elternteil: Das Formular wird mit jeder neuen Fassung (`key`) neu aufgebaut, Meldungen bleiben.
  const save = useMutation({
    mutationFn: (a: { values: SessionLogValues; version: string }) =>
      sessionLogApi.save(sessionId, a.values, a.version),
    onSuccess: (next) => client.setQueryData(key, next),
    onError: (error) => {
      if (problemCode(error) === 'resource.version_conflict')
        void client.invalidateQueries({ queryKey: key });
    },
  });
  if (query.isPending) return <p role="status">{t('common.loading')}</p>;
  if (query.isError)
    return <ProblemMessage code={problemCode(query.error)} onRetry={() => void query.refetch()} />;
  return (
    <>
      <SessionLogForm
        key={query.data.version}
        view={query.data}
        siteTimeZone={siteTimeZone}
        pending={save.isPending}
        onSave={(values) => save.mutate({ values, version: query.data.version })}
      />
      {save.isSuccess ? (
        <p className={styles.success} role="status">
          {t('sessions.log.saved')}
        </p>
      ) : null}
      {save.error ? <ProblemMessage code={problemCode(save.error)} /> : null}
    </>
  );
}

function SessionLogForm({
  view,
  siteTimeZone,
  pending,
  onSave,
}: {
  view: SessionLogView;
  siteTimeZone: string;
  pending: boolean;
  onSave: (values: SessionLogValues) => void;
}) {
  const { t, i18n } = useTranslation();
  const canWrite = useCan('sessionlog.write');
  const [values, setValues] = useState<SessionLogValues>(view.values);
  const suggestions = useMemo(() => logSuggestions(view.forecast, view.nina), [view]);
  // Vorschau der Kennzeichen mit derselben Regel wie der Server.
  const sources = useMemo(
    () => sourcesOnSave(values, view, suggestions),
    [values, view, suggestions],
  );
  const dirty = JSON.stringify(values) !== JSON.stringify(view.values);
  const set = <K extends keyof SessionLogValues>(key: K, value: SessionLogValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const fmt = (v: number) => v.toLocaleString(i18n.language, { maximumFractionDigits: 2 });

  const badge = (field: SessionLogField) => {
    const s = sources[field];
    return s ? (
      <span className={SOURCE_CLASS[s]} data-source={s}>
        {t(`sessions.log.source.${s}`)}
      </span>
    ) : null;
  };
  const adopt = (field: SessionLogField) => {
    const list = (suggestions[field] ?? []).filter((x) => x.value !== values[field]);
    if (!canWrite || list.length === 0) return null;
    return (
      <span className={styles.flags}>
        {list.map((x: LogSuggestion) => (
          <button
            key={x.source}
            type="button"
            className={styles.linkButton}
            onClick={() => set(field as keyof SessionLogValues, x.value as never)}
          >
            {t('sessions.log.adopt', {
              source: t(`sessions.log.source.${x.source}`),
              value: typeof x.value === 'number' ? fmt(x.value) : x.value,
            })}
          </button>
        ))}
      </span>
    );
  };
  const ninaHint = (field: SessionLogField) => {
    const key = NINA_KEY[field];
    const stat = key ? view.nina[key] : null;
    if (!stat) return null;
    const part = (v: number | null) => (v === null ? '–' : fmt(v));
    return (
      <span className={styles.muted}>
        {t('sessions.log.ninaStat', {
          avg: part(stat.avg),
          min: part(stat.min),
          max: part(stat.max),
        })}
      </span>
    );
  };

  return (
    <form
      className={styles.form}
      aria-labelledby="session-log-title"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (canWrite) onSave(values);
      }}
    >
      <h2 id="session-log-title">{t('sessions.log.title')}</h2>
      <p className={`${styles.muted} ${styles.byLine}`}>
        {view.saved ? <MemberAvatarFor id={view.updatedBy} /> : null}
        {view.saved
          ? t('sessions.log.savedBy', {
              name: view.updatedByName ?? t('sessions.log.unknownUser'),
              at: view.updatedAt ? new Date(view.updatedAt).toLocaleString(i18n.language) : '',
            })
          : t('sessions.log.prefilled')}
      </p>
      {view.forecast ? (
        <p className={styles.muted}>
          {t('sessions.log.forecastSummary', {
            rating:
              view.forecast.ratingIndex === null
                ? t('weather.rating.none')
                : t(`weather.rating.${String(view.forecast.ratingIndex)}`),
            cloud: view.forecast.cloudPct === null ? '–' : fmt(view.forecast.cloudPct),
          })}
        </p>
      ) : (
        <p className={styles.muted}>{t('sessions.log.noForecast')}</p>
      )}

      <fieldset className={styles.logGrid} disabled={!canWrite || pending}>
        <legend className={styles.srOnly}>{t('sessions.log.values')}</legend>
        <div className={styles.logField}>
          <span className={styles.logLabel}>{t('sessions.log.field.startTime')}</span>
          <span className={styles.logInputRow}>
            <span className={styles.logValue}>
              {values.startTime ? (
                <SiteTime atUtc={values.startTime} siteTimeZone={siteTimeZone} withDate />
              ) : (
                '–'
              )}
            </span>
            {badge('startTime')}
          </span>
        </div>
        <div className={styles.logField}>
          <span className={styles.logLabel}>{t('sessions.log.field.endTime')}</span>
          <span className={styles.logInputRow}>
            <span className={styles.logValue}>
              {values.endTime ? (
                <SiteTime atUtc={values.endTime} siteTimeZone={siteTimeZone} withDate />
              ) : (
                t('sessions.running')
              )}
            </span>
            {badge('endTime')}
          </span>
        </div>
        {NUMBER_FIELDS.map((f) => {
          const id = `session-log-${f.key}`;
          const v = values[f.key];
          return (
            <div key={f.key} className={styles.logField} data-field={f.key}>
              <label htmlFor={id} className={styles.logLabel}>
                {t(`sessions.log.field.${f.key}`)}
              </label>
              <span className={styles.logInputRow}>
                <input
                  id={id}
                  type="number"
                  className={styles.input}
                  min={f.min}
                  max={f.max}
                  step="any"
                  value={v ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const n = Number(raw);
                    set(f.key, raw === '' || !Number.isFinite(n) ? null : n);
                  }}
                />
                {badge(f.key)}
              </span>
              {ninaHint(f.key)}
              {adopt(f.key)}
            </div>
          );
        })}
        <div className={styles.logField}>
          <label htmlFor="session-log-clouds" className={styles.logLabel}>
            {t('sessions.log.field.cloudsNote')}
          </label>
          <span className={styles.logInputRow}>
            <input
              id="session-log-clouds"
              className={styles.input}
              maxLength={200}
              value={values.cloudsNote ?? ''}
              onChange={(e) => set('cloudsNote', e.target.value === '' ? null : e.target.value)}
            />
            {badge('cloudsNote')}
          </span>
          {adopt('cloudsNote')}
        </div>
        <div className={`${styles.logField} ${styles.logWide}`}>
          <label htmlFor="session-log-weather" className={styles.logLabel}>
            {t('sessions.log.field.weatherNotes')}
          </label>
          <textarea
            id="session-log-weather"
            className={styles.input}
            rows={2}
            maxLength={2000}
            value={values.weatherNotes}
            onChange={(e) => set('weatherNotes', e.target.value)}
          />
        </div>
        <div className={`${styles.logField} ${styles.logWide}`}>
          <label htmlFor="session-log-notes" className={styles.logLabel}>
            {t('sessions.log.field.notesMd')}
          </label>
          {canWrite ? (
            <textarea
              id="session-log-notes"
              className={styles.input}
              rows={5}
              maxLength={20_000}
              value={values.notesMd}
              onChange={(e) => set('notesMd', e.target.value)}
            />
          ) : values.notesMd ? (
            <div id="session-log-notes">
              <Markdown>{values.notesMd}</Markdown>
            </div>
          ) : (
            <span id="session-log-notes" className={styles.muted}>
              –
            </span>
          )}
        </div>
      </fieldset>
      {canWrite ? (
        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.buttonPrimary}
            disabled={pending || (view.saved && !dirty)}
          >
            {t('sessions.log.save')}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!dirty || pending}
            onClick={() => setValues(view.values)}
          >
            {t('sessions.log.reset')}
          </button>
        </div>
      ) : null}
    </form>
  );
}
