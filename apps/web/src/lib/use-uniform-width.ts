/**
 * Gleich breite Elemente über einen ganzen Bereich (AP-26i/26j, Wunsch Sven 26.09.2026): misst nach dem
 * Zeichnen und bei jeder Änderung der Kinder (`MutationObserver`) das breiteste Element zu `selector` und
 * setzt dessen Breite als CSS-Variable `variable` am Bereich. Die Elemente nutzen `width: var(…, auto)`
 * mit `box-sizing: border-box` – gemessen wird ohne die Variable, also die natürliche Breite.
 * Rückgabe ist eine Callback-Ref: sie greift auch, wenn der Bereich erst später erscheint.
 */
import { useCallback, useRef } from 'react';

export function useUniformWidth(selector: string, variable: `--${string}`) {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!el) return;
      let frame = 0;
      const measure = () => {
        frame = 0;
        el.style.removeProperty(variable);
        let max = 0;
        el.querySelectorAll<HTMLElement>(selector).forEach((c) => {
          max = Math.max(max, c.getBoundingClientRect().width);
        });
        if (max > 0) el.style.setProperty(variable, `${String(Math.ceil(max))}px`);
      };
      measure();
      if (typeof MutationObserver === 'undefined') return;
      const mo = new MutationObserver(() => {
        if (!frame) frame = requestAnimationFrame(measure);
      });
      mo.observe(el, { childList: true, subtree: true });
      cleanup.current = () => {
        mo.disconnect();
        if (frame) cancelAnimationFrame(frame);
      };
    },
    [selector, variable],
  );
}
