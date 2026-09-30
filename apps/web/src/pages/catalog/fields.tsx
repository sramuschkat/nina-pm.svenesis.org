/**
 * Eingabefelder der Filterleisten in der Planung (S-21, S-22): Auswahlliste und Zahlenfeld mit Einheit, gestaltet
 * über das Stylesheet des Objektbrowsers.
 */
import { useEffect, useState } from 'react';
import styles from './catalog.module.css';

/** Auswahlliste; `compact` in der Filterzeile: Beschriftung nur für Screenreader, erste Option benennt. */
export function Select({
  id,
  label,
  value,
  options,
  onChange,
  compact,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? styles.compactField : styles.field}>
      <label htmlFor={id} className={compact ? styles.srOnly : undefined}>
        {label}
      </label>
      <select
        id={id}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
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
