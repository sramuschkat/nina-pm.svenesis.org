import { useEffect, useState } from 'react';

/**
 * Gibt `value` erst weiter, wenn er `ms` lang unverändert blieb; der erste Wert gilt sofort. Für Anfragen,
 * deren Schlüssel sich beim Ziehen oder Zoomen laufend ändert: Die Sternkarte stellte sonst für jede
 * Zwischenstellung eine eigene Regionsanfrage (Logs 25.09.2026: 125 Anfragen in 12 s, `api` an der reservierten
 * Parallelität, 503).
 */
export function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, settled, ms]);
  return settled;
}
