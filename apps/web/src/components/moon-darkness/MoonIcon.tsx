/**
 * Mondsymbol (Vorbild `drawMoonIcon` in legacy/…/astro-core.js): dunkle Scheibe, beleuchteter Teil aus einem
 * Halbkreis und der Terminator-Ellipse mit `rx = r·|cos φ|` (φ = Phasenwinkel). Zunehmend rechts beleuchtet,
 * abnehmend links; auf der Südhalbkugel gespiegelt. Rein dekorativ (`aria-hidden`), der Text steht daneben.
 * Konvention wie in Kalendern und Almanachen (Astronomie-Prüfung 28.09.2026): Das Symbol zeigt die Phase, nicht
 * die Lage am Himmel – in Äquatornähe steht die beleuchtete Seite in Wahrheit oben bzw. unten („Mondschiffchen“).
 */
import styles from './MoonDarkness.module.css';

/** SVG-Pfad des beleuchteten Teils für Mittelpunkt (c, c) und Radius r. */
export function litPath(angleDeg: number, c: number, r: number): string | null {
  const a = ((angleDeg % 360) + 360) % 360;
  const rx = Math.round(r * Math.abs(Math.cos((a * Math.PI) / 180)) * 1000) / 1000;
  const top = `${String(c)} ${String(c - r)}`;
  const bottom = `${String(c)} ${String(c + r)}`;
  if (a < 1 || a > 359) return null; // Neumond: nichts beleuchtet
  const waxing = a < 180;
  const crescent = a < 90 || a > 270;
  if (waxing)
    return `M ${top} A ${String(r)} ${String(r)} 0 0 1 ${bottom} A ${String(rx)} ${String(r)} 0 0 ${crescent ? 0 : 1} ${top} Z`;
  return `M ${top} A ${String(r)} ${String(r)} 0 0 0 ${bottom} A ${String(rx)} ${String(r)} 0 0 ${crescent ? 1 : 0} ${top} Z`;
}

export function MoonIcon({
  angleDeg,
  size = 26,
  southern = false,
}: {
  angleDeg: number;
  size?: number;
  southern?: boolean;
}) {
  const c = size / 2;
  const r = c - 1;
  const path = litPath(angleDeg, c, r);
  return (
    <svg
      className={styles.moonIcon}
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      aria-hidden="true"
      focusable="false"
    >
      <g transform={southern ? `translate(${String(size)} 0) scale(-1 1)` : undefined}>
        <circle cx={c} cy={c} r={r} className={styles.moonDark} />
        {path ? <path d={path} className={styles.moonLit} /> : null}
      </g>
    </svg>
  );
}
