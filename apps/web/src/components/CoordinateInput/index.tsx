/**
 * `CoordinateInput` (components.md §2.6): **ein** `<input>` für RA/Dec/Länge/Breite; nimmt beide
 * Schreibweisen an, zeigt in der gewählten an; Umschalter als kleiner Knopf im Feld; Format im
 * `aria-describedby`. Ungültig → Fehler am Feld mit Beispiel; leer und `required` → Fehler beim Verlassen.
 *
 * **Übernahme erst beim Verlassen oder mit Enter** (Prüfung 28.09.2026): `onChange` meldet den Wert nicht
 * mehr je Tastendruck – Teilwerte wie „9° 8′“ vor dem „W“ landeten sonst im Entwurf bzw. lösten je Taste
 * ein PATCH aus (Panel-Liste). Ungültiger Text wird nie übernommen; `onValidityChange` meldet dem
 * Aufrufer, ob das Feld gerade einen Fehler zeigt, damit er *Speichern* sperren kann.
 */
import { useEffect, useId, useRef, useState } from 'react';
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
  /** Übernommener Wert – nur beim Verlassen des Feldes oder mit Enter und nur, wenn er sich ändert. */
  onChange: (valueDeg: number | null) => void;
  /** `false`, solange das Feld einen Fehler zeigt (ungültig, außerhalb des Bereichs, Pflichtfeld leer). */
  onValidityChange?: (valid: boolean) => void;
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
  onValidityChange,
  format: formatProp = 'sexagesimal',
  onFormatChange,
  disabled,
  required,
  label,
}: CoordinateInputProps) {
  const { t } = useTranslation();
  const id = useId();
  const [format, setFormat] = useState<CoordFormat>(formatProp);
  const [text, setText] = useState(() => formatCoordinate(kind, valueDeg, formatProp));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [prev, setPrev] = useState({ valueDeg, formatProp });

  // Neuer Wert bzw. neue Schreibweise von außen: Text nachziehen – außer während der Eingabe. Entspricht
  // der Text schon dem Wert (eben selbst übernommen), bleibt ein Fehler wie „Pflichtfeld“ stehen.
  if (prev.valueDeg !== valueDeg || prev.formatProp !== formatProp) {
    setPrev({ valueDeg, formatProp });
    const nextFormat = prev.formatProp !== formatProp ? formatProp : format;
    if (nextFormat !== format) setFormat(nextFormat);
    const current = parseCoordinate(kind, text);
    const same = current.ok && current.valueDeg === valueDeg;
    if (!focused && (!same || nextFormat !== format)) {
      setText(formatCoordinate(kind, valueDeg, nextFormat));
      if (!same) setError(null);
    }
  }

  // Gültigkeit an den Aufrufer melden (auch beim Aushängen: ein entferntes Feld sperrt nichts mehr).
  const validityRef = useRef(onValidityChange);
  useEffect(() => {
    validityRef.current = onValidityChange;
  });
  useEffect(() => {
    validityRef.current?.(error === null);
  }, [error]);
  useEffect(() => () => validityRef.current?.(true), []);

  const errorFor = (value: string, onBlur: boolean): string | null => {
    const res = parseCoordinate(kind, value);
    if (!res.ok)
      return res.reason === 'range'
        ? t('coordinate.outOfRange', { min: COORD_RANGE[kind].min, max: COORD_RANGE[kind].max })
        : t('coordinate.invalid', { example: COORD_EXAMPLE[kind] });
    return res.valueDeg === null && required && onBlur ? t('coordinate.required') : null;
  };

  /** Verlassen oder Enter: gültigen Wert übernehmen und in der gewählten Schreibweise zeigen. */
  const commit = () => {
    const res = parseCoordinate(kind, text);
    setError(errorFor(text, true));
    if (!res.ok) return;
    setText(formatCoordinate(kind, res.valueDeg, format));
    if (res.valueDeg !== valueDeg) onChange(res.valueDeg);
  };

  const toggle = () => {
    const next: CoordFormat = format === 'sexagesimal' ? 'decimal' : 'sexagesimal';
    setFormat(next);
    // Gültiger Text wechselt die Schreibweise (und gilt damit als übernommen); ungültiger bleibt stehen.
    const res = parseCoordinate(kind, text);
    if (res.ok) {
      setText(formatCoordinate(kind, res.valueDeg, next));
      if (res.valueDeg !== valueDeg) onChange(res.valueDeg);
    }
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
            setError(errorFor(e.target.value, false));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          onBlur={() => {
            setFocused(false);
            commit();
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
