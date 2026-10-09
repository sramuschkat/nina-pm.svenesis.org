/**
 * „Rig jetzt“ (AP-70, FA-RIG-19, S-43): jüngster Heartbeat der NINA-Instanzen des Rigs – Kamera, Montierung, Fokussierer,
 * Filter (Hinweis ohne Filter-Offsets), Guider, Safety, Wetter des NINA-Wettergeräts (z. B. SkyAlert) und verbundene Geräte.
 * Nur Anzeige; Werte, die das Plugin nicht meldet, fehlen. Älter als 5 min → hervorgehoben (Heartbeat jede Minute).
 */
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { useTranslation } from 'react-i18next';
import type { TelemetryView } from '../../api/client';
import { DEW_GAP_WARN_K } from './telemetry-model';
import styles from './telemetry.module.css';

type Live = NonNullable<TelemetryView['live']>;

/** Heartbeat jede Minute: nach 5 min gilt der Stand als veraltet. */
export const LIVE_STALE_MIN = 5;

const DEVICE_ORDER = [
  'camera',
  'mount',
  'focuser',
  'filterWheel',
  'rotator',
  'guider',
  'safetyMonitor',
  'weather',
  'flatDevice',
  'switch',
  'dome',
] as const;

export function RigLiveCard({
  live,
  nowMs,
  timeZone,
}: {
  live: Live | null;
  nowMs: number;
  timeZone: string;
}) {
  const { t, i18n } = useTranslation();
  const n = (v: number, digits = 1) =>
    v.toLocaleString(i18n.language, { maximumFractionDigits: digits });
  if (!live)
    return (
      <section className={styles.liveCard} aria-label={t('telemetry.live.title')}>
        <div className={styles.tileHead}>
          <h2>{t('telemetry.live.title')}</h2>
        </div>
        <p className={styles.muted}>{t('telemetry.live.none')}</p>
      </section>
    );
  const at = live.receivedAtUtc;
  const ageMin = Math.max(0, Math.round((nowMs - Date.parse(at)) / 60_000));
  const d = live.devices;
  const cam = live.camera;
  const mount = d?.mountState ?? null;
  const focuser = d?.focuser ?? null;
  const guider = d?.guider ?? null;
  const w = d?.weather ?? null;
  const noOffsets =
    (live.filterWheel?.length ?? 0) > 1 &&
    (live.filterWheel ?? []).every((f) => f.focusOffset === 0);
  const dewGap =
    w?.temperatureC !== undefined && w.dewPointC !== undefined
      ? w.temperatureC - w.dewPointC
      : null;

  const rows: { key: string; label: string; value: string; warn?: boolean }[] = [];
  const optics = live.optics;
  if (optics)
    rows.push({
      key: 'optics',
      label: t('telemetry.live.optics'),
      value: [
        optics.telescopeName,
        optics.focalLengthMm !== null
          ? t('telemetry.live.focal', { v: n(optics.focalLengthMm, 0) })
          : null,
        optics.focalRatio !== null
          ? t('telemetry.live.focalRatio', { v: n(optics.focalRatio) })
          : null,
        live.pixelScaleArcsecPx !== null
          ? t('telemetry.live.pixelScale', { v: n(live.pixelScaleArcsecPx, 2) })
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  if (cam)
    rows.push({
      key: 'camera',
      label: t('telemetry.live.camera'),
      value: [
        cam.temperatureC !== null ? `${n(cam.temperatureC)} °C` : null,
        cam.setPointC !== null ? t('telemetry.live.setPoint', { v: n(cam.setPointC) }) : null,
        cam.coolerPowerPct !== null
          ? t('telemetry.live.cooler', { v: n(cam.coolerPowerPct, 0) })
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  if (mount)
    rows.push({
      key: 'mount',
      label: t('telemetry.live.mount'),
      value: [
        mount.pierSide ? t(`telemetry.live.pier.${mount.pierSide}`) : null,
        mount.atPark
          ? t('telemetry.live.parked')
          : mount.slewing
            ? t('telemetry.live.slewing')
            : t(mount.tracking ? 'telemetry.live.tracking' : 'telemetry.live.notTracking'),
        mount.altitudeDeg !== null
          ? t('telemetry.live.altitude', { v: n(mount.altitudeDeg, 0) })
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  if (focuser)
    rows.push({
      key: 'focuser',
      label: t('telemetry.live.focuser'),
      value: [
        String(Math.round(focuser.position)),
        focuser.temperatureC !== null ? `${n(focuser.temperatureC)} °C` : null,
        focuser.moving ? t('telemetry.live.moving') : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  if (d)
    rows.push({
      key: 'filter',
      label: t('telemetry.live.filter'),
      value: [d.filter ?? '–', noOffsets ? t('telemetry.live.noOffsets') : null]
        .filter(Boolean)
        .join(' · '),
      warn: noOffsets,
    });
  if (guider && guider.rmsTotalArcsec !== null)
    rows.push({
      key: 'guider',
      label: t('telemetry.live.guider'),
      value: t('telemetry.live.rms', {
        total: n(guider.rmsTotalArcsec, 2),
        ra: guider.rmsRaArcsec !== null ? n(guider.rmsRaArcsec, 2) : '–',
        dec: guider.rmsDecArcsec !== null ? n(guider.rmsDecArcsec, 2) : '–',
      }),
    });
  if (d && d.safe !== null)
    rows.push({
      key: 'safety',
      label: t('telemetry.live.safety'),
      value: t(d.safe ? 'telemetry.live.safe' : 'telemetry.live.unsafe'),
      warn: !d.safe,
    });

  const weather: { key: string; label: string; value: string; warn?: boolean }[] = [];
  if (w) {
    const add = (key: string, v: number | undefined, fmt: (x: number) => string, warn = false) => {
      if (v !== undefined)
        weather.push({ key, label: t(`telemetry.live.weather.${key}`), value: fmt(v), warn });
    };
    add('cloudCoverPct', w.cloudCoverPct, (x) => `${n(x, 0)} %`);
    add('skyQualityMag', w.skyQualityMag, (x) => `${n(x, 2)} mag/″²`);
    add('skyTemperatureC', w.skyTemperatureC, (x) => `${n(x)} °C`);
    add('temperatureC', w.temperatureC, (x) => `${n(x)} °C`);
    add('humidityPct', w.humidityPct, (x) => `${n(x, 0)} %`);
    add('dewPointC', w.dewPointC, (x) => `${n(x)} °C`, dewGap !== null && dewGap < DEW_GAP_WARN_K);
    add('windSpeedMs', w.windSpeedMs, (x) =>
      w.windGustMs !== undefined
        ? t('telemetry.live.windGust', { v: n(x), gust: n(w.windGustMs) })
        : `${n(x)} m/s`,
    );
    add('rainRateMmH', w.rainRateMmH, (x) => `${n(x)} mm/h`, (w.rainRateMmH ?? 0) > 0);
    add('pressureHpa', w.pressureHpa, (x) => `${n(x, 0)} hPa`);
    add('starFwhmArcsec', w.starFwhmArcsec, (x) => `${n(x, 2)}″`);
    add('skyBrightnessLux', w.skyBrightnessLux, (x) => `${n(x, 2)} lx`);
  }

  return (
    <section className={styles.liveCard} aria-label={t('telemetry.live.title')}>
      <div className={styles.tileHead}>
        <h2>{t('telemetry.live.title')}</h2>
        <span className={ageMin > LIVE_STALE_MIN ? styles.stale : styles.muted}>
          {t(ageMin > LIVE_STALE_MIN ? 'telemetry.live.receivedStale' : 'telemetry.live.received', {
            time: `${formatZonedTime(at, timeZone)} ${formatTzAbbr(at, timeZone)}`,
            minutes: ageMin,
            instance: live.instanceName,
            state: live.state ? t(`telemetry.live.state.${live.state}`) : '–',
          })}
        </span>
      </div>
      {d === null ? <p className={styles.muted}>{t('telemetry.live.oldPlugin')}</p> : null}
      {rows.length > 0 ? (
        <dl className={styles.liveValues}>
          {rows.map((r) => (
            <div key={r.key} className={r.warn ? styles.valueWarn : undefined}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {weather.length > 0 ? (
        <>
          <h3 className={styles.liveSub}>{t('telemetry.live.weatherTitle')}</h3>
          <dl className={styles.values}>
            {weather.map((r) => (
              <div key={r.key} className={r.warn ? styles.valueWarn : undefined}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {d ? (
        <ul className={styles.devices} aria-label={t('telemetry.live.devices')}>
          {DEVICE_ORDER.map((k) => (
            <li key={k} data-connected={d.connected[k]}>
              {t(`telemetry.live.device.${k}`)}
              <span className="visually-hidden">
                {t(d.connected[k] ? 'telemetry.live.connected' : 'telemetry.live.disconnected')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
