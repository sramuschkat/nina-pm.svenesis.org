### Transitsuche: Filter wie Astro PM, APC ausgeschlossen (2026-09-30)

Anforderungen: FA-EXO-02, FA-EXO-05, FA-EXO-11 · transit.md §5 · Entscheidungen Sven 30.09.2026 nach Abgleich mit Astro PM

- „Start/Ende nautisch dunkel“ und „Start/Ende über Mindesthöhe“ prüfen Ingress und Egress statt der Fenstergrenzen mit Baseline. Die Schalter heißen jetzt „Ingress und Egress …“.
- „Transits mit Meridian-Flip ausblenden“ greift nur bei einer Kulmination zwischen Ingress und Egress. Ein Flip in der Baseline bleibt sichtbar und markiert (neues Feld `meridianInTransit`).
- TOI-Kandidaten mit Disposition APC werden beim Import verworfen und gezählt (`ambiguous`). Die Suche blendet sie schon vor dem nächsten wöchentlichen Abruf aus.
- Engine 0.12.0.
- Abgleich mit Astro PM (29./30.09.2026, Starfront) in `transit.md` §5:
  - Transitzeiten auf die Minute gleich;
  - Mondabstand bei uns wie astropy, bei Astro PM rund 10° höher;
  - Dubletten bei uns zusammengeführt;
  - sehr unsichere Ephemeriden bei uns nicht beobachtbar (AST-T19).
