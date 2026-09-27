/**
 * „Mond und Dunkelheit“ (Planung, Objektbrowser): aufklappbarer Kopf mit Mondsymbol, Phase, Beleuchtung und
 * Mondalter; darunter der Nachtstreifen nach dem Beobachtungsplaner (`drawNightStrip`): Himmel nach Sonnenhöhe,
 * astronomisch dunkel grün, Mondhöhe als gelbe Linie mit Fläche (Deckkraft nach Beleuchtung), Maßlinie der
 * astronomischen Dunkelheit, Kennzeichen für Sonnen- und Mondauf-/-untergang und die Dämmerungsgrenzen (bis zu
 * drei Zeilen, was nicht passt, entfällt), „jetzt“ in der laufenden Nacht, Stundenzeilen „Standort“ und – nur wenn
 * abweichend – „bei dir“. Zeiten in Standortzeit (NT-03); Sonne und Mond als gezeichnete Formen statt Zeichen
 * (rules/ui.md: kein Emoji). Farben aus `@nina-pm/ui-tokens`.
 */
import { formatNightKey, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { SKY_STOPS } from '@nina-pm/ui-tokens';
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { hourTicks, iso, skyColor } from '../night-chart/model';
import styles from './MoonDarkness.module.css';
import { MoonIcon } from './MoonIcon';
import type { MoonDarknessData } from './model';

const H_SINGLE = 132;
const H_DUAL = 146;
const CT = 40;
const CB = 112;
const LABEL_ROWS = 3;
const ROW_H = 13;

function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(`--npm-${name}`).trim() || '#888';
}

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${String(parseInt(m[1] ?? '0', 16))}, ${String(parseInt(m[2] ?? '0', 16))}, ${String(parseInt(m[3] ?? '0', 16))}, ${alpha.toFixed(2)})`;
}

function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

type MarkKind = 'sun' | 'moon' | 'civil' | 'nautical' | 'astro' | 'now';
interface Mark {
  atUtc: number;
  kind: MarkKind;
  rising?: boolean;
  text: string;
  dash: boolean;
}

const MARK_TOKEN: Record<MarkKind, string> = {
  sun: 'chart-mark-sun',
  moon: 'chart-mark-moon',
  civil: 'chart-mark-civil',
  nautical: 'chart-mark-nautical',
  astro: 'chart-mark-astro',
  now: 'chart-marker',
};

/** Kleine Sonne (Scheibe mit Strahlen) bzw. Mondsichel vor dem Text, dazu ein Pfeil auf/ab. */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: 'sun' | 'moon',
  rising: boolean,
  x: number,
  y: number,
  color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const cy = y + 5.5;
  if (kind === 'sun') {
    ctx.beginPath();
    ctx.arc(x + 4, cy, 2.2, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(x + 4 + Math.cos(a) * 3.3, cy + Math.sin(a) * 3.3);
      ctx.lineTo(x + 4 + Math.cos(a) * 4.6, cy + Math.sin(a) * 4.6);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(x + 4, cy, 4, Math.PI * 0.35, Math.PI * 1.65, false);
    ctx.arc(x + 5.8, cy, 3.1, Math.PI * 1.55, Math.PI * 0.45, true);
    ctx.fill();
  }
  // Pfeil
  const ax = x + 11;
  ctx.beginPath();
  ctx.moveTo(ax, cy - 4);
  ctx.lineTo(ax, cy + 4);
  ctx.stroke();
  ctx.beginPath();
  if (rising) {
    ctx.moveTo(ax - 2.5, cy - 1.5);
    ctx.lineTo(ax, cy - 4.5);
    ctx.lineTo(ax + 2.5, cy - 1.5);
  } else {
    ctx.moveTo(ax - 2.5, cy + 1.5);
    ctx.lineTo(ax, cy + 4.5);
    ctx.lineTo(ax + 2.5, cy + 1.5);
  }
  ctx.stroke();
  ctx.restore();
}
const GLYPH_W = 15;

export function MoonDarkness({
  data,
  night,
  timeZone,
  southern = false,
  nowUtc,
  cursorUtc,
  onCursorChange,
}: {
  data: MoonDarknessData;
  night: string;
  timeZone: string;
  southern?: boolean;
  /** Aktueller Zeitpunkt (Unix-Sekunden) – als Kennzeichen „jetzt“, nur in der laufenden Nacht. */
  nowUtc?: number;
  /** Eingestellte Uhrzeit (rote Linie, Sternkarte); ohne keine Linie. */
  cursorUtc?: number;
  /** Klick in den Streifen stellt die Uhrzeit (auf 5 min gerundet). */
  onCursorChange?: (atUtc: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const device = deviceZone();
  const dual =
    device !== undefined &&
    formatTzAbbr(iso(data.window.fromUtc), device) !==
      formatTzAbbr(iso(data.window.fromUtc), timeZone);
  const n = (x: number, d = 1) => x.toLocaleString(i18n.language, { maximumFractionDigits: d });
  const hm = (at: number) => formatZonedTime(iso(at), timeZone);
  const phase = data.phase;
  const title = t('moonDark.header', {
    phase: t(`moonDark.phase.${String(phase.phaseIndex)}`),
    pct: n(phase.illumPct, 0),
    age: n(phase.ageDays, 1),
  });
  const dark = data.astronomical;
  const darkMin =
    dark.startUtc !== null && dark.endUtc !== null
      ? Math.round((dark.endUtc - dark.startUtc) / 60)
      : 0;
  const duration = t('moonDark.duration', { h: Math.floor(darkMin / 60), m: darkMin % 60 });
  const summary = data.noDarkness
    ? t('moonDark.noDark')
    : data.darkAll
      ? t('moonDark.darkAll')
      : t('moonDark.darkSpan', { d: duration });

  useEffect(() => {
    const cv = canvas.current;
    if (!open || !cv) return;
    const draw = () => {
      const W = Math.max(320, cv.clientWidth || 600);
      const H = dual ? H_DUAL : H_SINGLE;
      const dpr = window.devicePixelRatio || 1;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.height = `${String(H)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = (name: string) => token(cv, name);
      const font = getComputedStyle(cv).fontFamily || 'sans-serif';
      ctx.fillStyle = c('chart-frame');
      ctx.fillRect(0, 0, W, H);
      const { fromUtc, toUtc } = data.window;
      const span = toUtc - fromUtc;
      const CH = CB - CT;
      const xOf = (at: number) => ((at - fromUtc) / span) * W;
      const yOf = (alt: number) => CB - (Math.min(90, Math.max(0, alt)) / 90) * CH;
      const step = W / (span / 300) + 0.6;
      // Himmel
      for (const s of data.samples) {
        ctx.fillStyle = s.sunAltDeg < -18 ? c('chart-sky-dark') : skyColor(s.sunAltDeg, SKY_STOPS);
        ctx.fillRect(xOf(s.atUtc), CT, step, CH);
      }
      // 30°/60°
      ctx.strokeStyle = c('chart-grid');
      ctx.setLineDash([3, 4]);
      for (const a of [30, 60]) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(yOf(a)) + 0.5);
        ctx.lineTo(W, Math.round(yOf(a)) + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = `9px ${font}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = c('chart-label');
      for (const a of [30, 60]) ctx.fillText(`${String(a)}°`, W - 3, yOf(a) - 1);
      // Mond: Fläche und Linie, wo er über dem Horizont steht
      const moonLine = c('chart-moon-line');
      const illum = phase.illumPct / 100;
      if (data.moonPeak) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, CT, W, CH);
        ctx.clip();
        ctx.beginPath();
        data.samples.forEach((s, i) => {
          const x = xOf(s.atUtc);
          const y = yOf(s.moonAltDeg);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        const last = data.samples.at(-1);
        const first = data.samples[0];
        if (last && first) {
          ctx.lineTo(xOf(last.atUtc), CB);
          ctx.lineTo(xOf(first.atUtc), CB);
        }
        ctx.closePath();
        ctx.fillStyle = rgba(moonLine, 0.12 + 0.3 * illum);
        ctx.fill();
        ctx.beginPath();
        let pen = false;
        for (const s of data.samples) {
          if (s.moonAltDeg <= 0) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(xOf(s.atUtc), yOf(s.moonAltDeg));
          else {
            ctx.moveTo(xOf(s.atUtc), yOf(s.moonAltDeg));
            pen = true;
          }
        }
        ctx.strokeStyle = moonLine;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.restore();
        // Höchster Stand: Mondsichel + „72° · 97 %“
        const txt = `${n(data.moonPeak.altDeg, 0)}° · ${n(phase.illumPct, 0)} %`;
        ctx.font = `600 10px ${font}`;
        ctx.textBaseline = 'bottom';
        const tw = ctx.measureText(txt).width + GLYPH_W - 4;
        const lx = Math.min(Math.max(xOf(data.moonPeak.atUtc), tw / 2 + 4), W - tw / 2 - 4);
        const ly = Math.max(CT + 30, yOf(data.moonPeak.altDeg) - 4);
        ctx.fillStyle = rgba(c('chart-frame'), 0.55);
        ctx.fillRect(lx - tw / 2 - 3, ly - 11, tw + 6, 12);
        ctx.save();
        ctx.fillStyle = moonLine;
        ctx.beginPath();
        const gx = lx - tw / 2 + 4;
        ctx.arc(gx, ly - 5.5, 4, Math.PI * 0.35, Math.PI * 1.65, false);
        ctx.arc(gx + 1.8, ly - 5.5, 3.1, Math.PI * 1.55, Math.PI * 0.45, true);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = moonLine;
        ctx.textAlign = 'left';
        ctx.fillText(txt, lx - tw / 2 + 10, ly);
      }
      // Maßlinie der astronomischen Dunkelheit
      if (dark.startUtc !== null && dark.endUtc !== null && !data.darkAll) {
        const x1 = Math.min(Math.max(xOf(dark.startUtc), 0), W);
        const x2 = Math.min(Math.max(xOf(dark.endUtc), 0), W);
        const ay = CT + 10;
        if (x2 - x1 > 24) {
          const label = c('chart-dim-label');
          ctx.strokeStyle = label;
          ctx.fillStyle = label;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x1 + 1, ay);
          ctx.lineTo(x2 - 1, ay);
          ctx.moveTo(x1 + 0.5, ay - 5);
          ctx.lineTo(x1 + 0.5, ay + 5);
          ctx.moveTo(x2 - 0.5, ay - 5);
          ctx.lineTo(x2 - 0.5, ay + 5);
          ctx.stroke();
          for (const [tip, dir] of [
            [x1 + 1, 1],
            [x2 - 1, -1],
          ] as const) {
            ctx.beginPath();
            ctx.moveTo(tip, ay);
            ctx.lineTo(tip + 6 * dir, ay - 3.5);
            ctx.lineTo(tip + 6 * dir, ay + 3.5);
            ctx.closePath();
            ctx.fill();
          }
          ctx.lineWidth = 1;
          ctx.font = `600 10px ${font}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          let text = t('moonDark.darkSpan', { d: duration });
          let dw = ctx.measureText(text).width;
          if (dw + 28 > x2 - x1) {
            text = duration;
            dw = ctx.measureText(text).width;
          }
          if (dw + 20 <= x2 - x1) {
            const cx = (x1 + x2) / 2;
            ctx.fillStyle = c('chart-sky-dark');
            ctx.fillRect(cx - dw / 2 - 5, ay - 7, dw + 10, 14);
            ctx.fillStyle = label;
            ctx.fillText(text, cx, ay + 0.5);
          }
        }
      }
      if (data.noDarkness || data.darkAll) {
        ctx.font = `600 11px ${font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = c('chart-dim-label');
        ctx.fillText(summary, W / 2, CT + CH / 2);
      }
      // Stundenzeilen
      ctx.font = `10px ${font}`;
      ctx.textBaseline = 'top';
      const ticks = hourTicks(fromUtc, toUtc, timeZone);
      const every = W / (span / 3600) < 30 ? 2 : 1;
      let rowW = 0;
      if (dual) {
        ctx.font = `600 10px ${font}`;
        ctx.textAlign = 'left';
        rowW =
          Math.max(
            ctx.measureText(t('moonDark.rowSite')).width,
            ctx.measureText(t('moonDark.rowDevice')).width,
          ) + 8;
        ctx.fillStyle = c('chart-axis-strong');
        ctx.fillText(t('moonDark.rowSite'), 0, CB + 5);
        ctx.fillStyle = c('chart-axis');
        ctx.fillText(t('moonDark.rowDevice'), 0, CB + 18);
        ctx.font = `10px ${font}`;
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = c('chart-axis-strong');
      ticks.forEach((tk, i) => {
        const x = xOf(tk.atUtc);
        ctx.fillRect(Math.round(x), CB, 1, 3);
        if (i % every === 0 && x - 7 > Math.max(1, rowW) && x < W - 8)
          ctx.fillText(tk.label, x, CB + 5);
      });
      if (dual && device) {
        ctx.fillStyle = c('chart-axis');
        hourTicks(fromUtc, toUtc, device).forEach((tk, i) => {
          const x = xOf(tk.atUtc);
          if (i % every === 0 && x - 7 > rowW && x < W - 8) ctx.fillText(tk.label, x, CB + 18);
        });
      }
      // Kennzeichen
      const marks: Mark[] = [];
      const push = (
        at: number | null,
        kind: MarkKind,
        text: string,
        dash: boolean,
        rising?: boolean,
      ) => {
        if (at !== null && at >= fromUtc && at <= toUtc)
          marks.push({ atUtc: at, kind, text, dash, rising });
      };
      push(data.sunset.startUtc, 'sun', hm(data.sunset.startUtc ?? 0), false, false);
      push(data.sunset.endUtc, 'sun', hm(data.sunset.endUtc ?? 0), false, true);
      for (const [cr, kind, key] of [
        [data.civil, 'civil', 'civil'],
        [data.nautical, 'nautical', 'nautical'],
        [data.astronomical, 'astro', 'astro'],
      ] as const) {
        push(cr.startUtc, kind, `${t(`moonDark.mark.${key}`)} ${hm(cr.startUtc ?? 0)}`, true);
        push(cr.endUtc, kind, `${t(`moonDark.mark.${key}`)} ${hm(cr.endUtc ?? 0)}`, true);
      }
      for (const e of data.moonEvents) push(e.atUtc, 'moon', hm(e.atUtc), false, e.type === 'rise');
      if (nowUtc !== undefined)
        push(nowUtc, 'now', `${t('moonDark.mark.now')} ${hm(nowUtc)}`, true);
      marks.sort((a, b) => a.atUtc - b.atUtc);
      const ends = Array.from({ length: LABEL_ROWS }, () => -1e9);
      ctx.font = `600 10px ${font}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      for (const m of marks) {
        const glyph = m.kind === 'sun' || m.kind === 'moon';
        const w = ctx.measureText(m.text).width + (glyph ? GLYPH_W : 0);
        const x = xOf(m.atUtc);
        const cx = Math.min(Math.max(x, w / 2 + 1), W - w / 2 - 1);
        const row = ends.findIndex((e) => cx - w / 2 > e + 6);
        if (row < 0) continue;
        ends[row] = cx + w / 2;
        const y = 1 + row * ROW_H;
        const color = c(MARK_TOKEN[m.kind]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash(m.dash ? [3, 3] : [1, 2]);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, y + 11);
        ctx.lineTo(Math.round(x) + 0.5, CB);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const left = cx - w / 2;
        if (glyph) drawGlyph(ctx, m.kind as 'sun' | 'moon', m.rising === true, left, y, color);
        ctx.fillStyle = color;
        ctx.fillText(m.text, left + (glyph ? GLYPH_W : 0), y);
      }
      if (cursorUtc !== undefined && cursorUtc >= fromUtc && cursorUtc <= toUtc) {
        ctx.fillStyle = c('chart-now');
        ctx.fillRect(Math.round(xOf(cursorUtc)) - 1, CT, 2, CH + 3);
      }
    };
    draw();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw);
    ro?.observe(cv);
    return () => ro?.disconnect();
  }, [open, data, dual, device, timeZone, nowUtc, cursorUtc, phase.illumPct, t, i18n.language]);

  const inWindow = (at: number | undefined) =>
    at !== undefined && at >= data.window.fromUtc && at <= data.window.toUtc;
  const pick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!onCursorChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const at = data.window.fromUtc + f * (data.window.toUtc - data.window.fromUtc);
    onCursorChange(Math.round(at / 300) * 300);
  };

  const zone = formatTzAbbr(iso(data.window.fromUtc), timeZone);
  const legend: { style: CSSProperties; cls?: string; label: string }[] = [
    { style: { background: skyColor(6, SKY_STOPS) }, label: t('moonDark.key.day') },
    { style: { background: skyColor(-3, SKY_STOPS) }, label: t('moonDark.key.civil') },
    { style: { background: skyColor(-9, SKY_STOPS) }, label: t('moonDark.key.nautical') },
    { style: { background: skyColor(-15, SKY_STOPS) }, label: t('moonDark.key.astronomical') },
    { style: {}, cls: styles.keyDark, label: t('moonDark.key.dark') },
    { style: {}, cls: styles.keyMoon, label: t('moonDark.key.moonAlt') },
    ...(inWindow(nowUtc) ? [{ style: {}, cls: styles.keyNow, label: t('moonDark.key.now') }] : []),
    ...(inWindow(cursorUtc)
      ? [{ style: {}, cls: styles.keyCursor, label: t('moonDark.key.cursor') }]
      : []),
  ];
  return (
    <section className={styles.panel} aria-labelledby={`${bodyId}-title`}>
      <div className={styles.head}>
        <MoonIcon angleDeg={phase.angleDeg} size={34} southern={southern} />
        <div className={styles.headText}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((o) => !o)}
          >
            {t('moonDark.title')}
          </button>
          <p id={`${bodyId}-title`} className={styles.title}>
            {title}
          </p>
        </div>
      </div>
      {open ? (
        <div id={bodyId} className={styles.body}>
          <canvas
            ref={canvas}
            className={onCursorChange ? `${styles.canvas} ${styles.clickable}` : styles.canvas}
            onClick={onCursorChange ? pick : undefined}
            role="img"
            aria-label={t('moonDark.aria', {
              night: formatNightKey(night),
              summary,
              pct: n(phase.illumPct, 0),
              zone,
            })}
          />
          <ul className={styles.legend} aria-label={t('moonDark.legend')}>
            {legend.map((k) => (
              <li key={k.label}>
                <span className={`${styles.key} ${k.cls ?? ''}`} style={k.style} aria-hidden />
                {k.label}
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            {t('moonDark.note', { zone })}
            {onCursorChange ? ` ${t('moonDark.clickNote')}` : ''}
          </p>
        </div>
      ) : null}
    </section>
  );
}
