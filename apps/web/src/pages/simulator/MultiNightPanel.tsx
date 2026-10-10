/**
 * S-40 Bereich *Mehrnacht* (FK 14.3; FA-SIM-04; AP-32a): Mehrnacht-Simulation über 7 oder 14 Nächte ab der
 * gewählten Nacht als Job `multi_sim` – fortgeschriebener Restbedarf, optional mit Wettergewichtung aus
 * der Nachtbewertung, optional mit eigenen Entwürfen.
 *
 * Neugestaltung 10.10.2026 (Entwurf im Canvas, Sven: „verstehe ich überhaupt nicht“): oben drei Kacheln (erwartete und
 * mögliche Belichtung, gute Nächte, fertige Projekte); „Was die Nächte bringen“ – je Nacht eine Säule mit dem Wetter als
 * Chip, dunkle Stunden gestrichelt, möglich bei klarer Nacht schraffiert, erwartet gestapelt nach Projekt und darunter in
 * Worten, wie die Nacht zählt; „Was die Projekte bekommen“ – Projekt × Nacht mit Stunden, Fortschritt und Fertig, je
 * Projekt aufklappbar mit den Filtern; Projekte ohne Bedarf in einer Zeile. Das Wetterband entfällt (Link zur
 * Vorhersage), die Rechenregel steht eingeklappt.
 */
import { formatNightKey } from '@nina-pm/shared';
import { useMutation } from '@tanstack/react-query';
import { Fragment, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { simulationApi, type MultiSimResult } from '../../api/client';
import { ProblemMessage } from '../../components/ProblemMessage';
import { useJob } from '../../lib/use-job';
import { problemCode } from '../admin/shared';
import { nightWeekday } from '../sessions/evaluation';
import { weatherHref } from '../weather/model';
import { useSiteWeather } from '../weather/WeatherPage';
import { multiSimView, SIM_COLORS, weightKind, type SimView } from './multi-night-model';
import styles from './simulator.module.css';

/** Farbe eines Projekts (Token `sim-n`). */
const simColor = (i: number) => `var(--npm-sim-${String((i % SIM_COLORS) + 1)})`;
/** Ton des Wetter-Punkts nach der Nachtbewertung (wie die Karten der Nächte). */
const ratingTone = (r: number | null) =>
  r === null ? 'none' : r >= 3 ? 'good' : r === 2 ? 'fair' : 'poor';

export function MultiNightPanel({
  rigId,
  nightFrom,
  withDrafts,
  site,
}: {
  rigId: string;
  nightFrom: string;
  withDrafts: boolean;
  /** Standort des Rigs: Vorhersage für die Wettergewichtung (Farbband und Bewertung je Nacht). */
  site: { id: string; name: string } | null;
}) {
  const { t, i18n } = useTranslation();
  const ids = { nights: useId(), weather: useId(), title: useId() };
  const [nights, setNights] = useState<7 | 14>(7);
  const [weather, setWeather] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () =>
      simulationApi.multi({ rigId, nightFrom, nights, weather, includeOwnDrafts: withDrafts }),
    onSuccess: (r) => setJobId(r.jobId),
  });
  const { result, running, failed, errorCode } = useJob<MultiSimResult>(jobId);
  const data = result.data;
  const n = (v: number, digits = 1) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  // Gleiche Abfrage wie das Farbband (ein Cache): Bewertung je Nacht im Streifen.
  const forecast = useSiteWeather(weather || data?.weather ? (site?.id ?? null) : null);
  const forecastNight = (night: string) => forecast.data?.nights.find((x) => x.night === night);
  /** „Ausgezeichnet · 92 %“ aus der Nachtbewertung der Simulation und dem Klar-Anteil der Vorhersage. */
  const ratingText = (night: string, ratingIndex: number | null) => {
    if (ratingIndex === null) return null;
    const mean = forecastNight(night)?.nightMean ?? null;
    const name = t(`weather.rating.${String(ratingIndex)}`);
    return mean === null ? name : t('multiSim.ratingPct', { rating: name, pct: n(mean * 100, 0) });
  };
  const view = data && data.kind === 'multi_sim' ? multiSimView(data) : null;
  return (
    <section className={styles.block} aria-labelledby={ids.title}>
      <div className={styles.blockHead}>
        <div className={styles.simHeadText}>
          <h2 id={ids.title} className={styles.blockTitle}>
            {t('multiSim.title')}
          </h2>
          <span className={styles.muted}>
            {data
              ? t('multiSim.subtitle', { rig: data.rigName, night: formatNightKey(nightFrom) })
              : t('multiSim.from', { night: formatNightKey(nightFrom) })}
          </span>
        </div>
        <div className={styles.multiControls}>
          <label htmlFor={ids.nights}>{t('multiSim.nights')}</label>
          <select
            id={ids.nights}
            value={nights}
            onChange={(e) => setNights(Number(e.target.value) === 14 ? 14 : 7)}
          >
            <option value={7}>{t('multiSim.nightCount', { count: 7 })}</option>
            <option value={14}>{t('multiSim.nightCount', { count: 14 })}</option>
          </select>
          <label className={styles.check} htmlFor={ids.weather}>
            <input
              id={ids.weather}
              type="checkbox"
              checked={weather}
              onChange={(e) => setWeather(e.target.checked)}
            />
            {t('multiSim.weather')}
          </label>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={start.isPending || running}
            onClick={() => start.mutate()}
          >
            {t('multiSim.run')}
          </button>
        </div>
      </div>
      {weather && nights === 14 ? (
        <p className={styles.muted}>{t('multiSim.forecastRange')}</p>
      ) : null}
      {start.error ? <ProblemMessage code={problemCode(start.error)} /> : null}
      {running ? (
        <p role="status" className={styles.note}>
          {t('multiSim.running')}
        </p>
      ) : null}
      {failed ? <ProblemMessage code={errorCode ?? 'internal.error'} /> : null}
      {result.error ? <ProblemMessage code={problemCode(result.error)} /> : null}
      {!view && !running ? <p className={styles.muted}>{t('multiSim.intro')}</p> : null}
      {view ? (
        <>
          <SimTiles view={view} />
          <NightColumns
            view={view}
            ratingText={ratingText}
            forecastHref={site ? weatherHref(site.id) : null}
          />
          <ProjectGrid view={view} />
          <details className={styles.simHow}>
            <summary>{t('multiSim.howTitle')}</summary>
            <p>{t('multiSim.how')}</p>
          </details>
        </>
      ) : null}
    </section>
  );
}

function useNum() {
  const { i18n } = useTranslation();
  return (v: number, digits = 1) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: digits });
}

function useNightLabel() {
  const { i18n } = useTranslation();
  return (night: string) => `${nightWeekday(night, i18n.language)} ${formatNightKey(night)}`;
}

/** Kurzfassung: erwartete Belichtung, gute Nächte, fertige Projekte. */
function SimTiles({ view }: { view: SimView }) {
  const { t } = useTranslation();
  const n = useNum();
  const label = useNightLabel();
  const tot = view.totals;
  const count = view.nights.length;
  const tile = (title: string, value: string, sub: string) => (
    <div className={styles.simTile}>
      <span className={styles.simTileLabel}>{title}</span>
      <strong className={styles.simTileValue}>{value}</strong>
      <span className={styles.muted}>{sub}</span>
    </div>
  );
  return (
    <div className={styles.simTiles} role="group" aria-label={t('multiSim.summary')}>
      {view.weather
        ? tile(
            t('multiSim.tiles.expected'),
            t('multiSim.hours', { h: n(tot.expected) }),
            t('multiSim.tiles.expectedOf', { h: n(tot.possible), count }),
          )
        : tile(
            t('multiSim.tiles.possible'),
            t('multiSim.hours', { h: n(tot.expected) }),
            t('multiSim.tiles.noWeather'),
          )}
      {tile(
        t('multiSim.tiles.goodNights'),
        t('multiSim.tiles.ofCount', { value: tot.goodNights.length, count }),
        [
          tot.goodNights.length > 0
            ? tot.goodNights.map(label).join(' · ')
            : t('multiSim.tiles.none'),
          ...(tot.withoutForecast.length > 0
            ? [t('multiSim.tiles.withoutForecast', { count: tot.withoutForecast.length })]
            : []),
        ].join(' – '),
      )}
      {tile(
        t('multiSim.tiles.completing'),
        t('multiSim.tiles.ofCount', { value: tot.completing.length, count: tot.active }),
        [
          ...tot.completing.map((c) =>
            t('multiSim.tiles.completesOn', { name: c.name, night: label(c.night) }),
          ),
          ...(view.finished.length > 0
            ? [t('multiSim.tiles.alreadyDone', { count: view.finished.length })]
            : []),
        ].join(' · ') || t('multiSim.tiles.none'),
      )}
    </div>
  );
}

/** Je Nacht eine Säule: dunkel (gestrichelt), möglich (schraffiert), erwartet gestapelt nach Projekt. */
function NightColumns({
  view,
  ratingText,
  forecastHref,
}: {
  view: SimView;
  ratingText: (night: string, ratingIndex: number | null) => string | null;
  forecastHref: string | null;
}) {
  const { t, i18n } = useTranslation();
  const n = useNum();
  const label = useNightLabel();
  const headingId = useId();
  const compact = view.nights.length > 7;
  const max = Math.max(1, ...view.nights.map((x) => Math.max(x.darkHours ?? 0, x.possible)));
  const pct = (h: number) => `${String(Math.min(100, (h / max) * 100))}%`;
  const color = new Map(view.projects.map((p) => [p.projectId, p.colorIndex]));
  const nameOf = new Map(view.projects.map((p) => [p.projectId, p.name]));
  return (
    <section className={styles.simSection} aria-labelledby={headingId}>
      <div className={styles.simSectionHead}>
        <h3 id={headingId} className={styles.simSectionTitle}>
          {t('multiSim.nightsTitle')}
        </h3>
        {forecastHref ? <Link to={forecastHref}>{t('multiSim.toForecast')}</Link> : null}
      </div>
      <ol
        className={styles.simNights}
        data-compact={compact || undefined}
        style={{ gridTemplateColumns: `repeat(${String(view.nights.length)}, minmax(0, 1fr))` }}
        aria-label={t('multiSim.perNight')}
      >
        {view.nights.map((x) => {
          const rating = ratingText(x.night, x.ratingIndex);
          const kind = weightKind(x, view.weather);
          const dark = x.darkHours === null ? '–' : n(x.darkHours);
          return (
            <li
              key={x.night}
              className={styles.simNight}
              aria-label={t('multiSim.nightAria', {
                night: label(x.night),
                hours: n(x.expected),
                possible: n(x.possible),
                dark,
                rating: rating ?? t('multiSim.noForecast'),
              })}
            >
              <span className={styles.simNightDate}>
                <strong>{nightWeekday(x.night, i18n.language)}</strong>
                <span>{formatNightKey(x.night)}</span>
              </span>
              <span
                className={styles.simRating}
                data-tone={ratingTone(x.ratingIndex)}
                title={rating ?? t('multiSim.noForecast')}
              >
                <span className={styles.simRatingDot} aria-hidden="true" />
                {compact ? null : <span>{rating ?? t('multiSim.noForecast')}</span>}
              </span>
              <span className={styles.simBar} aria-hidden="true">
                {x.darkHours !== null ? (
                  <span className={styles.simDark} style={{ height: pct(x.darkHours) }} />
                ) : null}
                {x.possible > x.expected ? (
                  <span className={styles.simPossible} style={{ height: pct(x.possible) }} />
                ) : null}
                <span className={styles.simStack} style={{ height: pct(x.expected) }}>
                  {x.segments.map((s) => (
                    <span
                      key={s.projectId}
                      title={`${nameOf.get(s.projectId) ?? ''} ${n(s.hours)} h`}
                      style={{
                        flexGrow: s.hours,
                        background: simColor(color.get(s.projectId) ?? 0),
                      }}
                    />
                  ))}
                </span>
              </span>
              <strong className={styles.simNightHours}>
                {t('multiSim.hours', { h: n(x.expected) })}
              </strong>
              {compact ? null : (
                <span className={styles.simNightNote}>
                  {kind === 'partial'
                    ? t('multiSim.count.partial', { pct: n(x.weight * 100, 0), h: n(x.possible) })
                    : kind === 'off'
                      ? t('multiSim.count.off', { dark })
                      : t(`multiSim.count.${kind}`)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <ul className={styles.simLegend} aria-label={t('multiSim.legend')}>
        {view.projects.map((p) => (
          <li key={p.projectId}>
            <span
              className={styles.simSwatch}
              style={{ background: simColor(p.colorIndex) }}
              aria-hidden="true"
            />
            {p.name}
          </li>
        ))}
        {view.weather ? (
          <li>
            <span className={styles.simSwatchPossible} aria-hidden="true" />
            {t('multiSim.legendPossible')}
          </li>
        ) : null}
        <li>
          <span className={styles.simSwatchDark} aria-hidden="true" />
          {t('multiSim.legendDark')}
        </li>
      </ul>
    </section>
  );
}

/** Projekt × Nacht: erwartete Stunden je Nacht, Fortschritt des Bedarfs, Fertig; je Projekt die Filter aufklappbar. */
function ProjectGrid({ view }: { view: SimView }) {
  const { t } = useTranslation();
  const n = useNum();
  const label = useNightLabel();
  const headingId = useId();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className={styles.simSection} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.simSectionTitle}>
        {t('multiSim.projectsTitle')}
      </h3>
      {view.projects.length === 0 ? (
        <p className={styles.muted}>{t('multiSim.empty')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.simGrid}>
            <caption className={styles.srOnly}>{t('multiSim.perProject')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('multiSim.col.project')}</th>
                {view.nights.map((x) => (
                  <th key={x.night} scope="col" className={styles.simGridNight}>
                    {label(x.night)}
                  </th>
                ))}
                <th scope="col">{t('multiSim.col.progress')}</th>
                <th scope="col">{t('multiSim.col.completes')}</th>
              </tr>
            </thead>
            <tbody>
              {view.projects.map((p) => {
                const expanded = open === p.projectId;
                const detailsId = `sim-filters-${p.projectId}`;
                return (
                  <Fragment key={p.projectId}>
                    <tr>
                      <th scope="row">
                        <button
                          type="button"
                          className={styles.simExpand}
                          aria-expanded={expanded}
                          aria-controls={detailsId}
                          onClick={() => setOpen(expanded ? null : p.projectId)}
                        >
                          <span
                            className={styles.simSwatch}
                            style={{ background: simColor(p.colorIndex) }}
                            aria-hidden="true"
                          />
                          {p.name}
                          {p.approvalStatus !== 'approved' ? (
                            <span className={styles.muted}>
                              {' '}
                              ({t(`status.approval.${p.approvalStatus}`)})
                            </span>
                          ) : null}
                        </button>
                      </th>
                      {p.hours.map((h, i) => (
                        <td
                          key={view.nights[i]?.night ?? i}
                          className={styles.simCell}
                          // Hinterlegung 12…40 % der Projektfarbe nach den Stunden (ab 4 h voll); Text bleibt in
                          // der Textfarbe, damit der Kontrast in beiden Themes reicht.
                          style={
                            h > 0
                              ? {
                                  background: `color-mix(in srgb, ${simColor(p.colorIndex)} ${String(Math.round(12 + Math.min(1, h / 4) * 28))}%, transparent)`,
                                }
                              : undefined
                          }
                        >
                          {h > 0 ? n(h) : '–'}
                        </td>
                      ))}
                      <td className={styles.simProgress}>
                        <span className={styles.simProgressTrack} aria-hidden="true">
                          <span
                            style={{
                              width: `${String(p.progressPct)}%`,
                              background: simColor(p.colorIndex),
                            }}
                          />
                        </span>
                        <span className={styles.muted}>
                          {t('multiSim.progress', {
                            sim: n(p.simulatedFrames),
                            need: p.needFrames,
                            pct: p.progressPct,
                          })}
                        </span>
                      </td>
                      <td className={p.completesNight ? styles.simDone : styles.simOpen}>
                        {p.completesNight
                          ? t('multiSim.completesOn', { night: label(p.completesNight) })
                          : t('multiSim.notInRangeN', { count: view.nights.length })}
                      </td>
                    </tr>
                    {expanded ? (
                      <tr id={detailsId}>
                        <td colSpan={view.nights.length + 3} className={styles.simFilters}>
                          <table className={styles.simFilterTable}>
                            <caption className={styles.srOnly}>
                              {t('multiSim.filtersOf', { name: p.name })}
                            </caption>
                            <thead>
                              <tr>
                                <th scope="col">{t('multiSim.filterCol.filter')}</th>
                                <th scope="col">{t('multiSim.filterCol.share')}</th>
                                <th scope="col">{t('multiSim.filterCol.need')}</th>
                                <th scope="col">{t('multiSim.filterCol.expected')}</th>
                                <th scope="col">{t('multiSim.filterCol.open')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.filters.map((f) => {
                                const share =
                                  f.need > 0 ? Math.min(100, (f.simulated / f.need) * 100) : 100;
                                return (
                                  <tr key={f.filter}>
                                    <th scope="row">{f.filter}</th>
                                    <td>
                                      <span className={styles.simProgressTrack} aria-hidden="true">
                                        <span
                                          style={{
                                            width: `${String(share)}%`,
                                            background: simColor(p.colorIndex),
                                          }}
                                        />
                                      </span>
                                    </td>
                                    <td>{f.need}</td>
                                    <td>{n(f.simulated)}</td>
                                    <td>{n(Math.max(0, f.need - f.simulated))}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view.finished.length > 0 ? (
        <p className={styles.muted}>
          {t('multiSim.finishedLine', { list: view.finished.join(' · ') })}
        </p>
      ) : null}
    </section>
  );
}
