/**
 * Hilfesymbol mit Erklärung (FA-EXO-13 „kurze Erklärung je Größe“): Knopf mit Tooltip bei Maus, Fokus und
 * Antippen, Escape schließt. Der Text ist immer als Beschreibung verknüpft (Screenreader), sichtbar nur offen.
 * Der Tooltip liegt `fixed` am Knopf und bleibt im Fenster – so erzeugt er nie horizontales Scrollen (NFA-01).
 * Ersetzt das frühere SVG-`<title>`, das der Browser nur über dem dünnen Strich des Symbols zeigte.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ICON_SIZE, uiIcons } from '../../components/icons';
import styles from './exo.module.css';

const TIP_WIDTH = 288;
const GAP = 8;

export function HelpTip({ text, label }: { text: string; label: string }) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [pinned, setPinned] = useState(false);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(TIP_WIDTH, window.innerWidth - 2 * GAP);
    const left = Math.max(GAP, Math.min(r.left - GAP, window.innerWidth - width - GAP));
    setPos({ top: r.bottom + GAP / 2, left, width });
  }, []);
  const hide = useCallback(() => {
    setPos(null);
    setPinned(false);
  }, []);

  useEffect(() => {
    if (!pos) return;
    const close = () => hide();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos, hide]);

  return (
    <span className={styles.helpTip}>
      <button
        ref={ref}
        type="button"
        className={styles.helpButton}
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pos !== null}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!pinned) hide();
        }}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          if (pinned) hide();
          else {
            show();
            setPinned(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide();
        }}
      >
        <uiIcons.help size={ICON_SIZE.table} aria-hidden="true" focusable="false" />
      </button>
      <span
        id={id}
        role="tooltip"
        className={styles.tooltip}
        hidden={pos === null}
        style={pos ? { top: pos.top, left: pos.left, width: pos.width } : undefined}
      >
        {text}
      </span>
    </span>
  );
}
