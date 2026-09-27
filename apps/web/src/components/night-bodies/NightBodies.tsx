/**
 * „Mond & Planeten“ (Heute Nacht, Wunsch Sven 27.09.2026; Vorbild `renderPlanetCards`/`drawPlanetBars` im
 * Beobachtungsplaner): Karten für jeden Körper, der nachts mindestens 10° hoch kommt (beste Höhe, Uhrzeit,
 * Himmelsrichtung, Helligkeit bzw. beleuchteter Anteil), die übrigen in einer Zeile; darunter die Sichtbarkeit
 * je Körper als Balken über der Nacht (kräftiger, je höher und je dunkler der Himmel), Dämmerungsleiste,
 * Stunden in Standortzeit und rechts „jetzt“, „max. Höhe“, „mag · %“. Reine Anzeige der Engine-Proben
 * (`sky.nightBodySamples`), Farben aus Tokens.
 */
import { sky } from '@nina-pm/engine';
import { formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { SKY_STOPS } from '@nina-pm/ui-tokens';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { hourTicks, iso, skyColor } from '../night-chart/model';
import styles from './NightBodies.module.css';

type BodyId = sky.NightBodyId;
const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
/** Karten nur ab dieser besten Höhe (Vorlage). */
const MIN_CARD_ALT = 10;
const ROW_H = 22;
const LEFT = 72;

function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(`--npm-${name}`).trim() || '#888';
}

function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface NightBodiesProps {
  /** Proben der Nacht (`sky.nightBodySamples`), aufsteigend, gleichmäßiger Abstand. */
  readonly rows: readonly sky.NightBodiesRow[];
  /** Standort (Spalte „jetzt“). */
  readonly site: { readonly latDeg: number; readonly lonDeg: number };
  readonly timeZone: string;
  /** Zeitpunkt der Spalte „jetzt“ und der roten Linie (Unix-Sekunden); außerhalb der Nacht ein fester Moment. */
  readonly atUtc: number;
  /** `true`, wenn `atUtc` die aktuelle Zeit ist (Spaltenkopf „jetzt“ statt Uhrzeit). */
  readonly atIsNow: boolean;
}

export function NightBodies({ rows, site, timeZone, atUtc, atIsNow }: NightBodiesProps) {
  const { t, i18n } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  // Minuszeichen statt Bindestrich (−1,9 mag)
  const n = (x: number, d = 0) =>
    x.toLocaleString(i18n.language, { maximumFractionDigits: d }).replace(/^-/, '−');
  const device = deviceZone();
  const first = rows[0];
  const last = rows[rows.length - 1];
  const dual =
    device !== undefined &&
    first !== undefined &&
    formatTzAbbr(iso(first.t), device) !== formatTzAbbr(iso(first.t), timeZone);
  const time = (at: number) => {
    const site = `${formatZonedTime(iso(at), timeZone)} ${formatTzAbbr(iso(at), timeZone)}`;
    return dual && device ? `${site} (${formatZonedTime(iso(at), device)})` : site;
  };
  const best = useMemo(
    () => new Map(sky.NIGHT_BODIES.map((id) => [id, sky.bestBodySample(rows, id)] as const)),
    [rows],
  );
  const name = (id: BodyId) => t(`bodies.name.${id}`);
  const extra = (id: BodyId, s: sky.BodySample) =>
    id === 'moon'
      ? t('bodies.lit', { pct: n(s.illumPct ?? 0) })
      : t('bodies.mag', { mag: n(s.mag ?? 0, 1) });
  const cards = sky.NIGHT_BODIES.filter((id) => (best.get(id)?.sample.altDeg ?? 0) >= MIN_CARD_ALT);
  const hidden = sky.NIGHT_BODIES.filter((id) => !cards.includes(id));
  const dir = (az: number) => t(`bodies.compass.${COMPASS[Math.round(az / 45) % 8] ?? 'n'}`);
  const bestText = (id: BodyId) => {
    const b = best.get(id);
    return b
      ? t('bodies.best', { alt: n(b.sample.altDeg), time: time(b.t), dir: dir(b.sample.azDeg) })
      : '';
  };
  const zone = first ? formatTzAbbr(iso(first.t), timeZone) : '';
  const aria = t('bodies.aria', {
    zone,
    list: sky.NIGHT_BODIES.map((id) =>
      cards.includes(id)
        ? `${name(id)}: ${bestText(id)}, ${extra(id, (best.get(id) as { sample: sky.BodySample }).sample)}`
        : `${name(id)}: ${t('bodies.notUp')}`,
    ).join('; '),
  });

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !first || !last || rows.length < 2) return undefined;
    const draw = () => {
      const W = Math.max(320, cv.clientWidth || 600);
      const narrow = W < 560;
      const RIGHT = narrow ? 92 : 206;
      const top = dual ? 34 : 22;
      const H = top + sky.NIGHT_BODIES.length * ROW_H + 6;
      const dpr = window.devicePixelRatio || 1;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.height = `${String(H)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = (k: string) => token(cv, k);
      const font = getComputedStyle(cv).fontFamily || 'sans-serif';
      const span = last.t - first.t;
      const pw = W - LEFT - RIGHT;
      const xOf = (at: number) => LEFT + ((at - first.t) / span) * pw;
      const step = (pw / span) * ((rows[1]?.t ?? first.t) - first.t) + 0.5;
      ctx.fillStyle = c('chart-frame');
      ctx.fillRect(0, 0, W, H);
      ctx.font = `10px ${font}`;
      ctx.textBaseline = 'middle';
      // Dämmerungsleiste in den Farben des Nachtdiagramms
      for (const r of rows) {
        ctx.fillStyle = r.sunAltDeg < -18 ? c('chart-sky-dark') : skyColor(r.sunAltDeg, SKY_STOPS);
        ctx.fillRect(xOf(r.t), 2, step, 6);
      }
      // Stunden (Standortzeit, darunter Gerätezeit)
      const ticks = hourTicks(first.t, last.t, timeZone);
      const every = ticks.length > 0 && pw / ticks.length < 34 ? 2 : 1;
      ctx.textAlign = 'center';
      ticks.forEach((tk) => {
        if (Number(tk.label) % every) return;
        ctx.fillStyle = c('chart-grid');
        ctx.fillRect(Math.round(xOf(tk.atUtc)), top - 4, 1, H - top);
        ctx.fillStyle = c('chart-axis');
        ctx.fillText(tk.label, xOf(tk.atUtc), 14);
        if (dual && device) {
          ctx.fillStyle = c('chart-label');
          ctx.fillText(formatZonedTime(iso(tk.atUtc), device).slice(0, 2), xOf(tk.atUtc), 26);
        }
      });
      // Spalten rechts
      const base = LEFT + pw;
      const colNow = base + (narrow ? 40 : 50);
      const colMax = narrow ? W - 8 : base + 118;
      const colExtra = W - 8;
      ctx.textAlign = 'right';
      ctx.fillStyle = c('chart-axis');
      ctx.fillText(
        atIsNow ? t('bodies.colNow') : formatZonedTime(iso(atUtc), timeZone),
        colNow,
        14,
      );
      ctx.fillText(narrow ? t('bodies.colMaxShort') : t('bodies.colMax'), colMax, 14);
      if (!narrow) ctx.fillText(t('bodies.colExtra'), colExtra, 14);
      sky.NIGHT_BODIES.forEach((id, k) => {
        const y = top + k * ROW_H;
        const colour = c(`body-${id}`);
        ctx.fillStyle = c('chart-grid');
        ctx.globalAlpha = 0.3;
        ctx.fillRect(LEFT, y + 6, pw, 10);
        ctx.globalAlpha = 1;
        rows.forEach((r, i) => {
          const b = r.bodies[id];
          if (i >= rows.length - 1 || b.altDeg <= 0) return;
          // kräftiger, je höher; schwächer, solange der Himmel noch hell ist (Vorlage)
          ctx.globalAlpha = clamp(b.altDeg / 45, 0.25, 1) * clamp((-r.sunAltDeg - 6) / 6, 0.35, 1);
          ctx.fillStyle = colour;
          ctx.fillRect(xOf(r.t), y + 6, step, 10);
          ctx.globalAlpha = 1;
        });
        ctx.textAlign = 'right';
        ctx.fillStyle = colour;
        ctx.fillText(name(id), LEFT - 8, y + 11);
        const now = sky.bodyAtSite(id, atUtc, site);
        const b = best.get(id);
        ctx.font = `600 11px ${font}`;
        ctx.fillStyle = now.altDeg > 0 ? c('chart-dim-label') : c('chart-axis');
        ctx.fillText(now.altDeg > 0 ? `${n(now.altDeg)}°` : '–', colNow, y + 11);
        ctx.font = `10px ${font}`;
        ctx.fillStyle = c('chart-axis');
        ctx.fillText(!b || b.sample.altDeg < 3 ? '–' : `${n(b.sample.altDeg)}°`, colMax, y + 11);
        if (!narrow) {
          const s = b ? b.sample : now;
          ctx.fillText(
            id === 'moon' ? `${n(s.illumPct ?? 0)} %` : `${n(s.mag ?? 0, 1)} mag`,
            colExtra,
            y + 11,
          );
        }
      });
      if (atUtc >= first.t && atUtc <= last.t) {
        ctx.fillStyle = c('chart-now');
        ctx.fillRect(Math.round(xOf(atUtc)), top - 4, 2, H - top);
      }
    };
    draw();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    ro?.observe(cv);
    return () => ro?.disconnect();
  }, [rows, site, first, last, dual, device, timeZone, atUtc, atIsNow, best, t, i18n.language]);

  if (!first) return null;
  return (
    <div className={styles.panel}>
      {cards.length > 0 ? (
        <ul className={styles.cards}>
          {cards.map((id) => {
            const b = best.get(id) as { t: number; sample: sky.BodySample };
            return (
              <li key={id} className={styles.card} data-body={id}>
                <span className={styles.dot} aria-hidden />
                <span className={styles.cardText}>
                  <strong className={styles.cardName}>{name(id)}</strong>
                  <span>{bestText(id)}</span>
                  <span className={styles.muted}>{extra(id, b.sample)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {hidden.length > 0 ? (
        <p className={styles.muted}>
          {t('bodies.hidden', { list: hidden.map((id) => name(id)).join(', ') })}
        </p>
      ) : null}
      <canvas ref={canvas} className={styles.canvas} role="img" aria-label={aria} />
      <p className={styles.note}>{t('bodies.note', { zone })}</p>
    </div>
  );
}
