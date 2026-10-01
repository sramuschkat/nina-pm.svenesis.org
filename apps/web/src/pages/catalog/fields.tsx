/**
 * Eingabefelder der Filterleisten in der Planung (S-21, S-22): Auswahlliste und Zahlenfeld mit Einheit, gestaltet
 * über das Stylesheet des Objektbrowsers.
 */
import { useEffect, useState } from 'react';
import { chipBackground, chipTextColor } from '../../components/FilterChip';
import styles from './catalog.module.css';

/** Hintergrund und Schrift in der Farbe eines Filters (wie `FilterChip`). */
const chip = (hex: string | undefined) =>
  hex ? { background: chipBackground(hex), color: chipTextColor(hex) } : undefined;

/**
 * Auswahlliste; `compact` in der Filterzeile: Beschriftung nur für Screenreader, erste Option benennt. `colors`
 * (Wert → Farbe, z. B. Filterfarben) hinterlegt die Auswahl und jede Option farbig.
 */
export function Select({
  id,
  label,
  value,
  options,
  onChange,
  compact,
  colors,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  compact?: boolean;
  colors?: Readonly<Record<string, string>>;
}) {
  return (
    <div className={compact ? styles.compactField : styles.field}>
      <label htmlFor={id} className={compact ? styles.srOnly : undefined}>
        {label}
      </label>
      <select
        id={id}
        className={`${styles.input} ${colors?.[value] ? styles.colorSelect : ''}`}
        style={chip(colors?.[value])}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v} style={chip(colors?.[v])}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Zahl als Text (leer = kein Filter); übernommen beim Verlassen des Felds oder mit Enter. */
export function NumberInput({
  id,
  label,
  unit,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onChange(draft.trim());
  };
  return (
    <div className={`${styles.field} ${styles.numberField}`}>
      <label htmlFor={id}>
        {label} <span className={styles.muted}>({unit})</span>
      </label>
      <input
        id={id}
        className={styles.input}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}
