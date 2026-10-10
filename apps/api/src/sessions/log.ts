/**
 * Sitzungsprotokoll und Klarnacht-Statistik in der API (AP-30; FA-AUS-14…17):
 * - `captureForecastSnapshot`: Wetter-Schnappschuss zum Sessionbeginn (Mittel der astronomisch dunklen
 *   Stunden der Nacht aus dem aktuellen Wetter-Cache des Standorts) – best effort, nie ein Fehler für NINA.
 * - `sessionLogView`: gespeichertes Protokoll bzw. Vorbelegung mit Quellen, NINA-Werten und Vorhersage.
 * - `clearNightView`: Monatszeilen, Nächte und Treffsicherheit je Standort und Zeitraum. Die Vorhersage einer
 *   Nacht kommt aus dem Schnappschuss der ersten Session mit Schnappschuss, sonst aus `site_night_forecast`
 *   (AP-64b: letzte Vorhersage vor Beginn der Dunkelheit, auch für Nächte ohne Session; erst nach Ende der Nacht).
 */
import {
  latestWeather,
  saveForecastSnapshot,
  type ClearNightForecast,
  type ClearNightRawSession,
  type SessionLogContext,
} from '@nina-pm/db';
import {
  clearNightMonths,
  forecastAccuracy,
  imagesForecastAccuracy,
  forecastSnapshot,
  ninaStats,
  prefillSessionLog,
  SESSION_LOG_FIELDS,
  sessionLogSources,
  type ClearNightNight,
  type ClearNightView,
  type ForecastSnapshot,
  type SessionLogSource,
  type SessionLogView,
} from '@nina-pm/shared';
import { logger } from '../lib/logger';
import type { ApiServices } from '../routes/services';
import { weatherView } from '../weather/view';

/** Schnappschuss zum Sessionbeginn speichern (NINA `POST /sessions`, nur beim Anlegen). */
export async function captureForecastSnapshot(
  svc: ApiServices,
  tenantId: string,
  rigId: string,
  sessionId: string,
  night: string,
): Promise<void> {
  try {
    const eq = svc.repositories({ tenantId }).equipment();
    const rig = await eq.rig(rigId);
    if (!rig) return;
    const site = await eq.site(rig.siteId);
    if (!site) return;
    const entry = await latestWeather(svc.db, site.latitudeDeg, site.longitudeDeg);
    if (!entry) return;
    const view = weatherView(site, entry, svc.now());
    const n = view.nights.find((x) => x.night === night);
    if (!n) return;
    const snapshot = forecastSnapshot({
      night,
      darkFromUtc: n.darkFromUtc,
      darkToUtc: n.darkToUtc,
      hours: view.hours,
      ratingIndex: n.ratingIndex,
      nightMean: n.nightMean,
      moonIllumPct: n.moonIllumPct,
      fetchedAtUtc: view.fetchedAtUtc,
    });
    if (snapshot) await saveForecastSnapshot(svc.db, tenantId, sessionId, snapshot);
  } catch (error) {
    logger.warn('forecast_snapshot_failed', { sessionId, error: String(error) });
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Gespeicherter Schnappschuss (jsonb) – tolerant gegenüber fehlenden Feldern. */
export function parseSnapshot(raw: unknown): ForecastSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    night: typeof o.night === 'string' ? o.night : '',
    fetchedAtUtc: typeof o.fetchedAtUtc === 'string' ? o.fetchedAtUtc : null,
    hours: num(o.hours) ?? 0,
    cloudPct: num(o.cloudPct),
    transparencyPct: num(o.transparencyPct),
    seeingScore: num(o.seeingScore),
    temperatureC: num(o.temperatureC),
    humidityPct: num(o.humidityPct),
    windKmh: num(o.windKmh),
    ratingIndex: num(o.ratingIndex),
    nightMean: num(o.nightMean),
    moonIllumPct: num(o.moonIllumPct),
  };
}

const SOURCES = new Set<string>(sessionLogSources);

/** Vorbelegung (Werte + Quellen) aus Session, NINA-Werten und Schnappschuss. */
export function sessionLogPrefill(ctx: SessionLogContext) {
  return prefillSessionLog({
    startedAt: ctx.session.startedAt,
    endedAt: ctx.session.endedAt,
    forecast: parseSnapshot(ctx.session.forecastSnapshot),
    nina: ninaStats(ctx.session.ninaConditions),
  });
}

export function sessionLogView(ctx: SessionLogContext): SessionLogView {
  const forecast = parseSnapshot(ctx.session.forecastSnapshot);
  const nina = ninaStats(ctx.session.ninaConditions);
  const common = {
    sessionId: ctx.session.id,
    version: ctx.version,
    nina,
    forecast: forecast
      ? {
          transparencyPct: forecast.transparencyPct,
          temperatureC: forecast.temperatureC,
          humidityPct: forecast.humidityPct,
          windKmh: forecast.windKmh,
          cloudPct: forecast.cloudPct,
          ratingIndex: forecast.ratingIndex,
          nightMean: forecast.nightMean,
          seeingScore: forecast.seeingScore,
        }
      : null,
  };
  if (!ctx.log) {
    const prefill = sessionLogPrefill(ctx);
    return {
      ...common,
      saved: false,
      values: prefill.values,
      sources: prefill.sources,
      updatedAt: null,
      updatedBy: null,
      updatedByName: null,
    };
  }
  const log = ctx.log;
  const sources = Object.fromEntries(
    SESSION_LOG_FIELDS.map((f) => {
      const v = log.sources[f];
      return [f, typeof v === 'string' && SOURCES.has(v) ? (v as SessionLogSource) : null];
    }),
  ) as SessionLogView['sources'];
  return {
    ...common,
    saved: true,
    values: log.values,
    sources,
    updatedAt: log.updatedAt,
    updatedBy: log.updatedBy,
    updatedByName: log.updatedByName,
  };
}

/** Alle Nacht-Schlüssel von `from` bis `to` (inklusive), neueste zuerst. */
export function nightKeys(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${from}T00:00:00Z`);
  for (let t = Date.parse(`${to}T00:00:00Z`); t >= end; t -= 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Lights vor Wettergerät: Bewölkung und SQM mit Quelle (AP-77). */
function measuredFields(
  m: { qualityPct: number | null; cloudPct: number | null; sqm: number | null } | undefined,
  d: { cloudPct: number | null; sqm: number | null } | undefined,
) {
  const fromImages = m?.cloudPct !== null && m?.cloudPct !== undefined;
  const cloudPct = fromImages ? (m?.cloudPct ?? null) : (d?.cloudPct ?? null);
  return {
    qualityPct: m?.qualityPct ?? null,
    cloudPct,
    cloudSource: cloudPct === null ? null : fromImages ? ('images' as const) : ('device' as const),
    sqmMeasured: m?.sqm ?? d?.sqm ?? null,
  };
}

export function clearNightView(input: {
  readonly site: { id: string; name: string; timeZone: string };
  readonly from: string;
  readonly to: string;
  readonly stats: readonly {
    night: string;
    usable: boolean;
    usableHours: number | null;
    source: 'session' | 'manual';
  }[];
  readonly sessions: readonly ClearNightRawSession[];
  /** Gespeicherte Vorhersage je Nacht (AP-64b); fehlt sie, bleibt nur der Schnappschuss. */
  readonly forecasts?: readonly ClearNightForecast[];
  /**
   * Laufende Nacht des Standorts (Mittag bis Mittag, `noonNightKey`): Ab ihr gilt die gespeicherte Vorhersage noch
   * nicht – eine Nacht, die läuft oder bevorsteht, ist nicht „klar, aber nicht genutzt“.
   */
  readonly currentNight: string;
  /** „Klar laut Bildern“ je Nacht (AP-72); fehlt eine Nacht, bleibt sie ohne Urteil. */
  readonly imagesClarity?: ReadonlyMap<
    string,
    { verdict: 'clear' | 'thin' | 'cloudy'; clearPct: number }
  >;
  /** AP-77: Qualität, Bewölkung und SQM aus den Lights je Nacht. */
  readonly measured?: ReadonlyMap<
    string,
    { qualityPct: number | null; cloudPct: number | null; sqm: number | null }
  >;
  /** AP-77: Bewölkung und SQM des Wettergeräts je Nacht (für Nächte ohne Lights). */
  readonly device?: ReadonlyMap<string, { cloudPct: number | null; sqm: number | null }>;
  /** AP-77: gerechnete Mondbeleuchtung je Nacht (ohne Schnappschuss). */
  readonly moon?: ReadonlyMap<string, number>;
}): ClearNightView {
  const statOf = new Map(input.stats.map((s) => [s.night, s]));
  const forecastOf = new Map(
    (input.forecasts ?? []).filter((f) => f.night < input.currentNight).map((f) => [f.night, f]),
  );
  const sessionsOf = new Map<string, ClearNightRawSession[]>();
  for (const s of input.sessions) sessionsOf.set(s.night, [...(sessionsOf.get(s.night) ?? []), s]);
  const nights: ClearNightNight[] = nightKeys(input.from, input.to).map((night) => {
    const stat = statOf.get(night);
    const sessions = sessionsOf.get(night) ?? [];
    const snap = sessions.map((s) => parseSnapshot(s.forecastSnapshot)).find((x) => x !== null);
    // Schnappschuss der Session vor der gespeicherten Vorhersage der Nacht (AP-64b).
    // `real` in der Datenbank: Mittel auf drei Stellen wie im Schnappschuss (WS-08).
    const stored = forecastOf.get(night);
    const fromSnap = snap !== undefined && snap.ratingIndex !== null;
    const ratingIndex = fromSnap ? snap.ratingIndex : (stored?.ratingIndex ?? null);
    const nightMean = fromSnap
      ? snap.nightMean
      : stored
        ? stored.overallScore === null
          ? null
          : Math.round(stored.overallScore * 1000) / 1000
        : (snap?.nightMean ?? null);
    const logged = sessions.find(
      (s) => s.seeingArcsec !== null || s.sqm !== null || s.transparencyPct !== null,
    );
    const lights = sessions.reduce((n, s) => n + s.lights, 0);
    const rejected = sessions.reduce((n, s) => n + s.rejected, 0);
    return {
      night,
      source: stat?.source ?? null,
      usable: stat ? stat.usable : null,
      usableHours: stat?.usableHours ?? null,
      sessionIds: sessions.map((s) => s.id),
      forecastRatingIndex: ratingIndex,
      forecastNightMean: nightMean,
      seeingArcsec: logged?.seeingArcsec ?? null,
      sqm: logged?.sqm ?? null,
      transparencyPct: logged?.transparencyPct ?? null,
      forecastTransparencyPct: snap?.transparencyPct ?? null,
      rejectedPct: lights === 0 ? null : Math.round((rejected / lights) * 1000) / 10,
      imagesClarity: input.imagesClarity?.get(night)?.verdict ?? null,
      imagesClearPct: input.imagesClarity?.get(night)?.clearPct ?? null,
      ...measuredFields(input.measured?.get(night), input.device?.get(night)),
      moonIllumPct: snap?.moonIllumPct ?? input.moon?.get(night) ?? null,
      forecastSeeingScore: snap?.seeingScore ?? null,
    };
  });
  return {
    siteId: input.site.id,
    siteName: input.site.name,
    timeZone: input.site.timeZone,
    from: input.from,
    to: input.to,
    months: clearNightMonths(nights),
    nights,
    accuracy: forecastAccuracy(nights),
    imagesAccuracy: imagesForecastAccuracy(nights),
  };
}
