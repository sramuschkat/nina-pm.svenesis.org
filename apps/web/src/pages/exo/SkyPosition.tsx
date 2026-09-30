/**
 * Himmelsposition (FA-EXO-14): kleine Sternkarte um den Wirtsstern – stereografisch, Norden oben, Osten links,
 * Radius 30°. Sternbildlinien, helle Sterne (≤ 4,5 mag) und Sternbildnamen aus den Daten der Sternkarte
 * (`loadBrightSky`, eigener Chunk). Farben über Tokens der Diagramme.
 */
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadBrightSky, unit, type BrightSky } from '../planning/skymap/sky-data';
import styles from './exo.module.css';

const SIZE = 240;
const RADIUS_DEG = 30;

type Vec = readonly [number, number, number];

/** Projektion um die Mitte `c`: Bildkoordinaten oder `null` außerhalb des Radius. */
export function projector(raDeg: number, decDeg: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const c = unit(raDeg, decDeg);
  const east: Vec = [-Math.sin(r(raDeg)), Math.cos(r(raDeg)), 0];
  const north: Vec = [
    -Math.sin(r(decDeg)) * Math.cos(r(raDeg)),
    -Math.sin(r(decDeg)) * Math.sin(r(raDeg)),
    Math.cos(r(decDeg)),
  ];
  const limit = Math.cos(r(RADIUS_DEG));
  const scale = SIZE / 2 / (2 * Math.tan(r(RADIUS_DEG) / 2));
  return (v: Vec): [number, number] | null => {
    const z = v[0] * c[0] + v[1] * c[1] + v[2] * c[2];
    if (z < limit) return null;
    const x = v[0] * east[0] + v[1] * east[1] + v[2] * east[2];
    const y = v[0] * north[0] + v[1] * north[1] + v[2] * north[2];
    const k = 2 / (1 + z);
    // Himmelsansicht: Osten links
    return [SIZE / 2 - x * k * scale, SIZE / 2 - y * k * scale];
  };
}

export function SkyPosition({
  raDeg,
  decDeg,
  label,
}: {
  raDeg: number;
  decDeg: number;
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const clipId = useId();
  const [sky, setSky] = useState<BrightSky | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadBrightSky()
      .then((s) => {
        if (live) setSky(s);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  const project = projector(raDeg, decDeg);
  const lines: string[] = [];
  const stars: { x: number; y: number; r: number }[] = [];
  const names: { x: number; y: number; text: string }[] = [];
  if (sky) {
    for (const c of sky.lines)
      for (const part of c.parts) {
        let d = '';
        let pen = false;
        for (const v of part) {
          const p = project(v);
          if (!p) {
            pen = false;
            continue;
          }
          d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
          pen = true;
        }
        if (d) lines.push(d);
      }
    for (let i = 0; i < sky.stars.count; i += 1) {
      const mag = sky.stars.mag[i] ?? 9;
      if (mag > 4.5) continue;
      const p = project([
        sky.stars.vec[i * 3] ?? 0,
        sky.stars.vec[i * 3 + 1] ?? 0,
        sky.stars.vec[i * 3 + 2] ?? 0,
      ]);
      if (p) stars.push({ x: p[0], y: p[1], r: Math.max(0.8, 3 - mag * 0.5) });
    }
    for (const l of sky.labels) {
      const p = project(l.vec);
      if (p) names.push({ x: p[0], y: p[1], text: i18n.language.startsWith('de') ? l.de : l.en });
    }
  }
  return (
    <figure className={styles.skyPosition}>
      <svg
        viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
        role="img"
        aria-label={t('exo.skyPosition.label', { name: label })}
      >
        <defs>
          <clipPath id={clipId}>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} />
          </clipPath>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} className={styles.skyDisc} />
        <g clipPath={`url(#${clipId})`}>
          {lines.map((d, i) => (
            <path key={`l${String(i)}`} d={d} className={styles.skyLine} />
          ))}
          {stars.map((s, i) => (
            <circle key={`s${String(i)}`} cx={s.x} cy={s.y} r={s.r} className={styles.skyStar} />
          ))}
          {names.map((n, i) => (
            <text
              key={`n${String(i)}`}
              x={n.x}
              y={n.y}
              className={styles.skyName}
              textAnchor="middle"
            >
              {n.text}
            </text>
          ))}
        </g>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={6} className={styles.skyTarget} />
        <text x={SIZE / 2} y={12} className={styles.skyName} textAnchor="middle">
          {t('exo.skyPosition.north')}
        </text>
        <text x={8} y={SIZE / 2 + 4} className={styles.skyName}>
          {t('exo.skyPosition.east')}
        </text>
      </svg>
      <figcaption className={styles.muted}>
        {failed ? t('exo.skyPosition.failed') : t('exo.skyPosition.caption')}
      </figcaption>
    </figure>
  );
}
