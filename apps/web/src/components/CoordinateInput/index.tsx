/**
 * `CoordinateInput` (components.md §2.6): **ein** `<input>` für RA/Dec/Länge/Breite; nimmt beide
 * Schreibweisen an, zeigt in der gewählten an; Umschalter als kleiner Knopf im Feld; Format im
 * `aria-describedby`. Ungültig → Fehler am Feld mit Beispiel; leer und `required` → Fehler beim Verlassen.
 */
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  COORD_EXAMPLE,
  COORD_RANGE,
  formatCoordinate,
  parseCoordinate,
  type CoordFormat,
  type CoordKind,
} from './coords';
import styles from './CoordinateInput.module.css';

export interface CoordinateInputProps {
  kind: CoordKind;
  valueDeg: number | null;
  onChange: (valueDeg: number | null) => void;
  format?: CoordFormat;
  onFormatChange?: (format: CoordFormat) => void;
  disabled?: boolean;
  required?: boolean;
  /** Sichtbare Beschriftung; Standard ist der Name der Koordinate. */
  label?: string;
}

export function CoordinateInput({
  kind,
  valueDeg,
  onChange,
  format: initialFormat = 'sexagesimal',
  onFormatChange,
  disabled,
  required,
  label,
}: CoordinateInputProps) {
  const { t } = useTranslation();
  const id = useId();
  const [format, setFormat] = useState<CoordFormat>(initialFormat);
  const [text, setText] = useState(() => formatCoordinate(kind, valueDeg, initialFormat));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatCoordinate(kind, valueDeg, format));
  }, [valueDeg, format, kind, focused]);

  const validate = (value: string, onBlur: boolean): void => {
    const res = parseCoordinate(kind, value);
    if (!res.ok) {
      setError(
        res.reason === 'range'
          ? t('coordinate.outOfRange', { min: COORD_RANGE[kind].min, max: COORD_RANGE[kind].max })
          : t('coordinate.invalid', { example: COORD_EXAMPLE[kind] }),
      );
      return;
    }
    if (res.valueDeg === null && required && onBlur) {
      setError(t('coordinate.required'));
    } else {
      setError(null);
    }
    onChange(res.valueDeg);
  };

  const toggle = () => {
    const next: CoordFormat = format === 'sexagesimal' ? 'decimal' : 'sexagesimal';
    setFormat(next);
    onFormatChange?.(next);
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label ?? t(`coordinate.kind.${kind}`)}
      </label>
      <div className={`${styles.control} ${error ? styles.invalid : ''}`}>
        <input
          id={id}
          value={text}
          disabled={disabled}
          required={required}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={`${id}-fmt ${error ? `${id}-err` : ''}`.trim()}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            validate(e.target.value, false);
          }}
          onBlur={() => {
            setFocused(false);
            validate(text, true);
          }}
        />
        <button
          type="button"
          className={styles.toggle}
          onClick={toggle}
          disabled={disabled}
          aria-label={t('coordinate.toggleFormat')}
        >
          {format === 'sexagesimal' ? '°′″' : '0.0°'}
        </button>
      </div>
      <span id={`${id}-fmt`} className="visually-hidden">
        {format === 'sexagesimal'
          ? t('coordinate.formatSexagesimal')
          : t('coordinate.formatDecimal')}
      </span>
      {error ? (
        <span id={`${id}-err`} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
